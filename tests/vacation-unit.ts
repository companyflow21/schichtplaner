/*
 * Rechenkern des Urlaubskontos (src/lib/vacation.ts) ohne Datenbank.
 * Aufruf: npx tsx tests/vacation-unit.ts
 */
import assert from "node:assert/strict";
import { computeVacation, vacationDays, vacationYear, type VacationRules } from "../src/lib/vacation";

let checks = 0;
function check(value: unknown, message: string) { assert.ok(value, message); checks++; console.log("PASS: " + message); }

const rules: VacationRules = { yearStart: "01-01", daysPerYear: 30, allocation: "YEARLY", carryOver: true, carryOverMax: 5, excludedWeekdays: [6, 7], countHolidays: false, startDate: "2025-01-01" };
const holidays = new Set(["2026-04-03", "2026-04-06"]); // Karfreitag, Ostermontag 2026

check(vacationYear("2026-03-15", "01-01").from === "2026-01-01" && vacationYear("2026-03-15", "04-01").from === "2025-04-01" && vacationYear("2026-03-15", "04-01").to === "2026-03-31", "vacation year from a fixed start day");
// Mo 30.03. bis Fr 10.04.2026: 10 Werktage, davon 2 Feiertage -> 8
check(vacationDays({ from: "2026-03-30", to: "2026-04-10" }, { from: "2026-01-01", to: "2026-12-31" }, rules, holidays) === 8, "weekends and holidays are not deducted");
check(vacationDays({ from: "2026-03-30", to: "2026-04-10" }, { from: "2026-01-01", to: "2026-12-31" }, { ...rules, countHolidays: true }, holidays) === 10, "holidays count when configured");
check(vacationDays({ from: "2025-12-29", to: "2026-01-02" }, { from: "2026-01-01", to: "2026-12-31" }, rules, holidays) === 2, "only days inside the vacation year count");

// 2025: 30 Tage, 20 genommen -> 10 Rest, Uebertrag hoechstens 5. 2026: 30 + 5, 8 genommen (Ostern), 5 geplant (Juli), 2 beantragt.
const years = computeVacation({
  rules, holidays, today: "2026-05-01", asOf: "2026-05-01",
  absences: [
    { from: "2025-08-04", to: "2025-08-29", status: "APPROVED" }, // 20 Werktage
    { from: "2026-03-30", to: "2026-04-10", status: "APPROVED" },
    { from: "2026-07-06", to: "2026-07-10", status: "APPROVED" },
    { from: "2026-09-07", to: "2026-09-08", status: "PENDING" },
  ],
  adjustments: [{ date: "2026-02-01", days: 1.5, comment: "Korrektur Resturlaub" }],
});
check(years.length === 2 && years[0].taken === 20 && years[0].available === 10, "2025: 30 days, 20 taken, 10 left");
const y = years[1];
check(y.carried === 5 && y.entitlement === 30 && y.adjustments === 1.5, "2026: carry-over capped at 5, 30 days entitlement, +1,5 correction");
check(y.taken === 8 && y.planned === 5 && y.pending === 2 && y.available === 23.5, "2026: 8 taken, 5 planned, 2 requested; 5 + 30 + 1,5 - 13 = 23,5 available");
check(y.entries[0].kind === "CARRY" && y.entries[y.entries.length - 1].balance === 23.5, "statement starts with the carry-over and ends with the balance");

// Monatlich ab Eintritt 15.03.2026: Zuteilung ab April, bis zum Stichtag 01.06. -> April, Mai, Juni = 3 x 2,5
const monthly = computeVacation({ rules: { ...rules, allocation: "MONTHLY", startDate: "2026-03-15" }, holidays, today: "2026-06-01", asOf: "2026-06-01", absences: [], adjustments: [] });
check(monthly.length === 1 && monthly[0].entitlement === 7.5 && monthly[0].entries.every((e) => e.kind === "ALLOCATION" && e.days === 2.5), "monthly: one twelfth at each month start from the first full month");
const yearlyLate = computeVacation({ rules: { ...rules, startDate: "2026-03-15" }, holidays, today: "2026-06-01", asOf: "2026-06-01", absences: [], adjustments: [] });
check(yearlyLate[0].entitlement === 22.5 && yearlyLate[0].entries[0].label.includes("9/12"), "yearly, joined mid-March: 9/12 of the year");
const noCarry = computeVacation({ rules: { ...rules, carryOver: false }, holidays, today: "2026-05-01", asOf: "2026-05-01", absences: [], adjustments: [] });
check(noCarry[1].carried === 0 && noCarry[1].available === 30, "without carry-over the rest expires");
const unlimited = computeVacation({ rules: { ...rules, carryOverMax: null }, holidays, today: "2026-05-01", asOf: "2026-05-01", absences: [], adjustments: [] });
check(unlimited[1].carried === 30, "carry-over without limit");

console.log("VACATION UNIT: " + checks + " checks passed.");
