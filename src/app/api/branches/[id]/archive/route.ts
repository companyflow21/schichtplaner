import { api, serial, ApiError } from "@/lib/api";
import { requireAccess, requireAdmin } from "@/lib/access";
import { archiveBlockers, CUSTOMER_ARCHIVED } from "@/lib/archive";

type Context = { params: Promise<{ id: string }> };

/**
 * Einsatzort archivieren (nur Administration) - nur ohne laufende oder
 * kuenftige Schichten. Vergangene Schichten, Zeiten, Meldungen und Check-ins
 * bleiben unveraendert; Wiederherstellen mit DELETE.
 */
export async function POST(_request: Request, context: Context) {
  return api(async () => {
    const a = await requireAccess();
    requireAdmin(a);
    const { id } = await context.params;
    await serial(async (tx) => {
      const branch = await tx.branch.findFirst({ where: { id, organizationId: a.orgId }, select: { archivedAt: true } });
      if (!branch) throw new ApiError("Einsatzort nicht gefunden.", 404);
      if (branch.archivedAt) return;
      const blocked = (await archiveBlockers(tx, a.orgId, [id])).get(id);
      if (blocked) throw new ApiError("Archivieren nicht möglich: " + blocked + ".", 409);
      await tx.branch.update({ where: { id }, data: { archivedAt: new Date() } });
    }, { retry: true });
    return { success: true };
  });
}

/** Wiederherstellen - nur, solange der Kunde nicht archiviert ist. */
export async function DELETE(_request: Request, context: Context) {
  return api(async () => {
    const a = await requireAccess();
    requireAdmin(a);
    const { id } = await context.params;
    await serial(async (tx) => {
      const branch = await tx.branch.findFirst({ where: { id, organizationId: a.orgId }, select: { customer: { select: { archivedAt: true } } } });
      if (!branch) throw new ApiError("Einsatzort nicht gefunden.", 404);
      if (branch.customer?.archivedAt) throw new ApiError(CUSTOMER_ARCHIVED, 409);
      await tx.branch.update({ where: { id }, data: { archivedAt: null } });
    }, { retry: true });
    return { success: true };
  });
}
