import { api, body, serial, ApiError } from "@/lib/api";
import { requireAccess } from "@/lib/access";
import { shiftPatch, updateShift } from "@/lib/shift-service";
import { notify, personIds, shiftView } from "@/lib/planning";
import { loadShiftForDelete, openRequestsOf, shiftDeletion } from "@/lib/shift-delete";
import { closeOpenRequests, requestParties } from "@/lib/shift-requests";
import { shiftRange } from "@/lib/berlin";
import { emitToBranch, emitToUsers } from "@/lib/emit";
import { isEditing, notifiesEmployees } from "@/lib/schedule-status";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: Context) {
  return api(async () => {
    const a = await requireAccess();
    const { id } = await context.params;
    const data = await body(request, shiftPatch);
    const { shift, previousBranchId } = await serial(tx => updateShift(tx, a, id, data), { retry: true });
    const affected = personIds(shift.bookings);
    emitToBranch(a.orgId, shift.schedule.branchId, "schedule:updated", affected);
    if (previousBranchId !== shift.schedule.branchId) emitToBranch(a.orgId, previousBranchId, "schedule:updated");
    return { shift: shiftView(shift, a) };
  });
}

/**
 * Schicht loeschen: nur wenn sie noch nicht begonnen hat und weder Check-in
 * noch Arbeitszeiten haengen (lib/shift-delete.ts), auch fuer Admins.
 * Alle offenen Antraege, die die Schicht nennen (eigene oder Gegen-Schicht
 * eines Tauschs), werden geschlossen; Zuweisungen entfallen. Je Person eine Nachricht.
 * Waehrend der Bearbeitung des Plans keine Nachricht; offene Antraege bleiben
 * bis zur Veroeffentlichung offen (beim Verwerfen kehrt die Schicht zurueck).
 */
export async function DELETE(_request: Request, context: Context) {
  return api(async () => {
    const a = await requireAccess();
    const { id } = await context.params;
    const result = await serial(async tx => {
      const shift = await loadShiftForDelete(tx, a, id);
      const check = await shiftDeletion(tx, a.orgId, shift);
      if (!check.deletable) throw new ApiError(check.reason!, 409);
      const closed = isEditing(shift.schedule) ? [] : await closeOpenRequests(tx, a, openRequestsOf(id), "Schicht wurde abgesagt.");
      const booked = personIds(shift.bookings);
      const when = shiftRange(shift).date.split("-").reverse().join(".") + ", " + shift.shiftFrom + "–" + shift.shiftTo;
      const informed = notifiesEmployees(shift.schedule) ? await notify(tx, a.orgId, a.userId, booked, "Schicht abgesagt", "Die Schicht " + (shift.title || "") + " von " + shift.shiftFrom + " bis " + shift.shiftTo + " wurde abgesagt.", id) : [];
      // Beteiligte der geschlossenen Antraege, die nicht schon als Eingeteilte Bescheid wissen.
      const parties = requestParties(closed, [...informed, a.userId]);
      const voided = await notify(tx, a.orgId, a.userId, parties, "Antrag hinfällig", "Dein Antrag wurde geschlossen, weil die Schicht am " + when + " abgesagt wurde.", id);
      // Alle Zuweisungen zaehlen, auch Subunternehmer-Platzhalter ohne Konto.
      const removed = await tx.booking.deleteMany({ where: { shiftId: id } });
      await tx.shift.update({ where: { id }, data: { deletedAt: new Date() } });
      return { shift, booked, removed: removed.count, notified: [...informed, ...voided], requestsClosed: closed.length };
    }, { retry: true });
    emitToBranch(a.orgId, result.shift.schedule.branchId, "schedule:updated", result.booked);
    emitToUsers(result.notified, "message:new");
    return { success: true, assignmentsRemoved: result.removed, requestsClosed: result.requestsClosed };
  });
}
