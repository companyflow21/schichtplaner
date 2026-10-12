/*
 * Rechenkern der Zeitkonten (src/lib/time-account.ts) ohne Datenbank.
 * Aufruf: npx tsx tests/time-account-unit.ts
 */
import assert from "node:assert/strict";
import { balanceBefore, computeAccount, periodOf, type DayMinutes } from "../src/lib/time-account";

let checks = 0;
function check(value: unknown, message: string) { assert.ok(value, message); checks++; console.log("PASS: " + message); }
const days = (entries: [string, number, number][]) => new Map<string, DayMinutes>(entries.map(([d, actual, planned]) => [d, { actual, planned }]));
const H = 60;

check(periodOf("2026-10-14", "WEEK").from === "2026-10-12" && periodOf("2026-10-14", "WEEK").to === "2026-10-18", "week runs Monday to Sunday");
check(periodOf("2026-02-10", "MONTH").to === "2026-02-28" && periodOf("2026-12-31", "MONTH").from === "2026-12-01", "month runs over the calendar month");

// 40 h/Woche ab Mo 05.10.2026; Woche 1: 42 h Ist, Woche 2: 38 h Ist -> +2, dann 0
const weekly = computeAccount({
  targets: [{ startDate: "2026-10-05", minutes: 40 * H, period: "WEEK" }], method: "ACTUAL_MINUS_TARGET", today: "2026-10-31", to: "2026-10-18", compensations: [],
  days: days([["2026-10-05", 10 * H, 8 * H], ["2026-10-06", 8 * H, 8 * H], ["2026-10-07", 8 * H, 8 * H], ["2026-10-08", 8 * H, 8 * H], ["2026-10-09", 8 * H, 8 * H],
    ["2026-10-12", 8 * H, 8 * H], ["2026-10-13", 6 * H, 8 * H], ["2026-10-14", 8 * H, 8 * H], ["2026-10-15", 8 * H, 8 * H], ["2026-10-16", 8 * H, 8 * H]]),
});
check(weekly!.periods.length === 2 && weekly!.periods[0].deltaMinutes === 2 * H && weekly!.balanceMinutes === 0, "weekly: +2 h, then -2 h, balance 0");

// Start mitten in der Woche: Mi 07.10. -> 3 von 5 Werktagen = 24 h Soll
const mid = computeAccount({ targets: [{ startDate: "2026-10-07", minutes: 40 * H, period: "WEEK" }], method: "ACTUAL_MINUS_TARGET", today: "2026-10-31", to: "2026-10-11", compensations: [], days: days([["2026-10-07", 8 * H, 8 * H]]) });
check(mid!.periods[0].targetMinutes === 24 * H && mid!.balanceMinutes === -16 * H, "start mid-week: target pro rata by workdays (3/5 of 40 h)");

// Monatssoll 160 h, Oktober 2026 hat 22 Werktage; Abfrage bis 15.10. (11 Werktage) -> 80 h
const monthly = computeAccount({ targets: [{ startDate: "2026-10-01", minutes: 160 * H, period: "MONTH" }], method: "ACTUAL_MINUS_TARGET", today: "2026-10-31", to: "2026-10-15", compensations: [], days: days([["2026-10-01", 80 * H, 0]]) });
check(monthly!.periods[0].targetMinutes === 80 * H && monthly!.balanceMinutes === 0, "monthly target counts pro rata up to the query date");

// Kuenftige Tage zaehlen mit Planstunden (Ist - Soll)
const future = computeAccount({ targets: [{ startDate: "2026-10-12", minutes: 16 * H, period: "WEEK" }], method: "ACTUAL_MINUS_TARGET", today: "2026-10-12", to: "2026-10-18", compensations: [],
  days: days([["2026-10-12", 9 * H, 8 * H], ["2026-10-13", 0, 8 * H]]) });
check(future!.periods[0].actualMinutes === 17 * H && future!.balanceMinutes === 1 * H, "future days count with their planned hours");

// Plan - Soll und Ist - Plan
const dayData = days([["2026-10-12", 6 * H, 8 * H]]);
const planMinus = computeAccount({ targets: [{ startDate: "2026-10-12", minutes: 5 * H, period: "WEEK" }], method: "PLAN_MINUS_TARGET", today: "2026-10-31", to: "2026-10-18", compensations: [], days: dayData });
check(planMinus!.balanceMinutes === 3 * H, "plan minus target: 8 h planned - 5 h target = +3 h");
const actualMinusPlan = computeAccount({ targets: [{ startDate: "2026-10-12", minutes: 5 * H, period: "WEEK" }], method: "ACTUAL_MINUS_PLAN", today: "2026-10-31", to: "2026-10-18", compensations: [], days: dayData });
check(actualMinusPlan!.balanceMinutes === -2 * H && actualMinusPlan!.periods[0].targetMinutes === 0, "actual minus plan ignores the target: 6 h - 8 h = -2 h");

// Ausgleich und Phasenwechsel
const phases = computeAccount({
  targets: [{ startDate: "2026-10-05", minutes: 40 * H, period: "WEEK" }, { startDate: "2026-11-01", minutes: 100 * H, period: "MONTH" }],
  method: "ACTUAL_MINUS_TARGET", today: "2026-12-31", to: "2026-11-30", days: new Map(),
  compensations: [{ date: "2026-09-01", minutes: 12 * H }, { date: "2026-11-10", minutes: -5 * H }],
});
const first = phases!.periods[0], october = phases!.periods.filter((p) => p.period === "WEEK"), november = phases!.periods.find((p) => p.period === "MONTH")!;
check(first.compensationMinutes === 12 * H, "compensation before the start counts in the first period (opening balance)");
check(october.length === 4 && october[3].from === "2026-10-26" && october[3].to === "2026-10-31" && october[3].targetMinutes === 40 * H, "weekly phase ends the day before the next entry; 26.-31.10. has 5 workdays");
check(november.from === "2026-11-01" && november.targetMinutes === 100 * H && november.compensationMinutes === -5 * H, "monthly phase from November with its compensation");
check(phases!.balanceMinutes === 12 * H - 4 * 40 * H - 100 * H - 5 * H, "balance adds periods and compensations");
check(balanceBefore(phases, "2026-11-01") === october[3].balanceMinutes, "balance before a date is the state after the last period ending earlier");
check(computeAccount({ targets: [], days: new Map(), compensations: [], method: "ACTUAL_MINUS_TARGET", today: "2026-10-01", to: "2026-10-31" }) === null, "without a target there is no account");
check(computeAccount({ targets: [{ startDate: "2026-11-01", minutes: 1, period: "WEEK" }], days: new Map(), compensations: [], method: "ACTUAL_MINUS_TARGET", today: "2026-10-01", to: "2026-10-31" }) === null, "a target starting after the query date does not count yet");

console.log("TIME ACCOUNT UNIT: " + checks + " checks passed.");
