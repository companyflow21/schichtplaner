import { api, body, serial } from "@/lib/api";
import { requireAccess } from "@/lib/access";
import { copyInput, copyShift, previewResult } from "@/lib/shift-service";
import { personIds, shiftView } from "@/lib/planning";
import { emitToBranch } from "@/lib/emit";

/**
 * Kopie auf einen oder mehrere Tage - immer am Standort der Ausgangsschicht.
 * { dates: [...], withAssignments?, confirm?, preview? } oder wie bisher
 * { date }. Alles oder nichts; preview speichert nichts und meldet zusaetzlich
 * gleiche, schon vorhandene Schichten (occurrences[].duplicate).
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return api(async () => {
    const a = await requireAccess();
    const { id } = await context.params;
    const data = await body(request, copyInput);
    if (data.preview) return serial(tx => copyShift(tx, a, id, data)).catch(previewResult);
    const shifts = await serial(tx => copyShift(tx, a, id, data), { retry: true });
    const assigned = [...new Set(shifts.flatMap(s => personIds(s.bookings)))];
    emitToBranch(a.orgId, shifts[0]?.schedule.branchId ?? null, assigned.length ? "booking:changed" : "schedule:updated", assigned);
    return { shifts: shifts.map(s => shiftView(s, a)) };
  });
}
