import type { Prisma } from "@prisma/client";
import { ApiError } from "./errors";
import { addDate, minuteOfDay, overlaps, rangeMinutes, shiftRange } from "./berlin";
import { assertCan, type Access } from "./access";
import { isFuture } from "./shift-requests";
import { lastShiftDate, personIds, shiftInclude, type ShiftWithRelations } from "./planning";

type Tx = Prisma.TransactionClient;

export type ShiftDeletion = { deletable: boolean; reason: string | null; assignments: number; openRequests: number };

/** Offene Antraege, die diese Schicht als eigene oder als Gegen-Schicht nennen. */
export function openRequestsOf(shiftId: string): Prisma.ModRequestWhereInput {
  return { OR: [{ shiftId }, { targetShiftId: shiftId }] };
}

/** Schicht der Organisation laden und das Recht "Schichten bearbeiten" am Standort pruefen (404 sonst). */
export async function loadShiftForDelete(tx: Tx, a: Access, id: string): Promise<ShiftWithRelations> {
  const shift = await tx.shift.findFirst({ where: { id, deletedAt: null, schedule: { organizationId: a.orgId, deletedAt: null } }, include: shiftInclude });
  if (!shift) throw new ApiError("Schicht nicht gefunden.", 404);
  assertCan(a, "EDIT_SHIFTS", shift.schedule.branchId);
  return shift;
}

/**
 * Darf die Schicht geloescht werden? Nur wenn sie noch nicht begonnen hat
 * (Ortszeit Europe/Berlin) und es weder einen Check-in noch erfasste Zeiten
 * gibt. Begonnene und vergangene Schichten bleiben als Nachweis erhalten -
 * auch fuer die Administration. Zeiten gelten konservativ als zugehoerig,
 * wenn sie sich mit dem Schichtfenster ueberschneiden (Personen der Schicht,
 * Standort der Schicht oder ohne Standort); Zeiten ohne Uhrzeiten zaehlen
 * mit dem ganzen Kalendertag.
 */
export async function shiftDeletion(tx: Tx, orgId: string, shift: ShiftWithRelations): Promise<ShiftDeletion> {
  const openRequests = await tx.modRequest.count({ where: { AND: [openRequestsOf(shift.id), { state: "OPEN", shift: { schedule: { organizationId: orgId } } }] } });
  const base = { assignments: shift.bookings.length, openRequests };
  const blocked = (reason: string): ShiftDeletion => ({ deletable: false, reason, ...base });
  if (!isFuture(shift)) return blocked("Die Schicht hat bereits begonnen oder ist vorbei – sie bleibt als Nachweis erhalten.");
  // Jeder Check-in zaehlt (auch abgelehnte und ersetzte): er belegt die Schicht.
  if (await tx.checkin.count({ where: { shiftId: shift.id } })) return blocked("Für diese Schicht gibt es bereits einen Check-in.");
  const linked = await tx.timeRecord.count({ where: { organizationId: orgId, checkin: { shiftId: shift.id } } });
  if (linked || await timeOverlaps(tx, orgId, shift)) return blocked("Für diese Schicht wurden bereits Arbeitszeiten erfasst.");
  return { deletable: true, reason: null, ...base };
}

async function timeOverlaps(tx: Tx, orgId: string, shift: ShiftWithRelations): Promise<boolean> {
  const users = personIds(shift.bookings);
  if (!users.length) return false;
  const range = shiftRange(shift);
  const records = await tx.timeRecord.findMany({
    where: {
      organizationId: orgId, userId: { in: users },
      OR: [{ branchId: shift.schedule.branchId }, { branchId: null }],
      // Vortag mitladen: eine Buchung kann ueber Mitternacht in die Schicht reichen.
      date: { gte: new Date(addDate(range.date, -1) + "T00:00:00Z"), lte: new Date(lastShiftDate(shift) + "T00:00:00Z") },
    },
    select: { date: true, timeFrom: true, timeTo: true },
  });
  return records.some((r) => {
    const dayStart = r.date.getTime() / 60000;
    if (!r.timeFrom || !r.timeTo) return overlaps({ start: dayStart, end: dayStart + 1440 }, range);
    const start = dayStart + minuteOfDay(r.timeFrom);
    return overlaps({ start, end: start + (rangeMinutes(r.timeFrom, r.timeTo) || 1440) }, range);
  });
}
