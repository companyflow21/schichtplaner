import { api, serial, ApiError } from "@/lib/api";
import { requireAccess, requireAdmin } from "@/lib/access";
import { archiveBranches, archiveConfirmed, archiveResponse, CUSTOMER_ARCHIVED, requireConfirmation, signalArchive } from "@/lib/archive";

type Context = { params: Promise<{ id: string }> };

/**
 * Einsatzort archivieren (nur Administration). Kuenftige Schichten werden
 * abgesagt, Wochen in Bearbeitung verworfen (lib/archive.ts) - hat das
 * Folgen, zuerst 409 { confirm: true, warnings }, ausgefuehrt erst mit
 * Body { confirm: true }. Laufende und vergangene Schichten, Zeiten,
 * Meldungen und Check-ins bleiben unveraendert; Wiederherstellen mit DELETE.
 */
export async function POST(request: Request, context: Context) {
  return api(async () => {
    const a = await requireAccess();
    requireAdmin(a);
    const { id } = await context.params;
    const confirm = await archiveConfirmed(request);
    const result = await serial(async (tx) => {
      const branch = await tx.branch.findFirst({ where: { id, organizationId: a.orgId }, select: { name: true, archivedAt: true } });
      if (!branch) throw new ApiError("Einsatzort nicht gefunden.", 404);
      if (branch.archivedAt) return null;
      const sites = [{ id, name: branch.name }];
      const done = await archiveBranches(tx, a, sites, "Der Einsatzort „" + branch.name + "“ wurde archiviert.");
      if (!confirm) requireConfirmation(done, sites, false);
      return done;
    }, { retry: true });
    if (result) await signalArchive(a.orgId, result);
    return archiveResponse(result);
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
