import { z } from "zod";
import { api, body, ApiError } from "@/lib/api";
import { db } from "@/lib/db";
import { requireAccess, requireAdmin } from "@/lib/access";
import { validDate } from "@/lib/berlin";

type Params = { params: Promise<{ id: string }> };
const input = z.object({
  startDate: z.string().refine(validDate, "Ungültiges Startdatum."),
  hours: z.number().min(0).max(744, "Höchstens 744 Stunden."),
  period: z.enum(["WEEK", "MONTH"]),
});

/** Soll ab Startdatum anlegen; gilt bis zum naechsten Eintrag. Gleiches Startdatum ersetzt den Wert. Nur Admins. */
export async function POST(request: Request, context: Params) {
  return api(async () => {
    const a = await requireAccess();
    requireAdmin(a);
    const { id } = await context.params;
    const data = await body(request, input);
    if (!await db.organizationMember.findFirst({ where: { id, organizationId: a.orgId }, select: { id: true } })) throw new ApiError("Nicht gefunden.", 404);
    const minutes = Math.round(data.hours * 60), startDate = new Date(data.startDate);
    const target = await db.targetHours.upsert({
      where: { memberId_startDate: { memberId: id, startDate } },
      create: { organizationId: a.orgId, memberId: id, startDate, minutes, period: data.period },
      update: { minutes, period: data.period },
    });
    return Response.json({ target }, { status: 201 });
  });
}
