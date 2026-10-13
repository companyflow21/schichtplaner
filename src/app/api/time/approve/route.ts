import { z } from "zod";
import { api, body, serial, ApiError } from "@/lib/api";
import { canSeeTime, requireAccess } from "@/lib/access";

/**
 * Stunden genehmigen oder die Genehmigung zuruecknehmen - fuer Pruefende
 * (Admins; Manager mit "Zeiterfassung bearbeiten" am Standort der Buchung und
 * "Stunden einsehen" fuer die Person). Eigene Buchungen genehmigt nur die
 * Administration. Laufende Stoppuhren lassen sich nicht genehmigen.
 * Zeiten geloeschter Personen sieht und genehmigt nur die Administration;
 * die Zeiten selbst bleiben unveraendert.
 * Wie assertCan: 404, wenn die Buchung nicht sichtbar ist und am Standort
 * kein Recht besteht (auch fremde Organisation); sonst 403.
 */
export async function POST(request: Request) {
  return api(async () => {
    const a = await requireAccess();
    const { ids, approved } = await body(request, z.object({ ids: z.array(z.string().min(1)).min(1).max(1000), approved: z.boolean().default(true) }));
    return serial(async (tx) => {
      const unique = [...new Set(ids)];
      const records = await tx.timeRecord.findMany({ where: { id: { in: unique }, organizationId: a.orgId } });
      const known = (r: (typeof records)[number]) => canSeeTime(a, r, "view") || (!!r.branchId && a.branches.has(r.branchId));
      if (records.length !== unique.length || !records.every(known)) throw new ApiError("Zeitbuchung nicht gefunden.", 404);
      if (records.some((r) => !canSeeTime(a, r, "edit") || (r.userId === a.userId && !a.isAdmin))) throw new ApiError("Keine Berechtigung, diese Stunden zu genehmigen.", 403);
      if (records.some((r) => r.type === "WATCH" && !r.timeTo)) throw new ApiError("Laufende Zeiterfassung zuerst beenden.", 409);
      const result = await tx.timeRecord.updateMany({ where: { id: { in: unique } }, data: approved ? { approvedAt: new Date(), approvedById: a.userId } : { approvedAt: null, approvedById: null } });
      return { updated: result.count, approved };
    }, { retry: true });
  });
}
