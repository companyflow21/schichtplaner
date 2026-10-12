import { z } from "zod";
import { api, body, ApiError } from "@/lib/api";
import { db } from "@/lib/db";
import { requireAccess, requireAdmin } from "@/lib/access";
import { checkedPayType } from "@/lib/payroll-input";

type Params = { params: Promise<{ id: string }> };

/** Abweichende Lohnart eines Arbeitsbereichs - nur Admins. null = Lohnart der Person. */
export async function PATCH(request: Request, context: Params) {
  return api(async () => {
    const a = await requireAccess();
    requireAdmin(a);
    const { id } = await context.params;
    const data = await body(request, z.object({ payTypeId: z.string().min(1).nullable() }));
    if (!await db.division.findFirst({ where: { id, organizationId: a.orgId, deletedAt: null }, select: { id: true } })) throw new ApiError("Arbeitsbereich nicht gefunden.", 404);
    const division = await db.division.update({ where: { id }, data: { payTypeId: await checkedPayType(db, a.orgId, data.payTypeId) }, select: { id: true, payTypeId: true } });
    return { division };
  });
}
