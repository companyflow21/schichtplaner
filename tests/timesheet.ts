/*
 * Stundenzettel und Leistungsnachweis (P3) ueber die echte API: Inhalt,
 * Zuschlagsstunden ohne Betraege, Rechte (eigene, Pruefende, Fremde) und
 * Organisationsgrenzen. Baut auf den Daten aus tests/hours.ts auf.
 * Teil von tests/workflows.ts.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { TestContext } from "./permissions";

export async function timesheetTests(t: TestContext) {
  const { users, check } = t;
  const session = async (email: string) => { const s = new t.Session(); await s.login(email); return s; };
  const admin = await session(users.admin.email), mB = await session(users.managerB.email), sB = await session(users.staffB.email);
  const loner = await session(users.loner.email), foreign = await session(users.foreign.email);
  const period = "from=2025-09-08&to=2025-09-14";
  const branch = (await admin.request("/api/branches")).branches.find((b: any) => b.name === "Objekt Stunden");

  // Nachtstunden am Samstag, damit ein Zuschlag (Nacht 20-06 aus tests/payroll.ts) entsteht.
  await admin.request("/api/time", "POST", { type: "MANUAL", userId: users.staffB.id, date: "2025-09-13", timeFrom: "18:00", timeTo: "22:00" }, 201);

  // --- Eigener Stundenzettel ----------------------------------------------------------
  const own = await sB.request("/api/timesheet?" + period);
  check(own.person.name === "Elke Zweier" && own.person.personnelNumber === "4711" && own.organization === "AKRO Integrationstest", "own timesheet with name, personnel number and company");
  const monday = own.rows.find((r: any) => r.date === "2025-09-08");
  check(monday.planFrom === "08:00" && monday.timeTo === "16:00" && monday.minutes === 445 && monday.status === "genehmigt" && monday.site.startsWith("Objekt Stunden"), "Monday row: plan, corrected end, 7,42 h, approved, site");
  check(own.sums.surcharges.some((s: any) => s.name === "Nacht" && s.minutes === 120) && !JSON.stringify(own).includes("amountCents") && !JSON.stringify(own).includes("rateCents"), "surcharge hours without any amounts");
  check(own.sums.istMinutes === own.rows.reduce((s: number, r: any) => s + r.minutes, 0) && own.sums.targetMinutes === null, "sums match the rows; no target for a part of a month");
  check(own.rows.some((r: any) => r.proof === "manuell"), "proof column names the kind of entry");

  // --- Pruefende und Fremde -----------------------------------------------------------
  const byManager = await mB.request("/api/timesheet?" + period + "&userId=" + users.staffB.id);
  check(own.rows.length === 4 && byManager.rows.length === 2 && byManager.rows.every((r: any) => r.site?.startsWith("Objekt Stunden")), "responsible manager sees only rows at sites with time rights");
  check(byManager.person.personnelNumber === null && byManager.sums.targetMinutes === null, "manager's copy shows no personnel number and no target");
  check((await admin.request("/api/timesheet?" + period + "&userId=" + users.staffB.id)).person.personnelNumber === "4711", "administration sees the personnel number");
  await loner.request("/api/timesheet?" + period + "&userId=" + users.staffB.id, "GET", undefined, 404);
  await foreign.request("/api/timesheet?" + period + "&userId=" + users.staffB.id, "GET", undefined, 404);
  check((await loner.request("/api/timesheet?" + period)).rows.length >= 0, "everyone can create the own timesheet");

  // --- Leistungsnachweis je Einsatzort -------------------------------------------------
  const site = await admin.request("/api/timesheet/site?" + period + "&standort=" + branch.id);
  check(site.site === "Objekt Stunden" && site.customer === "Kunde Stunden" && site.rows.length === 2 && site.totalMinutes === 895, "site report lists both shifts at the site: 7,42 h + 7,50 h");
  check(site.rows.every((r: any) => r.person === "Elke Zweier" && r.activity === "Empfang") && site.openCount === 0, "site report rows carry person and activity; all approved");
  check((await mB.request("/api/timesheet/site?" + period + "&standort=" + branch.id)).totalMinutes === 895, "manager with time rights at the site gets the site report");
  await sB.request("/api/timesheet/site?" + period + "&standort=" + branch.id, "GET", undefined, 404);
  await foreign.request("/api/timesheet/site?" + period + "&standort=" + branch.id, "GET", undefined, 404);
  await admin.request("/api/timesheet/site?" + period, "GET", undefined, 400);
}
