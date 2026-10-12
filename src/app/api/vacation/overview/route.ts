import { api, ApiError } from "@/lib/api";
import { requireAccess } from "@/lib/access";
import { berlinDate, validDate } from "@/lib/berlin";
import { vacationOverview } from "@/lib/vacation-service";

/** Urlaubskonten des aktuellen Urlaubsjahres - Admins und Manager mit "Abwesenheiten entscheiden". */
export async function GET(request: Request) {
  return api(async () => {
    const a = await requireAccess();
    const date = new URL(request.url).searchParams.get("date") || berlinDate();
    if (!validDate(date)) throw new ApiError("Ungültiges Datum.");
    return vacationOverview(a, date);
  });
}
