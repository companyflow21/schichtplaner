import { api } from "@/lib/api";
import { requireAccess } from "@/lib/access";
import { berlinDate } from "@/lib/berlin";
import { payrollPeriod } from "@/lib/payroll-service";
import { timesheet } from "@/lib/timesheet";

/** Stundenzettel: ?userId= (ohne Angabe die eigene Person) und Zeitraum wie "Stunden und Lohn". */
export async function GET(request: Request) {
  return api(async () => {
    const a = await requireAccess();
    const { from, to } = payrollPeriod(request, berlinDate());
    const userId = new URL(request.url).searchParams.get("userId") || a.userId;
    return timesheet(a, userId, from, to);
  });
}
