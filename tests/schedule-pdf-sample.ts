/*
 * Beispiel-PDF eines ganzen Monatsplans mit dem echten Builder und dem echten
 * Logo: npx tsx tests/schedule-pdf-sample.ts <ausgabe.pdf>
 * Prueft Seitenzahl, Dateiname und den leeren Zeitraum; die Optik beurteilt
 * man am erzeugten PDF (z. B. pdftoppm -png -r 60).
 */
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { addDate } from "../src/lib/berlin";
import { buildSchedulePdf, schedulePdfFileName } from "../src/lib/pdf/schedule-pdf";
import type { ScheduleExport, ScheduleExportRow } from "../src/types/schedule-export";

const out = resolve(process.argv[2] ?? "schedule-sample.pdf");
const logoPng = "data:image/png;base64," + readFileSync("public/akro/img/app-icon-192.png").toString("base64");

// Feste Zufallsfolge, damit das Beispiel reproduzierbar bleibt.
let seed = 20261001;
const random = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
const pick = <T,>(list: T[]) => list[Math.floor(random() * list.length)];

const WEEKDAYS = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"];
const people = [
  "Anna Nordplan", "Bernd Südplan", "Çiğdem Öztürk", "Dieter Müller-Lüdenscheidt", "Emil Einser", "Elke Zweier", "Fatima Al-Hassan", "Gerhard Weißenborn",
  "Hannah Schröder", "Ivana Kovačević", "Jonas Böhm", "Katharina von Hohenzollern-Sigmaringen", "Lukas Meyer", "Mara Jäger", "Nils Größer", "Olga Petrowna",
  "Paul Schäfer", "Quirin Fuchs", "Rosa Lindqvist", "Sven Thießen", "Tamara Brückner", "Uwe Köhler", "Vera Blick", "Wolfgang Straßer", "Yasmin Çelik", "Zoran Đorđević",
];
const sites = [
  { branch: "Hauptlager Nord", customer: "Müller Logistik GmbH" },
  { branch: "Umschlagplatz Ost", customer: "Müller Logistik GmbH" },
  { branch: "Verwaltungsgebäude", customer: "Stadtwerke Nordhausen" },
  { branch: "Heizkraftwerk Süd", customer: "Stadtwerke Nordhausen" },
  { branch: "Klinikum Südstadt – Haupteingang und Notaufnahme", customer: "Klinikum Südstadt gGmbH" },
  { branch: "Einkaufszentrum Am Hafen", customer: "Hafen-Center Betriebs KG" },
  { branch: "Terminal 2 Sicherheitskontrolle", customer: "Flughafen Service AG" },
];
const shifts = [
  { title: "Frühdienst", from: "06:00", to: "14:00", next: false },
  { title: "Spätdienst", from: "14:00", to: "22:00", next: false },
  { title: "Nachtdienst", from: "22:00", to: "06:00", next: true },
  { title: "Objektschutz", from: "08:00", to: "16:30", next: false },
  { title: "Empfang und Pforte", from: "07:30", to: "15:30", next: false },
  { title: "Revierdienst / Streife", from: "18:00", to: "02:00", next: true },
];

const from = "2026-10-01", to = "2026-10-31";
const rows: ScheduleExportRow[] = [];
for (let date = from; date <= to; date = addDate(date, 1)) {
  const weekday = WEEKDAYS[(new Date(date + "T12:00:00Z").getUTCDay() + 6) % 7];
  const count = 6 + Math.floor(random() * 5);
  for (let i = 0; i < count; i++) {
    const site = pick(sites), shift = pick(shifts);
    const places = random() < 0.3 ? 2 + Math.floor(random() * 6) : 1;
    const assignedCount = Math.min(places, Math.floor(random() * (places + 2)));
    const assigned = [...people].sort(() => random() - 0.5).slice(0, assignedCount).sort().map(n => (random() < 0.03 ? n + " (gelöscht)" : n));
    const hiddenOnly = random() < 0.04;
    rows.push({
      date, weekday, shiftFrom: shift.from, shiftTo: shift.to, endsNextDay: shift.next, title: random() < 0.05 ? "" : shift.title,
      branch: site.branch, customer: site.customer,
      assigned: hiddenOnly ? [] : assigned, occupied: assignedCount, places, open: places - assignedCount, isPublic: random() > 0.06,
    });
  }
}
rows.sort((x, y) => x.date.localeCompare(y.date) || x.shiftFrom.localeCompare(y.shiftFrom) || x.branch.localeCompare(y.branch, "de"));

const data: ScheduleExport = {
  period: { from, to }, filters: {}, generatedAt: "2026-10-01T12:34:00Z",
  people: [], customers: [], branches: [], rows,
};

const doc = buildSchedulePdf(data, { logoPng });
const pages = doc.getNumberOfPages();
assert.ok(pages > 1, "Monatsplan umfasst mehrere Seiten, hat " + pages);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, Buffer.from(doc.output("arraybuffer")));
console.log("PASS: Monatsplan mit " + rows.length + " Schichten auf " + pages + " Seiten -> " + out);

// Dateiname: nur sichere Zeichen, Standort vor Kunde vor Alle.
const named = (filters: ScheduleExport["filters"]) => schedulePdfFileName({ ...data, filters });
assert.equal(named({}), "AKRO-Dienstplan_Alle_2026-10-01_2026-10-31.pdf");
assert.equal(named({ customer: "Müller & Söhne GmbH" }), "AKRO-Dienstplan_Mueller-Soehne-GmbH_2026-10-01_2026-10-31.pdf");
assert.equal(named({ customer: "Kunde", branch: "Süd/Nord: Eingang \"1\"" }), "AKRO-Dienstplan_Sued-Nord-Eingang-1_2026-10-01_2026-10-31.pdf");
console.log("PASS: Dateiname");

// Leerer Zeitraum: eine Seite mit Hinweis.
const empty = buildSchedulePdf({ ...data, rows: [] }, { logoPng });
assert.equal(empty.getNumberOfPages(), 1);
writeFileSync(out.replace(/\.pdf$/, "") + "-leer.pdf", Buffer.from(empty.output("arraybuffer")));
console.log("PASS: leerer Zeitraum");

// Gefilterter Auszug mit Entwurf und nicht sichtbaren Namen.
const small = buildSchedulePdf({ ...data, filters: { branch: "Hauptlager Nord", customer: "Müller Logistik GmbH", person: "Anna Nordplan" }, rows: rows.slice(0, 5) });
assert.equal(small.getNumberOfPages(), 1);
console.log("PASS: kurzer Auszug ohne Logo");
