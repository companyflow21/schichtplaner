import { z } from "zod";
import { api, body, requireMember, serial, ApiError } from "@/lib/api";
import { db } from "@/lib/db";
import { isManagerOrAbove } from "@/lib/auth-helpers";
import { checkAssignment, notify, planners, shiftInclude } from "@/lib/planning";

export async function GET(request: Request) {
  return api(async () => {
    const m = await requireMember();
    const q = new URL(request.url).searchParams;
    const manager = isManagerOrAbove(m.role);
    const requests = await db.modRequest.findMany({
      where: { ...(q.get("shiftId") ? { shiftId: q.get("shiftId")! } : {}), shift: { ...(q.get("scheduleId") ? { scheduleId: q.get("scheduleId")! } : {}), deletedAt: null, schedule: { organizationId: m.organizationId, deletedAt: null, ...(!manager ? { isPublic: true } : {}) } }, ...(!manager ? { OR: [{ userId: m.userId }, { targetUserId: m.userId }, { kind: "SWAP", state: "OPEN", targetUserId: null }] } : {}) },
      include: { user: { select: { id: true, firstName: true, lastName: true } }, shift: { include: shiftInclude } }, orderBy: { sentAt: "desc" }, take: 250
    });
    if (manager) return { requests };
    const visible = [];
    for (const r of requests) {
      if (r.userId === m.userId || r.targetUserId === m.userId || (!r.shift.bookings.some(b => b.userId === m.userId) && !(await checkAssignment(db, r.shift, m.userId)).length)) visible.push(r);
    }
    return { requests: visible };
  });
}
export async function POST(request: Request) {
  return api(async () => {
    const m = await requireMember();
    const data = await body(request, z.object({ shiftId: z.string(), note: z.string().max(1000).optional(), kind: z.enum(["TAKEOVER", "SWAP"]).default("TAKEOVER") }));
    return serial(async tx => {
      const shift = await tx.shift.findFirst({ where: { id: data.shiftId, deletedAt: null, schedule: { organizationId: m.organizationId, deletedAt: null, isPublic: true } }, include: shiftInclude });
      if (!shift) throw new ApiError("Veröffentlichte Schicht nicht gefunden.", 404);
      const ownBooking = shift.bookings.some(b => b.userId === m.userId);
      if (data.kind === "SWAP" && !ownBooking) throw new ApiError("Nur eigene Schichten können zum Tausch angeboten werden.", 403);
      if (data.kind === "TAKEOVER") {
        if (ownBooking || shift.bookings.length >= shift.maxEmployees) throw new ApiError("Schicht ist bereits besetzt.", 409);
        const warnings = await checkAssignment(tx, shift, m.userId);
        if (warnings.length) throw new ApiError(warnings.join(" "), 409);
      }
      const old = await tx.modRequest.findUnique({ where: { shiftId_userId: { shiftId: data.shiftId, userId: m.userId } } });
      if (old?.state === "OPEN") throw new ApiError("Es besteht bereits ein offener Antrag.", 409);
      const record = await tx.modRequest.upsert({ where: { shiftId_userId: { shiftId: data.shiftId, userId: m.userId } }, create: { ...data, userId: m.userId }, update: { kind: data.kind, note: data.note, state: "OPEN", targetUserId: null, sentAt: new Date() } });
      await notify(tx, m.organizationId, m.userId, await planners(tx, m.organizationId), "Neuer Schichtantrag", data.kind === "SWAP" ? "Eine Schicht wurde zum Tausch angeboten." : "Eine offene Schicht wurde angefragt.", shift.id);
      return { request: record };
    });
  });
}
