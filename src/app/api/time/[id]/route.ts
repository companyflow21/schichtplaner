import { z } from "zod";
import { api, body, serial, ApiError } from "@/lib/api";
import { canSeeTime, requireAccess } from "@/lib/access";
import { reassign, timeChange, snapshot, timeReviewers, validatedTimeChange } from "@/lib/time-service";
import { notify } from "@/lib/planning";

type Context = { params: Promise<{ id: string }> };

/**
 * Buchung aendern. Pruefende (Admins; Manager mit "Zeiterfassung bearbeiten"
 * am Standort und "Stunden einsehen" fuer die Person) aendern fremde Buchungen
 * direkt - die Aenderung gilt als genehmigt und steht als entschiedene
 * Korrektur im Verlauf. Alle anderen beantragen eine Korrektur.
 */
export async function PATCH(request: Request, context: Context) {
  return api(async () => {
    const a = await requireAccess();
    const { id } = await context.params;
    const { reason, ...data } = await body(request, timeChange.extend({ reason: z.string().trim().min(5, "Bitte eine Begründung mit mindestens fünf Zeichen angeben.").max(1000) }));
    return serial(async tx => {
      const record = await tx.timeRecord.findFirst({ where: { id, organizationId: a.orgId } });
      if (!record || !(record.userId === a.userId || canSeeTime(a, record, "edit"))) throw new ApiError("Zeitbuchung nicht gefunden.", 404);
      const userId = record.userId;
      if (!userId) throw new ApiError("Zeiten gelöschter Personen bleiben als Historie unverändert.", 409);
      const change = await validatedTimeChange(tx, a.orgId, record, data);
      if (await tx.timeCorrection.findFirst({ where: { recordId: id, status: "PENDING" } })) throw new ApiError("Für diese Buchung wartet bereits eine Korrektur auf Freigabe.", 409);
      const direct = canSeeTime(a, record, "edit") && (userId !== a.userId || a.isAdmin);
      if (direct) {
        const now = new Date();
        const updated = await reassign(tx, a.orgId, await tx.timeRecord.update({ where: { id }, data: { ...change, approvedAt: now, approvedById: a.userId } }));
        const correction = await tx.timeCorrection.create({ data: { organizationId: a.orgId, recordId: id, requesterId: a.userId, reason, before: snapshot(record), proposed: data, status: "APPROVED", reviewedBy: a.userId, reviewedAt: now } });
        if (userId !== a.userId) await notify(tx, a.orgId, a.userId, [userId], "Zeitbuchung geändert", reason);
        return { record: updated, correction, pending: false };
      }
      const correction = await tx.timeCorrection.create({ data: { organizationId: a.orgId, recordId: id, requesterId: a.userId, reason, before: snapshot(record), proposed: data } });
      await notify(tx, a.orgId, a.userId, await timeReviewers(tx, a.orgId, record), "Zeitkorrektur zur Freigabe", reason);
      return { record, correction, pending: true };
    }, { retry: true });
  });
}

export async function DELETE() {
  return api(async () => { await requireAccess(); throw new ApiError("Zeitbuchungen bleiben nachvollziehbar erhalten. Bitte eine begründete Korrektur beantragen.", 409); });
}
