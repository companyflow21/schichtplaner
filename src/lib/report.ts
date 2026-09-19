import { db } from "./db";
import { berlinDate, recordMinutes, weekDate, rangeMinutes, isoWeek, addDate } from "./berlin";
export async function monthlyReport(org: string, month: number, year: number, userId?: string) {
  const first = year + "-" + String(month).padStart(2, "0") + "-01";
  const last = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
  const people = await db.organizationMember.findMany({ where: { organizationId: org, ...(userId ? { userId } : {}) }, include: { user: { select: { id: true, firstName: true, lastName: true, profileImage: true } } } });
  const records = await db.timeRecord.findMany({ where: { organizationId: org, ...(userId ? { userId } : {}), date: { gte: new Date(first), lte: new Date(last) } } });
  const bookings = await db.booking.findMany({ where: { ...(userId ? { userId } : {}), shift: { deletedAt: null, schedule: { organizationId: org, deletedAt: null, isPublic: true, year: { gte: year - 1, lte: year + 1 } } } }, include: { shift: { include: { schedule: true } } } });
  const weeks = new Map<number, { weekNumber: number; label: string }>();
  let weekdays = 0;
  for (let d = first; d <= last; d = addDate(d, 1)) { const week = isoWeek(d); weeks.set(week.weekNumber, { weekNumber: week.weekNumber, label: "KW " + week.weekNumber }); const day = new Date(d).getUTCDay(); if (day > 0 && day < 6) weekdays++; }
  const employees = people.map(p => {
    const own = records.filter(t => t.userId === p.userId);
    const shifts = bookings.filter(b => b.userId === p.userId && (() => { const d = weekDate(b.shift.schedule.year, b.shift.schedule.weekNumber, b.shift.dayOfWeek); return d >= first && d <= last; })());
    const totalMinutes = own.reduce((sum, r) => sum + recordMinutes(r), 0);
    const plannedMinutes = shifts.reduce((sum, b) => { const s = b.shift, gross = rangeMinutes(s.shiftFrom, s.shiftTo); return sum + Math.max(0, gross - (s.pauseOption === "PER_HOUR" ? Math.floor(gross / 60) * s.pauseValue : s.pauseValue)); }, 0);
    const targetMinutes = Math.round(p.targetHoursPerWeek / 5 * weekdays * 60);
    return { userId: p.userId, ...p.user, totalMinutes, plannedMinutes, targetMinutes, deviationMinutes: totalMinutes - plannedMinutes, shiftCount: shifts.length, kwBreakdown: [...weeks.values()].map(w => ({ weekNumber: w.weekNumber, totalMinutes: own.filter(r => isoWeek(r.date.toISOString().slice(0,10)).weekNumber === w.weekNumber).reduce((sum, r) => sum + recordMinutes(r), 0), shiftCount: shifts.filter(b => b.shift.schedule.weekNumber === w.weekNumber).length })) };
  });
  employees.sort((a,b) => a.lastName.localeCompare(b.lastName, "de"));
  return { month, year, kwHeaders: [...weeks.values()], employees, totals: { totalMinutes: employees.reduce((s,e) => s + e.totalMinutes, 0), totalShifts: employees.reduce((s,e) => s + e.shiftCount, 0) } };
}
export function reportPeriod(request: Request) {
  const q = new URL(request.url).searchParams, today = berlinDate();
  return { month: Number(q.get("month") || today.slice(5,7)), year: Number(q.get("year") || today.slice(0,4)) };
}
