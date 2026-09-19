import { api, requireMember, serial, ApiError } from "@/lib/api";
import { isManagerOrAbove } from "@/lib/auth-helpers";
import { shiftInclude } from "@/lib/planning";
export async function GET(request: Request) {
  return api(async () => {
    const m = await requireMember();
    const q = new URL(request.url).searchParams;
    const weekNumber = Number(q.get("kw")), year = Number(q.get("year"));
    if (!Number.isInteger(weekNumber) || weekNumber < 1 || weekNumber > 53 || !Number.isInteger(year) || year < 2000 || year > 2100) throw new ApiError("Ungültige Kalenderwoche.");
    const manager = isManagerOrAbove(m.role);
    return serial(async tx => {
      const where = { organizationId: m.organizationId, weekNumber, year, branchId: null, deletedAt: null };
      let schedule = await tx.schedule.findFirst({ where });
      if (!schedule && manager) schedule = await tx.schedule.create({ data: { organizationId: m.organizationId, weekNumber, year } });
      if (!schedule || (!manager && !schedule.isPublic)) return { schedule: { id: "", organizationId: m.organizationId, weekNumber, year, isPublic: false, settingsLayout: "LAYOUT_1", showTitle: true, showPauses: true, shifts: [] } };
      const shifts = await tx.shift.findMany({ where: { scheduleId: schedule.id, deletedAt: null }, include: shiftInclude, orderBy: [{ dayOfWeek: "asc" }, { shiftFrom: "asc" }] });
      return { schedule: { ...schedule, shifts: shifts.map(s => ({ ...s, bookings: !manager && m.organization.scheduleVisibility === "OWN_ONLY" ? s.bookings.filter(b => b.userId === m.userId) : s.bookings, occupiedCount: s.bookings.length })) } };
    });
  });
}
