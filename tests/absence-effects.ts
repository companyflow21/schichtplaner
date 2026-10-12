/*
 * Abwesenheit wirkt auf Schichten, Stunden, Lohn und Zeitkonto (P5) ueber die
 * echte API: Vorschau, Genehmigen mit Vorgabe und Abweichung je Schicht,
 * Offenstellen, Ausgleich, Lohnzeile mit Code, Stundenzettel, Zuruecknehmen,
 * Rechte. Teil von tests/workflows.ts.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { TestContext } from "./permissions";

export async function absenceEffectTests(t: TestContext) {
  const { users, check, categoryId } = t;
  const session = async (email: string) => { const s = new t.Session(); await s.login(email); return s; };
  const admin = await session(users.admin.email), mA = await session(users.managerA.email), mB = await session(users.managerB.email);
  const sA = await session(users.staffA.email), foreign = await session(users.foreign.email);
  const period = "from=2025-11-17&to=2025-11-23";

  // --- Plan: Mo-Mi 17.-19.11.2025, je 08:00-16:00 mit 30 Min. Pause ------------------------
  const customer = (await admin.request("/api/customers", "POST", { name: "Kunde Abwesenheit" })).customer;
  const branch = (await admin.request("/api/branches", "POST", { customerId: customer.id, name: "Objekt Abwesenheit" })).branch;
  await admin.request("/api/employees/" + users.staffA.memberId + "/access", "PUT", { kind: "branch", branchId: branch.id, rights: ["REQUEST_SHIFTS"] });
  const plan = (await admin.request("/api/schedules?kw=47&year=2025&standort=" + branch.id)).schedule;
  const [mon, tue, wed] = await Promise.all([1, 2, 3].map((day) => admin.request("/api/shifts", "POST", { scheduleId: plan.id, dayOfWeek: day, shiftFrom: "08:00", shiftTo: "16:00", maxEmployees: 1, pauseOption: "PER_SHIFT", pauseValue: 30, title: "Empfang" }).then((r: any) => r.shifts[0])));
  for (const s of [mon, tue, wed]) await admin.request("/api/bookings", "POST", { shiftId: s.id, userId: users.staffA.id, confirm: true });
  await admin.request("/api/schedules/" + plan.id, "PATCH", { isPublic: true });
  const normal = (await admin.request("/api/payroll/pay-types", "POST", { title: "Normal A", hourlyRateCents: 1600, code: "101" }, 201)).payType;
  await admin.request("/api/payroll/members/" + users.staffA.memberId, "PATCH", { payTypeId: normal.id });
  await admin.request("/api/absences/categories", "PATCH", { id: categoryId, payCode: "500" });

  // --- Vorschau -----------------------------------------------------------------------
  const preview = await admin.request("/api/absences/effects?userId=" + users.staffA.id + "&from=2025-11-17&to=2025-11-19&categoryId=" + categoryId);
  check(preview.shifts.length === 3 && preview.defaultHandling === "PAID" && preview.shifts.every((s: any) => s.canRelease && s.plannedMinutes === 450), "preview lists the three planned shifts; paid category defaults to counting hours");
  await sA.request("/api/absences/effects?userId=" + users.staffA.id + "&from=2025-11-17&to=2025-11-19&categoryId=" + categoryId, "GET", undefined, 404);
  await mB.request("/api/absences/effects?userId=" + users.staffA.id + "&from=2025-11-17&to=2025-11-19&categoryId=" + categoryId, "GET", undefined, 404);
  await foreign.request("/api/absences/effects?userId=" + users.staffA.id + "&from=2025-11-17&to=2025-11-19&categoryId=" + categoryId, "GET", undefined, 404);

  // --- Genehmigt eintragen: Mo bezahlt, Di 0 Stunden, Mi offen stellen, +2 h Ausgleich ------------
  await admin.request("/api/absences", "POST", { userId: users.staffA.id, categoryId, dateFrom: "2025-11-17", dateTo: "2025-11-19", status: "APPROVED", effects: { default: "PAID", shifts: { nicht: "UNPAID" } } }, 400);
  const absence = (await admin.request("/api/absences", "POST", { userId: users.staffA.id, categoryId, dateFrom: "2025-11-17", dateTo: "2025-11-19", status: "APPROVED", effects: { default: "PAID", shifts: { [tue.id]: "UNPAID", [wed.id]: "RELEASED" }, compensationHours: 2 } }, 201)).absence;
  check(absence.status === "APPROVED" && absence.approvedById === users.admin.id && absence.approvedAt, "approval is stored with approver and time");
  const rows = (await admin.request("/api/hours?" + period)).people.find((p: any) => p.userId === users.staffA.id).rows;
  const row = (shift: { id: string }) => rows.find((r: any) => r.shift?.id === shift.id);
  check(row(mon).status === "ABSENT" && row(mon).absence.handling === "PAID" && row(mon).istMinutes === 450, "Monday: absent, paid with 7,5 planned hours");
  check(row(tue).status === "ABSENT" && row(tue).absence.handling === "UNPAID" && row(tue).istMinutes === 0, "Tuesday: absent, counts 0 hours");
  check(!row(wed) && !(await admin.request("/api/schedules?kw=47&year=2025&standort=" + branch.id)).schedule.shifts.find((s: any) => s.id === wed.id).bookings.length, "Wednesday: the person was taken out, the shift is open again");
  check(row(mon).absence.pay.totalCents === 12000 && row(mon).absence.pay.lines[0].code === "500", "paid absence: 7,5 h x 16,00 € = 120,00 € with the category's payroll code");

  // --- Lohn, Export, Zeitkonto, Stundenzettel -----------------------------------------------
  const pay = (await admin.request("/api/payroll/report?" + period)).people.find((p: any) => p.userId === users.staffA.id);
  check(pay.lines.some((l: any) => l.kind === "ABSENCE" && l.title === "Abwesenheit: Urlaub" && l.minutes === 450 && l.amountCents === 12000), "payroll has an absence line");
  const csv: string = await admin.request("/api/payroll/export?" + period);
  check(csv.includes('"Abwesenheit";"Abwesenheit: Urlaub";"500";"7,50"'), "export row for the paid absence");
  const account = await admin.request("/api/time-accounts?userId=" + users.staffA.id + "&to=2025-11-30");
  check(account.compensations.some((c: any) => c.minutes === 120 && c.date === "2025-11-17" && c.description.includes("Urlaub")), "compensation of +2 h is booked on the first day");
  const sheet = await sA.request("/api/timesheet?" + period);
  check(sheet.rows.some((r: any) => r.date === "2025-11-17" && r.status === "abwesend: Urlaub (bezahlt)" && r.minutes === 450), "own timesheet shows the paid absence");

  // --- Zuruecknehmen und erneut genehmigen ------------------------------------------------------
  await admin.request("/api/absences/" + absence.id, "PATCH", { status: "PENDING" });
  const pendingRows = (await admin.request("/api/hours?" + period)).people.find((p: any) => p.userId === users.staffA.id).rows;
  check(pendingRows.find((r: any) => r.shift?.id === mon.id).status === "MISSING" && !(await admin.request("/api/payroll/report?" + period)).people.find((p: any) => p.userId === users.staffA.id).lines.some((l: any) => l.kind === "ABSENCE"), "no longer approved: no effect, no absence pay");
  await admin.request("/api/absences/" + absence.id, "PATCH", { effects: { default: "UNPAID" } }, 400);
  await admin.request("/api/absences/" + absence.id, "PATCH", { status: "APPROVED" });
  const again = (await admin.request("/api/hours?" + period)).people.find((p: any) => p.userId === users.staffA.id).rows;
  check(again.filter((r: any) => r.status === "ABSENT" && r.absence.handling === "PAID").length === 2, "approved again without choices: category default for both remaining shifts");

  // --- Rechte: Offenstellen nur mit Planungsrecht am Standort ----------------------------------
  await admin.request("/api/employees/" + users.managerA.memberId + "/access", "PUT", { kind: "staff", memberId: users.staffA.memberId, rights: ["VIEW_HOURS", "MANAGE_ABSENCES"] });
  const denied = await mA.request("/api/absences/" + absence.id, "PATCH", { effects: { shifts: { [mon.id]: "RELEASED" } } }, 403);
  check(denied.error.includes("Schichten bearbeiten"), "manager without planning rights cannot take the person out of a shift");
  await mA.request("/api/absences/" + absence.id, "PATCH", { effects: { shifts: { [mon.id]: "UNPAID" } } });
  check((await admin.request("/api/hours?" + period)).people.find((p: any) => p.userId === users.staffA.id).rows.find((r: any) => r.shift?.id === mon.id).absence.handling === "UNPAID", "manager with absence rights changes the decision per shift");
  await sA.request("/api/absences/" + absence.id, "PATCH", { effects: { shifts: { [mon.id]: "PAID" } } }, 400);
  await admin.request("/api/absences/" + absence.id, "DELETE");
  check(!(await admin.request("/api/hours?" + period)).people.find((p: any) => p.userId === users.staffA.id).rows.some((r: any) => r.status === "ABSENT"), "deleted absence: the effects are gone");
}
