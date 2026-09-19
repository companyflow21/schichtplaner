import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { ApiError, timeSchema } from "./api";
import { checkAssignment, notify, shiftInclude } from "./planning";
import { isoWeek, weekDate, addDate, shiftRange } from "./berlin";
export const shiftInput = z.object({
  scheduleId: z.string().min(1), divisionId: z.string().nullable().optional(), branchId: z.string().nullable().optional(),
  dayOfWeek: z.number().int().min(1).max(7), shiftFrom: timeSchema, shiftTo: timeSchema,
  maxEmployees: z.number().int().min(1).max(100), pauseOption: z.enum(["PER_HOUR", "PER_SHIFT"]).default("PER_SHIFT"),
  pauseValue: z.number().int().min(0).max(120).default(0), title: z.string().max(100).nullable().optional(),
  description: z.string().max(2000).nullable().optional(), requiredQualifications: z.array(z.string().trim().min(1).max(100)).max(30).default([]),
  repeatDays: z.array(z.number().int().min(1).max(7)).max(7).optional(), repeatWeeks: z.number().int().min(1).max(52).default(1)
});
export async function validateShiftLinks(tx: Prisma.TransactionClient, org: string, data: { branchId?: string | null; divisionId?: string | null }) {
  if (data.branchId && !await tx.branch.findFirst({ where: { id: data.branchId, organizationId: org, isActive: true } })) throw new ApiError("Aktiver Einsatzort nicht gefunden.", 404);
  if (data.divisionId && !await tx.division.findFirst({ where: { id: data.divisionId, organizationId: org, deletedAt: null } })) throw new ApiError("Arbeitsbereich nicht gefunden.", 404);
}
export async function createShifts(tx: Prisma.TransactionClient, org: string, actor: string, data: z.output<typeof shiftInput>) {
  if (data.shiftFrom === data.shiftTo) throw new ApiError("Beginn und Ende müssen unterschiedlich sein.");
  const schedule = await tx.schedule.findFirst({ where: { id: data.scheduleId, organizationId: org, deletedAt: null } });
  if (!schedule) throw new ApiError("Plan nicht gefunden.", 404);
  await validateShiftLinks(tx, org, data);
  const { repeatDays, repeatWeeks, ...base } = data;
  const days = [...new Set(repeatDays?.length ? repeatDays : [data.dayOfWeek])];
  const shifts = [];
  for (let w = 0; w < repeatWeeks; w++) {
    const week = isoWeek(addDate(weekDate(schedule.year, schedule.weekNumber), w * 7));
    let target = w === 0 ? schedule : await tx.schedule.findFirst({ where: { organizationId: org, ...week, branchId: null, deletedAt: null } });
    if (!target) target = await tx.schedule.create({ data: { organizationId: org, ...week } });
    for (const dayOfWeek of days) shifts.push(await tx.shift.create({ data: { ...base, scheduleId: target.id, dayOfWeek }, include: shiftInclude }));
    if (target.isPublic) {
      const users = await tx.organizationMember.findMany({ where: { organizationId: org, isActive: true }, select: { userId: true } });
      await notify(tx, org, actor, users.map(u => u.userId), "Neue offene Schichten", "Im veröffentlichten Dienstplan KW " + target.weekNumber + "/" + target.year + " gibt es neue Schichten.");
    }
  }
  return shifts;
}
export async function updateShift(tx: Prisma.TransactionClient, org: string, actor: string, id: string, data: Partial<z.output<typeof shiftInput>>) {
  const existing = await tx.shift.findFirst({ where: { id, deletedAt: null, schedule: { organizationId: org, deletedAt: null } }, include: shiftInclude });
  if (!existing) throw new ApiError("Schicht nicht gefunden.", 404);
  await validateShiftLinks(tx, org, data);
  const effective = { ...existing, ...data };
  if (effective.shiftFrom === effective.shiftTo) throw new ApiError("Beginn und Ende müssen unterschiedlich sein.");
  if (effective.maxEmployees < existing.bookings.length) throw new ApiError("Die Schicht hat mehr Zuweisungen als Plätze.", 409);
  for (const booking of existing.bookings) {
    const warnings = await checkAssignment(tx, effective, booking.userId);
    if (warnings.length) throw new ApiError(booking.user.firstName + ": " + warnings.join(" "), 409);
  }
  const shift = await tx.shift.update({ where: { id }, data, include: shiftInclude });
  await tx.booking.updateMany({ where: { shiftId: id }, data: { confirmedAt: null } });
  if (existing.schedule.isPublic) await notify(tx, org, actor, existing.bookings.map(b => b.userId), "Schicht geändert – bitte bestätigen", shiftRange(shift).date + ", " + shift.shiftFrom + "–" + shift.shiftTo + ". Bitte prüfe Zeit und Einsatzort.", id);
  return shift;
}
