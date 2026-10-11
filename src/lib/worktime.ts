import type { Prisma } from "@prisma/client";
import { addDate, shiftRange, weekDate } from "./berlin";
import { wallToUtcMinutes } from "./checkin";
import { branchHolidays } from "./holidays";
import { plannedMinutes } from "./planning";

type Tx = Prisma.TransactionClient;

/**
 * Hinweise zur geplanten Arbeitszeit nach den gesetzlichen Grundregeln des
 * Arbeitszeitgesetzes (Stand 23.10.2024, gesetze-im-internet.de/arbzg) und
 * der betrieblichen Vorgabe "Maximale Stunden pro Tag". Nur Hinweise fuer die
 * Planung - sie sperren nichts. Tarifvertraege, Betriebsvereinbarungen (§ 7),
 * Ausgleichszeitraeume, Nachtarbeitnehmer (§ 6) und Ausnahmen (§§ 14, 15)
 * kennt die App nicht; ohne Hinweis ist ein Plan deshalb nicht "rechtskonform".
 */
export type WorkHint = { userId: string; date: string; rule: "TAG_10" | "TAG_8" | "PAUSE" | "RUHEZEIT" | "SONNTAG" | "FEIERTAG" | "TAGE_AM_STUECK" | "WOCHE_48" | "BETRIEB_TAG"; text: string };

export type PlannedWork = { userId: string; date: string; dayOfWeek: number; start: number; end: number; net: number; holiday: string | null };

const h = (minutes: number) => (minutes / 60).toLocaleString("de-DE", { maximumFractionDigits: 2 }) + " h";
const day = (date: string) => new Date(date + "T12:00:00Z").toLocaleDateString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit", timeZone: "UTC" });

/** Geplante Schicht einer Person als echte Zeitspanne (Europe/Berlin) mit Nettozeit und Feiertag am Einsatzort. */
export function plannedWork(userId: string, shift: Parameters<typeof plannedMinutes>[0], holidayState: string | null): PlannedWork {
  const range = shiftRange(shift);
  return {
    userId, date: range.date, dayOfWeek: shift.dayOfWeek,
    start: wallToUtcMinutes(range.start), end: wallToUtcMinutes(range.end), net: plannedMinutes(shift),
    holiday: branchHolidays(holidayState, range.date, range.date)[0]?.name ?? null,
  };
}

/**
 * Hinweise fuer die Tage from..to (YYYY-MM-DD). work enthaelt zusaetzlich
 * die Tage davor (fuer Ruhezeit und Tage am Stueck), sonst gelten die
 * Pruefungen nur innerhalb des Zeitraums.
 */
export function workTimeHints(work: PlannedWork[], from: string, to: string, maxHoursPerDay: number | null): WorkHint[] {
  const hints: WorkHint[] = [];
  const people = [...new Set(work.map(w => w.userId))];
  for (const userId of people) {
    const own = work.filter(w => w.userId === userId).sort((a, b) => a.start - b.start);
    const add = (date: string, rule: WorkHint["rule"], text: string) => { if (date >= from && date <= to) hints.push({ userId, date, rule, text }); };
    // § 3: werktaegliche Arbeitszeit (Schichten nach Beginntag).
    const perDay = new Map<string, number>();
    for (const w of own) perDay.set(w.date, (perDay.get(w.date) ?? 0) + w.net);
    for (const [date, minutes] of perDay) {
      if (minutes > 600) add(date, "TAG_10", `${day(date)}: ${h(minutes)} geplant – über der Höchstgrenze von 10 h je Werktag (§ 3 ArbZG). Abweichungen nur durch Tarifvertrag oder Behörde (§ 7).`);
      else if (minutes > 480) add(date, "TAG_8", `${day(date)}: ${h(minutes)} geplant – über 8 h nur zulässig, wenn im Durchschnitt von 6 Monaten bzw. 24 Wochen 8 h je Werktag nicht überschritten werden (§ 3 ArbZG). Den Ausgleich prüft die App nicht.`);
      if (maxHoursPerDay && minutes > maxHoursPerDay * 60) add(date, "BETRIEB_TAG", `${day(date)}: ${h(minutes)} geplant – über der betrieblichen Vorgabe von ${maxHoursPerDay} h pro Tag (Einstellungen → Zeiterfassung).`);
    }
    for (let i = 0; i < own.length; i++) {
      const w = own[i], pause = (w.end - w.start) - w.net;
      // § 4: Ruhepause nach Arbeitszeit (ohne Pausen).
      if (w.net > 540 && pause < 45) add(w.date, "PAUSE", `${day(w.date)}: ${h(w.net)} Arbeitszeit mit ${pause} Min. Pause – bei mehr als 9 h sind mindestens 45 Min. vorgeschrieben (§ 4 ArbZG).`);
      else if (w.net > 360 && pause < 30) add(w.date, "PAUSE", `${day(w.date)}: ${h(w.net)} Arbeitszeit mit ${pause} Min. Pause – bei mehr als 6 h sind mindestens 30 Min. vorgeschrieben (§ 4 ArbZG).`);
      // § 5: 11 h ununterbrochene Ruhezeit zwischen zwei Schichten.
      const before = own[i - 1];
      if (before && w.start >= before.end && w.start - before.end < 660) add(w.date, "RUHEZEIT", `${day(w.date)}: nur ${h(w.start - before.end)} Ruhezeit nach der vorherigen Schicht – mindestens 11 h ununterbrochen (§ 5 ArbZG). Kürzer nur in bestimmten Branchen oder per Tarifvertrag (§ 5 Abs. 2, § 7).`);
    }
    // §§ 9-11: Sonn- und Feiertagsarbeit; Bewachung ist nach § 10 Abs. 1 Nr. 13 zulaessig, braucht aber einen Ersatzruhetag.
    for (const date of [...perDay.keys()].sort()) {
      const w = own.find(x => x.date === date)!;
      if (w.dayOfWeek === 7) add(date, "SONNTAG", `${day(date)}: Sonntagsarbeit – im Bewachungsgewerbe zulässig (§ 10 Abs. 1 Nr. 13 ArbZG), wenn die Arbeit nicht an Werktagen erledigt werden kann. Ersatzruhetag innerhalb von zwei Wochen (§ 11 Abs. 3); mindestens 15 freie Sonntage im Jahr (§ 11 Abs. 1).`);
      else if (w.holiday) add(date, "FEIERTAG", `${day(date)}: Arbeit am Feiertag (${w.holiday}) – Ersatzruhetag innerhalb von acht Wochen (§ 11 Abs. 3 ArbZG).`);
    }
    // Tage am Stueck: das ArbZG nennt keine Hoechstzahl; ohne freien Tag fehlt aber jeder Ruhetag.
    const dates = new Set(perDay.keys());
    for (const date of [...dates].sort()) {
      if (dates.has(addDate(date, 1))) continue;
      let start = date, length = 1;
      while (dates.has(addDate(start, -1))) { start = addDate(start, -1); length++; }
      if (length >= 7) add(date, "TAGE_AM_STUECK", `${length} Tage am Stück ohne freien Tag (${day(start)} bis ${day(date)}). Das ArbZG nennt keine Höchstzahl von Arbeitstagen; bei Sonntagsarbeit ist aber ein Ersatzruhetag nötig (§ 11 Abs. 3).`);
    }
    // Woche: rechnerisch 6 Werktage x 8 h; Sonntagsstunden zaehlen mit (§ 11 Abs. 2).
    for (let monday = from; monday <= to; monday = addDate(monday, 7)) {
      const sunday = addDate(monday, 6);
      const minutes = own.filter(w => w.date >= monday && w.date <= sunday).reduce((sum, w) => sum + w.net, 0);
      if (minutes > 2880) add(monday, "WOCHE_48", `Woche ab ${day(monday)}: ${h(minutes)} geplant – mehr als 48 h (6 Werktage × 8 h) nur zulässig, wenn der Durchschnitt von 8 h je Werktag in 6 Monaten bzw. 24 Wochen eingehalten wird (§ 3, § 11 Abs. 2 ArbZG). Den Ausgleich prüft die App nicht.`);
    }
  }
  return hints.sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Daten fuer workTimeHints: alle geplanten Schichten (Entwurf und
 * veroeffentlicht) der Personen in branches (null = alle Standorte) von 13
 * Tagen vor der Woche bis zu ihrem Ende.
 */
export async function loadPlannedWork(tx: Tx, orgId: string, userIds: string[], year: number, weekNumber: number, branches: string[] | null): Promise<{ work: PlannedWork[]; from: string; to: string }> {
  const from = weekDate(year, weekNumber, 1), to = weekDate(year, weekNumber, 7), earliest = addDate(from, -14);
  const bookings = userIds.length ? await tx.booking.findMany({
    where: { userId: { in: userIds }, shift: { deletedAt: null, schedule: { organizationId: orgId, deletedAt: null, ...(branches ? { branchId: { in: branches } } : {}), year: { gte: year - 1, lte: year + 1 } } } },
    select: { userId: true, shift: { select: { dayOfWeek: true, shiftFrom: true, shiftTo: true, pauseOption: true, pauseValue: true, schedule: { select: { year: true, weekNumber: true, branch: { select: { holidayState: true } } } } } } },
  }) : [];
  const work = bookings.flatMap(b => {
    const w = plannedWork(b.userId!, b.shift, b.shift.schedule.branch?.holidayState ?? null);
    return w.date >= earliest && w.date <= to ? [w] : [];
  });
  return { work, from, to };
}
