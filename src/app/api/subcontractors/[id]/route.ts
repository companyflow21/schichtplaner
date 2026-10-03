import { api, body, ApiError } from "@/lib/api";
import { db } from "@/lib/db";
import { requireAccess, requireAdmin } from "@/lib/access";
import { subcontractorInput, emitSubcontractorChange } from "@/lib/subcontractors";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  return api(async () => {
    const a = await requireAccess();
    requireAdmin(a);
    const { id } = await context.params;
    const data = await body(request, subcontractorInput.partial());
    const changed = await db.subcontractor.updateMany({ where: { id, organizationId: a.orgId }, data });
    if (!changed.count) throw new ApiError("Subunternehmer nicht gefunden.", 404);
    await emitSubcontractorChange(a.orgId, id);
    return { success: true };
  });
}
