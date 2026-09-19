import type { Prisma, Shift, Schedule } from "@prisma/client";
import { ApiError } from "./api";
import { addDate, overlaps, rangeMinutes, shiftRange } from "./berlin";

export const publicUser = { id: true, firstName: true, lastName: true, nickname: true, profileImage: true } as const;
export const shiftInclude = { schedule: true, branch: true, division: true, bookings: { include: { user: { select: publicUser } } } } as const;
export type PlannedShift = Shift & { schedule: Schedule };

export async function checkAssignment(tx: Prisma.TransactionClient, shift: PlannedShift, userId: string, excludeShiftId = shift.id): Promise<string[]> {
  const member = await tx.organizationMember.findUnique({ where: { organizationId_userId: { organizationId: shift.schedule.organizationId, userId } } });
  if (!member?.isActive) return ["Mitarbeiter ist nicht aktiv."];
  const warnings: string[] = [];
  if (shift.branchId) {
    const branch = await tx.branch.findUnique({ where: { id: shift.branchId } });
    if (!branch?.isActive) warnings.push("Einsatzort ist nicht aktiv.");
    if (branch?.positions.length && !branch.positions.some(p => p.toLocaleLowerCase("de-DE") === member.position?.toLocaleLowerCase("de-DE"))) warnings.push("Tätigkeit passt nicht zum Einsatzort.");
  }
  const qualifications = new Set(member.qualifications.map(q => q.toLocaleLowerCase("de-DE")));
  if (shift.divisionId) {
    const division = await tx.division.findUnique({ where: { id: shift.divisionId }, include: { members: true } });
    if (division && !division.isSystem && division.members.length && !division.members.some(m => m.userId === userId)) warnings.push("Mitarbeiter gehört nicht zum Arbeitsbereich.");
  }
  if (shift.requiredQualifications.some(q => !qualifications.has(q.toLocaleLowerCase("de-DE")))) warnings.push("Erforderliche Qualifikation fehlt.");
  const range = shiftRange(shift);
  const lastDate = rangeMinutes(shift.shiftFrom, shift.shiftTo) + Number(shift.shiftFrom.slice(0, 2)) * 60 + Number(shift.shiftFrom.slice(3)) > 1440 ? addDate(range.date, 1) : range.date;
  const absences = await tx.absence.count({ where: { userId, status: "APPROVED", category: { organizationId: shift.schedule.organizationId }, dateFrom: { lte: new Date(lastDate) }, dateTo: { gte: new Date(range.date) } } });
  if (absences) warnings.push("Genehmigte Abwesenheit überschneidet sich mit der Schicht.");
  const bookings = await tx.booking.findMany({ where: { userId, shiftId: { not: excludeShiftId }, shift: { deletedAt: null, schedule: { deletedAt: null, organizationId: shift.schedule.organizationId, year: { gte: shift.schedule.year - 1, lte: shift.schedule.year + 1 } } } }, include: { shift: { include: { schedule: true } } } });
  if (bookings.some(b => overlaps(range, shiftRange(b.shift)))) warnings.push("Zeitliche Überschneidung mit einer anderen Schicht.");
  const windows = await tx.availability.findMany({ where: { organizationId: shift.schedule.organizationId, userId, date: { gte: new Date(addDate(range.date, -1)), lte: new Date(addDate(range.date, 1)) } } });
  const normalized = windows.map(w => { const start = w.date.getTime() / 60000 + Number(w.timeFrom.slice(0, 2)) * 60 + Number(w.timeFrom.slice(3)); return { ...w, start, end: start + rangeMinutes(w.timeFrom, w.timeTo) }; });
  if (normalized.some(w => !w.available && overlaps(range, w))) warnings.push("Als nicht verfügbar eingetragen.");
  for (const day of [range.date, ...(lastDate !== range.date ? [lastDate] : [])]) {
    const start = Date.parse(day) / 60000, end = start + 1440;
    const segment = { start: Math.max(start, range.start), end: Math.min(end, range.end) };
    const available = normalized.filter(w => w.available && overlaps({ start, end }, w)).sort((a,b) => a.start - b.start);
    if (available.length) {
      let covered = segment.start;
      for (const w of available) if (w.start <= covered) covered = Math.max(covered, w.end);
      if (covered < segment.end) warnings.push("Schicht liegt außerhalb der eingetragenen Verfügbarkeit.");
    }
  }
  return warnings;
}

export async function notify(tx: Prisma.TransactionClient, organizationId: string, senderId: string, recipientIds: string[], subject: string, text: string, shiftId?: string) {
  const ids = [...new Set(recipientIds)];
  if (!ids.length) return;
  await tx.message.create({ data: { organizationId, senderId, subject, body: text, shiftId, recipients: { create: ids.map(userId => ({ userId })) } } });
}
export async function planners(tx: Prisma.TransactionClient, organizationId: string) {
  const members = await tx.organizationMember.findMany({ where: { organizationId, isActive: true, role: { in: ["OWNER", "ADMIN", "MANAGER"] } }, select: { userId: true } });
  return members.map(m => m.userId);
}
export async function assign(tx: Prisma.TransactionClient, org: string, actor: string, shiftId: string, userId: string) {
  const shift = await tx.shift.findFirst({ where: { id: shiftId, deletedAt: null, schedule: { organizationId: org, deletedAt: null } }, include: shiftInclude });
  if (!shift) throw new ApiError("Schicht nicht gefunden.", 404);
  if (shift.bookings.some(b => b.userId === userId)) throw new ApiError("Bereits zugewiesen.", 409);
  if (shift.bookings.length >= shift.maxEmployees) throw new ApiError("Schicht ist bereits besetzt.", 409);
  const warnings = await checkAssignment(tx, shift, userId);
  if (warnings.length) throw new ApiError(warnings.join(" "), 409);
  const booking = await tx.booking.create({ data: { shiftId, userId, bookedBy: actor }, include: { user: { select: publicUser } } });
  if (shift.schedule.isPublic) await notify(tx, org, actor, [userId], "Neue Schicht", shiftRange(shift).date + ": " + shift.shiftFrom + "–" + shift.shiftTo + ". Bitte bestätigen.", shiftId);
  return booking;
}
