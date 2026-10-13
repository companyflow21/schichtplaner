import { api, body, ApiError } from "@/lib/api";
import { db } from "@/lib/db";
import { requireAccess, requireAdmin } from "@/lib/access";
import { payTypeInput } from "@/lib/payroll-input";

/** Lohnart anlegen - nur Admins. Titel eindeutig je Organisation. */
export async function POST(request: Request) {
  return api(async () => {
    const a = await requireAccess();
    requireAdmin(a);
    const data = await body(request, payTypeInput);
    if (await db.payType.findFirst({ where: { organizationId: a.orgId, title: { equals: data.title, mode: "insensitive" } }, select: { id: true } })) throw new ApiError("Diese Lohnart gibt es bereits.", 409);
    const payType = await db.payType.create({ data: { ...data, organizationId: a.orgId } });
    return Response.json({ payType }, { status: 201 });
  });
}
