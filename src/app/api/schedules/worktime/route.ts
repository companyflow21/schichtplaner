import { api, serial, ApiError } from "@/lib/api";
import { branchIds, can, requireAccess } from "@/lib/access";
import { loadPlannedWork, workTimeHints } from "@/lib/worktime";

/**
 * Arbeitszeithinweise fuer die eingeteilten Personen einer Standortwoche.
 * Nur fuer die Planung (Admins; Manager mit "Dienstplan ansehen" am Standort)
 * und nur aus Schichten an Standorten, deren Plan die Person einsehen darf -
 * Hinweise verraten sonst nichts ueber fremde Einsaetze.
 */
export async function GET(request: Request) {
  return api(async () => {
    const a = await requireAccess();
    const q = new URL(request.url).searchParams;
    const weekNumber = Number(q.get("kw")), year = Number(q.get("year")), standort = q.get("standort");
    if (!Number.isInteger(weekNumber) || weekNumber < 1 || weekNumber > 53 || !Number.isInteger(year) || year < 2000 || year > 2100) throw new ApiError("Ungültige Kalenderwoche.");
    if (!standort || !(a.isAdmin || (a.role === "MANAGER" && can(a, "VIEW_SCHEDULE", standort)))) throw new ApiError("Nicht gefunden.", 404);
    const branches = a.isAdmin ? null : branchIds(a, "VIEW_SCHEDULE") ?? [];
    return serial(async tx => {
      const schedule = await tx.schedule.findFirst({ where: { organizationId: a.orgId, branchId: standort, weekNumber, year, deletedAt: null }, select: { shifts: { where: { deletedAt: null }, select: { bookings: { select: { userId: true } } } } } });
      const userIds = [...new Set((schedule?.shifts ?? []).flatMap(s => s.bookings.flatMap(b => b.userId ? [b.userId] : [])))];
      const settings = await tx.timeSettings.findUnique({ where: { organizationId: a.orgId }, select: { warningsEnabled: true, warningsMaxHours: true } });
      const { work, from, to } = await loadPlannedWork(tx, a.orgId, userIds, year, weekNumber, branches);
      return { hints: workTimeHints(work, from, to, settings?.warningsEnabled ? settings.warningsMaxHours : null), allBranches: branches === null };
    }, { retry: true });
  });
}
