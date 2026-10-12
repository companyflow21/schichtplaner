/*
 * Plan in Bearbeitung aus Sicht der Mitarbeitenden: Schichtkarte, "Mein
 * Dienstplan" und Startseite nennen den Grund, warum Antraege, Tausch und
 * Bestaetigen fehlen - die Planung sieht keinen dieser Hinweise. Statisch
 * gerendert mit echten API-Ansichten (shiftView), ohne Browser oder Datenbank:
 *   npx tsx tests/requests-paused.tsx
 */
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ShiftCard } from "../src/components/schedule/shift-card";
import { EmployeeGrid } from "../src/components/schedule/employee-grid";
import { Dashboard } from "../src/components/workforce/dashboard";
import { isoWeek, weekDate } from "../src/lib/berlin";
import { shiftView, type ShiftWithRelations } from "../src/lib/planning";
import type { Access } from "../src/lib/access";
import type { ShiftData } from "../src/types/schedule";

let checks = 0;
function check(value: unknown, label: string) { assert.ok(value, label); checks++; console.log("PASS: " + label); }

const KARTE = "Anträge und Tausch sind bis zur Veröffentlichung dieser Woche gesperrt.";
const WOCHE = "Diese Woche wird gerade überarbeitet: Du siehst den zuletzt veröffentlichten Stand; Anträge, Tausch und Bestätigen sind bis zur Veröffentlichung gesperrt.";
const count = (html: string, text: string) => html.split(text).length - 1;

const admin = { isAdmin: true, role: "ADMIN", userId: "admin", branches: new Map(), staff: new Map() } as Access;
// Mitarbeiterin mit "Offene Schichten sehen und anfragen" am Standort, ohne Planungsrechte.
const employee = { isAdmin: false, role: "EMPLOYEE", userId: "ella", branches: new Map([["site", new Set(["REQUEST_SHIFTS"])]]), staff: new Map() } as unknown as Access;

// Zukuenftige Woche: Schicht nicht beendet, Aktionen waeren ohne Bearbeitung moeglich.
const date = "2030-01-08", week = isoWeek(date);
function fixture(editing: boolean, bookedUserId = "kai"): ShiftWithRelations {
  return {
    id: "shift", scheduleId: "plan", dayOfWeek: 2, shiftFrom: "08:00", shiftTo: "16:00", maxEmployees: 2, pauseOption: "PER_SHIFT", pauseValue: 0,
    title: "Testschicht", description: null, requiredQualifications: [], createdAt: new Date(), deletedAt: null, divisionId: null, division: null,
    schedule: { year: week.year, weekNumber: week.weekNumber, branchId: "site", isPublic: true, editingSince: editing ? new Date("2029-12-20T10:00:00Z") : null, branch: null },
    bookings: [{ id: "b1", shiftId: "shift", userId: bookedUserId, contractorWorkerId: null, formerEmployeeId: null, bookedAt: new Date(), confirmedAt: null, confirmation: null, user: { id: bookedUserId, firstName: "Kai", lastName: "Kollege", profileImage: null } }],
  } as unknown as ShiftWithRelations;
}
/** Wie beim Client: Antwort der API als JSON. */
const view = (editing: boolean, a: Access, bookedUserId?: string) => JSON.parse(JSON.stringify(shiftView(fixture(editing, bookedUserId), a))) as ShiftData;

function card(shift: ShiftData, userId: string) {
  const client = new QueryClient();
  return renderToStaticMarkup(<QueryClientProvider client={client}><ShiftCard shift={shift} canEdit={!!shift.can?.edit} currentUserId={userId} onEdit={() => {}} /></QueryClientProvider>);
}

// --- API: requestsPaused fuer alle Leser, ohne Angaben zur Bearbeitung ---------
const paused = view(true, employee), published = view(false, employee), plannerPaused = view(true, admin);
check(paused.requestsPaused === true && paused.can?.request === false, "employee view of a plan in editing: requestsPaused true, requests off");
check(published.requestsPaused === false && published.can?.request === true, "employee view of a published plan: requestsPaused false, requests on");
check(plannerPaused.requestsPaused === true, "planner view carries requestsPaused too");
check(!JSON.stringify(paused).includes("editing"), "employee view names neither editingSince nor editingBy");

// --- Schichtkarte -------------------------------------------------------------
const pausedCard = card(paused, "ella");
check(count(pausedCard, KARTE) === 1, "employee card in editing: hint exactly once");
check(!pausedCard.includes("Übernahme anfragen") && !pausedCard.includes("Wunsch"), "employee card in editing: no takeover or wish button");
const publishedCard = card(published, "ella");
check(publishedCard.includes("Übernahme anfragen") && publishedCard.includes("Wunsch") && !publishedCard.includes(KARTE), "employee card of a published plan: buttons as before, no hint");
const ownCard = card(view(true, employee, "ella"), "ella");
check(count(ownCard, KARTE) === 1, "own shift in editing: hint once (exchange is paused too)");
const plannerCard = card(plannerPaused, "admin");
check(!plannerCard.includes(KARTE) && plannerCard.includes("Mitarbeiter zuweisen"), "planner card in editing: no hint, planning actions stay");

// --- Mein Dienstplan (zusammengefuehrte Sicht) ----------------------------------
function grid(shifts: ShiftData[]) {
  const client = new QueryClient();
  client.setQueryData(["schedule", week.weekNumber, week.year, "alle"], { schedule: { id: "", organizationId: "org", branchId: null, weekNumber: week.weekNumber, year: week.year, isPublic: true, settingsLayout: "LAYOUT_1", showTitle: true, showPauses: true, shifts }, merged: true });
  const dates = Array.from({ length: 7 }, (_, i) => new Date(weekDate(week.year, week.weekNumber, i + 1) + "T12:00:00Z"));
  return renderToStaticMarkup(<QueryClientProvider client={client}><EmployeeGrid weekNumber={week.weekNumber} year={week.year} weekDates={dates} /></QueryClientProvider>);
}
const ownPaused = grid([view(true, employee, "ella")]);
check(count(ownPaused, WOCHE) === 1 && /role="status"[^>]*>(?:(?!<\/p>).)*Diese Woche wird gerade überarbeitet/.test(ownPaused), "Mein Dienstplan in editing: one status line above the grid");
check(!grid([view(false, employee, "ella")]).includes(WOCHE), "Mein Dienstplan of a published week: no line");
check(!grid([view(true, admin, "ella")]).includes(WOCHE), "planner's merged view in editing: no line");

// --- Startseite: naechste Schicht ohne "Schicht bestaetigen" --------------------
function home(next: ShiftData) {
  const client = new QueryClient();
  client.setQueryData(["dashboard"], { firstName: "Ella", userId: "ella", today: "2030-01-01", unread: 0, own: [next], reports: { employees: [] }, manager: false, open: [], plans: [] });
  return renderToStaticMarkup(<QueryClientProvider client={client}><Dashboard /></QueryClientProvider>);
}
const homePaused = home(view(true, employee, "ella")), homePublished = home(view(false, employee, "ella"));
check(!homePaused.includes("Schicht bestätigen") && count(homePaused, WOCHE) === 1, "home page in editing: no confirm button, the hint instead");
check(homePublished.includes("Schicht bestätigen") && !homePublished.includes(WOCHE), "home page of a published week: confirm button as before, no hint");

console.log("SUCCESS: " + checks + " Prüfungen zu ruhenden Anträgen bestanden.");
