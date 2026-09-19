import { api, body, requireMember, serial } from "@/lib/api";
import { createShifts, shiftInput } from "@/lib/shift-service";
import { emitToOrg } from "@/lib/emit";
export async function POST(request: Request) {
  return api(async () => {
    const m = await requireMember(true);
    const data = await body(request, shiftInput);
    const shifts = await serial(tx => createShifts(tx, m.organizationId, m.userId, data));
    emitToOrg(m.organizationId, "schedule:updated", { scheduleId: data.scheduleId });
    return { shifts };
  });
}
