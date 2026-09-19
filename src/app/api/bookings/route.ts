import { z } from "zod";
import { api, body, requireMember, serial, ApiError } from "@/lib/api";
import { assign, notify } from "@/lib/planning";
import { emitToOrg } from "@/lib/emit";

const input = z.object({ shiftId: z.string().min(1), userId: z.string().min(1) });
export async function POST(request: Request) {
  return api(async () => {
    const member = await requireMember(true);
    const data = await body(request, input);
    const booking = await serial(tx => assign(tx, member.organizationId, member.userId, data.shiftId, data.userId));
    emitToOrg(member.organizationId, "booking:changed", { shiftId: data.shiftId });
    return { booking };
  });
}
export async function DELETE(request: Request) {
  return api(async () => {
    const member = await requireMember(true);
    const data = await body(request, input);
    await serial(async tx => {
      const booking = await tx.booking.findFirst({ where: { ...data, shift: { schedule: { organizationId: member.organizationId } } }, include: { shift: { include: { schedule: true } } } });
      if (!booking) throw new ApiError("Zuweisung nicht gefunden.", 404);
      await tx.booking.delete({ where: { id: booking.id } });
      if (booking.shift.schedule.isPublic) await notify(tx, member.organizationId, member.userId, [data.userId], "Schichtzuweisung aufgehoben", "Deine Zuweisung wurde aufgehoben.", data.shiftId);
    });
    emitToOrg(member.organizationId, "booking:changed", { shiftId: data.shiftId });
    return { success: true };
  });
}
export async function PATCH(request: Request) {
  return api(async () => {
    const member = await requireMember();
    const data = await body(request, z.object({ shiftId: z.string() }));
    return serial(async tx => {
      const booking = await tx.booking.findFirst({ where: { shiftId: data.shiftId, userId: member.userId, shift: { deletedAt: null, schedule: { organizationId: member.organizationId, isPublic: true, deletedAt: null } } } });
      if (!booking) throw new ApiError("Schicht nicht gefunden.", 404);
      return { booking: await tx.booking.update({ where: { id: booking.id }, data: { confirmedAt: new Date() } }) };
    });
  });
}
