import { z } from "zod";
import { api, body, serial, ApiError } from "@/lib/api";
import { branchHolders, can, requireAccess } from "@/lib/access";
import { assign, checkAssignment, notify, shiftInclude } from "@/lib/planning";
import { canDecide, deciders, exchangeProblems, isFuture } from "@/lib/shift-requests";
import { emitToBranch } from "@/lib/emit";

type Context = { params: Promise<{ id: string }> };

/**
 * Ablauf: Antrag -> (Tausch: Zustimmung der anderen Person) -> Entscheidung
 * der Planung mit optionaler Begruendung. Erst die Genehmigung aendert
 * Zuweisungen; beim Tausch beide in derselben Transaktion. Doppelte
 * Entscheidungen und Ueberbesetzung verhindert die serialisierte
 * Transaktion mit erneuter Pruefung.
 */
export async function PATCH(request: Request, context: Context) {
  return api(async () => {
    const a = await requireAccess();
    const { id } = await context.params;
    const data = await body(request, z.object({
      state: z.enum(["ACCEPTED", "DECLINED"]).optional(),
      volunteer: z.boolean().optional(),
      // Tausch: Zustimmung (true) oder Ablehnung (false) der anderen Person.
      consent: z.boolean().optional(),
      note: z.string().trim().max(1000).optional(),
      // Planung bestaetigt Hinweise (etwa fehlende Qualifikation) einmalig.
      confirm: z.boolean().optional(),
    }));
    const note = data.note || null;
    const result = await serial(async tx => {
      const published = { deletedAt: null, schedule: { organizationId: a.orgId, deletedAt: null, isPublic: true } };
      const r = await tx.modRequest.findFirst({ where: { id, shift: published }, include: { shift: { include: shiftInclude }, targetShift: { include: shiftInclude } } });
      const branchId = r?.shift.schedule.branchId ?? null;
      const branches = [branchId, ...(r?.targetShift ? [r.targetShift.schedule.branchId] : [])];
      const handler = !!r && canDecide(a, branches);
      const seesAsPlanner = branches.some(b => can(a, "HANDLE_REQUESTS", b));
      // Wer den Antrag weder stellen, uebernehmen, beantworten noch entscheiden darf, erfaehrt nicht, dass es ihn gibt.
      if (!r || (!seesAsPlanner && r.userId !== a.userId && r.targetUserId !== a.userId && !can(a, "REQUEST_SHIFTS", branchId))) throw new ApiError("Antrag nicht gefunden.", 404);
      if (r.state !== "OPEN") throw new ApiError("Antrag wurde bereits bearbeitet.", 409);
      const target = r.kind === "EXCHANGE" ? r.targetShift : null;
      if (r.kind === "EXCHANGE" && (!target || target.deletedAt || !target.schedule.isPublic || target.schedule.deletedAt)) throw new ApiError("Die andere Schicht besteht nicht mehr.", 409);
      const affected = [r.userId, ...(r.targetUserId ? [r.targetUserId] : [])];

      if (data.volunteer) {
        if (!can(a, "REQUEST_SHIFTS", branchId)) throw new ApiError("Antrag nicht gefunden.", 404);
        if (r.kind !== "SWAP" || r.userId === a.userId || r.targetUserId) throw new ApiError("Dieses Angebot ist nicht verfügbar.", 409);
        const warnings = await checkAssignment(tx, r.shift, a.userId);
        if (r.shift.bookings.some(b => b.userId === a.userId)) warnings.push("Bereits zugewiesen.");
        if (warnings.length) throw new ApiError(warnings.join(" "), 409);
        const updated = await tx.modRequest.update({ where: { id }, data: { targetUserId: a.userId } });
        await notify(tx, a.orgId, a.userId, await branchHolders(tx, a.orgId, branchId, ["HANDLE_REQUESTS"]), "Schichtübernahme zur Freigabe", "Jemand möchte die angebotene Schicht übernehmen.", r.shiftId);
        return { updated, branches, affected: [a.userId, r.userId] };
      }

      if (data.consent !== undefined) {
        if (r.kind !== "EXCHANGE" || r.targetUserId !== a.userId) throw new ApiError("Nur die angefragte Person kann einem Tausch zustimmen.", 403);
        if (r.targetConsentAt) throw new ApiError("Du hast bereits zugestimmt.", 409);
        if (!data.consent) {
          const updated = await tx.modRequest.update({ where: { id }, data: { state: "DECLINED", decidedById: a.userId, decidedAt: new Date(), decisionNote: note } });
          await notify(tx, a.orgId, a.userId, [r.userId], "Tausch abgelehnt", "Die angefragte Person möchte nicht tauschen." + (note ? " Begründung: " + note : ""), r.shiftId);
          return { updated, branches, affected };
        }
        const problems = await exchangeProblems(tx, a.orgId, r.shift, r.userId, target!, a.userId, true);
        if (problems.length) throw new ApiError(problems.join(" "), 409);
        const updated = await tx.modRequest.update({ where: { id }, data: { targetConsentAt: new Date() } });
        await notify(tx, a.orgId, a.userId, (await deciders(tx, a.orgId, branches)).filter(u => !affected.includes(u)), "Schichttausch zur Freigabe", "Beide Beteiligten sind mit dem Tausch einverstanden. Bitte genehmigen oder ablehnen.", r.shiftId);
        return { updated, branches, affected };
      }

      if (!data.state) throw new ApiError("Bitte genehmigen oder ablehnen.", 400);
      if (!handler) throw new ApiError("Entscheiden darf nur, wer Anträge an allen betroffenen Standorten bearbeitet – sonst die Administration.", 403);
      if (affected.includes(a.userId)) throw new ApiError("Eigene Anträge können nicht selbst entschieden werden.", 403);
      if (data.state === "ACCEPTED") {
        if (!isFuture(r.shift) || (target && !isFuture(target))) throw new ApiError("Die Schicht hat bereits begonnen.", 409);
        if (r.kind === "EXCHANGE") {
          if (!r.targetConsentAt) throw new ApiError("Die Zustimmung der anderen Person fehlt noch.", 409);
          const problems = await exchangeProblems(tx, a.orgId, r.shift, r.userId, target!, r.targetUserId!, false);
          if (problems.length) throw new ApiError(problems.join(" "), 409);
          // Beide Zuweisungen loesen, dann kreuzweise neu einteilen - alles oder nichts.
          await tx.booking.deleteMany({ where: { OR: [{ shiftId: r.shiftId, userId: r.userId }, { shiftId: target!.id, userId: r.targetUserId! }] } });
          await assign(tx, a, target!.id, r.userId, data.confirm);
          await assign(tx, a, r.shiftId, r.targetUserId!, data.confirm);
        } else {
          let userId = r.userId;
          if (r.kind === "SWAP") {
            if (!r.targetUserId) throw new ApiError("Es fehlt eine bestätigte Übernahme.", 409);
            const source = r.shift.bookings.find(b => b.userId === r.userId);
            if (!source) throw new ApiError("Ursprüngliche Zuweisung besteht nicht mehr.", 409);
            await tx.booking.delete({ where: { id: source.id } });
            userId = r.targetUserId;
          }
          await assign(tx, a, r.shiftId, userId, data.confirm);
        }
      }
      const updated = await tx.modRequest.update({ where: { id }, data: { state: data.state, decidedById: a.userId, decidedAt: new Date(), decisionNote: note } });
      await notify(tx, a.orgId, a.userId, affected, data.state === "ACCEPTED" ? "Schichtantrag genehmigt" : "Schichtantrag abgelehnt", (data.state === "ACCEPTED" ? "Der Antrag zu deiner Schicht wurde genehmigt." : "Der Antrag zu deiner Schicht wurde abgelehnt.") + (note ? " Begründung: " + note : ""), r.shiftId);
      return { updated, branches, affected };
    }, { retry: true });
    for (const branchId of new Set(result.branches)) emitToBranch(a.orgId, branchId, "booking:changed", result.affected);
    const u = result.updated;
    return { request: { id: u.id, kind: u.kind, state: u.state, shiftId: u.shiftId, consentAt: u.targetConsentAt, targetUserId: result.affected.includes(a.userId) || canDecide(a, result.branches) ? u.targetUserId : null } };
  });
}

/** Offene eigene Antraege zurueckziehen; die Planung kann offene Antraege ihrer Standorte entfernen. */
export async function DELETE(_request: Request, context: Context) {
  return api(async () => {
    const a = await requireAccess();
    const { id } = await context.params;
    const result = await serial(async tx => {
      const r = await tx.modRequest.findFirst({ where: { id, state: "OPEN", shift: { schedule: { organizationId: a.orgId } } }, include: { shift: { include: { schedule: true } }, targetShift: { include: { schedule: true } } } });
      const branches = r ? [r.shift.schedule.branchId, ...(r.targetShift ? [r.targetShift.schedule.branchId] : [])] : [];
      if (!r || (r.userId !== a.userId && !canDecide(a, branches))) throw new ApiError("Offener Antrag nicht gefunden.", 404);
      await tx.modRequest.delete({ where: { id } });
      if (r.targetUserId && r.targetUserId !== a.userId) await notify(tx, a.orgId, a.userId, [r.targetUserId], "Antrag zurückgezogen", "Ein Antrag zu deiner Schicht wurde zurückgezogen.", r.targetShiftId ?? r.shiftId);
      return { branches, affected: [r.userId, ...(r.targetUserId ? [r.targetUserId] : [])] };
    });
    for (const branchId of new Set(result.branches)) emitToBranch(a.orgId, branchId, "booking:changed", result.affected);
    return { success: true };
  });
}
