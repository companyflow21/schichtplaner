import { api, serial, ApiError } from "@/lib/api";
import { db } from "@/lib/db";
import { requireAccess, requireAdmin } from "@/lib/access";
import { archiveBlockers } from "@/lib/archive";

type Context = { params: Promise<{ id: string }> };

/**
 * Kunden archivieren (nur Administration) - mit allen seinen Einsatzorten in
 * einer Transaktion. Jeder Einsatzort wird wie beim einzelnen Archivieren
 * geprueft; scheitert einer, bleibt alles unveraendert (409 mit den Namen).
 */
export async function POST(_request: Request, context: Context) {
  return api(async () => {
    const a = await requireAccess();
    requireAdmin(a);
    const { id } = await context.params;
    const archived = await serial(async (tx) => {
      const customer = await tx.customer.findFirst({
        where: { id, organizationId: a.orgId },
        select: { archivedAt: true, branches: { where: { archivedAt: null }, orderBy: { name: "asc" }, select: { id: true, name: true } } },
      });
      if (!customer) throw new ApiError("Kunde nicht gefunden.", 404);
      if (customer.archivedAt) return 0;
      const blocked = await archiveBlockers(tx, a.orgId, customer.branches.map((b) => b.id));
      if (blocked.size) {
        throw new ApiError("Archivieren nicht möglich: " + customer.branches.filter((b) => blocked.has(b.id)).map((b) => b.name + " (" + blocked.get(b.id) + ")").join(", ") + ".", 409);
      }
      const now = new Date();
      await tx.branch.updateMany({ where: { id: { in: customer.branches.map((b) => b.id) } }, data: { archivedAt: now } });
      await tx.customer.update({ where: { id }, data: { archivedAt: now } });
      return customer.branches.length;
    }, { retry: true });
    return { success: true, branchesArchived: archived };
  });
}

/** Kunden wiederherstellen; seine Einsatzorte bleiben archiviert und werden einzeln wiederhergestellt. */
export async function DELETE(_request: Request, context: Context) {
  return api(async () => {
    const a = await requireAccess();
    requireAdmin(a);
    const { id } = await context.params;
    const result = await db.customer.updateMany({ where: { id, organizationId: a.orgId }, data: { archivedAt: null } });
    if (!result.count) throw new ApiError("Kunde nicht gefunden.", 404);
    return { success: true };
  });
}
