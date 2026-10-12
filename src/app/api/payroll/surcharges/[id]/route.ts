import { api, body, ApiError } from "@/lib/api";
import { db } from "@/lib/db";
import { requireAccess, requireAdmin } from "@/lib/access";
import { checkedSurcharge, surchargeInput } from "@/lib/payroll-input";

type Params = { params: Promise<{ id: string }> };

async function own(orgId: string, id: string) {
  if (!await db.surcharge.findFirst({ where: { id, organizationId: orgId }, select: { id: true } })) throw new ApiError("Zuschlag nicht gefunden.", 404);
}

/** Zuschlag vollstaendig ersetzen - nur Admins. */
export async function PATCH(request: Request, context: Params) {
  return api(async () => {
    const a = await requireAccess();
    requireAdmin(a);
    const { id } = await context.params;
    await own(a.orgId, id);
    const data = await checkedSurcharge(db, a.orgId, await body(request, surchargeInput));
    return { surcharge: await db.surcharge.update({ where: { id }, data }) };
  });
}

export async function DELETE(_request: Request, context: Params) {
  return api(async () => {
    const a = await requireAccess();
    requireAdmin(a);
    const { id } = await context.params;
    await own(a.orgId, id);
    await db.surcharge.delete({ where: { id } });
    return { success: true };
  });
}
