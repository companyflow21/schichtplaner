import { api, body, serial } from "@/lib/api";
import { requireAccess } from "@/lib/access";
import { createShifts, previewResult, shiftInput } from "@/lib/shift-service";
import { shiftView } from "@/lib/planning";
import { emitToBranch } from "@/lib/emit";

/**
 * Schichten anlegen (optional wiederholt und direkt besetzt, alles oder
 * nichts). preview: true rechnet alles durch und speichert nichts; Antwort
 * { preview: true, occurrences, conflicts, warnings }.
 */
export async function POST(request: Request) {
  return api(async () => {
    const a = await requireAccess();
    const data = await body(request, shiftInput);
    if (data.preview) return serial(tx => createShifts(tx, a, data)).catch(previewResult);
    const shifts = await serial(tx => createShifts(tx, a, data), { retry: true });
    // Mit Einteilungen erfahren es auch die eingeteilten Personen.
    emitToBranch(a.orgId, shifts[0]?.schedule.branchId ?? null, data.assignees.length ? "booking:changed" : "schedule:updated", data.assignees);
    return { shifts: shifts.map(s => shiftView(s, a)) };
  });
}
