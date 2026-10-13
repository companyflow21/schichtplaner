/*
 * Monatsansicht: Entwurfswochen direkt veroeffentlichen, Wochen in Bearbeitung
 * nur mit Sprung in die Woche - statisch gerendert ohne Browser oder Datenbank:
 *   npx tsx tests/month-publish.tsx
 * Den Dialog selbst (Portal, Diff, PATCH) prueft tests/plan-banner.tsx und die
 * Browserpruefung; hier geht es um Sichtbarkeit und Ziel des Knopfs.
 */
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
// Pfad fuer den Ansichtsschalter (usePathname), sonst nur im App Router gesetzt.
import { PathnameContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";
import { MonthGrid, type MonthPlan } from "../src/components/schedule/month-grid";
import { addDate } from "../src/lib/berlin";
import type { ShiftData } from "../src/types/schedule";

let checks = 0;
function check(value: unknown, label: string) { assert.ok(value, label); checks++; console.log("PASS: " + label); }
const count = (html: string, part: string) => html.split(part).length - 1;

const KNOPF = "Veröffentlichen</button>";
const ENTWURF = 'text-warn">Entwurf</p>';
const BEARBEITUNG = 'text-warn">In Bearbeitung</p>';

// --- Oktober 2026 am Standort "nord": KW 40 bis 44 ------------------------------
function schicht(id: string, date: string, isPublic: boolean): ShiftData {
  return { id, date, shiftFrom: "08:00", shiftTo: "16:00", endsNextDay: false, title: "Empfang", bookings: [], occupiedCount: 1, maxEmployees: 1, missing: 0, isPublic } as unknown as ShiftData;
}
const schichten = [schicht("d1", "2026-10-06", false), schicht("d2", "2026-10-07", false), schicht("b1", "2026-10-20", true), schicht("p1", "2026-10-27", true)];
const tage: MonthPlan["days"] = [];
for (let d = "2026-10-01"; d <= "2026-10-31"; d = addDate(d, 1)) {
  tage.push({ date: d, weekday: ((new Date(d + "T12:00:00Z").getUTCDay() + 6) % 7) + 1, isToday: false, shifts: schichten.filter((s) => s.date === d), continuations: [], missing: 0 });
}
const planer: MonthPlan["access"] = { planner: true, edit: true, publish: true, handleRequests: true, manageIssues: false, viewTime: true };
const wochen: MonthPlan["weeks"] = [
  { year: 2026, weekNumber: 40, scheduleId: null, isPublic: null, status: null, shifts: 0 },
  { year: 2026, weekNumber: 41, scheduleId: "plan41", isPublic: false, status: "DRAFT", shifts: 2 },
  { year: 2026, weekNumber: 42, scheduleId: "plan42", isPublic: false, status: "DRAFT", shifts: 0 },
  { year: 2026, weekNumber: 43, scheduleId: "plan43", isPublic: true, status: "EDITING", shifts: 1 },
  { year: 2026, weekNumber: 44, scheduleId: "plan44", isPublic: true, status: "PUBLISHED", shifts: 1 },
];
const monat: MonthPlan = {
  branch: { id: "nord", name: "Objekt Nord", address: null, meetingPoint: null, isActive: true, customer: { id: "k", name: "Kunde Nord" } },
  month: "2026-10", first: "2026-10-01", last: "2026-10-31", today: "2026-10-13",
  days: tage, weeks: wochen,
  totals: { shifts: 4, missing: 0, draftShifts: 2 },
  access: planer,
  issuesOpen: null,
};

function render(plan: MonthPlan) {
  const client = new QueryClient();
  client.setQueryData(["branch-month", "nord", "2026-10"], plan);
  const html = renderToStaticMarkup(
    <PathnameContext.Provider value="/schedule/month/10-2026">
      <QueryClientProvider client={client}><MonthGrid month={10} year={2026} standort="nord" /></QueryClientProvider>
    </PathnameContext.Provider>
  );
  client.clear();
  return html;
}
/** Kalenderzeile einer KW (ab Tablet): vom Wochenlink bis zum naechsten bzw. bis zur Handyliste. */
function zeile(html: string, kw: number) {
  const start = html.indexOf(">" + kw + "</a>");
  assert.ok(start > 0, "KW " + kw + " im Kalender");
  const next = html.indexOf(">" + (kw + 1) + "</a>", start);
  return html.slice(start, next > 0 ? next : html.indexOf("space-y-2 md:hidden", start));
}
/** Handyansicht: alles ab der Tagesliste. */
const handy = (html: string) => html.slice(html.indexOf("space-y-2 md:hidden"));

// --- Planung mit Recht "Dienstplan veröffentlichen" -----------------------------
const voll = render(monat);
const kw41 = zeile(voll, 41), knopf = kw41.slice(kw41.lastIndexOf("<button", kw41.indexOf(KNOPF)), kw41.indexOf(KNOPF));
check(kw41.includes(ENTWURF) && count(kw41, KNOPF) === 1 && kw41.indexOf(ENTWURF) < kw41.indexOf(KNOPF), "Entwurfswoche mit Schichten: Label 'Entwurf' und darunter der Knopf 'Veröffentlichen'");
check(knopf.includes('aria-haspopup="dialog"'), "Knopf öffnet den Veröffentlichen-Dialog");
check(knopf.includes('data-variant="outline"') && !knopf.includes("bg-primary") && knopf.includes("text-xs") && knopf.includes("max-md:min-h-11"), "Knopf: Nebenaktion, 12 px Schrift, mobil 44 px Touchfläche");
check(!zeile(voll, 42).includes(KNOPF) && zeile(voll, 42).includes(ENTWURF), "Entwurf ohne Schichten: Label bleibt, kein Knopf");
const kw43 = zeile(voll, 43);
check(kw43.includes(BEARBEITUNG) && !kw43.includes(ENTWURF), "In Bearbeitung: Label 'In Bearbeitung' (Ton hinweis) statt 'Entwurf'");
check(kw43.includes('href="/schedule/flexible/43-2026?standort=nord"') && kw43.includes("Zur Woche</a>") && !kw43.includes(KNOPF), "In Bearbeitung: Link 'Zur Woche', kein Veröffentlichen aus dem Monat");
check([40, 44].every((kw) => !zeile(voll, kw).includes(ENTWURF) && !zeile(voll, kw).includes(BEARBEITUNG) && !zeile(voll, kw).includes(KNOPF)), "Veröffentlichte Woche und Woche ohne Plan: weder Label noch Knopf");
check(voll.includes("2 im Entwurf – je Woche veröffentlichen</span>"), "Badge mit Zusatz, wenn ein Knopf sichtbar ist");
check(voll.includes("grid-cols-[9rem_repeat(7,minmax(0,1fr))]") && !voll.includes("grid-cols-[4rem"), "KW-Spalte bietet Platz für Knopf und 'In Bearbeitung'");

const mobil = handy(voll);
check(["KW 41", "KW 42", "KW 43"].every((kw) => mobil.includes(">" + kw + "</span>")) && !mobil.includes(">KW 40</span>") && !mobil.includes(">KW 44</span>"), "Handy: Liste der Wochen im Entwurf oder in Bearbeitung");
check(count(mobil, KNOPF) === 1 && count(voll, KNOPF) === 2 && mobil.includes("Zur Woche</a>") && mobil.includes("max-md:min-h-11 max-md:items-center"), "Handy: derselbe Knopf für KW 41 und 'Zur Woche' mit Touchfläche");

// --- Planung ohne Recht "Dienstplan veröffentlichen" -----------------------------
const ohneRecht = render({ ...monat, access: { ...planer, publish: false } });
check(!ohneRecht.includes(KNOPF) && count(ohneRecht, ENTWURF) === 4 && count(ohneRecht, BEARBEITUNG) === 2, "Ohne Veröffentlichen-Recht: Labels bleiben (Kalender und Handy), kein Knopf");
check(ohneRecht.includes("2 im Entwurf</span>") && !ohneRecht.includes("je Woche veröffentlichen"), "Ohne Knopf: Badge ohne Zusatz");

// --- Nur Entwürfe ohne Schichten im Monat ---------------------------------------
const leer = render({ ...monat, weeks: wochen.map((w) => w.status === "EDITING" ? { ...w, isPublic: false, status: "DRAFT" as const, shifts: 0 } : { ...w, shifts: 0 }) });
check(!leer.includes(KNOPF) && !leer.includes("je Woche veröffentlichen") && leer.includes("grid-cols-[4rem_repeat(7,minmax(0,1fr))]"), "Entwürfe ohne Schichten: kein Knopf, kein Zusatz, schmale KW-Spalte wie bisher");

// --- Mitarbeitende -----------------------------------------------------------------
const mitarbeiter: MonthPlan["access"] = { planner: false, edit: false, publish: false, handleRequests: false, manageIssues: false, viewTime: false };
// Wie die API: nur veroeffentlichte Plaene, ohne Lebenszyklus.
const sicht = render({
  ...monat,
  access: mitarbeiter,
  weeks: wochen.map((w) => w.isPublic ? { ...w, status: null } : { ...w, scheduleId: null, isPublic: null, status: null, shifts: 0 }),
  days: tage.map((t) => ({ ...t, shifts: t.shifts.filter((s) => s.isPublic) })),
  totals: { shifts: 2, missing: 0, draftShifts: 0 },
});
check(!sicht.includes(ENTWURF) && !sicht.includes(BEARBEITUNG) && !sicht.includes(KNOPF) && !sicht.includes("Zur Woche") && !sicht.includes("im Entwurf"), "Mitarbeitende: weder Label noch Knopf");
check(!render({ ...monat, access: mitarbeiter }).includes(KNOPF) && !render({ ...monat, access: mitarbeiter }).includes("In Bearbeitung"), "Ohne Planungsrecht zählt der Status nicht, selbst wenn er geliefert würde");

console.log("SUCCESS: " + checks + " Monats-Veröffentlichen-Prüfungen bestanden.");
