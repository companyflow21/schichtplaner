/**
 * Zeitkonto (Rechenkern ohne Datenbank).
 *
 * Ab dem Startdatum des ersten Soll-Eintrags wird je Periode (Woche Mo-So oder
 * Kalendermonat, je nach Soll-Eintrag) gerechnet; jeder Eintrag gilt bis zum
 * naechsten. Beginnt oder endet ein Eintrag mitten in einer Periode, zaehlt das
 * Soll anteilig nach Werktagen (Mo-Fr).
 *
 * Berechnungsart:
 * - Ist - Soll: Tage nach heute zaehlen mit ihren Planstunden (Schaetzung).
 * - Plan - Soll
 * - Ist - Plan: ohne Soll; Tage nach heute zaehlen mit Plan (also 0).
 * Ausgleichsbuchungen werden in der Periode ihres Datums addiert; solche vor dem
 * Start in der ersten Periode.
 */
import { addDate } from "./berlin";

export type AccountMethod = "ACTUAL_MINUS_TARGET" | "PLAN_MINUS_TARGET" | "ACTUAL_MINUS_PLAN";
export type TargetEntry = { startDate: string; minutes: number; period: "WEEK" | "MONTH" };
export type DayMinutes = { actual: number; planned: number };
export type AccountPeriod = {
  from: string; to: string; period: "WEEK" | "MONTH";
  targetMinutes: number; plannedMinutes: number; actualMinutes: number; compensationMinutes: number;
  deltaMinutes: number; balanceMinutes: number;
};
export type AccountResult = { start: string; periods: AccountPeriod[]; balanceMinutes: number } | null;

const weekday = (date: string) => ((new Date(date + "T12:00:00Z").getUTCDay() + 6) % 7) + 1;
const isWorkday = (date: string) => weekday(date) <= 5;
function workdays(from: string, to: string): number {
  let n = 0;
  for (let d = from; d <= to; d = addDate(d, 1)) if (isWorkday(d)) n++;
  return n;
}
/** Volle Periode, in der ein Tag liegt. */
export function periodOf(date: string, period: "WEEK" | "MONTH"): { from: string; to: string } {
  if (period === "WEEK") { const from = addDate(date, 1 - weekday(date)); return { from, to: addDate(from, 6) }; }
  const from = date.slice(0, 8) + "01";
  return { from, to: addDate(addDate(from, 32).slice(0, 8) + "01", -1) };
}

export function computeAccount(input: {
  targets: TargetEntry[]; days: Map<string, DayMinutes>; compensations: { date: string; minutes: number }[];
  method: AccountMethod; today: string; to: string;
}): AccountResult {
  const targets = [...input.targets].sort((x, y) => x.startDate.localeCompare(y.startDate)).filter((t) => t.startDate <= input.to);
  if (!targets.length) return null;
  const start = targets[0].startDate;
  const periods: AccountPeriod[] = [];
  let balance = 0;
  targets.forEach((target, i) => {
    const phaseEnd = i + 1 < targets.length ? addDate(targets[i + 1].startDate, -1) : input.to;
    for (let from = target.startDate; from <= phaseEnd;) {
      const full = periodOf(from, target.period);
      const to = full.to < phaseEnd ? full.to : phaseEnd;
      const share = workdays(full.from, full.to) ? workdays(from, to) / workdays(full.from, full.to) : 0;
      const targetMinutes = Math.round(target.minutes * share);
      let planned = 0, actual = 0;
      for (let d = from; d <= to; d = addDate(d, 1)) {
        const v = input.days.get(d);
        if (!v) continue;
        planned += v.planned;
        actual += d > input.today ? v.planned : v.actual;
      }
      const compensation = input.compensations
        .filter((c) => (c.date >= from || (periods.length === 0 && c.date < start)) && c.date <= to)
        .reduce((sum, c) => sum + c.minutes, 0);
      const base = input.method === "ACTUAL_MINUS_TARGET" ? actual - targetMinutes : input.method === "PLAN_MINUS_TARGET" ? planned - targetMinutes : actual - planned;
      const delta = base + compensation;
      balance += delta;
      periods.push({ from, to, period: target.period, targetMinutes: input.method === "ACTUAL_MINUS_PLAN" ? 0 : targetMinutes, plannedMinutes: planned, actualMinutes: actual, compensationMinutes: compensation, deltaMinutes: delta, balanceMinutes: balance });
      from = addDate(to, 1);
    }
  });
  return { start, periods, balanceMinutes: balance };
}

/** Saldo vor einem Stichtag: Stand nach der letzten Periode, die vorher endet. */
export function balanceBefore(result: AccountResult, date: string): number {
  if (!result) return 0;
  const done = result.periods.filter((p) => p.to < date);
  return done.length ? done[done.length - 1].balanceMinutes : 0;
}
