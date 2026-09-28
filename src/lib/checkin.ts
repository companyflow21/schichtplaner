/**
 * Check-in am Einsatzort: ein zeitgestempelter Nachweis, dass die Person
 * rechtzeitig am Einsatzort war, und der Start der Zeiterfassung.
 *
 * Grenzen des Nachweises: Die Position stammt aus dem Browser und kann
 * verfaelscht werden. Das Verfahren ist deshalb nicht manipulationssicher und
 * prueft das Geraet nicht unabhaengig. Massgeblich ist allein die Serverzeit.
 * Gespeichert wird nur, was der Nachweis braucht: gerundete Entfernung,
 * Genauigkeit, Alter der Position, Verspaetung, Verfahren, Status und
 * Serverzeit - niemals Koordinaten der Person (auch nicht in Logs).
 */
import type { Prisma } from "@prisma/client";
import { addDate, berlinDate, berlinTime, isoWeek, minuteOfDay, shiftRange } from "./berlin";

type Tx = Prisma.TransactionClient;

/** Entscheidung des Auftraggebers: 50 m (je Standort im Feld checkinRadiusM). */
export const DEFAULT_RADIUS_M = 50;
/** Vorschlag: Eine groebere Ortung kann die Anwesenheit im 50-m-Umkreis nicht belegen. */
export const MAX_ACCURACY_M = 50;
/** Vorschlag: Die Position darf hoechstens 120 s alt sein. */
export const MAX_POSITION_AGE_S = 120;
/** Vorschlag: Toleranz fuer eine Geraeteuhr, die der Serveruhr vorausgeht. */
export const MAX_CLOCK_AHEAD_S = 30;
/** Vorschlag: Check-in ab 30 Minuten vor Schichtbeginn bis Schichtende. */
export const WINDOW_BEFORE_MIN = 30;

export const CHECKIN_FAILURES = ["DENIED", "UNAVAILABLE", "INACCURATE", "STALE", "OUTSIDE", "NO_COORDINATES"] as const;
export type CheckinFailure = (typeof CHECKIN_FAILURES)[number];
/** Gueltige Check-ins: GPS bestanden oder manuell freigegeben. */
export const CHECKED_IN = ["CONFIRMED", "APPROVED"];

type Point = { latitude: number; longitude: number };
export type Position = Point & { accuracy: number; timestamp: number };
type SiteShape = { latitude: number | null; longitude: number | null; checkinRadiusM: number };
type ShiftShape = { dayOfWeek: number; shiftFrom: string; shiftTo: string; schedule: { year: number; weekNumber: number } };

/** Entfernung zweier WGS84-Punkte in Metern (Haversine, mittlerer Erdradius). */
export function distanceM(a: Point, b: Point): number {
  const rad = Math.PI / 180, dLat = (b.latitude - a.latitude) * rad, dLon = (b.longitude - a.longitude) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371008.8 * Math.asin(Math.min(1, Math.sqrt(h)));
}

export type PositionResult = { ok: boolean; failure: Exclude<CheckinFailure, "DENIED" | "UNAVAILABLE"> | null; distanceM: number | null; accuracyM: number; positionAgeS: number };

/**
 * Bewertung einer gemeldeten Position, in dieser Reihenfolge: Standort ohne
 * Koordinaten, zu ungenau, zu alt (oder aus der Zukunft), ausserhalb des
 * Radius. Verglichen wird mit den ungerundeten Werten.
 */
export function evaluatePosition({ branch, position, now }: { branch: SiteShape; position: Position; now: Date }): PositionResult {
  const ageS = (now.getTime() - position.timestamp) / 1000;
  const base = { accuracyM: Math.round(position.accuracy), positionAgeS: Math.max(0, Math.round(ageS)) };
  if (branch.latitude === null || branch.longitude === null) return { ok: false, failure: "NO_COORDINATES", distanceM: null, ...base };
  const distance = distanceM(position, { latitude: branch.latitude, longitude: branch.longitude });
  const result = { ...base, distanceM: Math.round(distance) };
  if (position.accuracy > MAX_ACCURACY_M) return { ok: false, failure: "INACCURATE", ...result };
  if (ageS > MAX_POSITION_AGE_S || ageS < -MAX_CLOCK_AHEAD_S) return { ok: false, failure: "STALE", ...result };
  if (distance > (branch.checkinRadiusM || DEFAULT_RADIUS_M)) return { ok: false, failure: "OUTSIDE", ...result };
  return { ok: true, failure: null, ...result };
}

/** Berliner Ortszeit als Minuten "wie UTC" (gleiche Skala wie shiftRange). */
export function localMinutes(now: Date): number {
  return Date.parse(berlinDate(now) + "T00:00:00Z") / 60000 + minuteOfDay(berlinTime(now));
}

/**
 * Echter Zeitpunkt (UTC-Minuten) einer Berliner Wanduhrzeit. Berlin liegt
 * 60 (Winter) oder 120 (Sommer) Minuten vor UTC.
 * Zeitumstellung: In der Nacht der Rueckstellung (letzter Sonntag im Oktober)
 * gibt es 02:00-02:59 zweimal; eine solche Uhrzeit gilt als ihr erstes
 * Auftreten (Sommerzeit). In der Nacht der Vorstellung (letzter Sonntag im
 * Maerz) gibt es 02:00-02:59 nicht; eine solche Uhrzeit wird wie Winterzeit
 * gerechnet (entspricht 03:xx Sommerzeit).
 */
function wallToUtcMinutes(wall: number): number {
  for (const offset of [120, 60]) {
    const utc = wall - offset;
    if (localMinutes(new Date(utc * 60000)) === wall) return utc;
  }
  return wall - 60;
}

export type CheckinWindow = { open: boolean; state: "BEFORE" | "OPEN" | "AFTER"; lateMinutes: number; opensAt: string; date: string };

/**
 * Check-in-Fenster einer Schicht und Verspaetung zum Zeitpunkt now.
 * Das Fenster folgt der Berliner Wanduhr (Schichtzeiten sind Wanduhrzeiten;
 * eine Nachtschicht 22:00-06:00 endet um 06:00 Ortszeit, auch in der Nacht
 * der Zeitumstellung). In der wiederholten Stunde der Rueckstellung sind
 * Wanduhrminuten mehrdeutig: 02:30 (Sommerzeit) und 02:30 (Winterzeit)
 * zaehlen fuer das Fenster gleich. Die Verspaetung zaehlt dagegen echte
 * Minuten ab dem Schichtbeginn, damit eine Zeitumstellung sie nicht um eine
 * Stunde verfaelscht.
 */
export function checkinWindow(shift: ShiftShape, now: Date): CheckinWindow {
  const range = shiftRange(shift);
  const current = localMinutes(now);
  const lateMinutes = Math.floor(now.getTime() / 60000) - wallToUtcMinutes(range.start);
  const state = current < range.start - WINDOW_BEFORE_MIN ? "BEFORE" : current < range.end ? "OPEN" : "AFTER";
  const opens = (((minuteOfDay(shift.shiftFrom) - WINDOW_BEFORE_MIN) % 1440) + 1440) % 1440;
  return { open: state === "OPEN", state, lateMinutes, opensAt: String(Math.floor(opens / 60)).padStart(2, "0") + ":" + String(opens % 60).padStart(2, "0"), date: range.date };
}

// --- Datenbank ---------------------------------------------------------------

/**
 * Eigene Buchungen in veroeffentlichten, nicht geloeschten Plaenen mit
 * Standort, rund um heute (Vortag bis Folgetag, damit Nachtschichten dabei
 * sind), mit Fenster zum Zeitpunkt now.
 */
export async function bookedShifts(tx: Tx, orgId: string, userId: string, now: Date) {
  const today = berlinDate(now);
  const weeks = [addDate(today, -1), today, addDate(today, 1)].map(isoWeek);
  const bookings = await tx.booking.findMany({
    where: { userId, shift: { deletedAt: null, schedule: { organizationId: orgId, deletedAt: null, isPublic: true, branchId: { not: null }, OR: weeks.map((w) => ({ year: w.year, weekNumber: w.weekNumber })) } } },
    include: { shift: { include: { schedule: { include: { branch: true } } } } },
  });
  return bookings
    .map((b) => ({ shift: b.shift, branch: b.shift.schedule.branch!, window: checkinWindow(b.shift, now) }))
    .sort((a, b) => shiftRange(a.shift).start - shiftRange(b.shift).start);
}

/**
 * Sperre fuer den Start der Stoppuhr: Laeuft das Fenster einer Schicht an
 * einem Standort mit Check-in-Pflicht, braucht es dafuer einen gueltigen
 * Check-in. Rueckgabe: Meldung oder null.
 */
export async function watchStartBlock(tx: Tx, orgId: string, userId: string, now: Date): Promise<string | null> {
  const due = (await bookedShifts(tx, orgId, userId, now)).filter((s) => s.branch.gpsCheckinRequired && s.window.open);
  if (!due.length) return null;
  const checkins = await tx.checkin.findMany({ where: { userId, shiftId: { in: due.map((s) => s.shift.id) } }, select: { shiftId: true, status: true } });
  for (const s of due) {
    const status = checkins.find((c) => c.shiftId === s.shift.id)?.status;
    if (status && CHECKED_IN.includes(status)) continue;
    return status === "PENDING"
      ? "Deine manuelle Freigabe für den Check-in steht noch aus. Die Zeiterfassung startet mit der Freigabe."
      : "Für diese Schicht ist ein Check-in am Einsatzort nötig. Bitte checke auf der Startseite ein.";
  }
  return null;
}

/** Daten einer laufenden Stoppuhr ab einem Serverzeitpunkt. */
export function watchRecord(orgId: string, userId: string, branchId: string, at: Date) {
  return { organizationId: orgId, userId, type: "WATCH" as const, date: new Date(berlinDate(at)), timeFrom: berlinTime(at), startedAt: at, branchId };
}

/** Verstaendliche Meldung zu einem Fehlschlag der Positionspruefung. */
export function failureMessage(result: PositionResult, radiusM: number): string {
  switch (result.failure) {
    case "NO_COORDINATES": return "Für diesen Einsatzort ist keine Position hinterlegt. Ein GPS-Check-in ist hier nicht möglich.";
    case "INACCURATE": return `Dein Standort ist zu ungenau (± ${result.accuracyM} m, nötig sind höchstens ${MAX_ACCURACY_M} m). Geh möglichst ins Freie, schalte die genaue Ortung ein und versuche es erneut.`;
    case "STALE": return "Die Standortangabe ist veraltet oder die Uhr deines Geräts geht falsch. Bitte versuche es erneut.";
    case "OUTSIDE": return `Du bist etwa ${result.distanceM} m vom Einsatzort entfernt, erlaubt sind ${radiusM} m. Der Check-in ist nur am Einsatzort möglich.`;
    default: return "Der Check-in war nicht möglich.";
  }
}
