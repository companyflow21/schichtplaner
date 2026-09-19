import { api, requireMember, ApiError } from "@/lib/api";
import { isManagerOrAbove } from "@/lib/auth-helpers";
import { monthlyReport, reportPeriod } from "@/lib/report";
function cell(value: string | number) {
  const safe = String(value).replace(/^[=+@\-\t\r]/, "'$&");
  return '"' + safe.replaceAll('"', '""') + '"';
}
export async function GET(request: Request) {
  return api(async () => {
    const m = await requireMember(), { month, year } = reportPeriod(request);
    if (!Number.isInteger(month) || month < 1 || month > 12 || !Number.isInteger(year) || year < 2000 || year > 2100) throw new ApiError("Ungültiger Monat.");
    const report = await monthlyReport(m.organizationId, month, year, isManagerOrAbove(m.role) ? undefined : m.userId);
    const headers = ["Nachname", "Vorname", "Sollstunden", "Geplante Stunden", "Iststunden", "Abweichung Ist/Plan", "Schichten"];
    const hours = (minutes: number) => (minutes / 60).toFixed(2).replace(".", ",");
    const rows = report.employees.map(e => [e.lastName, e.firstName, hours(e.targetMinutes), hours(e.plannedMinutes), hours(e.totalMinutes), hours(e.deviationMinutes), e.shiftCount]);
    return new Response("\uFEFF" + [headers, ...rows].map(row => row.map(cell).join(";")).join("\r\n"), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="Stunden_' + year + '-' + month + '.csv"' } });
  });
}
