import type { Prisma } from "@prisma/client";
import { api, ApiError } from "@/lib/api";
import { db } from "@/lib/db";
import { branchIds, can, requireAccess } from "@/lib/access";
import { shiftInclude, shiftView, type ShiftWithRelations } from "@/lib/planning";
import { addDate, berlinDate, isoWeek, shiftRange } from "@/lib/berlin";
import { berlinNowMinutes, exchangeProblems } from "@/lib/shift-requests";

/** Suchfenster fuer Tauschpartner und hoechstens so viele Pruefungen je Anfrage. */
const DAYS = 28, MAX_CHECKS = 40;

/** Veroeffentlichte kuenftige Schichten der naechsten DAYS Tage, optional nur an bestimmten Standorten. */
async function upcoming(orgId: string, branches: string[] | null, where: Prisma.ShiftWhereInput = {}) {
  const today = berlinDate();
  const weeks = new Map<string, { year: number; weekNumber: number }>();
  for (let d = 0; d <= DAYS + 7; d += 7) { const w = isoWeek(addDate(today, d)); weeks.set(w.year + "-" + w.weekNumber, w); }
  const now = berlinNowMinutes(), until = Date.parse(addDate(today, DAYS) + "T00:00:00Z") / 60000;
  const shifts = await db.shift.findMany({
    where: { deletedAt: null, ...where, schedule: { organizationId: orgId, deletedAt: null, isPublic: true, branchId: branches ? { in: branches } : { not: null }, OR: [...weeks.values()] } },
    include: shiftInclude,
  });
  return shifts.filter(s => { const r = shiftRange(s); return r.start > now && r.start < until; }).sort((x, y) => shiftRange(x).start - shiftRange(y).start);
}

/**
 * Ohne shiftId: eigene kuenftige Schichten, die getauscht werden koennen.
 * Mit shiftId: moegliche Gegen-Schichten - Schichten anderer an Standorten,
 * denen die Person zugeordnet ist, deren Inhaber umgekehrt dem Standort der
 * eigenen Schicht zugeordnet sind und bei denen fuer beide keine Sperre und
 * kein Hinweis entsteht. Namen nur mit "Dienstplan ansehen" am Standort.
 */
export async function GET(request: Request) {
  return api(async () => {
    const a = await requireAccess();
    const shiftId = new URL(request.url).searchParams.get("shiftId");
    if (!shiftId) {
      const own = await upcoming(a.orgId, null, { bookings: { some: { userId: a.userId } } });
      return { own: own.map(s => shiftView(s as ShiftWithRelations, a)) };
    }
    const [own] = await upcoming(a.orgId, null, { id: shiftId, bookings: { some: { userId: a.userId } } });
    if (!own) throw new ApiError("Eigene künftige Schicht nicht gefunden.", 404);
    const sites = branchIds(a, "REQUEST_SHIFTS");
    const candidates = await upcoming(a.orgId, sites, { id: { not: own.id }, bookings: { some: { userId: { not: a.userId } } } });
    const options = [];
    let checks = 0;
    for (const other of candidates) {
      if (other.bookings.some(b => b.userId === a.userId)) continue;
      for (const booking of other.bookings) {
        if (checks >= MAX_CHECKS) break;
        if (booking.userId === a.userId || own.bookings.some(b => b.userId === booking.userId)) continue;
        checks++;
        if ((await exchangeProblems(db, a.orgId, own, a.userId, other, booking.userId, true)).length) continue;
        const view = shiftView(other as ShiftWithRelations, a);
        options.push({
          shiftId: other.id, userId: booking.userId, date: view.date, shiftFrom: other.shiftFrom, shiftTo: other.shiftTo, title: other.title,
          branch: view.branch ? { name: view.branch.name } : null,
          user: can(a, "VIEW_SCHEDULE", other.schedule.branchId) ? { firstName: booking.user.firstName, lastName: booking.user.lastName } : null,
        });
      }
    }
    return { options, limited: checks >= MAX_CHECKS };
  });
}
