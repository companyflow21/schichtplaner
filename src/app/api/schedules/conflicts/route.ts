import { api, serial, ApiError } from "@/lib/api";
import { can, requireAccess } from "@/lib/access";
import { weekConflicts } from "@/lib/conflicts";

/**
 * Konfliktpruefung einer Standortwoche (?kw&year&standort): alle bestehenden
 * Zuweisungen mit Konflikten (fehler) und Hinweisen (hinweis), siehe
 * lib/conflicts.ts. Nur fuer die Planung (Admins; Manager mit "Dienstplan
 * ansehen" am Standort), sonst 403. Liefert { items, counts }.
 */
export async function GET(request: Request) {
  return api(async () => {
    const a = await requireAccess();
    const q = new URL(request.url).searchParams;
    const weekNumber = Number(q.get("kw")), year = Number(q.get("year")), standort = q.get("standort");
    if (!Number.isInteger(weekNumber) || weekNumber < 1 || weekNumber > 53 || !Number.isInteger(year) || year < 2000 || year > 2100) throw new ApiError("Ungültige Kalenderwoche.");
    if (!standort) throw new ApiError("Standort fehlt.");
    if (!(a.isAdmin || (a.role === "MANAGER" && can(a, "VIEW_SCHEDULE", standort)))) throw new ApiError("Keine Berechtigung für diesen Standort.", 403);
    return serial(async tx => {
      if (!await tx.branch.findFirst({ where: { id: standort, organizationId: a.orgId }, select: { id: true } })) throw new ApiError("Nicht gefunden.", 404);
      return weekConflicts(tx, a, { branchId: standort, weekNumber, year });
    }, { retry: true });
  });
}
