/*
 * Rechenkern der Planungsregeln (src/lib/planning-rules.ts) ohne Datenbank.
 * Aufruf: npx tsx tests/planning-rules-unit.ts
 */
import assert from "node:assert/strict";
import { DEFAULT_RULES, effectiveRules, readRules, ruleViolations, type PlannedShift, type Rules } from "../src/lib/planning-rules";
import { addDate, minuteOfDay, rangeMinutes } from "../src/lib/berlin";

let checks = 0;
function check(value: unknown, message: string) { assert.ok(value, message); checks++; console.log("PASS: " + message); }

let next = 0;
function shift(date: string, from: string, to: string, pause = 0): PlannedShift {
  const start = Date.parse(date + "T00:00:00Z") / 60000 + minuteOfDay(from);
  return { id: "s" + ++next, date, start, end: start + rangeMinutes(from, to), minutes: rangeMinutes(from, to) - pause };
}
const only = (patch: Partial<Rules>): Rules => ({ ...DEFAULT_RULES, ...patch });
const week = { from: "2026-10-12", to: "2026-10-18" }; // KW 42, Mo-So
const days = (from: string, count: number, f = "08:00", t = "17:00", pause = 0) => Array.from({ length: count }, (_, i) => shift(addDate(from, i), f, t, pause));

// --- Stunden je Woche und Monat --------------------------------------------------
const fiveNine = days("2026-10-12", 5);
let v = ruleViolations(only({ hours: { enabled: true, period: "WEEK", min: null, max: 40 } }), fiveNine, week);
check(v.length === 1 && v[0].rule === "hours" && v[0].text === "45 h in KW 42 (höchstens 40 h)" && v[0].date === "2026-10-12" && v[0].shiftIds.length === 5, "weekly maximum: 5 x 9 h = 45 h over 40 h");
v = ruleViolations(only({ hours: { enabled: true, period: "WEEK", min: 50, max: null } }), fiveNine, week);
check(v.length === 1 && v[0].text === "45 h in KW 42 (mindestens 50 h)", "weekly minimum");
check(ruleViolations(only({ hours: { enabled: true, period: "WEEK", min: 40, max: 48 } }), fiveNine, week).length === 0, "inside the range: no violation");
v = ruleViolations(only({ hours: { enabled: true, period: "MONTH", min: null, max: 150 } }), [...days("2026-10-01", 12), ...days("2026-10-19", 6)], week);
check(v.length === 1 && v[0].text === "162 h im Oktober 2026 (höchstens 150 h)" && v[0].date === "2026-10-01", "monthly maximum counts the whole month");

// --- Stunden am Tag, Ruhezeit -------------------------------------------------------------
v = ruleViolations(only({ dailyHours: { enabled: true, max: 10 } }), [shift("2026-10-13", "06:00", "12:00"), shift("2026-10-13", "13:00", "18:00")], week);
check(v.length === 1 && v[0].text === "11 h am 13.10. (höchstens 10 h am Tag)", "two shifts on one day: 11 h over 10 h");
check(ruleViolations(only({ dailyHours: { enabled: true, max: 10 } }), [shift("2026-10-13", "22:00", "06:00"), shift("2026-10-14", "07:00", "10:00")], week).length === 0, "night shift counts on the start day");
const late = shift("2026-10-12", "14:00", "22:00"), early = shift("2026-10-13", "06:00", "14:00");
v = ruleViolations(only({ rest: { enabled: true, hours: 11 } }), [late, early], week);
check(v.length === 1 && v[0].text === "Ruhezeit 8 h vor der Schicht am 13.10. um 06:00 (mindestens 11 h)" && v[0].shiftIds.join() === [late.id, early.id].join(), "rest of 8 h between late and early shift");
check(ruleViolations(only({ rest: { enabled: true, hours: 11 } }), [shift("2026-10-12", "08:00", "12:00"), shift("2026-10-12", "12:10", "16:00"), shift("2026-10-13", "08:00", "16:00")], week).length === 0, "gap up to 15 minutes counts as one block; 16 h rest after it");
check(ruleViolations(only({ rest: { enabled: true, hours: 11 } }), [shift("2026-10-12", "06:00", "10:00"), shift("2026-10-12", "18:00", "22:00")], week).length === 1, "split shift on one day breaks the rest time");

// --- Tage am Stueck, Tage je Woche, Bloecke -----------------------------------------------------
v = ruleViolations(only({ consecutiveDays: { enabled: true, max: 6 } }), days("2026-10-10", 8), week);
check(v.length === 1 && v[0].date === "2026-10-16" && v[0].shiftIds.length === 2 && v[0].text === "8 Arbeitstage am Stück, 10.10.–17.10. (höchstens 6)", "8 days in a row: the 7th and 8th day are too many");
v = ruleViolations(only({ daysPerWeek: { enabled: true, max: 5 } }), days("2026-10-12", 6), week);
check(v.length === 1 && v[0].text === "6 Arbeitstage in KW 42 (höchstens 5)", "6 working days in a week over 5");
const gappy = [shift("2026-10-12", "08:00", "16:00"), shift("2026-10-14", "08:00", "16:00"), shift("2026-10-15", "08:00", "16:00")];
v = ruleViolations(only({ workdayBlocks: { enabled: true } }), gappy, week);
check(v.length === 1 && v[0].date === "2026-10-12" && v[0].text.startsWith("Einzelner Arbeitstag am 12.10."), "single working day on Monday");
v = ruleViolations(only({ freeDayBlocks: { enabled: true } }), gappy, week);
check(v.length === 1 && v[0].date === "2026-10-13" && v[0].shiftIds.length === 2, "single free day on Tuesday between two working days");

// --- Wochenenden ------------------------------------------------------------------------------
const saturdays = ["2026-10-03", "2026-10-10", "2026-10-17"].map((d) => shift(d, "08:00", "16:00"));
v = ruleViolations(only({ consecutiveWeekends: { enabled: true, max: 2 } }), [...saturdays, shift("2026-10-18", "08:00", "12:00")], week);
check(v.length === 1 && v[0].date === "2026-10-17" && v[0].shiftIds.length === 2 && v[0].text === "3 Wochenenden in Folge mit Schicht bis 18.10. (höchstens 2)", "third weekend in a row with shifts");
const weekend = [shift("2026-10-17", "08:00", "16:00"), shift("2026-10-18", "08:00", "16:00")];
v = ruleViolations(only({ freeDayAfterWeekend: { enabled: true } }), [...weekend, ...days("2026-10-19", 4)], week);
check(v.length === 1 && v[0].date === "2026-10-19" && v[0].text.includes("nur ein freier Werktag"), "two weekend days need two free weekdays the week after");
check(ruleViolations(only({ freeDayAfterWeekend: { enabled: true } }), [...weekend, ...days("2026-10-19", 3)], week).length === 0, "two free weekdays: fine");

// --- Zusammensetzen -------------------------------------------------------------------------------
const general = readRules({ rest: { enabled: true, hours: 11 }, dailyHours: { enabled: true, max: 99 }, unknown: { enabled: true } });
check(general.rest?.hours === 11 && !general.dailyHours && !("unknown" in general), "stored rules: invalid and unknown entries are dropped");
const own = effectiveRules(general, { rest: { enabled: false, hours: 11 }, daysPerWeek: { enabled: true, max: 4 } });
check(!own.rest.enabled && own.daysPerWeek.max === 4 && !own.hours.enabled, "a person's rule replaces the general one, everything else stays");
check(ruleViolations(DEFAULT_RULES, days("2026-10-05", 14, "06:00", "20:00"), week).length === 0, "without enabled rules nothing is reported");

// --- Schichten an Standorten ohne Leserecht (elsewhere): zaehlen mit, werden nie benannt ------------------
const hide = (x: PlannedShift): PlannedShift => ({ ...x, elsewhere: true });
const lateHere = shift("2026-10-12", "14:00", "22:00"), earlyThere = hide(shift("2026-10-13", "06:00", "14:00"));
v = ruleViolations(only({ rest: { enabled: true, hours: 11 } }), [lateHere, earlyThere], week);
check(v.length === 1 && v[0].text === "Ruhezeit 8 h vor einer Schicht an einem anderen Standort am 13.10. (mindestens 11 h)" && v[0].shiftIds.join() === lateHere.id && v[0].elsewhere === true, "rest before a hidden shift: neutral text without its time, only the visible shift id");
const lateThere = hide(shift("2026-10-12", "14:00", "22:00")), earlyHere = shift("2026-10-13", "06:00", "14:00");
v = ruleViolations(only({ rest: { enabled: true, hours: 11 } }), [lateThere, earlyHere], week);
check(v.length === 1 && v[0].text === "Ruhezeit 8 h vor der Schicht am 13.10. um 06:00 (mindestens 11 h) – auch Schichten an einem anderen Standort" && v[0].shiftIds.join() === earlyHere.id, "rest after a hidden shift: the visible shift is named, the other site only mentioned");
v = ruleViolations(only({ hours: { enabled: true, period: "WEEK", min: null, max: 40 } }), [...days("2026-10-12", 4), hide(shift("2026-10-16", "08:00", "17:00"))], week);
check(v.length === 1 && v[0].text === "45 h in KW 42 (höchstens 40 h) – auch Schichten an einem anderen Standort" && v[0].shiftIds.length === 4 && v[0].elsewhere, "hidden shifts count for the weekly hours but are not listed");
v = ruleViolations(only({ dailyHours: { enabled: true, max: 10 } }), [hide(shift("2026-10-14", "06:00", "18:00"))], week);
check(v.length === 1 && v[0].shiftIds.length === 0 && v[0].elsewhere, "a violation of hidden shifts only keeps no shift id (the service leaves it out)");
check(!ruleViolations(only({ dailyHours: { enabled: true, max: 10 } }), [shift("2026-10-14", "06:00", "18:00")], week)[0].elsewhere, "without hidden shifts no elsewhere mark");

// --- Echte Minuten: Beginn fuer den Text aus "from" ------------------------------------------------
const real = { id: "dst", date: "2026-10-25", start: 0, end: 480, minutes: 480, from: "07:00" };
v = ruleViolations(only({ rest: { enabled: true, hours: 11 } }), [{ id: "sat", date: "2026-10-24", start: -600, end: -120, minutes: 480 }, real], week);
check(v.length === 1 && v[0].text.includes("Ruhezeit 2 h vor der Schicht am 25.10. um 07:00"), "rest text takes the start time from 'from' when minutes are real time");

console.log("PLANNING RULES UNIT: " + checks + " checks passed.");
