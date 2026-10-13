/*
 * Abwesenheit wirkt auf Schichten, Stunden, Lohn und Zeitkonto (Port P5) ueber
 * die echte API: Vorschau mit Rechten, Genehmigen mit Vorgabe und Abweichung je
 * Schicht, "Person austragen" ueber die Buchungslogik (Antraege, Nachricht,
 * Echtzeit-Signal, Platzhalter bleiben), Konflikttext, Lohnzeile mit Code,
 * Export, Stundenzettel, Zeitkonto, Sichtbarkeit der Art, Zuruecknehmen,
 * vergangene Schicht, Plan in Bearbeitung und Entwurf, geloeschte Person.
 * Teil von tests/workflows.ts (TEST_ONLY=absence-effects); eigene Personen,
 * eigener Standort und Wochen weit in der Zukunft (Austragen geht nur vor
 * Schichtende), dazu eine vergangene Woche.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { io, type Socket } from "socket.io-client";
import { addDate, berlinDate, isoWeek, weekDate } from "../src/lib/berlin";
import type { TestContext } from "./permissions";
import { inboxCount, newPerson, planner } from "./people";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function absenceEffectTests(t: TestContext) {
  const { users, check } = t;
  const session = async (email: string) => { const s = new t.Session(); await s.login(email); return s; };
  const admin = await session(users.admin.email), mA = await session(users.managerA.email), mB = await session(users.managerB.email), foreign = await session(users.foreign.email);

  // --- Aufbau: eigener Standort, eigene Personen, Abwesenheitsart mit Lohnart-Code -------------
  const customer = (await admin.request("/api/customers", "POST", { name: "Kunde Abwesenheitswirkung" })).customer;
  const branch = (await admin.request("/api/branches", "POST", { customerId: customer.id, name: "Objekt Abwesenheitswirkung" })).branch;
  const eva = await newPerson(t, admin, "abw.eva", "Eva", "Abwesend", "EMPLOYEE", [branch.id]);
  const ole = await newPerson(t, admin, "abw.ole", "Ole", "Kollege", "EMPLOYEE", [branch.id]);
  const category = (await admin.request("/api/absences/categories", "POST", { name: "Urlaub Wirkung", color: "#16a34a", isPaid: true, payCode: "500" }, 201)).category;
  const unpaid = (await admin.request("/api/absences/categories", "POST", { name: "Unbezahlt Wirkung", color: "#64748b", isPaid: false }, 201)).category;
  const normal = (await admin.request("/api/payroll/pay-types", "POST", { title: "Normal Wirkung", hourlyRateCents: 1600, code: "101" }, 201)).payType;
  await admin.request("/api/payroll/members/" + eva.memberId, "PATCH", { payTypeId: normal.id });
  const sub = (await admin.request("/api/subcontractors", "POST", { name: "Sub Abwesenheitswirkung" })).subcontractor;
  const worker = (await admin.request("/api/subcontractors/" + sub.id + "/workers", "POST", { name: "Platzhalter 1" })).worker;

  const future = isoWeek(addDate(berlinDate(), 210)), mon = weekDate(future.year, future.weekNumber), sun = addDate(mon, 6);
  const [tue, wed, thu] = [1, 2, 3].map((n) => addDate(mon, n));
  const period = "from=" + mon + "&to=" + sun;
  const P = planner(admin, branch.id);
  const shift = (day: string, max = 1) => P.shift(day, "08:00", "16:00", max, { title: "Empfang", pauseOption: "PER_SHIFT", pauseValue: 30 });
  const [sMon, sTue, sWed, sThu] = [await shift(mon), await shift(tue), await shift(wed), await shift(thu, 3)];
  for (const s of [sMon, sTue, sWed, sThu]) await P.book(s.id, eva.id);
  await P.book(sThu.id, ole.id);
  await admin.request("/api/contractor-bookings", "POST", { shiftId: sThu.id, contractorWorkerId: worker.id, confirm: true });
  await P.publish(mon);
  const preview = (s: any, from: string, to: string, userId = eva.id, cat = category.id, status = 200) => s.request("/api/absences/effects?userId=" + userId + "&from=" + from + "&to=" + to + "&categoryId=" + cat, "GET", undefined, status);

  // --- Vorschau: Rechte und Angaben ---------------------------------------------------------------
  const full = await preview(admin, mon, thu);
  check(full.shifts.length === 4 && full.defaultHandling === "PAID" && full.shifts.every((s: any) => s.canRelease && s.plannedMinutes === 450 && s.branchName === "Objekt Abwesenheitswirkung" && s.published && !s.ended && !s.editing),
    "preview lists the four planned shifts with site; paid category defaults to counting hours; all can be released");
  check((await preview(admin, mon, mon, eva.id, unpaid.id)).defaultHandling === "UNPAID", "unpaid category defaults to 0 hours");
  await preview(eva.session, mon, thu, eva.id, category.id, 404);
  await preview(mB, mon, thu, eva.id, category.id, 404);
  await preview(foreign, mon, thu, eva.id, category.id, 404);
  await admin.request("/api/employees/" + users.managerA.memberId + "/access", "PUT", { kind: "staff", memberId: eva.memberId, rights: ["VIEW_HOURS", "MANAGE_ABSENCES"] });
  const limited = await preview(mA, mon, thu);
  check(limited.shifts.length === 4 && limited.shifts.every((s: any) => !s.canRelease && s.branchName === null && s.customerName === null && s.title === null),
    "manager deciding absences without plan rights: shifts without site details and without 'Person austragen'");

  // --- Offener Antrag und Echtzeit vor dem Austragen -------------------------------------------
  const swap = (await eva.session.request("/api/mod-requests", "POST", { shiftId: sWed.id, kind: "SWAP" })).request;
  check(swap.state === "OPEN", "open swap request of the person on Wednesday");
  const socket: Socket = io(t.base, { path: "/api/ws", transports: ["websocket"], extraHeaders: { Cookie: admin.cookie() }, reconnection: false, forceNew: true });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Socket-Verbindung kam nicht zustande")), 10000);
    socket.once("connect", () => { clearTimeout(timer); resolve(); });
    socket.once("connect_error", (error) => { clearTimeout(timer); reject(error); });
  });
  await sleep(800);
  const signals: string[] = [];
  socket.on("booking:changed", () => signals.push("booking:changed"));
  socket.on("schedule:updated", () => signals.push("schedule:updated"));
  const removedBefore = await inboxCount(eva.session, "Schichtzuweisung aufgehoben");
  let absence: any;
  try {
    // --- Genehmigt eintragen: Mo bezahlt, Di 0 Stunden, Mi und Do austragen, +2 h Ausgleich -------
    await admin.request("/api/absences", "POST", { userId: eva.id, categoryId: category.id, dateFrom: mon, dateTo: thu, status: "APPROVED", effects: { default: "PAID", shifts: { nicht: "UNPAID" } } }, 400);
    await eva.session.request("/api/absences", "POST", { userId: eva.id, categoryId: category.id, dateFrom: mon, dateTo: thu, effects: { default: "PAID" } }, 400);
    absence = (await admin.request("/api/absences", "POST", { userId: eva.id, categoryId: category.id, dateFrom: mon, dateTo: thu, status: "APPROVED", effects: { default: "PAID", shifts: { [sTue.id]: "UNPAID", [sWed.id]: "RELEASED", [sThu.id]: "RELEASED" }, compensationHours: 2 } }, 201)).absence;
    check(absence.status === "APPROVED" && absence.approvedById === users.admin.id && absence.approvedAt, "approval is stored with approver and time");
    const start = Date.now();
    while (!signals.includes("booking:changed") && Date.now() - start < 6000) await sleep(100);
    check(signals.includes("booking:changed") && signals.includes("schedule:updated"), "taking the person out sends booking:changed like 'Zuweisung aufheben', besides schedule:updated");
  } finally {
    socket.close();
  }
  const rowsOf = async (s: any = admin, userId = eva.id) => (await s.request("/api/hours?" + period)).people.find((p: any) => p.userId === userId).rows;
  let rows = await rowsOf();
  const row = (sh: { id: string }) => rows.find((r: any) => r.shift?.id === sh.id);
  check(row(sMon).status === "ABSENT" && row(sMon).absence.handling === "PAID" && row(sMon).absence.category === "Urlaub Wirkung" && row(sMon).istMinutes === 450, "Monday: absent, paid with 7,5 planned hours");
  check(row(sTue).status === "ABSENT" && row(sTue).absence.handling === "UNPAID" && row(sTue).istMinutes === 0, "Tuesday: absent, counts 0 hours");
  check(!row(sWed) && !row(sThu), "Wednesday and Thursday: the person was taken out");
  const thursday = await P.view(sThu.id, thu);
  check((await P.view(sWed.id, wed)).bookings.length === 0 && thursday.bookings.length === 2 && thursday.bookings.some((b: any) => b.userId === ole.id) && thursday.bookings.some((b: any) => b.contractorWorkerId === worker.id),
    "the shifts are open again; colleague and subcontractor placeholder stay in the shared shift");
  check(await inboxCount(eva.session, "Schichtzuweisung aufgehoben") === removedBefore + 2, "published plan: the person gets one message per released shift, as with 'Zuweisung aufheben'");
  check((await eva.session.request("/api/messages?folder=inbox")).messages.some((m: any) => m.subject === "Schichtzuweisung aufgehoben" && m.body.includes("genehmigten Abwesenheit")), "the message names the approved absence");
  check((await eva.session.request("/api/mod-requests")).requests.find((r: any) => r.id === swap.id)?.state === "DECLINED", "the open request for the released shift is declined like on 'Zuweisung aufheben'");
  check(row(sMon).absence.pay.totalCents === 12000 && row(sMon).absence.pay.lines[0].code === "500", "paid absence: 7,5 h x 16,00 € = 120,00 € with the category's payroll code");

  // --- Konfliktpruefung: bleibt rot, nennt den Umgang -----------------------------------------------
  const conflicts = (await admin.request("/api/schedules/conflicts?kw=" + future.weekNumber + "&year=" + future.year + "&standort=" + branch.id)).items.filter((c: any) => c.kind === "absence");
  check(conflicts.length === 2 && conflicts.find((c: any) => c.shiftId === sMon.id)?.text === "Genehmigte Abwesenheit (bezahlt)." && conflicts.find((c: any) => c.shiftId === sTue.id)?.text === "Genehmigte Abwesenheit (0 Stunden)." && conflicts.every((c: any) => c.severity === "fehler"),
    "conflict panel: still red for the absent person who stays assigned, with the chosen handling and without the absence type");

  // --- Lohn, Export, Zeitkonto, Stundenzettel ---------------------------------------------------------
  const pay = (await admin.request("/api/payroll/report?" + period)).people.find((p: any) => p.userId === eva.id);
  check(pay.lines.some((l: any) => l.kind === "ABSENCE" && l.title === "Abwesenheit: Urlaub Wirkung" && l.minutes === 450 && l.amountCents === 12000 && l.code === "500"), "payroll has an absence line with the category code");
  const csv: string = await admin.request("/api/payroll/export?" + period);
  check(csv.includes('"Abwesenheit";"Abwesenheit: Urlaub Wirkung";"500";"7,50"'), "export row for the paid absence");
  const account = await admin.request("/api/time-accounts?userId=" + eva.id + "&to=" + sun);
  check(account.compensations.some((c: any) => c.minutes === 120 && c.date === mon && c.description.includes("Urlaub Wirkung")), "compensation of +2 h is booked on the first day");
  const sheet = await eva.session.request("/api/timesheet?" + period);
  check(sheet.rows.some((r: any) => r.date === mon && r.status === "abwesend: Urlaub Wirkung (bezahlt)" && r.minutes === 450), "own timesheet shows the paid absence with its type");

  // --- Art der Abwesenheit nur fuer Berechtigte; Lohnart-Code nur fuer die Administration -----------------
  await admin.request("/api/employees/" + users.managerA.memberId + "/access", "PUT", { kind: "branch", branchId: branch.id, rights: ["VIEW_TIME"] });
  check((await rowsOf(mA)).find((r: any) => r.shift?.id === sMon.id)?.absence.category === "Urlaub Wirkung", "manager who decides the person's absences sees the type in hours");
  await admin.request("/api/employees/" + users.managerA.memberId + "/access", "PUT", { kind: "staff", memberId: eva.memberId, rights: ["VIEW_HOURS"] });
  const hidden = (await rowsOf(mA)).find((r: any) => r.shift?.id === sMon.id);
  check(hidden?.status === "ABSENT" && hidden.absence.category === null && hidden.absence.handling === "PAID" && hidden.absence.pay === null, "manager with 'Stunden einsehen' only: absent and paid, but no type and no pay");
  const ownCategories = (await eva.session.request("/api/absences/categories")).categories;
  check(ownCategories.some((c: any) => c.id === category.id) && ownCategories.every((c: any) => !("payCode" in c)) && (await admin.request("/api/absences/categories")).categories.find((c: any) => c.id === category.id)?.payCode === "500",
    "payroll code of a category only for the administration");

  // --- Zuruecknehmen und erneut genehmigen ------------------------------------------------------------
  await admin.request("/api/absences/" + absence.id, "PATCH", { status: "PENDING" });
  rows = await rowsOf();
  check(row(sMon).status === "PLANNED" && !(await admin.request("/api/payroll/report?" + period)).people.find((p: any) => p.userId === eva.id).lines.some((l: any) => l.kind === "ABSENCE"), "no longer approved: no effect, no absence pay; released shifts stay open");
  await admin.request("/api/absences/" + absence.id, "PATCH", { effects: { default: "UNPAID" } }, 400);
  await admin.request("/api/absences/" + absence.id, "PATCH", { status: "APPROVED" });
  rows = await rowsOf();
  check(rows.filter((r: any) => r.status === "ABSENT" && r.absence.handling === "PAID").length === 2, "approved again without choices: category default for both remaining shifts");

  // --- Rechte: Austragen nur mit "Schichten bearbeiten" am Standort --------------------------------------
  await admin.request("/api/employees/" + users.managerA.memberId + "/access", "PUT", { kind: "staff", memberId: eva.memberId, rights: ["VIEW_HOURS", "MANAGE_ABSENCES"] });
  const denied = await mA.request("/api/absences/" + absence.id, "PATCH", { effects: { shifts: { [sMon.id]: "RELEASED" } } }, 403);
  check(denied.error.includes("Schichten bearbeiten") && (await P.view(sMon.id, mon)).bookings.length === 1, "manager without planning rights cannot take the person out; the assignment stays");
  await mA.request("/api/absences/" + absence.id, "PATCH", { effects: { shifts: { [sMon.id]: "UNPAID" } } });
  check((await rowsOf()).find((r: any) => r.shift?.id === sMon.id).absence.handling === "UNPAID", "manager with absence rights changes the decision per shift");
  await eva.session.request("/api/absences/" + absence.id, "PATCH", { effects: { shifts: { [sMon.id]: "PAID" } } }, 400);
  await admin.request("/api/employees/" + users.managerA.memberId + "/access", "PUT", { kind: "branch", branchId: branch.id, rights: ["VIEW_SCHEDULE", "EDIT_SHIFTS", "VIEW_TIME"] });
  check((await preview(mA, mon, thu)).shifts.every((s: any) => s.canRelease && s.branchName === "Objekt Abwesenheitswirkung"), "with 'Schichten bearbeiten' at the site the manager may take the person out");
  await admin.request("/api/absences/" + absence.id, "DELETE");
  check(!(await rowsOf()).some((r: any) => r.status === "ABSENT"), "deleted absence: the effects are gone");

  // --- Vergangene Schicht: austragen geht nicht, Zuweisung bleibt Nachweis -------------------------------
  const past = addDate(berlinDate(), -14);
  const sPast = await P.shift(past, "08:00", "16:00", 1, { title: "Vergangen" });
  await P.book(sPast.id, ole.id);
  const pia = await newPerson(t, admin, "abw.pia", "Pia", "Geloescht", "EMPLOYEE", [branch.id]);
  const sPia = await P.shift(past, "06:00", "07:00", 1, { title: "Vergangen Pia" });
  await P.book(sPia.id, pia.id);
  await P.publish(past);
  const pastPreview = await preview(admin, past, past, ole.id);
  check(pastPreview.shifts.length === 1 && pastPreview.shifts[0].ended && !pastPreview.shifts[0].canRelease, "ended shift: preview offers no 'Person austragen'");
  const before = (await admin.request("/api/absences?userId=" + ole.id)).absences.length;
  const refused = await admin.request("/api/absences", "POST", { userId: ole.id, categoryId: category.id, dateFrom: past, dateTo: past, status: "APPROVED", effects: { shifts: { [sPast.id]: "RELEASED" } } }, 409);
  check(refused.error.includes("bereits beendet") && (await admin.request("/api/absences?userId=" + ole.id)).absences.length === before && (await P.view(sPast.id, past)).bookings.length === 1, "releasing an ended shift is refused as a whole: no absence, the assignment stays");

  // --- Plan in Bearbeitung und Entwurf: keine Einzelmitteilung ------------------------------------------
  const next = addDate(mon, 7), draftDay = addDate(mon, 14), nextWeek = isoWeek(next);
  const sNext = await shift(next), sDraft = await shift(draftDay);
  await P.book(sNext.id, eva.id);
  await P.book(sDraft.id, eva.id);
  await P.publish(next);
  const plan = (await admin.request("/api/schedules?kw=" + nextWeek.weekNumber + "&year=" + nextWeek.year + "&standort=" + branch.id)).schedule;
  await admin.request("/api/schedules/" + plan.id + "/editing", "POST");
  const messagesBefore = await inboxCount(eva.session, "Schichtzuweisung aufgehoben");
  await admin.request("/api/absences", "POST", { userId: eva.id, categoryId: category.id, dateFrom: next, dateTo: next, status: "APPROVED", effects: { default: "RELEASED" } }, 201);
  await admin.request("/api/absences", "POST", { userId: eva.id, categoryId: category.id, dateFrom: draftDay, dateTo: draftDay, status: "APPROVED", effects: { default: "RELEASED" } }, 201);
  check(await inboxCount(eva.session, "Schichtzuweisung aufgehoben") === messagesBefore, "plan in editing and draft: taking the person out sends no single message");
  check((await P.view(sNext.id, next)).bookings.length === 0 && (await P.view(sDraft.id, draftDay)).bookings.length === 0, "the live assignments are gone");
  const frozen = (await eva.session.request("/api/schedules?kw=" + nextWeek.weekNumber + "&year=" + nextWeek.year)).schedule.shifts.find((s: any) => s.id === sNext.id);
  check(frozen?.bookings.some((b: any) => b.userId === eva.id), "while editing, the person still sees the published state with the own assignment");
  const published = await admin.request("/api/schedules/" + plan.id, "PATCH", { isPublic: true });
  check(published.schedule.status === "PUBLISHED" && (await eva.session.request("/api/messages?folder=inbox")).messages.some((m: any) => m.subject.startsWith("Dienstplan") && m.subject.endsWith("aktualisiert") && m.body.includes("Entfällt")),
    "publishing announces the release with the bundled message");

  // --- Geloeschte Person: Wirkungen entfallen mit der Person, kein Absturz --------------------------------
  await admin.request("/api/absences", "POST", { userId: pia.id, categoryId: category.id, dateFrom: past, dateTo: past, status: "APPROVED" }, 201);
  const pastPeriod = "from=" + addDate(past, -1) + "&to=" + addDate(past, 1);
  check((await admin.request("/api/payroll/report?" + pastPeriod)).people.find((p: any) => p.userId === pia.id)?.lines.some((l: any) => l.kind === "ABSENCE"), "before deleting: paid absence in payroll");
  await admin.request("/api/employees/" + pia.memberId, "DELETE");
  const afterHours = await admin.request("/api/hours?" + pastPeriod);
  const formerRow = afterHours.people.find((p: any) => p.former && p.firstName === "Pia");
  check(formerRow && formerRow.userId === null && formerRow.rows.some((r: any) => r.shift?.id === sPia.id && r.status === "MISSING" && r.absence === null), "after deleting: the kept assignment is a row of a deleted person without absence (absences go with the person)");
  check(!(await admin.request("/api/payroll/report?" + pastPeriod)).people.some((p: any) => p.firstName === "Pia" && p.lines.some((l: any) => l.kind === "ABSENCE")), "after deleting: no paid absence of the deleted person in payroll");
  await admin.request("/api/time-accounts?userId=" + pia.id, "GET", undefined, 404);
  await admin.request("/api/vacation?userId=" + pia.id, "GET", undefined, 404);
  check(true, "time account and vacation account of the deleted person: 404 (they went with the member)");
}
