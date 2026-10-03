import { api, body, ApiError } from "@/lib/api";
import { db } from "@/lib/db";
import { requireAccess, requireAdmin } from "@/lib/access";
import { contractorWorkerInput, emitSubcontractorChange } from "@/lib/subcontractors";

export async function PATCH(request: Request, context: { params: Promise<{ id: string; workerId: string }> }) {
  return api(async () => {
    const a = await requireAccess();
    requireAdmin(a);
    const { id, workerId } = await context.params;
    const data = await body(request, contractorWorkerInput.partial());
    const changed = await db.contractorWorker.updateMany({ where: { id: workerId, subcontractorId: id, organizationId: a.orgId }, data });
    if (!changed.count) throw new ApiError("Platzhalter nicht gefunden.", 404);
    await emitSubcontractorChange(a.orgId, id);
    return { success: true };
  });
}
