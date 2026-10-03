import { api, ApiError } from "@/lib/api";
import { db } from "@/lib/db";
import { requireAccess, requireAdmin } from "@/lib/access";
import { berlinDate, shiftRange, overlaps } from "@/lib/berlin";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return api(async () => {
    const a = await requireAccess();
    requireAdmin(a);
    const { id } = await context.params;
    const parent = await db.subcontractor.findFirst({ where: { id, organizationId: a.orgId }, select: { id: true } });
    if (!parent) throw new ApiError("Subunternehmer nicht gefunden.", 404);
    const month = new URL(request.url).searchParams.get("month") ?? berlinDate().slice(0, 7);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || Number(month.slice(0, 4)) < 1900 || Number(month.slice(0, 4)) > 2200) throw new ApiError("Monat bitte als JJJJ-MM angeben.", 400);
    const year = Number(month.slice(0, 4));
    const start = Date.parse(month + "-01T00:00:00Z") / 60000;
    const end = Date.UTC(year, Number(month.slice(5, 7)), 1) / 60000;
    const bookings = await db.booking.findMany({
      where: { contractorWorker: { subcontractorId: id, organizationId: a.orgId }, shift: {
        deletedAt: null, schedule: { organizationId: a.orgId, deletedAt: null, year: { gte: year - 1, lte: year + 1 } },
      } },
      include: { contractorWorker: { select: { name: true } }, shift: { include: { schedule: { include: { branch: { select: { name: true } } } } } } },
    });
    const assignments = bookings.filter(b => overlaps(shiftRange(b.shift), { start, end })).map(b => ({
      id: b.id, contractorWorkerId: b.contractorWorkerId!, workerName: b.contractorWorker!.name,
      shiftId: b.shiftId, date: shiftRange(b.shift).date, shiftFrom: b.shift.shiftFrom, shiftTo: b.shift.shiftTo,
      title: b.shift.title, branchName: b.shift.schedule.branch?.name ?? null, isPublic: b.shift.schedule.isPublic,
    })).sort((x, y) => x.date.localeCompare(y.date) || x.shiftFrom.localeCompare(y.shiftFrom) || x.workerName.localeCompare(y.workerName, "de"));
    return { month, assignments };
  });
}
