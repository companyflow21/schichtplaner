/*
 * Mitarbeitende endgueltig loeschen (nicht deaktivieren): Rechte, Sicherheits-
 * vorschau, Sperren, Folgen fuer Plan, Antraege, Auswertung, Anmeldung und
 * Echtzeit, Atomaritaet (Fehlerinjektion) und geteilte Konten. Geprueft ueber
 * die echte API (gleicher Server wie tests/workflows.ts) mit eigenen,
 * ueber die API angelegten Personen; die geteilten Testpersonen bleiben
 * unberuehrt. Teilkonto A/B sind eigene Organisationen aus dem Setup.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { io, type Socket } from "socket.io-client";
import { addDate, berlinDate, berlinTime, isoWeek } from "../src/lib/berlin";
import { STAFF_PRESETS, allowedStaffRights } from "../src/lib/access-shared";
import type { TestContext } from "./permissions";
import { inboxCount, loginRefused, newPerson, planner, type Person, type Sess } from "./people";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function employeeDeleteTests(t: TestContext) {
  const { users, check } = t;
  const login = async (email: string) => { const s = new t.Session(); await s.login(email); return s; };
  const admin = await login(users.admin.email), foreign = await login(users.foreign.email), staffA = await login(users.staffA.email);
  const preview = (s: Sess, memberId: string, expected = 200) => s.request("/api/employees/" + memberId + "/deletion", "GET", undefined, expected);
  const remove = (s: Sess, memberId: string, expected = 200) => s.request("/api/employees/" + memberId, "DELETE", undefined, expected);
  const month = (day: string) => "/api/reporting?month=" + Number(day.slice(5, 7)) + "&year=" + day.slice(0, 4);
  const reportRows = async (day: string) => (await admin.request(month(day))).employees as any[];
  async function waitFor(condition: () => boolean | Promise<boolean>, message: string, timeout = 8000, interval = 150) {
    const start = Date.now();
    let ok = await condition();
    while (!ok && Date.now() - start < timeout) { await sleep(interval); ok = await condition(); }
    check(ok, message);
  }
  async function connect(s: Sess): Promise<Socket> {
    const socket = io(t.base, { path: "/api/ws", transports: ["websocket"], extraHeaders: { Cookie: s.cookie() }, reconnection: false, forceNew: true });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Socket-Verbindung kam nicht zustande")), 10000);
      socket.once("connect", () => { clearTimeout(timer); resolve(); });
      socket.once("connect_error", (error) => { clearTimeout(timer); reject(error); });
    });
    await sleep(800);
    return socket;
  }

  // --- Struktur und Personen -------------------------------------------------------
  const site = { latitude: 50.7374, longitude: 7.0982 };
  const customer = (await admin.request("/api/customers", "POST", { name: "Mitarbeiterlöschung Kunde" })).customer;
  const branch = (await admin.request("/api/branches", "POST", { customerId: customer.id, name: "Löschtest Objekt Nord" })).branch;
  await admin.request("/api/branches", "PATCH", { id: branch.id, ...site, checkinRadiusM: 50 });
  const plan = planner(admin, branch.id);
  const gps = (shiftId: string) => ({ shiftId, position: { ...site, accuracy: 10, timestamp: Date.now() - 2000 } });
  const main = await newPerson(t, admin, "ed.main", "Dora", "Löschtest", "EMPLOYEE", [branch.id]);

  // Eine Schicht, die in 2-3 Minuten endet: Check-in jetzt (das Fenster bleibt auch bei kalten Routen lange genug offen),
  // damit nach ihrem Ende Check-in, Zeit und Einsatz als Historie bleiben.
  const today = berlinDate();
  const startAt = new Date(Date.now() - 10 * 60000), endAt = new Date(Date.now() + 150 * 1000);
  const dQuick = berlinDate(startAt);
  const quick = await plan.shift(dQuick, berlinTime(startAt), berlinTime(endAt));
  await plan.book(quick.id, main.id);
  await plan.publish(dQuick);
  const quickIn = await main.session.request("/api/checkin", "POST", gps(quick.id));
  check(quickIn.checkin.status === "CONFIRMED" && quickIn.checkin.timeRecordId, "setup: check-in with time record on a shift that ends within three minutes");
  await main.session.request("/api/time/watch", "POST", { action: "STOP" });

  const partner = await newPerson(t, admin, "ed.partner", "Petra", "Partner", "EMPLOYEE", [branch.id]);
  const busy = await newPerson(t, admin, "ed.busy", "Bert", "Einsatz", "EMPLOYEE", [branch.id]);
  const watch = await newPerson(t, admin, "ed.watch", "Willi", "Stoppuhr", "EMPLOYEE", [branch.id]);
  const fault = await newPerson(t, admin, "ed.fault", "Fritz", "Fehler", "EMPLOYEE", [branch.id]);
  const mgrDel = await newPerson(t, admin, "ed.mgr", "Mona", "Verantwortung", "MANAGER");
  const mgrNo = await newPerson(t, admin, "ed.mgrno", "Nora", "Ohnerecht", "MANAGER");
  const mgrTarget = await newPerson(t, admin, "ed.mgrtarget", "Max", "Zweitmanager", "MANAGER");
  const accessOf = (member: string) => "/api/employees/" + member + "/access";
  const staffRights = (manager: Person, employee: Person, rights: string[], expected = 200) => admin.request(accessOf(manager.memberId), "PUT", { kind: "staff", memberId: employee.memberId, rights }, expected);
  await admin.request(accessOf(mgrDel.memberId), "PUT", { kind: "branch", branchId: branch.id, rights: ["EDIT_SHIFTS"] });

  // --- Das Recht "Mitarbeiter loeschen" ----------------------------------------------
  const granted = await staffRights(mgrDel, watch, ["DELETE_EMPLOYEE"]);
  check(granted.rights.includes("DELETE_EMPLOYEE") && granted.rights.includes("VIEW_PROFILE"), "the delete right can be granted to a manager and brings the profile view along");
  await staffRights(mgrDel, mgrTarget, ["DELETE_EMPLOYEE"]);
  await staffRights(mgrNo, main, ["ASSIGN_SHIFTS", "VIEW_PROFILE", "EDIT_PROFILE", "MANAGE_ABSENCES", "VIEW_HOURS"]);
  const editor = await admin.request(accessOf(mgrDel.memberId));
  check(editor.allowedStaffRights.includes("DELETE_EMPLOYEE") && editor.staff.find((s: any) => s.memberId === watch.memberId).rights.includes("DELETE_EMPLOYEE"), "access editor data lists the delete right for managers");
  check((await admin.request(accessOf(main.memberId))).allowedStaffRights.length === 0 && allowedStaffRights("EMPLOYEE").length === 0, "employees cannot hold staff rights");
  check(STAFF_PRESETS.every((p) => !p.rights.includes("DELETE_EMPLOYEE")), "no preset hands out the delete right");
  await admin.request(accessOf(main.memberId), "PUT", { kind: "staff", memberId: watch.memberId, rights: ["DELETE_EMPLOYEE"] }, 400);

  // Wer darf (und wer nicht)? Nichts davon veraendert etwas.
  await preview(staffA, main.memberId, 404);
  await remove(staffA, main.memberId, 404);
  await preview(mgrNo.session, main.memberId, 403);
  await remove(mgrNo.session, main.memberId, 403);
  await remove(mgrNo.session, busy.memberId, 404);
  await remove(mgrDel.session, main.memberId, 404);
  await preview(foreign, main.memberId, 404);
  await remove(foreign, main.memberId, 404);
  await preview(mgrDel.session, mgrTarget.memberId, 403);
  const refusedManager = await remove(mgrDel.session, mgrTarget.memberId, 403);
  check(refusedManager.error.includes("nur Mitarbeitende"), "a manager cannot delete a manager, even with the right on that person");
  const selfRefused = await remove(admin, users.admin.memberId, 400);
  check(selfRefused.error.includes("eigene Konto"), "administrators cannot delete their own account");
  check((await admin.request("/api/employees/" + users.admin.memberId)).permissions.delete === false, "profile of the own account offers no delete");
  check((await admin.request("/api/employees/" + main.memberId)).permissions.delete === true && (await mgrDel.session.request("/api/employees/" + watch.memberId)).permissions.delete === true, "profile permissions: administrators and managers with the right may delete");
  check((await mgrDel.session.request("/api/employees/" + mgrTarget.memberId)).permissions.delete === false && (await mgrNo.session.request("/api/employees/" + main.memberId)).permissions.delete === false, "profile permissions: no delete for a manager target or without the right");
  check((await admin.request("/api/employees?status=all")).members.some((m: any) => m.id === main.memberId && m.isActive), "nothing was deleted by the refused requests");

  // --- Daten der Person ---------------------------------------------------------------
  const dPast = addDate(today, -40), dF1 = addDate(today, 12), dF2 = addDate(today, 13), dO1 = addDate(today, 14), dP1 = addDate(today, 15), dFF = addDate(today, 16), dO2 = addDate(today, 17), dDraft = addDate(today, 60);
  const past = await plan.shift(dPast, "08:00", "16:00", 1, { pauseOption: "PER_SHIFT", pauseValue: 30 });
  const f1 = await plan.shift(dF1, "08:00", "16:00", 2), f2 = await plan.shift(dF2, "08:00", "16:00", 1), o1 = await plan.shift(dO1, "08:00", "16:00");
  const p1 = await plan.shift(dP1, "08:00", "16:00"), ff = await plan.shift(dFF, "08:00", "16:00"), o2 = await plan.shift(dO2, "08:00", "16:00");
  const draft = await plan.shift(dDraft, "08:00", "12:00");
  await plan.book(past.id, main.id); await plan.book(f1.id, main.id); await plan.book(f2.id, main.id); await plan.book(draft.id, main.id);
  await plan.book(p1.id, partner.id); await plan.book(ff.id, fault.id);
  for (const d of [dPast, dF1, dF2, dO1, dP1, dFF, dO2]) await plan.publish(d);
  check(!(await plan.view(draft.id, dDraft)).isPublic, "setup: the far-future plan stays a draft");

  // Zeiten und Korrekturen im Vormonat+: gleicher Tag -> gleicher Auswertungsmonat.
  const rec = async (userId: string, body: Record<string, unknown>) => (await admin.request("/api/time", "POST", { userId, date: dPast, ...body }, 201)).record;
  const rec1 = await rec(main.id, { type: "MANUAL", timeFrom: "08:00", timeTo: "16:00", breakMinutes: 30 });
  const rec2 = await rec(main.id, { type: "MANUAL", timeFrom: "17:00", timeTo: "19:00" });
  await rec(main.id, { type: "MANUAL_DURATION", durationHours: 1, durationMinutes: 30 });
  await rec(fault.id, { type: "MANUAL", timeFrom: "08:00", timeTo: "12:00" });
  const approved = (await main.session.request("/api/time/" + rec1.id, "PATCH", { timeTo: "17:00", breakMinutes: 30, reason: "Arbeitsende falsch erfasst" })).correction;
  await admin.request("/api/time/corrections", "PATCH", { id: approved.id, status: "APPROVED" });
  await main.session.request("/api/time/" + rec2.id, "PATCH", { timeTo: "20:00", reason: "Später gegangen" });
  await main.session.request("/api/absences", "POST", { userId: main.id, categoryId: t.categoryId, dateFrom: addDate(today, 30), dateTo: addDate(today, 31) }, 201);
  await main.session.request("/api/availability", "POST", { date: addDate(today, 32), timeFrom: "08:00", timeTo: "16:00", available: false });
  await admin.request("/api/employees/" + main.memberId + "/notes", "POST", { text: "Interne Notiz zu Dora" }, 201);
  await admin.request("/api/messages", "POST", { subject: "Hallo Dora", body: "Bitte melden.", recipientIds: [main.id] }, 201);
  await main.session.request("/api/messages", "POST", { subject: "Frage von Dora", body: "Passt der Dienstplan?", recipientIds: [users.admin.id] }, 201);

  // Antraege: eigene Abgabe mit Freiwilligem, Abgabe der Partnerin mit Dora als Freiwilliger, eigene Uebernahme.
  const r1 = (await main.session.request("/api/mod-requests", "POST", { shiftId: f1.id, kind: "SWAP" })).request;
  await partner.session.request("/api/mod-requests/" + r1.id, "PATCH", { volunteer: true });
  const r2 = (await partner.session.request("/api/mod-requests", "POST", { shiftId: p1.id, kind: "SWAP" })).request;
  await main.session.request("/api/mod-requests/" + r2.id, "PATCH", { volunteer: true });
  const r3 = (await main.session.request("/api/mod-requests", "POST", { shiftId: o1.id })).request;
  const rFault = (await fault.session.request("/api/mod-requests", "POST", { shiftId: o2.id })).request;
  check(r1.state === "OPEN" && r2.state === "OPEN" && r3.state === "OPEN" && rFault.state === "OPEN", "setup: open requests of and with the person");

  // --- Sperren: laufende Zeiterfassung, offener Check-in, laufender Einsatz --------------
  await watch.session.request("/api/time/watch", "POST", { action: "START" });
  const watchPreview = await preview(admin, watch.memberId);
  check(watchPreview.blockers.length === 1 && /Willi Stoppuhr läuft noch eine Zeiterfassung \(seit \d\d:\d\d\)\. Bitte zuerst beenden\./.test(watchPreview.blockers[0]), "preview names a running stopwatch with its start time");
  const watchRefused = await remove(admin, watch.memberId, 409);
  check(watchRefused.error.includes("läuft noch eine Zeiterfassung") && watchRefused.blockers.length === 1, "running stopwatch: deletion refused with the reason");
  check((await watch.session.request("/api/time/watch")).running !== null && (await admin.request("/api/employees/" + watch.memberId)).id === watch.memberId, "refused deletion changed nothing (stopwatch still running, member intact)");
  await watch.session.request("/api/time/watch", "POST", { action: "STOP" });

  const rsStart = new Date(Date.now() - 10 * 60000), rsEnd = new Date(Date.now() + 120 * 60000);
  const dRs = berlinDate(rsStart);
  const running = await plan.shift(dRs, berlinTime(rsStart), berlinTime(rsEnd));
  await plan.book(running.id, busy.id);
  await plan.publish(dRs);
  const pending = (await busy.session.request("/api/checkin", "POST", { shiftId: running.id, manual: { failure: "DENIED", reason: "Standortfreigabe im Browser gesperrt" } })).checkin;
  const busyPreview = await preview(admin, busy.memberId);
  check(busyPreview.blockers.some((b: string) => b.includes("offenen Check-in-Antrag vom " + berlinDate(new Date(pending.createdAt)).split("-").reverse().join("."))), "preview names the pending check-in request with its date");
  check(busyPreview.blockers.some((b: string) => b.includes("gerade im Einsatz (Löschtest Objekt Nord, " + berlinTime(rsStart) + "–" + berlinTime(rsEnd) + ")")), "preview names the running assignment with site and times");
  const busyRefused = await remove(admin, busy.memberId, 409);
  check(busyRefused.blockers.length === 2 && busyRefused.error.includes("Check-in-Antrag") && busyRefused.error.includes("im Einsatz"), "pending check-in and running assignment block together, with concrete texts");
  check((await admin.request("/api/employees/" + busy.memberId)).isActive === true && (await busy.session.request("/api/checkin")).shifts.some((s: any) => s.id === running.id && s.checkin?.status === "PENDING"), "refused deletion changed nothing (check-in request still pending)");
  await admin.request("/api/checkin/" + pending.id, "PATCH", { status: "DECLINED", note: "Aufräumen nach dem Test" });

  // --- Atomaritaet: Fehler nach allen Schreibvorgaengen stellt alles wieder her -------------
  const faultPreview = await preview(admin, fault.memberId);
  check(faultPreview.futureAssignments === 1 && faultPreview.historyKept.timeRecords === 1, "setup: fault subject has one future assignment and one time record");
  const reportBefore = (await reportRows(dPast)).find((r) => r.userId === fault.id);
  const failing = await fetch(t.base + "/api/employees/" + fault.memberId, { method: "DELETE", headers: { Cookie: admin.cookie(), "x-test-fault": "employee-delete-after-writes" } });
  check(failing.status === 500, "injected failure after all writes answers with an error");
  check((await admin.request("/api/employees/" + fault.memberId)).userId === fault.id && (await admin.request("/api/employees?status=all")).members.some((m: any) => m.id === fault.memberId), "after the failure the employee still exists");
  check((await plan.view(ff.id, dFF)).bookings.some((b: any) => b.userId === fault.id && !b.former), "after the failure the future assignment is intact");
  check((await fault.session.request("/api/mod-requests")).requests.some((r: any) => r.id === rFault.id && r.state === "OPEN"), "after the failure the open request is still open");
  const rowAfter = (await reportRows(dPast)).find((r) => r.userId === fault.id);
  check(rowAfter && !rowAfter.former && rowAfter.totalMinutes === reportBefore.totalMinutes && !(await reportRows(dPast)).some((r) => r.former && r.lastName === "Fehler"), "after the failure the hours still belong to the person, no snapshot was created");
  await fault.session.request("/api/me");
  const faultDone = await remove(admin, fault.memberId);
  check(faultDone.deleted === true && faultDone.futureAssignmentsRemoved === 1 && faultDone.historyKept.timeRecords === 1, "without the fault header the same deletion succeeds");
  check((await reportRows(dPast)).some((r) => r.former && r.lastName === "Fehler" && r.totalMinutes === reportBefore.totalMinutes), "its hours moved to a former-employee row");

  // --- Verwaltung durch einen Manager mit dem Recht (auch deaktivierte Person) ------------
  const watchPreviewOk = await preview(mgrDel.session, watch.memberId);
  check(watchPreviewOk.name === "Willi Stoppuhr" && watchPreviewOk.role === "EMPLOYEE" && watchPreviewOk.blockers.length === 0 && watchPreviewOk.sharedAccount === false, "manager with the right sees the preview of an assigned employee");
  await admin.request("/api/employees/" + watch.memberId, "PATCH", { isActive: false });
  const managerDone = await remove(mgrDel.session, watch.memberId);
  check(managerDone.deleted === true && managerDone.futureAssignmentsRemoved === 0 && managerDone.historyKept.timeRecords === 1 && managerDone.historyKept.bookings === 0, "manager with the right deletes an assigned, deactivated employee");
  check(!(await admin.request("/api/employees?status=all")).members.some((m: any) => m.id === watch.memberId), "manager deletion removed the member");
  await watch.session.request("/api/me", "GET", undefined, 401);

  // --- Die Hauptperson: Vorschau, Loeschung, Folgen ----------------------------------------
  // Der kurze Einsatz muss beendet sein, sonst sperrt "gerade im Einsatz".
  await waitFor(async () => (await preview(admin, main.memberId)).blockers.length === 0, "the short assignment has ended, nothing blocks the deletion any more", 240000, 2000);
  const mainPreview = await preview(admin, main.memberId);
  check(mainPreview.name === "Dora Löschtest" && mainPreview.role === "EMPLOYEE" && mainPreview.futureAssignments === 3 && mainPreview.sharedAccount === false, "preview: name, role and 3 future assignments (published and draft)");
  check(mainPreview.historyKept.bookings === 2 && mainPreview.historyKept.timeRecords === 4 && mainPreview.historyKept.checkins === 1, "preview: past assignments, time records and check-ins that stay");
  const before = (await reportRows(dPast)).find((r) => r.userId === main.id);
  check(before && before.plannedMinutes === 450 && before.totalMinutes > 0, "report before: planned and actual minutes of the past month");
  const timeBefore = (await admin.request("/api/time?month=" + dPast.slice(0, 7))).employees.find((e: any) => e.userId === main.id);
  const socket = await connect(main.session);
  const noPartnerYet = await admin.request("/api/bookings", "POST", { shiftId: f2.id, userId: partner.id, confirm: true }, 409);
  check(/besetzt/.test(noPartnerYet.error), "before the deletion the single place of the shift is taken");
  const hinfaelligPartner = await inboxCount(partner.session, "Antrag hinfällig"), offenPlaner = await inboxCount(mgrDel.session, "Schichten wieder offen");

  const done = await remove(admin, main.memberId);
  check(done.deleted === true && done.futureAssignmentsRemoved === 3 && done.historyKept.bookings === 2 && done.historyKept.timeRecords === 4 && done.historyKept.checkins === 1, "deletion reports removed future assignments and the history kept");
  await waitFor(() => socket.disconnected, "open real-time connections of the deleted person are closed");
  socket.close();
  check(!(await admin.request("/api/employees?status=all")).members.some((m: any) => m.id === main.memberId), "member is gone from the list in all statuses");
  await admin.request("/api/employees/" + main.memberId, "GET", undefined, 404);
  await main.session.request("/api/me", "GET", undefined, 401);
  check(await loginRefused(t, main.email), "the deleted account can no longer sign in");

  // Plan: kuenftige Plaetze wieder offen und neu besetzbar, Vergangenheit mit Namen aus der Momentaufnahme.
  const f2After = await plan.view(f2.id, dF2);
  check(f2After.bookings.length === 0 && f2After.missing === 1, "future shift shows the place open again");
  await admin.request("/api/bookings", "POST", { shiftId: f2.id, userId: partner.id, confirm: true });
  check((await plan.view(f2.id, dF2)).bookings.some((b: any) => b.userId === partner.id), "another person can be assigned to the freed place");
  check((await plan.view(f1.id, dF1)).bookings.length === 0 && (await plan.view(draft.id, dDraft)).bookings.length === 0, "published and draft future assignments are gone, the shifts stay");
  const pastBooking = (await plan.view(past.id, dPast)).bookings.find((b: any) => b.former);
  check(pastBooking && pastBooking.userId === null && pastBooking.user.firstName === "Dora" && pastBooking.user.lastName === "Löschtest" && pastBooking.personKey.startsWith("former:"), "past assignment shows the name from the snapshot");

  // Auswertung: gleiche Plan- und Iststunden, jetzt als Zeile einer geloeschten Person.
  const rows = await reportRows(dPast);
  const formerRow = rows.find((r) => r.former && r.lastName === "Löschtest");
  check(formerRow && formerRow.userId === null && formerRow.key.startsWith("former:") && formerRow.firstName === "Dora", "report has a row for the deleted person from the snapshot");
  check(formerRow.plannedMinutes === before.plannedMinutes && formerRow.totalMinutes === before.totalMinutes && formerRow.shiftCount === before.shiftCount && formerRow.targetMinutes === null, "planned and actual hours are identical before and after, without target hours");
  check(new Set(rows.map((r) => r.key)).size === rows.length, "all report rows have unique keys");
  check(!(await mgrDel.session.request(month(dPast))).employees.some((r: any) => r.former), "managers do not get rows of deleted people");
  const csv = await admin.request("/api/reporting/export?month=" + Number(dPast.slice(5, 7)) + "&year=" + dPast.slice(0, 4));
  check(csv.includes('"Löschtest";"Dora (gelöscht)"'), "CSV export lists the deleted person with a note");
  const timeAfter = (await admin.request("/api/time?month=" + dPast.slice(0, 7))).employees.find((e: any) => e.former && e.lastName === "Löschtest");
  check(timeAfter && timeAfter.records.length === timeBefore.records.length && Math.abs(timeAfter.totalHours - timeBefore.totalHours) < 1e-9, "time list keeps all records and hours as a former-employee group");
  const corrections = (await admin.request("/api/time/corrections")).corrections.filter((c: any) => c.record.user?.lastName === "Löschtest");
  check(corrections.length === 1 && corrections[0].status === "APPROVED", "pending correction was deleted, the decided one stays as proof");
  check((await admin.request("/api/checkin?view=team&date=" + berlinDate(new Date(quickIn.checkin.createdAt)))).checkins.some((c: any) => c.id === quickIn.checkin.id && c.user?.former === true), "check-in history stays, shown by the snapshot name");

  // Antraege und Nachrichten
  const requestsOfPartner = (await partner.session.request("/api/mod-requests")).requests;
  const r2After = requestsOfPartner.find((q: any) => q.id === r2.id);
  check(r2After?.state === "DECLINED" && r2After.decision?.note === "Die beteiligte Person wurde gelöscht.", "request with the deleted person as volunteer is declined with a reason");
  check(!requestsOfPartner.some((q: any) => q.id === r1.id) && !(await admin.request("/api/mod-requests")).requests.some((q: any) => [r1.id, r3.id].includes(q.id)), "requests of the deleted person are gone");
  await partner.session.request("/api/mod-requests/" + r1.id, "DELETE", undefined, 404);
  check(await inboxCount(partner.session, "Antrag hinfällig") === hinfaelligPartner + 1, "the other party of both requests gets exactly one message");
  const planners = (await mgrDel.session.request("/api/messages?folder=inbox")).messages.filter((m: any) => m.subject === "Schichten wieder offen");
  check(await inboxCount(mgrDel.session, "Schichten wieder offen") === offenPlaner + 1 && planners[0].body.includes("2 Schichten am Standort Löschtest Objekt Nord") && planners[0].body.includes("Dora Löschtest"), "planner of the site gets one summary of the two published shifts that are open again");
  const sent = (await admin.request("/api/messages?folder=inbox")).messages.find((m: any) => m.subject === "Frage von Dora");
  check(sent && sent.sender === null, "message of the deleted person stays, without sender");
  check(!(await admin.request("/api/messages?folder=sent")).messages.some((m: any) => m.recipients.some((r: any) => r.userId === main.id)), "recipient entries of the deleted person are gone");
  check((await admin.request("/api/shifts/" + f1.id + "/candidates")).candidates.every((c: any) => c.userId !== main.id), "the deleted person is not offered for planning");
  console.log("EMPLOYEE DELETE (main organization): " + t.counter() + " checks so far.");

  // --- Geteiltes Konto und Sonderfaelle in eigenen Organisationen ----------------------------
  const aAdmin = await login(users.shareAdminA.email), bAdmin = await login(users.shareAdminB.email), sharer = await login(users.sharedA.email);
  await remove(aAdmin, users.shareOwnerA.memberId, 400);
  check((await aAdmin.request("/api/employees?status=all")).members.some((m: any) => m.id === users.shareOwnerA.memberId), "the owner cannot be deleted");
  await remove(aAdmin, users.shareAdminB.memberId, 404);
  const setup = async (admin2: Sess, label: string, hours: number) => {
    const c = (await admin2.request("/api/customers", "POST", { name: label + " Kunde" })).customer;
    const b = (await admin2.request("/api/branches", "POST", { customerId: c.id, name: label + " Objekt" })).branch;
    const p = planner(admin2, b.id);
    // 40 Tage zurueck: sicher ein anderer Auswertungsmonat als die kuenftige Schicht.
    const dPastShared = addDate(today, -40), dFuture = addDate(today, 10);
    const pastShift = await p.shift(dPastShared, "08:00", "12:00"), futureShift = await p.shift(dFuture, "08:00", "12:00");
    await p.book(pastShift.id, users.sharedA.id); await p.book(futureShift.id, users.sharedA.id);
    await p.publish(dPastShared); await p.publish(dFuture);
    await admin2.request("/api/time", "POST", { type: "MANUAL", userId: users.sharedA.id, date: dPastShared, timeFrom: "08:00", timeTo: String(8 + hours).padStart(2, "0") + ":00" }, 201);
    return { p, b, pastShift, futureShift, dPastShared, dFuture };
  };
  const A = await setup(aAdmin, "Teil A", 4), B = await setup(bAdmin, "Teil B", 3);
  const meBefore = await sharer.request("/api/me");
  check(meBefore.organizationName === "Teilkonto A", "setup: the shared account works in the organization it joined first");
  const bBefore = (await bAdmin.request(month(A.dPastShared))).employees.find((r: any) => r.userId === users.sharedA.id);
  const aBefore = (await aAdmin.request(month(A.dPastShared))).employees.find((r: any) => r.userId === users.sharedA.id);
  const sharedPreview = await preview(aAdmin, users.sharedA.memberId);
  check(sharedPreview.sharedAccount === true && sharedPreview.futureAssignments === 1 && sharedPreview.historyKept.bookings === 1 && sharedPreview.historyKept.timeRecords === 1, "preview of a shared account flags it");
  const sharedDone = await remove(aAdmin, users.sharedA.memberId);
  check(sharedDone.deleted === true && sharedDone.futureAssignmentsRemoved === 1, "organization A deletes the shared account's membership");
  const meAfter = await sharer.request("/api/me");
  check(meAfter.organizationName === "Teilkonto B" && meAfter.user.id === users.sharedA.id, "the account keeps working in the other organization with the old session");
  await new t.Session().login(users.sharedA.email);
  check(!(await aAdmin.request("/api/employees?status=all")).members.some((m: any) => m.id === users.sharedA.memberId), "organization A no longer lists the person");
  const aPast = await A.p.view(A.pastShift.id, A.dPastShared), aFuture = await A.p.view(A.futureShift.id, A.dFuture);
  check(aPast.bookings[0].former === true && aPast.bookings[0].user.lastName === "Geteilt" && aFuture.bookings.length === 0, "organization A: past assignment by snapshot name, future place open");
  const aFormer = (await aAdmin.request(month(A.dPastShared))).employees.find((r: any) => r.former && r.lastName === "Geteilt");
  check(aFormer && aFormer.plannedMinutes === aBefore.plannedMinutes && aFormer.totalMinutes === aBefore.totalMinutes && aFormer.totalMinutes > 0, "organization A: hours unchanged as a former-employee row");
  check((await bAdmin.request("/api/employees?status=all")).members.some((m: any) => m.id === users.sharedB.memberId && m.isActive), "organization B still lists the person");
  const bPast = await B.p.view(B.pastShift.id, B.dPastShared), bFuture = await B.p.view(B.futureShift.id, B.dFuture);
  check(bPast.bookings[0].userId === users.sharedA.id && !bPast.bookings[0].former && bFuture.bookings[0].userId === users.sharedA.id, "organization B: assignments untouched, still bound to the account");
  const bAfter = (await bAdmin.request(month(A.dPastShared))).employees.find((r: any) => r.userId === users.sharedA.id);
  check(bAfter && !bAfter.former && bAfter.plannedMinutes === bBefore.plannedMinutes && bAfter.totalMinutes === bBefore.totalMinutes, "organization B: hours unchanged and still on the account");
  check(!(await bAdmin.request("/api/reporting?month=" + Number(A.dPastShared.slice(5, 7)) + "&year=" + A.dPastShared.slice(0, 4))).employees.some((r: any) => r.former), "organization B has no former-employee rows");
  const weekA = isoWeek(A.dFuture);
  await sharer.request("/api/schedules?kw=" + weekA.weekNumber + "&year=" + weekA.year + "&standort=" + A.b.id, "GET", undefined, 404);
  console.log("EMPLOYEE DELETE: " + t.counter() + " checks so far.");
}

