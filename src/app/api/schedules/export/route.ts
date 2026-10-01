import { api, serial } from "@/lib/api";
import { requireAccess } from "@/lib/access";
import { parseExportQuery, scheduleExport } from "@/lib/schedule-export";

/**
 * Datengrundlage fuer das Dienstplan-PDF (?from=&to=, optional customerId,
 * branchId, userId). Das PDF selbst entsteht im Browser - hier verlassen nur
 * die ohnehin sichtbaren Plandaten den Server.
 */
export async function GET(request: Request) {
  return api(async () => {
    const a = await requireAccess();
    const q = parseExportQuery(new URL(request.url).searchParams);
    return serial(tx => scheduleExport(tx, a, q));
  });
}
