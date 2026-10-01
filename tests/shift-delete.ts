/*
 * Schicht loeschen: nur vor Beginn, ohne Check-in und ohne erfasste Zeiten -
 * auch fuer die Administration. Erlaubtes Loeschen schliesst alle offenen
 * Antraege (eigene Schicht und Gegen-Schicht eines Tauschs) und informiert
 * jede Person einmal. Geprueft ueber die echte API (gleicher Server wie
 * tests/workflows.ts). Eigene Personen, Standort und Schichten.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { addDate, berlinDate, berlinTime } from "../src/lib/berlin";
import type { TestContext } from "./permissions";
import { inboxCount, newPerson, planner } from "./people";

export async function shiftDeleteTests(t: TestContext) {
  const { users, check } = t;
  const login = async (email: string) => { const s = new t.Session(); await s.login(email); return s; };
  const admin = await login(users.admin.email), loner = await login(users.loner.email), foreign = await login(users.foreign.email);

  // --- Struktur -----------------------------------------------------------------
  const site = { latitude: 50.7374, longitude: 7.0982 };
  const customer = (await admin.request("/api/customers", "POST", { name: "Schichtlöschung Kunde" })).customer;
  const branch = (await admin.request("/api/branches", "POST", { customerId: customer.id, name: "Schichtlöschung Objekt" })).branch;
  await admin.request("/api/branches", "PATCH", { id: branch.id, ...site, checkinRadiusM: 50 });
  const mgr = await newPerson(t, admin, "sl.mgr", "Mia", "Planerin", "MANAGER");
  await admin.request("/api/employees/" + mgr.memberId + "/access", "PUT", { kind: "branch", branchId: branch.id, rights: ["EDIT_SHIFTS", "HANDLE_REQUESTS"] });
  const a = await newPerson(t, admin, "sl.a", "Anton", "Auslöser", "EMPLOYEE", [branch.id]);
  const b = await newPerson(t, admin, "sl.b", "Berta", "Tausch", "EMPLOYEE", [branch.id]);
  const plan = planner(admin, branch.id);
  const today = berlinDate();
  const d1 = addDate(today, 20), d2 = addDate(today, 21), d3 = addDate(today, 22);
  const deletion = (s: any, id: string) => s.request("/api/shifts/" + id + "/deletion");

  // --- Erlaubtes Loeschen: Uebernahme-Antrag, Zuweisung, Rechte --------------------
  const s1 = await plan.shift(d1, "08:00", "16:00", 2);
  const s2 = await plan.shift(d2, "08:00", "12:00");
  const s3 = await plan.shift(d3, "08:00", "12:00");
  await plan.book(s1.id, a.id); await plan.book(s2.id, b.id); await plan.book(s3.id, a.id);
  for (const d of [d1, d2, d3]) await plan.publish(d);
  const takeover = (await b.session.request("/api/mod-requests", "POST", { shiftId: s1.id })).request;
  const exchange = (await a.session.request("/api/mod-requests", "POST", { shiftId: s3.id, kind: "EXCHANGE", targetShiftId: s2.id, targetUserId: b.id })).request;
  check(takeover.state === "OPEN" && exchange.state === "OPEN", "open takeover and exchange requests exist");

  const preview1 = await deletion(admin, s1.id);
  check(preview1.deletable === true && preview1.reason === null && preview1.assignments === 1 && preview1.openRequests === 1, "preview of a future shift: deletable, 1 assignment, 1 open request");
  check(Object.keys(preview1).sort().join() === "assignments,deletable,openRequests,reason", "preview exposes only deletable, reason, assignments and open requests");
  check((await deletion(mgr.session, s1.id)).deletable === true, "planner with edit right sees the same preview");
  const exPreview = await deletion(admin, s2.id);
  check(exPreview.deletable && exPreview.assignments === 1 && exPreview.openRequests === 1, "an exchange naming the shift as counter shift counts as open request");
  await loner.request("/api/shifts/" + s1.id + "/deletion", "GET", undefined, 404);
  await loner.request("/api/shifts/" + s1.id, "DELETE", undefined, 404);
  await foreign.request("/api/shifts/" + s1.id + "/deletion", "GET", undefined, 404);
  await foreign.request("/api/shifts/" + s1.id, "DELETE", undefined, 404);
  await b.session.request("/api/shifts/" + s1.id + "/deletion", "GET", undefined, 403);
  await b.session.request("/api/shifts/" + s1.id, "DELETE", undefined, 403);
  check(!!(await plan.view(s1.id, d1)), "refused deletions leave the shift in place");

  const abgesagtA = await inboxCount(a.session, "Schicht abgesagt"), hinfaelligB = await inboxCount(b.session, "Antrag hinfällig");
  const done1 = await mgr.session.request("/api/shifts/" + s1.id, "DELETE");
  check(done1.success === true && done1.assignmentsRemoved === 1 && done1.requestsClosed === 1, "planner deletes a future shift: assignment removed, request closed");
  check(!(await plan.view(s1.id, d1)), "deleted shift disappears from the plan");
  await b.session.request("/api/mod-requests/" + takeover.id, "DELETE", undefined, 404);
  check(await inboxCount(a.session, "Schicht abgesagt") === abgesagtA + 1, "booked person is told that the shift was cancelled");
  check(await inboxCount(b.session, "Antrag hinfällig") === hinfaelligB + 1, "requester of the open takeover is told that the request is void");
  await admin.request("/api/shifts/" + s1.id, "DELETE", undefined, 404);

  // Tausch, dessen GEGEN-Schicht geloescht wird: der Antrag darf nicht offen bleiben.
  const abgesagtB = await inboxCount(b.session, "Schicht abgesagt"), hinfaelligA = await inboxCount(a.session, "Antrag hinfällig");
  const done2 = await admin.request("/api/shifts/" + s2.id, "DELETE");
  check(done2.requestsClosed === 1 && done2.assignmentsRemoved === 1, "admin deletes the counter shift of an exchange");
  const closed = (await a.session.request("/api/mod-requests")).requests.find((r: any) => r.id === exchange.id);
  check(closed?.state === "DECLINED" && closed.decision?.note === "Schicht wurde abgesagt.", "exchange naming the deleted shift is declined with a reason, not left open");
  check(await inboxCount(a.session, "Antrag hinfällig") === hinfaelligA + 1, "exchange requester is informed once");
  check(await inboxCount(b.session, "Schicht abgesagt") === abgesagtB + 1 && await inboxCount(b.session, "Antrag hinfällig") === hinfaelligB + 1, "booked partner gets the cancellation only, not a second message about the request");
  check(await inboxCount(a.session, "Schicht abgesagt") === abgesagtA + 1, "the other shift of the requester is untouched");
  check(!!(await plan.view(s3.id, d3)), "own shift of the exchange requester stays");

  // Unveroeffentlichter Plan: Zuweisung entfaellt, ohne Nachricht an die Person (wie bisher).
  const dDraft = addDate(today, 50);
  const draft = await plan.shift(dDraft, "09:00", "13:00");
  await plan.book(draft.id, a.id);
  const draftBefore = await inboxCount(a.session, "Schicht abgesagt");
  const done3 = await admin.request("/api/shifts/" + draft.id, "DELETE");
  check(done3.assignmentsRemoved === 1 && await inboxCount(a.session, "Schicht abgesagt") === draftBefore, "draft plan: booking removed without a notification");

  // --- Gesperrt: vergangen, laufend, Check-in, erfasste Zeiten -----------------------
  const month = (day: string) => "/api/reporting?month=" + Number(day.slice(5, 7)) + "&year=" + day.slice(0, 4);
  const rowOf = async (day: string, userId: string) => (await admin.request(month(day))).employees.find((e: any) => e.userId === userId);

  // Vergangene Schicht mit erfasster Zeit: Plan- und Iststunden bleiben unveraendert.
  const dPast = addDate(today, -9);
  const past = await plan.shift(dPast, "08:00", "16:00", 1, { pauseOption: "PER_SHIFT", pauseValue: 30 });
  await plan.book(past.id, a.id);
  await plan.publish(dPast);
  await admin.request("/api/time", "POST", { type: "MANUAL", userId: a.id, date: dPast, timeFrom: "08:00", timeTo: "16:00", breakMinutes: 30 }, 201);
  const before = await rowOf(dPast, a.id);
  check(before.plannedMinutes >= 450 && before.totalMinutes === 450, "report before: the past shift counts as planned and the entry as actual minutes");
  const pastPreview = await deletion(admin, past.id);
  check(pastPreview.deletable === false && pastPreview.reason.includes("begonnen oder ist vorbei") && pastPreview.assignments === 1, "past shift: preview names the cause");
  const refused = await admin.request("/api/shifts/" + past.id, "DELETE", undefined, 409);
  check(refused.error === pastPreview.reason, "past shift: administrators get the same refusal with the reason");
  await mgr.session.request("/api/shifts/" + past.id, "DELETE", undefined, 409);
  const after = await rowOf(dPast, a.id);
  check(after.plannedMinutes === before.plannedMinutes && after.totalMinutes === before.totalMinutes, "report planned and actual hours unchanged after the refused deletion");
  check((await plan.view(past.id, dPast))?.bookings.length === 1, "past shift keeps its assignment");

  // Laufende Schicht mit Check-in und Zeiterfassung.
  const startAt = new Date(Date.now() - 10 * 60000), endAt = new Date(Date.now() + 120 * 60000);
  const dRun = berlinDate(startAt);
  const running = await plan.shift(dRun, berlinTime(startAt), berlinTime(endAt));
  await plan.book(running.id, b.id);
  await plan.publish(dRun);
  const gps = (shiftId: string) => ({ shiftId, position: { ...site, accuracy: 10, timestamp: Date.now() - 2000 } });
  const checkedB = await b.session.request("/api/checkin", "POST", gps(running.id));
  check(checkedB.checkin.status === "CONFIRMED" && checkedB.checkin.timeRecordId, "check-in on the running shift created a time record");
  const runningRefusal = await admin.request("/api/shifts/" + running.id, "DELETE", undefined, 409);
  check(runningRefusal.error.includes("begonnen"), "running shift with check-in and time cannot be deleted, not even by administrators");

  // Noch nicht begonnen, aber bereits eingecheckt (Fenster oeffnet 30 Minuten vorher).
  const soonAt = new Date(Date.now() + 15 * 60000), soonEnd = new Date(Date.now() + 180 * 60000);
  const dSoon = berlinDate(soonAt);
  const soon = await plan.shift(dSoon, berlinTime(soonAt), berlinTime(soonEnd));
  await plan.book(soon.id, a.id);
  await plan.publish(dSoon);
  await a.session.request("/api/checkin", "POST", gps(soon.id));
  const soonPreview = await deletion(admin, soon.id);
  check(soonPreview.deletable === false && soonPreview.reason === "Für diese Schicht gibt es bereits einen Check-in.", "not yet started but checked in: refused with the check-in reason");
  await admin.request("/api/shifts/" + soon.id, "DELETE", undefined, 409);
  await mgr.session.request("/api/shifts/" + soon.id, "DELETE", undefined, 409);
  check((await plan.view(soon.id, dSoon))?.bookings.length === 1, "checked-in shift keeps its assignment");

  // Zeiten erfasst, die sich mit der kuenftigen Schicht ueberschneiden.
  const dTime = addDate(today, 23);
  const timed = await plan.shift(dTime, "10:00", "14:00");
  await plan.book(timed.id, b.id);
  await plan.publish(dTime);
  check((await deletion(admin, timed.id)).deletable === true, "future shift without time records is deletable");
  await admin.request("/api/time", "POST", { type: "MANUAL", userId: b.id, date: dTime, timeFrom: "11:00", timeTo: "12:00" }, 201);
  const timePreview = await deletion(admin, timed.id);
  check(timePreview.deletable === false && timePreview.reason === "Für diese Schicht wurden bereits Arbeitszeiten erfasst.", "overlapping time record of a booked person blocks the deletion");
  await admin.request("/api/shifts/" + timed.id, "DELETE", undefined, 409);
  check(!!(await plan.view(timed.id, dTime)), "shift with time records stays");

  // Aufraeumen: laufende Zeiterfassungen beenden.
  await a.session.request("/api/time/watch", "POST", { action: "STOP" });
  await b.session.request("/api/time/watch", "POST", { action: "STOP" });
  console.log("SHIFT DELETE: " + t.counter() + " checks so far.");
}
