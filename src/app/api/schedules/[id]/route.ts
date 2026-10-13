import { z } from "zod";
import { api, body, serial, ApiError } from "@/lib/api";
import { assertCan, branchHolders, requireAccess } from "@/lib/access";
import { notify, personIds } from "@/lib/planning";
import { emitToBranch, emitToUsers } from "@/lib/emit";
import { scheduleStatus } from "@/lib/schedule-status";
import { publishEdits } from "@/lib/schedule-editing";

const updateScheduleSchema = z.object({
  isPublic: z.boolean().optional(),
  // Mitteilungen beim Veroeffentlichen oder Zurueckziehen; ohne Angabe wie bisher (ja).
  notify: z.boolean().optional(),
  settingsLayout: z.enum(["LAYOUT_1", "LAYOUT_2"]).optional(),
  showTitle: z.boolean().optional(),
  showPauses: z.boolean().optional(),
});

/**
 * Veroeffentlichen braucht "Dienstplan veroeffentlichen", die Darstellung
 * "Schichten bearbeiten" - jeweils am Standort dieses Plans.
 * isPublic: true auf einem Plan in Bearbeitung veroeffentlicht die Aenderungen
 * (lib/schedule-editing.ts publishEdits); zurueckziehen ist dann nicht moeglich.
 * notify: false unterdrueckt die Mitteilungen (keine Postfachzeile).
 */
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  return api(async () => {
    const a = await requireAccess();
    const { id } = await context.params;
    const { isPublic, notify: send = true, ...display } = await body(request, updateScheduleSchema);
    const result = await serial(async tx => {
      const existing = await tx.schedule.findFirst({ where: { id, organizationId: a.orgId, deletedAt: null }, include: { branch: { select: { name: true } }, shifts: { where: { deletedAt: null }, select: { bookings: { select: { userId: true } } } } } });
      if (!existing) throw new ApiError("Schichtplan nicht gefunden.", 404);
      if (isPublic !== undefined) assertCan(a, "PUBLISH_SCHEDULE", existing.branchId);
      if (Object.keys(display).length) assertCan(a, "EDIT_SHIFTS", existing.branchId);
      if (scheduleStatus(existing) === "EDITING") {
        if (isPublic === false) throw new ApiError("Der Plan wird gerade bearbeitet. Bitte die Bearbeitung zuerst veröffentlichen oder verwerfen.", 409);
        if (isPublic) {
          const published = await publishEdits(tx, a, existing, send);
          const schedule = Object.keys(display).length ? await tx.schedule.update({ where: { id }, data: display }) : published.schedule;
          return { schedule, affected: published.affected, notified: published.notified };
        }
      }
      const schedule = await tx.schedule.update({ where: { id }, data: { ...display, ...(isPublic !== undefined ? { isPublic } : {}) } });
      const booked = existing.shifts.flatMap(s => personIds(s.bookings));
      let notified: string[] = [];
      if (send && isPublic !== undefined && isPublic !== existing.isPublic) {
        // Wer den Plan sehen oder Schichten anfragen darf, plus alle Eingeteilten.
        const audience = [...await branchHolders(tx, a.orgId, existing.branchId, ["VIEW_SCHEDULE", "REQUEST_SHIFTS"], false), ...booked];
        const where = existing.branch ? existing.branch.name + ", " : "";
        notified = await notify(tx, a.orgId, a.userId, audience, schedule.isPublic ? "Dienstplan veröffentlicht" : "Dienstplan zurückgezogen", where + "KW " + schedule.weekNumber + "/" + schedule.year + (schedule.isPublic ? " ist jetzt verfügbar." : " wird überarbeitet."));
      }
      return { schedule, affected: booked, notified };
    }, { retry: true });
    emitToBranch(a.orgId, result.schedule.branchId, "schedule:updated", result.affected);
    emitToUsers(result.notified, "message:new");
    const s = result.schedule;
    return { schedule: { id: s.id, isPublic: s.isPublic, status: scheduleStatus(s), settingsLayout: s.settingsLayout, showTitle: s.showTitle, showPauses: s.showPauses }, notified: result.notified.length };
  });
}
