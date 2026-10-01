import { api } from "@/lib/api";
import { db } from "@/lib/db";
import { requireAccess } from "@/lib/access";
import { loadShiftForDelete, shiftDeletion } from "@/lib/shift-delete";

type Context = { params: Promise<{ id: string }> };

/**
 * Vorschau zum Loeschen einer Schicht: darf sie geloescht werden (sonst mit
 * Grund), wie viele Zuweisungen entfallen, wie viele offene Antraege
 * geschlossen werden. Gleiche Rechte wie DELETE /api/shifts/[id].
 */
export async function GET(_request: Request, context: Context) {
  return api(async () => {
    const a = await requireAccess();
    const shift = await loadShiftForDelete(db, a, (await context.params).id);
    return shiftDeletion(db, a.orgId, shift);
  });
}
