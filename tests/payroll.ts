/*
 * Lohn (P1) ueber die echte API: nur Administration, Organisationsgrenzen,
 * Lohnarten, Personalnummern, Zuschlaege, Lohnart je Arbeitsbereich ueber eine
 * veroeffentlichte Schicht, Auswertung und CSV-Export. Teil von tests/workflows.ts
 * (TEST_ONLY=payroll). Dazu die Hauptlinie: Feiertage nach Bundesland des
 * Einsatzorts mit Hinweis bei fehlendem Bundesland, Zeiten einer geloeschten
 * Person (FormerEmployee) und Sub-Platzhalter in derselben Schicht.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { TestContext } from "./permissions";
import { newPerson, planner } from "./people";

export async function payrollTests(t: TestContext) {
  const { users, check } = t;
  const session = async (email: string) => { const s = new t.Session(); await s.login(email); return s; };
  const admin = await session(users.admin.email), mA = await session(users.managerA.email), sA = await session(users.staffA.email), foreign = await session(users.foreign.email);
  const period = "from=2025-06-01&to=2025-06-30";

  // --- Nur die Administration ---------------------------------------------------
  for (const [label, s] of [["manager", mA], ["employee", sA]] as const) {
    await s.request("/api/payroll/settings", "GET", undefined, 403);
    await s.request("/api/payroll/report?" + period, "GET", undefined, 403);
    await s.request("/api/payroll/export?" + period, "GET", undefined, 403);
    await s.request("/api/payroll/pay-types", "POST", { title: "Versuch", hourlyRateCents: 100 }, 403);
    check(true, label + " gets no payroll data and cannot change settings");
    // Jede Lohn-Schnittstelle prueft die Rolle vor allem anderen, auch fuer die eigene Mitgliedschaft.
    const own = label === "manager" ? users.managerA.memberId : users.staffA.memberId;
    await s.request("/api/payroll/members/" + own, "PATCH", { personnelNumber: "1" }, 403);
    await s.request("/api/payroll/pay-types/x", "PATCH", { hourlyRateCents: 1 }, 403);
    await s.request("/api/payroll/pay-types/x", "DELETE", undefined, 403);
    await s.request("/api/payroll/surcharges", "POST", { name: "Versuch", weekdays: [1], rateKind: "AMOUNT", rate: 100 }, 403);
    await s.request("/api/payroll/surcharges/x", "PATCH", { name: "Versuch", weekdays: [1], rateKind: "AMOUNT", rate: 100 }, 403);
    await s.request("/api/payroll/surcharges/x", "DELETE", undefined, 403);
    await s.request("/api/payroll/divisions/x", "PATCH", { payTypeId: null }, 403);
    check(true, label + " cannot set personnel numbers (not even the own), pay types of work areas or surcharges");
  }

  // --- Lohnarten ------------------------------------------------------------------
  const normal = (await admin.request("/api/payroll/pay-types", "POST", { title: "Normalstunden", hourlyRateCents: 1500, code: "100" }, 201)).payType;
  await admin.request("/api/payroll/pay-types", "POST", { title: "normalstunden", hourlyRateCents: 1600 }, 409);
  await admin.request("/api/payroll/pay-types", "POST", { title: "Negativ", hourlyRateCents: -1 }, 400);
  const area = (await admin.request("/api/payroll/pay-types", "POST", { title: "Objektzulage", hourlyRateCents: 1800, code: "110" }, 201)).payType;
  const foreignType = (await foreign.request("/api/payroll/pay-types", "POST", { title: "Fremd", hourlyRateCents: 2000 }, 201)).payType;
  check(normal.hourlyRateCents === 1500 && normal.code === "100" && normal.isActive, "pay type is stored with rate in cents and code");

  // --- Personalnummer und Lohnart je Person ----------------------------------------
  const staffB = "/api/payroll/members/" + users.staffB.memberId;
  await admin.request(staffB, "PATCH", { personnelNumber: " 4711 ", payTypeId: normal.id });
  await admin.request("/api/payroll/members/" + users.loner.memberId, "PATCH", { personnelNumber: "4711" }, 409);
  await admin.request(staffB, "PATCH", { payTypeId: foreignType.id }, 404);
  const settings = await admin.request("/api/payroll/settings");
  const row = settings.members.find((m: any) => m.memberId === users.staffB.memberId);
  check(row.personnelNumber === "4711" && row.payTypeId === normal.id, "personnel number is trimmed and stored with the pay type");
  check(!settings.payTypes.some((p: any) => p.id === foreignType.id) && !settings.members.some((m: any) => m.userId === users.foreign.id), "settings show only the own organisation");

  // --- Zuschlaege --------------------------------------------------------------------
  const night = (await admin.request("/api/payroll/surcharges", "POST", { name: "Nacht", code: "200", weekdays: [7, 1, 2, 3, 4, 5, 6, 1], timeFrom: "20:00", timeTo: "06:00", rateKind: "PERCENT", rate: 2500 }, 201)).surcharge;
  check(night.weekdays.join() === "1,2,3,4,5,6,7" && night.allPeople && night.allDivisions, "weekdays are de-duplicated and sorted; default is everyone");
  await admin.request("/api/payroll/surcharges", "POST", { name: "Ohne Tage", rateKind: "AMOUNT", rate: 100 }, 400);
  await admin.request("/api/payroll/surcharges", "POST", { name: "Fremde Person", weekdays: [1], allPeople: false, userIds: [users.foreign.id], rateKind: "AMOUNT", rate: 100 }, 404);
  await admin.request("/api/payroll/surcharges", "POST", { name: "Leere Auswahl", weekdays: [1], allPeople: false, userIds: [], rateKind: "AMOUNT", rate: 100 }, 400);
  await admin.request("/api/payroll/surcharges", "POST", { name: "Falsches Datum", dates: ["24.12."], rateKind: "AMOUNT", rate: 100 }, 400);
  const onlyLoner = (await admin.request("/api/payroll/surcharges", "POST", { name: "Nur Edda", weekdays: [1], allPeople: false, userIds: [users.loner.id], rateKind: "AMOUNT", rate: 500 }, 201)).surcharge;

  // --- Arbeitsbereich mit eigener Lohnart, ueber eine veroeffentlichte Schicht -------
  const division = (await admin.request("/api/divisions", "POST", { title: "Lohn-Bereich", color: "#0ea5e9" }, 201)).division;
  await admin.request("/api/payroll/divisions/" + division.id, "PATCH", { payTypeId: area.id });
  const customer = (await admin.request("/api/customers", "POST", { name: "Kunde Lohn" })).customer;
  const branch = (await admin.request("/api/branches", "POST", { customerId: customer.id, name: "Objekt Lohn" })).branch;
  await admin.request("/api/employees/" + users.staffB.memberId + "/access", "PUT", { kind: "branch", branchId: branch.id, rights: ["REQUEST_SHIFTS"] });
  // Montag 16.06.2025 = KW 25/2025
  const plan = (await admin.request("/api/schedules?kw=25&year=2025&standort=" + branch.id)).schedule;
  const shift = (await admin.request("/api/shifts", "POST", { scheduleId: plan.id, dayOfWeek: 1, shiftFrom: "22:00", shiftTo: "06:00", maxEmployees: 1, divisionId: division.id, title: "Nacht Lohn" })).shifts[0];
  await admin.request("/api/bookings", "POST", { shiftId: shift.id, userId: users.staffB.id, confirm: true });
  await admin.request("/api/schedules/" + plan.id, "PATCH", { isPublic: true });

  await admin.request("/api/time", "POST", { type: "MANUAL", userId: users.staffB.id, date: "2025-06-16", timeFrom: "22:00", timeTo: "06:00" }, 201);
  await admin.request("/api/time", "POST", { type: "MANUAL", userId: users.staffB.id, date: "2025-06-18", timeFrom: "08:00", timeTo: "12:30", breakMinutes: 30 }, 201);

  const report = await admin.request("/api/payroll/report?" + period);
  const person = report.people.find((p: any) => p.userId === users.staffB.id);
  // Nacht: 8 h x 18 € = 144 € + 25 % von 18 € x 8 h = 36 €; Tag: 4 h x 15 € = 60 €
  check(person.minutes === 720 && person.totalCents === 24000, "staffB: 12 h and 240,00 € in June 2025");
  const nightRecord = person.records.find((r: any) => r.date === "2025-06-16");
  check(nightRecord.divisionTitle === "Lohn-Bereich" && nightRecord.lines[0].refId === area.id && nightRecord.lines[0].amountCents === 14400, "record inside a published shift is paid with the work area's pay type");
  check(nightRecord.lines.some((l: any) => l.refId === night.id && l.minutes === 480 && l.amountCents === 3600), "night surcharge: 8 h x 25 % of 18,00 € = 36,00 €");
  check(!nightRecord.lines.some((l: any) => l.refId === onlyLoner.id), "surcharge for selected people does not apply to others");
  const dayRecord = person.records.find((r: any) => r.date === "2025-06-18");
  check(dayRecord.divisionTitle === null && dayRecord.lines.length === 1 && dayRecord.lines[0].refId === normal.id && dayRecord.lines[0].amountCents === 6000, "record without a shift uses the person's pay type");
  check(person.lines.length === 3 && person.warnings.length === 0, "sums per pay type and surcharge without warnings");
  check(!report.people.some((p: any) => p.userId === users.foreign.id), "report contains only the own organisation");
  const branchOnly = await admin.request("/api/payroll/report?" + period + "&standort=" + branch.id);
  check(branchOnly.people.find((p: any) => p.userId === users.staffB.id)?.minutes === 480, "site filter keeps only records assigned to the site");
  await admin.request("/api/payroll/report?" + period + "&standort=nicht-vorhanden", "GET", undefined, 404);
  await admin.request("/api/payroll/report?from=2025-06-30&to=2025-06-01", "GET", undefined, 400);
  await admin.request("/api/payroll/report?from=2024-01-01&to=2025-06-30", "GET", undefined, 400);

  // --- Export ----------------------------------------------------------------------
  const csv: string = await admin.request("/api/payroll/export?" + period);
  check(csv.includes('"4711";"Zweier";"Elke";"Lohnart";"Objektzulage";"110";"8,00";"";"18,00";"144,00"'), "export: base line with personnel number, code, hours, rate and amount");
  check(csv.includes('"4711";"Zweier";"Elke";"Zuschlag";"Nacht";"200";"8,00";"25 %";"4,50";"36,00"'), "export: surcharge line with percent and resulting rate");
  const hoursOnly: string = await admin.request("/api/payroll/export?" + period + "&saetze=0");
  check(hoursOnly.includes('"4711";"Zweier";"Elke";"Lohnart";"Normalstunden";"100";"4,00"') && !hoursOnly.includes("144,00") && !hoursOnly.includes("Betrag"), "export without rates contains hours only");
  const skipped: string = await admin.request("/api/payroll/export?" + period + "&ohne=" + users.staffB.id);
  check(!skipped.includes("4711"), "people can be left out of the export");

  // --- Fremdzugriff und Loeschen ---------------------------------------------------
  await foreign.request("/api/payroll/pay-types/" + area.id, "PATCH", { hourlyRateCents: 1 }, 404);
  await foreign.request("/api/payroll/surcharges/" + night.id, "DELETE", undefined, 404);
  await foreign.request(staffB, "PATCH", { personnelNumber: "1" }, 404);
  await foreign.request("/api/payroll/divisions/" + division.id, "PATCH", { payTypeId: null }, 404);
  await foreign.request("/api/payroll/report?" + period + "&standort=" + branch.id, "GET", undefined, 404);
  await foreign.request("/api/payroll/export?" + period + "&standort=" + branch.id, "GET", undefined, 404);
  check(true, "foreign organisation: pay types, surcharges, people, work areas and sites of this organisation answer 404");
  await admin.request("/api/payroll/pay-types/" + normal.id, "DELETE", undefined, 409);
  await admin.request("/api/payroll/pay-types/" + area.id, "PATCH", { isActive: false });
  const inactive = (await admin.request("/api/payroll/report?" + period)).people.find((p: any) => p.userId === users.staffB.id);
  check(inactive.records.find((r: any) => r.date === "2025-06-16").lines[0].refId === normal.id, "inactive work-area pay type falls back to the person's pay type");
  await admin.request("/api/payroll/surcharges/" + onlyLoner.id, "DELETE");
  await admin.request(staffB, "PATCH", { payTypeId: null });
  await admin.request("/api/payroll/pay-types/" + normal.id, "DELETE");
  const unpaid = (await admin.request("/api/payroll/report?" + period)).people.find((p: any) => p.userId === users.staffB.id);
  check(unpaid.records.find((r: any) => r.date === "2025-06-18").warnings.includes("Keine Lohnart hinterlegt."), "without any pay type the record shows a warning");

  // --- Feiertag nach Bundesland des Einsatzorts ------------------------------------------
  // Fronleichnam 19.06.2025 (Donnerstag, KW 25): Feiertag in NRW, nicht in Thueringen.
  const holiday = (await admin.request("/api/payroll/surcharges", "POST", { name: "Feiertag", code: "300", holidays: true, rateKind: "AMOUNT", rate: 1000 }, 201)).surcharge;
  const cologne = (await admin.request("/api/branches", "POST", { customerId: customer.id, name: "Objekt Köln", holidayState: "NW" })).branch;
  const jena = (await admin.request("/api/branches", "POST", { customerId: customer.id, name: "Objekt Jena", holidayState: "TH" })).branch;
  const fiona = await newPerson(t, admin, "pay.fiona", "Fiona", "Feiertag", "EMPLOYEE", [cologne.id, jena.id, branch.id]);
  await admin.request("/api/payroll/members/" + fiona.memberId, "PATCH", { personnelNumber: "4720" });
  const siteType = (await admin.request("/api/payroll/pay-types", "POST", { title: "Zulage Köln", hourlyRateCents: 2000, code: "120" }, 201)).payType;
  const siteArea = (await admin.request("/api/divisions", "POST", { title: "Lohn-Bereich Köln", color: "#22c55e" }, 201)).division;
  await admin.request("/api/payroll/divisions/" + siteArea.id, "PATCH", { payTypeId: siteType.id });
  const cologneplan = planner(admin, cologne.id);
  const corpus = await cologneplan.shift("2025-06-19", "08:00", "12:00", 2, { divisionId: siteArea.id, title: "Fronleichnam" });
  await cologneplan.book(corpus.id, fiona.id);
  // Sub-Platzhalter in derselben Schicht: hat keine Zeiten und stoert die Zuordnung nicht.
  const sub = (await admin.request("/api/subcontractors", "POST", { name: "Sub Lohn" })).subcontractor;
  const placeholder = (await admin.request("/api/subcontractors/" + sub.id + "/workers", "POST", { name: "Posten 1" })).worker;
  await admin.request("/api/contractor-bookings", "POST", { shiftId: corpus.id, contractorWorkerId: placeholder.id, confirm: true });
  await cologneplan.publish("2025-06-19");
  const work = (branchId: string, timeFrom: string, timeTo: string) => admin.request("/api/time", "POST", { type: "MANUAL", userId: fiona.id, date: "2025-06-19", timeFrom, timeTo, branchId }, 201);
  await work(cologne.id, "08:00", "12:00");
  await work(jena.id, "13:00", "15:00");
  await work(branch.id, "16:00", "18:00");
  const byState = await admin.request("/api/payroll/report?" + period);
  const fionaRow = byState.people.find((p: any) => p.userId === fiona.id);
  const at = (row: any, from: string) => row.records.find((r: any) => r.timeFrom === from);
  const holidayLine = (row: any, from: string) => at(row, from).lines.find((l: any) => l.refId === holiday.id);
  check(holidayLine(fionaRow, "08:00")?.minutes === 240 && holidayLine(fionaRow, "08:00").amountCents === 4000 && at(fionaRow, "08:00").lines[0].refId === siteType.id && at(fionaRow, "08:00").lines[0].amountCents === 8000,
    "Corpus Christi at a site in NRW: holiday surcharge 4 h x 10 € on top of the work area's pay type (shift shared with a placeholder)");
  check(!holidayLine(fionaRow, "13:00") && !holidayLine(fionaRow, "16:00"), "the same day at a site in Thuringia and at a site without federal state: no holiday surcharge");
  check(byState.notices.some((n: string) => n.startsWith("Für Einsatzort Objekt Lohn ist kein Bundesland festgelegt")) && !byState.notices.some((n: string) => n.includes("Objekt Köln") || n.includes("Objekt Jena")), "the payroll page names the site without federal state instead of a silent 0");
  const orgHolidays = (await admin.request("/api/holidays")).holidays.length;
  check(orgHolidays > 0 || byState.notices.some((n: string) => n.includes("Zeiten ohne Einsatzort")), "records without a site and no organisation holidays are pointed out as well");
  check((await admin.request("/api/payroll/report?" + period + "&standort=" + cologne.id)).notices.length === 0, "no notice when the selected site has a federal state");
  check(byState.people.every((p: any) => p.userId || p.key.startsWith("former:")), "placeholders have no times and no payroll row");

  // --- Geloeschte Person: Zeiten bleiben im Lohn, mit dem Namen der Momentaufnahme -------------
  const deleted = await admin.request("/api/employees/" + fiona.memberId, "DELETE");
  check(deleted.deleted === true && deleted.historyKept.timeRecords === 3 && deleted.historyKept.bookings === 1, "setup: the person is deleted, times and the past assignment are kept");
  const afterDelete = await admin.request("/api/payroll/report?" + period);
  const formerRow = afterDelete.people.find((p: any) => p.former && p.lastName === "Feiertag");
  check(formerRow && formerRow.userId === null && formerRow.memberId === null && formerRow.key.startsWith("former:") && formerRow.firstName === "Fiona" && formerRow.personnelNumber === null && formerRow.minutes === 480,
    "deleted person: own row with the kept name, without account and personnel number, all 8 hours");
  check(formerRow.totalCents === fionaRow.totalCents && holidayLine(formerRow, "08:00")?.amountCents === 4000 && at(formerRow, "08:00").lines[0].refId === siteType.id,
    "deleted person: work area via the kept assignment and holiday by site, same pay as before");
  check(formerRow.warnings.some((w: string) => w.startsWith("Gelöschte Person")) && !afterDelete.people.some((p: any) => p.userId === fiona.id), "deleted person: warning about the lost personnel number and pay type, no row for the old account");
  const formerCsv: string = await admin.request("/api/payroll/export?" + period);
  check(formerCsv.includes('"";"Feiertag";"Fiona";"Zuschlag";"Feiertag";"300";"4,00";"";"10,00";"40,00"') && formerCsv.includes('"";"Feiertag";"Fiona";"Lohnart";"Zulage Köln";"120";"4,00";"";"20,00";"80,00"'), "export: deleted person with name, without personnel number");
  check(!(await admin.request("/api/payroll/export?" + period + "&ohne=" + encodeURIComponent(formerRow.key))).includes('"Fiona"'), "export: a deleted person can be left out by key");
  check(!(await foreign.request("/api/payroll/report?" + period)).people.some((p: any) => p.lastName === "Feiertag"), "deleted person stays inside the own organisation");
}
