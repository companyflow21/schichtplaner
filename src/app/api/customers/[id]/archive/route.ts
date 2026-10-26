import { api, serial, ApiError } from "@/lib/api";
import { db } from "@/lib/db";
import { requireAccess, requireAdmin } from "@/lib/access";
import { archiveBranches, archiveConfirmed, archiveResponse, requireConfirmation, signalArchive } from "@/lib/archive";

type Context = { params: Promise<{ id: string }> };

/**
 * Kunden archivieren (nur Administration) - mit allen seinen Einsatzorten in
 * einer Transaktion, alles oder nichts. Jeder Einsatzort wie beim einzelnen
 * Archivieren; Folgen (kuenftige Schichten, Wochen in Bearbeitung) nennt die
 * 409 { confirm: true, warnings } je Einsatzort mit Namen, ausgefuehrt erst
 * mit Body { confirm: true }.
 */
export async function POST(request: Request, context: Context) {
  return api(async () => {
    const a = await requireAccess();
    requireAdmin(a);
    const { id } = await context.params;
    const confirm = await archiveConfirmed(request);
    const result = await serial(async (tx) => {
      const customer = await tx.customer.findFirst({
        where: { id, organizationId: a.orgId },
        select: { name: true, archivedAt: true, branches: { where: { archivedAt: null }, orderBy: { name: "asc" }, select: { id: true, name: true } } },
      });
      if (!customer) throw new ApiError("Kunde nicht gefunden.", 404);
      if (customer.archivedAt) return null;
      const done = await archiveBranches(tx, a, customer.branches, "Der Kunde „" + customer.name + "“ wurde archiviert.");
      if (!confirm) requireConfirmation(done, customer.branches, true);
      await tx.customer.update({ where: { id }, data: { archivedAt: done.archivedAt } });
      return done;
    }, { retry: true });
    if (result) await signalArchive(a.orgId, result);
    return archiveResponse(result);
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
