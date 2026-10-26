/**
 * Kunden und Einsatzorte archivieren: aus Planung, Listen und Auswahlfeldern
 * ausblenden. Vergangene und laufende Schichten, Zeiten, Meldungen und
 * Check-ins bleiben unveraendert am Einsatzort; Standortrechte wirken dort
 * nur noch fuer die Historie (ARCHIVE_RIGHTS in access.ts). Kuenftige
 * Schichten sagt das Archivieren ab, noch nicht vergangene Wochen in
 * Bearbeitung verwirft es - beides erst nach Bestaetigung (archiveBranches,
 * requireConfirmation). Endgueltig loeschen bleibt Einsatzorten ohne
 * Historie vorbehalten.
 */
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { addDate, berlinDate, isoWeek, shiftRange, weekDate } from "./berlin";
import { ApiError } from "./errors";
import type { Access } from "./access";
import { emitToBranch, emitToUsers } from "./emit";
import { shiftDays, signalBookedSites } from "./conflicts";
import { notify, personIds, shiftInclude, shiftLabel, type ShiftWithRelations } from "./planning";
import { discardEdits } from "./schedule-editing";
import { isEditing, notifiesEmployees } from "./schedule-status";
import { openRequestsOf, shiftDeletion } from "./shift-delete";
import { closeOpenRequests, isFuture } from "./shift-requests";

type Tx = Prisma.TransactionClient;
type Site = { id: string; name: string };

export const CUSTOMER_ARCHIVED = "Der Kunde ist archiviert. Bitte zuerst den Kunden wiederherstellen.";

/** Optionaler Body { confirm?: boolean } von POST .../archive; ohne Body: nicht bestaetigt. */
export async function archiveConfirmed(request: Request): Promise<boolean> {
  const input = await request.json().catch(() => null);
  return z.object({ confirm: z.boolean().optional() }).nullable().parse(input)?.confirm === true;
}

/** Folgen des Archivierens je Einsatzort, gezaehlt beim Ausfuehren. */
export type ArchiveEffects = {
  /** Abgesagte kuenftige (noch nicht begonnene) Schichten. */
  cancelled: number;
  /** Eingeteilte Personen mit Konto in diesen Schichten, jeder Planstand. */
  persons: string[];
  /** Davon benachrichtigt: Eingeteilte veroeffentlichter Plaene (ohne die handelnde Person). */
  informed: string[];
  requestsClosed: number;
  /** Kuenftige Schichten mit Check-in oder erfassten Zeiten: bleiben als Nachweis (wie beim Einzelloeschen). */
  kept: number;
  /** Verworfene Wochen in Bearbeitung, etwa "KW 45/2026". */
  weeks: string[];
};

export type ArchiveResult = {
  effects: Map<string, ArchiveEffects>;
  cancelled: ShiftWithRelations[];
  notified: string[];
  requestsClosed: number;
  branchesArchived: number;
  archivedAt: Date;
  /** Standorte fuer das Echtzeit-Signal (archivierte und solche zurueckgeholter Schichten) mit Betroffenen. */
  signals: Map<string | null, Set<string>>;
};

const unique = <T,>(list: T[]) => [...new Set(list)];
const count = (n: number, one: string, many: string) => n + " " + (n === 1 ? one : many);
const lines = (shifts: ShiftWithRelations[]) => shifts.map((s) => "\n– " + shiftLabel(s)).join("");

/**
 * Einsatzorte archivieren, in der Transaktion des Aufrufers:
 * 1. Noch nicht vergangene Wochen in Bearbeitung verwerfen (discardEdits):
 *    Danach gilt der veroeffentlichte Stand, den die Mitarbeitenden kennen.
 * 2. Noch nicht begonnene Schichten absagen wie DELETE /api/shifts/[id]:
 *    gleiche Loeschregel (shiftDeletion - mit Check-in oder Zeiten bleibt die
 *    Schicht), offene Antraege schliessen ("Schicht wurde abgesagt."),
 *    Zuweisungen loeschen, deletedAt setzen. Laufende und vergangene
 *    Schichten bleiben unberuehrt.
 * 3. Mitteilungen gebuendelt: je Person genau ein Postfach-Eintrag mit allen
 *    ihren abgesagten Schichten ("Schicht(en) abgesagt", nur veroeffentlichte
 *    Plaene) bzw. ihren hinfaelligen Antraegen ("Antrag hinfällig").
 * 4. archivedAt setzen.
 * Ohne Bestaetigung wirft der Aufrufer danach requireConfirmation: Die
 * Transaktion rollt alles zurueck, die Warnungen nennen genau diese Zahlen.
 */
export async function archiveBranches(tx: Tx, a: Access, branches: Site[], reason: string): Promise<ArchiveResult> {
  const ids = branches.map((b) => b.id), today = berlinDate(), now = new Date();
  const effects = new Map<string, ArchiveEffects>(ids.map((id) => [id, { cancelled: 0, persons: [], informed: [], requestsClosed: 0, kept: 0, weeks: [] }]));
  const signals = new Map<string | null, Set<string>>(ids.map((id) => [id, new Set<string>()]));
  const signal = (branchId: string | null, users: string[]) => signals.set(branchId, new Set([...(signals.get(branchId) ?? []), ...users]));
  const plans = { organizationId: a.orgId, deletedAt: null, branchId: { in: ids } };

  const editing = await tx.schedule.findMany({ where: { ...plans, editingSince: { not: null }, year: { gte: Number(today.slice(0, 4)) - 1 } }, orderBy: [{ year: "asc" }, { weekNumber: "asc" }] });
  for (const schedule of editing) {
    // Woche vorbei (Sonntag vor gestern): bleibt wie bisher unberuehrt.
    if (weekDate(schedule.year, schedule.weekNumber, 7) < addDate(today, -1)) continue;
    const discarded = await discardEdits(tx, a, schedule);
    effects.get(schedule.branchId!)!.weeks.push("KW " + schedule.weekNumber + "/" + schedule.year);
    discarded.branches.forEach((branchId, i) => signal(branchId, i === 0 ? discarded.affected : []));
  }

  // Kuenftige Schichten liegen fruehestens in der laufenden Kalenderwoche.
  const week = isoWeek(today);
  const rows = await tx.shift.findMany({
    where: { deletedAt: null, schedule: { ...plans, OR: [{ year: { gt: week.year } }, { year: week.year, weekNumber: { gte: week.weekNumber } }] } },
    include: shiftInclude,
  });
  const cancelled: ShiftWithRelations[] = [];
  for (const shift of rows.filter((s) => isFuture(s, now)).sort((x, y) => shiftRange(x).start - shiftRange(y).start)) {
    if ((await shiftDeletion(tx, a.orgId, shift)).deletable) cancelled.push(shift);
    else effects.get(shift.schedule.branchId!)!.kept++;
  }
  // Wie beim Einzelloeschen: waehrend einer Bearbeitung ruhen Antraege (hier nach dem Verwerfen nur noch theoretisch).
  const closable = cancelled.filter((s) => !isEditing(s.schedule)).map((s) => openRequestsOf(s.id));
  const closed = closable.length ? await closeOpenRequests(tx, a, { OR: closable }, "Schicht wurde abgesagt.") : [];
  const shiftIds = cancelled.map((s) => s.id);
  // Alle Zuweisungen, auch Subunternehmer-Platzhalter ohne Konto.
  await tx.booking.deleteMany({ where: { shiftId: { in: shiftIds } } });
  await tx.shift.updateMany({ where: { id: { in: shiftIds } }, data: { deletedAt: now } });

  const people = new Map<string, { own: ShiftWithRelations[]; asked: ShiftWithRelations[] }>();
  const person = (id: string) => people.get(id) ?? people.set(id, { own: [], asked: [] }).get(id)!;
  for (const shift of cancelled) {
    const e = effects.get(shift.schedule.branchId!)!, booked = personIds(shift.bookings);
    e.cancelled++;
    e.persons = unique([...e.persons, ...booked]);
    signal(shift.schedule.branchId, booked);
    if (!notifiesEmployees(shift.schedule)) continue;
    e.informed = unique([...e.informed, ...booked.filter((id) => id !== a.userId)]);
    for (const id of booked) person(id).own.push(shift);
  }
  for (const r of closed) {
    const shifts = cancelled.filter((s) => s.id === r.shiftId || s.id === r.targetShiftId);
    effects.get(shifts[0].schedule.branchId!)!.requestsClosed++;
    for (const id of [r.userId, r.targetUserId]) if (id) for (const s of shifts) if (!person(id).asked.includes(s)) person(id).asked.push(s);
  }
  const notified: string[] = [];
  for (const [userId, { own, asked }] of people) {
    // Antraege zu eigenen abgesagten Schichten nennt die Absage mit; nur weitere Schichten werden einzeln aufgefuehrt.
    const extra = asked.filter((s) => !own.includes(s)), all = [...own, ...extra];
    const parts = [reason];
    if (own.length) parts.push((own.length === 1 ? "Diese Schicht wurde abgesagt:" : "Diese Schichten wurden abgesagt:") + lines(own) + (asked.length > extra.length ? "\nOffene Anträge dazu sind damit geschlossen." : ""));
    if (extra.length) parts.push((extra.length === 1 ? "Dein Antrag wurde geschlossen, weil diese Schicht abgesagt wurde:" : "Deine Anträge wurden geschlossen, weil diese Schichten abgesagt wurden:") + lines(extra));
    const subject = own.length ? (own.length === 1 ? "Schicht abgesagt" : "Schichten abgesagt") : "Antrag hinfällig";
    notified.push(...await notify(tx, a.orgId, a.userId, [userId], subject, parts.join("\n"), all.length === 1 ? all[0].id : undefined));
  }

  await tx.branch.updateMany({ where: { id: { in: ids } }, data: { archivedAt: now } });
  return { effects, cancelled, notified: unique(notified), requestsClosed: closed.length, branchesArchived: ids.length, archivedAt: now, signals };
}

/** Folgen eines Einsatzorts als kurze Saetze (leer: keine Folgen). */
export function archiveWarnings(e: ArchiveEffects): string[] {
  return [
    ...(e.cancelled ? [count(e.cancelled, "künftige Schicht wird", "künftige Schichten werden") + " abgesagt."] : []),
    ...(e.informed.length ? [count(e.informed.length, "eingeteilte Person wird", "eingeteilte Personen werden") + " benachrichtigt."] : []),
    ...(e.requestsClosed ? [count(e.requestsClosed, "offener Antrag wird", "offene Anträge werden") + " geschlossen."] : []),
    ...(e.kept ? [count(e.kept, "künftige Schicht mit Check-in oder erfassten Zeiten bleibt", "künftige Schichten mit Check-in oder erfassten Zeiten bleiben") + " als Nachweis erhalten."] : []),
    ...(e.weeks.length ? [e.weeks.join(", ") + (e.weeks.length === 1 ? " ist in Bearbeitung und wird verworfen." : " sind in Bearbeitung und werden verworfen.")] : []),
  ];
}

/**
 * Hat das Archivieren Folgen, ohne Bestaetigung 409 { confirm: true,
 * warnings, cancelledShifts } - die Transaktion des Aufrufers rollt damit
 * alles zurueck. named: Warnungen mit dem Namen des Einsatzorts voran (Kunde).
 */
export function requireConfirmation(result: ArchiveResult, branches: Site[], named: boolean) {
  const warnings = branches.flatMap((b) => archiveWarnings(result.effects.get(b.id)!).map((w) => (named ? b.name + ": " : "") + w));
  if (!warnings.length) return;
  const all = [...result.effects.values()], sum = (f: (e: ArchiveEffects) => number) => all.reduce((n, e) => n + f(e), 0);
  const shifts = sum((e) => e.cancelled), persons = unique(all.flatMap((e) => e.persons)).length, weeks = sum((e) => e.weeks.length), kept = sum((e) => e.kept);
  const parts = [
    ...(shifts ? [count(shifts, "künftige Schicht", "künftige Schichten")] : []),
    ...(persons ? [count(persons, "Person", "Personen") + " betroffen"] : []),
    ...(weeks ? [count(weeks, "Woche", "Wochen") + " in Bearbeitung"] : []),
    ...(kept ? [count(kept, "Schicht bleibt", "Schichten bleiben") + " als Nachweis"] : []),
  ];
  throw new ApiError("Archivieren hat Folgen: " + parts.join(", ") + ". Bitte bestätigen.", 409, { confirm: true, warnings, cancelledShifts: shifts });
}

/** Echtzeit nach dem Commit wie bei der Einzelabsage: Standortplaene, Plaene weiterer Schichten der Eingeteilten, Postfaecher. */
export async function signalArchive(orgId: string, result: ArchiveResult) {
  for (const [branchId, users] of result.signals) emitToBranch(orgId, branchId, "schedule:updated", [...users]);
  const booked = unique(result.cancelled.flatMap((s) => personIds(s.bookings)));
  if (booked.length) {
    const days = result.cancelled.map(shiftDays);
    await signalBookedSites(orgId, booked, "schedule:updated", { from: days.map((d) => d.from).sort()[0], to: days.map((d) => d.to).sort().at(-1)! });
  }
  emitToUsers(result.notified, "message:new");
}

/** Antwort von POST .../archive; result null: war schon archiviert. */
export function archiveResponse(result: ArchiveResult | null) {
  return { success: true, cancelledShifts: result?.cancelled.length ?? 0, notified: result?.notified.length ?? 0, requestsClosed: result?.requestsClosed ?? 0, branchesArchived: result?.branchesArchived ?? 0 };
}

/**
 * Einsatzort hat Historie und laesst sich nicht endgueltig loeschen:
 * Schichten (auch geloeschte), Briefings, Live-Sitzungen, Zeitbuchungen,
 * Check-ins oder Standortmeldungen.
 */
export async function branchHasHistory(tx: Tx, branchId: string): Promise<boolean> {
  const counts = await Promise.all([
    tx.shift.count({ where: { schedule: { branchId } } }),
    tx.schedule.count({ where: { branchId, OR: [{ briefings: { some: {} } }, { liveSession: { isNot: null } }] } }),
    tx.timeRecord.count({ where: { branchId } }),
    tx.checkin.count({ where: { branchId } }),
    tx.branchIssue.count({ where: { branchId } }),
  ]);
  return counts.some(Boolean);
}
