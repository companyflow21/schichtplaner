import { z } from "zod";
import { api, body, requireMember, ApiError, timeSchema } from "@/lib/api";
import { db } from "@/lib/db";
import { isManagerOrAbove } from "@/lib/auth-helpers";
import { validDate, berlinDate, addDate } from "@/lib/berlin";
export async function GET(request: Request) {
  return api(async () => {
    const m = await requireMember();
    const q = new URL(request.url).searchParams;
    const from = q.get("from") || berlinDate();
    const to = q.get("to") || addDate(from, 90);
    if (!validDate(from) || !validDate(to) || from > to) throw new ApiError("Ungültiger Zeitraum.");
    return { availabilities: await db.availability.findMany({ where: { organizationId: m.organizationId, ...(!isManagerOrAbove(m.role) ? { userId: m.userId } : {}), date: { gte: new Date(from), lte: new Date(to) } }, include: { member: { select: { user: { select: { firstName: true, lastName: true } } } } }, orderBy: [{ date: "asc" }, { timeFrom: "asc" }] }) };
  });
}
export async function POST(request: Request) {
  return api(async () => {
    const m = await requireMember();
    const data = await body(request, z.object({ date: z.string().refine(validDate, "Ungültiges Datum."), timeFrom: timeSchema, timeTo: timeSchema, available: z.boolean(), note: z.string().max(500).optional() }));
    if (data.timeFrom === data.timeTo) throw new ApiError("Beginn und Ende müssen unterschiedlich sein.");
    return { availability: await db.availability.create({ data: { ...data, date: new Date(data.date), organizationId: m.organizationId, userId: m.userId } }) };
  });
}
export async function DELETE(request: Request) {
  return api(async () => {
    const m = await requireMember();
    const { id } = await body(request, z.object({ id: z.string() }));
    const result = await db.availability.deleteMany({ where: { id, organizationId: m.organizationId, userId: m.userId } });
    if (!result.count) throw new ApiError("Eintrag nicht gefunden.", 404);
    return { success: true };
  });
}
