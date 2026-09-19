import { z } from "zod";
import type { Prisma, TimeRecord } from "@prisma/client";
import { ApiError, timeSchema } from "./api";
import { validDate, rangeMinutes } from "./berlin";
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
export async function validatedTimeChange(tx: Prisma.TransactionClient, org: string, record: TimeRecord, data: z.output<typeof timeChange>) {
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
