/*
 * Stundenzettel und Leistungsnachweis (P3) ueber die echte API: Inhalt,
 * Zuschlagsstunden ohne Betraege, Rechte (eigene, Pruefende, Fremde, 403/404)
 * und Organisationsgrenzen. Teil von tests/workflows.ts (TEST_ONLY=timesheet)
 * mit eigenen Personen, Standorten und Zuschlaegen (am Ende wieder entfernt).
 * Dazu die Hauptlinie: Feiertagsstunden nach Bundesland des Einsatzorts
 * (Fronleichnam 19.06.2025 in NRW, nicht in Thueringen) und die Planspalte des
 * eigenen Stundenzettels aus der Momentaufnahme, solange der Plan in
 * Bearbeitung ist (Planende sehen die Live-Zeilen).
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { addDate, berlinDate, isoWeek, weekDate } from "../src/lib/berlin";
import type { TestContext } from "./permissions";
import { newPerson, planner } from "./people";

export async function timesheetTests(t: TestContext) {
  const { users, check } = t;
  const login = async (email: string) => { const s = new t.Session(); await s.login(email); return s; };
  const admin = await login(users.admin.email), foreign = await login(users.foreign.email);
  const period = "from=2025-06-16&to=2025-06-22";

  // --- Standorte mit Bundesland, Personen, Zuschlaege ----------------------------------
  const customer = (await admin.request("/api/customers", "POST", { name: "Kunde Zettel" })).customer;
  const cologne = (await admin.request("/api/branches", "POST", { customerId: customer.id, name: "Objekt Zettel Köln", holidayState: "NW" })).branch;
  const jena = (await admin.request("/api/branches", "POST", { customerId: customer.id, name: "Objekt Zettel Jena", holidayState: "TH" })).branch;
  const zoe = await newPerson(t, admin, "sheet.zoe", "Zoe", "Zettel", "EMPLOYEE", [cologne.id, jena.id]);
  const otto = await newPerson(t, admin, "sheet.otto", "Otto", "Anders", "EMPLOYEE", [cologne.id]);
  const mgr = await newPerson(t, admin, "sheet.mgr", "Mats", "Zettelprüfer", "MANAGER");
  const mgrNoHours = await newPerson(t, admin, "sheet.mgr2", "Mona", "Ohnestunden", "MANAGER");
  const grant = (memberId: string, body: any) => admin.request("/api/employees/" + memberId + "/access", "PUT", body);
  await grant(mgr.memberId, { kind: "branch", branchId: cologne.id, rights: ["VIEW_TIME"] });
  await grant(mgr.memberId, { kind: "staff", memberId: zoe.memberId, rights: ["VIEW_HOURS"] });
  await grant(mgrNoHours.memberId, { kind: "branch", branchId: cologne.id, rights: ["VIEW_TIME", "EDIT_TIME"] });
  await admin.request("/api/payroll/members/" + zoe.memberId, "PATCH", { personnelNumber: "5100" });
  const night = (await admin.request("/api/payroll/surcharges", "POST", { name: "Nacht Zettel", code: "910", weekdays: [1, 2, 3, 4, 5, 6, 7], timeFrom: "20:00", timeTo: "06:00", rateKind: "PERCENT", rate: 2500 }, 201)).surcharge;
  const holiday = (await admin.request("/api/payroll/surcharges", "POST", { name: "Feiertag Zettel", code: "920", holidays: true, rateKind: "AMOUNT", rate: 500 }, 201)).surcharge;

  // --- KW 25/2025: Mo, Do (Fronleichnam) und Fr in Koeln -------------------------------
  const plan = planner(admin, cologne.id);
  const options = { pauseOption: "PER_SHIFT", pauseValue: 30, title: "Pforte" };
  const monday = await plan.shift("2025-06-16", "08:00", "16:00", 1, options);
  const thursday = await plan.shift("2025-06-19", "08:00", "12:00", 1, { title: "Pforte Feiertag" });
  const friday = await plan.shift("2025-06-20", "08:00", "12:00", 1, { title: "Pforte Freitag" });
  for (const s of [monday, thursday, friday]) await plan.book(s.id, zoe.id);
  await plan.publish("2025-06-16");
  await zoe.session.request("/api/time", "POST", { type: "MANUAL", userId: zoe.id, date: "2025-06-16", timeFrom: "08:00", timeTo: "16:00", breakMinutes: 30 }, 201);
  const work = (date: string, timeFrom: string, timeTo: string, branchId?: string) => admin.request("/api/time", "POST", { type: "MANUAL", userId: zoe.id, date, timeFrom, timeTo, ...(branchId ? { branchId } : {}) }, 201);
  await work("2025-06-19", "08:00", "12:00", cologne.id);
  await work("2025-06-19", "13:00", "15:00", jena.id);
  await work("2025-06-21", "18:00", "22:00");

  // --- Eigener Stundenzettel -------------------------------------------------------------
  const own = await zoe.session.request("/api/timesheet?" + period);
  check(own.person.name === "Zoe Zettel" && own.person.personnelNumber === "5100" && own.organization === "AKRO Integrationstest", "timesheet: own timesheet with full name, personnel number and company");
  const mon = own.rows.find((r: any) => r.date === "2025-06-16");
  check(mon.planFrom === "08:00" && mon.planTo === "16:00" && mon.timeTo === "16:00" && mon.minutes === 450 && mon.status === "offen" && mon.proof === "manuell" && mon.site.startsWith("Objekt Zettel Köln"), "timesheet: Monday row with plan, actual 7,50 h, open, entered by hand, site");
  const fri = own.rows.find((r: any) => r.date === "2025-06-20");
  check(fri.status === "nicht erfasst" && fri.minutes === 0 && fri.planFrom === "08:00" && fri.timeFrom === null, "timesheet: a past shift without time is listed as 'nicht erfasst'");
  const sum = (name: string) => own.sums.surcharges.find((s: any) => s.name === name)?.minutes ?? 0;
  check(sum("Feiertag Zettel") === 240, "timesheet: holiday hours only at the site in NRW (Corpus Christi), not in Thuringia");
  const thuRows = own.rows.filter((r: any) => r.date === "2025-06-19");
  check(thuRows.length === 2 && thuRows.find((r: any) => r.site?.startsWith("Objekt Zettel Jena")).surcharges.every((s: any) => s.name !== "Feiertag Zettel") && thuRows.find((r: any) => r.planFrom === "08:00").status === "genehmigt", "timesheet: the Jena record of the same day has no holiday hours; admin entries count as approved");
  check(sum("Nacht Zettel") === 120, "timesheet: night surcharge hours 20-22 on Saturday");
  check(!JSON.stringify(own).includes("amountCents") && !JSON.stringify(own).includes("rateCents"), "timesheet: surcharge hours without any amounts or rates");
  check(own.sums.istMinutes === own.rows.reduce((s: number, r: any) => s + r.minutes, 0) && own.sums.istMinutes === 450 + 240 + 120 + 240 && own.sums.targetMinutes === null && own.openCount === 1,
    "timesheet: sums match the rows (17,50 h); no target for a part of a month; one open record");

  // --- Pruefende und Fremde -----------------------------------------------------------------
  const byManager = await mgr.session.request("/api/timesheet?" + period + "&userId=" + zoe.id);
  check(byManager.rows.length > 0 && byManager.rows.every((r: any) => r.site?.startsWith("Objekt Zettel Köln")) && byManager.rows.length === own.rows.length - 2,
    "timesheet: responsible manager sees only rows at sites with time rights (not Jena, not without site)");
  check(byManager.person.personnelNumber === null && byManager.sums.targetMinutes === null, "timesheet: the manager's copy shows no personnel number and no target");
  check((await admin.request("/api/timesheet?" + period + "&userId=" + zoe.id)).person.personnelNumber === "5100", "timesheet: administration sees the personnel number");
  await mgrNoHours.session.request("/api/timesheet?" + period + "&userId=" + zoe.id, "GET", undefined, 404);
  await otto.session.request("/api/timesheet?" + period + "&userId=" + zoe.id, "GET", undefined, 404);
  await foreign.request("/api/timesheet?" + period + "&userId=" + zoe.id, "GET", undefined, 404);
  check((await otto.session.request("/api/timesheet?" + period)).person.name === "Otto Anders", "timesheet: everyone can create the own timesheet; others' only with rights (404 otherwise)");

  // --- Leistungsnachweis je Einsatzort ---------------------------------------------------------
  const site = await admin.request("/api/timesheet/site?" + period + "&standort=" + cologne.id);
  check(site.site === "Objekt Zettel Köln" && site.customer === "Kunde Zettel" && site.rows.length === 2 && site.totalMinutes === 690 && site.openCount === 1, "timesheet: site report lists both records at the site: 7,50 h + 4,00 h, one open");
  check(site.rows.every((r: any) => r.person === "Zoe Zettel") && site.rows.some((r: any) => r.activity === "Pforte") && site.perPerson.length === 1 && site.perPerson[0].minutes === 690, "timesheet: site report rows carry person and activity, sum per person");
  check((await mgr.session.request("/api/timesheet/site?" + period + "&standort=" + cologne.id)).totalMinutes === 690, "timesheet: manager with time rights at the site gets the site report");
  await mgr.session.request("/api/timesheet/site?" + period + "&standort=" + jena.id, "GET", undefined, 404);
  await zoe.session.request("/api/timesheet/site?" + period + "&standort=" + cologne.id, "GET", undefined, 404);
  await foreign.request("/api/timesheet/site?" + period + "&standort=" + cologne.id, "GET", undefined, 404);
  await admin.request("/api/timesheet/site?" + period, "GET", undefined, 400);

  // --- Plan in Bearbeitung: eigener Stundenzettel mit dem veroeffentlichten Stand --------------
  const w = isoWeek(addDate(berlinDate(), 29));
  const day = weekDate(w.year, w.weekNumber, 2);
  const future = "from=" + weekDate(w.year, w.weekNumber, 1) + "&to=" + weekDate(w.year, w.weekNumber, 7);
  const later = planner(admin, cologne.id);
  const planned = await later.shift(day, "03:10", "05:10", 1, { title: "Zettel Früh" });
  await later.book(planned.id, zoe.id);
  await later.publish(day);
  const futurePlan = (await admin.request("/api/schedules?kw=" + w.weekNumber + "&year=" + w.year + "&standort=" + cologne.id)).schedule;
  await admin.request("/api/schedules/" + futurePlan.id + "/editing", "POST");
  await admin.request("/api/shifts/" + planned.id, "PATCH", { shiftFrom: "04:10", shiftTo: "06:10" });
  const frozenRow = (await zoe.session.request("/api/timesheet?" + future)).rows.find((r: any) => r.date === day);
  const ownHours = (await zoe.session.request("/api/hours?" + future)).people.find((p: any) => p.key === zoe.id)?.rows.find((r: any) => r.shift?.id === planned.id);
  const liveRow = (await admin.request("/api/timesheet?" + future + "&userId=" + zoe.id)).rows.find((r: any) => r.date === day);
  check(frozenRow?.planFrom === "03:10" && frozenRow.status === "geplant" && ownHours?.shift.from === "03:10", "timesheet: while the plan is edited the own timesheet and hours show the published plan (frozen snapshot)");
  check(liveRow?.planFrom === "04:10", "timesheet: planners see the live shift while the plan is edited");
  await admin.request("/api/schedules/" + futurePlan.id + "/editing", "DELETE");
  check((await zoe.session.request("/api/timesheet?" + future)).rows.find((r: any) => r.date === day)?.planFrom === "03:10", "timesheet: after discarding, the published plan stays");

  // Zuschlaege dieser Reihe entfernen, damit folgende Reihen unberuehrt bleiben.
  for (const s of [night, holiday]) await admin.request("/api/payroll/surcharges/" + s.id, "DELETE");
}
