import { api, body, requireMember, serial, ApiError } from "@/lib/api";
import { shiftInput, updateShift } from "@/lib/shift-service";
import { notify, shiftInclude } from "@/lib/planning";
import { emitToOrg } from "@/lib/emit";
type Context = { params: Promise<{ id: string }> };
export async function PATCH(request: Request, context: Context) {
  return api(async () => {
    const m = await requireMember(true);
    const { id } = await context.params;
    const data = await body(request, shiftInput.omit({ scheduleId: true, repeatDays: true, repeatWeeks: true }).partial());
    const shift = await serial(tx => updateShift(tx, m.organizationId, m.userId, id, data));
    emitToOrg(m.organizationId, "schedule:updated", { scheduleId: shift.scheduleId });
    return { shift };
  });
}
export async function DELETE(_request: Request, context: Context) {
  return api(async () => {
    const m = await requireMember(true);
    const { id } = await context.params;
    const scheduleId = await serial(async tx => {
      const shift = await tx.shift.findFirst({ where: { id, deletedAt: null, schedule: { organizationId: m.organizationId } }, include: shiftInclude });
      if (!shift) throw new ApiError("Schicht nicht gefunden.", 404);
      if (shift.schedule.isPublic) await notify(tx, m.organizationId, m.userId, shift.bookings.map(b => b.userId), "Schicht abgesagt", "Die Schicht " + (shift.title || "") + " von " + shift.shiftFrom + " bis " + shift.shiftTo + " wurde abgesagt.", id);
      await tx.modRequest.updateMany({ where: { shiftId: id, state: "OPEN" }, data: { state: "DECLINED" } });
      await tx.booking.deleteMany({ where: { shiftId: id } });
      await tx.shift.update({ where: { id }, data: { deletedAt: new Date() } });
      return shift.scheduleId;
    });
    emitToOrg(m.organizationId, "schedule:updated", { scheduleId });
    return { success: true };
  });
}
