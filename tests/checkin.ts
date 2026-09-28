/*
 * GPS-Check-in am Einsatzort mit manueller Freigabe und Start der
 * Zeiterfassung - geprueft ueber die echte API. Teil von tests/workflows.ts
 * (gleicher Server, gleiche In-Memory-Datenbank). Eigene Struktur: Kunde,
 * Standort mit Koordinaten und Check-in-Pflicht, eine Schicht, die "jetzt"
 * laeuft (Beginn vor 10 Minuten, Ende in 2 Stunden, notfalls ueber Mitternacht).
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { berlinDate, berlinTime, isoWeek } from "../src/lib/berlin";
import type { TestContext } from "./permissions";

export async function checkinTests(t: TestContext) {
  const { users, check } = t;
  const session = async (name: string) => { const s = new t.Session(); await s.login(users[name].email); return s; };
  const admin = await session("admin"), sA = await session("staffA"), sB = await session("staffB"), mA = await session("managerA"), mB = await session("managerB");
  const loner = await session("loner"), foreign = await session("foreign");

  // --- Struktur -----------------------------------------------------------------
  const site = { latitude: 50.7374, longitude: 7.0982 };
  const customer = (await admin.request("/api/customers", "POST", { name: "Kunde Check-in" })).customer;
  const branch = (await admin.request("/api/branches", "POST", { customerId: customer.id, name: "Objekt Check-in" })).branch;
  await admin.request("/api/branches", "PATCH", { id: branch.id, ...site, checkinRadiusM: 50, gpsCheckinRequired: true });
  await admin.request("/api/employees/" + users.staffA.memberId + "/access", "PUT", { kind: "branch", branchId: branch.id, rights: ["REQUEST_SHIFTS"] });
  await admin.request("/api/employees/" + users.staffB.memberId + "/access", "PUT", { kind: "branch", branchId: branch.id, rights: ["REQUEST_SHIFTS"] });
  const accessPath = "/api/employees/" + users.managerA.memberId + "/access";
  const previousStaff: string[] = (await admin.request(accessPath)).staff.find((s: any) => s.memberId === users.staffA.memberId)?.rights ?? [];
  // Manager A darf hier Zeiten ansehen (nicht bearbeiten) und hat "Stunden einsehen" nur fuer staffA.
  await admin.request(accessPath, "PUT", { kind: "branch", branchId: branch.id, rights: ["VIEW_TIME"] });
  await admin.request(accessPath, "PUT", { kind: "staff", memberId: users.staffA.memberId, rights: ["VIEW_HOURS"] });

  const startAt = new Date(Date.now() - 10 * 60000), endAt = new Date(Date.now() + 120 * 60000);
  const date = berlinDate(startAt), week = isoWeek(date), dow = ((new Date(date + "T12:00:00Z").getUTCDay() + 6) % 7) + 1;
  const plan = (await admin.request("/api/schedules?kw=" + week.weekNumber + "&year=" + week.year + "&standort=" + branch.id)).schedule;
  const shift = (await admin.request("/api/shifts", "POST", { scheduleId: plan.id, dayOfWeek: dow, shiftFrom: berlinTime(startAt), shiftTo: berlinTime(endAt), maxEmployees: 3, title: "Check-in" })).shifts[0];
  await admin.request("/api/bookings", "POST", { shiftId: shift.id, userId: users.staffA.id, confirm: true });
  await admin.request("/api/bookings", "POST", { shiftId: shift.id, userId: users.staffB.id, confirm: true });
  await sA.request("/api/checkin", "POST", { shiftId: shift.id, position: { ...site, accuracy: 10, timestamp: Date.now() } }, 404);
  await admin.request("/api/schedules/" + plan.id, "PATCH", { isPublic: true });

  const at = (dLat: number, accuracy = 10, ageMs = 2000) => ({ latitude: site.latitude + dLat, longitude: site.longitude, accuracy, timestamp: Date.now() - ageMs });
  const gps = (s: typeof sA, position: unknown, expected = 200) => s.request("/api/checkin", "POST", { shiftId: shift.id, position }, expected);

  // --- Vor dem Check-in -----------------------------------------------------------
  const before = await sA.request("/api/checkin");
  const listed = before.shifts.find((s: any) => s.id === shift.id);
  check(listed && listed.window.open && listed.branch.gpsCheckinRequired && listed.branch.hasCoordinates && listed.checkin === null && before.running === null, "own shift listed with open window, check-in duty and no check-in yet");
  check(!JSON.stringify(before).includes("50.7374"), "site coordinates are not sent to the employee");
  const blocked = await sA.request("/api/time/watch", "POST", { action: "START" }, 409);
  check(blocked.error.includes("Check-in"), "time tracking cannot start before the check-in");

  // --- Fehlschlaege speichern nichts ----------------------------------------------
  const outside = await gps(sA, at(0.0018), 422);
  check(outside.failure === "OUTSIDE" && outside.canRequestManual === true && outside.message.includes("m"), "about 200 m away: 422 OUTSIDE with manual option");
  check((await gps(sA, at(0, 80), 422)).failure === "INACCURATE", "accuracy 80 m: 422 INACCURATE");
  check((await gps(sA, at(0, 10, 10 * 60000), 422)).failure === "STALE", "position 10 min old: 422 STALE");
  check((await gps(sA, at(0, 10, -5 * 60000), 422)).failure === "STALE", "position from the future: 422 STALE");
  check((await sA.request("/api/checkin")).shifts.find((s: any) => s.id === shift.id).checkin === null, "failed attempts store nothing");
  await gps(loner, at(0.0002), 404);
  await gps(foreign, at(0.0002), 404);
  await sA.request("/api/checkin", "POST", { shiftId: shift.id }, 400);

  // --- Erfolgreicher Check-in -----------------------------------------------------
  const ok = await gps(sA, at(0.0002, 12));
  const month = (d: string) => d.slice(0, 7);
  check(ok.checkin.status === "CONFIRMED" && ok.checkin.method === "GPS" && ok.checkin.distanceM >= 20 && ok.checkin.distanceM <= 25 && ok.checkin.accuracyM === 12, "inside the radius: confirmed GPS check-in with rounded distance and accuracy");
  check(ok.checkin.lateMinutes >= 10 && ok.checkin.lateMinutes <= 20, "late minutes counted from shift start (server time)");
  check(!JSON.stringify(ok).includes("50.737"), "no coordinates stored or returned");
  const recordsA = async () => (await admin.request("/api/time?month=" + month(berlinDate()) + "&userId=" + users.staffA.id)).employees.flatMap((e: any) => e.records);
  const runningA = (await recordsA()).filter((r: any) => r.type === "WATCH" && !r.timeTo);
  check(runningA.length === 1 && runningA[0].id === ok.checkin.timeRecordId && runningA[0].branchId === branch.id && runningA[0].startedAt === ok.checkin.createdAt, "exactly one running time record, linked, at the site, started at check-in time");
  await gps(sA, at(0.0002), 409);
  await sA.request("/api/time/watch", "POST", { action: "START" }, 409);
  const ownView = (await sA.request("/api/checkin")).shifts.find((s: any) => s.id === shift.id);
  check(ownView.checkin.status === "CONFIRMED" && ownView.checkin.time === berlinTime(new Date(ok.checkin.createdAt)), "reload shows the check-in with server time");

  // --- Manuelle Freigabe ------------------------------------------------------------
  await sB.request("/api/checkin", "POST", { shiftId: shift.id, manual: { failure: "DENIED", reason: "kurz" } }, 400);
  const pending = (await sB.request("/api/checkin", "POST", { shiftId: shift.id, manual: { failure: "DENIED", reason: "Standortfreigabe im Browser gesperrt" } })).checkin;
  check(pending.status === "PENDING" && pending.method === "MANUAL" && pending.timeRecordId === null && pending.lateMinutes >= 10, "manual request is pending, without time, lateness from server time");
  await sB.request("/api/checkin", "POST", { shiftId: shift.id, manual: { failure: "UNAVAILABLE", reason: "Noch ein zweiter Antrag bitte" } }, 409);
  check((await sB.request("/api/time/watch", "POST", { action: "START" }, 409)).error.includes("Freigabe"), "pending approval blocks the stopwatch with a clear message");
  check((await admin.request("/api/messages")).messages.some((m: any) => m.subject.startsWith("Check-in")), "reviewers are notified of the manual request");
  await sB.request("/api/checkin/" + pending.id, "PATCH", { status: "APPROVED" }, 403);
  await mB.request("/api/checkin/" + pending.id, "PATCH", { status: "APPROVED" }, 404);
  await mA.request("/api/checkin/" + pending.id, "PATCH", { status: "APPROVED" }, 404);
  await foreign.request("/api/checkin/" + pending.id, "PATCH", { status: "APPROVED" }, 404);

  // --- Teamansicht ------------------------------------------------------------------
  const teamA = (await mA.request("/api/checkin?view=team")).checkins;
  const rowA = teamA.find((c: any) => c.id === ok.checkin.id);
  check(rowA && rowA.lateMinutes === ok.checkin.lateMinutes && rowA.distanceM === ok.checkin.distanceM && rowA.canDecide === false && !teamA.some((c: any) => c.user.id === users.staffB.id), "team view: manager sees punctuality of assigned staff only");
  check((await mB.request("/api/checkin?view=team")).checkins.length === 0 && (await sA.request("/api/checkin?view=team")).checkins.length === 0, "team view is empty without time rights");
  const teamAdmin = (await admin.request("/api/checkin?view=team&date=" + berlinDate(new Date(ok.checkin.createdAt)))).checkins;
  check(teamAdmin.find((c: any) => c.id === pending.id)?.canDecide === true && teamAdmin.some((c: any) => c.id === ok.checkin.id), "team view: administration sees all, pending ones decidable");
  await admin.request("/api/checkin?view=team&date=2026-02-30", "GET", undefined, 400);

  // --- Freigabe startet die Zeit ab dem Antrag --------------------------------------
  const approved = (await admin.request("/api/checkin/" + pending.id, "PATCH", { status: "APPROVED", note: "Telefonisch bestätigt" })).checkin;
  check(approved.status === "APPROVED" && approved.reviewedById === users.admin.id && approved.decisionNote === "Telefonisch bestätigt" && approved.timeRecordId, "approval is recorded with reviewer and note");
  await admin.request("/api/checkin/" + pending.id, "PATCH", { status: "DECLINED" }, 409);
  const recordB = (await admin.request("/api/time?month=" + month(berlinDate()) + "&userId=" + users.staffB.id)).employees.flatMap((e: any) => e.records).find((r: any) => r.id === approved.timeRecordId);
  check(recordB && recordB.type === "WATCH" && !recordB.timeTo && recordB.startedAt === pending.createdAt && recordB.branchId === branch.id, "approval starts the stopwatch at the request time");
  check((await sB.request("/api/messages")).messages.some((m: any) => m.subject === "Check-in freigegeben"), "employee is notified of the decision");
  check((await sB.request("/api/checkin")).shifts.find((s: any) => s.id === shift.id).checkin.status === "APPROVED", "employee sees the approval");

  // --- Pause, Fortsetzen, Auschecken behalten den Standort ----------------------------
  await sA.request("/api/time/watch", "POST", { action: "PAUSE" });
  await sA.request("/api/time/watch", "POST", { action: "RESUME" });
  const stopped = (await sA.request("/api/time/watch", "POST", { action: "STOP" })).record;
  check(stopped.id === ok.checkin.timeRecordId && stopped.timeTo && stopped.branchId === branch.id, "check-out keeps the site of the check-in");
  const stoppedB = (await sB.request("/api/time/watch", "POST", { action: "STOP" })).record;
  check(stoppedB.branchId === branch.id, "approved record keeps its site on check-out");
  const restart = (await sA.request("/api/time/watch", "POST", { action: "START" })).record;
  check(restart && (await sA.request("/api/time/watch", "POST", { action: "STOP" })).record.id === restart.id, "after a valid check-in the stopwatch can be restarted");

  // Aufraeumen: Freigaben wie vorher, damit spaetere Teile unberuehrt bleiben.
  await admin.request(accessPath, "PUT", { kind: "staff", memberId: users.staffA.memberId, rights: previousStaff });
  for (const memberId of [users.managerA.memberId, users.staffA.memberId, users.staffB.memberId]) await admin.request("/api/employees/" + memberId + "/access", "PUT", { kind: "branch", branchId: branch.id, rights: [] });

  console.log("CHECKIN: " + t.counter() + " checks so far.");
}
