import { api, serial, ApiError } from "@/lib/api";
import { assertCan, requireAccess, type Access } from "@/lib/access";
import type { Prisma } from "@prisma/client";
import { emitToBranch } from "@/lib/emit";
import { scheduleStatus } from "@/lib/schedule-status";
import { discardEdits, editingInfo, startEditing, weekStarted } from "@/lib/schedule-editing";

type Context = { params: Promise<{ id: string }> };

async function findSchedule(tx: Prisma.TransactionClient, a: Access, id: string) {
  const schedule = await tx.schedule.findFirst({ where: { id, organizationId: a.orgId, deletedAt: null } });
  if (!schedule) throw new ApiError("Schichtplan nicht gefunden.", 404);
  return schedule;
}

/**
 * Bearbeitung eines veroeffentlichten Plans starten (Recht "Schichten
 * bearbeiten" am Standort). 409 bei Entwurf oder laufender Bearbeitung.
 * weekStarted/notice: Die Woche hat schon begonnen - begonnene Schichten
 * setzt Verwerfen nicht zurueck.
 */
export async function POST(_request: Request, context: Context) {
  return api(async () => {
    const a = await requireAccess();
    const { id } = await context.params;
    const result = await serial(async tx => {
      const existing = await findSchedule(tx, a, id);
      assertCan(a, "EDIT_SHIFTS", existing.branchId);
      const schedule = await startEditing(tx, a, existing);
      return { schedule, info: await editingInfo(tx, a, schedule) };
    }, { retry: true });
    emitToBranch(a.orgId, result.schedule.branchId, "schedule:updated", []);
    const started = weekStarted(result.schedule);
    return {
      schedule: { id: result.schedule.id, ...result.info },
      weekStarted: started,
      notice: started ? "Die Woche hat bereits begonnen. Bereits begonnene Schichten werden beim Verwerfen nicht zurückgesetzt." : null,
    };
  });
}

/**
 * Bearbeitung verwerfen (Recht "Dienstplan veroeffentlichen"): veroeffentlichten
 * Stand wiederherstellen, ohne Mitteilungen. skipped: begonnene Schichten
 * (und solche mit Check-in), die unveraendert bleiben.
 */
export async function DELETE(_request: Request, context: Context) {
  return api(async () => {
    const a = await requireAccess();
    const { id } = await context.params;
    const result = await serial(async tx => {
      const schedule = await findSchedule(tx, a, id);
      assertCan(a, "PUBLISH_SCHEDULE", schedule.branchId);
      if (scheduleStatus(schedule) !== "EDITING") throw new ApiError("Der Plan wird gerade nicht bearbeitet.", 409);
      return discardEdits(tx, a, schedule);
    }, { retry: true });
    // Erster Eintrag ist der Standort des Plans; weitere: Standorte zurueckgeholter Schichten.
    result.branches.forEach((branchId, i) => emitToBranch(a.orgId, branchId, "schedule:updated", i === 0 ? result.affected : []));
    return { schedule: { id, status: "PUBLISHED" as const }, restored: result.restored, removed: result.removed, skipped: result.skipped };
  });
}
