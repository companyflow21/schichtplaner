import { z } from "zod";
import { api, body, ApiError } from "@/lib/api";
import { db } from "@/lib/db";
import { requireAccess, requireAdmin } from "@/lib/access";
import { checkedPayType } from "@/lib/payroll-input";

type Params = { params: Promise<{ id: string }> };
const input = z.object({
  personnelNumber: z.string().trim().max(30).nullable().optional().transform((v) => (v === undefined ? undefined : v || null)),
  payTypeId: z.string().min(1).nullable().optional(),
});

/** Personalnummer und Standard-Lohnart einer Person - nur Admins. */
export async function PATCH(request: Request, context: Params) {
  return api(async () => {
    const a = await requireAccess();
    requireAdmin(a);
    const { id } = await context.params;
    const data = await body(request, input);
    if (!await db.organizationMember.findFirst({ where: { id, organizationId: a.orgId }, select: { id: true } })) throw new ApiError("Nicht gefunden.", 404);
    if (data.personnelNumber && await db.organizationMember.findFirst({ where: { organizationId: a.orgId, personnelNumber: data.personnelNumber, NOT: { id } }, select: { id: true } })) throw new ApiError("Diese Personalnummer ist bereits vergeben.", 409);
    const payTypeId = data.payTypeId === undefined ? undefined : await checkedPayType(db, a.orgId, data.payTypeId);
    const member = await db.organizationMember.update({ where: { id }, data: { personnelNumber: data.personnelNumber, payTypeId }, select: { id: true, personnelNumber: true, payTypeId: true } });
    return { member };
  });
}
