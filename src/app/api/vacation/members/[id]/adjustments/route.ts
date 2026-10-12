import { z } from "zod";
import { api, body, ApiError } from "@/lib/api";
import { db } from "@/lib/db";
import { requireAccess, requireAdmin } from "@/lib/access";
import { validDate } from "@/lib/berlin";

type Params = { params: Promise<{ id: string }> };
const input = z.object({
  date: z.string().refine(validDate, "Ungültiges Datum."),
  days: z.number().min(-366).max(366).refine((v) => v !== 0 && Math.round(v * 2) === v * 2, "Bitte ganze oder halbe Tage ungleich 0 eingeben."),
  comment: z.string().trim().min(3, "Bitte einen Kommentar eingeben.").max(500),
});

/** Urlaubskonto korrigieren (± Tage), z. B. bereits genommener Urlaub oder Resturlaub bei Einfuehrung. Nur Admins. */
export async function POST(request: Request, context: Params) {
  return api(async () => {
    const a = await requireAccess();
    requireAdmin(a);
    const { id } = await context.params;
    const data = await body(request, input);
    if (!await db.organizationMember.findFirst({ where: { id, organizationId: a.orgId }, select: { id: true } })) throw new ApiError("Nicht gefunden.", 404);
    const adjustment = await db.vacationAdjustment.create({ data: { organizationId: a.orgId, memberId: id, date: new Date(data.date), days: data.days, comment: data.comment, createdById: a.userId } });
    return Response.json({ adjustment }, { status: 201 });
  });
}
