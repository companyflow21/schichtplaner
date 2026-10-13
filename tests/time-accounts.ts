/*
 * Zeitkonten (P4) ueber die echte API: Einstellungen nur fuer Admins, Soll ab
 * Startdatum, Saldo aus Ist - Soll, Ausgleich, Sichtbarkeit fuer die Person,
 * Manager mit "Stunden einsehen", Saldo-Spalte in "Stunden und Lohn".
 * Teil von tests/workflows.ts.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { addDate, berlinDate, isoWeek, weekDate } from "../src/lib/berlin";
import type { TestContext } from "./permissions";
import { newPerson, planner } from "./people";

export async function timeAccountTests(t: TestContext) {
  const { users, check } = t;
  const session = async (email: string) => { const s = new t.Session(); await s.login(email); return s; };
  const admin = await session(users.admin.email), mA = await session(users.managerA.email), mB = await session(users.managerB.email);
  const sA = await session(users.staffA.email), foreign = await session(users.foreign.email);

  // --- Nur die Administration richtet ein ------------------------------------------
  await mA.request("/api/time-accounts/settings", "GET", undefined, 403);
  await sA.request("/api/time-accounts/settings", "GET", undefined, 403);
  const person = (await admin.request("/api/employees", "POST", { employees: [{ firstName: "Konto", lastName: "Test", email: "konto.test@akro-test.invalid", role: "EMPLOYEE" }] }, 201)).members[0];
  await mA.request("/api/time-accounts/members/" + person.id + "/targets", "POST", { startDate: "2025-11-03", hours: 10, period: "WEEK" }, 403);
  await foreign.request("/api/time-accounts/members/" + person.id + "/targets", "POST", { startDate: "2025-11-03", hours: 10, period: "WEEK" }, 404);
  await admin.request("/api/settings", "PATCH", { timeSettings: { accountsEnabled: true } });
  const target = (await admin.request("/api/time-accounts/members/" + person.id + "/targets", "POST", { startDate: "2025-11-03", hours: 10, period: "WEEK" }, 201)).target;
  check(target.minutes === 600 && target.period === "WEEK", "target stored in minutes per week");

  // --- Saldo: Woche 1: 12 h Ist - 10 h = +2 h; Woche 2: 4 h - 10 h = -6 h -------------
  for (const [date, timeTo] of [["2025-11-03", "14:00"], ["2025-11-04", "14:00"], ["2025-11-10", "12:00"]]) {
    await admin.request("/api/time", "POST", { type: "MANUAL", userId: person.userId, date, timeFrom: "08:00", timeTo }, 201);
  }
  const account = await admin.request("/api/time-accounts?userId=" + person.userId + "&to=2025-11-16");
  check(account.active && account.result.periods.length === 2 && account.result.periods[0].deltaMinutes === 120 && account.result.balanceMinutes === -240, "balance: +2 h, then -6 h, total -4 h");

  // --- Ausgleich -------------------------------------------------------------------
  await admin.request("/api/time-accounts/members/" + person.id + "/compensations", "POST", { date: "2025-11-12", hours: 0, description: "Null" }, 400);
  await mA.request("/api/time-accounts/members/" + person.id + "/compensations", "POST", { date: "2025-11-12", hours: 5, description: "Versuch" }, 403);
  const comp = (await admin.request("/api/time-accounts/members/" + person.id + "/compensations", "POST", { date: "2025-11-12", hours: 5, description: "Korrektur Anfangssaldo" }, 201)).compensation;
  check((await admin.request("/api/time-accounts?userId=" + person.userId + "&to=2025-11-16")).result.balanceMinutes === 60, "compensation of +5 h makes the balance +1 h");
  const hours = await admin.request("/api/hours?from=2025-11-03&to=2025-11-16");
  check(hours.showBalance === true && hours.people.find((p: any) => p.userId === person.userId)?.balanceMinutes === 60, "\"Stunden und Lohn\" shows the balance on the last day of the query");
  await foreign.request("/api/time-accounts/compensations/" + comp.id, "DELETE", undefined, 404);
  await mA.request("/api/time-accounts/compensations/" + comp.id, "DELETE", undefined, 403);
  await sA.request("/api/time-accounts/compensations/" + comp.id, "DELETE", undefined, 403);
  await mA.request("/api/time-accounts/members/" + person.id, "PUT", { included: false }, 403);
  await foreign.request("/api/time-accounts/members/" + person.id, "PUT", { included: false }, 404);
  await mA.request("/api/time-accounts/targets/" + target.id, "DELETE", undefined, 403);
  await foreign.request("/api/time-accounts/targets/" + target.id, "DELETE", undefined, 404);
  check(true, "changing accounts, targets and compensations: administration only (manager and employee 403, other organisation 404)");

  // --- Einbeziehen, Berechnungsart je Person -----------------------------------------
  await admin.request("/api/time-accounts/members/" + person.id, "PUT", { method: "ACTUAL_MINUS_PLAN" });
  check((await admin.request("/api/time-accounts?userId=" + person.userId + "&to=2025-11-16")).result.balanceMinutes === 16 * 60 + 300, "per-person method actual minus plan: 16 h actual, no plan, +5 h");
  await admin.request("/api/time-accounts/members/" + person.id, "PUT", { method: null, included: false });
  check((await admin.request("/api/hours?from=2025-11-03&to=2025-11-16")).people.find((p: any) => p.userId === person.userId)?.balanceMinutes === null, "excluded person has no balance");
  await admin.request("/api/time-accounts/members/" + person.id, "PUT", { included: true });

  // --- Sichtbarkeit: Person selbst nur mit Freigabe, Manager mit "Stunden einsehen" ------
  await admin.request("/api/time-accounts/members/" + users.staffA.memberId + "/targets", "POST", { startDate: "2026-01-05", hours: 40, period: "WEEK" }, 201);
  await sA.request("/api/time-accounts", "GET", undefined, 404);
  await admin.request("/api/settings", "PATCH", { timeSettings: { accountVisible: true } });
  const own = await sA.request("/api/time-accounts");
  check(own.active && own.canEdit === false && typeof own.result.balanceMinutes === "number", "with visibility on, the person sees the own balance but cannot edit");
  await admin.request("/api/time-accounts/members/" + users.staffA.memberId, "PUT", { visible: false });
  await sA.request("/api/time-accounts", "GET", undefined, 404);
  await sA.request("/api/time-accounts?userId=" + person.userId, "GET", undefined, 404);
  await admin.request("/api/employees/" + users.managerA.memberId + "/access", "PUT", { kind: "staff", memberId: users.staffA.memberId, rights: ["VIEW_HOURS"] });
  check((await mA.request("/api/time-accounts?userId=" + users.staffA.id)).active === true, "manager with \"view hours\" for the person sees the balance");
  await mB.request("/api/time-accounts?userId=" + users.staffA.id, "GET", undefined, 404);
  await foreign.request("/api/time-accounts?userId=" + users.staffA.id, "GET", undefined, 404);

  // --- Plan in Bearbeitung: Planstunden der Person aus der Momentaufnahme (wie "Stunden und Lohn") -------
  const customer = (await admin.request("/api/customers", "POST", { name: "Kunde Zeitkonto" })).customer;
  const branch = (await admin.request("/api/branches", "POST", { customerId: customer.id, name: "Objekt Zeitkonto" })).branch;
  const kim = await newPerson(t, admin, "konto.kim", "Kim", "Konto", "EMPLOYEE", [branch.id]);
  const w = isoWeek(addDate(berlinDate(), 230)), mon = weekDate(w.year, w.weekNumber), sun = addDate(mon, 6);
  await admin.request("/api/time-accounts/members/" + kim.memberId + "/targets", "POST", { startDate: mon, hours: 10, period: "WEEK" }, 201);
  await admin.request("/api/time-accounts/members/" + kim.memberId, "PUT", { visible: true });
  const P = planner(admin, branch.id);
  const wed = await P.shift(addDate(mon, 2), "08:00", "16:00", 1, { title: "Konto", pauseOption: "PER_SHIFT", pauseValue: 0 });
  await P.book(wed.id, kim.id);
  await P.publish(mon);
  const periodOf = async (s: any, userId?: string) => (await s.request("/api/time-accounts?to=" + sun + (userId ? "&userId=" + userId : ""))).result.periods.find((x: any) => x.from === mon);
  check((await periodOf(kim.session)).plannedMinutes === 480 && (await periodOf(kim.session)).actualMinutes === 480, "future days count with planned hours (8 h planned, 8 h as actual)");
  const plan = (await admin.request("/api/schedules?kw=" + w.weekNumber + "&year=" + w.year + "&standort=" + branch.id)).schedule;
  await admin.request("/api/schedules/" + plan.id + "/editing", "POST");
  await admin.request("/api/shifts/" + wed.id, "PATCH", { shiftTo: "12:00" });
  check((await periodOf(kim.session)).plannedMinutes === 480 && (await periodOf(admin, kim.id)).plannedMinutes === 240, "plan in editing: the person's account keeps the published planned hours, the administration sees the live plan");
  await admin.request("/api/schedules/" + plan.id + "/editing", "DELETE");
  check((await periodOf(kim.session)).plannedMinutes === 480 && (await periodOf(admin, kim.id)).plannedMinutes === 480, "after discarding the edits both see the published plan again");

  // --- Soll loeschen, Einstellungen zuruecksetzen -------------------------------------
  await admin.request("/api/time-accounts/targets/" + target.id, "DELETE");
  check((await admin.request("/api/time-accounts?userId=" + person.userId + "&to=2025-11-16")).active === false, "without a target the account is inactive");
  await admin.request("/api/settings", "PATCH", { timeSettings: { accountsEnabled: false, accountVisible: false } });
  check((await admin.request("/api/hours?from=2025-11-03&to=2025-11-16")).showBalance === false, "switched off: no balance column");
}
