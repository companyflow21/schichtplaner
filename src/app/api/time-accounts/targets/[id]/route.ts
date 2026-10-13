import { api, ApiError } from "@/lib/api";
import { db } from "@/lib/db";
import { requireAccess, requireAdmin } from "@/lib/access";

type Params = { params: Promise<{ id: string }> };

/** Soll-Eintrag loeschen; der Saldo wird danach neu gerechnet. Nur Admins. */
export async function DELETE(_request: Request, context: Params) {
  return api(async () => {
    const a = await requireAccess();
    requireAdmin(a);
    const { id } = await context.params;
    const deleted = await db.targetHours.deleteMany({ where: { id, organizationId: a.orgId } });
    if (!deleted.count) throw new ApiError("Nicht gefunden.", 404);
    return { success: true };
  });
}
