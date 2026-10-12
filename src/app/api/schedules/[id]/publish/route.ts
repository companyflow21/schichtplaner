import { z } from "zod";
import { api, body, serial } from "@/lib/api";
import { requireAccess } from "@/lib/access";
import { emitToBranch } from "@/lib/emit";
import { publishPreview, publishSchedule } from "@/lib/publishing";

type Params = { params: Promise<{ id: string }> };

/** Vorschau: Aenderungen seit dem zuletzt gesehenen Stand, Hinweise, Regelverstoesse. */
export async function GET(_request: Request, context: Params) {
  return api(async () => {
    const a = await requireAccess();
    const { id } = await context.params;
    return serial((tx) => publishPreview(tx, a, id));
  });
}

/** Veroeffentlichen; "notify" benachrichtigt (aus der Bearbeitung nur die Betroffenen). */
export async function POST(request: Request, context: Params) {
  return api(async () => {
    const a = await requireAccess();
    const { id } = await context.params;
    const { notify } = await body(request, z.object({ notify: z.boolean().default(true) }));
    const result = await serial((tx) => publishSchedule(tx, a, id, { notify }));
    emitToBranch(a.orgId, result.schedule.branchId, "schedule:updated", result.booked);
    return { schedule: { id: result.schedule.id, isPublic: result.schedule.isPublic, editing: result.schedule.editing }, notified: result.notified };
  });
}
