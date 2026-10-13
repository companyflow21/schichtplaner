import type { Prisma } from "@prisma/client";
import type { ConflictItem, ConflictKind, ConflictSeverity, WeekConflicts } from "@/types/conflicts";
import { addDate, isoWeek, overlaps, shiftRange, weekDate } from "./berlin";
import { can, type Access } from "./access";
import { db } from "./db";
import { emitToBranches } from "./emit";
import { formatName } from "./names";
import { availabilityState, contractorWorkerView, formerView, lastShiftDate, missingQualifications, outsideDivision, personIds, personName, positionMismatch, publicUser } from "./planning";

type Tx = Prisma.TransactionClient;

/**
 * Schwere fest nach Art - bewusst unabhaengig davon, ob dieselbe Regel beim
 * Einteilen (assessAssignment) sperrt oder nur nach Bestaetigung warnt. Wird
 * dort etwa die Ueberschneidung spaeter zum bestaetigbaren Hinweis, bleibt
 * sie hier ein Fehler.
 */
const SEVERITY: Record<ConflictKind, ConflictSeverity> = {
  overlap: "fehler", absence: "fehler", inactive: "fehler", unavailable: "fehler",
  qualification: "hinweis", position: "hinweis", division: "hinweis", availability: "hinweis",
};

const day = (value: Date) => value.toISOString().slice(0, 10);

/**
 * Konflikte aller bestehenden Zuweisungen einer Standortwoche (Entwurf oder
 * veroeffentlicht) - dieselben Regeln, Vergleiche und Texte wie beim
 * Einteilen (assessAssignment), fuer die ganze Woche mit wenigen
 * mengenbasierten Abfragen. Ueberschneidungen gelten organisationsweit;
 * den Standort der anderen Schicht nennt die Antwort nur, wenn die
 * betrachtende Person dessen Dienstplan sehen darf.
 * Nicht geprueft: ein inaktiver Einsatzort (betrifft den ganzen Plan) und bei
 * Subunternehmer-Platzhaltern alles ausser der Ueberschneidung (ihre Eignung
 * wird extern bestaetigt). Historische Zuweisungen geloeschter Personen
 * zaehlen nicht.
 */
export async function weekConflicts(tx: Tx, a: Access, week: { branchId: string; weekNumber: number; year: number }): Promise<WeekConflicts> {
  const shifts = await tx.shift.findMany({
    where: { deletedAt: null, schedule: { organizationId: a.orgId, branchId: week.branchId, weekNumber: week.weekNumber, year: week.year, deletedAt: null } },
    include: {
      schedule: { include: { branch: { select: { positions: true } } } },
      division: { include: { members: { select: { userId: true } } } },
      bookings: { include: { user: { select: publicUser }, formerEmployee: { select: formerView }, contractorWorker: { select: contractorWorkerView } }, orderBy: { bookedAt: "asc" } },
    },
    orderBy: [{ dayOfWeek: "asc" }, { shiftFrom: "asc" }],
  });
  const userIds = [...new Set(shifts.flatMap(s => personIds(s.bookings)))];
  const workerIds = [...new Set(shifts.flatMap(s => s.bookings.flatMap(b => b.contractorWorkerId ? [b.contractorWorkerId] : [])))];
  if (!userIds.length && !workerIds.length) return { items: [], counts: { fehler: 0, hinweis: 0 } };
  // Eine Schicht beruehrt ihren Tag und hoechstens den Folgetag: Gegenschichten liegen in der Vor-, dieser oder der Folgewoche.
  const monday = weekDate(week.year, week.weekNumber, 1), first = addDate(monday, -1), last = addDate(monday, 7);
  const [members, absences, windows, others] = await Promise.all([
    tx.organizationMember.findMany({ where: { organizationId: a.orgId, userId: { in: userIds } }, select: { userId: true, isActive: true, position: true, qualifications: true } }),
    tx.absence.findMany({ where: { userId: { in: userIds }, status: "APPROVED", category: { organizationId: a.orgId }, dateFrom: { lte: new Date(last) }, dateTo: { gte: new Date(monday) } }, select: { userId: true, dateFrom: true, dateTo: true, shiftEffects: { select: { shiftId: true, handling: true } } } }),
    tx.availability.findMany({ where: { organizationId: a.orgId, userId: { in: userIds }, date: { gte: new Date(first), lte: new Date(last) } }, select: { userId: true, date: true, timeFrom: true, timeTo: true, available: true } }),
    tx.booking.findMany({
      where: {
        OR: [{ userId: { in: userIds } }, { contractorWorkerId: { in: workerIds } }],
        shift: { deletedAt: null, schedule: { organizationId: a.orgId, deletedAt: null, OR: [isoWeek(first), { year: week.year, weekNumber: week.weekNumber }, isoWeek(last)] } },
      },
      select: { userId: true, contractorWorkerId: true, shift: { select: { id: true, dayOfWeek: true, shiftFrom: true, shiftTo: true, schedule: { select: { year: true, weekNumber: true, branchId: true, branch: { select: { name: true } } } } } } },
    }),
  ]);
  const member = new Map(members.map(m => [m.userId, m]));
  const items: ConflictItem[] = [];
  for (const shift of shifts) {
    const range = shiftRange(shift), lastDate = lastShiftDate(shift);
    for (const b of shift.bookings) {
      if (!b.userId && !b.contractorWorkerId) continue;
      const found: ConflictItem[] = [];
      const add = (kind: ConflictKind, text: string, other?: ConflictItem["other"]) => found.push({
        shiftId: shift.id, date: range.date, bookingId: b.id,
        personKey: b.userId ?? "contractor:" + b.contractorWorkerId,
        ...(b.userId ? { userId: b.userId } : { contractorWorkerId: b.contractorWorkerId! }),
        name: formatName(personName(b), a.member.organization.nameFormat, { contractor: !!b.contractorWorkerId }),
        severity: SEVERITY[kind], kind, text, ...(other ? { other } : {}),
      });
      const m = b.userId ? member.get(b.userId) : undefined;
      // Wie beim Einteilen: Ein inaktives Konto ist der einzige Grund, weitere Pruefungen entfallen.
      if (b.userId && !m?.isActive) {
        add("inactive", "Mitarbeiter ist nicht aktiv.");
        items.push(...found);
        continue;
      }
      if (m) {
        if (shift.schedule.branch && positionMismatch(shift.schedule.branch.positions, m.position)) add("position", "Tätigkeit passt nicht zum Einsatzort.");
        if (outsideDivision(shift.division, m.userId)) add("division", "Gehört nicht zum Arbeitsbereich.");
        const missing = missingQualifications(shift.requiredQualifications, m.qualifications);
        if (missing.length) add("qualification", "Erforderliche Qualifikation fehlt: " + missing.join(", ") + ".");
        // Die Art der Abwesenheit bleibt Personaldaten; genannt werden nur die Genehmigung und, falls beim Genehmigen
        // gewaehlt, der Umgang mit dieser Schicht (lib/absence-effects.ts). Die Zuweisung bleibt ein Konflikt.
        const away = absences.filter(x => x.userId === m.userId && day(x.dateFrom) <= lastDate && day(x.dateTo) >= range.date);
        const handling = away.flatMap(x => x.shiftEffects).find(e => e.shiftId === shift.id)?.handling;
        if (away.length) add("absence", "Genehmigte Abwesenheit" + (handling === "PAID" ? " (bezahlt)" : handling === "UNPAID" ? " (0 Stunden)" : "") + ".");
      }
      for (const o of others) {
        if (o.shift.id === shift.id || (b.userId ? o.userId !== b.userId : o.contractorWorkerId !== b.contractorWorkerId)) continue;
        const other = shiftRange(o.shift);
        if (!overlaps(range, other)) continue;
        const { branchId, branch } = o.shift.schedule;
        const site = can(a, "VIEW_SCHEDULE", branchId) ? { ...(branchId ? { branchId } : {}), branchName: branch?.name ?? "Altbestand ohne Standort" } : {};
        add("overlap", "Zeitliche Überschneidung mit einer anderen Schicht.", { shiftId: o.shift.id, date: other.date, from: o.shift.shiftFrom, to: o.shift.shiftTo, ...site });
      }
      if (m) {
        const own = windows.filter(w => w.userId === m.userId && day(w.date) >= addDate(range.date, -1) && day(w.date) <= addDate(range.date, 1));
        const availability = availabilityState(range, lastDate, own);
        if (availability.unavailable) add("unavailable", "Als nicht verfügbar eingetragen.");
        if (availability.outside) add("availability", "Schicht liegt außerhalb der eingetragenen Verfügbarkeit.");
      }
      // Je Zuweisung zuerst Konflikte, dann Hinweise.
      items.push(...found.filter(c => c.severity === "fehler"), ...found.filter(c => c.severity === "hinweis"));
    }
  }
  return { items, counts: { fehler: items.filter(c => c.severity === "fehler").length, hinweis: items.filter(c => c.severity === "hinweis").length } };
}

/** Kalendertage einer Schicht (Nachtschichten enden am Folgetag). */
export function shiftDays(shift: Parameters<typeof lastShiftDate>[0]) {
  return { from: shiftRange(shift).date, to: lastShiftDate(shift) };
}

/**
 * Standorte, deren Wochenplaene Zuweisungen dieser Personen enthalten - mit
 * Zeitraum nur die Kalenderwochen, die er beruehrt (ab dem Vortag wegen
 * Nachtschichten; ueber 60 Wochen ohne Einschraenkung).
 */
export async function bookedBranchIds(tx: Tx, orgId: string, userIds: string[], days?: { from: string; to: string }): Promise<string[]> {
  if (!userIds.length) return [];
  const weeks = new Map<string, { year: number; weekNumber: number }>();
  if (days) for (let d = addDate(days.from, -1); d <= days.to && weeks.size <= 60; d = addDate(d, 1)) { const w = isoWeek(d); weeks.set(w.year + "-" + w.weekNumber, w); }
  const limited = days && weeks.size <= 60;
  const rows = await tx.schedule.findMany({
    where: { organizationId: orgId, deletedAt: null, branchId: { not: null }, ...(limited ? { OR: [...weeks.values()] } : {}), shifts: { some: { deletedAt: null, bookings: { some: { userId: { in: userIds } } } } } },
    select: { branchId: true },
    distinct: ["branchId"],
  });
  return rows.flatMap(r => r.branchId ? [r.branchId] : []);
}

/**
 * Nach dem Commit: Plaene, deren Konfliktpruefung sich durch eine Aenderung
 * an diesen Personen aendern kann (Abwesenheit, Verfuegbarkeit, Stammdaten,
 * Ueberschneidung an anderen Standorten), neu laden lassen - Signal ohne
 * Inhalt an Admins und Standortraeume. except: Standort, den der Aufrufer
 * schon benachrichtigt hat. Ein fehlgeschlagenes Signal macht die bereits
 * gespeicherte Aenderung nicht zum Fehler.
 */
export async function signalBookedSites(orgId: string, userIds: string[], event: string, days?: { from: string; to: string }, except?: string | null): Promise<void> {
  try {
    const ids = (await bookedBranchIds(db, orgId, userIds, days)).filter(id => id !== except);
    emitToBranches(orgId, ids, event);
  } catch (error) {
    console.warn("Echtzeit-Signal fuer Konfliktpruefung fehlgeschlagen", error);
  }
}
