/*
 * Konfliktmarkierung an der Schichtkarte und Konfliktpanel, statisch
 * gerendert ohne Browser oder Datenbank:
 *   npx tsx tests/conflict-card.tsx
 */
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ShiftCard } from "../src/components/schedule/shift-card";
import { ConflictPanel, konfliktText } from "../src/components/schedule/conflict-panel";
import { isoWeek } from "../src/lib/berlin";
import { shiftView, type ShiftWithRelations } from "../src/lib/planning";
import type { Access } from "../src/lib/access";
import type { ShiftData } from "../src/types/schedule";
import type { ConflictItem } from "../src/types/conflicts";

let checks = 0;
function check(value: unknown, label: string) { assert.ok(value, label); checks++; console.log("PASS: " + label); }
const admin = { isAdmin: true, role: "ADMIN", userId: "admin", branches: new Map(), staff: new Map() } as Access;
const queryClient = new QueryClient();
const date = "2026-10-13", week = isoWeek(date);
const fixture = {
  id: "s1", scheduleId: "plan", dayOfWeek: 2, shiftFrom: "08:00", shiftTo: "16:00", maxEmployees: 2, pauseOption: "PER_SHIFT", pauseValue: 0,
  title: "Testschicht", description: null, requiredQualifications: ["Erste Hilfe"], createdAt: new Date(), deletedAt: null, divisionId: null, division: null,
  schedule: { year: week.year, weekNumber: week.weekNumber, branchId: "nord", isPublic: true, branch: null },
  bookings: [
    { id: "b1", userId: "kai", contractorWorkerId: null, user: { id: "kai", firstName: "Kai", lastName: "Konflikt", profileImage: null } },
    { id: "b2", userId: "lea", contractorWorkerId: null, user: { id: "lea", firstName: "Lea", lastName: "Ruhig", profileImage: null } },
  ],
} as unknown as ShiftWithRelations;
const shift = JSON.parse(JSON.stringify(shiftView(fixture, admin, new Set(["b1"])))) as ShiftData;
const base = { shiftId: "s1", date, bookingId: "b1", personKey: "kai", userId: "kai", name: "Kai Konflikt" };
const absence: ConflictItem = { ...base, severity: "fehler", kind: "absence", text: "Genehmigte Abwesenheit." };
const overlap: ConflictItem = { ...base, severity: "fehler", kind: "overlap", text: "Zeitliche Überschneidung mit einer anderen Schicht.", other: { shiftId: "s9", date: "2026-10-13", from: "12:00", to: "20:00", branchId: "sued", branchName: "Konflikt Süd" } };
const hint: ConflictItem = { ...base, severity: "hinweis", kind: "qualification", text: "Erforderliche Qualifikation fehlt: Erste Hilfe." };

function card(conflicts?: ConflictItem[], extra: Partial<Parameters<typeof ShiftCard>[0]> = {}) {
  return renderToStaticMarkup(<QueryClientProvider client={queryClient}><ShiftCard shift={shift} canEdit onEdit={() => {}} conflicts={conflicts} ankerId={"schicht-" + shift.id} {...extra} /></QueryClientProvider>);
}

// Ohne Konflikte: unveraendert, aber mit Sprungziel; "Nicht verfuegbar" aus dem Plan bleibt.
const plain = card();
check(plain.includes('id="schicht-s1"') && plain.includes("scroll-mt-24"), "Karte traegt die Element-ID als Sprungziel");
check(!plain.includes(">Konflikt</span>") && !plain.includes(">Hinweis<") && !plain.includes("border-destructive/35") && plain.includes("Nicht verfügbar") && plain.includes("Voll besetzt"), "ohne Konflikte: kein Badge, kein roter Rahmen, bestehende Anzeige unveraendert");
check(card(undefined, { ankerId: undefined }).includes("<article aria-label"), "ohne ankerId keine Element-ID");

// Fehler: roter Rahmen (vor dem Warn-Rahmen), Badge "Konflikt", Inline-Text an der betroffenen Zeile.
const red = card([absence, hint]);
check(red.includes("border-destructive/35") && !red.includes("border-warn/40 "), "Konflikt: roter Rahmen hat Vorrang");
check(red.includes(">Konflikt</span>") && !red.includes(">Hinweis</span>"), "Konflikt: Badge 'Konflikt' statt 'Hinweis'");
check(red.includes("Genehmigte Abwesenheit.") && red.includes("Erforderliche Qualifikation fehlt: Erste Hilfe.") && red.includes("text-destructive") && red.includes("text-warn"), "Konflikt: Inline-Texte je Zuweisung mit Farbe nach Schwere");
check(!red.includes("Nicht verfügbar"), "Konflikt: 'Nicht verfuegbar' wird durch den genaueren Konflikttext ersetzt");
check(red.indexOf("Kai Konflikt") < red.indexOf("Genehmigte Abwesenheit.") && red.indexOf("Genehmigte Abwesenheit.") < red.indexOf("Lea Ruhig"), "Konflikt: Inline-Text steht bei der betroffenen Person, nicht bei anderen");

// Nur Hinweise: orangener Rahmen und Badge "Hinweis", kein Rot.
const orange = card([hint]);
check(orange.includes("border-warn/40") && !orange.includes("border-destructive/35"), "Hinweis: Warn-Rahmen, kein roter Rahmen");
check(orange.includes(">Hinweis</span>") && !orange.includes(">Konflikt</span>") && orange.includes("Erforderliche Qualifikation fehlt: Erste Hilfe."), "Hinweis: Badge 'Hinweis' und Inline-Text");
check(orange.includes("Nicht verfügbar"), "Hinweis deckt 'Nicht verfuegbar' nicht ab: bestehende Anzeige bleibt");

// Hervorhebung nach dem Sprung nutzt das vorhandene Muster.
check(card([absence], { hervorheben: true }).includes("ring-primary/20") && !card([absence]).includes("ring-primary/20"), "Hervorhebung nach dem Sprung wie beim Personenfilter");

// Panel: Zaehler, Text je Eintrag, Link zum anderen Standort, Leerzustand.
function panel(items: ConflictItem[]) {
  const counts = { fehler: items.filter((c) => c.severity === "fehler").length, hinweis: items.filter((c) => c.severity === "hinweis").length };
  return renderToStaticMarkup(<ConflictPanel data={{ items, counts }} shifts={[shift]} standort="nord" onSprung={() => {}} />);
}
const full = panel([absence, overlap, hint]);
check(full.includes("2 Konflikte,") && full.includes("1 Hinweis") && full.includes('role="status"') && full.includes('aria-live="polite"'), "Panel: Kopfzeile zaehlt Konflikte und Hinweise als Status");
check(full.includes("Di 13.10., 08:00–16:00 – Genehmigte Abwesenheit.") && full.includes("Zeitliche Überschneidung mit Di 13.10., 12:00–20:00 am Standort Konflikt Süd."), "Panel: Eintraege mit Tag, Zeit und Ursache");
check(full.includes('href="/schedule/flexible/42-2026?standort=sued"') && full.includes("Plan Konflikt Süd öffnen"), "Panel: Link in die Woche des anderen Standorts");
check(konfliktText({ ...overlap, other: { shiftId: "s9", date, from: "12:00", to: "20:00" } }) === "Zeitliche Überschneidung mit Di 13.10., 12:00–20:00 an einem anderen Standort." && !panel([{ ...overlap, other: { shiftId: "s9", date, from: "12:00", to: "20:00" } }]).includes("href="), "Panel: ohne Recht am anderen Standort nur 'anderer Standort' und kein Link");
check(full.includes("<details") && full.includes("<summary") && full.indexOf("2 Konflikte,") < full.indexOf("</summary>") && full.indexOf("Genehmigte Abwesenheit.") > full.indexOf("</summary>"), "Panel: Zähler in der Kopfzeile, Liste je Person aufklappbar");
check(panel([]) === "", "Panel: ohne Befund kein Panel (\"Keine Konflikte\" steht in der Kennwertzeile des Kopfes)");
queryClient.clear();
console.log("SUCCESS: " + checks + " Konfliktkarten-Prüfungen bestanden.");
