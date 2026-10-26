/*
 * Kunden und Einsatzorte archivieren - ueber die echte API: nur Administration.
 * Mit kuenftigen Schichten oder einer Woche in Bearbeitung zuerst 409 mit
 * confirm und den Folgen (nichts geaendert), mit confirm: true werden
 * kuenftige Schichten abgesagt (Antraege geschlossen, je Person eine
 * Nachricht, Entwuerfe ohne Nachricht) und die Woche verworfen; laufende und
 * vergangene Schichten bleiben. Danach in Listen, Auswahlfeldern, Startseite,
 * Nachrichtenbezug und Freigaben unsichtbar; keine neuen Plaene, Schichten,
 * Einteilungen oder Freigaben (409); vergangene veroeffentlichte Wochen und
 * Stunden bleiben lesbar. Kunde archiviert seine Einsatzorte in einer
 * Transaktion (Folgen je Einsatzort); Wiederherstellen und endgueltiges
 * Loeschen (nur ohne Historie). Teil von tests/workflows.ts (TEST_ONLY=archive)
 * mit eigenen Personen und Standorten. Vergangene Woche: KW 41/2025 (Mo 06.10.2025).
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { addDate, berlinDate, berlinTime, isoWeek } from "../src/lib/berlin";
import type { TestContext } from "./permissions";
import { inboxCount, newPerson, planner, type Sess } from "./people";

export async function archiveTests(t: TestContext) {
  const { users, check } = t;
  const admin = new t.Session();
  await admin.login(users.admin.email);
  const has = (list: { id: string }[], id: string) => list.some((x) => x.id === id);

  // --- Aufbau: Kunde mit zwei Einsatzorten, Mitarbeiterin, Disponentin ------------------
  const kunde = (await admin.request("/api/customers", "POST", { name: "Kunde Archiv" })).customer;
  const nord = (await admin.request("/api/branches", "POST", { customerId: kunde.id, name: "Archiv Nord" })).branch;
  const sued = (await admin.request("/api/branches", "POST", { customerId: kunde.id, name: "Archiv Süd" })).branch;
  const ida = await newPerson(t, admin, "archive.ida", "Ida", "Archiv", "EMPLOYEE", [nord.id]);
  const ole = await newPerson(t, admin, "archive.ole", "Ole", "Archiv", "EMPLOYEE", [nord.id]);
  const mia = await newPerson(t, admin, "archive.mia", "Mia", "Archiv", "MANAGER");
  const sI = ida.session, sM = mia.session;
  await admin.request("/api/employees/" + mia.memberId + "/access", "PUT", { kind: "branch", branchId: nord.id, rights: ["EDIT_SHIFTS", "PUBLISH_SCHEDULE", "HANDLE_REQUESTS", "VIEW_TIME", "EDIT_TIME", "MANAGE_ISSUES"] });
  await admin.request("/api/employees/" + mia.memberId + "/access", "PUT", { kind: "staff", memberId: ida.memberId, rights: ["ASSIGN_SHIFTS", "VIEW_HOURS"] });

  // Vergangene veroeffentlichte Woche mit Einteilung und erfasster Zeit; kuenftig eine Entwurfsschicht
  // und eine veroeffentlichte Schicht (beide mit Ida, auf der veroeffentlichten ein offener Antrag von Ole);
  // dazu eine laufende Schicht (vor 10 Minuten begonnen).
  const plan = planner(admin, nord.id);
  const past = await plan.shift("2025-10-06", "08:00", "16:00", 1, { title: "Archiv Historie", pauseOption: "PER_SHIFT", pauseValue: 30 });
  await plan.book(past.id, ida.id);
  await plan.publish("2025-10-06");
  const record = (await sI.request("/api/time", "POST", { type: "MANUAL", userId: ida.id, date: "2025-10-06", timeFrom: "08:00", timeTo: "16:00", breakMinutes: 30 }, 201)).record;
  check(record.shiftId === past.id && record.branchId === nord.id, "archive: past published shift with recorded time at the site");
  const future = addDate(berlinDate(), 7), further = addDate(berlinDate(), 14);
  const upcoming = await plan.shift(future, "08:00", "16:00", 1, { title: "Archiv Zukunft" });
  await plan.book(upcoming.id, ida.id);
  const published = await plan.shift(further, "08:00", "16:00", 2, { title: "Archiv veröffentlicht" });
  await plan.book(published.id, ida.id);
  await plan.publish(further);
  const takeover = (await ole.session.request("/api/mod-requests", "POST", { shiftId: published.id })).request;
  const startAt = new Date(Date.now() - 10 * 60000), endAt = new Date(Date.now() + 120 * 60000), dRun = berlinDate(startAt);
  const running = await plan.shift(dRun, berlinTime(startAt), berlinTime(endAt), 1, { title: "Archiv läuft" });
  await plan.book(running.id, ida.id);
  await plan.publish(dRun);
  check(takeover.state === "OPEN", "archive: setup with a draft shift, a published shift with an open request and a running shift");

  // Wo der Einsatzort im Alltag erscheint: vor dem Archivieren ueberall, danach nirgends, nach dem Wiederherstellen wieder.
  const places = async (s: Sess): Promise<[string, boolean][]> => {
    const home = await s.request("/api/dashboard");
    return [
      ["site list", has((await s.request("/api/branches")).branches, nord.id)],
      ["week and month picker", has((await s.request("/api/branches?right=VIEW_SCHEDULE")).branches, nord.id)],
      ["shift form", has((await s.request("/api/branches?right=EDIT_SHIFTS")).branches, nord.id)],
      ["planning status", has((await s.request("/api/branches/status")).branches, nord.id)],
      ["customer list", (await s.request("/api/customers")).customers.some((c: any) => has(c.branches, nord.id))],
      ["start page and planning overview", home.overview.customers.some((c: any) => has(c.branches, nord.id))],
      ["message reference", has((await s.request("/api/messages/references")).branches, nord.id)],
    ];
  };
  const people = [["admin", admin], ["manager", sM]] as const;
  for (const [who, s] of people) check((await places(s)).every(([, seen]) => seen), "archive: " + who + " - site visible everywhere before archiving");

  // --- Rechte und Voraussetzung --------------------------------------------------------
  await sI.request("/api/branches/" + nord.id + "/archive", "POST", undefined, 403);
  await sM.request("/api/branches/" + nord.id + "/archive", "POST", undefined, 403);
  await sM.request("/api/customers/" + kunde.id + "/archive", "POST", undefined, 403);
  await sM.request("/api/branches/" + nord.id + "/archive", "DELETE", undefined, 403);
  await sM.request("/api/branches/archive", "GET", undefined, 403);
  check(true, "archive: employees and managers may not archive, restore or list the archive (403)");
  // Kuenftige Schichten: zuerst nur die Folgen (409 mit confirm), nichts geaendert.
  const nordArchive = "/api/branches/" + nord.id + "/archive";
  const deDate = (day: string) => day.split("-").reverse().join(".");
  const abgesagtIda = await inboxCount(sI, "Schicht abgesagt"), hinfaelligOle = await inboxCount(ole.session, "Antrag hinfällig");
  const asked = await admin.request(nordArchive, "POST", undefined, 409);
  check(asked.confirm === true && JSON.stringify(asked.warnings) === JSON.stringify(["2 künftige Schichten werden abgesagt.", "1 eingeteilte Person wird benachrichtigt.", "1 offener Antrag wird geschlossen."]), "archive: a site with future shifts asks first (409 confirm; draft and published shift, only the published one notifies, one open request)");
  check(asked.error === "Archivieren hat Folgen: 2 künftige Schichten, 1 Person betroffen. Bitte bestätigen." && asked.cancelledShifts === 2, "archive: the 409 summarises the consequences in one sentence");
  check((await admin.request(nordArchive, "POST", {}, 409)).confirm === true, "archive: an empty body is not a confirmation");
  await admin.request(nordArchive, "POST", { confirm: "ja" }, 400);
  const openBefore = (await ole.session.request("/api/mod-requests")).requests.find((r: any) => r.id === takeover.id);
  check(has((await admin.request("/api/branches")).branches, nord.id) && !!(await plan.view(published.id, further)) && !!(await plan.view(upcoming.id, future)) && openBefore?.state === "OPEN" && await inboxCount(sI, "Schicht abgesagt") === abgesagtIda && await inboxCount(ole.session, "Antrag hinfällig") === hinfaelligOle, "archive: without confirmation nothing changes (site, shifts, request, inbox)");

  // Bestaetigt: kuenftige Schichten abgesagt, laufende und vergangene bleiben.
  const done = await admin.request(nordArchive, "POST", { confirm: true });
  check(done.success === true && done.cancelledShifts === 2 && done.notified === 2 && done.requestsClosed === 1 && done.branchesArchived === 1, "archive: confirmed archiving cancels both future shifts, closes the request and notifies two people");
  check(!(await plan.view(published.id, further)) && !(await plan.view(upcoming.id, future)), "archive: cancelled shifts are gone from the site plan");
  const furtherWeek = isoWeek(further);
  check(!(await sI.request("/api/schedules?kw=" + furtherWeek.weekNumber + "&year=" + furtherWeek.year)).schedule.shifts.some((s: any) => s.id === published.id), "archive: the employee no longer sees the cancelled shift");
  await admin.request("/api/shifts/" + published.id + "/deletion", "GET", undefined, 404);
  await ole.session.request("/api/mod-requests/" + takeover.id, "DELETE", undefined, 404);
  check(!(await ole.session.request("/api/mod-requests")).requests.some((r: any) => r.id === takeover.id), "archive: the open request on the cancelled shift is closed");
  const idaMessages = (await sI.request("/api/messages?folder=inbox")).messages.filter((m: any) => m.subject === "Schicht abgesagt" && m.body.includes("Der Einsatzort „Archiv Nord“ wurde archiviert."));
  check(await inboxCount(sI, "Schicht abgesagt") === abgesagtIda + 1 && idaMessages.length === 1 && idaMessages[0].body.includes(deDate(further) + ", 08:00–16:00, Archiv Nord") && !idaMessages[0].body.includes(deDate(future)), "archive: the booked person gets one message for the published shift, none for the draft");
  check(await inboxCount(ole.session, "Antrag hinfällig") === hinfaelligOle + 1, "archive: the requester is told that the request is void");
  const runningView = await plan.view(running.id, dRun);
  check(runningView?.bookings.length === 1, "archive: the running shift stays with its assignment");
  check((await admin.request(nordArchive, "POST")).cancelledShifts === 0, "archive: repeating the archive is harmless");

  // --- Unsichtbar im Alltag ---------------------------------------------------------------
  for (const [who, s] of people) for (const [place, seen] of await places(s)) check(!seen, "archive: " + who + " - site missing in " + place);
  check(!((await admin.request("/api/dashboard")).tasks.draftHref ?? "").includes(nord.id), "archive: no open task points to the archived site");
  check(has((await admin.request("/api/customers")).customers, kunde.id), "archive: the customer stays visible with its other site");
  await admin.request("/api/messages", "POST", { subject: "Archiv", body: "Bezug", recipientIds: [ida.id], branchId: nord.id }, 404);
  check(!has((await admin.request("/api/employees/" + users.staffA.memberId + "/access")).branches, nord.id), "archive: site missing in the access selection");
  const miaAccess = await admin.request("/api/employees/" + mia.memberId + "/access");
  check(miaAccess.branches.find((b: any) => b.id === nord.id)?.archivedAt && miaAccess.grants.some((g: any) => g.branchId === nord.id), "archive: an existing grant stays and is shown as archived");
  const grantError = await admin.request("/api/employees/" + users.staffA.memberId + "/access", "PUT", { kind: "branch", branchId: nord.id, rights: ["VIEW_SCHEDULE"] }, 409);
  check(grantError.error === "Einsatzort ist archiviert.", "archive: no new grants at an archived site (409)");
  check(!has((await admin.request("/api/employees/" + ida.memberId + "/sites")).sites, nord.id), "archive: site missing in the site assignment of employees");
  await admin.request("/api/employees/" + ida.memberId + "/sites", "PUT", { branchIds: [nord.id] }, 409);
  await admin.request("/api/employees/" + ida.memberId + "/sites", "PUT", { branchIds: [] });
  check(!(await admin.request("/api/employees")).members.find((m: any) => m.id === ida.memberId).sites.some((s: any) => s.id === nord.id), "archive: no assignment to an archived site; saving other sites keeps the archived assignment untouched (see restore)");

  // --- Keine neuen Plaene, Schichten, Einteilungen ------------------------------------------
  const pastWeek = "/api/schedules?kw=41&year=2025&standort=" + nord.id;
  const pastView = await admin.request(pastWeek);
  check(pastView.schedule.shifts.some((s: any) => s.id === past.id) && pastView.branch.archivedAt && pastView.branch.plannable === false && pastView.access.view && !pastView.access.edit && !pastView.access.publish, "archive: past published week stays readable for the admin, read-only");
  const managerView = await sM.request(pastWeek);
  check(managerView.schedule.shifts.some((s: any) => s.id === past.id && !s.can.edit) && !managerView.access.edit && managerView.access.viewTime, "archive: past week stays readable for the responsible manager, planning rights rest");
  check((await sI.request("/api/schedules?kw=41&year=2025")).schedule.shifts.some((s: any) => s.id === past.id), "archive: the employee still sees her past shift");
  const later = isoWeek(addDate(berlinDate(), 35));
  check((await admin.request("/api/schedules?kw=" + later.weekNumber + "&year=" + later.year + "&standort=" + nord.id)).schedule.id === "", "archive: opening a new week creates no plan");
  const month = await admin.request("/api/branches/" + nord.id + "/month?monat=2025-10");
  check(month.days.some((d: any) => d.shifts.some((s: any) => s.id === past.id)) && !month.access.edit, "archive: month plan stays readable without planning");
  const shiftError = await admin.request("/api/shifts", "POST", { scheduleId: pastView.schedule.id, dayOfWeek: 2, shiftFrom: "08:00", shiftTo: "12:00", maxEmployees: 1 }, 409);
  const bookingError = await admin.request("/api/bookings", "POST", { shiftId: past.id, userId: users.replacement.id, confirm: true }, 409);
  await sM.request("/api/shifts", "POST", { scheduleId: pastView.schedule.id, dayOfWeek: 2, shiftFrom: "08:00", shiftTo: "12:00", maxEmployees: 1 }, 409);
  check(shiftError.error === "Einsatzort ist archiviert." && bookingError.error === "Einsatzort ist archiviert.", "archive: no new shifts or assignments (409 'Einsatzort ist archiviert.')");

  // --- Auswertung behaelt die Stunden -------------------------------------------------------
  const hours = async (s: Sess, extra = "") => (await s.request("/api/hours?from=2025-10-06&to=2025-10-12" + extra)).people.find((p: any) => p.key === ida.id)?.rows.find((r: any) => r.shift?.id === past.id);
  const row = await hours(admin), siteRow = await hours(admin, "&standort=" + nord.id), managerRow = await hours(sM, "&standort=" + nord.id);
  check(row?.istMinutes === 450 && siteRow?.istMinutes === 450 && managerRow?.istMinutes === 450, "archive: hours of the past shift stay in the report (admin, site filter, manager with time rights)");
  const filter = (await admin.request("/api/branches?right=VIEW_TIME&archived=include")).branches.find((b: any) => b.id === nord.id);
  check(filter?.archivedAt && (await sM.request("/api/branches?right=VIEW_TIME&archived=include")).branches.some((b: any) => b.id === nord.id && b.archivedAt), "archive: the report's site filter offers the archived site (marked by archivedAt)");
  const list = await admin.request("/api/branches/archive");
  check(list.branches.some((b: any) => b.id === nord.id && b.archivedAt && b.deletable === false && b.customer.id === kunde.id), "archive: archive list shows the site with date, not deletable (history)");

  // --- Wiederherstellen: wieder ueberall sichtbar, Planung wieder moeglich -------------------
  await admin.request("/api/branches/" + nord.id + "/archive", "DELETE");
  for (const [who, s] of people) check((await places(s)).every(([, seen]) => seen), "archive: " + who + " - restored site visible everywhere again");
  check(has((await admin.request("/api/employees/" + users.staffA.memberId + "/access")).branches, nord.id), "archive: restored site is back in the access selection");
  check((await admin.request("/api/employees/" + ida.memberId + "/sites")).sites.some((s: any) => s.id === nord.id && s.assigned), "archive: the site assignment survived the archive untouched");
  const again = await planner(sM, nord.id).shift(future, "09:00", "17:00", 1, { title: "Wieder geplant" });
  check(!!again.id, "archive: planning rights work again after restoring");
  await sM.request("/api/shifts/" + again.id, "DELETE");

  // --- Kunde archivieren: Folgen je Einsatzort, alles oder nichts ------------------------------
  const idaAccess = (rights: string[], expected = 200) => admin.request("/api/employees/" + ida.memberId + "/access", "PUT", { kind: "branch", branchId: sued.id, rights }, expected);
  await idaAccess(["VIEW_SCHEDULE"]);
  const southPlan = planner(admin, sued.id);
  const southShift = await southPlan.shift(future, "06:00", "14:00", 1, { title: "Süd Zukunft" });
  await southPlan.book(southShift.id, ida.id);
  await southPlan.publish(future);
  const northShift = await plan.shift(further, "10:00", "18:00", 1, { title: "Nord wieder" });
  await plan.book(northShift.id, ida.id);
  // Plan in Bearbeitung: Die veroeffentlichte Schicht ist entfernt, eine neue angelegt - Mitarbeitende kennen noch den alten Stand.
  const fw = isoWeek(future), southPath = "/api/schedules?kw=" + fw.weekNumber + "&year=" + fw.year + "&standort=" + sued.id;
  const southId = (await admin.request(southPath)).schedule.id;
  await admin.request("/api/schedules/" + southId + "/editing", "POST");
  await admin.request("/api/shifts/" + southShift.id, "DELETE");
  const addedInEditing = await southPlan.shift(future, "15:00", "19:00", 1, { title: "Süd neu" });
  const customerArchive = "/api/customers/" + kunde.id + "/archive";
  const customerAsked = await admin.request(customerArchive, "POST", undefined, 409);
  const week = "KW " + fw.weekNumber + "/" + fw.year;
  check(customerAsked.confirm === true && JSON.stringify(customerAsked.warnings) === JSON.stringify(["Archiv Nord: 1 künftige Schicht wird abgesagt.", "Archiv Nord: 1 eingeteilte Person wird benachrichtigt.", "Archiv Süd: 1 künftige Schicht wird abgesagt.", "Archiv Süd: 1 eingeteilte Person wird benachrichtigt.", "Archiv Süd: " + week + " ist in Bearbeitung und wird verworfen."]), "archive: customer archive names the consequences per site; the week in editing counts its published state");
  check(customerAsked.error === "Archivieren hat Folgen: 2 künftige Schichten, 1 Person betroffen, 1 Woche in Bearbeitung. Bitte bestätigen.", "archive: customer summary counts a person booked at both sites once");
  const southEditing = (await admin.request(southPath)).schedule;
  check(southEditing.status === "EDITING" && southEditing.shifts.some((s: any) => s.id === addedInEditing.id) && !southEditing.shifts.some((s: any) => s.id === southShift.id) && !!(await plan.view(northShift.id, further)), "archive: unconfirmed customer archive leaves the editing state and both sites untouched");
  check(has((await admin.request("/api/branches")).branches, nord.id) && has((await admin.request("/api/customers")).customers, kunde.id), "archive: unconfirmed customer archive archives nothing");
  const schichtenIda = await inboxCount(sI, "Schichten abgesagt");
  const archived = await admin.request(customerArchive, "POST", { confirm: true });
  const afterCustomer = (await admin.request("/api/branches")).branches;
  check(archived.branchesArchived === 2 && archived.cancelledShifts === 2 && archived.notified === 1 && archived.requestsClosed === 0 && !has(afterCustomer, nord.id) && !has(afterCustomer, sued.id) && !has((await admin.request("/api/customers")).customers, kunde.id), "archive: confirmed customer archive archives the customer with all its sites and cancels their future shifts");
  const southAfter = (await admin.request(southPath)).schedule;
  check(southAfter.status === "PUBLISHED" && !southAfter.shifts.length && !(await plan.view(northShift.id, further)), "archive: the week in editing is discarded first (published state back), then its future shifts are cancelled");
  const bundled = (await sI.request("/api/messages?folder=inbox")).messages.filter((m: any) => m.subject === "Schichten abgesagt");
  check(await inboxCount(sI, "Schichten abgesagt") === schichtenIda + 1 && bundled[0]?.body.startsWith("Der Kunde „Kunde Archiv“ wurde archiviert.\nDiese Schichten wurden abgesagt:") && bundled[0].body.includes(deDate(future) + ", 06:00–14:00, Archiv Süd") && bundled[0].body.includes(deDate(further) + ", 10:00–18:00, Archiv Nord") && !bundled[0].body.includes("15:00–19:00"), "archive: one message per person lists the cancelled shifts of both sites (restored published state, not the edit)");
  await idaAccess(["VIEW_SCHEDULE", "REQUEST_SHIFTS"], 409);
  await idaAccess([]);
  check(!(await admin.request("/api/employees/" + ida.memberId + "/access")).grants.some((g: any) => g.branchId === sued.id), "archive: at an archived site a grant can be revoked but not changed");
  const restoreBlocked = await admin.request("/api/branches/" + nord.id + "/archive", "DELETE", undefined, 409);
  check(restoreBlocked.error.includes("Kunde ist archiviert"), "archive: a site cannot be restored while its customer is archived");
  await admin.request("/api/branches", "POST", { customerId: kunde.id, name: "Archiv Neu" }, 409);
  check(true, "archive: no new site under an archived customer");
  const withHistory = await admin.request("/api/branches/" + nord.id, "DELETE", undefined, 409);
  check(withHistory.error.includes("Bitte stattdessen archivieren"), "archive: an archived site with history cannot be deleted (409)");
  await admin.request("/api/customers/" + kunde.id + "/archive", "DELETE");
  const back = await admin.request("/api/customers");
  check(back.customers.some((c: any) => c.id === kunde.id && c.branches.length === 0) && !has((await admin.request("/api/branches")).branches, nord.id), "archive: restoring the customer keeps its sites archived");
  await admin.request("/api/branches/" + nord.id + "/archive", "DELETE");
  const restored = (await admin.request("/api/branches")).branches;
  check(has(restored, nord.id) && !has(restored, sued.id), "archive: sites are restored one by one");

  // --- Endgueltig loeschen nur ohne Historie ---------------------------------------------------
  const empty = (await admin.request("/api/branches", "POST", { customerId: kunde.id, name: "Archiv Leer" })).branch;
  await admin.request("/api/schedules?kw=" + later.weekNumber + "&year=" + later.year + "&standort=" + empty.id);
  await admin.request("/api/branches/" + empty.id + "/archive", "POST");
  check((await admin.request("/api/branches/archive")).branches.some((b: any) => b.id === empty.id && b.deletable === true), "archive: archive list marks a site without history as deletable");
  await admin.request("/api/branches/" + empty.id, "DELETE");
  check(!(await admin.request("/api/branches/archive")).branches.some((b: any) => b.id === empty.id), "archive: an archived site without history can be deleted (200)");
  const lonely = (await admin.request("/api/customers", "POST", { name: "Kunde Archiv Leer" })).customer;
  check((await admin.request("/api/customers/" + lonely.id + "/archive", "POST")).branchesArchived === 0, "archive: a customer without sites can be archived");
  check((await admin.request("/api/branches/archive")).customers.some((c: any) => c.id === lonely.id && c.archivedAt && c.deletable), "archive: archive list shows the customer with date, deletable without sites");
  await admin.request("/api/customers/" + lonely.id, "DELETE");
  check(!(await admin.request("/api/branches/archive")).customers.some((c: any) => c.id === lonely.id), "archive: an archived customer without sites can be deleted");
}
