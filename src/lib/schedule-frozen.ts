import type { Prisma } from "@prisma/client";
import { can, type Access } from "./access";
import { shiftRange } from "./berlin";
import { branchView, contractorWorkerView, formerView, publicUser, type ShiftWithRelations } from "./planning";
import type { Snapshot } from "./schedule-diff";

type Tx = Prisma.TransactionClient;

/*
 * Eingefrorene Mitarbeitersicht (BAUSTEINE.md, Entscheidung 1): Solange ein
 * Plan in Bearbeitung ist (EDITING), sehen alle ausser der Planung des
 * Standorts den veroeffentlichten Stand aus der Momentaufnahme
 * (schedule_snapshots); die Planung sieht die Live-Zeilen. Check-in und
 * Zeiterfassung bleiben auf den Live-Zeilen.
 */

/** Planung (Admins, Manager mit "Dienstplan ansehen" am Standort des Plans) sieht die Live-Zeilen. */
export function seesLive(a: Access, schedule: { branchId: string | null }): boolean {
  return can(a, "VIEW_SCHEDULE", schedule.branchId) && (a.isAdmin || a.role === "MANAGER");
}

export type FrozenPlans = { scheduleIds: Set<string>; shifts: ShiftWithRelations[] };

/**
 * Plaene in Bearbeitung (where, immer in der Organisation der Person), die
 * die Person nicht live sieht, mit allen Schichten ihrer Momentaufnahme in
 * der Form von shiftInclude: Personen, geloeschte Personen, Platzhalter und
 * Arbeitsbereiche werden nachgeladen, Plan und Standort sind die aktuellen
 * Zeilen. Eine Momentaufnahme unbekannter Version bleibt aussen vor - dann
 * gelten die Live-Zeilen (mit Warnung im Serverprotokoll).
 */
export async function frozenPlans(tx: Tx, a: Access, where: Prisma.ScheduleWhereInput): Promise<FrozenPlans> {
  const rows = await tx.schedule.findMany({
    where: { AND: [where, { organizationId: a.orgId, deletedAt: null, isPublic: true, editingSince: { not: null } }] },
    include: { branch: { select: branchView }, editSnapshot: true },
  });
  const plans = rows.filter(s => !seesLive(a, s)).flatMap(({ editSnapshot, ...schedule }) => {
    const data = editSnapshot?.data as unknown as Snapshot | undefined;
    if (data?.version === 1) return [{ schedule, data }];
    console.warn("Momentaufnahme des Plans " + schedule.id + " hat eine unbekannte Version (" + String(data?.version) + "); es gelten die Live-Zeilen.");
    return [];
  });
  if (!plans.length) return { scheduleIds: new Set(), shifts: [] };
  const shifts = plans.flatMap(p => p.data.shifts), bookings = shifts.flatMap(s => s.bookings);
  const ids = (values: (string | null)[]) => [...new Set(values.filter((v): v is string => !!v))];
  const [users, formers, workers, divisions] = await Promise.all([
    tx.user.findMany({ where: { id: { in: ids(bookings.map(b => b.userId)) } }, select: publicUser }),
    tx.formerEmployee.findMany({ where: { id: { in: ids(bookings.map(b => b.formerEmployeeId)) } }, select: formerView }),
    tx.contractorWorker.findMany({ where: { id: { in: ids(bookings.map(b => b.contractorWorkerId)) } }, select: contractorWorkerView }),
    tx.division.findMany({ where: { id: { in: ids(shifts.map(s => s.divisionId)) } } }),
  ]);
  const byId = <T extends { id: string }>(list: T[]) => new Map(list.map(x => [x.id, x]));
  const user = byId(users), former = byId(formers), worker = byId(workers), division = byId(divisions);
  return {
    scheduleIds: new Set(plans.map(p => p.schedule.id)),
    shifts: plans.flatMap(({ schedule, data }) => data.shifts.map(({ bookings, createdAt, ...shift }): ShiftWithRelations => ({
      ...shift, createdAt: new Date(createdAt), deletedAt: null, schedule,
      division: shift.divisionId ? division.get(shift.divisionId) ?? null : null,
      bookings: bookings.map(b => ({
        ...b, bookedAt: new Date(b.bookedAt), confirmedAt: b.confirmedAt ? new Date(b.confirmedAt) : null,
        user: b.userId ? user.get(b.userId) ?? null : null,
        formerEmployee: b.formerEmployeeId ? former.get(b.formerEmployeeId) ?? null : null,
        contractorWorker: b.contractorWorkerId ? worker.get(b.contractorWorkerId) ?? null : null,
      })),
    }))),
  };
}

/**
 * Live-Zeilen einer Ansicht mit eingefrorenen Plaenen: Zeilen dieser Plaene
 * (und dorthin gehoerende, inzwischen verschobene Schichten) entfallen, dafuer
 * stehen die Schichten der Momentaufnahme, die keep passieren - keep bildet
 * die Bedingungen der Live-Abfrage auf Schichtebene nach, where die auf
 * Planebene. Ohne eingefrorenen Plan bleibt live unveraendert, sonst nach Beginn sortiert.
 */
export async function frozenView(tx: Tx, a: Access, live: ShiftWithRelations[], where: Prisma.ScheduleWhereInput, keep: (s: ShiftWithRelations) => boolean = () => true): Promise<ShiftWithRelations[]> {
  const frozen = await frozenPlans(tx, a, where);
  if (!frozen.scheduleIds.size) return live;
  const ids = new Set(frozen.shifts.map(s => s.id));
  return [...live.filter(s => !frozen.scheduleIds.has(s.scheduleId) && !ids.has(s.id)), ...frozen.shifts.filter(keep)]
    .sort((x, y) => shiftRange(x).start - shiftRange(y).start);
}
