import { z } from "zod";
import type { Prisma, TimeRecord } from "@prisma/client";
import { ApiError } from "./errors";
import { timeSchema } from "./api";
import { validDate, rangeMinutes, addDate, isoWeek, minuteOfDay, overlaps, shiftRange } from "./berlin";
import { branchHolders, staffHolders } from "./access";

type Tx = Prisma.TransactionClient;

export const timeChange = z.object({
  date: z.string().refine(validDate, "Ungültiges Datum.").optional(),
  timeFrom: timeSchema.nullable().optional(), timeTo: timeSchema.nullable().optional(),
  durationHours: z.number().int().min(0).max(48).nullable().optional(),
  durationMinutes: z.number().int().min(0).max(59).nullable().optional(),
  breakMinutes: z.number().int().min(0).max(1440).optional(),
  categoryId: z.string().nullable().optional(), comment: z.string().max(1000).nullable().optional()
});
export function snapshot(record: TimeRecord) {
  return { date: record.date.toISOString().slice(0, 10), timeFrom: record.timeFrom, timeTo: record.timeTo, durationHours: record.durationHours, durationMinutes: record.durationMinutes, breakMinutes: record.breakSeconds / 60, categoryId: record.categoryId, comment: record.comment, updatedAt: record.updatedAt.toISOString() };
}
export async function validatedTimeChange(tx: Tx, org: string, record: TimeRecord, data: z.output<typeof timeChange>) {
  if (record.type === "WATCH" && !record.timeTo) throw new ApiError("Laufende Zeiterfassung zuerst beenden.", 409);
  if (data.categoryId && !await tx.timeCategory.findFirst({ where: { id: data.categoryId, organizationId: org } })) throw new ApiError("Kategorie nicht gefunden.");
  const effective = { ...snapshot(record), ...data };
  if (record.type !== "MANUAL_DURATION" && (!effective.timeFrom || !effective.timeTo || effective.timeFrom === effective.timeTo)) throw new ApiError("Gültigen Beginn und Ende angeben.");
  const gross = record.type === "MANUAL_DURATION" ? (effective.durationHours ?? 0) * 60 + (effective.durationMinutes ?? 0) : rangeMinutes(effective.timeFrom!, effective.timeTo!);
  if (effective.breakMinutes > gross) throw new ApiError("Die Pause überschreitet die Arbeitszeit.");
  const { breakMinutes, date, ...fields } = data;
  const clocksChanged = effective.timeFrom !== record.timeFrom || effective.timeTo !== record.timeTo || effective.date !== snapshot(record).date;
  return { ...fields, ...(date ? { date: new Date(date) } : {}), ...(breakMinutes !== undefined ? { breakSeconds: Math.round(breakMinutes * 60) } : {}), ...(clocksChanged ? { startedAt: null, endedAt: null } : {}) };
}

/**
 * Zuordnungsregel fuer Zeitbuchungen (dieselbe wie in der Migration
 * 20260924090000_customers_branch_access):
 * Eine Buchung gehoert zu dem Standort der veroeffentlichten Schicht, der die
 * Person zugewiesen war und mit der sich die Buchung zeitlich ueberschneidet
 * (Ortszeit Europe/Berlin). Buchungen ohne Uhrzeiten werden ueber den
 * Kalendertag verglichen. Nur wenn genau ein Standort in Frage kommt, wird er
 * zurueckgegeben; sonst null (dann nur fuer die Person und Admins sichtbar).
 */
export async function branchForTime(tx: Tx, orgId: string, userId: string, record: { date: string; timeFrom: string | null; timeTo: string | null }): Promise<string | null> {
  const branches = new Set((await overlappingShifts(tx, orgId, userId, record)).map((s) => s.branchId));
  return branches.size === 1 ? [...branches][0] : null;
}

/** Schicht nach derselben Regel: nur wenn sich genau eine Schicht ueberschneidet. */
export async function shiftForTime(tx: Tx, orgId: string, userId: string, record: { date: string; timeFrom: string | null; timeTo: string | null }): Promise<string | null> {
  const shifts = await overlappingShifts(tx, orgId, userId, record);
  return shifts.length === 1 ? shifts[0].shiftId : null;
}

/** Veroeffentlichte Schichten mit Standort, denen die Person zugewiesen ist und die sich mit der Buchung ueberschneiden. */
async function overlappingShifts(tx: Tx, orgId: string, userId: string, record: { date: string; timeFrom: string | null; timeTo: string | null }) {
  const weeks = [isoWeek(addDate(record.date, -1)), isoWeek(record.date), isoWeek(addDate(record.date, 1))];
  const bookings = await tx.booking.findMany({
    where: { userId, shift: { deletedAt: null, schedule: { organizationId: orgId, deletedAt: null, isPublic: true, branchId: { not: null }, OR: weeks.map((w) => ({ year: w.year, weekNumber: w.weekNumber })) } } },
    include: { shift: { include: { schedule: true } } },
  });
  return bookings.filter((booking) => recordOverlaps(record, shiftRange(booking.shift))).map((b) => ({ shiftId: b.shiftId, branchId: b.shift.schedule.branchId! }));
}

/** Ueberschneidung einer Buchung (Wanduhr Europe/Berlin) mit einem Schichtzeitraum; ohne Uhrzeit zaehlt der Kalendertag. */
export function recordOverlaps(record: { date: string; timeFrom: string | null; timeTo: string | null }, range: { date: string; start: number; end: number }): boolean {
  if (!record.timeFrom) return range.date === record.date;
  const start = Date.parse(record.date + "T00:00:00Z") / 60000 + minuteOfDay(record.timeFrom);
  const length = record.timeTo ? rangeMinutes(record.timeFrom, record.timeTo) || 1440 : 1;
  return overlaps({ start, end: start + length }, range);
}

/**
 * Genehmigung einer neu erfassten oder beendeten Buchung: Eintraege der
 * Pruefenden fuer andere und alles der Administration gelten als genehmigt,
 * eigene Erfassung nur mit "automatisch genehmigen".
 */
export async function initialApproval(tx: Tx, orgId: string, actor: { userId: string; isAdmin: boolean }, recordUserId: string, reviewer: boolean): Promise<{ approvedAt: Date | null; approvedById: string | null }> {
  if (actor.isAdmin || (reviewer && recordUserId !== actor.userId)) return { approvedAt: new Date(), approvedById: actor.userId };
  const settings = await tx.timeSettings.findUnique({ where: { organizationId: orgId }, select: { autoApprove: true } });
  return settings?.autoApprove ? { approvedAt: new Date(), approvedById: null } : { approvedAt: null, approvedById: null };
}

/** Nach einer Aenderung Standort und Schicht neu zuordnen; ohne eindeutiges Ergebnis bleibt der bisherige Wert. */
export async function reassign(tx: Tx, orgId: string, record: TimeRecord) {
  // Zeiten geloeschter Personen bleiben unveraendert (keine Zuweisungen mit Konto mehr).
  if (!record.userId) return record;
  const span = { date: record.date.toISOString().slice(0, 10), timeFrom: record.timeFrom, timeTo: record.timeTo };
  const [branchId, shiftId] = await Promise.all([branchForTime(tx, orgId, record.userId, span), shiftForTime(tx, orgId, record.userId, span)]);
  const data = { ...(branchId && branchId !== record.branchId ? { branchId } : {}), ...(shiftId && shiftId !== record.shiftId ? { shiftId } : {}) };
  return Object.keys(data).length ? tx.timeRecord.update({ where: { id: record.id }, data }) : record;
}

/**
 * Wer eine Zeitkorrektur entscheidet: Admins sowie Manager mit
 * "Zeiterfassung bearbeiten" am Standort der Buchung UND "Stunden einsehen"
 * fuer die Person.
 */
export async function timeReviewers(tx: Tx, orgId: string, record: { userId: string | null; branchId: string | null }): Promise<string[]> {
  const admins = await branchHolders(tx, orgId, null, [], true);
  if (!record.branchId || !record.userId) return admins;
  const [atBranch, forPerson] = await Promise.all([
    branchHolders(tx, orgId, record.branchId, ["EDIT_TIME"], false),
    staffHolders(tx, orgId, record.userId, "VIEW_HOURS"),
  ]);
  const person = new Set(forPerson);
  return [...new Set([...admins, ...atBranch.filter((id) => person.has(id))])].filter((id) => id !== record.userId);
}
