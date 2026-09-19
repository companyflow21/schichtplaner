import { api, requireMember } from "@/lib/api";
import { db } from "@/lib/db";
import { isManagerOrAbove } from "@/lib/auth-helpers";
import { berlinDate, addDate, shiftRange, berlinTime, minuteOfDay } from "@/lib/berlin";
import { checkAssignment, shiftInclude } from "@/lib/planning";
import { monthlyReport } from "@/lib/report";
export async function GET() {
  return api(async () => {
    const m = await requireMember(), manager = isManagerOrAbove(m.role), today = berlinDate();
    const year = Number(today.slice(0,4));
    const shifts = await db.shift.findMany({ where: { deletedAt: null, schedule: { organizationId: m.organizationId, deletedAt: null, year: { gte: year - 1, lte: year + 1 }, ...(!manager ? { isPublic: true } : {}) } }, include: shiftInclude });
    const now = Date.parse(today) / 60000 + minuteOfDay(berlinTime());
    const dated = shifts.map(s => ({ ...s, ...shiftRange(s) })).sort((a,b) => a.start - b.start);
    const relevant = dated.filter(s => s.end > now && s.date <= addDate(today, 60));
    const own = relevant.filter(s => s.bookings.some(b => b.userId === m.userId));
    const open = [];
    for (const s of relevant.filter(s => s.schedule.isPublic && s.bookings.length < s.maxEmployees)) if (manager || !(await checkAssignment(db, s, m.userId)).length) open.push(s);
    const absences = await db.absence.findMany({ where: { category: { organizationId: m.organizationId }, ...(manager ? {} : { userId: m.userId }), OR: [{ status: "PENDING" }, { status: "APPROVED", dateFrom: { lte: new Date(today) }, dateTo: { gte: new Date(today) } }] }, include: { user: { select: { firstName: true, lastName: true } }, category: true }, orderBy: { dateFrom: "asc" } });
    const reports = await monthlyReport(m.organizationId, Number(today.slice(5,7)), year, manager ? undefined : m.userId);
    const unread = await db.messageRecipient.count({ where: { userId: m.userId, isRead: false, isDeleted: false, message: { organizationId: m.organizationId } } });
    const sanitize = (s: (typeof relevant)[number]) => ({ ...s, occupiedCount: s.bookings.length, bookings: manager ? s.bookings : s.bookings.filter(b => b.userId === m.userId) });
    return { manager, firstName: m.user.firstName, userId: m.userId, today, own: own.map(sanitize), todayShifts: dated.filter(s => s.date === today || (s.date < today && s.end > Date.parse(today) / 60000)).filter(s => manager || s.bookings.some(b => b.userId === m.userId)).map(sanitize), open: open.map(sanitize), unconfirmed: manager ? relevant.reduce((count,s) => count + (s.schedule.isPublic ? s.bookings.filter(b => !b.confirmedAt).length : 0), 0) : own.reduce((count,s) => count + s.bookings.filter(b => b.userId === m.userId && !b.confirmedAt).length, 0), absences, reports, unread };
  });
}
