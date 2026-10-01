import { api } from "@/lib/api";
import { db } from "@/lib/db";
import { requireAccess } from "@/lib/access";
import { deletionPreview } from "@/lib/employee-delete";

type Context = { params: Promise<{ id: string }> };

/**
 * Vorschau fuer die Sicherheitsabfrage vor dem Loeschen: Name, kuenftige
 * Einsaetze, was als Historie bleibt und was das Loeschen derzeit blockiert.
 * Gleiche Rechte wie DELETE /api/employees/[id]; aendert nichts.
 */
export async function GET(_request: Request, context: Context) {
  return api(async () => {
    const a = await requireAccess();
    return deletionPreview(db, a, (await context.params).id);
  });
}
