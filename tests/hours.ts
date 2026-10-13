/*
 * Stunden pruefen und genehmigen (P2) ueber die echte API: Schichtbezug,
 * Status je Schicht (offen, genehmigt, nicht erfasst), Rechte der Pruefenden
 * (403/404), direkte Aenderung mit Verlauf, Nachtragen, automatische
 * Genehmigung, laufende Stoppuhr, Organisationsgrenzen. Teil von
 * tests/workflows.ts (TEST_ONLY=hours) mit eigenen Personen und Standorten.
 * Dazu die Hauptlinie: Sub-Platzhalter erzeugen kein "nicht erfasst", Zeiten
 * und Zuweisungen einer geloeschten Person stehen als eigene Zeile
 * ("former:" + Id) nur fuer die Administration, ohne Nachtragen und Aendern.
 * KW 37/2025: Mo 08.09. bis So 14.09.2025.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { TestContext } from "./permissions";
import { newPerson, planner, type Sess } from "./people";

export async function hoursTests(t: TestContext) {
  const { users, check } = t;
  const login = async (email: string) => { const s = new t.Session(); await s.login(email); return s; };
  const admin = await login(users.admin.email), foreign = await login(users.foreign.email);
  const period = "from=2025-09-08&to=2025-09-14";
  const report = (s: Sess, extra = "") => s.request("/api/hours?" + period + extra);
  const personOf = async (s: Sess, key: string) => (await report(s)).people.find((p: any) => p.key === key);
  const rowOf = async (s: Sess, key: string, shiftId: string) => (await personOf(s, key))?.rows.find((r: any) => r.shift?.id === shiftId);

  // --- Standorte, Personen, Plan ----------------------------------------------------
  const customer = (await admin.request("/api/customers", "POST", { name: "Kunde Stunden" })).customer;
  const branch = (await admin.request("/api/branches", "POST", { customerId: customer.id, name: "Objekt Stunden" })).branch;
  const south = (await admin.request("/api/branches", "POST", { customerId: customer.id, name: "Objekt Stunden Süd" })).branch;
  const elke = await newPerson(t, admin, "hours.elke", "Elke", "Prüfling", "EMPLOYEE", [branch.id]);
  const fritz = await newPerson(t, admin, "hours.fritz", "Fritz", "Früher", "EMPLOYEE", [branch.id]);
  const mgr = await newPerson(t, admin, "hours.mgr", "Mia", "Prüferin", "MANAGER");
  const mgrNoHours = await newPerson(t, admin, "hours.mgr2", "Moritz", "Ohnestunden", "MANAGER");
  const sE = elke.session, sM = mgr.session, sN = mgrNoHours.session;
  const plan = planner(admin, branch.id);
  const shiftOptions = { pauseOption: "PER_SHIFT", pauseValue: 30, title: "Empfang" };
  const monday = await plan.shift("2025-09-08", "08:00", "16:00", 1, shiftOptions);
  const tuesday = await plan.shift("2025-09-09", "08:00", "16:00", 1, shiftOptions);
  const wednesday = await plan.shift("2025-09-10", "08:00", "16:00", 1, { title: "Nur Sub" });
  const thursday = await plan.shift("2025-09-11", "08:00", "16:00", 1, { title: "Fritz Dienst" });
  const friday = await plan.shift("2025-09-12", "08:00", "16:00", 1, { title: "Fritz ohne Zeit" });
  for (const s of [monday, tuesday]) await plan.book(s.id, elke.id);
  for (const s of [thursday, friday]) await plan.book(s.id, fritz.id);
  // Mittwoch nur mit einem Sub-Platzhalter besetzt.
  const sub = (await admin.request("/api/subcontractors", "POST", { name: "Sub Stunden" })).subcontractor;
  const placeholder = (await admin.request("/api/subcontractors/" + sub.id + "/workers", "POST", { name: "Posten Stunden" })).worker;
  await admin.request("/api/contractor-bookings", "POST", { shiftId: wednesday.id, contractorWorkerId: placeholder.id, confirm: true });
  await plan.publish("2025-09-08");

  // --- Eigene Erfassung: offen und der Schicht zugeordnet --------------------------
  const own = (await sE.request("/api/time", "POST", { type: "MANUAL", userId: elke.id, date: "2025-09-08", timeFrom: "08:05", timeTo: "16:10", breakMinutes: 30 }, 201)).record;
  check(own.shiftId === monday.id && own.approvedAt === null && own.branchId === branch.id, "hours: own entry is linked to the overlapping shift and still open");
  const mon = await rowOf(admin, elke.id, monday.id), tue = await rowOf(admin, elke.id, tuesday.id);
  check(mon.status === "OPEN" && mon.plannedMinutes === 450 && mon.istMinutes === 455 && mon.deviationMinutes === 5 && mon.records[0].approval === "OPEN" && mon.shift.pauseMinutes === 30, "hours: Monday plan 7,5 h (30 min break), actual 7,58 h, open, +5 minutes");
  check(tue.status === "MISSING" && tue.records.length === 0 && tue.canEnter === true, "hours: Tuesday planned in the past without time is shown as not recorded and can be entered");
  await sE.request("/api/time/approve", "POST", { ids: [own.id] }, 403);
  check((await rowOf(sE, elke.id, monday.id)).records[0].canApprove === false, "hours: employees see their own hours but cannot approve them (403)");

  // --- Platzhalter: keine Zeile, kein "nicht erfasst" --------------------------------
  const full = await report(admin);
  check(!full.people.some((p: any) => p.rows.some((r: any) => r.shift?.id === wednesday.id)) && full.people.every((p: any) => p.userId || p.key.startsWith("former:")),
    "hours: a shift staffed only by a subcontractor placeholder creates no row and no 'not recorded'");

  // --- Rechte der Pruefenden: 404 ohne Standortrecht, 403 ohne "Stunden einsehen" ---
  check(!(await personOf(sM, elke.id)), "hours: manager without rights does not see the person's hours");
  await sM.request("/api/time/approve", "POST", { ids: [own.id] }, 404);
  const grant = (memberId: string, body: any) => admin.request("/api/employees/" + memberId + "/access", "PUT", body);
  await grant(mgrNoHours.memberId, { kind: "branch", branchId: branch.id, rights: ["VIEW_TIME", "EDIT_TIME"] });
  check(!(await personOf(sN, elke.id)), "hours: manager with time rights at the site but without 'Stunden einsehen' does not see the person");
  await sN.request("/api/time/approve", "POST", { ids: [own.id] }, 403);
  check(true, "hours: approving without 'Stunden einsehen' for the person is refused with 403 (site known), without any site right with 404");
  await grant(mgr.memberId, { kind: "branch", branchId: branch.id, rights: ["VIEW_TIME", "EDIT_TIME"] });
  await grant(mgr.memberId, { kind: "staff", memberId: elke.memberId, rights: ["VIEW_HOURS"] });
  const managed = await report(sM);
  const seen = managed.people.find((p: any) => p.key === elke.id);
  check(managed.showPay === false && seen.totalCents === null && seen.pay === null && seen.personnelNumber === null && managed.notices.length === 0 && managed.setup === null && seen.approvable.includes(own.id),
    "hours: manager with time rights sees the hours without any pay data, notices or payroll setup");
  check(!JSON.stringify(managed).includes("amountCents") && !JSON.stringify(managed).includes("hourlyRateCents"), "hours: the manager's answer contains no amounts or rates");
  await sM.request("/api/time/approve", "POST", { ids: [own.id] });
  const approvedRow = await rowOf(admin, elke.id, monday.id);
  check(approvedRow.status === "APPROVED" && approvedRow.records[0].approval === "REVIEWED", "hours: approved by the responsible manager (with reviewer)");
  await sM.request("/api/time/approve", "POST", { ids: [own.id], approved: false });
  check((await rowOf(admin, elke.id, monday.id)).status === "OPEN", "hours: approval can be taken back");
  const mgrOwn = (await sM.request("/api/time", "POST", { type: "MANUAL", userId: mgr.id, date: "2025-09-10", timeFrom: "09:00", timeTo: "11:00" }, 201)).record;
  await sM.request("/api/time/approve", "POST", { ids: [mgrOwn.id] }, 403);
  check(mgrOwn.approvedAt === null, "hours: a manager's own hours stay open and only the administration approves them (403)");
  await sM.request("/api/hours?" + period + "&standort=" + south.id, "GET", undefined, 404);

  // --- Direkte Aenderung durch Pruefende: sofort wirksam und im Verlauf -------------
  const direct = await sM.request("/api/time/" + own.id, "PATCH", { timeTo: "16:00", reason: "Ende laut Übergabebuch" });
  check(direct.pending === false && direct.record.timeTo === "16:00" && direct.record.approvedAt && direct.correction.status === "APPROVED", "hours: reviewer edits apply at once, count as approved and are logged");
  const log = (await admin.request("/api/time/corrections")).corrections.find((c: any) => c.id === direct.correction.id);
  check(log && log.before.timeTo === "16:10" && log.proposed.timeTo === "16:00", "hours: the previous values stay in the correction history");
  const request = await sE.request("/api/time/" + own.id, "PATCH", { timeTo: "16:20", reason: "Doch länger geblieben" });
  check(request.pending === true && request.record.timeTo === "16:00", "hours: the employee still only requests a correction");

  // --- Nachtragen wie geplant ---------------------------------------------------------
  const entered = (await sM.request("/api/time", "POST", { type: "MANUAL", userId: elke.id, date: "2025-09-09", timeFrom: "08:00", timeTo: "16:00", breakMinutes: 30 }, 201)).record;
  check(entered.shiftId === tuesday.id && entered.approvedAt !== null, "hours: time entered by a reviewer for someone else is linked and approved");
  check((await rowOf(admin, elke.id, tuesday.id)).status === "APPROVED", "hours: Tuesday is now recorded and approved");

  // --- Automatische Genehmigung (Vorgabe aus) -----------------------------------------
  check((await admin.request("/api/settings")).timeSettings.autoApprove === false, "hours: auto-approval is off by default");
  await admin.request("/api/settings", "PATCH", { timeSettings: { autoApprove: true } });
  const auto = (await sE.request("/api/time", "POST", { type: "MANUAL", userId: elke.id, date: "2025-09-12", timeFrom: "10:00", timeTo: "12:00" }, 201)).record;
  await admin.request("/api/settings", "PATCH", { timeSettings: { autoApprove: false } });
  check(auto.approvedAt !== null && auto.approvedById === null && auto.shiftId === null, "hours: with auto-approval own entries are approved without reviewer; no shift, no link");
  const loose = (await personOf(admin, elke.id)).rows.find((r: any) => r.records[0]?.id === auto.id);
  // Gleiche Darstellung wie der Altbestand aus der Migration (approvedAt gesetzt, approvedById NULL, tests/migration.ts).
  check(loose && loose.shift === null && loose.status === "APPROVED" && loose.records[0].approval === "AUTO", "hours: entries without a shift appear as their own row; approval without reviewer is shown as 'automatisch übernommen' like legacy records");
  const adminView = await report(admin);
  const adminElke = adminView.people.find((p: any) => p.key === elke.id);
  check(adminView.showPay === true && adminElke.rows.find((r: any) => r.shift?.id === monday.id).records[0].pay !== null && Array.isArray(adminElke.pay?.lines) && Array.isArray(adminView.notices) && adminView.setup !== null,
    "hours: the administration sees pay per record, pay type and sums per person and the payroll notices");

  // --- Laufende Stoppuhr ---------------------------------------------------------------
  const running = (await sE.request("/api/time/watch", "POST", { action: "START" })).record;
  await admin.request("/api/time/approve", "POST", { ids: [running.id] }, 409);
  const stopped = (await sE.request("/api/time/watch", "POST", { action: "STOP" })).record;
  check(stopped.approvedAt === null, "hours: a stopped stopwatch is open for review");
  await admin.request("/api/time/approve", "POST", { ids: [stopped.id] });

  // --- Geloeschte Person: eigene Zeile nur fuer die Administration ---------------------
  const fritzTime = (await fritz.session.request("/api/time", "POST", { type: "MANUAL", userId: fritz.id, date: "2025-09-11", timeFrom: "08:00", timeTo: "16:00" }, 201)).record;
  await grant(mgr.memberId, { kind: "staff", memberId: fritz.memberId, rights: ["VIEW_HOURS"] });
  const deleted = await admin.request("/api/employees/" + fritz.memberId, "DELETE");
  check(deleted.deleted === true && deleted.historyKept.timeRecords === 1 && deleted.historyKept.bookings === 2, "hours setup: the person is deleted, the time and both past assignments are kept");
  const afterDelete = await report(admin);
  const former = afterDelete.people.find((p: any) => p.former && p.lastName === "Früher");
  const fThu = former?.rows.find((r: any) => r.shift?.id === thursday.id), fFri = former?.rows.find((r: any) => r.shift?.id === friday.id);
  check(former && former.userId === null && former.key.startsWith("former:") && former.firstName === "Fritz" && former.isActive === false && !afterDelete.people.some((p: any) => p.key === fritz.id),
    "hours: deleted person has an own row with the kept name, key 'former:' and no account");
  check(fThu?.status === "OPEN" && fThu.records[0].id === fritzTime.id && fThu.records[0].canEdit === false && fThu.records[0].canApprove === true && fThu.canEnter === false,
    "hours: the deleted person's time stays with its shift; it can be approved but not edited");
  check(fFri?.status === "MISSING" && fFri.canEnter === false, "hours: a past assignment of a deleted person without time is 'not recorded' but cannot be entered");
  check(!(await report(sM)).people.some((p: any) => p.former || p.key.startsWith("former:")), "hours: managers do not see deleted people");
  await sM.request("/api/time/approve", "POST", { ids: [fritzTime.id] }, 403);
  await admin.request("/api/time/" + fritzTime.id, "PATCH", { timeTo: "15:00", reason: "Nachträglich korrigieren" }, 409);
  await admin.request("/api/time/approve", "POST", { ids: [fritzTime.id] });
  check((await personOf(admin, former.key)).rows.find((r: any) => r.shift?.id === thursday.id).status === "APPROVED", "hours: the administration approves the deleted person's time; the time itself stays unchanged (409 on edit)");

  // --- Organisationsgrenzen -------------------------------------------------------------
  check(!(await report(foreign)).people.some((p: any) => p.key === elke.id || p.former), "hours: foreign administration does not see the hours");
  await foreign.request("/api/time/approve", "POST", { ids: [own.id] }, 404);
  await foreign.request("/api/hours?" + period + "&standort=" + branch.id, "GET", undefined, 404);
  check((await report(admin, "&standort=" + branch.id)).people.find((p: any) => p.key === elke.id)?.rows.every((r: any) => (r.shift?.branchName ?? r.records[0]?.branchName) === "Objekt Stunden"), "hours: site filter keeps only the site's shifts and records");
  await sM.request("/api/hours?from=2025-09-14&to=2025-09-08", "GET", undefined, 400);
}
