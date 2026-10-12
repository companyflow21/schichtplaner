import { api, serial } from "@/lib/api";
import { requireAccess } from "@/lib/access";
import { emitToBranch } from "@/lib/emit";
import { startEditing } from "@/lib/publishing";

/** Bearbeitungsmodus starten: Mitarbeitende sehen bis zum erneuten Veroeffentlichen den bisherigen Stand. */
export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  return api(async () => {
    const a = await requireAccess();
    const { id } = await context.params;
    const { schedule } = await serial((tx) => startEditing(tx, a, id));
    emitToBranch(a.orgId, schedule.branchId, "schedule:updated", []);
    return { schedule: { id: schedule.id, isPublic: schedule.isPublic, editing: schedule.editing } };
  });
}
