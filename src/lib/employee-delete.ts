/**
 * Mitarbeitende endgueltig loeschen (nicht deaktivieren, nicht archivieren).
 *
 * Geloescht werden Konto, Zugang, Freigaben, Verfuegbarkeiten, Abwesenheiten,
 * Antraege, Nachrichten-Eingang, Push-Abos und kuenftige Einsaetze. Arbeitszeiten,
 * Check-ins und begonnene/vergangene Einsaetze bleiben als Historie erhalten:
 * sie wechseln zu einer Momentaufnahme (FormerEmployee, nur Vor- und Nachname).
 * Hat die Person ein Konto in einer weiteren Organisation, bleibt das Konto
 * samt allem dort bestehen; nur die Mitgliedschaft in dieser Organisation endet.
 * Alles laeuft in der Transaktion des Aufrufers - ein Fehler stellt den
 * Ausgangszustand wieder her.
 */
import type { Prisma } from "@prisma/client";
import { ApiError } from "./errors";
import { berlinDate, berlinTime, shiftRange } from "./berlin";
import { wallToUtcMinutes } from "./checkin";
import { branchHolders, type Access } from "./access";
import { normalizeStaffRights } from "./access-shared";
import { notify } from "./planning";
import { closeOpenRequests, isFuture, requestParties } from "./shift-requests";

type Tx = Prisma.TransactionClient;

export type DeletionPreview = {
  name: string;
  role: string;
  futureAssignments: number;
  historyKept: { bookings: number; timeRecords: number; checkins: number };
  blockers: string[];
  sharedAccount: boolean;
};

const germanDate = (date: string) => date.split("-").reverse().join(".");

/**
 * Wer loeschen darf: Admins jede Person ausser sich selbst und dem Inhaber;
 * Manager nur Mitarbeitende, denen sie ausdruecklich mit "Mitarbeiter loeschen"
 * zugeordnet sind. Das Recht wird direkt aus der Zuordnung gelesen, nicht aus
 * a.staff (dort fehlen deaktivierte Personen). Ohne jede Zuordnung 404 (die
 * Person bleibt verborgen), sonst 403.
 */
async function deletionTarget(tx: Tx, a: Access, memberId: string) {
  const member = await tx.organizationMember.findFirst({ where: { id: memberId, organizationId: a.orgId }, include: { user: { select: { firstName: true, lastName: true } } } });
  if (!member) throw new ApiError("Nicht gefunden.", 404);
  if (a.isAdmin) {
    if (member.userId === a.userId) throw new ApiError("Das eigene Konto kann nicht gelöscht werden.", 400);
    if (member.role === "OWNER") throw new ApiError("Der Inhaber kann nicht gelöscht werden.", 400);
    return member;
  }
  if (a.role !== "MANAGER" || member.userId === a.userId) throw new ApiError("Nicht gefunden.", 404);
  const assignment = await tx.staffAssignment.findFirst({ where: { organizationId: a.orgId, managerMemberId: a.memberId, employeeMemberId: member.id }, select: { rights: true } });
  const rights = normalizeStaffRights(assignment?.rights ?? [], a.role);
  if (!rights.length) throw new ApiError("Nicht gefunden.", 404);
  if (!rights.includes("DELETE_EMPLOYEE")) throw new ApiError("Keine Berechtigung, diese Person zu löschen.", 403);
  if (member.role !== "EMPLOYEE") throw new ApiError("Manager dürfen nur Mitarbeitende löschen, keine Manager oder die Administration.", 403);
  return member;
}

/** Zuweisungen der Person in dieser Organisation, nach ihrer Bedeutung fuer die Loeschung geordnet. */
async function classifyBookings(tx: Tx, orgId: string, userId: string, now: Date) {
  const bookings = await tx.booking.findMany({
    where: { userId, shift: { schedule: { organizationId: orgId } } },
    include: { shift: { include: { schedule: { select: { year: true, weekNumber: true, branchId: true, isPublic: true, deletedAt: true, branch: { select: { name: true } } } } } } },
  });
  const stale: typeof bookings = [], future: typeof bookings = [], running: typeof bookings = [], history: typeof bookings = [];
  for (const b of bookings) {
    // Geloeschte Schicht oder Plan: unsichtbar, nirgends gezaehlt - kein Nachweis.
    if (b.shift.deletedAt || b.shift.schedule.deletedAt) stale.push(b);
    else if (isFuture(b.shift, now)) future.push(b);
    else if (wallToUtcMinutes(shiftRange(b.shift).end) > now.getTime() / 60000) running.push(b);
    else history.push(b);
  }
  return { stale, future, running, history };
}

async function analyse(tx: Tx, a: Access, memberId: string) {
  const member = await deletionTarget(tx, a, memberId);
  const { userId } = member, orgId = a.orgId, now = new Date();
  const name = member.user.firstName + " " + member.user.lastName;
  const [bookings, timeRecords, checkins, running, pending, elsewhere] = await Promise.all([
    classifyBookings(tx, orgId, userId, now),
    tx.timeRecord.count({ where: { organizationId: orgId, userId } }),
    tx.checkin.count({ where: { organizationId: orgId, userId } }),
    // Laufende Zeiterfassung: Stoppuhr ohne Ende (wie in /api/time/watch) oder gestartet ohne Ende.
    tx.timeRecord.findFirst({ where: { organizationId: orgId, userId, OR: [{ type: "WATCH", timeTo: null }, { startedAt: { not: null }, endedAt: null }] }, select: { startedAt: true, timeFrom: true, date: true } }),
    tx.checkin.findMany({ where: { organizationId: orgId, userId, status: "PENDING" }, select: { createdAt: true }, orderBy: { createdAt: "asc" } }),
    tx.organizationMember.count({ where: { userId, organizationId: { not: orgId } } }),
  ]);
  const blockers: string[] = [];
  if (running) {
    const today = berlinDate(now);
    const since = running.startedAt
      ? (berlinDate(running.startedAt) === today ? "" : germanDate(berlinDate(running.startedAt)) + " ") + berlinTime(running.startedAt)
      : (running.timeFrom ?? germanDate(running.date.toISOString().slice(0, 10)));
    blockers.push(`Für ${name} läuft noch eine Zeiterfassung (seit ${since}). Bitte zuerst beenden.`);
  }
  for (const c of pending) blockers.push(`${name} hat einen offenen Check-in-Antrag vom ${germanDate(berlinDate(c.createdAt))}. Bitte zuerst entscheiden.`);
  for (const b of bookings.running) blockers.push(`${name} ist gerade im Einsatz (${b.shift.schedule.branch?.name ?? "ohne Standort"}, ${b.shift.shiftFrom}–${b.shift.shiftTo}). Bitte nach dem Einsatz löschen.`);
  return { member, userId, name, bookings, timeRecords, checkins, blockers, sharedAccount: elsewhere > 0 };
}

/** Vorschau fuer die Sicherheitsabfrage; prueft dieselben Rechte wie die Loeschung. */
export async function deletionPreview(tx: Tx, a: Access, memberId: string): Promise<DeletionPreview> {
  const info = await analyse(tx, a, memberId);
  return {
    name: info.name, role: info.member.role, futureAssignments: info.bookings.future.length,
    historyKept: { bookings: info.bookings.history.length, timeRecords: info.timeRecords, checkins: info.checkins },
    blockers: info.blockers, sharedAccount: info.sharedAccount,
  };
}

export type DeletionResult = {
  userId: string;
  futureAssignmentsRemoved: number;
  historyKept: DeletionPreview["historyKept"];
  /** Standorte, deren Plan sich aendert (null: Altbestand ohne Standort). */
  branchIds: (string | null)[];
  /** Personen mit neuer Nachricht (fuer das Echtzeitsignal nach dem Commit). */
  notified: string[];
};

export async function deleteEmployee(tx: Tx, a: Access, memberId: string, options: { fault?: boolean } = {}): Promise<DeletionResult> {
  const info = await analyse(tx, a, memberId);
  if (info.blockers.length) throw new ApiError(info.blockers.join(" "), 409, { blockers: info.blockers });
  const { member, userId, name, bookings } = info, orgId = a.orgId;
  const historyKept = { bookings: bookings.history.length, timeRecords: info.timeRecords, checkins: info.checkins };

  // 1. Offene Antraege schliessen (als antragstellende oder angefragte Person), Gegenseite informieren; dann alle Antraege der Person loeschen.
  const closed = await closeOpenRequests(tx, a, { OR: [{ userId }, { targetUserId: userId }] }, "Die beteiligte Person wurde gelöscht.");
  const parties = requestParties(closed, [userId, a.userId]);
  await tx.modRequest.deleteMany({ where: { userId, shift: { schedule: { organizationId: orgId } } } });
  // Offene Korrekturantraege entfallen; entschiedene bleiben als Nachweis.
  await tx.timeCorrection.deleteMany({ where: { organizationId: orgId, status: "PENDING", record: { userId } } });

  // 2. Kuenftige (und unsichtbare) Zuweisungen entfallen, die Schichten bleiben offen.
  await tx.booking.deleteMany({ where: { id: { in: [...bookings.future, ...bookings.stale].map((b) => b.id) } } });

  // 3. Historie wechselt zu einer Momentaufnahme (nur Name), sonst entsteht keine.
  if (historyKept.bookings || historyKept.timeRecords || historyKept.checkins) {
    const former = await tx.formerEmployee.create({ data: { organizationId: orgId, firstName: member.user.firstName, lastName: member.user.lastName } });
    const moved = { userId: null, formerEmployeeId: former.id };
    if (historyKept.bookings) await tx.booking.updateMany({ where: { id: { in: bookings.history.map((b) => b.id) } }, data: moved });
    await tx.timeRecord.updateMany({ where: { organizationId: orgId, userId }, data: moved });
    await tx.checkin.updateMany({ where: { organizationId: orgId, userId }, data: moved });
  }

  // 4. Personenbezogene Daten dieser Organisation. Inhalte anderer bleiben, die Autorenschaft der Person wird leer.
  await tx.absence.deleteMany({ where: { userId, category: { organizationId: orgId } } });
  await tx.divisionMember.deleteMany({ where: { userId, division: { organizationId: orgId } } });
  await tx.liveLog.deleteMany({ where: { userId, liveSession: { schedule: { organizationId: orgId } } } });
  await tx.messageRecipient.deleteMany({ where: { userId, message: { organizationId: orgId } } });
  await tx.pushSubscription.deleteMany({ where: { userId, organizationId: orgId } });
  await tx.message.updateMany({ where: { organizationId: orgId, senderId: userId }, data: { senderId: null } });
  await tx.topicPost.updateMany({ where: { userId, topic: { organizationId: orgId } }, data: { userId: null } });
  await tx.portalFile.updateMany({ where: { organizationId: orgId, uploadedById: userId }, data: { uploadedById: null } });
  await tx.branchIssue.updateMany({ where: { organizationId: orgId, createdById: userId }, data: { createdById: null } });
  if (info.sharedAccount) {
    // Notizen haben keine Organisation: nur eindeutig diese Organisation betreffende (Autor nur hier Mitglied) entfallen.
    const elsewhere = (await tx.organizationMember.findMany({ where: { userId, organizationId: { not: orgId } }, select: { organizationId: true } })).map((m) => m.organizationId);
    await tx.employeeNote.deleteMany({ where: { subjectId: userId, author: { is: { AND: [{ memberships: { some: { organizationId: orgId } } }, { memberships: { none: { organizationId: { in: elsewhere } } } }] } } } });
  }

  // 5. Mitgliedschaft (Freigaben, Zuordnungen und Verfuegbarkeiten folgen per Kaskade).
  await tx.organizationMember.delete({ where: { id: member.id } });

  // 6. Nachrichten (je Person eine, Zustellung erst mit dem Commit): Gegenseiten der Antraege und Planung der veroeffentlichten Schichten.
  const notified: string[] = [];
  if (parties.length) {
    const ids = [...new Set(closed.flatMap((r) => [r.shiftId, ...(r.targetShiftId ? [r.targetShiftId] : [])]))];
    const shifts = new Map((await tx.shift.findMany({ where: { id: { in: ids } }, include: { schedule: true } })).map((s) => [s.id, s]));
    const label = (id: string) => { const s = shifts.get(id); return s ? "Schicht am " + germanDate(shiftRange(s).date) + ", " + s.shiftFrom + "–" + s.shiftTo : "Schicht"; };
    for (const party of parties) {
      // Fuer die angefragte Person ist bei einem Tausch die eigene (Gegen-)Schicht gemeint.
      const own = closed.filter((r) => r.userId === party || r.targetUserId === party).map((r) => (r.targetUserId === party && r.targetShiftId ? r.targetShiftId : r.shiftId));
      const text = own.length === 1
        ? `Dein Antrag zur ${label(own[0])} wurde geschlossen, weil die beteiligte Person gelöscht wurde.`
        : `Folgende Anträge wurden geschlossen, weil die beteiligte Person gelöscht wurde: ${own.map(label).join("; ")}.`;
      notified.push(...await notify(tx, orgId, a.userId, [party], "Antrag hinfällig", text, own.length === 1 ? own[0] : undefined));
    }
  }
  const open = new Map<string | null, { name: string; count: number }>();
  for (const b of bookings.future) {
    if (!b.shift.schedule.isPublic) continue;
    const key = b.shift.schedule.branchId, entry = open.get(key) ?? { name: b.shift.schedule.branch?.name ?? "ohne Standort", count: 0 };
    open.set(key, { ...entry, count: entry.count + 1 });
  }
  const planners = new Map<string, string[]>();
  for (const [branchId, { name: site, count }] of open) {
    const line = `${count} ${count === 1 ? "Schicht" : "Schichten"} am Standort ${site}`;
    for (const id of await branchHolders(tx, orgId, branchId, ["EDIT_SHIFTS"])) planners.set(id, [...(planners.get(id) ?? []), line]);
  }
  for (const [planner, lines] of planners) {
    notified.push(...await notify(tx, orgId, a.userId, [planner], "Schichten wieder offen", `${name} wurde gelöscht. Wieder offen: ${lines.join("; ")}. Bitte neu besetzen.`));
  }

  // 7. Zugang: ohne weitere Mitgliedschaft entfaellt das Konto samt Anmeldung; sonst bleibt es fuer die anderen Organisationen.
  if (!info.sharedAccount) {
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { email: true } });
    await tx.session.deleteMany({ where: { userId } });
    await tx.verificationToken.deleteMany({ where: { identifier: user.email } });
    await tx.user.delete({ where: { id: userId } });
  }

  // Nur fuer die Regressionspruefung der Atomaritaet (siehe Route): Fehler nach allen Schreibvorgaengen.
  if (options.fault) throw new Error("Testfehler nach allen Schreibvorgaengen");

  return {
    userId, futureAssignmentsRemoved: bookings.future.length, historyKept,
    branchIds: [...new Set([...bookings.future, ...bookings.history].map((b) => b.shift.schedule.branchId))],
    notified: [...new Set(notified)],
  };
}
