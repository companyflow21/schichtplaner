import { api, body } from "@/lib/api";
import { db } from "@/lib/db";
import { anyBranchIds, requireAccess, requireAdmin } from "@/lib/access";
import { customerInput } from "@/lib/org-structure";

/** Sichtbare Kunden mit ihren sichtbaren Standorten, ohne Archivierte (Archiv: /api/branches/archive); Kunden sind interne Planungsdaten. */
export async function GET() {
  return api(async () => {
    const a = await requireAccess();
    const ids = anyBranchIds(a);
    const branchWhere = { organizationId: a.orgId, archivedAt: null, ...(ids ? { id: { in: ids } } : {}) };
    const [customers, unassigned] = await Promise.all([
      db.customer.findMany({
        where: { organizationId: a.orgId, archivedAt: null, ...(ids ? { branches: { some: branchWhere } } : {}) },
        orderBy: { name: "asc" },
        select: { id: true, name: true, isActive: true, ...(a.isAdmin ? { notes: true } : {}), branches: { where: branchWhere, orderBy: { name: "asc" }, select: { id: true, name: true, isActive: true } } },
      }),
      db.branch.findMany({ where: { ...branchWhere, customerId: null }, orderBy: { name: "asc" }, select: { id: true, name: true, isActive: true } }),
    ]);
    return { customers, unassigned };
  });
}

export async function POST(request: Request) {
  return api(async () => {
    const a = await requireAccess();
    requireAdmin(a);
    const data = await body(request, customerInput);
    return { customer: await db.customer.create({ data: { organizationId: a.orgId, name: data.name, notes: data.notes || null, isActive: data.isActive ?? true } }) };
  });
}
