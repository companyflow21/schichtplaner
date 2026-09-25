import { z } from "zod";
import { api, body, requireMember, serial, ApiError } from "@/lib/api";
import { assertCan, requireAccess } from "@/lib/access";
import { assign, notify, planningPool } from "@/lib/planning";
import { emitToBranch } from "@/lib/emit";
import { idempotencyKeyHeader, rememberRejection, rememberResponse, replay, storedResponse } from "@/lib/idempotency";

const input = z.object({ shiftId: z.string().min(1), userId: z.string().min(1) });

/**
 * Besetzen: Recht "Schichten bearbeiten" am Standort der Schicht. Manager
 * planen Mitarbeitende dieses Standorts, anderer von ihnen verwalteter
 * Standorte desselben Kunden und persoenlich mit "Einplanen" zugeordnete
 * Personen (planningPool); Admins alle. confirm bestaetigt Hinweise wie eine
 * fehlende Qualifikation; harte Sperren bleiben davon unberuehrt. Die
 * Einteilung aendert die Standortzuordnung der Person nicht.
 * Gleichzeitiges Besetzen kollidiert leicht; der Datenbank-Client fuehrt die
 * Transaktion (Pruefungen, Buchung, Benachrichtigung) dann begrenzt neu aus,
 * sie sieht die inzwischen gespeicherten Buchungen. Das Socket-Signal folgt
 * erst nach dem Commit.
 * Mit Header "Idempotency-Key" (UUIDv4) erhalten Wiederholungen derselben
 * Anfrage das erste Ergebnis (200 oder endgueltige 409), ohne erneut zu buchen.
 */
export async function POST(request: Request) {
  return api(async () => {
    const a = await requireAccess();
    const data = await body(request, input.extend({ confirm: z.boolean().optional() }));
    const key = idempotencyKeyHeader(request);
    const idem = key ? { organizationId: a.orgId, userId: a.userId, scope: "POST /api/bookings", key, fingerprint: data.shiftId + ":" + data.userId } : null;
    try {
      const result = await serial(async tx => {
        const stored = idem && await storedResponse(tx, idem);
        if (stored) return { replayed: true as const, stored };
        const target = await tx.shift.findFirst({ where: { id: data.shiftId, deletedAt: null, schedule: { organizationId: a.orgId, deletedAt: null } }, include: { schedule: true } });
        if (!target) throw new ApiError("Schicht nicht gefunden.", 404);
        assertCan(a, "EDIT_SHIFTS", target.schedule.branchId);
        if (!a.isAdmin && !(await planningPool(tx, a, target.schedule.branchId)).has(data.userId)) throw new ApiError("Diese Person kannst du für diesen Standort nicht einplanen.", 403);
        const { booking, shift } = await assign(tx, a, data.shiftId, data.userId, data.confirm === true);
        if (idem) await rememberResponse(tx, idem, 200, { booking });
        return { replayed: false as const, booking, shift };
      });
      if (result.replayed) return replay(result.stored);
      emitToBranch(a.orgId, result.shift.schedule.branchId, "booking:changed", [data.userId]);
      return { booking: result.booking };
    } catch (error) {
      // Endgueltige fachliche Ablehnung (etwa "Schicht ist bereits besetzt.") fuer
      // diesen Key merken; Rueckfragen zu Hinweisen (confirm) bleiben offen.
      if (idem && error instanceof ApiError && error.status === 409 && !error.details?.confirm) {
        await rememberRejection(idem, 409, { error: error.message }).catch(e => console.error("Idempotency-Key nicht gespeichert", e));
      }
      throw error;
    }
  });
}

export async function DELETE(request: Request) {
  return api(async () => {
    const a = await requireAccess();
    const data = await body(request, input);
    const branchId = await serial(async tx => {
      const booking = await tx.booking.findFirst({ where: { ...data, shift: { schedule: { organizationId: a.orgId } } }, include: { shift: { include: { schedule: true } } } });
      if (!booking) throw new ApiError("Zuweisung nicht gefunden.", 404);
      assertCan(a, "EDIT_SHIFTS", booking.shift.schedule.branchId);
      await tx.booking.delete({ where: { id: booking.id } });
      if (booking.shift.schedule.isPublic) await notify(tx, a.orgId, a.userId, [data.userId], "Schichtzuweisung aufgehoben", "Deine Zuweisung wurde aufgehoben.", data.shiftId);
      return booking.shift.schedule.branchId;
    });
    emitToBranch(a.orgId, branchId, "booking:changed", [data.userId]);
    return { success: true };
  });
}

/** Eigene, veroeffentlichte Schicht bestaetigen. */
export async function PATCH(request: Request) {
  return api(async () => {
    const member = await requireMember();
    const data = await body(request, z.object({ shiftId: z.string() }));
    const result = await serial(async tx => {
      const booking = await tx.booking.findFirst({ where: { shiftId: data.shiftId, userId: member.userId, shift: { deletedAt: null, schedule: { organizationId: member.organizationId, isPublic: true, deletedAt: null } } }, include: { shift: { include: { schedule: true } } } });
      if (!booking) throw new ApiError("Schicht nicht gefunden.", 404);
      const updated = await tx.booking.update({ where: { id: booking.id }, data: { confirmedAt: new Date() } });
      return { booking: updated, branchId: booking.shift.schedule.branchId };
    });
    emitToBranch(member.organizationId, result.branchId, "booking:changed", [member.userId]);
    return { booking: { id: result.booking.id, shiftId: result.booking.shiftId, userId: result.booking.userId, confirmedAt: result.booking.confirmedAt } };
  });
}
