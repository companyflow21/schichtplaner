/**
 * Planungsregeln je Person (Rechenkern ohne Datenbank).
 *
 * Regeln sind Hinweise fuer die Planung: ein Verstoss sperrt weder das
 * Einteilen noch das Veroeffentlichen. Gezaehlt werden die geplanten
 * Schichten einer Person an allen Standorten (Entwuerfe eingeschlossen); eine
 * Schicht gehoert zu dem Tag, an dem sie beginnt. Stunden sind Planstunden
 * (Dauer minus Pause). Schichten mit hoechstens 15 Minuten Abstand gelten als
 * zusammenhaengend (keine Ruhezeit dazwischen).
 *
 * Schichten an Standorten, deren Dienstplan die betrachtende Person nicht
 * sehen darf (elsewhere), zaehlen mit, werden aber nie benannt: keine
 * Schicht-ID, keine Uhrzeit, nur "an einem anderen Standort".
 */
import { z } from "zod";
import { addDate, isoWeek, weekDate } from "./berlin";

export const RULE_KEYS = ["hours", "dailyHours", "rest", "consecutiveDays", "daysPerWeek", "workdayBlocks", "consecutiveWeekends", "freeDayAfterWeekend", "freeDayBlocks"] as const;
export type RuleKey = (typeof RULE_KEYS)[number];

const hoursRule = z.object({
  enabled: z.boolean(), period: z.enum(["WEEK", "MONTH"]),
  min: z.number().min(0).max(744).nullable(), max: z.number().min(0).max(744).nullable(),
}).refine((r) => r.min === null || r.max === null || r.min <= r.max, "Mindeststunden dürfen nicht über den Höchststunden liegen.")
  .refine((r) => !r.enabled || r.min !== null || r.max !== null, "Bitte Mindest- oder Höchststunden angeben.");
const flag = z.object({ enabled: z.boolean() });

export const rulesSchema = z.object({
  hours: hoursRule,
  dailyHours: z.object({ enabled: z.boolean(), max: z.number().min(1).max(24) }),
  rest: z.object({ enabled: z.boolean(), hours: z.number().min(1).max(24) }),
  consecutiveDays: z.object({ enabled: z.boolean(), max: z.number().int().min(1).max(31) }),
  daysPerWeek: z.object({ enabled: z.boolean(), max: z.number().int().min(1).max(7) }),
  workdayBlocks: flag,
  consecutiveWeekends: z.object({ enabled: z.boolean(), max: z.number().int().min(1).max(52) }),
  freeDayAfterWeekend: flag,
  freeDayBlocks: flag,
});
export type Rules = z.infer<typeof rulesSchema>;
/** Einzelne Regeln (allgemein oder als Abweichung einer Person). */
export const partialRulesSchema = rulesSchema.partial();
export type PartialRules = z.infer<typeof partialRulesSchema>;

/** Vorgaben: alle aus; Werte nach Arbeitszeitgesetz (10 h am Tag, 11 h Ruhezeit, 48 h in der Woche). */
export const DEFAULT_RULES: Rules = {
  hours: { enabled: false, period: "WEEK", min: null, max: 48 },
  dailyHours: { enabled: false, max: 10 },
  rest: { enabled: false, hours: 11 },
  consecutiveDays: { enabled: false, max: 6 },
  daysPerWeek: { enabled: false, max: 5 },
  workdayBlocks: { enabled: false },
  consecutiveWeekends: { enabled: false, max: 2 },
  freeDayAfterWeekend: { enabled: false },
  freeDayBlocks: { enabled: false },
};

/** Gespeicherte Regeln lesen; Unbekanntes und Ungueltiges faellt auf die Vorgabe zurueck. */
export function readRules(value: unknown): PartialRules {
  if (!value || typeof value !== "object") return {};
  const out: Record<string, unknown> = {};
  for (const key of RULE_KEYS) {
    const parsed = rulesSchema.shape[key].safeParse((value as Record<string, unknown>)[key]);
    if (parsed.success) out[key] = parsed.data;
  }
  return out as PartialRules;
}

/** Vorgabe, darueber die allgemeinen Regeln, darueber die Abweichungen der Person (je Regel ganz). */
export function effectiveRules(general: PartialRules, own: PartialRules = {}): Rules {
  return { ...DEFAULT_RULES, ...general, ...own };
}

export const anyEnabled = (rules: Rules) => RULE_KEYS.some((k) => rules[k].enabled);

/**
 * start/end: Minuten auf einer durchgehenden Zeitachse (fuer die Ruhezeit);
 * from: Beginn "HH:MM" fuer Texte (sonst aus start); elsewhere: Standort ohne
 * Leserecht der betrachtenden Person.
 */
export type PlannedShift = { id: string; date: string; start: number; end: number; minutes: number; from?: string; elsewhere?: boolean };
/** shiftIds: nur sichtbare Schichten; elsewhere: auch Schichten an einem anderen Standort beteiligt. */
export type Violation = { rule: RuleKey; date: string; text: string; shiftIds: string[]; elsewhere?: boolean };
/** Antwort der Regelpruefung eines Wochenplans (GET /api/schedules/[id]/violations). */
export type PersonViolations = { userId: string; name: string; violations: Violation[] };
export type ViolationReport = { enabled: boolean; count: number; people: PersonViolations[] };

const CONTIGUOUS = 15;
const ELSEWHERE = " – auch Schichten an einem anderen Standort";
const weekday = (date: string) => ((new Date(date + "T12:00:00Z").getUTCDay() + 6) % 7) + 1;
const h = (minutes: number) => (Math.round(minutes / 6) / 10).toLocaleString("de-DE") + " h";
const n = (value: number) => value.toLocaleString("de-DE");
const day = (date: string) => date.slice(8, 10) + "." + date.slice(5, 7) + ".";
const weekKey = (date: string) => { const w = isoWeek(date); return w.year + "-" + String(w.weekNumber).padStart(2, "0"); };
const MONTHS = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];

/**
 * Verstoesse einer Person. "window" begrenzt Wochen und Monate, deren Summen
 * geprueft werden; Folgen (Tage, Wochenenden, Ruhezeit) werden ueber alle
 * uebergebenen Schichten geprueft - der Aufrufer filtert nach Relevanz.
 */
export function ruleViolations(rules: Rules, shifts: PlannedShift[], window: { from: string; to: string }): Violation[] {
  const out: Violation[] = [];
  const sorted = [...shifts].sort((x, y) => x.start - y.start);
  const byDate = new Map<string, PlannedShift[]>();
  for (const s of sorted) byDate.set(s.date, [...(byDate.get(s.date) ?? []), s]);
  const days = [...byDate.keys()].sort();
  const worked = (date: string) => byDate.has(date);
  // named: der Text nennt den anderen Standort schon selbst.
  const add = (rule: RuleKey, date: string, text: string, list: PlannedShift[], named = false) => {
    const hidden = list.some((s) => s.elsewhere);
    out.push({ rule, date, text: text + (hidden && !named ? ELSEWHERE : ""), shiftIds: list.filter((s) => !s.elsewhere).map((s) => s.id), ...(hidden ? { elsewhere: true } : {}) });
  };

  if (rules.hours.enabled) {
    const { period, min, max } = rules.hours;
    const groups = new Map<string, { label: string; date: string; list: PlannedShift[] }>();
    for (let d = window.from; d <= window.to; d = addDate(d, 1)) {
      const key = period === "WEEK" ? weekKey(d) : d.slice(0, 7);
      if (!groups.has(key)) {
        const w = isoWeek(d);
        groups.set(key, period === "WEEK"
          ? { label: "in KW " + w.weekNumber, date: weekDate(w.year, w.weekNumber), list: [] }
          : { label: "im " + MONTHS[Number(d.slice(5, 7)) - 1] + " " + d.slice(0, 4), date: d.slice(0, 8) + "01", list: [] });
      }
    }
    for (const s of sorted) groups.get(period === "WEEK" ? weekKey(s.date) : s.date.slice(0, 7))?.list.push(s);
    for (const g of groups.values()) {
      const total = g.list.reduce((sum, s) => sum + s.minutes, 0);
      if (max !== null && total > max * 60) add("hours", g.date, h(total) + " " + g.label + " (höchstens " + n(max) + " h)", g.list);
      if (min !== null && total < min * 60) add("hours", g.date, h(total) + " " + g.label + " (mindestens " + n(min) + " h)", g.list);
    }
  }

  if (rules.dailyHours.enabled) {
    for (const [date, list] of byDate) {
      const total = list.reduce((sum, s) => sum + s.minutes, 0);
      if (total > rules.dailyHours.max * 60) add("dailyHours", date, h(total) + " am " + day(date) + " (höchstens " + n(rules.dailyHours.max) + " h am Tag)", list);
    }
  }

  if (rules.rest.enabled) {
    // Gemessen ab dem Ende der vorigen (ggf. zusammenhaengenden) Schichtfolge.
    let previous: PlannedShift | null = null, previousEnd = -Infinity;
    for (const s of sorted) {
      const gap = s.start - previousEnd;
      if (previous && gap > CONTIGUOUS && gap < rules.rest.hours * 60) {
        const before = s.elsewhere ? "vor einer Schicht an einem anderen Standort am " + day(s.date)
          : "vor der Schicht am " + day(s.date) + " um " + (s.from ?? String(Math.floor((s.start % 1440) / 60)).padStart(2, "0") + ":" + String(s.start % 60).padStart(2, "0"));
        add("rest", s.date, "Ruhezeit " + h(gap) + " " + before + " (mindestens " + n(rules.rest.hours) + " h)", [previous, s], !!s.elsewhere);
      }
      if (s.end > previousEnd) { previous = s; previousEnd = s.end; }
    }
  }

  if (rules.consecutiveDays.enabled) {
    const max = rules.consecutiveDays.max;
    for (let i = 0; i < days.length; ) {
      let j = i;
      while (j + 1 < days.length && days[j + 1] === addDate(days[j], 1)) j++;
      if (j - i + 1 > max) {
        const beyond = days.slice(i + max, j + 1);
        add("consecutiveDays", beyond[0], n(j - i + 1) + " Arbeitstage am Stück, " + day(days[i]) + "–" + day(days[j]) + " (höchstens " + n(max) + ")", beyond.flatMap((d) => byDate.get(d)!));
      }
      i = j + 1;
    }
  }

  if (rules.daysPerWeek.enabled) {
    const weeks = new Map<string, string[]>();
    for (const d of days) if (d >= window.from && d <= window.to) weeks.set(weekKey(d), [...(weeks.get(weekKey(d)) ?? []), d]);
    for (const list of weeks.values()) {
      if (list.length > rules.daysPerWeek.max) {
        const w = isoWeek(list[0]);
        add("daysPerWeek", weekDate(w.year, w.weekNumber), n(list.length) + " Arbeitstage in KW " + w.weekNumber + " (höchstens " + n(rules.daysPerWeek.max) + ")", list.flatMap((d) => byDate.get(d)!));
      }
    }
  }

  if (rules.workdayBlocks.enabled) {
    for (const d of days) if (!worked(addDate(d, -1)) && !worked(addDate(d, 1))) add("workdayBlocks", d, "Einzelner Arbeitstag am " + day(d) + " (mindestens 2 am Stück)", byDate.get(d)!);
  }

  if (rules.freeDayBlocks.enabled && days.length) {
    for (let d = addDate(days[0], 1); d < days[days.length - 1]; d = addDate(d, 1)) {
      if (!worked(d) && worked(addDate(d, -1)) && worked(addDate(d, 1))) add("freeDayBlocks", d, "Einzelner freier Tag am " + day(d) + " (mindestens 2 freie Tage am Stück)", [...byDate.get(addDate(d, -1))!, ...byDate.get(addDate(d, 1))!]);
    }
  }

  // Wochenende = Samstag und Sonntag einer Kalenderwoche, gekennzeichnet durch den Samstag.
  const weekends = [...new Set(days.filter((d) => weekday(d) >= 6).map((d) => (weekday(d) === 7 ? addDate(d, -1) : d)))].sort();
  const weekendShifts = (saturday: string) => [...(byDate.get(saturday) ?? []), ...(byDate.get(addDate(saturday, 1)) ?? [])];

  if (rules.consecutiveWeekends.enabled) {
    const max = rules.consecutiveWeekends.max;
    for (let i = 0; i < weekends.length; ) {
      let j = i;
      while (j + 1 < weekends.length && weekends[j + 1] === addDate(weekends[j], 7)) j++;
      if (j - i + 1 > max) {
        const beyond = weekends.slice(i + max, j + 1);
        add("consecutiveWeekends", beyond[0], n(j - i + 1) + " Wochenenden in Folge mit Schicht bis " + day(addDate(weekends[j], 1)) + " (höchstens " + n(max) + ")", beyond.flatMap(weekendShifts));
      }
      i = j + 1;
    }
  }

  if (rules.freeDayAfterWeekend.enabled) {
    for (const saturday of weekends) {
      const needed = [saturday, addDate(saturday, 1)].filter(worked).length;
      const monday = addDate(saturday, 2);
      const free = [0, 1, 2, 3, 4].map((i) => addDate(monday, i)).filter((d) => !worked(d)).length;
      if (free < needed) {
        add("freeDayAfterWeekend", monday, "Nach " + (needed === 1 ? "einem Wochenendtag" : "zwei Wochenendtagen") + " mit Schicht " + (free === 0 ? "kein freier Werktag" : "nur ein freier Werktag") + " in der Woche ab " + day(monday) + " (je Wochenendtag einer)", [...weekendShifts(saturday), ...[0, 1, 2, 3, 4].flatMap((i) => byDate.get(addDate(monday, i)) ?? [])]);
      }
    }
  }

  return out.sort((x, y) => x.date.localeCompare(y.date) || RULE_KEYS.indexOf(x.rule) - RULE_KEYS.indexOf(y.rule));
}

/** Kurztexte der Regeln fuer Einstellungen und Liste. */
export const RULE_LABEL: Record<RuleKey, string> = {
  hours: "Mindest- und Höchststunden",
  dailyHours: "Höchststunden am Tag",
  rest: "Mindestruhezeit zwischen Schichten",
  consecutiveDays: "Höchstens Arbeitstage am Stück",
  daysPerWeek: "Höchstens Arbeitstage je Woche",
  workdayBlocks: "Arbeitstage zusammenhängend (mindestens 2)",
  consecutiveWeekends: "Höchstens Wochenenden mit Schicht in Folge",
  freeDayAfterWeekend: "Freier Werktag je Wochenendtag mit Schicht",
  freeDayBlocks: "Freie Tage zusammenhängend (mindestens 2)",
};
