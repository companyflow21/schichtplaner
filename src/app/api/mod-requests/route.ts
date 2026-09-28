import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { api, body, serial, ApiError } from "@/lib/api";
import { db } from "@/lib/db";
import { branchHolders, branchIds, can, requireAccess, type Access } from "@/lib/access";
import { checkAssignment, notify, shiftInclude, shiftView, type ShiftWithRelations } from "@/lib/planning";
import { canDecide, exchangeProblems, isFuture } from "@/lib/shift-requests";
import { emitToBranch } from "@/lib/emit";

type RequestRow = Prisma.ModRequestGetPayload<{ include: { user: { select: { id: true; firstName: true; lastName: true } }; shift: { include: typeof shiftInclude }; targetShift: { include: typeof shiftInclude } } }>;
type Name = { firstName: string; lastName: string };

/**
 * Antrag fuer die Ausgabe - Namen, Notizen und Begruendungen nur fuer
 * Beteiligte und die Planung. Beim Tausch (EXCHANGE) zaehlen beide Standorte.
 */
function requestView(r: RequestRow, a: Access, canVolunteer: boolean, targetName: Name | null) {
  const branches = [r.shift.schedule.branchId, ...(r.targetShift ? [r.targetShift.schedule.branchId] : [])];
  const handler = branches.some(id => can(a, "HANDLE_REQUESTS", id));
  const own = r.userId === a.userId, partner = r.targetUserId === a.userId;
  const involved = handler || own || partner;
  const named = involved || can(a, "VIEW_SCHEDULE", r.shift.schedule.branchId);
  const exchange = r.kind === "EXCHANGE", open = r.state === "OPEN";
  return {
    id: r.id, kind: r.kind, state: r.state, sentAt: r.sentAt, shiftId: r.shiftId, deadline: r.deadline,
    note: involved ? r.note : null,
    userId: involved ? r.userId : null,
    targetUserId: involved ? r.targetUserId : null,
    user: named ? { firstName: r.user.firstName, lastName: r.user.lastName } : null,
    targetUser: involved ? targetName : null,
    shift: shiftView(r.shift as ShiftWithRelations, a),
    targetShift: r.targetShift && involved ? shiftView(r.targetShift as ShiftWithRelations, a) : null,
    consentAt: involved ? r.targetConsentAt : null,
    decision: involved && r.decidedAt ? { at: r.decidedAt, note: r.decisionNote } : null,
    can: {
      // Nicht selbst genehmigen; beim Tausch erst nach Zustimmung der anderen Person.
      decide: open && canDecide(a, branches) && !own && !partner && (!exchange || !!r.targetConsentAt),
      consent: open && exchange && partner && !r.targetConsentAt,
      volunteer: canVolunteer,
      withdraw: own && open,
    },
  };
}

export async function GET(request: Request) {
  return api(async () => {
    const a = await requireAccess();
    const q = new URL(request.url).searchParams;
    const handle = branchIds(a, "HANDLE_REQUESTS"), offers = branchIds(a, "REQUEST_SHIFTS");
    const handled = handle ? { branchId: { in: handle } } : {};
    const scope: Prisma.ModRequestWhereInput[] = [
      { userId: a.userId },
      { targetUserId: a.userId },
      ...(handle === null || handle.length ? [{ shift: { schedule: handled } }, { targetShift: { schedule: handled } }] : []),
      ...(offers?.length ? [{ kind: "SWAP", state: "OPEN" as const, targetUserId: null, shift: { schedule: { branchId: { in: offers }, isPublic: true } } }] : []),
    ];
    const rows = await db.modRequest.findMany({
      where: {
        ...(q.get("shiftId") ? { shiftId: q.get("shiftId")! } : {}),
        shift: { deletedAt: null, ...(q.get("scheduleId") ? { scheduleId: q.get("scheduleId")! } : {}), schedule: { organizationId: a.orgId, deletedAt: null } },
        OR: scope,
      },
      include: { user: { select: { id: true, firstName: true, lastName: true } }, shift: { include: shiftInclude }, targetShift: { include: shiftInclude } },
      orderBy: { sentAt: "desc" },
      take: 250,
    });
    const targetIds = [...new Set(rows.map(r => r.targetUserId).filter((id): id is string => !!id))];
    const names = new Map((await db.user.findMany({ where: { id: { in: targetIds } }, select: { id: true, firstName: true, lastName: true } })).map(u => [u.id, { firstName: u.firstName, lastName: u.lastName }]));
    const requests = [];
    for (const r of rows) {
      const branchId = r.shift.schedule.branchId;
      const involved = r.userId === a.userId || r.targetUserId === a.userId || can(a, "HANDLE_REQUESTS", branchId) || (!!r.targetShift && can(a, "HANDLE_REQUESTS", r.targetShift.schedule.branchId));
      // Fremde Abgaben nur, wenn man sie wirklich uebernehmen koennte.
      const offer = r.kind === "SWAP" && r.state === "OPEN" && !r.targetUserId && r.userId !== a.userId && r.shift.schedule.isPublic && can(a, "REQUEST_SHIFTS", branchId)
        && !r.shift.bookings.some(b => b.userId === a.userId) && !(await checkAssignment(db, r.shift, a.userId)).length;
      if (involved || offer) requests.push(requestView(r, a, offer, r.targetUserId ? names.get(r.targetUserId) ?? null : null));
    }
    return { requests };
  });
}

export async function POST(request: Request) {
  return api(async () => {
    const a = await requireAccess();
    const data = await body(request, z.object({
      shiftId: z.string(),
      note: z.string().max(1000).optional(),
      kind: z.enum(["TAKEOVER", "SWAP", "EXCHANGE"]).default("TAKEOVER"),
      // Nur beim Tausch: Gegen-Schicht und die Person, die sie abgibt.
      targetShiftId: z.string().optional(),
      targetUserId: z.string().optional(),
    }));
    const result = await serial(async tx => {
      const shift = await tx.shift.findFirst({ where: { id: data.shiftId, deletedAt: null, schedule: { organizationId: a.orgId, deletedAt: null, isPublic: true } }, include: shiftInclude });
      if (!shift) throw new ApiError("Veröffentlichte Schicht nicht gefunden.", 404);
      const branchId = shift.schedule.branchId;
      const ownBooking = shift.bookings.some(b => b.userId === a.userId);
      if (data.kind !== "TAKEOVER" && !ownBooking) throw new ApiError(data.kind === "SWAP" ? "Nur eigene Schichten können zur Übernahme angeboten werden." : "Nur eigene Schichten können getauscht werden.", 403);
      if (!isFuture(shift)) throw new ApiError("Die Schicht hat bereits begonnen.", 409);
      let target: ShiftWithRelations | null = null;
      if (data.kind === "TAKEOVER") {
        // Offene Schichten anfragen setzt eine Freigabe fuer den Standort voraus.
        if (!can(a, "REQUEST_SHIFTS", branchId)) throw new ApiError("Veröffentlichte Schicht nicht gefunden.", 404);
        if (ownBooking || shift.bookings.length >= shift.maxEmployees) throw new ApiError("Schicht ist bereits besetzt.", 409);
        const warnings = await checkAssignment(tx, shift, a.userId);
        if (warnings.length) throw new ApiError(warnings.join(" "), 409);
      }
      if (data.kind === "EXCHANGE") {
        if (!data.targetShiftId || !data.targetUserId) throw new ApiError("Für einen Tausch fehlt die andere Schicht.", 400);
        if (data.targetUserId === a.userId || data.targetShiftId === shift.id) throw new ApiError("Ein Tausch braucht eine andere Person und eine andere Schicht.", 400);
        target = await tx.shift.findFirst({ where: { id: data.targetShiftId, deletedAt: null, schedule: { organizationId: a.orgId, deletedAt: null, isPublic: true } }, include: shiftInclude });
        // Wer dem Standort der Gegen-Schicht nicht zugeordnet ist, erfaehrt nicht, dass es sie gibt.
        if (!target || !can(a, "REQUEST_SHIFTS", target.schedule.branchId) || !target.bookings.some(b => b.userId === data.targetUserId)) throw new ApiError("Andere Schicht nicht gefunden.", 404);
        const problems = await exchangeProblems(tx, a.orgId, shift, a.userId, target, data.targetUserId, true);
        if (problems.length) throw new ApiError(problems.join(" "), 409);
      }
      const old = await tx.modRequest.findUnique({ where: { shiftId_userId: { shiftId: data.shiftId, userId: a.userId } } });
      if (old?.state === "OPEN") throw new ApiError("Es besteht bereits ein offener Antrag.", 409);
      const fields = { kind: data.kind, note: data.note, state: "OPEN" as const, targetUserId: data.kind === "EXCHANGE" ? data.targetUserId! : null, targetShiftId: target?.id ?? null, targetConsentAt: null, decidedById: null, decidedAt: null, decisionNote: null, sentAt: new Date() };
      const record = await tx.modRequest.upsert({ where: { shiftId_userId: { shiftId: data.shiftId, userId: a.userId } }, create: { shiftId: data.shiftId, userId: a.userId, ...fields }, update: fields });
      if (target) {
        // Erst stimmt die andere Person zu, dann entscheidet die Planung.
        await notify(tx, a.orgId, a.userId, [data.targetUserId!], "Tauschanfrage", "Jemand möchte eine Schicht mit dir tauschen. Bitte unter „Anträge“ zustimmen oder ablehnen. Bis zur Genehmigung bleibt alles, wie es ist.", target.id);
      } else {
        await notify(tx, a.orgId, a.userId, await branchHolders(tx, a.orgId, branchId, ["HANDLE_REQUESTS"]), "Neuer Schichtantrag", data.kind === "SWAP" ? "Eine Schicht wurde zur Übernahme angeboten." : "Eine offene Schicht wurde angefragt.", shift.id);
      }
      return { record, branches: [branchId, target?.schedule.branchId ?? null] };
    });
    for (const branchId of new Set(result.branches)) emitToBranch(a.orgId, branchId, "booking:changed", [a.userId, ...(data.targetUserId ? [data.targetUserId] : [])]);
    return { request: { id: result.record.id, kind: result.record.kind, state: result.record.state, shiftId: result.record.shiftId } };
  });
}
