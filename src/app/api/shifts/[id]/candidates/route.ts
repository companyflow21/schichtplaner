import { api, serial, ApiError } from "@/lib/api";
import { assertCan, requireAccess } from "@/lib/access";
import { shiftCandidates, shiftInclude } from "@/lib/planning";

/**
 * Auswahl beim Besetzen (Reihenfolge und Regeln: shiftCandidates in
 * src/lib/planning.ts). Voraussetzung ist "Schichten bearbeiten" am Standort
 * der Schicht. Ausgegeben werden nur Namen und kurze Gruende, keine Profile
 * oder Kontaktdaten.
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
