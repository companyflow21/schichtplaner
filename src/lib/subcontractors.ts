import { z } from "zod";
import { db } from "./db";
import { emitToBranch } from "./emit";

export const subcontractorInput = z.strictObject({
  name: z.string().trim().min(1, "Bitte einen Namen angeben.").max(100),
  isActive: z.boolean().optional(),
});
export const contractorWorkerInput = subcontractorInput;

/** Inhaltsleere Signale: Stammdaten nur an Admins, geaenderte Namen an betroffene Standortplaene. */
export async function emitSubcontractorChange(orgId: string, subcontractorId?: string) {
  emitToBranch(orgId, null, "subcontractors:changed");
  if (!subcontractorId) return;
  const bookings = await db.booking.findMany({
    where: { contractorWorker: { organizationId: orgId, subcontractorId }, shift: { deletedAt: null, schedule: { organizationId: orgId, deletedAt: null } } },
    select: { shift: { select: { schedule: { select: { branchId: true } } } } },
  });
  for (const branchId of new Set(bookings.map(b => b.shift.schedule.branchId))) emitToBranch(orgId, branchId, "booking:changed");
}
