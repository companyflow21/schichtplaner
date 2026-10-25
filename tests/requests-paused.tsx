/*
 * Plan in Bearbeitung aus Sicht der Mitarbeitenden: Schichtkarte, "Mein
 * Dienstplan" und Startseite nennen den Grund, warum Antraege, Tausch und
 * Bestaetigen fehlen - die Planung sieht keinen dieser Hinweise. Statisch
 * gerendert mit echten API-Ansichten (shiftView), ohne Browser oder Datenbank.
 * Zusaetzlich die Startseite (Abweichung, leere Listen, Zeilen "Heute im
 * Dienstplan") und die Zaehlregel "Bestaetigungen offen":
 *   npx tsx tests/requests-paused.tsx
 */
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ShiftCard } from "../src/components/schedule/shift-card";
import { EmployeeGrid } from "../src/components/schedule/employee-grid";
import { Dashboard } from "../src/components/workforce/dashboard";
import { isoWeek, weekDate } from "../src/lib/berlin";
import { shiftEnded, shiftView, type ShiftWithRelations } from "../src/lib/planning";
import { openConfirmations } from "../src/lib/dashboard-tasks";
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

// --- Startseite der Mitarbeitenden: Abweichung erklärt, leere Listen zusammengefasst --------
function homeWith(data: Record<string, unknown>, format?: string) {
  const client = new QueryClient();
  client.setQueryData(["dashboard"], { firstName: "Ella", userId: "ella", today: "2030-01-01", unread: 0, own: [], reports: { employees: [] }, manager: false, open: [], plans: [], ...data });
  if (format) client.setQueryData(["current-member"], { nameFormat: format });
  return renderToStaticMarkup(<QueryClientProvider client={client}><Dashboard /></QueryClientProvider>);
}
const monthRow = { userId: "ella", firstName: "Ella", lastName: "Test", totalMinutes: 0, plannedMinutes: 450, targetMinutes: null, targetStatus: "unset", deviationMinutes: -450 };
const withDeviation = homeWith({ own: [view(false, employee, "ella")], reports: { employees: [monthRow] } });
check(withDeviation.includes("Abweichung zum Plan −7,5 h") && !withDeviation.includes("-7.5") && !withDeviation.includes("7.5 h"), "home page: deviation as \"−7,5 h\" with a real minus and decimal comma");
check(withDeviation.includes("Erklärung zu Abweichung zum Plan"), "home page: the deviation has an explanation (InfoHint)");
check(homeWith({ own: [view(false, employee, "ella")], reports: { employees: [{ ...monthRow, totalMinutes: 510, deviationMinutes: 60 }] } }).includes("8,5 h erfasst"), "home page: hours as \"8,5 h\"");
const nothing = homeWith({ plans: [{ id: "site", name: "Nord", customer: null }] });
check(count(nothing, "Noch keine kommende Schicht veröffentlicht.") === 1 && nothing.includes("Standortpläne ansehen"), "home page without any shift: one sentence and the next step");
check(!nothing.includes("Keine weiteren Schichten") && !nothing.includes("Keine passenden offenen Schichten"), "home page without any shift: no further empty boxes");
check(!homeWith({}).includes("Standortpläne ansehen"), "home page without plans: just the sentence, no dead link");
const onlyOne = homeWith({ own: [view(false, employee, "ella")] });
check(count(onlyOne, "Keine weiteren Schichten geplant und keine passenden offenen Schichten.") === 1 && !onlyOne.includes("Weitere eigene Schichten"), "home page with one shift: one line instead of two empty lists");

// --- Startseite der Disposition: "Heute im Dienstplan" als Zeilen ---------------------------
const people = ["Anna Albers", "Bernd Berger", "Clara Conrad", "David Dietz", "Eva Engel", "Felix Fuchs", "Gina Graf", "Hans Heinz", "Ines Immer", "Jan Jäger", "Karla Kuhn", "Lars Lorenz", "Mia Maier"];
function todayShift(id: string, extra: Record<string, unknown>) {
  return { ...view(false, admin), id, date: "2030-01-08", shiftFrom: "08:00", shiftTo: "16:00", missing: 0, isPublic: true, endsNextDay: false, openConfirmations: 0, branch: { name: "Demo Nord", address: null, meetingPoint: null, notes: null, customer: null }, title: "Empfang", bookings: [], ...extra };
}
const booked = people.map((name, i) => ({ userId: "u" + i, confirmedAt: "2030-01-01T00:00:00Z", confirmation: "PLANNER", user: { firstName: name.split(" ")[0], lastName: name.split(" ")[1] } }));
function manager(todayShifts: unknown[], format?: string) {
  return homeWith({
    manager: true, today: date, own: [], tasks: { notActivated: null, draftWeeks: null, draftHref: null },
    overview: { horizon: { from: "2030-01-01", to: "2030-01-28", days: 28 }, customers: [], unassigned: [], legacyShifts: null },
    todayShifts, counts: { openSlots: null, unconfirmed: null, pendingRequests: null, pendingAbsences: null, pendingCorrections: null, openIssues: null },
  }, format);
}
const rows = manager([
  todayShift("a", { bookings: booked }),
  todayShift("b", { shiftFrom: "22:00", shiftTo: "06:00", endsNextDay: true, missing: 1, bookings: booked.slice(0, 1) }),
  todayShift("c", { shiftFrom: "10:00", shiftTo: "12:00", openConfirmations: 2, bookings: booked.slice(0, 2) }),
]);
check(/Anna Albers, Bernd Berger, Clara Conrad, <span[^>]*title=/.test(rows), "today rows: the first three names run on, the rest is cut");
check(rows.includes(">+10<") && rows.includes("Mia Maier") && /title="[^"]*Mia Maier[^"]*"/.test(rows), "today rows: \"+10\" carries all names in its title");
check(rows.includes("besetzt") && rows.includes("1 offen") && rows.includes("2 unbestätigt"), "today rows: status as badge - besetzt, N offen, N unbestätigt");
check(count(rows, "title=\"Endet am nächsten Tag\"") === 1, "today rows: the night shift carries +1 with a title");
check(manager([todayShift("a", { bookings: booked.slice(0, 2) })], "LASTNAME_FIRSTNAME").includes("Albers, Anna; Berger, Bernd"), "today rows: names follow the organisation's name format");
check(!manager([todayShift("a", { shiftTo: "06:00", endsNextDay: true, date: "2030-01-07", bookings: [] })]).includes("+1") && manager([todayShift("a", { date: "2030-01-07", endsNextDay: true, bookings: [] })], undefined).includes("von gestern"), "today rows: a night shift from yesterday is named, no +1");
check(manager([]).includes("Heute keine Schichten an deinen Standorten."), "today rows: empty day keeps its sentence");

// --- Zählregel "Bestätigungen offen" ---------------------------------------------------------
const plannerView = (editing = false) => shiftView(fixture(editing), admin);
const before = new Date("2030-01-08T12:00:00Z"), after = new Date("2030-01-08T15:30:00Z"); // 13:00 bzw. 16:30 Berliner Zeit
const legacy = plannerView();
check(openConfirmations(legacy, before) === 1 && shiftEnded(fixture(false), before) === false, "count rule: a legacy booking without confirmation on a running plan counts");
check(openConfirmations(legacy, after) === 0 && shiftEnded(fixture(false), after) === true, "count rule: after the shift's end nothing counts - same instant as shiftEnded");
const confirmedLike = (patch: Record<string, unknown>) => openConfirmations({ ...legacy, bookings: [{ ...legacy.bookings[0], ...patch }] } as never, before);
check(confirmedLike({ confirmation: "PLANNER" }) === 0 && confirmedLike({ confirmedAt: "2030-01-01T00:00:00Z" }) === 0, "count rule: placements by the planning and confirmed bookings do not count");
check(confirmedLike({ userId: null }) === 0 && confirmedLike({ former: true }) === 0, "count rule: former people do not count");
check(openConfirmations({ ...legacy, isPublic: false } as never, before) === 0, "count rule: drafts do not count");

console.log("SUCCESS: " + checks + " Prüfungen zu ruhenden Anträgen bestanden.");
