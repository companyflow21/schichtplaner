import { api, body } from "@/lib/api";
import { db } from "@/lib/db";
import { requireAccess, requireAdmin } from "@/lib/access";
import { checkedSurcharge, surchargeInput } from "@/lib/payroll-input";

/** Zuschlag anlegen - nur Admins. */
export async function POST(request: Request) {
  return api(async () => {
    const a = await requireAccess();
    requireAdmin(a);
    const data = await checkedSurcharge(db, a.orgId, await body(request, surchargeInput));
    const surcharge = await db.surcharge.create({ data: { ...data, organizationId: a.orgId } });
    return Response.json({ surcharge }, { status: 201 });
  });
}
