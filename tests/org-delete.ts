/*
 * Kunden und Einsatzorte loeschen: nur ohne fachliche Daten, nur Admins,
 * nur in der eigenen Organisation. Sonst bleibt "deaktivieren".
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { addDate, berlinDate, isoWeek } from "../src/lib/berlin";
import type { TestContext } from "./permissions";

export async function orgDeleteTests(t: TestContext) {
  const { users, check } = t;
  const session = async (email: string) => { const s = new t.Session(); await s.login(email); return s; };
  const admin = await session(users.admin.email), manager = await session(users.managerA.email), foreign = await session(users.foreign.email);

  const customer = (await admin.request("/api/customers", "POST", { name: "Löschtest Kunde" })).customer;
  const empty = (await admin.request("/api/branches", "POST", { customerId: customer.id, name: "Löschtest leer" })).branch;
  const used = (await admin.request("/api/branches", "POST", { customerId: customer.id, name: "Löschtest mit Schicht" })).branch;

  // Rechte und Organisationsgrenzen
  await manager.request("/api/customers/" + customer.id, "DELETE", undefined, 403);
  await manager.request("/api/branches/" + empty.id, "DELETE", undefined, 403);
  await foreign.request("/api/customers/" + customer.id, "DELETE", undefined, 404);
  await foreign.request("/api/branches/" + empty.id, "DELETE", undefined, 404);

  // Kunde mit Einsatzorten bleibt.
  await admin.request("/api/customers/" + customer.id, "DELETE", undefined, 409);

  // Ein Einsatzort mit Schicht bleibt - auch nachdem die Schicht geloescht wurde.
  const day = addDate(berlinDate(), 30), w = isoWeek(day);
  const plan = (await admin.request("/api/schedules?kw=" + w.weekNumber + "&year=" + w.year + "&standort=" + used.id)).schedule;
  const shift = (await admin.request("/api/shifts", "POST", { scheduleId: plan.id, dayOfWeek: 1, shiftFrom: "08:00", shiftTo: "12:00", maxEmployees: 1 })).shifts[0];
  await admin.request("/api/branches/" + used.id, "DELETE", undefined, 409);
  await admin.request("/api/shifts/" + shift.id, "DELETE");
  await admin.request("/api/branches/" + used.id, "DELETE", undefined, 409);
  check((await admin.request("/api/branches")).branches.some((b: any) => b.id === used.id), "site with shift history cannot be deleted");

  // Leerer Einsatzort: auch mit einem nur geoeffneten (leeren) Wochenplan loeschbar.
  await admin.request("/api/schedules?kw=" + w.weekNumber + "&year=" + w.year + "&standort=" + empty.id);
  await admin.request("/api/branches/" + empty.id, "DELETE");
  check(!(await admin.request("/api/branches")).branches.some((b: any) => b.id === empty.id), "empty site is deleted, including its empty week plan");

  // Kunde ohne Einsatzorte: loeschbar.
  const lone = (await admin.request("/api/customers", "POST", { name: "Löschtest ohne Standort" })).customer;
  await admin.request("/api/customers/" + lone.id, "DELETE");
  check(!(await admin.request("/api/customers")).customers.some((c: any) => c.id === lone.id), "customer without sites is deleted");
  await admin.request("/api/customers/" + lone.id, "DELETE", undefined, 404);

  console.log("ORG DELETE: " + t.counter() + " checks so far.");
}
