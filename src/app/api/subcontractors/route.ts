import { api, body } from "@/lib/api";
import { db } from "@/lib/db";
import { requireAccess, requireAdmin } from "@/lib/access";
import { subcontractorInput, emitSubcontractorChange } from "@/lib/subcontractors";

export async function GET() {
  return api(async () => {
    const a = await requireAccess();
    requireAdmin(a);
    return { subcontractors: await db.subcontractor.findMany({
      where: { organizationId: a.orgId }, orderBy: { name: "asc" },
      select: { id: true, name: true, isActive: true, workers: {
        orderBy: { name: "asc" }, select: { id: true, name: true, isActive: true },
      } },
    }) };
  });
}

export async function POST(request: Request) {
  return api(async () => {
    const a = await requireAccess();
    requireAdmin(a);
    const data = await body(request, subcontractorInput);
    const subcontractor = await db.subcontractor.create({ data: { ...data, organizationId: a.orgId } });
    await emitSubcontractorChange(a.orgId);
    return { subcontractor };
  });
}
