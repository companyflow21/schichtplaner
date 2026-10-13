/*
 * PDF-Erzeugung fuer Stundenzettel und Leistungsnachweis (src/lib/timesheet-pdf.ts)
 * ohne Browser: Datei entsteht, ist ein PDF und enthaelt die erwarteten Angaben.
 * Aufruf: npx tsx tests/timesheet-pdf.ts
 */
import assert from "node:assert/strict";
import { siteReportPdf, timesheetPdf } from "../src/lib/timesheet-pdf";

let checks = 0;
function check(value: unknown, message: string) { assert.ok(value, message); checks++; console.log("PASS: " + message); }

async function text(blob: Blob) { return Buffer.from(await blob.arrayBuffer()).toString("latin1"); }

async function main() {
  const sheet = await timesheetPdf({
    organization: "AKRO GmbH", from: "2026-10-01", to: "2026-10-31", openCount: 1, generatedAt: "2026-10-12T10:00:00Z",
    person: { name: "Elke Zweier", personnelNumber: "4711", position: "Empfang" },
    rows: [
      { date: "2026-10-05", site: "Objekt Nord · Kunde Nord", planFrom: "22:00", planTo: "06:00", timeFrom: "22:00", timeTo: "06:00", breakMinutes: 0, minutes: 480, surcharges: [{ name: "Nacht", minutes: 480 }], status: "genehmigt", proof: "GPS-Check-in", comment: null },
      { date: "2026-10-07", site: null, planFrom: null, planTo: null, timeFrom: "08:00", timeTo: "16:30", breakMinutes: 30, minutes: 480, surcharges: [], status: "offen", proof: "manuell", comment: "Übergabe" },
      { date: "2026-10-09", site: "Objekt Nord", planFrom: "08:00", planTo: "16:00", timeFrom: null, timeTo: null, breakMinutes: 0, minutes: 0, surcharges: [], status: "nicht erfasst", proof: null, comment: null },
    ],
    sums: { plannedMinutes: 930, istMinutes: 960, targetMinutes: 9600, surcharges: [{ name: "Nacht", minutes: 480 }] },
  });
  const sheetText = await text(sheet);
  check(sheetText.startsWith("%PDF-"), "timesheet is a PDF");
  for (const expected of ["Stundenzettel", "Elke Zweier", "4711", "Nacht", "16,00", "nicht erfasst", "Unterschrift"]) check(sheetText.includes(expected), "timesheet contains " + expected);

  const site = await siteReportPdf({
    organization: "AKRO GmbH", customer: "Kunde Nord", site: "Objekt Nord", from: "2026-10-01", to: "2026-10-31", generatedAt: "2026-10-12T10:00:00Z",
    rows: [{ date: "2026-10-05", person: "Elke Zweier", activity: "Empfang Nacht", timeFrom: "22:00", timeTo: "06:00", breakMinutes: 0, minutes: 480, status: "genehmigt" }],
    perPerson: [{ name: "Elke Zweier", minutes: 480 }], totalMinutes: 480, openCount: 0,
  });
  const siteText = await text(site);
  check(siteText.startsWith("%PDF-"), "site report is a PDF");
  for (const expected of ["Leistungsnachweis", "Kunde Nord", "Objekt Nord", "8,00", "Auftraggeber"]) check(siteText.includes(expected), "site report contains " + expected);
  console.log("TIMESHEET PDF: " + checks + " checks passed.");
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
