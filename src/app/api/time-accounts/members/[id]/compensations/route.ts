import { z } from "zod";
import { api, body, ApiError } from "@/lib/api";
import { db } from "@/lib/db";
import { requireAccess, requireAdmin } from "@/lib/access";
import { validDate } from "@/lib/berlin";

type Params = { params: Promise<{ id: string }> };
const input = z.object({
  date: z.string().refine(validDate, "Ungültiges Datum."),
  hours: z.number().min(-2000).max(2000).refine((v) => v !== 0, "Bitte Stunden ungleich 0 eingeben."),
  description: z.string().trim().min(3, "Bitte eine Beschreibung eingeben.").max(500),
});

/** Ausgleich buchen (z. B. -30 h ausbezahlt, +12 h Anfangssaldo). Nur Admins. */
export async function POST(request: Request, context: Params) {
  return api(async () => {
    const a = await requireAccess();
    requireAdmin(a);
    const { id } = await context.params;
    const data = await body(request, input);
    if (!await db.organizationMember.findFirst({ where: { id, organizationId: a.orgId }, select: { id: true } })) throw new ApiError("Nicht gefunden.", 404);
    const compensation = await db.timeCompensation.create({ data: { organizationId: a.orgId, memberId: id, date: new Date(data.date), minutes: Math.round(data.hours * 60), description: data.description, createdById: a.userId } });
    return Response.json({ compensation }, { status: 201 });
  });
}
