/**
 * Stundenzettel und Leistungsnachweis als PDF (im Browser erzeugt).
 * Die Daten kommen aus /api/timesheet bzw. /api/timesheet/site.
 */
import type { SiteReport, Timesheet } from "./timesheet";

const hours = (minutes: number) => (minutes / 60).toFixed(2).replace(".", ",");
const day = (date: string) => new Date(date + "T12:00:00Z").toLocaleDateString("de-DE", { timeZone: "UTC", weekday: "short", day: "2-digit", month: "2-digit" });
const longDate = (date: string) => new Date(date + "T12:00:00Z").toLocaleDateString("de-DE", { timeZone: "UTC", day: "2-digit", month: "2-digit", year: "numeric" });
const stamp = (iso: string) => new Date(iso).toLocaleString("de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
const period = (from: string, to: string) => longDate(from) + " – " + longDate(to);

async function document(title: string) {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  doc.setProperties({ title });
  return { doc, autoTable };
}

type Doc = Awaited<ReturnType<typeof document>>["doc"];

function header(doc: Doc, title: string, lines: [string, string][]) {
  doc.setFont("helvetica", "bold"); doc.setFontSize(16); doc.text(title, 14, 16);
  doc.setFont("helvetica", "normal"); doc.setFontSize(9.5);
  lines.forEach(([label, value], i) => { const x = 14 + (i % 3) * 92, y = 24 + Math.floor(i / 3) * 5.5; doc.setTextColor(110); doc.text(label, x, y); doc.setTextColor(20); doc.text(value, x + 28, y); });
  doc.setTextColor(20);
  return 24 + Math.ceil(lines.length / 3) * 5.5 + 2;
}

function footer(doc: Doc, note: string) {
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i); doc.setFontSize(8); doc.setTextColor(120);
    doc.text(note, 14, 203);
    doc.text("Seite " + i + " von " + pages, 283, 203, { align: "right" });
  }
  doc.setTextColor(20);
}

function signatures(doc: Doc, y: number, left: string, right: string) {
  if (y > 175) { doc.addPage(); y = 30; }
  doc.setDrawColor(150);
  doc.line(14, y + 14, 120, y + 14); doc.line(170, y + 14, 283, y + 14);
  doc.setFontSize(8.5); doc.setTextColor(90);
  doc.text("Datum, Unterschrift " + left, 14, y + 19); doc.text("Datum, Unterschrift " + right, 170, y + 19);
  doc.setTextColor(20);
}

/** Stundenzettel einer Person fuer einen Zeitraum. */
export async function timesheetPdf(t: Timesheet): Promise<Blob> {
  const title = "Stundenzettel " + t.person.name;
  const { doc, autoTable } = await document(title);
  const startY = header(doc, "Stundenzettel", [
    ["Name", t.person.name], ["Personalnr.", t.person.personnelNumber ?? "–"], ["Firma", t.organization],
    ["Zeitraum", period(t.from, t.to)], ["Tätigkeit", t.person.position ?? "–"], ["Erstellt", stamp(t.generatedAt)],
  ]);
  const surchargeNames = t.sums.surcharges.map((s) => s.name);
  autoTable(doc, {
    startY, theme: "grid", styles: { fontSize: 8, cellPadding: 1.4, lineColor: 200 }, headStyles: { fillColor: [235, 239, 245], textColor: 20, fontStyle: "bold" },
    head: [["Datum", "Einsatzort", "Plan", "Beginn", "Ende", "Pause", "Std.", ...surchargeNames, "Status", "Nachweis", "Bemerkung"]],
    body: t.rows.map((r) => [
      day(r.date), r.site ?? "–", r.planFrom ? r.planFrom + "–" + r.planTo : "–", r.timeFrom ?? "–", r.timeTo ?? "–",
      r.breakMinutes ? String(r.breakMinutes) : "", r.minutes ? hours(r.minutes) : "",
      ...surchargeNames.map((name) => { const m = r.surcharges.find((s) => s.name === name)?.minutes ?? 0; return m ? hours(m) : ""; }),
      r.status, r.proof ?? "", r.comment ?? "",
    ]),
    foot: [["Summe", "", hours(t.sums.plannedMinutes), "", "", "", hours(t.sums.istMinutes), ...t.sums.surcharges.map((s) => hours(s.minutes)), "", "", ""]],
    footStyles: { fillColor: [235, 239, 245], textColor: 20, fontStyle: "bold" },
    columnStyles: { 6: { halign: "right" } },
  });
  let y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6;
  doc.setFontSize(9);
  const summary = ["Ist " + hours(t.sums.istMinutes) + " h", "Plan " + hours(t.sums.plannedMinutes) + " h", ...(t.sums.targetMinutes !== null ? ["Soll " + hours(t.sums.targetMinutes) + " h"] : [])];
  doc.text(summary.join("   ·   "), 14, y);
  if (t.openCount > 0) { y += 5; doc.setTextColor(170, 90, 0); doc.text(t.openCount + (t.openCount === 1 ? " Buchung ist" : " Buchungen sind") + " noch nicht genehmigt.", 14, y); doc.setTextColor(20); }
  signatures(doc, y + 4, "Mitarbeiter/in", "Arbeitgeber / Objektleitung");
  footer(doc, t.organization + " · Stundenzettel " + t.person.name + " · " + period(t.from, t.to) + " · Stunden dezimal");
  return doc.output("blob");
}

/** Leistungsnachweis je Einsatzort fuer den Kunden. */
export async function siteReportPdf(r: SiteReport): Promise<Blob> {
  const title = "Leistungsnachweis " + r.site;
  const { doc, autoTable } = await document(title);
  const startY = header(doc, "Leistungsnachweis", [
    ["Kunde", r.customer ?? "–"], ["Einsatzort", r.site], ["Auftragnehmer", r.organization],
    ["Zeitraum", period(r.from, r.to)], ["Einsätze", String(r.rows.length)], ["Erstellt", stamp(r.generatedAt)],
  ]);
  autoTable(doc, {
    startY, theme: "grid", styles: { fontSize: 8.5, cellPadding: 1.5, lineColor: 200 }, headStyles: { fillColor: [235, 239, 245], textColor: 20, fontStyle: "bold" },
    head: [["Datum", "Mitarbeiter/in", "Tätigkeit", "Beginn", "Ende", "Pause (Min.)", "Stunden", "Status"]],
    body: r.rows.map((x) => [day(x.date), x.person, x.activity ?? "", x.timeFrom ?? "–", x.timeTo ?? "–", x.breakMinutes ? String(x.breakMinutes) : "", hours(x.minutes), x.status]),
    foot: [["Summe", "", "", "", "", "", hours(r.totalMinutes), ""]],
    footStyles: { fillColor: [235, 239, 245], textColor: 20, fontStyle: "bold" },
    columnStyles: { 6: { halign: "right" } },
  });
  let y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6;
  doc.setFontSize(9);
  doc.text("Stunden je Person: " + r.perPerson.map((p) => p.name + " " + hours(p.minutes) + " h").join(" · "), 14, y, { maxWidth: 269 });
  if (r.openCount > 0) { y += 10; doc.setTextColor(170, 90, 0); doc.text(r.openCount + (r.openCount === 1 ? " Einsatz ist" : " Einsätze sind") + " noch nicht genehmigt.", 14, y); doc.setTextColor(20); }
  signatures(doc, y + 6, "Auftraggeber / Kunde", "Auftragnehmer");
  footer(doc, r.organization + " · Leistungsnachweis " + r.site + " · " + period(r.from, r.to) + " · Stunden dezimal");
  return doc.output("blob");
}

export function download(blob: Blob, filename: string) {
  const href = URL.createObjectURL(blob), link = window.document.createElement("a");
  link.href = href; link.download = filename; link.click();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}
