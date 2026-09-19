import { z } from "zod";
import { api, body, requireMember, serial, ApiError } from "@/lib/api";
import { isManagerOrAbove } from "@/lib/auth-helpers";
import { timeChange, snapshot, validatedTimeChange } from "@/lib/time-service";
import { notify, planners } from "@/lib/planning";
type Context = { params: Promise<{ id: string }> };
export async function PATCH(request: Request, context: Context) {
  return api(async () => {
    const m = await requireMember();
    const { id } = await context.params;
    const { reason, ...data } = await body(request, timeChange.extend({ reason: z.string().trim().min(5, "Bitte eine Begründung mit mindestens fünf Zeichen angeben.").max(1000) }));
    return serial(async tx => {
      const record = await tx.timeRecord.findFirst({ where: { id, organizationId: m.organizationId, ...(!isManagerOrAbove(m.role) ? { userId: m.userId } : {}) } });
      if (!record) throw new ApiError("Zeitbuchung nicht gefunden.", 404);
      await validatedTimeChange(tx, m.organizationId, record, data);
      if (await tx.timeCorrection.findFirst({ where: { recordId: id, status: "PENDING" } })) throw new ApiError("Für diese Buchung wartet bereits eine Korrektur auf Freigabe.", 409);
      const correction = await tx.timeCorrection.create({ data: { organizationId: m.organizationId, recordId: id, requesterId: m.userId, reason, before: snapshot(record), proposed: data } });
      await notify(tx, m.organizationId, m.userId, await planners(tx, m.organizationId), "Zeitkorrektur zur Freigabe", reason);
      return { record, correction, pending: true };
    });
  });
}
export async function DELETE() {
  return api(async () => { await requireMember(); throw new ApiError("Zeitbuchungen bleiben nachvollziehbar erhalten. Bitte eine begründete Korrektur beantragen.", 409); });
}
