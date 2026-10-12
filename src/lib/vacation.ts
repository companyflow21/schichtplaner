/**
 * Urlaubskonto (Rechenkern ohne Datenbank).
 *
 * Urlaubsjahr ab einem festen Tag (Vorgabe 01.01.). Anspruch je Jahr wird
 * entweder zu Beginn des Jahres ganz oder zu Beginn jedes Monats zu einem
 * Zwoelftel zugeteilt; wer im Lauf des Jahres beginnt, erhaelt bei jaehrlicher
 * Zuteilung den Anteil der verbleibenden Monate. Rest des Vorjahres wird auf
 * Wunsch uebertragen (optional mit Obergrenze). Abgezogen werden Tage der
 * Urlaubsart, ohne freie Wochentage (Vorgabe Sa, So) und - wenn eingestellt -
 * ohne Feiertage. Korrekturen (± Tage) zaehlen am eingetragenen Datum.
 */
import { addDate } from "./berlin";

export type VacationRules = {
  yearStart: string; // MM-TT
  daysPerYear: number;
  allocation: "YEARLY" | "MONTHLY";
  carryOver: boolean;
  carryOverMax: number | null;
  excludedWeekdays: number[]; // ISO 1-7
  countHolidays: boolean;
  startDate: string | null; // Beginn des Anspruchs (z. B. Eintritt)
};
export type VacationAbsence = { from: string; to: string; status: "APPROVED" | "PENDING" };
export type VacationEntry = { date: string; kind: "CARRY" | "ALLOCATION" | "TAKEN" | "ADJUSTMENT"; label: string; days: number; balance: number };
export type VacationYear = {
  from: string; to: string; entitlement: number; carried: number; adjustments: number;
  taken: number; planned: number; pending: number; available: number; entries: VacationEntry[];
};

const weekday = (date: string) => ((new Date(date + "T12:00:00Z").getUTCDay() + 6) % 7) + 1;
const round2 = (value: number) => Math.round(value * 100) / 100;
const german = (date: string) => date.slice(8, 10) + "." + date.slice(5, 7) + "." + date.slice(0, 4);

/** Urlaubsjahr, in dem ein Tag liegt. */
export function vacationYear(date: string, yearStart: string): { from: string; to: string } {
  let from = date.slice(0, 4) + "-" + yearStart;
  if (from > date) from = String(Number(date.slice(0, 4)) - 1) + "-" + yearStart;
  const next = String(Number(from.slice(0, 4)) + 1) + "-" + yearStart;
  return { from, to: addDate(next, -1) };
}

/** Abzuziehende Urlaubstage einer Abwesenheit in einem Zeitraum. */
export function vacationDays(range: { from: string; to: string }, window: { from: string; to: string }, rules: Pick<VacationRules, "excludedWeekdays" | "countHolidays">, holidays: Set<string>): number {
  let n = 0;
  const from = range.from > window.from ? range.from : window.from, to = range.to < window.to ? range.to : window.to;
  for (let d = from; d <= to; d = addDate(d, 1)) if (!rules.excludedWeekdays.includes(weekday(d)) && (rules.countHolidays || !holidays.has(d))) n++;
  return n;
}

/** Monatsanfaenge im Urlaubsjahr, ab denen zugeteilt wird. */
function monthStarts(year: { from: string; to: string }): string[] {
  const out: string[] = [];
  for (let d = year.from; d <= year.to; ) { out.push(d); const m = Number(d.slice(5, 7)), y = Number(d.slice(0, 4)); d = (m === 12 ? y + 1 : y) + "-" + String(m === 12 ? 1 : m + 1).padStart(2, "0") + d.slice(7); }
  return out;
}

/**
 * Urlaubskonto vom ersten Urlaubsjahr (ab startDate) bis zum Jahr, das "asOf"
 * enthaelt. Liefert je Jahr Anspruch, Uebertrag, genommen (bis heute),
 * geplant (genehmigt, ab morgen), beantragt und verfuegbar sowie den Kontoauszug.
 */
export function computeVacation(input: { rules: VacationRules; absences: VacationAbsence[]; adjustments: { date: string; days: number; comment: string }[]; holidays: Set<string>; today: string; asOf: string }): VacationYear[] {
  const { rules } = input;
  const first = vacationYear(rules.startDate ?? input.asOf, rules.yearStart);
  const last = vacationYear(input.asOf, rules.yearStart);
  const years: VacationYear[] = [];
  let carryIn = 0;
  for (let year = first; year.from <= last.from; year = vacationYear(addDate(year.to, 1), rules.yearStart)) {
    const begin = rules.startDate && rules.startDate > year.from ? rules.startDate : year.from;
    // Zugeteilt wird fuer jeden Monat, der am oder nach dem Beginn anfaengt.
    const months = monthStarts(year).filter((m) => m >= begin);
    const raw: Omit<VacationEntry, "balance">[] = [];
    const carried = rules.carryOver ? Math.max(0, rules.carryOverMax === null ? carryIn : Math.min(carryIn, rules.carryOverMax)) : 0;
    if (carried) raw.push({ date: year.from, kind: "CARRY", label: "Übertrag aus dem Vorjahr", days: carried });
    if (rules.allocation === "YEARLY") { if (months.length) raw.push({ date: months[0], kind: "ALLOCATION", label: "Jahresanspruch" + (months.length < 12 ? " anteilig (" + months.length + "/12)" : ""), days: rules.daysPerYear * months.length / 12 }); }
    else for (const m of months) if (year.from < last.from || m <= input.asOf) raw.push({ date: m, kind: "ALLOCATION", label: "Monatsanteil", days: rules.daysPerYear / 12 });
    let taken = 0, planned = 0, pending = 0, adjusted = 0;
    for (const a of input.absences) {
      const days = vacationDays(a, year, rules, input.holidays);
      if (!days) continue;
      if (a.status === "PENDING") { pending += days; continue; }
      const date = a.from > year.from ? a.from : year.from;
      if (date > input.today) planned += days; else taken += days;
      raw.push({ date, kind: "TAKEN", label: "Urlaub " + german(a.from) + (a.to !== a.from ? " – " + german(a.to) : ""), days: -days });
    }
    for (const x of input.adjustments) if (x.date >= year.from && x.date <= year.to) { adjusted += x.days; raw.push({ date: x.date, kind: "ADJUSTMENT", label: x.comment, days: x.days }); }
    const order = { CARRY: 0, ALLOCATION: 1, ADJUSTMENT: 2, TAKEN: 3 };
    let running = 0;
    const entries = raw.sort((x, y) => x.date.localeCompare(y.date) || order[x.kind] - order[y.kind]).map((e) => { running = round2(running + e.days); return { ...e, days: round2(e.days), balance: running }; });
    const entitlement = round2(raw.filter((e) => e.kind === "ALLOCATION").reduce((sum, e) => sum + e.days, 0));
    years.push({ from: year.from, to: year.to, entitlement, carried, adjustments: round2(adjusted), taken, planned, pending, available: running, entries });
    carryIn = Math.max(0, running);
  }
  return years;
}
