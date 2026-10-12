import { api, ApiError } from "@/lib/api";
import { requireAccess } from "@/lib/access";
import { berlinDate } from "@/lib/berlin";
import { payrollPeriod } from "@/lib/payroll-service";
import { siteReport } from "@/lib/timesheet";

/** Leistungsnachweis je Einsatzort: ?standort= ist Pflicht; sichtbar mit "Zeiterfassung einsehen" am Standort. */
export async function GET(request: Request) {
  return api(async () => {
    const a = await requireAccess();
    const { from, to, branchId } = payrollPeriod(request, berlinDate());
    if (!branchId) throw new ApiError("Bitte einen Einsatzort wählen.");
    return siteReport(a, branchId, from, to);
  });
}
