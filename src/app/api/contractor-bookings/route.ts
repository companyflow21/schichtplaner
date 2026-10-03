import { z } from "zod";
import { api, body, serial, ApiError } from "@/lib/api";
import { assertCan, requireAccess, requireAdmin } from "@/lib/access";
import { findShift, placeContractorBooking, shiftEnded } from "@/lib/planning";
import { emitToBranch } from "@/lib/emit";

const input = z.strictObject({ shiftId: z.string().min(1), contractorWorkerId: z.string().min(1) });

/** Platzhalter nur durch Administration einteilen; Kapazitaet und Konflikte atomar pruefen. */
export async function POST(request: Request) {
  return api(async () => {
    const a = await requireAccess();
    requireAdmin(a);
    const data = await body(request, input.extend({ confirm: z.boolean().optional() }));
    const result = await serial(async tx => {
      const shift = await findShift(tx, a.orgId, data.shiftId);
      if (!shift) throw new ApiError("Schicht nicht gefunden.", 404);
      assertCan(a, "EDIT_SHIFTS", shift.schedule.branchId);
      const booking = await placeContractorBooking(tx, a, shift, data.contractorWorkerId, data.confirm === true);
      return { booking, branchId: shift.schedule.branchId };
    }, { retry: true });
    emitToBranch(a.orgId, result.branchId, "booking:changed");
    return { booking: result.booking };
  });
}

/** Vergangene Sub-Einsaetze bleiben als Nachweis erhalten. */
export async function DELETE(request: Request) {
  return api(async () => {
    const a = await requireAccess();
    requireAdmin(a);
    const data = await body(request, input);
    const result = await serial(async tx => {
      const shift = await findShift(tx, a.orgId, data.shiftId);
      if (!shift) throw new ApiError("Schicht nicht gefunden.", 404);
      assertCan(a, "EDIT_SHIFTS", shift.schedule.branchId);
      const booking = shift.bookings.find(b => b.contractorWorkerId === data.contractorWorkerId);
      if (!booking) throw new ApiError("Zuweisung nicht gefunden.", 404);
      if (shiftEnded(shift)) throw new ApiError("Die Schicht ist bereits beendet. Zuweisungen vergangener Schichten bleiben als Nachweis unverändert.", 409);
      await tx.booking.delete({ where: { id: booking.id } });
      return { branchId: shift.schedule.branchId };
    }, { retry: true });
    emitToBranch(a.orgId, result.branchId, "booking:changed");
    return { success: true };
  });
}
