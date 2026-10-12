/*
 * Stunden pruefen und genehmigen (P2) ueber die echte API: Schichtbezug,
 * Status je Schicht (offen, genehmigt, nicht erfasst), Rechte der Pruefenden,
 * direkte Aenderung mit Verlauf, Nachtragen, automatische Genehmigung,
 * laufende Stoppuhr, Organisationsgrenzen. Teil von tests/workflows.ts.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { TestContext } from "./permissions";

export async function hoursTests(t: TestContext) {
  const { users, check } = t;
  const session = async (email: string) => { const s = new t.Session(); await s.login(email); return s; };
  const admin = await session(users.admin.email), mB = await session(users.managerB.email), sB = await session(users.staffB.email);
  const loner = await session(users.loner.email), foreign = await session(users.foreign.email);
  const period = "from=2025-09-08&to=2025-09-14";
  const person = async (s: typeof admin, userId = users.staffB.id) => (await s.request("/api/hours?" + period)).people.find((p: any) => p.userId === userId);

  // --- Plan: Mo und Di 08:00-16:00 mit 30 Min. Pause, KW 37/2025 ------------------
  const customer = (await admin.request("/api/customers", "POST", { name: "Kunde Stunden" })).customer;
  const branch = (await admin.request("/api/branches", "POST", { customerId: customer.id, name: "Objekt Stunden" })).branch;
  await admin.request("/api/employees/" + users.staffB.memberId + "/access", "PUT", { kind: "branch", branchId: branch.id, rights: ["REQUEST_SHIFTS"] });
  const plan = (await admin.request("/api/schedules?kw=37&year=2025&standort=" + branch.id)).schedule;
  const shift = (day: number) => admin.request("/api/shifts", "POST", { scheduleId: plan.id, dayOfWeek: day, shiftFrom: "08:00", shiftTo: "16:00", maxEmployees: 1, pauseOption: "PER_SHIFT", pauseValue: 30, title: "Empfang" }).then((r: any) => r.shifts[0]);
  const monday = await shift(1), tuesday = await shift(2);
  for (const s of [monday, tuesday]) await admin.request("/api/bookings", "POST", { shiftId: s.id, userId: users.staffB.id, confirm: true });
  await admin.request("/api/schedules/" + plan.id, "PATCH", { isPublic: true });

  // --- Eigene Erfassung: offen und der Schicht zugeordnet ------------------------
  const own = (await sB.request("/api/time", "POST", { type: "MANUAL", userId: users.staffB.id, date: "2025-09-08", timeFrom: "08:05", timeTo: "16:10", breakMinutes: 30 }, 201)).record;
  check(own.shiftId === monday.id && own.approvedAt === null && own.branchId === branch.id, "own entry is linked to the overlapping shift and still open");
  let rows = (await person(admin)).rows;
  const mon = rows.find((r: any) => r.shift?.id === monday.id), tue = rows.find((r: any) => r.shift?.id === tuesday.id);
  check(mon.status === "OPEN" && mon.plannedMinutes === 450 && mon.istMinutes === 455 && mon.deviationMinutes === 5, "Monday: plan 7,5 h, actual 7,58 h, open, +5 minutes");
  check(tue.status === "MISSING" && tue.records.length === 0 && tue.canEnter === true, "Tuesday: planned in the past without time is shown as not recorded");
  await sB.request("/api/time/approve", "POST", { ids: [own.id] }, 403);
  check((await person(sB)).rows.find((r: any) => r.shift?.id === monday.id).records[0].canApprove === false, "employees see their own hours but cannot approve them");

  // --- Manager ohne Rechte sieht nichts, mit Rechten prueft er ------------------------
  check(!(await person(mB)), "manager without rights does not see the person's hours");
  await mB.request("/api/time/approve", "POST", { ids: [own.id] }, 404);
  const accessPath = "/api/employees/" + users.managerB.memberId + "/access";
  await admin.request(accessPath, "PUT", { kind: "branch", branchId: branch.id, rights: ["VIEW_TIME", "EDIT_TIME"] });
  await admin.request(accessPath, "PUT", { kind: "staff", memberId: users.staffB.memberId, rights: ["VIEW_HOURS"] });
  const managed = await mB.request("/api/hours?" + period);
  const seen = managed.people.find((p: any) => p.userId === users.staffB.id);
  check(managed.showPay === false && seen.totalCents === null && seen.approvable.includes(own.id), "manager with time rights sees the hours without pay data");
  await mB.request("/api/time/approve", "POST", { ids: [own.id] });
  check((await person(admin)).rows.find((r: any) => r.shift?.id === monday.id).status === "APPROVED", "approved by the responsible manager");
  await mB.request("/api/time/approve", "POST", { ids: [own.id], approved: false });
  check((await person(admin)).rows.find((r: any) => r.shift?.id === monday.id).status === "OPEN", "approval can be taken back");

  // --- Direkte Aenderung durch Pruefende: sofort wirksam und im Verlauf ---------------
  const direct = await mB.request("/api/time/" + own.id, "PATCH", { timeTo: "16:00", reason: "Ende laut Übergabebuch" });
  check(direct.pending === false && direct.record.timeTo === "16:00" && direct.record.approvedAt && direct.correction.status === "APPROVED", "reviewer edits apply at once, count as approved and are logged");
  const log = (await admin.request("/api/time/corrections")).corrections.find((c: any) => c.id === direct.correction.id);
  check(log && log.before.timeTo === "16:10" && log.proposed.timeTo === "16:00", "the previous values stay in the correction history");
  const request = await sB.request("/api/time/" + own.id, "PATCH", { timeTo: "16:20", reason: "Doch länger geblieben" });
  check(request.pending === true && request.record.timeTo === "16:00", "the employee still only requests a correction");

  // --- Nachtragen wie geplant ---------------------------------------------------------
  const entered = (await mB.request("/api/time", "POST", { type: "MANUAL", userId: users.staffB.id, date: "2025-09-09", timeFrom: "08:00", timeTo: "16:00", breakMinutes: 30 }, 201)).record;
  check(entered.shiftId === tuesday.id && entered.approvedAt !== null, "time entered by a reviewer for someone else is linked and approved");
  check((await person(admin)).rows.find((r: any) => r.shift?.id === tuesday.id).status === "APPROVED", "Tuesday is now recorded and approved");

  // --- Automatische Genehmigung -------------------------------------------------------
  await admin.request("/api/settings", "PATCH", { timeSettings: { autoApprove: true } });
  const auto = (await sB.request("/api/time", "POST", { type: "MANUAL", userId: users.staffB.id, date: "2025-09-12", timeFrom: "10:00", timeTo: "12:00" }, 201)).record;
  check(auto.approvedAt !== null && auto.approvedById === null && auto.shiftId === null, "with auto-approval own entries are approved; no shift, no link");
  await admin.request("/api/settings", "PATCH", { timeSettings: { autoApprove: false } });
  const loose = (await person(admin)).rows.find((r: any) => r.records[0]?.id === auto.id);
  check(loose && loose.shift === null && loose.status === "APPROVED", "entries without a shift appear as their own row");
  check((await admin.request("/api/hours?" + period)).showPay === true && (await person(admin)).rows.find((r: any) => r.shift?.id === monday.id).records[0].pay !== null, "administration sees pay per record");

  // --- Laufende Stoppuhr ---------------------------------------------------------------
  if ((await loner.request("/api/time/watch")).running) await loner.request("/api/time/watch", "POST", { action: "STOP" });
  const running = (await loner.request("/api/time/watch", "POST", { action: "START" })).record;
  await admin.request("/api/time/approve", "POST", { ids: [running.id] }, 409);
  const stopped = (await loner.request("/api/time/watch", "POST", { action: "STOP" })).record;
  check(stopped.approvedAt === null, "a stopped stopwatch is open for review");
  await admin.request("/api/time/approve", "POST", { ids: [stopped.id] });

  // --- Organisationsgrenzen -----------------------------------------------------------
  check(!(await foreign.request("/api/hours?" + period)).people.some((p: any) => p.userId === users.staffB.id), "foreign administration does not see the hours");
  await foreign.request("/api/time/approve", "POST", { ids: [own.id] }, 404);
  await admin.request("/api/hours?" + period + "&standort=" + branch.id);
  await mB.request("/api/hours?from=2025-09-14&to=2025-09-08", "GET", undefined, 400);
}
