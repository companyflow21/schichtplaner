import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { api, body, requireMember, serial, ApiError } from "@/lib/api";
import { assertCan, requireAccess, type Access } from "@/lib/access";
import { assertReleasable, assign, findShift, notify, placeBooking, planningPool, shiftLabel, type ShiftWithRelations } from "@/lib/planning";
import { closeOpenRequests, requestParties } from "@/lib/shift-requests";
import { emitToBranch } from "@/lib/emit";

type Tx = Prisma.TransactionClient;
const input = z.object({ shiftId: z.string().min(1), userId: z.string().min(1) });

/**
 * Besetzen: Recht "Schichten bearbeiten" am Standort der Schicht. Manager
 * planen Mitarbeitende dieses Standorts, anderer von ihnen verwalteter
 * Standorte desselben Kunden und persoenlich mit "Einplanen" zugeordnete
 * Personen (planningPool); Admins alle. confirm bestaetigt Hinweise wie eine
 * fehlende Qualifikation; harte Sperren bleiben davon unberuehrt. Die
 * Einteilung ist sofort verbindlich (PLANNER) und aendert die
 * Standortzuordnung der Person nicht.
 * Gleichzeitiges Besetzen kollidiert leicht; die Transaktion (Pruefungen,
 * Buchung, Benachrichtigung) wird dann begrenzt neu ausgefuehrt und sieht
 * die inzwischen gespeicherten Buchungen; das Socket-Signal erst nach dem Commit.
 */
export async function POST(request: Request) {
  return api(async () => {
    const a = await requireAccess();
    const data = await body(request, input.extend({ confirm: z.boolean().optional() }));
    const { booking, shift } = await serial(async tx => {
      const target = await tx.shift.findFirst({ where: { id: data.shiftId, deletedAt: null, schedule: { organizationId: a.orgId, deletedAt: null } }, include: { schedule: true } });
      if (!target) throw new ApiError("Schicht nicht gefunden.", 404);
      assertCan(a, "EDIT_SHIFTS", target.schedule.branchId);
      await assertPool(tx, a, target.schedule.branchId, data.userId);
      return assign(tx, a, data.shiftId, data.userId, data.confirm === true);
    }, { retry: true });
    emitToBranch(a.orgId, shift.schedule.branchId, "booking:changed", [data.userId]);
    return { booking };
  });
}

async function assertPool(tx: Tx, a: Access, branchId: string | null, userId: string) {
  if (!a.isAdmin && !(await planningPool(tx, a, branchId)).has(userId)) throw new ApiError("Diese Person kannst du für diesen Standort nicht einplanen.", 403);
}

/** Schicht mit Recht "Schichten bearbeiten" und bestehender Zuweisung der Person. */
async function editableBooking(tx: Tx, a: Access, shiftId: string, userId: string) {
  const shift = await findShift(tx, a.orgId, shiftId);
  if (!shift) throw new ApiError("Schicht nicht gefunden.", 404);
  assertCan(a, "EDIT_SHIFTS", shift.schedule.branchId);
  return { shift, booking: shift.bookings.find(b => b.userId === userId) };
}

/**
 * Offene Antraege der geloesten Person zu dieser Schicht sind hinfaellig:
 * eigene Antraege auf diese Schicht und Tauschanfragen anderer, die genau
 * diese Zuweisung betreffen.
 */
function releasedRequests(shiftId: string, userId: string): Prisma.ModRequestWhereInput {
  return { OR: [{ shiftId, userId }, { targetShiftId: shiftId, targetUserId: userId }] };
}

/** Kurze Information an weitere Beteiligte geschlossener Antraege. */
async function informParties(tx: Tx, a: Access, shift: ShiftWithRelations, parties: string[]) {
  if (parties.length) await notify(tx, a.orgId, a.userId, parties, "Schichtantrag erledigt", shiftLabel(shift) + ": Die Planung hat die Zuweisung geändert. Ein offener Antrag dazu ist damit erledigt.", shift.id);
}

/**
 * Mitarbeiter wechseln: genau eine Zuweisung atomar ersetzen (auch bei
 * mehreren Plaetzen). Pruefungen wie beim Besetzen; nicht nach Schichtende
 * und nicht nach einem Check-in der ersetzten Person. Scheitert etwas,
 * bleibt die urspruengliche Zuweisung vollstaendig erhalten (Rollback).
 * Offene Antraege der ersetzten Person zu dieser Schicht werden abgelehnt,
 * eine offene Uebernahmeanfrage der neuen Person gilt als erfuellt.
 * Nachrichten (nur veroeffentlichte Plaene): genau eine je Person.
 */
export async function PUT(request: Request) {
  return api(async () => {
    const a = await requireAccess();
    const data = await body(request, input.extend({ replacementUserId: z.string().min(1), confirm: z.boolean().optional() }));
    if (data.replacementUserId === data.userId) throw new ApiError("Bitte eine andere Person auswählen.", 400);
    const result = await serial(async tx => {
      const { shift, booking } = await editableBooking(tx, a, data.shiftId, data.userId);
      await assertPool(tx, a, shift.schedule.branchId, data.replacementUserId);
      if (!booking) throw new ApiError("Zuweisung nicht gefunden.", 404);
      if (shift.bookings.some(b => b.userId === data.replacementUserId)) throw new ApiError("Diese Person ist bereits in der Schicht eingeteilt.", 409);
      await assertReleasable(tx, shift, data.userId);
      await tx.booking.delete({ where: { id: booking.id } });
      const created = await placeBooking(tx, a, { ...shift, bookings: shift.bookings.filter(b => b.id !== booking.id) }, data.replacementUserId, data.confirm === true);
      const closed = [
        ...await closeOpenRequests(tx, a, releasedRequests(shift.id, data.userId), "Zuweisung wurde von der Planung geändert."),
        ...await closeOpenRequests(tx, a, { shiftId: shift.id, userId: data.replacementUserId, kind: "TAKEOVER" }, "Direkt eingeteilt.", "ACCEPTED"),
      ];
      const parties = requestParties(closed, [data.userId, data.replacementUserId]);
      if (shift.schedule.isPublic) {
        await notify(tx, a.orgId, a.userId, [data.userId], "Schichtzuweisung geändert", shiftLabel(shift) + ": Du bist für diese Schicht nicht mehr eingeteilt.", shift.id);
        await notify(tx, a.orgId, a.userId, [data.replacementUserId], "Neue Schicht", shiftLabel(shift) + ": Du bist fest eingeteilt.", shift.id);
        await informParties(tx, a, shift, parties);
      }
      return { booking: created, branchId: shift.schedule.branchId, parties };
    }, { retry: true });
    emitToBranch(a.orgId, result.branchId, "booking:changed", [data.userId, data.replacementUserId, ...result.parties]);
    return { booking: result.booking };
  });
}

/**
 * Zuweisung aufheben - nicht nach Schichtende und nicht nach einem Check-in.
 * Offene Antraege der Person zu dieser Schicht werden in derselben
 * Transaktion abgelehnt; eine Nachricht je Person.
 */
export async function DELETE(request: Request) {
  return api(async () => {
    const a = await requireAccess();
    const data = await body(request, input);
    const result = await serial(async tx => {
      const { shift, booking } = await editableBooking(tx, a, data.shiftId, data.userId);
      if (!booking) throw new ApiError("Zuweisung nicht gefunden.", 404);
      await assertReleasable(tx, shift, data.userId);
      await tx.booking.delete({ where: { id: booking.id } });
      const closed = await closeOpenRequests(tx, a, releasedRequests(shift.id, data.userId), "Zuweisung wurde von der Planung aufgehoben.");
      const parties = requestParties(closed, [data.userId]);
      if (shift.schedule.isPublic) {
        await notify(tx, a.orgId, a.userId, [data.userId], "Schichtzuweisung aufgehoben", shiftLabel(shift) + ": Deine Zuweisung wurde aufgehoben.", shift.id);
        await informParties(tx, a, shift, parties);
      }
      return { branchId: shift.schedule.branchId, parties };
    }, { retry: true });
    emitToBranch(a.orgId, result.branchId, "booking:changed", [data.userId, ...result.parties]);
    return { success: true };
  });
}

/**
 * Eigene, veroeffentlichte Schicht bestaetigen - nur fuer Altbestand ohne
 * Herkunft (confirmation leer). Zuweisungen der Planung (PLANNER) sind
 * bereits verbindlich, selbst bestaetigte (EMPLOYEE) bleiben unveraendert;
 * dann ist die Anfrage ohne Wirkung. Gleichzeitige Bestaetigungen
 * kollidieren leicht; die Transaktion wird dann begrenzt neu ausgefuehrt.
 */
export async function PATCH(request: Request) {
  return api(async () => {
    const member = await requireMember();
    const data = await body(request, z.object({ shiftId: z.string() }));
    const result = await serial(async tx => {
      const booking = await tx.booking.findFirst({ where: { shiftId: data.shiftId, userId: member.userId, shift: { deletedAt: null, schedule: { organizationId: member.organizationId, isPublic: true, deletedAt: null } } }, include: { shift: { include: { schedule: true } } } });
      if (!booking) throw new ApiError("Schicht nicht gefunden.", 404);
      const updated = booking.confirmation ? booking : await tx.booking.update({ where: { id: booking.id }, data: { confirmedAt: new Date(), confirmation: "EMPLOYEE" } });
      return { booking: updated, branchId: booking.shift.schedule.branchId };
    }, { retry: true });
    emitToBranch(member.organizationId, result.branchId, "booking:changed", [member.userId]);
    const b = result.booking;
    return { booking: { id: b.id, shiftId: b.shiftId, userId: b.userId, confirmedAt: b.confirmedAt, confirmation: b.confirmation } };
  });
}
