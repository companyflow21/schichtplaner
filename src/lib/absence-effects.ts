import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { db } from "./db";
import { ApiError } from "./errors";
import { addDate, isoWeek, plannedMinutes, shiftRange } from "./berlin";
import { can, type Access } from "./access";

type Tx = Prisma.TransactionClient;
export type Handling = "PAID" | "UNPAID" | "RELEASED";
const handlingSchema = z.enum(["PAID", "UNPAID", "RELEASED"]);
export const effectsSchema = z.object({
  default: handlingSchema.optional(),
  shifts: z.record(z.string(), handlingSchema).optional(),
  compensationHours: z.number().min(-1000).max(1000).optional(),
});
export type EffectsInput = z.output<typeof effectsSchema>;

/** Geplante Schichten einer Person mit Datum im Zeitraum (veroeffentlicht oder Entwurf). */
export async function affectedShifts(tx: Tx, orgId: string, userId: string, from: string, to: string) {
  const weeks = new Map<string, { year: number; weekNumber: number }>();
  for (let d = addDate(from, -1); d <= to; d = addDate(d, 1)) { const w = isoWeek(d); weeks.set(w.year + "-" + w.weekNumber, w); }
  const bookings = await tx.booking.findMany({
    where: { userId, shift: { deletedAt: null, schedule: { organizationId: orgId, deletedAt: null, OR: [...weeks.values()] } } },
    include: { shift: { include: { schedule: { include: { branch: { select: { name: true, customer: { select: { name: true } } } } } }, division: { select: { title: true, color: true } } } } },
  });
  return bookings
    .map((b) => ({ b, range: shiftRange(b.shift) }))
    .filter(({ range }) => range.date >= from && range.date <= to)
    .sort((x, y) => x.range.start - y.range.start)
    .map(({ b, range }) => ({
      shiftId: b.shiftId, date: range.date, from: b.shift.shiftFrom, to: b.shift.shiftTo, plannedMinutes: plannedMinutes(b.shift), title: b.shift.title,
      branchId: b.shift.schedule.branchId, branchName: b.shift.schedule.branch?.name ?? null, customerName: b.shift.schedule.branch?.customer?.name ?? null,
      division: b.shift.division, published: b.shift.schedule.isPublic,
    }));
}

export const defaultHandling = (category: { isPaid: boolean }): Handling => (category.isPaid ? "PAID" : "UNPAID");

/**
 * Wirkung einer genehmigten Abwesenheit auf die Schichten der Person im Zeitraum:
 * je Schicht bezahlt (zaehlt mit Planstunden), unbezahlt (0 Stunden) oder
 * freigegeben (Person wird aus der Schicht genommen, die Schicht ist wieder
 * offen). Bestehende Entscheidungen bleiben, solange nichts anderes angegeben
 * ist. Freigeben braucht das Planungsrecht am Standort. Optional ein Ausgleich
 * auf das Zeitkonto.
 */
export async function applyEffects(tx: Tx, a: Access, absence: { id: string; userId: string; dateFrom: Date; dateTo: Date }, category: { isPaid: boolean; name: string }, input: EffectsInput = {}) {
  const from = absence.dateFrom.toISOString().slice(0, 10), to = absence.dateTo.toISOString().slice(0, 10);
  const shifts = await affectedShifts(tx, a.orgId, absence.userId, from, to);
  const existing = new Map((await tx.absenceShift.findMany({ where: { absenceId: absence.id } })).map((e) => [e.shiftId, e.handling as Handling]));
  const ids = new Set(shifts.map((s) => s.shiftId));
  for (const id of Object.keys(input.shifts ?? {})) if (!ids.has(id)) throw new ApiError("Schicht gehört nicht zu dieser Abwesenheit.", 400);
  const released: { shiftId: string; branchId: string | null }[] = [];
  for (const s of shifts) {
    // Ausdruecklich je Schicht, sonst bisherige Entscheidung, sonst Vorgabe des Dialogs bzw. der Art.
    const handling = input.shifts?.[s.shiftId] ?? existing.get(s.shiftId) ?? input.default ?? defaultHandling(category);
    if (handling === "RELEASED") {
      if (!a.isAdmin && !can(a, "EDIT_SHIFTS", s.branchId)) throw new ApiError("Schichten offen stellen darf nur, wer am Standort Schichten bearbeiten darf.", 403);
      await tx.booking.deleteMany({ where: { shiftId: s.shiftId, userId: absence.userId } });
      released.push({ shiftId: s.shiftId, branchId: s.branchId });
    }
    await tx.absenceShift.upsert({ where: { absenceId_shiftId: { absenceId: absence.id, shiftId: s.shiftId } }, create: { absenceId: absence.id, shiftId: s.shiftId, handling }, update: { handling } });
  }
  // Schichten, die nicht mehr im Zeitraum liegen, verlieren ihre Wirkung; freigegebene bleiben als Verlauf.
  await tx.absenceShift.deleteMany({ where: { absenceId: absence.id, shiftId: { notIn: [...ids] }, handling: { not: "RELEASED" } } });
  if (input.compensationHours) {
    const member = await tx.organizationMember.findFirst({ where: { organizationId: a.orgId, userId: absence.userId }, select: { id: true } });
    if (member) await tx.timeCompensation.create({ data: { organizationId: a.orgId, memberId: member.id, date: absence.dateFrom, minutes: Math.round(input.compensationHours * 60), description: "Abwesenheit " + category.name + " " + from + (to !== from ? " bis " + to : ""), createdById: a.userId } });
  }
  return { shifts: shifts.length, released };
}

export type AbsenceEffect = { handling: Handling; category: string; absenceId: string };

/**
 * Wirkungen genehmigter Abwesenheiten fuer Personen im Zeitraum: je Schicht die
 * Entscheidung und je Person die Abwesenheitstage (fuer Schichten ohne
 * Entscheidung aus der Zeit vor dieser Funktion: abwesend, 0 Stunden).
 */
export async function absenceEffects(orgId: string, userIds: string[], from: string, to: string) {
  const absences = await db.absence.findMany({
    where: { userId: { in: userIds }, status: "APPROVED", category: { organizationId: orgId }, dateFrom: { lte: new Date(to) }, dateTo: { gte: new Date(addDate(from, -1)) } },
    include: { category: { select: { name: true, isPaid: true, payCode: true } }, shiftEffects: true },
  });
  const byShift = new Map<string, AbsenceEffect & { effectId: string; userId: string; payCode: string | null }>();
  const days = new Map<string, { from: string; to: string; category: string }[]>();
  for (const x of absences) {
    for (const e of x.shiftEffects) byShift.set(e.shiftId, { effectId: e.id, handling: e.handling as Handling, category: x.category.name, absenceId: x.id, userId: x.userId, payCode: x.category.payCode });
    days.set(x.userId, [...(days.get(x.userId) ?? []), { from: x.dateFrom.toISOString().slice(0, 10), to: x.dateTo.toISOString().slice(0, 10), category: x.category.name }]);
  }
  const onDay = (userId: string, date: string) => days.get(userId)?.find((d) => d.from <= date && d.to >= date) ?? null;
  return { byShift, onDay };
}

/** Bezahlte Abwesenheitsschichten (Planminuten) je Person im Zeitraum - fuer Lohn und Zeitkonto. */
export async function paidAbsenceShifts(orgId: string, userIds: string[], from: string, to: string) {
  const effects = await db.absenceShift.findMany({
    where: { handling: "PAID", absence: { status: "APPROVED", userId: { in: userIds }, category: { organizationId: orgId } } },
    include: { absence: { select: { userId: true, category: { select: { name: true, payCode: true } } } }, shift: { include: { schedule: true } } },
  });
  return effects
    .filter((e) => !e.shift.deletedAt && !e.shift.schedule.deletedAt)
    .map((e) => ({ id: e.id, userId: e.absence.userId, shiftId: e.shiftId, divisionId: e.shift.divisionId, branchId: e.shift.schedule.branchId, date: shiftRange(e.shift).date, from: e.shift.shiftFrom, to: e.shift.shiftTo, minutes: plannedMinutes(e.shift), category: e.absence.category.name, payCode: e.absence.category.payCode }))
    .filter((e) => e.date >= from && e.date <= to);
}
