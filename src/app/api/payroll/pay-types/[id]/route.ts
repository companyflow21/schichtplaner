import { api, body, ApiError } from "@/lib/api";
import { db } from "@/lib/db";
import { requireAccess, requireAdmin } from "@/lib/access";
import { payTypeInput } from "@/lib/payroll-input";

type Params = { params: Promise<{ id: string }> };

async function own(orgId: string, id: string) {
  const payType = await db.payType.findFirst({ where: { id, organizationId: orgId } });
  if (!payType) throw new ApiError("Lohnart nicht gefunden.", 404);
  return payType;
}

/** Lohnart aendern - nur Admins. Neue Saetze gelten fuer jede Berechnung ab jetzt, auch fuer vergangene Zeitraeume. */
export async function PATCH(request: Request, context: Params) {
  return api(async () => {
    const a = await requireAccess();
    requireAdmin(a);
    const { id } = await context.params;
    await own(a.orgId, id);
    const data = await body(request, payTypeInput.partial());
    if (data.title && await db.payType.findFirst({ where: { organizationId: a.orgId, title: { equals: data.title, mode: "insensitive" }, NOT: { id } }, select: { id: true } })) throw new ApiError("Diese Lohnart gibt es bereits.", 409);
    return { payType: await db.payType.update({ where: { id }, data }) };
  });
}

/** Lohnart loeschen - nur Admins, nur wenn weder Personen noch Arbeitsbereiche sie nutzen. */
export async function DELETE(_request: Request, context: Params) {
  return api(async () => {
    const a = await requireAccess();
    requireAdmin(a);
    const { id } = await context.params;
    await own(a.orgId, id);
    const [people, areas] = await Promise.all([db.organizationMember.count({ where: { payTypeId: id } }), db.division.count({ where: { payTypeId: id } })]);
    if (people || areas) throw new ApiError("Die Lohnart wird noch verwendet (" + people + " Personen, " + areas + " Arbeitsbereiche). Bitte zuerst umstellen oder die Lohnart deaktivieren.", 409);
    await db.payType.delete({ where: { id } });
    return { success: true };
  });
}
