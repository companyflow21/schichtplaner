import { api, serial, ApiError } from "@/lib/api";
import { requireAccess, requireAdmin } from "@/lib/access";

/**
 * Einsatzort endgueltig loeschen - nur solange nichts Fachliches daran haengt:
 * keine Schichten (auch geloeschte), Briefings, Live-Sitzungen, Zeitbuchungen,
 * Check-ins oder Standortmeldungen. Leere Wochenplaene entstehen schon beim
 * Oeffnen einer Woche und werden mit entfernt; Freigaben entfallen, Nachrichten
 * verlieren nur den Standortbezug. Sonst: deaktivieren.
 */
export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  return api(async () => {
    const a = await requireAccess();
    requireAdmin(a);
    const { id } = await context.params;
    await serial(async tx => {
      const branch = await tx.branch.findFirst({ where: { id, organizationId: a.orgId }, select: { id: true } });
      if (!branch) throw new ApiError("Einsatzort nicht gefunden.", 404);
      const [shifts, planData, times, checkins, issues] = await Promise.all([
        tx.shift.count({ where: { schedule: { branchId: id } } }),
        tx.schedule.count({ where: { branchId: id, OR: [{ briefings: { some: {} } }, { liveSession: { isNot: null } }] } }),
        tx.timeRecord.count({ where: { branchId: id } }),
        tx.checkin.count({ where: { branchId: id } }),
        tx.branchIssue.count({ where: { branchId: id } }),
      ]);
      if (shifts || planData || times || checkins || issues) {
        throw new ApiError("Der Einsatzort hat bereits Schichten, Zeiten oder Meldungen und kann nicht gelöscht werden. Bitte stattdessen deaktivieren.", 409);
      }
      await tx.schedule.deleteMany({ where: { branchId: id } });
      await tx.branch.delete({ where: { id } });
    });
    return { success: true };
  });
}
