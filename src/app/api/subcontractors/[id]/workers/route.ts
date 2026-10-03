import { api, body, serial, ApiError } from "@/lib/api";
import { requireAccess, requireAdmin } from "@/lib/access";
import { contractorWorkerInput, emitSubcontractorChange } from "@/lib/subcontractors";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return api(async () => {
    const a = await requireAccess();
    requireAdmin(a);
    const { id } = await context.params;
    const data = await body(request, contractorWorkerInput);
    const worker = await serial(async tx => {
      const parent = await tx.subcontractor.findFirst({ where: { id, organizationId: a.orgId } });
      if (!parent) throw new ApiError("Subunternehmer nicht gefunden.", 404);
      if (!parent.isActive) throw new ApiError("Der Subunternehmer ist inaktiv. Bitte zuerst aktivieren.", 409);
      return tx.contractorWorker.create({ data: { ...data, subcontractorId: id, organizationId: a.orgId } });
    }, { retry: true });
    await emitSubcontractorChange(a.orgId);
    return { worker };
  });
}
