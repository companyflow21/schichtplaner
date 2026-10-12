/*
 * Veroeffentlichen mit Aenderungsliste und Bearbeitungsmodus (P6) ueber die
 * echte API: erste Veroeffentlichung, Bearbeiten nur fuer kommende Wochen,
 * Mitarbeitende sehen waehrenddessen den alten Stand, Anfragen und
 * Bestaetigen ruhen, keine Einzelnachrichten, Aenderungsliste, gezielte
 * Benachrichtigung, Zurueckziehen. Teil von tests/workflows.ts. Woche KW 30/2028.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { TestContext } from "./permissions";
import { berlinDate, isoWeek } from "../src/lib/berlin";

export async function publishingTests(t: TestContext) {
  const { users, check } = t;
  const session = async (email: string) => { const s = new t.Session(); await s.login(email); return s; };
  const admin = await session(users.admin.email), sA = await session(users.staffA.email), sB = await session(users.staffB.email), foreign = await session(users.foreign.email);
  const week = "kw=30&year=2028";
  const inbox = async (s: any, subject: string) => (await s.request("/api/messages")).messages.filter((m: any) => m.subject === subject && m.body.includes("KW 30/2028"));

  // --- Entwurf: Mo 08-16 (Emil), Di 08-16 offen, Do 08-16 mit zwei Plaetzen ----------------------------------
  const customer = (await admin.request("/api/customers", "POST", { name: "Kunde Veröffentlichung" })).customer;
  const branch = (await admin.request("/api/branches", "POST", { customerId: customer.id, name: "Objekt Veröffentlichung" })).branch;
  for (const person of [users.staffA, users.staffB]) await admin.request("/api/employees/" + person.memberId + "/access", "PUT", { kind: "branch", branchId: branch.id, rights: ["VIEW_SCHEDULE", "REQUEST_SHIFTS"] });
  const plan = (await admin.request("/api/schedules?" + week + "&standort=" + branch.id)).schedule;
  const add = async (dayOfWeek: number, maxEmployees = 1) => (await admin.request("/api/shifts", "POST", { scheduleId: plan.id, dayOfWeek, shiftFrom: "08:00", shiftTo: "16:00", maxEmployees, title: "Empfang" })).shifts[0];
  const mon = await add(1), tue = await add(2), thu = await add(4, 2);
  await admin.request("/api/bookings", "POST", { shiftId: mon.id, userId: users.staffA.id, confirm: true });

  // --- Erste Veroeffentlichung ----------------------------------------------------------------------------
  await sA.request("/api/schedules/" + plan.id + "/publish", "GET", undefined, 403);
  await foreign.request("/api/schedules/" + plan.id + "/publish", "GET", undefined, 404);
  let preview = await admin.request("/api/schedules/" + plan.id + "/publish");
  check(preview.first && preview.changes.added.length === 3 && !preview.changes.removed.length && preview.hints.openSlots === 3 && preview.schedule.from === "2028-07-24", "first publication: all shifts are new, three places open");
  await sA.request("/api/schedules/" + plan.id + "/publish", "POST", { notify: true }, 403);
  const first = await admin.request("/api/schedules/" + plan.id + "/publish", "POST", { notify: true });
  check(first.schedule.isPublic && first.notified >= 2 && (await inbox(sA, "Dienstplan veröffentlicht")).length === 1 && (await inbox(sB, "Dienstplan veröffentlicht")).length === 1, "published: everybody who sees the plan or may request shifts is notified");

  // --- Bearbeitungsmodus: nur kommende Wochen ---------------------------------------------------------------------
  await sA.request("/api/schedules/" + plan.id + "/edit", "POST", undefined, 403);
  const now = isoWeek(berlinDate());
  const current = (await admin.request("/api/schedules?kw=" + now.weekNumber + "&year=" + now.year + "&standort=" + branch.id)).schedule;
  await admin.request("/api/schedules/" + current.id, "PATCH", { isPublic: true });
  const started = await admin.request("/api/schedules/" + current.id + "/edit", "POST", undefined, 409);
  check(started.error.includes("noch nicht begonnen"), "the running week cannot go into edit mode");
  check((await admin.request("/api/schedules/" + plan.id + "/edit", "POST")).schedule.editing, "a coming week goes into edit mode");

  // --- Aenderungen waehrend der Bearbeitung: keine Einzelnachrichten ----------------------------------------------
  await admin.request("/api/shifts/" + mon.id, "PATCH", { shiftFrom: "09:00", shiftTo: "17:00" });
  await admin.request("/api/shifts/" + tue.id, "DELETE");
  const wed = await add(3);
  await admin.request("/api/bookings", "POST", { shiftId: wed.id, userId: users.staffB.id, confirm: true });
  check(!(await sA.request("/api/messages")).messages.some((m: any) => m.subject.startsWith("Schicht geändert")) && !(await sB.request("/api/messages")).messages.some((m: any) => m.subject === "Neue Schicht" && m.body.startsWith("2028-07-26")), "changes in edit mode send no single messages");

  // --- Mitarbeitende sehen den alten Stand; Anfragen und Bestaetigen ruhen --------------------------------------------
  const seen = (await sA.request("/api/schedules?" + week + "&standort=" + branch.id)).schedule;
  const seenMon = seen.shifts.find((s: any) => s.id === mon.id);
  check(seen.editing && seenMon.shiftFrom === "08:00" && seen.shifts.some((s: any) => s.id === tue.id) && !seen.shifts.some((s: any) => s.id === wed.id), "employee sees the last published state (old time, deleted shift still there, new one not yet)");
  const merged = (await sA.request("/api/schedules?" + week)).schedule;
  check(merged.shifts.some((s: any) => s.id === mon.id && s.shiftFrom === "08:00"), "own plan across sites shows the published state too");
  const planner = (await admin.request("/api/schedules?" + week + "&standort=" + branch.id)).schedule;
  check(planner.shifts.find((s: any) => s.id === mon.id).shiftFrom === "09:00" && planner.shifts.some((s: any) => s.id === wed.id) && !planner.shifts.some((s: any) => s.id === tue.id), "planning sees the new state");
  const locked = await sB.request("/api/mod-requests", "POST", { shiftId: thu.id }, 409);
  check(locked.error.includes("überarbeitet"), "requests rest while the plan is edited");
  await sA.request("/api/bookings", "PATCH", { shiftId: mon.id }, 409);

  // --- Aenderungsliste und gezielte Benachrichtigung --------------------------------------------------------------------
  preview = await admin.request("/api/schedules/" + plan.id + "/publish");
  const changed = preview.changes.changed;
  check(!preview.first && preview.schedule.editing && preview.changes.added.length === 1 && preview.changes.added[0].id === wed.id && preview.changes.added[0].people[0].userId === users.staffB.id, "change list: the new Wednesday shift with Elke");
  check(preview.changes.removed.length === 1 && preview.changes.removed[0].id === tue.id && changed.length === 1 && changed[0].after.id === mon.id && changed[0].fields.join() === "Zeit" && changed[0].before.from === "08:00", "change list: Tuesday deleted, Monday moved from 08:00 to 09:00");
  const republished = await admin.request("/api/schedules/" + plan.id + "/publish", "POST", { notify: true });
  const toA = await inbox(sA, "Dienstplan geändert"), toB = await inbox(sB, "Dienstplan geändert");
  check(republished.notified === 2 && toA.length === 1 && toA[0].body.includes("Geändert (Zeit)") && toA[0].body.includes("09:00–17:00") && toB.length === 1 && toB[0].body.includes("Neu: 26.07."), "only the people concerned get a message with their changes");
  const after = (await sA.request("/api/schedules?" + week + "&standort=" + branch.id)).schedule;
  check(!after.editing && after.shifts.find((s: any) => s.id === mon.id).shiftFrom === "09:00", "after publishing everybody sees the new state");
  await sA.request("/api/bookings", "PATCH", { shiftId: mon.id });
  check((await admin.request("/api/schedules/" + plan.id + "/publish")).changes.changed.length === 0, "nothing new since the last publication");

  // --- Ohne Benachrichtigung; Zurueckziehen behaelt den gesehenen Stand ---------------------------------------------------
  await admin.request("/api/schedules/" + plan.id + "/edit", "POST");
  await admin.request("/api/shifts/" + wed.id, "PATCH", { title: "Empfang spät" });
  const quiet = await admin.request("/api/schedules/" + plan.id + "/publish", "POST", { notify: false });
  check(quiet.notified === 0 && (await inbox(sB, "Dienstplan geändert")).length === 1, "publishing without notification sends nothing");
  await admin.request("/api/schedules/" + plan.id, "PATCH", { isPublic: false });
  await admin.request("/api/bookings", "DELETE", { shiftId: mon.id, userId: users.staffA.id });
  check((await sA.request("/api/schedules?" + week + "&standort=" + branch.id)).schedule.shifts.length === 0, "withdrawn: employees see nothing");
  preview = await admin.request("/api/schedules/" + plan.id + "/publish");
  check(!preview.first && preview.changes.changed.length === 1 && preview.changes.changed[0].left[0].userId === users.staffA.id, "after withdrawing, the list compares with what employees saw last");
  await admin.request("/api/schedules/" + plan.id, "PATCH", { isPublic: true });
  check((await inbox(sA, "Dienstplan veröffentlicht")).length === 2, "publishing again after withdrawing informs everybody as before");
}
