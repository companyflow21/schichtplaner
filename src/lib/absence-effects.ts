import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { db } from "./db";
import { ApiError } from "./errors";
import { addDate, isoWeek, shiftRange } from "./berlin";
import { can, type Access } from "./access";
import { CHECKED_IN } from "./checkin";
import { findShift, lastShiftDate, plannedMinutes, shiftEnded } from "./planning";
import { releaseAssignment } from "./shift-requests";
import { shiftDays, signalBookedSites } from "./conflicts";
import { emitToBranch } from "./emit";

type Tx = Prisma.TransactionClient;
export type Handling = "PAID" | "UNPAID" | "RELEASED";
const handlingSchema = z.enum(["PAID", "UNPAID", "RELEASED"]);
export const effectsSchema = z.object({
  default: handlingSchema.optional(),
  shifts: z.record(z.string(), handlingSchema).optional(),
  compensationHours: z.number().min(-1000).max(1000).optional(),
});
export type EffectsInput = z.output<typeof effectsSchema>;

const day = (value: Date) => value.toISOString().slice(0, 10);

/**
 * Beruehrt die Schicht den Zeitraum? Wie Konfliktpruefung und Einteilen
 * (assessAssignment): Nachtschichten zaehlen auch an ihrem Folgetag.
 */
export function touches(shift: Parameters<typeof lastShiftDate>[0], from: string, to: string): boolean {
  return shiftRange(shift).date <= to && lastShiftDate(shift) >= from;
}

/**
 * Zuweisungen einer Person mit Konto, deren Schicht den Zeitraum beruehrt
 * (veroeffentlicht, in Bearbeitung oder Entwurf; Live-Zeilen). Platzhalter und
 * Zuweisungen geloeschter Personen haben keine userId und gehoeren nie dazu.
 * ended/checkedIn: Die Zuweisung bleibt als Nachweis (assertReleasable) -
 * austragen geht dann nicht, bezahlt oder 0 Stunden schon.
 */
export async function affectedShifts(tx: Tx, orgId: string, userId: string, from: string, to: string) {
  const weeks = new Map<string, { year: number; weekNumber: number }>();
  for (let d = addDate(from, -1); d <= to; d = addDate(d, 1)) { const w = isoWeek(d); weeks.set(w.year + "-" + w.weekNumber, w); }
  const bookings = await tx.booking.findMany({
    where: { userId, shift: { deletedAt: null, schedule: { organizationId: orgId, deletedAt: null, OR: [...weeks.values()] } } },
    include: { shift: { include: { schedule: { include: { branch: { select: { name: true, customer: { select: { name: true } } } } } }, division: { select: { title: true, color: true } } } } },
  });
  const hits = bookings.filter((b) => touches(b.shift, from, to));
  const checkins = hits.length ? await tx.checkin.findMany({ where: { organizationId: orgId, userId, shiftId: { in: hits.map((b) => b.shiftId) }, status: { in: [...CHECKED_IN, "PENDING"] } }, select: { shiftId: true } }) : [];
  const checkedIn = new Set(checkins.map((c) => c.shiftId));
  return hits
    .map((b) => ({ b, range: shiftRange(b.shift) }))
    .sort((x, y) => x.range.start - y.range.start)
    .map(({ b, range }) => ({
      shiftId: b.shiftId, date: range.date, from: b.shift.shiftFrom, to: b.shift.shiftTo, plannedMinutes: plannedMinutes(b.shift), title: b.shift.title,
      branchId: b.shift.schedule.branchId, branchName: b.shift.schedule.branch?.name ?? null, customerName: b.shift.schedule.branch?.customer?.name ?? null,
      division: b.shift.division, published: b.shift.schedule.isPublic, editing: b.shift.schedule.isPublic && !!b.shift.schedule.editingSince,
      ended: shiftEnded(b.shift), checkedIn: checkedIn.has(b.shiftId),
    }));
}

export const defaultHandling = (category: { isPaid: boolean }): Handling => (category.isPaid ? "PAID" : "UNPAID");

/** Nach dem Commit, wie beim Aufheben (DELETE /api/bookings): Standortplan, Person und Beteiligte; Plaene mit Ueberschneidungen neu pruefen. */
export async function signalReleased(orgId: string, userId: string, released: Released[]): Promise<void> {
  for (const r of released) {
    emitToBranch(orgId, r.branchId, "booking:changed", [userId, ...r.parties]);
    await signalBookedSites(orgId, [userId], "booking:changed", r.days, r.branchId);
  }
}

/** Ausgetragen, nach dem Commit zu melden: Standort, Kalendertage und Beteiligte geschlossener Antraege. */
export type Released = { shiftId: string; branchId: string | null; days: { from: string; to: string }; parties: string[] };

/**
 * Wirkung einer genehmigten Abwesenheit auf die Schichten der Person im Zeitraum:
 * je Schicht bezahlt (zaehlt mit Planstunden), unbezahlt (0 Stunden) oder
 * ausgetragen (Person wird aus der Schicht genommen, die Schicht ist wieder
 * offen). Bestehende Entscheidungen bleiben, solange nichts anderes angegeben
 * ist; ausgetragen wird nie als Vorgabe. Optional ein Ausgleich auf das Zeitkonto.
 *
 * Austragen ist eine Planaenderung wie "Zuweisung aufheben" (releaseAssignment):
 * nur Administration oder "Schichten bearbeiten" am Standort (403), nicht nach
 * Schichtende oder Check-in (409), offene Antraege werden geschlossen, die
 * Person erhaelt eine Nachricht nur bei veroeffentlichten Plaenen ausserhalb der
 * Bearbeitung. Die Echtzeit-Signale sendet der Aufrufer nach dem Commit (released).
 */
export async function applyEffects(tx: Tx, a: Access, absence: { id: string; userId: string; dateFrom: Date; dateTo: Date }, category: { isPaid: boolean; name: string }, input: EffectsInput = {}) {
  const from = day(absence.dateFrom), to = day(absence.dateTo);
  const shifts = await affectedShifts(tx, a.orgId, absence.userId, from, to);
  const existing = new Map((await tx.absenceShift.findMany({ where: { absenceId: absence.id } })).map((e) => [e.shiftId, e.handling as Handling]));
  const ids = new Set(shifts.map((s) => s.shiftId));
  for (const id of Object.keys(input.shifts ?? {})) if (!ids.has(id)) throw new ApiError("Schicht gehört nicht zu dieser Abwesenheit.", 400);
  const released: Released[] = [];
  for (const s of shifts) {
    // Ausdruecklich je Schicht, sonst bisherige Entscheidung, sonst Vorgabe des Dialogs bzw. der Art.
    const handling = input.shifts?.[s.shiftId] ?? existing.get(s.shiftId) ?? input.default ?? defaultHandling(category);
    if (handling === "RELEASED") {
      if (!a.isAdmin && !can(a, "EDIT_SHIFTS", s.branchId)) throw new ApiError("Aus der Schicht nehmen darf nur, wer am Standort Schichten bearbeiten darf.", 403);
      const shift = await findShift(tx, a.orgId, s.shiftId);
      if (!shift) throw new ApiError("Schicht nicht gefunden.", 404);
      const { parties } = await releaseAssignment(tx, a, shift, absence.userId, "Wegen deiner genehmigten Abwesenheit bist du für diese Schicht nicht mehr eingeteilt.");
      released.push({ shiftId: s.shiftId, branchId: s.branchId, days: shiftDays(shift), parties });
    }
    await tx.absenceShift.upsert({ where: { absenceId_shiftId: { absenceId: absence.id, shiftId: s.shiftId } }, create: { absenceId: absence.id, shiftId: s.shiftId, handling }, update: { handling } });
  }
  // Schichten, die nicht mehr im Zeitraum liegen, verlieren ihre Wirkung; ausgetragene bleiben als Verlauf.
  await tx.absenceShift.deleteMany({ where: { absenceId: absence.id, shiftId: { notIn: [...ids] }, handling: { not: "RELEASED" } } });
  if (input.compensationHours) {
    const member = await tx.organizationMember.findFirst({ where: { organizationId: a.orgId, userId: absence.userId }, select: { id: true } });
    if (member) await tx.timeCompensation.create({ data: { organizationId: a.orgId, memberId: member.id, date: absence.dateFrom, minutes: Math.round(input.compensationHours * 60), description: "Abwesenheit " + category.name + " " + from + (to !== from ? " bis " + to : ""), createdById: a.userId } });
  }
  return { shifts: shifts.length, released };
}

export type AbsenceEffect = { effectId: string; handling: Handling; category: string; absenceId: string; payCode: string | null };

/** Schluessel einer Entscheidung: Person und Schicht (mehrere Personen einer Schicht koennen abwesend sein). */
export const effectKey = (userId: string, shiftId: string) => userId + "|" + shiftId;

/**
 * Wirkungen genehmigter Abwesenheiten fuer Personen mit Konto im Zeitraum: je
 * Person und Schicht die Entscheidung (nur solange die Schicht den Zeitraum der
 * Abwesenheit beruehrt) und je Person die Abwesenheitstage - fuer Schichten ohne
 * Entscheidung (Altbestand vor dieser Funktion): abwesend, 0 Stunden.
 */
export async function absenceEffects(orgId: string, userIds: string[], from: string, to: string) {
  const absences = userIds.length ? await db.absence.findMany({
    where: { userId: { in: userIds }, status: "APPROVED", category: { organizationId: orgId }, dateFrom: { lte: new Date(addDate(to, 1)) }, dateTo: { gte: new Date(addDate(from, -1)) } },
    include: { category: { select: { name: true, payCode: true } }, shiftEffects: true },
  }) : [];
  const byShift = new Map<string, AbsenceEffect & { from: string; to: string }>();
  const periods = new Map<string, { from: string; to: string; category: string }[]>();
  for (const x of absences) {
    const period = { from: day(x.dateFrom), to: day(x.dateTo), category: x.category.name };
    for (const e of x.shiftEffects) byShift.set(effectKey(x.userId, e.shiftId), { effectId: e.id, handling: e.handling as Handling, category: x.category.name, absenceId: x.id, payCode: x.category.payCode, from: period.from, to: period.to });
    periods.set(x.userId, [...(periods.get(x.userId) ?? []), period]);
  }
  /** Entscheidung fuer diese Person und Schicht, wenn die Schicht den Zeitraum der Abwesenheit noch beruehrt. */
  const forShift = (userId: string, shift: Parameters<typeof touches>[0] & { id: string }) => {
    const effect = byShift.get(effectKey(userId, shift.id));
    return effect && touches(shift, effect.from, effect.to) ? effect : null;
  };
  /** Genehmigte Abwesenheit an den Kalendertagen der Schicht (auch ohne Entscheidung). */
  const onShiftDays = (userId: string, shift: Parameters<typeof touches>[0]) => periods.get(userId)?.find((p) => touches(shift, p.from, p.to)) ?? null;
  return { forShift, onShiftDays };
}

/**
 * Bezahlte Abwesenheitsschichten (Planminuten) je Person im Zeitraum - fuer Lohn
 * und Zeitkonto. Zaehlt nur, solange die Zuweisung besteht, der Plan
 * veroeffentlicht ist (wie Stunden und Monatsauswertung) und die Schicht den
 * Zeitraum der Abwesenheit beruehrt. Nur Personen mit Konto: Abwesenheiten und
 * ihre Wirkungen entfallen mit dem Loeschen der Person.
 */
export async function paidAbsenceShifts(orgId: string, userIds: string[], from: string, to: string) {
  if (!userIds.length) return [];
  const effects = await db.absenceShift.findMany({
    where: {
      handling: "PAID",
      absence: { status: "APPROVED", userId: { in: userIds }, category: { organizationId: orgId }, dateFrom: { lte: new Date(addDate(to, 1)) }, dateTo: { gte: new Date(from) } },
      shift: { deletedAt: null, schedule: { organizationId: orgId, deletedAt: null, isPublic: true } },
    },
    include: {
      absence: { select: { userId: true, dateFrom: true, dateTo: true, category: { select: { name: true, payCode: true } } } },
      shift: { include: { schedule: true, bookings: { where: { userId: { in: userIds } }, select: { userId: true } } } },
    },
  });
  return effects
    .filter((e) => e.shift.bookings.some((b) => b.userId === e.absence.userId) && touches(e.shift, day(e.absence.dateFrom), day(e.absence.dateTo)))
    .map((e) => ({ id: e.id, userId: e.absence.userId, shiftId: e.shiftId, divisionId: e.shift.divisionId, branchId: e.shift.schedule.branchId, date: shiftRange(e.shift).date, from: e.shift.shiftFrom, to: e.shift.shiftTo, minutes: plannedMinutes(e.shift), category: e.absence.category.name, payCode: e.absence.category.payCode }))
    .filter((e) => e.date >= from && e.date <= to);
}
