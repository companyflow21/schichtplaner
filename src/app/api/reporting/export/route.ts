import { api, ApiError } from "@/lib/api";
import { requireAccess } from "@/lib/access";
import { monthlyReport, reportPeriod } from "@/lib/report";
import { csvFile } from "@/lib/csv";

/** CSV mit genau den Zeilen und Werten, die die Auswertung auch anzeigt. */
export async function GET(request: Request) {
  return api(async () => {
    const a = await requireAccess();
    const { month, year, branchId } = reportPeriod(request);
    if (!Number.isInteger(month) || month < 1 || month > 12 || !Number.isInteger(year) || year < 2000 || year > 2100) throw new ApiError("Ungültiger Monat.");
    const report = await monthlyReport(a, month, year, { branchId, includeFormer: true });
    const headers = ["Nachname", "Vorname", "Sollstunden (Monat)", "Geplante Stunden (veröffentlicht)", "Iststunden", "Abweichung Ist/Plan", "Schichten"];
    const hours = (minutes: number | null) => minutes === null ? "–" : (minutes / 60).toFixed(2).replace(".", ",");
    // Soll: festgelegt -> Wert (auch 0), nicht festgelegt -> leer, nicht sichtbar -> "–".
    const target = (e: (typeof report.employees)[number]) => e.targetStatus === "set" ? hours(e.targetMinutes) : e.targetStatus === "unset" ? "" : "–";
    // Geloeschte Personen stehen mit Name aus der Momentaufnahme und dem Zusatz "(gelöscht)", ohne Soll.
    const rows = report.employees.map((e) => [e.lastName, e.former ? e.firstName + " (gelöscht)" : e.firstName, target(e), hours(e.plannedMinutes), hours(e.totalMinutes), hours(e.deviationMinutes), e.shiftCount]);
    return csvFile([headers, ...rows], "Stunden_" + year + "-" + month + ".csv");
  });
}
