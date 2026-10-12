import { api, ApiError } from "@/lib/api";
import { requireAccess } from "@/lib/access";
import { berlinDate, validDate } from "@/lib/berlin";
import { vacationCost, vacationFor } from "@/lib/vacation-service";

/**
 * Urlaubskonto einer Person (?userId=, Vorgabe die eigene) zum Stichtag ?date=
 * (Vorgabe heute). Mit ?from=&to= zusaetzlich die Tage, die dieser Zeitraum abzieht.
 */
export async function GET(request: Request) {
  return api(async () => {
    const a = await requireAccess();
    const q = new URL(request.url).searchParams;
    const date = q.get("date") || berlinDate();
    if (!validDate(date)) throw new ApiError("Ungültiges Datum.");
    const view = await vacationFor(a, q.get("userId") || a.userId, date);
    const from = q.get("from"), to = q.get("to");
    const cost = view.active && from && to && validDate(from) && validDate(to) && from <= to ? await vacationCost(a.orgId, from, to) : null;
    return { ...view, cost };
  });
}
