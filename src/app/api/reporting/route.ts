import { api, requireMember, ApiError } from "@/lib/api";
import { isManagerOrAbove } from "@/lib/auth-helpers";
import { monthlyReport, reportPeriod } from "@/lib/report";
export async function GET(request: Request) {
  return api(async () => {
    const m = await requireMember(), { month, year } = reportPeriod(request);
    if (!Number.isInteger(month) || month < 1 || month > 12 || !Number.isInteger(year) || year < 2000 || year > 2100) throw new ApiError("Ungültiger Monat.");
    return monthlyReport(m.organizationId, month, year, isManagerOrAbove(m.role) ? undefined : m.userId);
  });
}
