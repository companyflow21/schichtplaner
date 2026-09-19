import { z } from "zod";
import { api, body, requireMember, serial, ApiError } from "@/lib/api";
import { isManagerOrAbove } from "@/lib/auth-helpers";
import { assign, checkAssignment, notify, planners, shiftInclude } from "@/lib/planning";
import { emitToOrg } from "@/lib/emit";
type Context = { params: Promise<{ id: string }> };
export async function PATCH(request: Request, context: Context) {
  return api(async () => {
    const m = await requireMember();
    const { id } = await context.params;
    const data = await body(request, z.object({ state: z.enum(["ACCEPTED", "DECLINED"]).optional(), volunteer: z.boolean().optional() }));
    const result = await serial(async tx => {
      const r = await tx.modRequest.findFirst({ where: { id, shift: { deletedAt: null, schedule: { organizationId: m.organizationId, deletedAt: null, isPublic: true } } }, include: { shift: { include: shiftInclude } } });
      if (!r) throw new ApiError("Antrag nicht gefunden.", 404);
      if (r.state !== "OPEN") throw new ApiError("Antrag wurde bereits bearbeitet.", 409);
      if (data.volunteer) {
        if (r.kind !== "SWAP" || r.userId === m.userId || r.targetUserId) throw new ApiError("Dieses Tauschangebot ist nicht verfügbar.", 409);
        const warnings = await checkAssignment(tx, r.shift, m.userId);
        if (r.shift.bookings.some(b => b.userId === m.userId)) warnings.push("Bereits zugewiesen.");
        if (warnings.length) throw new ApiError(warnings.join(" "), 409);
        const updated = await tx.modRequest.update({ where: { id }, data: { targetUserId: m.userId } });
        await notify(tx, m.organizationId, m.userId, await planners(tx, m.organizationId), "Schichttausch zur Freigabe", "Ein Mitarbeiter möchte die angebotene Schicht übernehmen.", r.shiftId);
        return updated;
      }
      if (!isManagerOrAbove(m.role) || !data.state) throw new ApiError("Nur die Planung darf Anträge entscheiden.", 403);
      if (data.state === "ACCEPTED") {
        let userId = r.userId;
        if (r.kind === "SWAP") {
          if (!r.targetUserId) throw new ApiError("Es fehlt eine bestätigte Übernahme.", 409);
          const source = r.shift.bookings.find(b => b.userId === r.userId);
          if (!source) throw new ApiError("Ursprüngliche Zuweisung besteht nicht mehr.", 409);
          await tx.booking.delete({ where: { id: source.id } });
          userId = r.targetUserId;
        }
        await assign(tx, m.organizationId, m.userId, r.shiftId, userId);
      }
      const updated = await tx.modRequest.update({ where: { id }, data: { state: data.state } });
      await notify(tx, m.organizationId, m.userId, [r.userId, ...(r.targetUserId ? [r.targetUserId] : [])], data.state === "ACCEPTED" ? "Schichtantrag genehmigt" : "Schichtantrag abgelehnt", "Der Antrag zu deiner Schicht wurde bearbeitet.", r.shiftId);
      return updated;
    });
    emitToOrg(m.organizationId, "booking:changed", {});
    return { request: result };
  });
}
export async function DELETE(_request: Request, context: Context) {
  return api(async () => {
    const m = await requireMember();
    const { id } = await context.params;
    await serial(async tx => {
      const r = await tx.modRequest.findFirst({ where: { id, state: "OPEN", shift: { schedule: { organizationId: m.organizationId } } } });
      if (!r) throw new ApiError("Offener Antrag nicht gefunden.", 404);
      if (!isManagerOrAbove(m.role) && r.userId !== m.userId) throw new ApiError("Keine Berechtigung.", 403);
      await tx.modRequest.delete({ where: { id } });
    });
    return { success: true };
  });
}
