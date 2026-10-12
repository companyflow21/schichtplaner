/*
 * Offene Aufgaben der Startseite: nicht freigeschaltete Personen und Wochen im
 * Entwurf (GET /api/dashboard, Feld "tasks"). Teil von workflows.ts; eigene
 * Personen, eigener Kunde und Standort, damit Zaehler anderer Reihen nicht stoeren.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { addDate, berlinDate, isoWeek } from "../src/lib/berlin";
import { formatKW } from "../src/lib/utils/calendar";
import type { TestContext } from "./permissions";
import { newPerson, planner } from "./people";

export async function dashboardTaskTests(t: TestContext) {
  const { users, check } = t;
  const session = async (name: string) => { const s = new t.Session(); await s.login(users[name].email); return s; };
  const admin = await session("admin"), employee = await session("employee"), foreign = await session("foreign");
  const tasks = async (s: any) => (await s.request("/api/dashboard")).tasks;
  const directoryCount = async (s: any) => (await s.request("/api/employees")).counts.not_activated;
  // Frische Managerin ohne Freigaben und Zuordnungen - ihr Umfang ist bekannt.
  const dora = await newPerson(t, admin, "dora.dashboard", "Dora", "Dashboard", "MANAGER");

  // --- Nicht freigeschaltete Personen ---
  const adminBefore = (await tasks(admin)).notActivated, foreignBefore = (await tasks(foreign)).notActivated;
  check(adminBefore === await directoryCount(admin), "admin: dashboard counter equals the employee list counter");
  check((await tasks(dora.session)).notActivated === null, "manager without assigned people gets no not-activated counter (null, not 0)");
  const create = async (firstName: string, lastName: string) => (await admin.request("/api/employees", "POST", { employees: [{ firstName, lastName, email: `${firstName}.${lastName}@akro-test.invalid`.toLowerCase(), role: "EMPLOYEE" }] }, 201)).members[0];
  const nina = await create("Nina", "Neuaufgabe"), otto = await create("Otto", "Offenaufgabe");
  check(nina.isActivated === false && otto.isActivated === false, "newly created people are not activated yet");
  const adminAfter = (await tasks(admin)).notActivated;
  check(adminAfter === adminBefore + 2 && adminAfter === await directoryCount(admin), "admin counts every not-activated person of the organisation, same as the list");
  check((await tasks(dora.session)).notActivated === null, "unassigned not-activated people do not appear for a manager");
  await admin.request("/api/employees/" + dora.memberId + "/access", "PUT", { kind: "staff", memberId: nina.id, rights: ["VIEW_PROFILE"] });
  const doraTasks = await tasks(dora.session);
  check(doraTasks.notActivated === 1 && await directoryCount(dora.session) === 1, "manager counts only assigned people - same scope as the employee list");
  check((await tasks(foreign)).notActivated === foreignBefore && foreignBefore === await directoryCount(foreign), "other organisation's counter is unaffected");
  const own = await employee.request("/api/dashboard");
  check(own.manager === false && !("tasks" in own), "employee gets no task counters at all");
  await admin.request("/api/employees/" + nina.id, "PATCH", { isActive: false });
  // Inaktive Personen zaehlen nicht und gelten auch nicht mehr als zugeordnet (access.ts).
  check((await tasks(admin)).notActivated === adminBefore + 1 && (await tasks(dora.session)).notActivated === null, "deactivated people no longer count as not activated");

  // --- Wochen im Entwurf ---
  const draftsBefore = (await tasks(admin)).draftWeeks;
  // "0 …" sortiert vor allen anderen Kunden: dieser Standort ist die erste Karte.
  const customer = (await admin.request("/api/customers", "POST", { name: "0 Aufgabenkunde" })).customer;
  const branch = (await admin.request("/api/branches", "POST", { customerId: customer.id, name: "Aufgaben Nord" })).branch;
  const plans = planner(admin, branch.id);
  const today = berlinDate(), first = addDate(today, 1), second = addDate(today, 8);
  await plans.shift(first, "08:00", "16:00");
  await plans.shift(second, "06:00", "14:00");
  await plans.shift(second, "14:00", "22:00");
  await plans.shift(addDate(today, 40), "08:00", "16:00");
  const weekLink = (date: string) => { const w = isoWeek(date); return `/schedule/flexible/${formatKW(w.weekNumber, w.year)}?standort=${branch.id}`; };
  const dash = await admin.request("/api/dashboard");
  const cardSum = [...dash.overview.customers.flatMap((c: any) => c.branches), ...dash.overview.unassigned].reduce((sum: number, b: any) => sum + (b.draftWeeks ?? 0), 0);
  check(dash.tasks.draftWeeks === draftsBefore + 2 && dash.tasks.draftWeeks === cardSum, "draft weeks: two weeks inside the horizon count once each, a later week does not; sum matches the location cards");
  check(dash.tasks.draftHref === weekLink(first), "draft link opens the earliest draft week of the first affected location");
  check((await tasks(dora.session)).draftWeeks === null, "manager without plan view gets no draft counter");
  await admin.request("/api/employees/" + dora.memberId + "/access", "PUT", { kind: "branch", branchId: branch.id, rights: ["VIEW_SCHEDULE"] });
  const viewer = await tasks(dora.session);
  check(viewer.draftWeeks === 2 && viewer.draftHref === weekLink(first), "manager with plan view counts the drafts of released locations only");
  await plans.publish(first);
  const published = await tasks(dora.session);
  check(published.draftWeeks === 1 && published.draftHref === weekLink(second), "a published week no longer counts; the link moves to the next draft week");
}
