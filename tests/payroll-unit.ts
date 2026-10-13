/*
 * Rechenkern der Lohnberechnung (src/lib/payroll.ts) ohne Datenbank:
 * Normalstunden, Zuschlaege mit Tagen, Feiertagen, Sonderdaten und Zeitbloecken
 * ueber Mitternacht, anteilige Pause, Zeitumstellung, Einschraenkungen.
 * Aufruf: npx tsx tests/payroll-unit.ts
 */
import assert from "node:assert/strict";
import { effectivePayType, holidaysForRecord, isoWeekday, payForRecord, sumLines, type PayRecord, type PayTypeLite, type SurchargeLite } from "../src/lib/payroll";
import { csvCell } from "../src/lib/csv";

let checks = 0;
function check(value: unknown, message: string) { assert.ok(value, message); checks++; console.log("PASS: " + message); }

const base: PayTypeLite = { id: "pt-base", title: "Normalstunden", hourlyRateCents: 1500, code: "100", isActive: true };
const manual = (date: string, timeFrom: string, timeTo: string, breakMinutes = 0, userId = "u1"): PayRecord => ({ id: date + timeFrom, userId, date, type: "MANUAL", timeFrom, timeTo, durationHours: null, durationMinutes: null, breakSeconds: breakMinutes * 60 });
const surcharge = (over: Partial<SurchargeLite>): SurchargeLite => ({ id: "s", name: "Zuschlag", code: null, isActive: true, weekdays: [], holidays: false, dates: [], timeFrom: "00:00", timeTo: "00:00", allPeople: true, userIds: [], allDivisions: true, divisionIds: [], rateKind: "PERCENT", rate: 2500, ...over });
const ALL_DAYS = [1, 2, 3, 4, 5, 6, 7];
const none = new Set<string>();
const pay = (r: PayRecord, surcharges: SurchargeLite[], extra: { payType?: PayTypeLite | null; divisionId?: string | null; holidays?: Set<string> } = {}) =>
  payForRecord(r, { payType: extra.payType === undefined ? base : extra.payType, divisionId: extra.divisionId ?? null, surcharges, holidays: extra.holidays ?? none });
const line = (p: ReturnType<typeof pay>, id: string) => p.lines.find((l) => l.refId === id);

check(isoWeekday("2026-10-12") === 1 && isoWeekday("2026-10-11") === 7, "ISO weekday: Monday is 1, Sunday is 7");

// --- Normalstunden -------------------------------------------------------------
const day = pay(manual("2026-10-12", "08:00", "16:30", 30), []);
check(day.minutes === 480 && day.lines.length === 1 && day.lines[0].amountCents === 12000 && day.totalCents === 12000, "base: 8 h net at 15,00 €/h are 120,00 €");

// --- Nacht ueber Mitternacht -------------------------------------------------
const night = surcharge({ id: "night", name: "Nacht", weekdays: ALL_DAYS, timeFrom: "20:00", timeTo: "06:00", rate: 2500 });
const n1 = pay(manual("2026-10-12", "22:00", "06:00"), [night]);
check(line(n1, "night")?.minutes === 480 && line(n1, "night")?.amountCents === 3000, "night 22-06 lies fully in the 20-06 block: 8 h x 25 % of 15 € = 30,00 €");
const mondayNight = surcharge({ id: "mon", weekdays: [1], timeFrom: "20:00", timeTo: "06:00", rateKind: "AMOUNT", rate: 100 });
check(line(pay(manual("2026-10-13", "00:00", "06:00"), [mondayNight]), "mon")?.minutes === 360, "a block belongs to the day it starts: Tuesday 00-06 counts for Monday's night block");
check(!line(pay(manual("2026-10-12", "00:00", "06:00"), [mondayNight]), "mon"), "Monday 00-06 is not in Monday's block (that starts at 20:00)");

// --- Smartplan-Beispiel: Abendzuschlag als fester Betrag ------------------------
const rate130: PayTypeLite = { ...base, id: "pt-130", hourlyRateCents: 13000 };
const evening = surcharge({ id: "evening", name: "Abend", weekdays: ALL_DAYS, timeFrom: "16:00", timeTo: "00:00", rateKind: "AMOUNT", rate: 2000 });
const ev = pay(manual("2026-10-14", "15:45", "22:00"), [evening], { payType: rate130 });
check(ev.lines[0].amountCents === 81250 && line(ev, "evening")?.minutes === 360 && line(ev, "evening")?.amountCents === 12000 && ev.totalCents === 93250, "shift 15:45-22:00: 6,25 h x 130 = 812,50 plus 6,0 h x 20 = 120,00");

// --- Pause anteilig -------------------------------------------------------------
const withBreak = pay(manual("2026-10-14", "18:00", "02:00", 60), [night]);
check(withBreak.minutes === 420 && line(withBreak, "night")?.minutes === 315, "break is spread proportionally: 360 block minutes x 420/480 = 315");

// --- Sonntag, Feiertag, Sonderdatum --------------------------------------------
const sunday = surcharge({ id: "sun", name: "Sonntag", weekdays: [7], rate: 5000 });
check(line(pay(manual("2026-10-11", "10:00", "14:00"), [sunday]), "sun")?.minutes === 240, "whole-day Sunday surcharge on a Sunday");
check(line(pay(manual("2026-10-11", "22:00", "02:00"), [sunday]), "sun")?.minutes === 120, "Sunday surcharge ends at midnight");
const holiday = surcharge({ id: "hol", name: "Feiertag", holidays: true, rate: 12500 });
check(line(pay(manual("2026-10-03", "06:00", "14:00"), [holiday], { holidays: new Set(["2026-10-03"]) }), "hol")?.minutes === 480, "holiday surcharge on a holiday of the organisation");
check(!line(pay(manual("2026-10-02", "06:00", "14:00"), [holiday], { holidays: new Set(["2026-10-03"]) }), "hol"), "no holiday surcharge on an ordinary day");
const xmasEve = surcharge({ id: "eve", name: "Heiligabend ab 14 Uhr", dates: ["12-24"], timeFrom: "14:00", timeTo: "00:00", rate: 15000 });
check(line(pay(manual("2026-12-24", "12:00", "20:00"), [xmasEve]), "eve")?.minutes === 360, "special date 24.12. from 14:00: 6 of 8 hours");
check(line(pay(manual("2027-12-24", "12:00", "20:00"), [xmasEve]), "eve")?.minutes === 360, "special dates repeat every year");
const stacked = pay(manual("2026-10-11", "22:00", "06:00"), [night, sunday]);
check(line(stacked, "night")?.minutes === 480 && line(stacked, "sun")?.minutes === 120, "surcharges add up: night and Sunday on a Sunday night");

// --- Zeitumstellung (echte Zeitstempel) ------------------------------------------
// Sa 24.10.2026 22:00 Sommerzeit (20:00 UTC) bis So 25.10.2026 06:00 Winterzeit (05:00 UTC) = 9 echte Stunden.
const dst: PayRecord = { id: "dst", userId: "u1", date: "2026-10-24", type: "WATCH", timeFrom: "22:00", timeTo: "06:00", startedAt: "2026-10-24T20:00:00Z", endedAt: "2026-10-25T05:00:00Z", durationHours: null, durationMinutes: null, breakSeconds: 0 };
const dstPay = pay(dst, [night]);
check(dstPay.minutes === 540 && line(dstPay, "night")?.minutes === 540, "clock change in October: stopwatch night counts 9 real hours, all in the night block");
const spring: PayRecord = { ...dst, id: "spring", date: "2026-03-28", startedAt: "2026-03-28T21:00:00Z", endedAt: "2026-03-29T04:00:00Z" };
check(pay(spring, [night]).minutes === 420 && line(pay(spring, [night]), "night")?.minutes === 420, "clock change in March: 22:00-06:00 are 7 real hours");

// --- Einschraenkungen -----------------------------------------------------------
check(!line(pay(manual("2026-10-12", "22:00", "06:00", 0, "u2"), [{ ...night, allPeople: false, userIds: ["u1"] }]), "night"), "surcharge for selected people skips others");
check(line(pay(manual("2026-10-12", "22:00", "06:00"), [{ ...night, allPeople: false, userIds: ["u1"] }]), "night")?.minutes === 480, "surcharge for selected people applies to them");
check(!line(pay(manual("2026-10-12", "22:00", "06:00"), [{ ...night, allDivisions: false, divisionIds: ["d1"] }], { divisionId: "d2" }), "night"), "surcharge for selected work areas skips other areas");
check(!line(pay(manual("2026-10-12", "22:00", "06:00"), [{ ...night, allDivisions: false, divisionIds: ["d1"] }]), "night"), "surcharge for selected work areas skips records without a work area");
check(line(pay(manual("2026-10-12", "22:00", "06:00"), [{ ...night, allDivisions: false, divisionIds: ["d1"] }], { divisionId: "d1" }), "night")?.minutes === 480, "surcharge for selected work areas applies inside the area");
check(!line(pay(manual("2026-10-12", "22:00", "06:00"), [{ ...night, isActive: false }]), "night"), "inactive surcharges are ignored");

// --- Ohne Lohnart, nur Dauer -------------------------------------------------------
const noType = pay(manual("2026-10-12", "22:00", "06:00"), [night], { payType: null });
check(noType.totalCents === 0 && noType.warnings.length === 2 && line(noType, "night")?.minutes === 480, "without a pay type: hours are shown, amounts are 0, two warnings");
const fixed = pay(manual("2026-10-12", "22:00", "06:00"), [{ ...night, rateKind: "AMOUNT", rate: 250 }], { payType: null });
check(line(fixed, "night")?.amountCents === 2000, "fixed amount surcharges work without a pay type: 8 h x 2,50 €");
const duration: PayRecord = { id: "dur", userId: "u1", date: "2026-10-11", type: "MANUAL_DURATION", timeFrom: null, timeTo: null, durationHours: 6, durationMinutes: 0, breakSeconds: 0 };
const durPay = pay(duration, [sunday, night]);
check(line(durPay, "sun")?.minutes === 360 && !line(durPay, "night") && durPay.warnings.some((w) => w.includes("ohne Uhrzeit")), "duration-only record: whole-day surcharge applies, time block is skipped with a warning");

// --- Feiertag nach Bundesland des Einsatzorts (branchHolidays) ----------------------------
// Fronleichnam 04.06.2026 (Donnerstag) gilt in NRW, nicht in Thueringen; der 25.12. gilt bundesweit.
const corpus = manual("2026-06-04", "08:00", "12:00");
const siteHolidays = (branch: { holidayState: string | null } | null, org = none) => holidaysForRecord(branch, org, "2026-06-03", "2026-12-26");
check(line(pay(corpus, [holiday], { holidays: siteHolidays({ holidayState: "NW" }) }), "hol")?.minutes === 240, "holiday by the site's federal state: Corpus Christi at a site in NRW gets the holiday surcharge");
check(!line(pay(corpus, [holiday], { holidays: siteHolidays({ holidayState: "TH" }) }), "hol"), "the same day at a site in Thuringia is no holiday");
check(siteHolidays({ holidayState: "TH" }).has("2026-12-25") && siteHolidays({ holidayState: "NW" }).has("2026-12-25"), "nationwide holidays count in every federal state");
check(siteHolidays({ holidayState: null }).size === 0 && !line(pay(manual("2026-12-25", "08:00", "12:00"), [holiday], { holidays: siteHolidays({ holidayState: null }) }), "hol"), "site without federal state: no holidays at all (the payroll page names the site)");
const orgDays = new Set(["2026-06-04"]);
check(siteHolidays(null, orgDays) === orgDays && line(pay(corpus, [holiday], { holidays: siteHolidays(null, orgDays) }), "hol")?.minutes === 240, "record without a site uses the organisation's holidays");
check(!siteHolidays({ holidayState: "NW" }, new Set(["2026-06-05"])).has("2026-06-05") && siteHolidays({ holidayState: null }, orgDays).size === 0, "organisation holidays do not apply to records at a site");

// --- Zeitbuchung einer geloeschten Person (userId null) ------------------------------------
const formerRecord = manual("2026-10-12", "22:00", "06:00", 0, "former");
formerRecord.userId = null;
const formerPay = pay(formerRecord, [night, { ...night, id: "only-u1", allPeople: false, userIds: ["u1"] }], { payType: { ...base, id: "area", hourlyRateCents: 1800 }, divisionId: "d1" });
check(formerPay.minutes === 480 && formerPay.lines[0].amountCents === 14400 && line(formerPay, "night")?.amountCents === 3600, "record of a deleted person: hours, work-area pay type and surcharges for everyone are paid");
check(!line(formerPay, "only-u1") && formerPay.totalCents === 18000, "record of a deleted person: surcharges for selected people no longer apply (the account is gone)");

// --- Lohnart-Auswahl und Summen -----------------------------------------------------
const types = new Map<string, PayTypeLite>([["a", { ...base, id: "a" }], ["b", { ...base, id: "b", hourlyRateCents: 1800 }], ["off", { ...base, id: "off", isActive: false }]]);
check(effectivePayType(types, "b", "a")?.id === "b", "work-area pay type comes before the person's pay type");
check(effectivePayType(types, null, "a")?.id === "a" && effectivePayType(types, "off", "a")?.id === "a", "inactive or missing work-area pay type falls back to the person");
check(effectivePayType(types, null, "off") === null, "inactive pay type of the person counts as none");
const totals = sumLines([n1, pay(manual("2026-10-13", "22:00", "06:00"), [night])]);
check(totals.length === 2 && totals[0].kind === "BASE" && totals[0].minutes === 960 && totals[1].minutes === 960 && totals[1].amountCents === 6000, "sums per pay type and surcharge over several records");

// --- CSV --------------------------------------------------------------------------
check(csvCell("-1,50") === '"-1,50"' && csvCell(3) === '"3"', "CSV keeps German numbers, also negative ones, as numbers");
check(csvCell("=SUMME(A1)") === "\"'=SUMME(A1)\"" && csvCell("-Text") === "\"'-Text\"" && csvCell('A"B') === '"A""B"', "CSV neutralises formulas and escapes quotes");

console.log("PAYROLL UNIT: " + checks + " checks passed.");
