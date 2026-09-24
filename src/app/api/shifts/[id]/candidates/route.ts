import { api, serial, ApiError } from "@/lib/api";
import { assertCan, requireAccess } from "@/lib/access";
import { shiftCandidates, shiftInclude } from "@/lib/planning";

/**
 * Wer diese Schicht uebernehmen kann. Admins waehlen aus allen aktiven
 * Mitgliedern, Manager nur aus Personen, die ihnen ausdruecklich mit
 * "Einplanen" zugeordnet sind. Sortiert nach Standortzuordnung,
 * Verfuegbarkeit und Qualifikation; gesperrte Personen getrennt mit Grund.
 * Ausgegeben werden nur Namen und Gruende, keine Personaldaten.
 */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  return api(async () => {
    const a = await requireAccess();
    const { id } = await context.params;
    return serial(async tx => {
      const shift = await tx.shift.findFirst({ where: { id, deletedAt: null, schedule: { organizationId: a.orgId, deletedAt: null } }, include: shiftInclude });
      if (!shift) throw new ApiError("Schicht nicht gefunden.", 404);
      assertCan(a, "EDIT_SHIFTS", shift.schedule.branchId);
      return shiftCandidates(tx, a, shift);
    });
  });
}
