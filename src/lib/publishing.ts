/**
 * Veroeffentlichen mit Aenderungsliste und Bearbeitungsmodus (Smartplan A70, A72).
 *
 * Je Plan wird der Stand gespeichert, den Mitarbeitende zuletzt gesehen haben
 * (ScheduleSnapshot): beim Veroeffentlichen, beim Zurueckziehen und zu Beginn
 * der Bearbeitung. Die Aenderungsliste vergleicht den aktuellen Plan damit.
 * Waehrend der Bearbeitung sehen Personen ohne Planungsrecht weiter diesen
 * Stand; Anfragen und Tausch sind gesperrt, Aenderungen loesen keine
 * Einzelnachrichten aus. Erst das erneute Veroeffentlichen uebernimmt sie und
 * benachrichtigt auf Wunsch die Betroffenen.
 */
import type { Prisma, Schedule } from "@prisma/client";
import { ApiError } from "./errors";
import { addDate, berlinDate, weekDate } from "./berlin";
import { assertCan, branchHolders, type Access } from "./access";
import { branchView, ineffectiveBookings, notify, publicUser, shiftInclude, type ShiftWithRelations } from "./planning";
import { violationsForWeek } from "./planning-rules-service";

type Tx = Prisma.TransactionClient;

export type SnapshotShift = {
  id: string; dayOfWeek: number; shiftFrom: string; shiftTo: string; maxEmployees: number; pauseOption: string; pauseValue: number;
  title: string | null; description: string | null; requiredQualifications: string[]; divisionId: string | null; createdAt: string;
  division: { id: string; title: string; color: string } | null;
  bookings: { id: string; userId: string; bookedAt: string; bookedBy: string | null; confirmedAt: string | null; user: { id: string; firstName: string; lastName: string; profileImage: string | null } }[];
};

/** Aktueller Stand eines Plans in der Form des gespeicherten Stands. */
export async function liveState(tx: Tx, scheduleId: string): Promise<SnapshotShift[]> {
  const shifts = await tx.shift.findMany({
    where: { scheduleId, deletedAt: null },
    include: { division: { select: { id: true, title: true, color: true } }, bookings: { include: { user: { select: publicUser } }, orderBy: { bookedAt: "asc" } } },
    orderBy: [{ dayOfWeek: "asc" }, { shiftFrom: "asc" }],
  });
  return shifts.map((s) => ({
    id: s.id, dayOfWeek: s.dayOfWeek, shiftFrom: s.shiftFrom, shiftTo: s.shiftTo, maxEmployees: s.maxEmployees, pauseOption: s.pauseOption, pauseValue: s.pauseValue,
    title: s.title, description: s.description, requiredQualifications: s.requiredQualifications, divisionId: s.divisionId, createdAt: s.createdAt.toISOString(), division: s.division,
    bookings: s.bookings.map((b) => ({ id: b.id, userId: b.userId, bookedAt: b.bookedAt.toISOString(), bookedBy: b.bookedBy, confirmedAt: b.confirmedAt?.toISOString() ?? null, user: b.user })),
  }));
}

export function readSnapshot(value: unknown): SnapshotShift[] {
  return Array.isArray(value) ? (value as SnapshotShift[]) : [];
}

async function saveSnapshot(tx: Tx, scheduleId: string, shifts: SnapshotShift[]) {
  const data = shifts as unknown as Prisma.InputJsonArray;
  await tx.scheduleSnapshot.upsert({ where: { scheduleId }, create: { scheduleId, shifts: data }, update: { shifts: data, takenAt: new Date() } });
}

/** Gespeicherten Stand als Schichten mit Plan und Standort - fuer dieselben Ausgaben wie der Live-Plan. */
function frozenShifts(schedule: ShiftWithRelations["schedule"], shifts: SnapshotShift[]): ShiftWithRelations[] {
  return shifts.map((s) => ({
    ...s, scheduleId: schedule.id, deletedAt: null, createdAt: new Date(s.createdAt), schedule,
    bookings: s.bookings.map((b) => ({ ...b, shiftId: s.id, bookedAt: new Date(b.bookedAt), confirmedAt: b.confirmedAt ? new Date(b.confirmedAt) : null })),
  })) as unknown as ShiftWithRelations[];
}

/**
 * Fuer Personen ohne Planungsrecht: Schichten bearbeiteter Plaene durch den
 * zuletzt veroeffentlichten Stand ersetzen. "schedules" grenzt die Plaene ein
 * wie die Abfrage des Aufrufers, "include" filtert die Schichten wie dort.
 */
export async function publishedView(tx: Tx, live: ShiftWithRelations[], options: { keepLive: (branchId: string | null) => boolean; schedules: Prisma.ScheduleWhereInput; include?: (shift: ShiftWithRelations) => boolean }) {
  const kept = live.filter((s) => !s.schedule.editing || options.keepLive(s.schedule.branchId));
  const editing = await tx.schedule.findMany({ where: { AND: [options.schedules, { editing: true, deletedAt: null }] }, include: { branch: { select: branchView }, snapshot: true } });
  const frozen = editing.filter((s) => !options.keepLive(s.branchId)).flatMap(({ snapshot, ...schedule }) => frozenShifts(schedule, readSnapshot(snapshot?.shifts)));
  return [...kept, ...frozen.filter((s) => options.include?.(s) ?? true)];
}

// --- Aenderungsliste ---------------------------------------------------------------------

type Person = { userId: string; name: string };
export type ChangeShift = { id: string; date: string; from: string; to: string; title: string | null; division: string | null; maxEmployees: number; people: Person[] };
export type Changes = {
  added: ChangeShift[]; removed: ChangeShift[];
  changed: { before: ChangeShift; after: ChangeShift; fields: string[]; joined: Person[]; left: Person[] }[];
};

function changeShift(week: { year: number; weekNumber: number }, s: SnapshotShift): ChangeShift {
  return { id: s.id, date: weekDate(week.year, week.weekNumber, s.dayOfWeek), from: s.shiftFrom, to: s.shiftTo, title: s.title, division: s.division?.title ?? null, maxEmployees: s.maxEmployees, people: s.bookings.map((b) => ({ userId: b.userId, name: b.user.firstName + " " + b.user.lastName })) };
}

/** Unterschiede zwischen dem zuletzt gesehenen Stand (null: noch nie veroeffentlicht) und jetzt. */
export function scheduleChanges(week: { year: number; weekNumber: number }, before: SnapshotShift[] | null, after: SnapshotShift[]): Changes {
  const old = new Map((before ?? []).map((s) => [s.id, s]));
  const now = new Map(after.map((s) => [s.id, s]));
  const changes: Changes = { added: [], removed: [], changed: [] };
  for (const s of after) if (!old.has(s.id)) changes.added.push(changeShift(week, s));
  for (const s of before ?? []) if (!now.has(s.id)) changes.removed.push(changeShift(week, s));
  for (const s of after) {
    const o = old.get(s.id);
    if (!o) continue;
    const fields = [
      ...(o.dayOfWeek !== s.dayOfWeek || o.shiftFrom !== s.shiftFrom || o.shiftTo !== s.shiftTo ? ["Zeit"] : []),
      ...(o.divisionId !== s.divisionId ? ["Arbeitsbereich"] : []),
      ...(o.title !== s.title ? ["Titel"] : []),
      ...(o.maxEmployees !== s.maxEmployees ? ["Plätze"] : []),
      ...(o.pauseOption !== s.pauseOption || o.pauseValue !== s.pauseValue ? ["Pause"] : []),
      ...((o.description ?? "") !== (s.description ?? "") ? ["Beschreibung"] : []),
      ...([...o.requiredQualifications].sort().join() !== [...s.requiredQualifications].sort().join() ? ["Qualifikationen"] : []),
    ];
    const was = new Set(o.bookings.map((b) => b.userId)), is = new Set(s.bookings.map((b) => b.userId));
    const after_ = changeShift(week, s), before_ = changeShift(week, o);
    const joined = after_.people.filter((p) => !was.has(p.userId)), left = before_.people.filter((p) => !is.has(p.userId));
    if (fields.length || joined.length || left.length) changes.changed.push({ before: before_, after: after_, fields, joined, left });
  }
  const order = (x: ChangeShift, y: ChangeShift) => x.date.localeCompare(y.date) || x.from.localeCompare(y.from);
  changes.added.sort(order); changes.removed.sort(order); changes.changed.sort((x, y) => order(x.after, y.after));
  return changes;
}

const label = (s: ChangeShift) => s.date.slice(8, 10) + "." + s.date.slice(5, 7) + ". " + s.from + "–" + s.to + (s.title ? " (" + s.title + ")" : "");

/** Je betroffener Person die Zeilen fuer die Benachrichtigung. */
export function affectedPeople(changes: Changes): Map<string, string[]> {
  const lines = new Map<string, string[]>();
  const add = (userId: string, line: string) => lines.set(userId, [...(lines.get(userId) ?? []), line]);
  for (const s of changes.added) for (const p of s.people) add(p.userId, "Neu: " + label(s));
  for (const s of changes.removed) for (const p of s.people) add(p.userId, "Entfällt: " + label(s));
  for (const c of changes.changed) {
    for (const p of c.joined) add(p.userId, "Neu: " + label(c.after));
    for (const p of c.left) add(p.userId, "Entfällt für dich: " + label(c.before));
    if (c.fields.length) for (const p of c.after.people) if (!c.joined.some((j) => j.userId === p.userId)) add(p.userId, "Geändert (" + c.fields.join(", ") + "): " + label(c.before) + (c.fields.includes("Zeit") ? " → " + label(c.after) : ""));
  }
  return lines;
}

// --- Vorschau, Veroeffentlichen, Zurueckziehen, Bearbeiten ---------------------------------------

async function loadSchedule(tx: Tx, a: Access, id: string) {
  const schedule = await tx.schedule.findFirst({ where: { id, organizationId: a.orgId, deletedAt: null }, include: { branch: { select: { name: true } }, snapshot: true } });
  if (!schedule) throw new ApiError("Schichtplan nicht gefunden.", 404);
  assertCan(a, "PUBLISH_SCHEDULE", schedule.branchId);
  return schedule;
}

const weekLabel = (s: Pick<Schedule, "weekNumber" | "year">) => "KW " + s.weekNumber + "/" + s.year;

/** Was das Veroeffentlichen aendert, dazu Hinweise und Regelverstoesse. Recht "Dienstplan veroeffentlichen". */
export async function publishPreview(tx: Tx, a: Access, id: string) {
  const schedule = await loadSchedule(tx, a, id);
  const live = await liveState(tx, id);
  const before = schedule.snapshot ? readSnapshot(schedule.snapshot.shifts) : null;
  const changes = scheduleChanges(schedule, before, live);
  const shifts = await tx.shift.findMany({ where: { scheduleId: id, deletedAt: null }, include: shiftInclude });
  const ineffective = await ineffectiveBookings(tx, a.orgId, shifts);
  const absent = shifts.flatMap((s) => s.bookings.filter((b) => ineffective.has(b.id)).map((b) => ({ shiftId: s.id, name: b.user.firstName + " " + b.user.lastName, date: weekDate(schedule.year, schedule.weekNumber, s.dayOfWeek) })));
  const openSlots = shifts.reduce((sum, s) => sum + Math.max(0, s.maxEmployees - s.bookings.filter((b) => !ineffective.has(b.id)).length), 0);
  const userIds = [...new Set(live.flatMap((s) => s.bookings.map((b) => b.userId)))];
  const violations = await violationsForWeek(tx, a.orgId, schedule, userIds, new Set(live.map((s) => s.id)));
  const from = weekDate(schedule.year, schedule.weekNumber);
  return {
    schedule: { id, weekNumber: schedule.weekNumber, year: schedule.year, from, to: addDate(from, 6), branchName: schedule.branch?.name ?? null, isPublic: schedule.isPublic, editing: schedule.editing },
    first: !before, changes, hints: { absent, openSlots }, violations,
  };
}

/**
 * Veroeffentlichen (erstmals, nach dem Zurueckziehen oder aus der Bearbeitung).
 * Benachrichtigung: erstmals bzw. nach dem Zurueckziehen alle, die den Plan
 * sehen oder Schichten anfragen duerfen, plus Eingeteilte; aus der Bearbeitung
 * nur die Betroffenen mit ihren Aenderungen (neue offene Plaetze an alle mit
 * Anfragerecht).
 */
export async function publishSchedule(tx: Tx, a: Access, id: string, options: { notify: boolean }) {
  const schedule = await loadSchedule(tx, a, id);
  const live = await liveState(tx, id);
  const booked = [...new Set(live.flatMap((s) => s.bookings.map((b) => b.userId)))];
  if (schedule.isPublic && !schedule.editing) return { schedule, booked, notified: 0 };
  const before = schedule.snapshot ? readSnapshot(schedule.snapshot.shifts) : null;
  const changes = scheduleChanges(schedule, before, live);
  const updated = await tx.schedule.update({ where: { id }, data: { isPublic: true, editing: false, publishedAt: new Date() } });
  await saveSnapshot(tx, id, live);
  const where = schedule.branch ? schedule.branch.name + ", " : "";
  let notified: string[] = [];
  if (options.notify && schedule.isPublic) {
    for (const [userId, lines] of affectedPeople(changes)) notified.push(...await notify(tx, a.orgId, a.userId, [userId], "Dienstplan geändert", where + weekLabel(schedule) + ":\n" + lines.join("\n")));
    const freshSlots = changes.added.some((s) => s.people.length < s.maxEmployees) || changes.changed.some((c) => c.after.maxEmployees > c.before.maxEmployees);
    if (freshSlots) notified.push(...await notify(tx, a.orgId, a.userId, await branchHolders(tx, a.orgId, schedule.branchId, ["REQUEST_SHIFTS"], false), "Neue offene Schichten", where + "Im Dienstplan " + weekLabel(schedule) + " gibt es neue offene Schichten."));
  } else if (options.notify) {
    const audience = [...await branchHolders(tx, a.orgId, schedule.branchId, ["VIEW_SCHEDULE", "REQUEST_SHIFTS"], false), ...booked];
    notified = await notify(tx, a.orgId, a.userId, audience, "Dienstplan veröffentlicht", where + weekLabel(schedule) + " ist jetzt verfügbar.");
  }
  return { schedule: updated, booked, notified: new Set(notified).size };
}

/** Zurueckziehen: Mitarbeitende sehen den Plan nicht mehr; der zuletzt gesehene Stand bleibt fuer die Aenderungsliste. */
export async function withdrawSchedule(tx: Tx, a: Access, id: string) {
  const schedule = await loadSchedule(tx, a, id);
  const live = await liveState(tx, id);
  const booked = [...new Set(live.flatMap((s) => s.bookings.map((b) => b.userId)))];
  if (!schedule.isPublic) return { schedule, booked };
  if (!schedule.editing) await saveSnapshot(tx, id, live);
  const updated = await tx.schedule.update({ where: { id }, data: { isPublic: false, editing: false } });
  const audience = [...await branchHolders(tx, a.orgId, schedule.branchId, ["VIEW_SCHEDULE", "REQUEST_SHIFTS"], false), ...booked];
  await notify(tx, a.orgId, a.userId, audience, "Dienstplan zurückgezogen", (schedule.branch ? schedule.branch.name + ", " : "") + weekLabel(schedule) + " wird überarbeitet.");
  return { schedule: updated, booked };
}

/**
 * Bearbeitungsmodus fuer einen veroeffentlichten Plan einer Woche, die noch
 * nicht begonnen hat. Mitarbeitende sehen bis zum erneuten Veroeffentlichen
 * den jetzigen Stand; laufende Wochen werden direkt geaendert.
 */
export async function startEditing(tx: Tx, a: Access, id: string) {
  const schedule = await loadSchedule(tx, a, id);
  if (!schedule.isPublic) throw new ApiError("Der Plan ist nicht veröffentlicht – Entwürfe sind ohnehin nur für die Planung sichtbar.", 409);
  if (schedule.editing) return { schedule };
  if (weekDate(schedule.year, schedule.weekNumber) <= berlinDate()) throw new ApiError("Den Bearbeitungsmodus gibt es nur für Wochen, die noch nicht begonnen haben. Laufende Wochen bitte direkt ändern – Betroffene werden einzeln benachrichtigt.", 409);
  await saveSnapshot(tx, id, await liveState(tx, id));
  return { schedule: await tx.schedule.update({ where: { id }, data: { editing: true } }) };
}

/** Fehler fuer Anfragen, Tausch und Bestaetigen waehrend der Bearbeitung. */
export function assertNotEditing(schedule: { editing: boolean }) {
  if (schedule.editing) throw new ApiError("Der Plan wird gerade überarbeitet. Anfragen, Tausch und Bestätigungen sind nach dem erneuten Veröffentlichen wieder möglich.", 409);
}
