/*
 * Planungsregeln (P6) ueber die echte API: Einstellungen nur fuer Admins,
 * Abweichung je Person, Verstoesse im Wochenplan ueber alle Standorte, ohne
 * Tage mit genehmigter Abwesenheit, Rechte der Planung, Veroeffentlichen
 * trotz Verstoss. Teil von tests/workflows.ts. Woche KW 20/2028 (15.-21.05.).
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { TestContext } from "./permissions";

export async function planningRuleTests(t: TestContext) {
  const { users, check, categoryId } = t;
  const session = async (email: string) => { const s = new t.Session(); await s.login(email); return s; };
  const admin = await session(users.admin.email), mA = await session(users.managerA.email), mB = await session(users.managerB.email);
  const sA = await session(users.staffA.email), foreign = await session(users.foreign.email);

  // --- Einstellungen: nur Admins, Pruefung der Werte -------------------------------------------
  await sA.request("/api/planning-rules", "GET", undefined, 403);
  await mA.request("/api/planning-rules", "PUT", { rules: { rest: { enabled: true, hours: 11 } } }, 403);
  const initial = await admin.request("/api/planning-rules");
  check(Object.values(initial.general).every((r: any) => !r.enabled) && initial.general.rest.hours === 11 && initial.members.some((m: any) => m.userId === users.staffA.id), "rules start switched off with legal defaults; every active person is listed");
  await admin.request("/api/planning-rules", "PUT", { rules: { dailyHours: { enabled: true, max: 30 } } }, 400);
  await admin.request("/api/planning-rules", "PUT", { rules: { hours: { enabled: true, period: "WEEK", min: 50, max: 40 } } }, 400);
  check(!(await foreign.request("/api/planning-rules")).members.some((m: any) => m.userId === users.staffA.id), "another organization sees only its own people");

  // --- Plan: Standort 1 Mo 14-22 und Mi 08-20, Standort 2 (Entwurf) Di 06-14 -----------------------------
  const customer = (await admin.request("/api/customers", "POST", { name: "Kunde Regeln" })).customer;
  const one = (await admin.request("/api/branches", "POST", { customerId: customer.id, name: "Objekt Regeln 1" })).branch;
  const two = (await admin.request("/api/branches", "POST", { customerId: customer.id, name: "Objekt Regeln 2" })).branch;
  const plan1 = (await admin.request("/api/schedules?kw=20&year=2028&standort=" + one.id)).schedule;
  const plan2 = (await admin.request("/api/schedules?kw=20&year=2028&standort=" + two.id)).schedule;
  const add = async (plan: any, dayOfWeek: number, shiftFrom: string, shiftTo: string) => {
    const s = (await admin.request("/api/shifts", "POST", { scheduleId: plan.id, dayOfWeek, shiftFrom, shiftTo, maxEmployees: 1, pauseOption: "PER_SHIFT", pauseValue: 0 })).shifts[0];
    await admin.request("/api/bookings", "POST", { shiftId: s.id, userId: users.staffA.id, confirm: true });
    return s;
  };
  const mon = await add(plan1, 1, "14:00", "22:00"), wed = await add(plan1, 3, "08:00", "20:00");
  const tue = await add(plan2, 2, "06:00", "14:00");
  const violations = (s: any = admin) => s.request("/api/schedules/" + plan1.id + "/violations");
  check(!(await violations()).enabled, "no rule switched on: no check");

  // --- Allgemein: Ruhezeit 11 h, hoechstens 10 h am Tag ------------------------------------------------
  await admin.request("/api/planning-rules", "PUT", { rules: { rest: { enabled: true, hours: 11 }, dailyHours: { enabled: true, max: 10 } } });
  let result = await violations();
  const own = result.people.find((p: any) => p.userId === users.staffA.id);
  check(result.enabled && result.count === 2 && own.violations.length === 2, "two violations for the person in this week");
  check(own.violations[0].rule === "rest" && own.violations[0].date === "2028-05-16" && own.violations[0].shiftIds.join() === [mon.id, tue.id].join() && own.violations[0].text.includes("8 h"), "rest of 8 h before the shift at the other site (draft plans count)");
  check(own.violations[1].rule === "dailyHours" && own.violations[1].date === "2028-05-17" && own.violations[1].shiftIds[0] === wed.id, "12 h on Wednesday over 10 h");

  // --- Abweichung je Person ------------------------------------------------------------------------------
  await mA.request("/api/planning-rules/members/" + users.staffA.memberId, "PUT", { rules: { rest: { enabled: false, hours: 11 } } }, 403);
  await foreign.request("/api/planning-rules/members/" + users.staffA.memberId, "PUT", { rules: { rest: { enabled: false, hours: 11 } } }, 404);
  await admin.request("/api/planning-rules/members/" + users.staffA.memberId, "PUT", { rules: { rest: { enabled: false, hours: 11 }, dailyHours: { enabled: true, max: 12 } } });
  check((await violations()).count === 0, "own rules for the person: rest off, 12 h a day allowed");
  const listed = (await admin.request("/api/planning-rules")).members.find((m: any) => m.userId === users.staffA.id);
  check(listed.own.rest && !listed.own.rest.enabled && listed.own.dailyHours.max === 12, "the person's own rules are marked in the list");
  await admin.request("/api/planning-rules/members/" + users.staffA.memberId, "PUT", { reset: ["rest", "dailyHours"] });
  check((await violations()).count === 2 && !Object.keys((await admin.request("/api/planning-rules")).members.find((m: any) => m.userId === users.staffA.id).own).length, "reset: the general rules apply again");

  // --- Rechte auf die Liste ---------------------------------------------------------------------------------
  await admin.request("/api/employees/" + users.managerA.memberId + "/access", "PUT", { kind: "branch", branchId: one.id, rights: ["VIEW_SCHEDULE", "EDIT_SHIFTS"] });
  check((await violations(mA)).count === 2, "manager who plans the site sees the violations");
  await mB.request("/api/schedules/" + plan1.id + "/violations", "GET", undefined, 404);
  await sA.request("/api/schedules/" + plan1.id + "/violations", "GET", undefined, 404);
  await foreign.request("/api/schedules/" + plan1.id + "/violations", "GET", undefined, 404);

  // --- Verstoesse sperren nichts; genehmigte Abwesenheit zaehlt nicht -------------------------------------------
  await admin.request("/api/schedules/" + plan1.id, "PATCH", { isPublic: true });
  check((await admin.request("/api/schedules?kw=20&year=2028&standort=" + one.id)).schedule.isPublic, "publishing works despite violations");
  await admin.request("/api/absences", "POST", { userId: users.staffA.id, categoryId, dateFrom: "2028-05-17", dateTo: "2028-05-17", status: "APPROVED", effects: { default: "UNPAID" } }, 201);
  result = await violations();
  check(result.count === 1 && result.people[0].violations[0].rule === "rest", "absent on Wednesday: the 12 h shift no longer counts");
  await admin.request("/api/planning-rules", "PUT", { rules: { rest: { enabled: false, hours: 11 }, dailyHours: { enabled: false, max: 10 } } });
  check(!(await violations()).enabled, "all rules off again");
}
