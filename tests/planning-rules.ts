/*
 * Planungsregeln ueber die echte API: Einstellungen nur fuer Admins,
 * Abweichung je Person, Verstoesse eines Wochenplans ueber alle Standorte
 * (auch Entwuerfe) ohne Tage mit genehmigter Abwesenheit, Zugriff nur fuer
 * die Planung, Schichten fremder Standorte ohne Leserecht nur neutral
 * ("an einem anderen Standort", keine Schicht-ID), Subunternehmer-
 * Platzhalter zaehlen nie, Ruhezeit in der Nacht der Zeitumstellung,
 * Veroeffentlichen trotz Verstoss. Teil von tests/workflows.ts
 * (TEST_ONLY=planning-rules); eigene Personen und Standorte, KW 20 und
 * KW 43/2028. Am Ende sind alle Regeln wieder aus.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { isoWeek } from "../src/lib/berlin";
import type { TestContext } from "./permissions";
import { newPerson, type Sess } from "./people";

export async function planningRuleTests(t: TestContext) {
  const { users, check, categoryId } = t;
  const login = async (email: string) => { const s = new t.Session(); await s.login(email); return s; };
  const admin = await login(users.admin.email), foreign = await login(users.foreign.email);
  const staffA = await login(users.staffA.email), managerB = await login(users.managerB.email);
  const ria = await newPerson(t, admin, "regel-ria", "Ria", "Regel");
  const max = await newPerson(t, admin, "regel-max", "Max", "Regelplaner", "MANAGER");

  // --- Einstellungen: nur Admins, alles aus, Vorbelegung nach Arbeitszeitgesetz ----------------
  await staffA.request("/api/planning-rules", "GET", undefined, 403);
  await max.session.request("/api/planning-rules", "GET", undefined, 403);
  await max.session.request("/api/planning-rules", "PUT", { rules: { rest: { enabled: true, hours: 11 } } }, 403);
  const initial = await admin.request("/api/planning-rules");
  check(Object.values(initial.general).every((r: any) => !r.enabled) && initial.general.rest.hours === 11 && initial.general.dailyHours.max === 10 && initial.general.hours.max === 48,
    "planning-rules: all rules start switched off with the working time act values (11 h rest, 10 h a day, 48 h a week)");
  check(initial.members.some((m: any) => m.userId === ria.id && m.name === "Ria Regel" && !Object.keys(m.own).length), "planning-rules: every active person is listed by display name without own rules");
  await admin.request("/api/planning-rules", "PUT", { rules: { dailyHours: { enabled: true, max: 30 } } }, 400);
  await admin.request("/api/planning-rules", "PUT", { rules: { hours: { enabled: true, period: "WEEK", min: 50, max: 40 } } }, 400);
  check(!(await foreign.request("/api/planning-rules")).members.some((m: any) => m.userId === ria.id), "planning-rules: another organization sees only its own people");

  // --- Plan KW 20/2028: Standort Eins Mo 14-22 und Mi 08-20, Standort Zwei (Entwurf) Di 06-14 und Do 07-19 ---
  const customer = (await admin.request("/api/customers", "POST", { name: "Kunde Regeln" })).customer;
  const one = (await admin.request("/api/branches", "POST", { customerId: customer.id, name: "Objekt Regeln Eins" })).branch;
  const two = (await admin.request("/api/branches", "POST", { customerId: customer.id, name: "Objekt Regeln Zwei" })).branch;
  const plan = async (kw: number, branchId: string) => (await admin.request("/api/schedules?kw=" + kw + "&year=2028&standort=" + branchId)).schedule;
  const plan1 = await plan(20, one.id), plan2 = await plan(20, two.id);
  const shift = async (p: any, dayOfWeek: number, shiftFrom: string, shiftTo: string) =>
    (await admin.request("/api/shifts", "POST", { scheduleId: p.id, dayOfWeek, shiftFrom, shiftTo, maxEmployees: 1, pauseOption: "PER_SHIFT", pauseValue: 0, title: "Regeltest" })).shifts[0];
  const add = async (p: any, dayOfWeek: number, shiftFrom: string, shiftTo: string) => {
    const s = await shift(p, dayOfWeek, shiftFrom, shiftTo);
    await admin.request("/api/bookings", "POST", { shiftId: s.id, userId: ria.id, confirm: true });
    return s;
  };
  const mon = await add(plan1, 1, "14:00", "22:00"), wed = await add(plan1, 3, "08:00", "20:00");
  const tue = await add(plan2, 2, "06:00", "14:00"), thu = await add(plan2, 4, "07:00", "19:00");
  const path = (p: any = plan1) => "/api/schedules/" + p.id + "/violations";
  const violations = (s: Sess = admin, p: any = plan1): Promise<any> => s.request(path(p));
  const mine = (r: any) => r.people.find((p: any) => p.userId === ria.id);
  check(!(await violations()).enabled && (await violations()).count === 0, "planning-rules: no rule switched on, no check");

  // --- Allgemein: Ruhezeit 11 h, hoechstens 10 h am Tag ---------------------------------------
  await admin.request("/api/planning-rules", "PUT", { rules: { rest: { enabled: true, hours: 11 }, dailyHours: { enabled: true, max: 10 } } });
  let result = await violations();
  let own = mine(result);
  check(result.enabled && result.count === 3 && own.name === "Ria Regel" && own.violations.map((v: any) => v.rule).join() === "rest,dailyHours,dailyHours", "planning-rules: three violations for the person in this week, sorted by day");
  check(own.violations[0].date === "2028-05-16" && own.violations[0].shiftIds.join() === [mon.id, tue.id].join() && own.violations[0].text === "Ruhezeit 8 h vor der Schicht am 16.05. um 06:00 (mindestens 11 h)" && !own.violations[0].elsewhere,
    "planning-rules: administration sees the rest of 8 h before the shift at the other site (draft plans count)");
  check(own.violations[1].date === "2028-05-17" && own.violations[1].shiftIds.join() === wed.id && own.violations[2].date === "2028-05-18" && own.violations[2].shiftIds.join() === thu.id && own.violations[2].text === "12 h am 18.05. (höchstens 10 h am Tag)",
    "planning-rules: 12 h on Wednesday here and on Thursday at the other site");

  // --- Zugriff nur fuer die Planung; fremde Standorte ohne Leserecht nur neutral --------------------
  await max.session.request(path(), "GET", undefined, 403);
  await managerB.request(path(), "GET", undefined, 403);
  await staffA.request(path(), "GET", undefined, 403);
  await ria.session.request(path(), "GET", undefined, 403);
  await foreign.request(path(), "GET", undefined, 404);
  await admin.request("/api/schedules/fehlt/violations", "GET", undefined, 404);
  await admin.request("/api/employees/" + max.memberId + "/access", "PUT", { kind: "branch", branchId: one.id, rights: ["EDIT_SHIFTS"] });
  result = await violations(max.session);
  own = mine(result);
  const raw = JSON.stringify(result);
  check(result.count === 2 && own.violations.map((v: any) => v.rule).join() === "rest,dailyHours", "planning-rules: manager of site one gets the violations touching his plan; Thursday at the other site alone is left out");
  check(own.violations[0].shiftIds.join() === mon.id && own.violations[0].elsewhere === true && own.violations[0].text === "Ruhezeit 8 h vor einer Schicht an einem anderen Standort am 16.05. (mindestens 11 h)",
    "planning-rules: rest before a shift at a site without plan rights is named neutrally, without its shift");
  check(!raw.includes(tue.id) && !raw.includes(thu.id) && !raw.includes("Objekt Regeln Zwei") && !raw.includes("06:00") && !raw.includes("07:00"), "planning-rules: no shift id, site or time of the other site in the manager's answer");
  await max.session.request(path(plan2), "GET", undefined, 403);
  await admin.request("/api/employees/" + max.memberId + "/access", "PUT", { kind: "branch", branchId: two.id, rights: ["VIEW_SCHEDULE"] });
  own = mine(await violations(max.session));
  check(own.violations.length === 3 && own.violations[0].shiftIds.join() === [mon.id, tue.id].join() && own.violations[0].text.includes("um 06:00") && !own.violations[0].elsewhere, "planning-rules: with plan rights at the other site the manager sees its shift like the administration");

  // --- Platzhalter zaehlen nie ------------------------------------------------------------------
  const sub = (await admin.request("/api/subcontractors", "POST", { name: "Sub Regeln" })).subcontractor;
  const worker = (await admin.request("/api/subcontractors/" + sub.id + "/workers", "POST", { name: "Platzhalter Regel" })).worker;
  const fri = await shift(plan1, 5, "06:00", "20:00");
  await admin.request("/api/contractor-bookings", "POST", { shiftId: fri.id, contractorWorkerId: worker.id, confirm: true });
  result = await violations();
  check(result.count === 3 && result.people.length === 1 && !JSON.stringify(result).includes(fri.id) && !JSON.stringify(result).includes("Platzhalter Regel"), "planning-rules: a placeholder with 14 h on Friday yields no violation and no entry");

  // --- Abweichung je Person ---------------------------------------------------------------------
  await max.session.request("/api/planning-rules/members/" + ria.memberId, "PUT", { rules: { rest: { enabled: false, hours: 11 } } }, 403);
  await foreign.request("/api/planning-rules/members/" + ria.memberId, "PUT", { rules: { rest: { enabled: false, hours: 11 } } }, 404);
  await admin.request("/api/planning-rules/members/" + ria.memberId, "PUT", { rules: { rest: { enabled: false, hours: 11 }, dailyHours: { enabled: true, max: 12 } } });
  check((await violations()).count === 0, "planning-rules: own rules for the person (rest off, 12 h a day) replace the general ones");
  const listed = (await admin.request("/api/planning-rules")).members.find((m: any) => m.userId === ria.id);
  check(listed.own.rest && !listed.own.rest.enabled && listed.own.dailyHours.max === 12, "planning-rules: the person's own rules are marked in the list");
  await admin.request("/api/planning-rules/members/" + ria.memberId, "PUT", { reset: ["rest", "dailyHours"] });
  check((await violations()).count === 3 && !Object.keys((await admin.request("/api/planning-rules")).members.find((m: any) => m.userId === ria.id).own).length, "planning-rules: reset brings back the general rules");

  // --- Verstoesse sperren nichts; genehmigte Abwesenheit zaehlt nicht ----------------------------
  await admin.request("/api/schedules/" + plan1.id, "PATCH", { isPublic: true, notify: false });
  check((await plan(20, one.id)).isPublic, "planning-rules: publishing works despite violations");
  await admin.request("/api/absences", "POST", { userId: ria.id, categoryId, dateFrom: "2028-05-17", dateTo: "2028-05-17", status: "APPROVED" }, 201);
  result = await violations();
  check(result.count === 2 && mine(result).violations.every((v: any) => v.date !== "2028-05-17"), "planning-rules: absent on Wednesday, the 12 h shift there no longer counts");

  // --- Ruhezeit in echter Zeit: Nacht der Zeitumstellung (29.10.2028, 03:00 -> 02:00) ---------------
  const dst = isoWeek("2028-10-29");
  const plan3 = await plan(dst.weekNumber, one.id);
  await add(plan3, 6, "14:00", "22:00");
  const sunday = await add(plan3, 7, "07:00", "15:00");
  await admin.request("/api/planning-rules", "PUT", { rules: { rest: { enabled: true, hours: 10 } } });
  check(!mine(await violations(admin, plan3)), "planning-rules: Saturday 22:00 to Sunday 07:00 in the night the clocks go back is 10 h rest, enough for 10 h");
  await admin.request("/api/planning-rules", "PUT", { rules: { rest: { enabled: true, hours: 10.5 } } });
  const night = mine(await violations(admin, plan3)).violations;
  check(night.length === 1 && night[0].text === "Ruhezeit 10 h vor der Schicht am 29.10. um 07:00 (mindestens 10,5 h)" && night[0].shiftIds.includes(sunday.id), "planning-rules: the rest time counts real hours (10 h, not 9 h on the clock)");

  await admin.request("/api/planning-rules", "PUT", { rules: { rest: { enabled: false, hours: 11 }, dailyHours: { enabled: false, max: 10 } } });
  check(!(await violations()).enabled, "planning-rules: all rules off again");
}
