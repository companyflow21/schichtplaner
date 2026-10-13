import { z } from "zod";
import { api, body, ApiError, timeSchema } from "@/lib/api";
import { db } from "@/lib/db";
import { requireAccess, staffIds } from "@/lib/access";
import { validDate, berlinDate, addDate } from "@/lib/berlin";
import { signalBookedSites } from "@/lib/conflicts";

/**
 * Verfuegbarkeiten: eigene immer; fremde nur fuer Admins und fuer Manager,
 * denen die Person mit "Einplanen" zugeordnet ist.
 */
export async function GET(request: Request) {
  return api(async () => {
    const a = await requireAccess();
    const q = new URL(request.url).searchParams;
    const from = q.get("from") || berlinDate();
    const to = q.get("to") || addDate(from, 90);
    if (!validDate(from) || !validDate(to) || from > to) throw new ApiError("Ungültiger Zeitraum.");
    const people = staffIds(a, "ASSIGN_SHIFTS");
    const availabilities = await db.availability.findMany({
      where: { organizationId: a.orgId, ...(people ? { userId: { in: [a.userId, ...people] } } : {}), date: { gte: new Date(from), lte: new Date(to) } },
      include: { member: { select: { user: { select: { firstName: true, lastName: true } } } } },
      orderBy: [{ date: "asc" }, { timeFrom: "asc" }],
    });
    return { availabilities };
  });
}

export async function POST(request: Request) {
  return api(async () => {
    const a = await requireAccess();
    const data = await body(request, z.object({ date: z.string().refine(validDate, "Ungültiges Datum."), timeFrom: timeSchema, timeTo: timeSchema, available: z.boolean(), note: z.string().max(500).optional() }));
    if (data.timeFrom === data.timeTo) throw new ApiError("Beginn und Ende müssen unterschiedlich sein.");
    const availability = await db.availability.create({ data: { ...data, date: new Date(data.date), organizationId: a.orgId, userId: a.userId } });
    // Fenster koennen ueber Mitternacht reichen; eingeteilte Schichten dieser Tage neu pruefen lassen.
    await signalBookedSites(a.orgId, [a.userId], "schedule:updated", { from: data.date, to: addDate(data.date, 1) });
    return { availability };
  });
}

export async function DELETE(request: Request) {
  return api(async () => {
    const a = await requireAccess();
    const { id } = await body(request, z.object({ id: z.string() }));
    const date = (await db.availability.findFirst({ where: { id, organizationId: a.orgId, userId: a.userId }, select: { date: true } }))?.date.toISOString().slice(0, 10);
    const result = await db.availability.deleteMany({ where: { id, organizationId: a.orgId, userId: a.userId } });
    if (!result.count) throw new ApiError("Eintrag nicht gefunden.", 404);
    if (date) await signalBookedSites(a.orgId, [a.userId], "schedule:updated", { from: date, to: addDate(date, 1) });
    return { success: true };
  });
}
