import { z } from "zod";
import { api, body, requireMember, serial, ApiError } from "@/lib/api";
import { validDate, isoWeek } from "@/lib/berlin";
import { createShifts, shiftInput } from "@/lib/shift-service";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return api(async () => {
    const m = await requireMember(true), { id } = await context.params;
    const data = await body(request, z.object({ date: z.string().refine(validDate) }));
    return serial(async tx => {
      const source = await tx.shift.findFirst({ where: { id, deletedAt: null, schedule: { organizationId: m.organizationId, deletedAt: null } } });
      if (!source) throw new ApiError("Schicht nicht gefunden.", 404);
      const week = isoWeek(data.date);
      let schedule = await tx.schedule.findFirst({ where: { ...week, organizationId: m.organizationId, branchId: null, deletedAt: null } });
      if (!schedule) schedule = await tx.schedule.create({ data: { ...week, organizationId: m.organizationId } });
      const input = shiftInput.parse({ ...source, scheduleId: schedule.id, dayOfWeek: ((new Date(data.date).getUTCDay() + 6) % 7) + 1 });
      return { shifts: await createShifts(tx, m.organizationId, m.userId, input) };
    });
  });
}
