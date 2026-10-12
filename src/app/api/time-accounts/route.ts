import { api, ApiError } from "@/lib/api";
import { requireAccess } from "@/lib/access";
import { berlinDate, validDate } from "@/lib/berlin";
import { accountFor } from "@/lib/time-account-service";

/** Zeitkonto einer Person bis ?to= (Vorgabe heute); ohne ?userId= die eigene Person. */
export async function GET(request: Request) {
  return api(async () => {
    const a = await requireAccess();
    const q = new URL(request.url).searchParams;
    const to = q.get("to") || berlinDate();
    if (!validDate(to)) throw new ApiError("Ungültiges Datum.");
    return accountFor(a, q.get("userId") || a.userId, to);
  });
}
