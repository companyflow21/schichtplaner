import type { Prisma, Schedule } from "@prisma/client";
import { ApiError } from "./errors";
import { weekDate } from "./berlin";
import { wallToUtcMinutes } from "./checkin";
import { branchHolders, type Access } from "./access";
import { formatName } from "./names";
import { assessAssignment, assessContractorAssignment, notify, personName, shiftInclude, shiftLabel } from "./planning";
import { closeOpenRequests, isFuture, requestParties } from "./shift-requests";
import { shiftDeletion } from "./shift-delete";
import { pauseText } from "./shift-service";
import { scheduleStatus } from "./schedule-status";
import { bookedUsers, RELEVANT, scheduleDiff, shiftChanges, toSnapshotShift, type ScheduleDiff, type Snapshot, type SnapshotShift } from "./schedule-diff";

type Tx = Prisma.TransactionClient;
type PlanInfo = { year: number; weekNumber: number; branch: { name: string } | null };

/** Die Woche hat begonnen (Montag 00:00 Europe/Berlin). */
export function weekStarted(schedule: { year: number; weekNumber: number }, now = new Date()): boolean {
  return wallToUtcMinutes(Date.parse(weekDate(schedule.year, schedule.weekNumber, 1) + "T00:00:00Z") / 60000) <= now.getTime() / 60000;
}

/** Status fuer die Planung, mit Startzeit und Name (Namensformat der Organisation) waehrend der Bearbeitung. */
export async function editingInfo(tx: Tx, a: Access, schedule: Schedule) {
  const by = schedule.editingById ? await tx.user.findUnique({ where: { id: schedule.editingById }, select: { firstName: true, lastName: true } }) : null;
  return { status: scheduleStatus(schedule), editingSince: schedule.editingSince, editingBy: by ? { name: formatName(by, a.member.organization.nameFormat) } : null };
}

/**
 * Bearbeitung eines veroeffentlichten Plans starten (PUBLISHED -> EDITING):
 * Momentaufnahme aller nicht geloeschten Schichten mit allen Feldern und allen
 * Buchungen in derselben Transaktion.
 */
export async function startEditing(tx: Tx, a: Access, schedule: Schedule) {
  const status = scheduleStatus(schedule);
  if (status === "DRAFT") throw new ApiError("Der Plan ist noch nicht veröffentlicht und lässt sich direkt bearbeiten.", 409);
  if (status === "EDITING") throw new ApiError("Der Plan wird bereits bearbeitet.", 409);
  const shifts = await tx.shift.findMany({ where: { scheduleId: schedule.id, deletedAt: null }, include: { bookings: true }, orderBy: [{ dayOfWeek: "asc" }, { shiftFrom: "asc" }, { id: "asc" }] });
  const takenAt = new Date();
  const snapshot: Snapshot = { version: 1, takenAt: takenAt.toISOString(), shifts: shifts.map(toSnapshotShift) };
  await tx.scheduleSnapshot.create({ data: { scheduleId: schedule.id, takenAt, data: snapshot } });
  return tx.schedule.update({ where: { id: schedule.id }, data: { editingSince: takenAt, editingById: a.userId } });
}

async function loadSnapshot(tx: Tx, scheduleId: string): Promise<Snapshot> {
  return (await tx.scheduleSnapshot.findUniqueOrThrow({ where: { scheduleId } })).data as unknown as Snapshot;
}

/**
 * Aenderungen gegenueber dem veroeffentlichten Stand. Entwurf: alle Schichten
 * neu; veroeffentlicht ohne Bearbeitung: keine. In Bearbeitung zaehlen
 * Schichten, die inzwischen in einem anderen Plan liegen, als entfernt.
 */
export async function editDiff(tx: Tx, schedule: Schedule): Promise<ScheduleDiff> {
  const plan = (await tx.shift.findMany({ where: { scheduleId: schedule.id, deletedAt: null }, include: { bookings: true } })).map(toSnapshotShift);
  const status = scheduleStatus(schedule);
  if (status !== "EDITING") return scheduleDiff({ version: 1, takenAt: new Date().toISOString(), shifts: status === "DRAFT" ? [] : plan }, plan);
  const snapshot = await loadSnapshot(tx, schedule.id);
  const moved = await tx.shift.findMany({ where: { id: { in: snapshot.shifts.map(s => s.id) }, scheduleId: { not: schedule.id }, deletedAt: null, schedule: { deletedAt: null } }, include: { bookings: true } });
  return scheduleDiff(snapshot, [...plan, ...moved.map(toSnapshotShift)]);
}

/** Alle Schichten eines Diffs (auch die neue Lage verschobener). */
export function diffShifts(diff: ScheduleDiff): SnapshotShift[] {
  return [...diff.added, ...diff.removed, ...diff.removed.flatMap(r => r.movedTo ? [r.movedTo] : []), ...diff.changed.flatMap(c => [c.before, c.after])];
}

/** Woche und Standort der Plaene, in denen die Schichten liegen (fuer Datum und Anzeige). */
export async function diffPlans(tx: Tx, shifts: SnapshotShift[]): Promise<Map<string, PlanInfo>> {
  const ids = [...new Set(shifts.map(s => s.scheduleId))];
  const plans = await tx.schedule.findMany({ where: { id: { in: ids } }, select: { id: true, year: true, weekNumber: true, branch: { select: { name: true } } } });
  return new Map(plans.map(p => [p.id, p]));
}

/** Abschnitte Neu / Geändert / Entfällt mit den eigenen Schichten einer Person. */
function personalChanges(diff: ScheduleDiff, userId: string, label: (s: SnapshotShift) => string): string {
  const added: string[] = [], changed: string[] = [], removed: string[] = [];
  const on = (s: SnapshotShift) => bookedUsers(s).includes(userId);
  const change = (before: SnapshotShift, after: SnapshotShift) => {
    const changes = shiftChanges(before, after);
    const parts = [label(after)];
    if (label(before) !== label(after)) parts.push("vorher " + label(before));
    if (changes.includes("Pause")) parts.push("Pause jetzt: " + pauseText(after));
    if (changes.includes("Titel")) parts.push("Tätigkeit jetzt: " + (after.title || "keine Angabe"));
    return parts.join("; ");
  };
  for (const s of diff.added) if (on(s)) added.push(label(s));
  for (const c of diff.changed) {
    if (on(c.after) && !on(c.before)) added.push(label(c.after));
    else if (on(c.before) && !on(c.after)) removed.push(label(c.before));
    else if (on(c.after) && c.changes.some(x => RELEVANT.includes(x))) changed.push(change(c.before, c.after));
  }
  // An einen anderen Standort verlegt und weiterhin eingeteilt: fuer die Person eine Aenderung.
  for (const r of diff.removed) {
    if (!on(r)) continue;
    if (r.movedTo && on(r.movedTo)) changed.push(change(r, r.movedTo));
    else removed.push(label(r));
  }
  const sections: [string, string[]][] = [["Neu", added], ["Geändert", changed], ["Entfällt", removed]];
  return sections.filter(([, lines]) => lines.length).map(([title, lines]) => title + ":\n" + lines.map(l => "– " + l).join("\n")).join("\n");
}

/**
 * Bearbeitung veroeffentlichen (EDITING -> PUBLISHED). Mit send: je
 * betroffener Person genau eine Sammelmitteilung mit den eigenen Schichten
 * (Neu / Geändert / Entfällt); haben neue oder geaenderte Schichten offene
 * Plaetze, erhalten Personen mit "Offene Schichten sehen und anfragen" den
 * Hinweis darin oder - ohne eigene Aenderung - "Neue offene Schichten".
 * Ohne send entsteht dafuer keine Postfachzeile. Unabhaengig davon werden
 * offene Antraege zu entfallenen Schichten geschlossen und die Beteiligten
 * informiert ("Antrag hinfällig"): Das ist eine Entscheidung ueber den Antrag.
 * Verschobene Schichten bestehen weiter; ihre Antraege bleiben offen.
 */
export async function publishEdits(tx: Tx, a: Access, schedule: Schedule & { branch: { name: string } | null }, send: boolean) {
  const diff = await editDiff(tx, schedule);
  const plans = await diffPlans(tx, diffShifts(diff));
  const label = (s: SnapshotShift) => shiftLabel({ ...s, schedule: plans.get(s.scheduleId)! });
  const week = "KW " + schedule.weekNumber + "/" + schedule.year;
  const site = schedule.branch ? schedule.branch.name + ", " : "";
  const notified: string[] = [];
  if (send) {
    // Nur Personen, die noch zur Organisation gehoeren (geloeschte bleiben in der Momentaufnahme).
    const members = new Set((await tx.organizationMember.findMany({ where: { organizationId: a.orgId, userId: { in: diff.affectedUserIds } }, select: { userId: true } })).map(m => m.userId));
    const affected = diff.affectedUserIds.filter(id => members.has(id));
    const holders = diff.openPlacesAdded ? await branchHolders(tx, a.orgId, schedule.branchId, ["REQUEST_SHIFTS"], false) : [];
    for (const userId of affected) {
      const hint = holders.includes(userId) ? "\nAußerdem gibt es neue offene Schichten zum Anfragen." : "";
      notified.push(...await notify(tx, a.orgId, a.userId, [userId], "Dienstplan " + week + " aktualisiert", site + week + ": Änderungen an deinen Schichten.\n" + personalChanges(diff, userId, label) + hint));
    }
    const others = holders.filter(id => !affected.includes(id));
    notified.push(...await notify(tx, a.orgId, a.userId, others, "Neue offene Schichten", site + "Im veröffentlichten Dienstplan " + week + " gibt es neue oder geänderte offene Schichten."));
  }
  const gone = diff.removed.filter(r => !r.movedTo);
  const closed = gone.length ? await closeOpenRequests(tx, a, { OR: gone.flatMap(r => [{ shiftId: r.id }, { targetShiftId: r.id }]) }, "Schicht wurde abgesagt.") : [];
  // Wer in der entfallenen Schicht eingeteilt war, weiss es mit send schon aus der Sammelmitteilung.
  const parties = requestParties(closed, [...(send ? gone.flatMap(bookedUsers) : []), a.userId]);
  for (const party of parties) {
    const own = gone.filter(r => closed.some(c => (c.userId === party || c.targetUserId === party) && (c.shiftId === r.id || c.targetShiftId === r.id)));
    const text = own.length === 1 ? "Dein Antrag wurde geschlossen, weil die Schicht " + label(own[0]) + " entfällt." : "Deine Anträge wurden geschlossen, weil diese Schichten entfallen: " + own.map(label).join("; ") + ".";
    notified.push(...await notify(tx, a.orgId, a.userId, [party], "Antrag hinfällig", text, own.length === 1 ? own[0].id : undefined));
  }
  await tx.scheduleSnapshot.delete({ where: { scheduleId: schedule.id } });
  const updated = await tx.schedule.update({ where: { id: schedule.id }, data: { editingSince: null, editingById: null } });
  return { schedule: updated, affected: [...new Set([...diff.affectedUserIds, ...requestParties(closed)])], notified: [...new Set(notified)], requestsClosed: closed.length };
}

const OVERLAP = "Zeitliche Überschneidung mit einer anderen Schicht.";

/** JSON mit sortierten Schluesseln: JSONB speichert die Momentaufnahme ohne Schluesselreihenfolge. */
function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, v) => v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([x], [y]) => x < y ? -1 : 1)) : v);
}

/**
 * Bearbeitung verwerfen (EDITING -> PUBLISHED), ohne Mitteilungen: Den
 * veroeffentlichten Stand wiederherstellen - Schichtfelder zuruecksetzen,
 * geloeschte und an andere Standorte verschobene Schichten zurueckholen,
 * Buchungen abgleichen (fehlende mit ihrer alten id anlegen, ueberzaehlige
 * loeschen, geaenderte zuruecksetzen) und waehrend der Bearbeitung angelegte
 * Schichten loeschen (soft, Loeschschutz wie beim Loeschen). Begonnene
 * Schichten (alter oder neuer Stand) und solche mit Check-in bleiben, wie
 * sie sind (skipped). Buchungen inzwischen geloeschter Personen entfallen.
 * Ergaebe die Wiederherstellung eine Ueberschneidung mit einer anderen
 * Schicht derselben Person, wird nichts verworfen (409).
 */
export async function discardEdits(tx: Tx, a: Access, schedule: Schedule) {
  const snapshot = await loadSnapshot(tx, schedule.id);
  const ids = new Set(snapshot.shifts.map(s => s.id));
  const rows = await tx.shift.findMany({ where: { OR: [{ scheduleId: schedule.id, deletedAt: null }, { id: { in: [...ids] } }] }, include: shiftInclude });
  const members = new Set((await tx.organizationMember.findMany({ where: { organizationId: a.orgId, userId: { in: snapshot.shifts.flatMap(bookedUsers) } }, select: { userId: true } })).map(m => m.userId));
  const now = new Date();
  const branches = new Set<string | null>([schedule.branchId]);
  const affected = new Set<string>();
  const restored: string[] = [];
  let skipped = 0, removed = 0;
  for (const before of snapshot.shifts) {
    const row = rows.find(r => r.id === before.id);
    if (!row) { skipped++; continue; }
    if (!row.deletedAt && stableJson(toSnapshotShift(row)) === stableJson(before)) continue;
    if (!isFuture({ ...before, schedule }, now) || !isFuture(row, now) || await tx.checkin.count({ where: { shiftId: row.id } })) { skipped++; continue; }
    const { id: _id, createdAt: _created, bookings, ...fields } = before;
    void _id; void _created;
    await tx.shift.update({ where: { id: row.id }, data: { ...fields, deletedAt: null } });
    await tx.booking.deleteMany({ where: { shiftId: row.id, id: { notIn: bookings.map(b => b.id) } } });
    for (const b of bookings) {
      if (b.userId && !members.has(b.userId)) continue;
      const data = { shiftId: row.id, userId: b.userId, formerEmployeeId: b.formerEmployeeId, contractorWorkerId: b.contractorWorkerId, bookedAt: new Date(b.bookedAt), bookedBy: b.bookedBy, confirmedAt: b.confirmedAt ? new Date(b.confirmedAt) : null, confirmation: b.confirmation };
      await tx.booking.upsert({ where: { id: b.id }, create: { id: b.id, ...data }, update: data });
    }
    branches.add(row.schedule.branchId);
    for (const id of [...bookedUsers(before), ...bookedUsers(toSnapshotShift(row))]) affected.add(id);
    restored.push(row.id);
  }
  for (const row of rows) {
    if (ids.has(row.id) || row.deletedAt || row.scheduleId !== schedule.id) continue;
    if (!(await shiftDeletion(tx, a.orgId, row)).deletable) { skipped++; continue; }
    await tx.booking.deleteMany({ where: { shiftId: row.id } });
    await tx.shift.update({ where: { id: row.id }, data: { deletedAt: now } });
    for (const id of bookedUsers(toSnapshotShift(row))) affected.add(id);
    removed++;
  }
  const conflicts: string[] = [];
  for (const id of restored) {
    const shift = await tx.shift.findUniqueOrThrow({ where: { id }, include: shiftInclude });
    for (const b of shift.bookings) {
      const check = b.userId ? await assessAssignment(tx, shift, b.userId) : b.contractorWorkerId ? await assessContractorAssignment(tx, shift, b.contractorWorkerId) : null;
      // Beim Einteilen nur ein bestaetigbarer Hinweis; Verwerfen stellt eine Doppelbelegung trotzdem nicht still wieder her.
      if (check && [...check.blocks, ...check.warnings].includes(OVERLAP)) conflicts.push(formatName(personName(b), a.member.organization.nameFormat, { contractor: !!b.contractorWorkerId }) + " (" + shiftLabel(shift) + ")");
    }
  }
  if (conflicts.length) throw new ApiError("Verwerfen nicht möglich: Die Wiederherstellung ergäbe Überschneidungen mit anderen Schichten – " + conflicts.join("; ") + ". Bitte zuerst dort lösen.", 409, { conflicts });
  await tx.scheduleSnapshot.delete({ where: { scheduleId: schedule.id } });
  await tx.schedule.update({ where: { id: schedule.id }, data: { editingSince: null, editingById: null } });
  return { restored: restored.length, removed, skipped, branches: [...branches], affected: [...affected] };
}
