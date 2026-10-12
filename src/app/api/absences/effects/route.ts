import { api, ApiError } from "@/lib/api";
import { db } from "@/lib/db";
import { can, canStaff, requireAccess } from "@/lib/access";
import { validDate } from "@/lib/berlin";
import { affectedShifts, defaultHandling, type Handling } from "@/lib/absence-effects";

/**
 * Folgen einer Abwesenheit vor dem Genehmigen: geplante Schichten der Person im
 * Zeitraum mit bisheriger Entscheidung und Vorgabe der Art. Nur fuer Personen,
 * deren Abwesenheiten man entscheiden darf.
 * ?userId&from&to&categoryId[&absenceId]
 */
export async function GET(request: Request) {
  return api(async () => {
    const a = await requireAccess();
    const q = new URL(request.url).searchParams;
    const userId = q.get("userId") ?? "", from = q.get("from") ?? "", to = q.get("to") ?? "", categoryId = q.get("categoryId") ?? "", absenceId = q.get("absenceId");
    if (!validDate(from) || !validDate(to) || from > to) throw new ApiError("Ungültiger Zeitraum.");
    if (!canStaff(a, "MANAGE_ABSENCES", userId) || (!a.isAdmin && userId === a.userId)) throw new ApiError("Nicht gefunden.", 404);
    const category = await db.absenceCategory.findFirst({ where: { id: categoryId, organizationId: a.orgId } });
    if (!category) throw new ApiError("Kategorie nicht gefunden.", 404);
    const existing = absenceId ? new Map((await db.absenceShift.findMany({ where: { absenceId, absence: { userId, category: { organizationId: a.orgId } } } })).map((e) => [e.shiftId, e.handling as Handling])) : new Map<string, Handling>();
    const shifts = await affectedShifts(db, a.orgId, userId, from, to);
    return {
      defaultHandling: defaultHandling(category), category: { name: category.name, isPaid: category.isPaid },
      shifts: shifts.map((s) => ({ ...s, current: existing.get(s.shiftId) ?? null, canRelease: a.isAdmin || can(a, "EDIT_SHIFTS", s.branchId) })),
    };
  });
}
