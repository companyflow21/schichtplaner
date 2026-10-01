/*
 * Mitarbeiterloeschung auf Datenbankebene: deleteEmployee() gegen eine echte
 * PostgreSQL-Engine (PGlite, alle Migrationen), ohne Server. Prueft, was die
 * HTTP-Tests nicht sehen koennen: dass nach dem Loeschen keine Zeile mehr auf
 * die Person zeigt (ausser der Historie, die zur Momentaufnahme wechselt), dass
 * Daten anderer Organisationen eines geteilten Kontos unberuehrt bleiben und
 * dass ein Fehler vor dem Commit alles zuruecksetzt.
 *
 *   npx tsx tests/employee-delete-db.ts
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from "node:assert/strict";
import net from "node:net";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { addDate, berlinDate, isoWeek } from "../src/lib/berlin";

let checks = 0;
function check(value: unknown, message: string) { assert.ok(value, message); checks++; console.log("PASS: " + message); }

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => { const { port } = server.address() as net.AddressInfo; server.close(() => resolve(port)); });
  });
}

async function main() {
  const sql = new PGlite();
  for (const migration of (await readdir("prisma/migrations")).filter((x) => /^\d/.test(x)).sort()) await sql.exec(await readFile("prisma/migrations/" + migration + "/migration.sql", "utf8"));
  const port = await freePort();
  const socket = new PGLiteSocketServer({ db: sql, host: "127.0.0.1", port });
  await socket.start();
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: "postgresql://postgres:postgres@127.0.0.1:" + port + "/postgres", max: 1 }) });
  // src/lib/db.ts nimmt diesen Client statt eines eigenen (siehe tests/serial-retry.ts).
  (globalThis as any).prisma = db;
  const { deleteEmployee, deletionPreview } = await import("../src/lib/employee-delete");

  const today = berlinDate();
  const future = addDate(today, 30), past = addDate(today, -30);
  const dow = (d: string) => ((new Date(d + "T12:00:00Z").getUTCDay() + 6) % 7) + 1;
  const stamp = new Date();

  // --- Organisationen, Personen, Struktur -------------------------------------------
  const o1 = await db.organization.create({ data: { name: "Org Eins" } }), o2 = await db.organization.create({ data: { name: "Org Zwei" } });
  const user = (email: string, firstName: string, lastName: string) => db.user.create({ data: { email, firstName, lastName, passwordHash: "x" } });
  const member = (organizationId: string, userId: string, role: "OWNER" | "ADMIN" | "MANAGER" | "EMPLOYEE", joinedAt = stamp) => db.organizationMember.create({ data: { organizationId, userId, role, isActivated: true, joinedAt } });
  const adminUser = await user("admin@x.invalid", "Alex", "Admin"), solo = await user("solo@x.invalid", "Sonja", "Solo"), shared = await user("shared@x.invalid", "Sven", "Geteilt");
  const other1 = await user("other1@x.invalid", "Otto", "Eins"), other2 = await user("other2@x.invalid", "Olga", "Zwei");
  const adminM = await member(o1.id, adminUser.id, "ADMIN"), soloM = await member(o1.id, solo.id, "EMPLOYEE");
  const sharedM1 = await member(o1.id, shared.id, "EMPLOYEE", new Date(Date.now() - 86400000)), sharedM2 = await member(o2.id, shared.id, "EMPLOYEE");
  const otherM1 = await member(o1.id, other1.id, "EMPLOYEE");
  await member(o2.id, other2.id, "MANAGER");
  const actor = { member: { id: adminM.id, role: "ADMIN" }, orgId: o1.id, userId: adminUser.id, memberId: adminM.id, role: "ADMIN", isAdmin: true, branches: new Map(), staff: new Map() } as any;

  type Org = { id: string };
  async function structure(org: Org, label: string) {
    const customer = await db.customer.create({ data: { organizationId: org.id, name: label + " Kunde" } });
    const branch = await db.branch.create({ data: { organizationId: org.id, customerId: customer.id, name: label + " Objekt" } });
    const schedule = async (d: string, isPublic: boolean) => { const w = isoWeek(d); return db.schedule.create({ data: { organizationId: org.id, branchId: branch.id, weekNumber: w.weekNumber, year: w.year, isPublic } }); };
    const shift = (scheduleId: string, d: string, extra: Record<string, unknown> = {}) => db.shift.create({ data: { scheduleId, dayOfWeek: dow(d), shiftFrom: "08:00", shiftTo: "16:00", ...extra } });
    const pastPlan = await schedule(past, true), futurePlan = await schedule(future, true);
    const category = await db.absenceCategory.create({ data: { organizationId: org.id, name: label + " Urlaub" } });
    const division = await db.division.create({ data: { organizationId: org.id, title: label + " Bereich" } });
    const topic = await db.topic.create({ data: { organizationId: org.id, title: label + " Thema", createdById: adminUser.id } });
    return { branch, pastShift: await shift(pastPlan.id, past), futureShift: await shift(futurePlan.id, future), deletedShift: await shift(futurePlan.id, future, { deletedAt: new Date() }), pastPlan, category, division, topic };
  }
  const s1 = await structure(o1, "Eins"), s2 = await structure(o2, "Zwei");

  /** Alles, was an einer Person in einer Organisation haengt. */
  async function seed(userId: string, memberId: string, org: Org, s: Awaited<ReturnType<typeof structure>>, tag: string) {
    await db.branchAccess.create({ data: { organizationId: org.id, memberId, branchId: s.branch.id, rights: ["REQUEST_SHIFTS"] } });
    await db.availability.create({ data: { organizationId: org.id, userId, date: new Date(future), timeFrom: "08:00", timeTo: "12:00", available: false } });
    await db.absence.create({ data: { userId, categoryId: s.category.id, dateFrom: new Date(future), dateTo: new Date(future) } });
    await db.divisionMember.create({ data: { divisionId: s.division.id, userId } });
    await db.booking.create({ data: { shiftId: s.futureShift.id, userId } });
    await db.booking.create({ data: { shiftId: s.deletedShift.id, userId } });
    await db.booking.create({ data: { shiftId: s.pastShift.id, userId } });
    const record = await db.timeRecord.create({ data: { userId, organizationId: org.id, branchId: s.branch.id, date: new Date(past), timeFrom: "08:00", timeTo: "16:00", type: "MANUAL" } });
    const checkinRecord = await db.timeRecord.create({ data: { userId, organizationId: org.id, branchId: s.branch.id, date: new Date(past), timeFrom: "08:00", timeTo: "16:00", type: "WATCH", startedAt: new Date(Date.now() - 9e8), endedAt: new Date(Date.now() - 8.9e8) } });
    await db.checkin.create({ data: { organizationId: org.id, userId, shiftId: s.pastShift.id, branchId: s.branch.id, timeRecordId: checkinRecord.id, method: "GPS", status: "CONFIRMED", lateMinutes: 1 } });
    await db.timeCorrection.create({ data: { organizationId: org.id, recordId: record.id, requesterId: userId, reason: tag + " entschieden", before: {}, proposed: {}, status: "APPROVED" } });
    await db.timeCorrection.create({ data: { organizationId: org.id, recordId: record.id, requesterId: userId, reason: tag + " offen", before: {}, proposed: {}, status: "PENDING" } });
    const live = await db.liveSession.upsert({ where: { scheduleId: s.pastPlan.id }, update: {}, create: { scheduleId: s.pastPlan.id } });
    await db.liveLog.create({ data: { liveSessionId: live.id, shiftId: s.pastShift.id, userId, action: "BOOK" } });
    await db.message.create({ data: { organizationId: org.id, senderId: adminUser.id, subject: tag + " an Person", body: "x", recipients: { create: [{ userId }] } } });
    await db.message.create({ data: { organizationId: org.id, senderId: userId, subject: tag + " von Person", body: "x", recipients: { create: [{ userId: adminUser.id }] } } });
    await db.pushSubscription.create({ data: { organizationId: org.id, userId, endpoint: "https://push.example/" + tag, p256dh: "p", auth: "a" } });
    await db.topicPost.create({ data: { topicId: s.topic.id, userId, text: tag } });
    await db.portalFile.create({ data: { organizationId: org.id, name: tag, path: "/" + tag, size: 1, uploadedById: userId } });
    await db.branchIssue.create({ data: { organizationId: org.id, branchId: s.branch.id, title: tag + " erstellt", description: "x", createdById: userId } });
    await db.branchIssue.create({ data: { organizationId: org.id, branchId: s.branch.id, title: tag + " zugewiesen", description: "x", assigneeMemberId: memberId } });
    await db.modRequest.create({ data: { shiftId: s.futureShift.id, userId, kind: "TAKEOVER" } });
  }
  await seed(solo.id, soloM.id, o1, s1, "solo");
  await seed(shared.id, sharedM1.id, o1, s1, "shared1");
  await seed(shared.id, sharedM2.id, o2, s2, "shared2");
  await db.session.create({ data: { sessionToken: "t-solo", userId: solo.id, expires: new Date(Date.now() + 1e8) } });
  await db.verificationToken.create({ data: { identifier: solo.email, token: "v-solo", expires: new Date(Date.now() + 1e8) } });
  // Beziehungen zu anderen Personen: Anfrage, bei der die Person Gegenseite ist; Notizen in beide Richtungen; Zuordnungen.
  await db.modRequest.create({ data: { shiftId: s1.futureShift.id, userId: other1.id, kind: "SWAP", targetUserId: solo.id } });
  await db.employeeNote.create({ data: { subjectId: solo.id, authorId: adminUser.id, text: "Notiz zu solo" } });
  await db.employeeNote.create({ data: { subjectId: other1.id, authorId: solo.id, text: "Notiz von solo" } });
  await db.employeeNote.create({ data: { subjectId: shared.id, authorId: adminUser.id, text: "Notiz aus Org Eins (nur dort Mitglied)" } });
  await db.employeeNote.create({ data: { subjectId: shared.id, authorId: other2.id, text: "Notiz aus Org Zwei (nur dort Mitglied)" } });
  await db.staffAssignment.create({ data: { organizationId: o1.id, managerMemberId: adminM.id, employeeMemberId: soloM.id, rights: ["VIEW_PROFILE"] } });
  await db.staffAssignment.create({ data: { organizationId: o1.id, managerMemberId: otherM1.id, employeeMemberId: sharedM1.id, rights: ["VIEW_PROFILE"] } });

  const rows = async (userId: string) => ({
    bookings: await db.booking.count({ where: { userId } }), timeRecords: await db.timeRecord.count({ where: { userId } }), checkins: await db.checkin.count({ where: { userId } }),
    absences: await db.absence.count({ where: { userId } }), divisions: await db.divisionMember.count({ where: { userId } }), liveLogs: await db.liveLog.count({ where: { userId } }),
    recipients: await db.messageRecipient.count({ where: { userId } }), push: await db.pushSubscription.count({ where: { userId } }), requests: await db.modRequest.count({ where: { userId } }),
    members: await db.organizationMember.count({ where: { userId } }),
  });
  const snapshot = async () => JSON.stringify({
    users: await db.user.count(), members: await db.organizationMember.count(), former: await db.formerEmployee.count(), bookings: await db.booking.count({ where: { userId: { not: null } } }),
    records: await db.timeRecord.count(), checkins: await db.checkin.count(), corrections: await db.timeCorrection.count(), requests: await db.modRequest.findMany({ select: { id: true, state: true } }),
    messages: await db.message.count(), recipients: await db.messageRecipient.count(), sessions: await db.session.count(), notes: await db.employeeNote.count(), push: await db.pushSubscription.count(),
  });

  // --- Fehlerinjektion: alles wird zurueckgesetzt ---------------------------------------
  const intact = await snapshot();
  let failed: unknown;
  try { await db.$transaction((tx) => deleteEmployee(tx, actor, soloM.id, { fault: true })); } catch (e) { failed = e; }
  check(failed instanceof Error && /Testfehler/.test(failed.message), "injected fault aborts the deletion");
  check(await snapshot() === intact, "after the fault no row differs from the initial state (users, members, hours, requests, messages, sessions)");

  // --- Vorschau und Loeschung einer Person mit nur einer Organisation -----------------------
  const prev = await deletionPreview(db, actor, soloM.id);
  check(prev.name === "Sonja Solo" && prev.futureAssignments === 1 && prev.historyKept.bookings === 1 && prev.historyKept.timeRecords === 2 && prev.historyKept.checkins === 1 && prev.sharedAccount === false && prev.blockers.length === 0, "preview counts future assignments and history (the booking on the deleted shift counts as neither)");
  const out = await db.$transaction((tx) => deleteEmployee(tx, actor, soloM.id));
  check(out.futureAssignmentsRemoved === 1 && out.historyKept.bookings === 1 && out.historyKept.timeRecords === 2 && out.historyKept.checkins === 1, "result reports what was removed and kept");
  check(!(await db.user.findUnique({ where: { id: solo.id } })), "single-organization person: the user row is gone");
  const left = await rows(solo.id);
  check(Object.values(left).every((n) => n === 0), "no row points to the deleted user any more");
  check(await db.session.count({ where: { userId: solo.id } }) === 0 && await db.verificationToken.count({ where: { identifier: solo.email } }) === 0, "sessions and verification tokens are gone");
  const formers = await db.formerEmployee.findMany({ where: { organizationId: o1.id } });
  check(formers.length === 1 && formers[0].firstName === "Sonja" && formers[0].lastName === "Solo" && Object.keys(formers[0]).sort().join() === "deletedAt,firstName,id,lastName,organizationId", "exactly one snapshot with names only");
  const fid = formers[0].id;
  check(await db.booking.count({ where: { formerEmployeeId: fid, userId: null } }) === 1 && await db.timeRecord.count({ where: { formerEmployeeId: fid, userId: null } }) === 2 && await db.checkin.count({ where: { formerEmployeeId: fid, userId: null } }) === 1, "history moved to the snapshot (past booking, both time records, check-in)");
  check(await db.booking.count({ where: { shiftId: { in: [s1.futureShift.id, s1.deletedShift.id] }, OR: [{ userId: solo.id }, { formerEmployeeId: fid }] } }) === 0, "future and invisible bookings were deleted, not kept");
  check(await db.timeCorrection.count({ where: { reason: "solo offen" } }) === 0 && await db.timeCorrection.count({ where: { reason: "solo entschieden" } }) === 1, "pending correction deleted, decided one kept");
  check(await db.message.count({ where: { subject: "solo von Person", senderId: null } }) === 1 && await db.message.count({ where: { subject: "solo an Person" } }) === 1 && await db.messageRecipient.count({ where: { message: { subject: "solo an Person" } } }) === 0, "authored message stays without sender, received message loses its recipient row");
  check(await db.topicPost.count({ where: { text: "solo", userId: null } }) === 1 && await db.portalFile.count({ where: { name: "solo", uploadedById: null } }) === 1 && await db.branchIssue.count({ where: { title: "solo erstellt", createdById: null } }) === 1 && await db.branchIssue.count({ where: { title: "solo zugewiesen", assigneeMemberId: null } }) === 1, "posts, files and issues stay without author or assignee");
  check(await db.employeeNote.count({ where: { text: "Notiz zu solo" } }) === 0 && await db.employeeNote.count({ where: { text: "Notiz von solo", authorId: null } }) === 1, "notes about the person are gone, notes by the person lose their author");
  check(await db.modRequest.count({ where: { userId: other1.id, kind: "SWAP", state: "DECLINED", decisionNote: "Die beteiligte Person wurde gelöscht." } }) === 1, "request of another person with the deleted one as counterpart is declined with a reason");
  check(await db.staffAssignment.count({ where: { employeeMemberId: soloM.id } }) === 0 && await db.branchAccess.count({ where: { memberId: soloM.id } }) === 0 && await db.availability.count({ where: { userId: solo.id } }) === 0, "assignments, branch access and availability followed the membership");

  // --- Geteiltes Konto: nur die Organisation endet, alles andere bleibt ---------------------
  const sharedBefore2 = await rows(shared.id);
  const prevShared = await deletionPreview(db, actor, sharedM1.id);
  check(prevShared.sharedAccount === true, "preview flags the shared account");
  await db.$transaction((tx) => deleteEmployee(tx, actor, sharedM1.id));
  check(!!(await db.user.findUnique({ where: { id: shared.id } })), "shared account: the user row stays");
  check(await db.organizationMember.count({ where: { userId: shared.id, organizationId: o1.id } }) === 0 && await db.organizationMember.count({ where: { userId: shared.id, organizationId: o2.id } }) === 1, "membership of organization one ended, organization two stays");
  const org1Left = await db.booking.count({ where: { userId: shared.id, shift: { schedule: { organizationId: o1.id } } } }) + await db.timeRecord.count({ where: { userId: shared.id, organizationId: o1.id } }) + await db.checkin.count({ where: { userId: shared.id, organizationId: o1.id } })
    + await db.absence.count({ where: { userId: shared.id, category: { organizationId: o1.id } } }) + await db.divisionMember.count({ where: { userId: shared.id, division: { organizationId: o1.id } } }) + await db.pushSubscription.count({ where: { userId: shared.id, organizationId: o1.id } }) + await db.messageRecipient.count({ where: { userId: shared.id, message: { organizationId: o1.id } } });
  check(org1Left === 0, "shared account: nothing of organization one points to the account any more");
  const after = await rows(shared.id);
  check(after.bookings === 3 && after.timeRecords === 2 && after.checkins === 1 && after.absences === 1 && after.divisions === 1 && after.liveLogs === 1 && after.recipients === 1 && after.push === 1 && after.requests === 1 && after.members === 1, "shared account: organization two keeps every row (3 bookings, 2 records, check-in, absence, division, live log, message, push, request)");
  check(sharedBefore2.members === 2, "sanity: the account had two memberships");
  check(await db.employeeNote.count({ where: { text: "Notiz aus Org Eins (nur dort Mitglied)" } }) === 0 && await db.employeeNote.count({ where: { text: "Notiz aus Org Zwei (nur dort Mitglied)" } }) === 1, "notes: only those written in the ended organization are removed");
  check(await db.message.count({ where: { subject: "shared1 von Person", senderId: null } }) === 1 && await db.message.count({ where: { subject: "shared2 von Person", senderId: shared.id } }) === 1, "authorship is cleared only in the ended organization");
  check(await db.formerEmployee.count({ where: { organizationId: o2.id } }) === 0 && await db.formerEmployee.count({ where: { organizationId: o1.id } }) === 2, "snapshots exist per organization that kept history, none for the untouched one");
  check(await db.timeCorrection.count({ where: { reason: "shared2 offen" } }) === 1 && await db.timeCorrection.count({ where: { reason: "shared1 offen" } }) === 0, "pending corrections: only the ended organization's were removed");

  console.log("SUCCESS: " + checks + " database-level deletion checks passed.");
  await db.$disconnect();
  await Promise.race([socket.stop(), new Promise((r) => setTimeout(r, 3000))]);
  await sql.close();
}

main().then(() => process.exit(0)).catch((error) => { console.error(error); process.exit(1); });
