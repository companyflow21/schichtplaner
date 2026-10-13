import { api } from "@/lib/api";
import { requireAccess } from "@/lib/access";
import { berlinDate } from "@/lib/berlin";
import { csvFile } from "@/lib/csv";
import { formatNumber, hours } from "@/lib/payroll";
import { payrollPeriod, payrollReport } from "@/lib/payroll-service";

/**
 * Lohnexport als CSV fuer die Lohnsoftware: eine Zeile je Person und Lohnart
 * bzw. Zuschlag. ?saetze=0 laesst Saetze und Betraege weg (nur Stunden).
 * ?ohne=key,key nimmt Personen aus (key der Lohnseite: userId bzw. "former:" + Id
 * fuer geloeschte Personen, die ohne Personalnummer mit ihrem Namen erscheinen).
 * Nachname und Vorname bleiben getrennte Spalten fuer die Lohnsoftware. Nur Admins.
 */
export async function GET(request: Request) {
  return api(async () => {
    const a = await requireAccess();
    const { from, to, branchId } = payrollPeriod(request, berlinDate());
    const q = new URL(request.url).searchParams;
    const withRates = q.get("saetze") !== "0";
    const skip = new Set((q.get("ohne") ?? "").split(",").filter(Boolean));
    const report = await payrollReport(a, from, to, branchId);
    const euros = (cents: number | null) => (cents === null ? "" : (cents / 100).toFixed(2).replace(".", ","));
    const header = ["Personalnummer", "Nachname", "Vorname", "Art", "Bezeichnung", "Lohnart-Code", "Stunden", ...(withRates ? ["Satz", "Satz je Stunde (EUR)", "Betrag (EUR)"] : [])];
    const rows = report.people
      .filter((p) => !skip.has(p.key) && p.minutes > 0)
      .flatMap((p) => p.lines.filter((l) => l.minutes > 0).map((l) => [
        p.personnelNumber ?? "", p.lastName, p.firstName, l.kind === "BASE" ? "Lohnart" : l.kind === "ABSENCE" ? "Abwesenheit" : "Zuschlag", l.title, l.code ?? "", hours(l.minutes),
        ...(withRates ? [l.percent !== null ? formatNumber(l.percent / 100) + " %" : "", euros(l.rateCents === null ? null : Math.round(l.rateCents)), euros(l.amountCents)] : []),
      ]));
    return csvFile([header, ...rows], "Lohn_" + from + "_" + to + ".csv");
  });
}
