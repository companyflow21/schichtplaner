/**
 * Lohnberechnung (Rechenkern ohne Datenbank).
 *
 * Grundlage sind die erfassten Zeitbuchungen (Ist). Je Buchung:
 * - Normalstunden = Nettominuten (wie recordMinutes) x Stundenlohn der
 *   geltenden Lohnart. Es gilt die Lohnart des Arbeitsbereichs der Schicht,
 *   sonst die Standard-Lohnart der Person.
 * - Zuschlag = Minuten der Buchung im Zeitblock des Zuschlags an passenden
 *   Tagen x Satz. Der Satz ist ein fester Betrag je Stunde oder ein Prozentsatz
 *   der geltenden Lohnart. Mehrere zutreffende Zuschlaege werden addiert.
 *
 * Pausen sind nur als Summe bekannt; sie werden anteilig auf die Zeitbloecke
 * verteilt (Blockminuten x Netto / Brutto).
 *
 * Zeitachse wie bei recordMinutes: Stoppuhr und Check-in rechnen mit echten
 * Zeitpunkten (Zeitumstellung zaehlt die echte Dauer), manuelle Von/Bis-Zeiten
 * mit der Wanduhr. Buchungen nur mit Dauer haben keine Uhrzeit; fuer sie gelten
 * nur Zuschlaege fuer den ganzen Tag (00:00 bis 00:00).
 */
import { addDate, berlinDate, minuteOfDay, rangeMinutes, recordMinutes } from "./berlin";
import { wallToUtcMinutes } from "./checkin";

export type PayTypeLite = { id: string; title: string; hourlyRateCents: number; code: string | null; isActive: boolean };
export type SurchargeLite = {
  id: string; name: string; code: string | null; isActive: boolean;
  weekdays: number[]; holidays: boolean; dates: string[]; timeFrom: string; timeTo: string;
  allPeople: boolean; userIds: string[]; allDivisions: boolean; divisionIds: string[];
  rateKind: "PERCENT" | "AMOUNT"; rate: number;
};
export type PayRecord = {
  id: string; userId: string; date: Date | string; type: string;
  timeFrom: string | null; timeTo: string | null; startedAt?: Date | string | null; endedAt?: Date | string | null;
  durationHours: number | null; durationMinutes: number | null; breakSeconds?: number;
};
export type PayLine = {
  kind: "BASE" | "SURCHARGE" | "ABSENCE";
  /** Lohnart bzw. Zuschlag */
  refId: string | null;
  title: string;
  code: string | null;
  minutes: number;
  /** Satz je Stunde in Cent (bei Prozent: der daraus folgende Betrag je Stunde) */
  rateCents: number | null;
  /** nur bei Prozent-Zuschlaegen, Hundertstel Prozent */
  percent: number | null;
  amountCents: number;
};
export type RecordPay = { recordId: string; minutes: number; payType: PayTypeLite | null; lines: PayLine[]; totalCents: number; warnings: string[] };

const WHOLE_DAY = 1440;

/** ISO-Wochentag 1 (Mo) bis 7 (So) eines Kalendertags YYYY-MM-DD. */
export function isoWeekday(date: string): number {
  return ((new Date(date + "T12:00:00Z").getUTCDay() + 6) % 7) + 1;
}
const naive = (date: string, minute: number) => Date.parse(date + "T00:00:00Z") / 60000 + minute;
const day = (value: Date | string) => typeof value === "string" ? value.slice(0, 10) : value.toISOString().slice(0, 10);

export function surchargeMatchesDay(s: Pick<SurchargeLite, "weekdays" | "holidays" | "dates">, date: string, holidays: Set<string>): boolean {
  return s.weekdays.includes(isoWeekday(date)) || (s.holidays && holidays.has(date)) || s.dates.includes(date.slice(5));
}
export function blockMinutes(s: Pick<SurchargeLite, "timeFrom" | "timeTo">): number {
  return rangeMinutes(s.timeFrom, s.timeTo) || WHOLE_DAY;
}

/** Arbeitszeitraum einer Buchung auf ihrer Zeitachse; null ohne Uhrzeiten. */
function workSpan(r: PayRecord): { start: number; end: number; real: boolean; firstDate: string; lastDate: string } | null {
  if (r.startedAt && r.endedAt) {
    const start = new Date(r.startedAt).getTime() / 60000, end = new Date(r.endedAt).getTime() / 60000;
    return { start, end, real: true, firstDate: berlinDate(new Date(r.startedAt)), lastDate: berlinDate(new Date(r.endedAt)) };
  }
  if (r.type !== "MANUAL_DURATION" && r.timeFrom && r.timeTo) {
    const date = day(r.date), start = naive(date, minuteOfDay(r.timeFrom)), end = start + rangeMinutes(r.timeFrom, r.timeTo);
    return { start, end, real: false, firstDate: date, lastDate: day(new Date(end * 60000)) };
  }
  return null;
}

/** Minuten der Arbeitszeit im Zeitblock des Zuschlags (vor Abzug der Pause). */
export function surchargeGrossMinutes(r: PayRecord, s: SurchargeLite, holidays: Set<string>): number {
  const span = workSpan(r);
  if (!span) {
    // Nur Dauer: kein Zeitpunkt bekannt; nur ganztaegige Zuschlaege am Buchungstag.
    if (blockMinutes(s) !== WHOLE_DAY || s.timeFrom !== "00:00" || !surchargeMatchesDay(s, day(r.date), holidays)) return 0;
    return recordMinutes(r) + (r.breakSeconds ?? 0) / 60;
  }
  let total = 0;
  // Ein Block kann am Vortag beginnen und in den Arbeitstag hineinreichen.
  for (let d = addDate(span.firstDate, -1); d <= span.lastDate; d = addDate(d, 1)) {
    if (!surchargeMatchesDay(s, d, holidays)) continue;
    const from = naive(d, minuteOfDay(s.timeFrom)), to = from + blockMinutes(s);
    const start = span.real ? wallToUtcMinutes(from) : from, end = span.real ? wallToUtcMinutes(to) : to;
    total += Math.max(0, Math.min(end, span.end) - Math.max(start, span.start));
  }
  return total;
}

const round = (value: number) => Math.round(value);

/**
 * Lohn einer Buchung. payType: geltende Lohnart (oder null), divisionId:
 * Arbeitsbereich der zugehoerigen Schicht (oder null).
 */
export function payForRecord(r: PayRecord, ctx: { payType: PayTypeLite | null; divisionId: string | null; surcharges: SurchargeLite[]; holidays: Set<string> }): RecordPay {
  const minutes = recordMinutes(r);
  const warnings: string[] = [];
  const pt = ctx.payType;
  if (!pt) warnings.push("Keine Lohnart hinterlegt.");
  const lines: PayLine[] = [{ kind: "BASE", refId: pt?.id ?? null, title: pt?.title ?? "Ohne Lohnart", code: pt?.code ?? null, minutes, rateCents: pt?.hourlyRateCents ?? null, percent: null, amountCents: pt ? round(minutes / 60 * pt.hourlyRateCents) : 0 }];
  const span = workSpan(r);
  const gross = span ? span.end - span.start : minutes + (r.breakSeconds ?? 0) / 60;
  const factor = gross > 0 ? minutes / gross : 0;
  let partialSkipped = false;
  for (const s of ctx.surcharges) {
    if (!s.isActive) continue;
    if (!s.allPeople && !s.userIds.includes(r.userId)) continue;
    if (!s.allDivisions && !(ctx.divisionId && s.divisionIds.includes(ctx.divisionId))) continue;
    if (!span && blockMinutes(s) !== WHOLE_DAY && surchargeMatchesDay(s, day(r.date), ctx.holidays)) partialSkipped = true;
    const inBlock = Math.min(minutes, round(surchargeGrossMinutes(r, s, ctx.holidays) * factor));
    if (inBlock <= 0) continue;
    if (s.rateKind === "PERCENT") {
      if (!pt) { warnings.push("„" + s.name + "“: Prozentsatz ohne Lohnart nicht berechenbar."); }
      const perHour = pt ? pt.hourlyRateCents * s.rate / 10000 : null;
      lines.push({ kind: "SURCHARGE", refId: s.id, title: s.name, code: s.code, minutes: inBlock, rateCents: perHour, percent: s.rate, amountCents: perHour === null ? 0 : round(inBlock / 60 * perHour) });
    } else {
      lines.push({ kind: "SURCHARGE", refId: s.id, title: s.name, code: s.code, minutes: inBlock, rateCents: s.rate, percent: null, amountCents: round(inBlock / 60 * s.rate) });
    }
  }
  if (partialSkipped) warnings.push("Buchung ohne Uhrzeit: zeitabhängige Zuschläge nicht berechnet.");
  return { recordId: r.id, minutes, payType: pt, lines, totalCents: lines.reduce((sum, l) => sum + l.amountCents, 0), warnings };
}

/**
 * Bezahlte Abwesenheit (z. B. Urlaub, Krankheit) fuer eine geplante Schicht:
 * Planminuten x Stundenlohn der geltenden Lohnart, als eigene Zeile mit dem
 * Lohnart-Code der Abwesenheitsart (sonst dem der Lohnart). Zuschlaege fallen
 * hier nicht an (Lohnfortzahlung nach Lohnausfallprinzip mit dem Steuerbuero klaeren).
 */
export function payForAbsence(x: { id: string; minutes: number; category: string; payCode: string | null }, payType: PayTypeLite | null): RecordPay {
  const amountCents = payType ? round(x.minutes / 60 * payType.hourlyRateCents) : 0;
  return {
    recordId: "a-" + x.id, minutes: x.minutes, payType, totalCents: amountCents, warnings: payType ? [] : ["Keine Lohnart hinterlegt."],
    lines: [{ kind: "ABSENCE", refId: "abs:" + x.category, title: "Abwesenheit: " + x.category, code: x.payCode ?? payType?.code ?? null, minutes: x.minutes, rateCents: payType?.hourlyRateCents ?? null, percent: null, amountCents }],
  };
}

/** Geltende Lohnart: Arbeitsbereich vor Person; inaktive Lohnarten zaehlen nicht. */
export function effectivePayType(byId: Map<string, PayTypeLite>, divisionPayTypeId: string | null | undefined, memberPayTypeId: string | null | undefined): PayTypeLite | null {
  for (const id of [divisionPayTypeId, memberPayTypeId]) {
    const pt = id ? byId.get(id) : undefined;
    if (pt?.isActive) return pt;
  }
  return null;
}

export type PayTotalLine = Omit<PayLine, "amountCents" | "minutes"> & { minutes: number; amountCents: number };
/** Summen je Lohnart bzw. Zuschlag (fuer Uebersicht und Export). */
export function sumLines(pays: RecordPay[]): PayTotalLine[] {
  const map = new Map<string, PayTotalLine>();
  for (const line of pays.flatMap((p) => p.lines)) {
    const key = line.kind + "|" + (line.refId ?? "-") + "|" + (line.rateCents ?? "-");
    const entry = map.get(key);
    if (entry) { entry.minutes += line.minutes; entry.amountCents += line.amountCents; }
    else map.set(key, { ...line });
  }
  const order = { BASE: 0, ABSENCE: 1, SURCHARGE: 2 };
  return [...map.values()].sort((a, b) => order[a.kind] - order[b.kind] || a.title.localeCompare(b.title, "de"));
}

/** Satz als Text: "25 %" bzw. "2,50 €/h". */
export function rateLabel(s: Pick<SurchargeLite, "rateKind" | "rate">): string {
  return s.rateKind === "PERCENT" ? formatNumber(s.rate / 100) + " %" : formatNumber(s.rate / 100) + " €/h";
}
/** Zahl mit hoechstens zwei Nachkommastellen, deutsches Format ohne Tausenderpunkt. */
export function formatNumber(value: number): string {
  return value.toLocaleString("de-DE", { maximumFractionDigits: 2, useGrouping: false });
}
export const euro = (cents: number) => (cents / 100).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
export const hours = (minutes: number) => (minutes / 60).toFixed(2).replace(".", ",");
