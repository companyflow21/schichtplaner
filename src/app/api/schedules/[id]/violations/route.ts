import { api, serial, ApiError } from "@/lib/api";
import { can, requireAccess } from "@/lib/access";
import { scheduleViolations } from "@/lib/planning-rules-service";

/**
 * Regelverstoesse in der Woche dieses Plans (siehe lib/planning-rules-service.ts).
 * Nur fuer die Planung wie die Konfliktpruefung: Admins; Manager mit
 * "Dienstplan ansehen" am Standort des Plans, sonst 403. Schichten anderer
 * Standorte nennt die Antwort nur, wenn die Person deren Dienstplan sehen
 * darf. Liefert { enabled, count, people }.
 */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  return api(async () => {
    const a = await requireAccess();
    const { id } = await context.params;
    return serial(async (tx) => {
      const schedule = await tx.schedule.findFirst({
        where: { id, organizationId: a.orgId, deletedAt: null },
        select: { branchId: true, year: true, weekNumber: true, shifts: { where: { deletedAt: null }, select: { id: true, bookings: { select: { userId: true } } } } },
      });
      if (!schedule) throw new ApiError("Nicht gefunden.", 404);
      if (!(a.isAdmin || (a.role === "MANAGER" && can(a, "VIEW_SCHEDULE", schedule.branchId)))) throw new ApiError("Keine Berechtigung für diesen Standort.", 403);
      return scheduleViolations(tx, a, schedule);
    }, { retry: true });
  });
}
