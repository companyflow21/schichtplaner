import { api, serial, ApiError } from "@/lib/api";
import { requireAccess, requireAdmin } from "@/lib/access";
import { branchHasHistory } from "@/lib/archive";

/**
 * Einsatzort endgueltig loeschen - auch archiviert - nur solange nichts
 * Fachliches daran haengt: keine Schichten (auch geloeschte), Briefings,
 * Live-Sitzungen, Zeitbuchungen, Check-ins oder Standortmeldungen. Leere
 * Wochenplaene entstehen schon beim Oeffnen einer Woche und werden mit
 * entfernt; Freigaben entfallen, Nachrichten verlieren nur den Standortbezug.
 * Sonst: archivieren.
 */
export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  return api(async () => {
    const a = await requireAccess();
    requireAdmin(a);
    const { id } = await context.params;
    await serial(async tx => {
      const branch = await tx.branch.findFirst({ where: { id, organizationId: a.orgId }, select: { id: true } });
      if (!branch) throw new ApiError("Einsatzort nicht gefunden.", 404);
      if (await branchHasHistory(tx, id)) {
        throw new ApiError("Der Einsatzort hat bereits Schichten, Zeiten oder Meldungen und kann nicht gelöscht werden. Bitte stattdessen archivieren.", 409);
      }
      await tx.schedule.deleteMany({ where: { branchId: id } });
      await tx.branch.delete({ where: { id } });
    }, { retry: true });
    return { success: true };
  });
}
