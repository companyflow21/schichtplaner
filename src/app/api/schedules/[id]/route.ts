import { z } from "zod";
import { api, body, serial, ApiError } from "@/lib/api";
import { assertCan, requireAccess } from "@/lib/access";
import { emitToBranch } from "@/lib/emit";
import { publishSchedule, withdrawSchedule } from "@/lib/publishing";

const updateScheduleSchema = z.object({
  isPublic: z.boolean().optional(),
  settingsLayout: z.enum(["LAYOUT_1", "LAYOUT_2"]).optional(),
  showTitle: z.boolean().optional(),
  showPauses: z.boolean().optional(),
});

/**
 * Veroeffentlichen braucht "Dienstplan veroeffentlichen", die Darstellung
 * "Schichten bearbeiten" - jeweils am Standort dieses Plans. isPublic: true
 * veroeffentlicht mit Benachrichtigung (wie POST .../publish mit notify),
 * false zieht zurueck.
 */
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  return api(async () => {
    const a = await requireAccess();
    const { id } = await context.params;
    const data = await body(request, updateScheduleSchema);
    const result = await serial(async tx => {
      const existing = await tx.schedule.findFirst({ where: { id, organizationId: a.orgId, deletedAt: null } });
      if (!existing) throw new ApiError("Schichtplan nicht gefunden.", 404);
      const { isPublic, ...display } = data;
      if (Object.keys(display).length) assertCan(a, "EDIT_SHIFTS", existing.branchId);
      let booked: string[] = [];
      if (isPublic !== undefined) booked = (isPublic ? await publishSchedule(tx, a, id, { notify: true }) : await withdrawSchedule(tx, a, id)).booked;
      const schedule = Object.keys(display).length ? await tx.schedule.update({ where: { id }, data: display }) : await tx.schedule.findUniqueOrThrow({ where: { id } });
      return { schedule, booked };
    });
    emitToBranch(a.orgId, result.schedule.branchId, "schedule:updated", result.booked);
    const s = result.schedule;
    return { schedule: { id: s.id, isPublic: s.isPublic, editing: s.editing, settingsLayout: s.settingsLayout, showTitle: s.showTitle, showPauses: s.showPauses } };
  });
}
