/*
 * Subunternehmer und kontolose Platzhalter ueber die echte API.
 * Teil von workflows.ts: eigener Kunde/Standorte, keine eigene Serverinstanz.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { addDate, berlinDate, isoWeek } from "../src/lib/berlin";
import type { TestContext } from "./permissions";

export async function subcontractorTests(t: TestContext) {
  const { users, check } = t;
  const session = async (name: string) => { const s = new t.Session(); await s.login(users[name].email); return s; };
  const admin = await session("admin"), manager = await session("managerA"), employee = await session("employee"), foreign = await session("foreign");
  const directory = () => admin.request("/api/employees");
  const memberIds = (data: any) => data.members.map((m: any) => m.id).sort().join();
  const before = memberIds(await directory());
  const sub = (await admin.request("/api/subcontractors", "POST", { name: "Sub Test A" })).subcontractor;
  const second = (await admin.request("/api/subcontractors", "POST", { name: "Sub Test B" })).subcontractor;
  const worker = async (subId: string, name: string) => (await admin.request("/api/subcontractors/" + subId + "/workers", "POST", { name })).worker;
  const a = await worker(sub.id, "MA 1"), b = await worker(sub.id, "MA 2"), c = await worker(second.id, "MA 1");
  const root = "/api/subcontractors/" + sub.id;
  const workerPath = (id: string) => root + "/workers/" + id;
  await admin.request(root, "PATCH", { name: "Sub Test A umbenannt" });
  await admin.request(workerPath(a.id), "PATCH", { name: "MA 1 umbenannt" });
  // Doppelte Namen werden abgewiesen, ohne dass ein weiterer Eintrag entsteht.
  await admin.request("/api/subcontractors", "POST", { name: "Sub Test B" }, 409);
  await admin.request(root + "/workers", "POST", { name: "MA 2" }, 409);
  await admin.request(workerPath(b.id), "PATCH", { name: "MA 1 umbenannt" }, 409);
  const stored =(await admin.request("/api/subcontractors")).subcontractors.find((s: any) => s.id === sub.id);
  check(stored.name === "Sub Test A umbenannt" && stored.isActive && stored.workers.length === 2 && stored.workers.some((w: any) => w.id === a.id && w.name === "MA 1 umbenannt"), "Sub and several placeholders persist after rereading; names can be changed");
  check(memberIds(await directory()) === before, "creating subcontractors and placeholders creates no personnel accounts or memberships");
  await admin.request("/api/subcontractors", "POST", { name: "  " }, 400);
  await admin.request(root + "/workers", "POST", { name: "  " }, 400);
  await admin.request(workerPath(c.id), "PATCH", { name: "Falscher Sub" }, 404);
  for (const s of [manager, employee]) {
    await s.request("/api/subcontractors", "GET", undefined, 403);
    await s.request("/api/subcontractors", "POST", { name: "Nicht erlaubt" }, 403);
    await s.request(root, "PATCH", { name: "Nicht erlaubt" }, 403);
    await s.request(root + "/workers", "POST", { name: "Nicht erlaubt" }, 403);
    await s.request(workerPath(a.id), "PATCH", { isActive: false }, 403);
    await s.request(root + "/assignments?month=" + berlinDate().slice(0, 7), "GET", undefined, 403);
  }
  await foreign.request(root, "PATCH", { name: "Fremdzugriff" }, 404);
  await foreign.request(root + "/workers", "POST", { name: "Fremdzugriff" }, 404);
  await foreign.request(workerPath(a.id), "PATCH", { name: "Fremdzugriff" }, 404);
  await foreign.request(root + "/assignments", "GET", undefined, 404);
  check(!(await foreign.request("/api/subcontractors")).subcontractors.some((s: any) => s.id === sub.id), "foreign organisation cannot list subcontractors from this organisation");

  const customer = (await admin.request("/api/customers", "POST", { name: "Subunternehmer Testkunde" })).customer;
  const branch = (await admin.request("/api/branches", "POST", { customerId: customer.id, name: "Subunternehmer Nord" })).branch;
  const otherBranch = (await admin.request("/api/branches", "POST", { customerId: customer.id, name: "Subunternehmer Süd" })).branch;
  await admin.request("/api/employees/" + users.managerA.memberId + "/access", "PUT", { kind: "branch", branchId: branch.id, rights: ["EDIT_SHIFTS", "PUBLISH_SCHEDULE"] });
  const planPath = (date: string, branchId = branch.id) => { const w = isoWeek(date); return "/api/schedules?kw=" + w.weekNumber + "&year=" + w.year + "&standort=" + branchId; };
  const plan = async (date: string, branchId = branch.id) => (await admin.request(planPath(date, branchId))).schedule;
  const where = new Map<string, string>();
  const dow = (d: string) => ((new Date(d + "T12:00:00Z").getUTCDay() + 6) % 7) + 1;
  async function shift(date: string, from: string, to: string, extra: Record<string, unknown> = {}, branchId = branch.id) {
    const out = (await admin.request("/api/shifts", "POST", { scheduleId: (await plan(date, branchId)).id, dayOfWeek: dow(date), shiftFrom: from, shiftTo: to, maxEmployees: 1, title: "Subtest", ...extra })).shifts[0];
    where.set(out.id, planPath(date, branchId));
    return out;
  }
  const current = async (id: string) => (await admin.request(where.get(id)!)).schedule.shifts.find((s: any) => s.id === id);
  const book = (shiftId: string, contractorWorkerId: string, expected = 200) => admin.request("/api/contractor-bookings", "POST", { shiftId, contractorWorkerId, confirm: true }, expected);
  const assignmentPath = (month: string) => root + "/assignments?month=" + month;
  const date = addDate(berlinDate(), 130);
  const first = await shift(date, "08:00", "16:00", { maxEmployees: 2, requiredQualifications: ["Brandschutz"] });
  const candidates = (await admin.request("/api/shifts/" + first.id + "/candidates")).contractorWorkers;
  check(candidates.some((w: any) => w.id === a.id && w.subcontractor.id === sub.id && w.selectable && w.confirm && w.hints.length), "admin can select named placeholders with a qualification verification hint");
  check(!(await manager.request("/api/shifts/" + first.id + "/candidates")).contractorWorkers?.length, "manager candidate list gives no assignable placeholders");
  const hint = await admin.request("/api/contractor-bookings", "POST", { shiftId: first.id, contractorWorkerId: a.id }, 409);
  check(hint.confirm === true && hint.warnings.length && (await current(first.id)).bookings.length === 0, "unconfirmed suitability hint creates no placeholder assignment");
  const booking = (await book(first.id, a.id)).booking;
  check(booking.contractorWorkerId === a.id && booking.userId === null && booking.formerEmployeeId === null, "placeholder booking references no current or former account");
  const half = await current(first.id);
  check(half.occupiedCount === 1 && half.missing === 1, "one placeholder occupies exactly one of two places");
  await admin.request("/api/bookings", "POST", { shiftId: first.id, userId: users.employee.id, confirm: true });
  const full = await current(first.id), view = full.bookings.find((x: any) => x.contractorWorkerId === a.id);
  check(full.bookings.length === full.maxEmployees && view.personKey === "contractor:" + a.id && view.former === false && (view.user.firstName + " " + view.user.lastName) === "Sub Test A umbenannt · MA 1 umbenannt", "placeholder fills one real place and displays company plus worker without former-employee marker");
  check(full.occupiedCount === 2 && full.missing === 0, "placeholder and employee together leave no place missing");
  const managerView = (await manager.request(where.get(first.id)!)).schedule.shifts.find((s: any) => s.id === first.id);
  check(managerView.occupiedCount === 2 && managerView.missing === 0 && managerView.can.manageContractors === false && managerView.bookings.some((x: any) => x.contractorWorkerId === a.id && (x.user.firstName + " " + x.user.lastName) === "Sub Test A umbenannt · MA 1 umbenannt"), "manager at the released site sees placeholder occupancy without placeholder management");
  const fullForStaff = await admin.request("/api/bookings", "POST", { shiftId: first.id, userId: users.replacement.id, confirm: true }, 409);
  check(String(fullForStaff.error).includes("bereits besetzt"), "placeholder place also blocks a regular employee assignment on the full shift");
  await admin.request("/api/contractor-bookings", "DELETE", { shiftId: first.id, contractorWorkerId: b.id }, 404);
  await book(first.id, a.id, 409);
  await book(first.id, b.id, 409);
  for (const s of [manager, employee]) {
    await s.request("/api/contractor-bookings", "POST", { shiftId: first.id, contractorWorkerId: b.id, confirm: true }, 403);
    await s.request("/api/contractor-bookings", "DELETE", { shiftId: first.id, contractorWorkerId: a.id }, 403);
  }
  await foreign.request("/api/contractor-bookings", "POST", { shiftId: first.id, contractorWorkerId: a.id, confirm: true }, 404);
  await foreign.request("/api/contractor-bookings", "DELETE", { shiftId: first.id, contractorWorkerId: a.id }, 404);
  const foreignSub = (await foreign.request("/api/subcontractors", "POST", { name: "Fremder Sub" })).subcontractor;
  const foreignWorker = (await foreign.request("/api/subcontractors/" + foreignSub.id + "/workers", "POST", { name: "MA 1" })).worker;
  await book(first.id, foreignWorker.id, 404);

  // Wiederverwendung an anderen Standorten: eine Ueberschneidung ist ein Hinweis, den die Administration bestaetigt.
  const clash = await shift(date, "12:00", "18:00", {}, otherBranch.id);
  const clashHint = await admin.request("/api/contractor-bookings", "POST", { shiftId: clash.id, contractorWorkerId: a.id }, 409);
  check(clashHint.confirm === true && clashHint.warnings.join() === "Zeitliche Überschneidung mit einer anderen Schicht." && (await current(clash.id)).bookings.length === 0, "overlapping placeholder assignment asks for confirmation and stores nothing");
  await book(clash.id, a.id);
  check((await current(clash.id)).bookings[0]?.contractorWorkerId === a.id && (await current(first.id)).bookings.some((x: any) => x.contractorWorkerId === a.id), "confirmed overlap: the placeholder is assigned at both sites");
  // Angrenzend ist keine Ueberschneidung: ohne Bestaetigung moeglich.
  const later = await shift(date, "18:00", "20:00", {}, otherBranch.id);
  await admin.request("/api/contractor-bookings", "POST", { shiftId: later.id, contractorWorkerId: a.id });
  // Ohne Freigabe am anderen Standort sieht der Manager dort auch keine Sub-Besetzung.
  await manager.request(planPath(date, otherBranch.id), "GET", undefined, 404);
  await admin.request("/api/shifts/" + later.id, "PATCH", { shiftFrom: "15:00" }, 409);
  check((await current(later.id)).shiftFrom === "18:00" && (await current(later.id)).bookings[0].contractorWorkerId === a.id, "failed shift time change keeps placeholder assignment and original time");
  const copyDate = addDate(date, 2);
  await manager.request("/api/shifts/" + first.id + "/copy", "POST", { date: copyDate, withAssignments: true, confirm: true }, 403);
  const managerEmptyDate = addDate(date, 20);
  const emptyCopy = (await manager.request("/api/shifts/" + first.id + "/copy", "POST", { date: managerEmptyDate, withAssignments: false })).shifts[0];
  check(emptyCopy.bookings.length === 0 && emptyCopy.maxEmployees === 2, "manager can copy a mixed shift without assignments, no placeholder is silently copied");
  await admin.request("/api/employees/" + users.managerA.memberId + "/access", "PUT", { kind: "staff", memberId: users.employee.memberId, rights: ["ASSIGN_SHIFTS"] });
  const staffOnly = await shift(addDate(date, 21), "08:00", "12:00");
  await admin.request("/api/bookings", "POST", { shiftId: staffOnly.id, userId: users.employee.id, confirm: true });
  const staffOnlyCopy = (await manager.request("/api/shifts/" + staffOnly.id + "/copy", "POST", { date: addDate(date, 22), withAssignments: true, confirm: true })).shifts[0];
  check(staffOnlyCopy.bookings.length === 1 && staffOnlyCopy.bookings[0].userId === users.employee.id, "manager can still copy regular employee assignments at the released site");
  const copied = (await admin.request("/api/shifts/" + first.id + "/copy", "POST", { date: copyDate, withAssignments: true, confirm: true })).shifts[0];
  check(copied.bookings.length === 2 && copied.bookings.some((x: any) => x.contractorWorkerId === a.id) && copied.bookings.some((x: any) => x.userId === users.employee.id), "copy with assignments preserves both employee and subcontractor identities");

  // Zwei konkurrierende Buchungen duerfen den letzten Platz nicht doppelt vergeben.
  const parallel = (participants: { path: string; data: unknown }[]) => Promise.all(participants.map(p => fetch(t.base + p.path, { method: "POST", headers: { Cookie: admin.cookie(), "Content-Type": "application/json" }, body: JSON.stringify(p.data) }).then(async r => ({ status: r.status, body: await r.text() }))));
  async function race(id: string, participants: { path: string; data: unknown }[]) {
    const results = await parallel(participants);
    check(results.map(r => r.status).sort().join() === "200,409", "last-place concurrency accepts exactly one booking: " + results.map(r => r.status).join());
    check((await current(id)).bookings.length === 1, "last-place concurrency persists exactly one booking");
  }
  const r1 = await shift(addDate(date, 4), "08:00", "10:00");
  await race(r1.id, [
    { path: "/api/contractor-bookings", data: { shiftId: r1.id, contractorWorkerId: b.id, confirm: true } },
    { path: "/api/bookings", data: { shiftId: r1.id, userId: users.employee.id, confirm: true } },
  ]);
  const r2 = await shift(addDate(date, 5), "08:00", "10:00");
  await race(r2.id, [b, c].map(w => ({ path: "/api/contractor-bookings", data: { shiftId: r2.id, contractorWorkerId: w.id, confirm: true } })));

  // Nachtschicht ueber Monats- und Jahresgrenze: die Ueberschneidung wird auch dort erkannt (Hinweis mit Bestaetigung).
  const nextYear = Number(berlinDate().slice(0, 4)) + 1;
  const newYear = nextYear + "-01-01", newYearsEve = (nextYear - 1) + "-12-31";
  const night = await shift(newYearsEve, "22:00", "06:00");
  await book(night.id, a.id);
  const morning = await shift(newYear, "05:00", "08:00", {}, otherBranch.id);
  const morningHint = await admin.request("/api/contractor-bookings", "POST", { shiftId: morning.id, contractorWorkerId: a.id }, 409);
  check(morningHint.confirm === true && morningHint.warnings.join() === "Zeitliche Überschneidung mit einer anderen Schicht.", "overlap with a night shift across the year boundary asks for confirmation");
  const touching = await shift(newYear, "06:00", "08:00", {}, otherBranch.id);
  await admin.request("/api/contractor-bookings", "POST", { shiftId: touching.id, contractorWorkerId: a.id });
  const january = await admin.request(assignmentPath(nextYear + "-01"));
  check(january.month === nextYear + "-01" && january.assignments.some((x: any) => x.shiftId === night.id && x.date === newYearsEve && x.contractorWorkerId === a.id && x.branchName === branch.name) && january.assignments.some((x: any) => x.shiftId === touching.id), "January assignment overview includes previous December's touching night shift and actual January assignments");
  const december = await admin.request(assignmentPath((nextYear - 1) + "-12"));
  check(december.assignments.some((x: any) => x.shiftId === night.id), "night shift also remains in its starting month overview");
  await admin.request(root + "/assignments?month=2026-13", "GET", undefined, 400);
  await admin.request("/api/schedules/" + (await plan(newYearsEve)).id, "PATCH", { isPublic: true });
  check((await admin.request(assignmentPath(nextYear + "-01"))).assignments.find((x: any) => x.shiftId === night.id).isPublic === true, "subcontractor overview reflects publication state after rereading");

  // Inaktiv bedeutet keine neue Besetzung; vorhandene Einsaetze bleiben sichtbar und belegt.
  await admin.request(workerPath(a.id), "PATCH", { isActive: false });
  const inactiveTarget = await shift(addDate(date, 6), "08:00", "10:00");
  await book(inactiveTarget.id, a.id, 409);
  check((await current(first.id)).bookings.length === 2 && (await admin.request(assignmentPath(date.slice(0, 7)))).assignments.some((x: any) => x.shiftId === first.id), "worker deactivation preserves capacity and assignment history");
  await admin.request(workerPath(a.id), "PATCH", { isActive: true });
  await admin.request(root, "PATCH", { isActive: false });
  await book(inactiveTarget.id, b.id, 409);
  await admin.request(root + "/workers", "POST", { name: "MA inaktiv" }, 409);
  check((await current(first.id)).bookings.length === 2, "company deactivation does not remove existing assignments");
  await admin.request(root, "PATCH", { isActive: true });
  await admin.request("/api/contractor-bookings", "DELETE", { shiftId: later.id, contractorWorkerId: a.id });
  check((await current(later.id)).bookings.length === 0, "future placeholder assignment can be removed");
  const ended = await shift(addDate(berlinDate(), -2), "08:00", "10:00");
  await book(ended.id, b.id);
  await admin.request("/api/contractor-bookings", "DELETE", { shiftId: ended.id, contractorWorkerId: b.id }, 409);
  check((await current(ended.id)).bookings.some((x: any) => x.contractorWorkerId === b.id), "ended placeholder assignment cannot be silently removed");

  // Kopie einer Schicht, die nur mit Platzhaltern besetzt ist.
  const onlyDate = addDate(date, 8);
  const only = await shift(onlyDate, "08:00", "12:00", { maxEmployees: 2 });
  await book(only.id, a.id);
  await book(only.id, b.id);
  const onlyCopy = (await admin.request("/api/shifts/" + only.id + "/copy", "POST", { date: addDate(onlyDate, 1), withAssignments: true, confirm: true })).shifts[0];
  where.set(onlyCopy.id, planPath(addDate(onlyDate, 1)));
  const storedCopy = await current(onlyCopy.id);
  check(storedCopy.bookings.length === 2 && storedCopy.occupiedCount === 2 && storedCopy.missing === 0 && [a.id, b.id].every(id => storedCopy.bookings.some((x: any) => x.contractorWorkerId === id && x.userId === null && x.former === false)), "copy of a placeholder-only shift persists both placeholders as occupied places");
  // Kopie auf einen Termin, an dem ein Platzhalter schon eingesetzt ist: ohne Bestaetigung nichts angelegt.
  const planSize = async (d: string) => (await admin.request(planPath(d))).schedule.shifts.length;
  const sizeBefore = await planSize(date);
  const overlapCopy = await admin.request("/api/shifts/" + only.id + "/copy", "POST", { date, withAssignments: true }, 409);
  check(overlapCopy.confirm === true && !overlapCopy.conflicts && overlapCopy.warnings?.some((x: any) => x.userId === "contractor:" + a.id && x.name === "Sub Test A umbenannt · MA 1 umbenannt" && x.reasons.join() === "Zeitliche Überschneidung mit einer anderen Schicht.") && await planSize(date) === sizeBefore, "copy onto an overlapping placeholder assignment names the placeholder, asks for confirmation and creates nothing");

  // Deaktivierter Platzhalter: nicht mehr waehlbar, bestehender Einsatz bleibt bearbeitbar, Kopie legt ihn nicht neu an.
  await admin.request(workerPath(b.id), "PATCH", { isActive: false });
  const offered = (await admin.request("/api/shifts/" + inactiveTarget.id + "/candidates")).contractorWorkers;
  check(!offered.some((w: any) => w.id === b.id) && offered.some((w: any) => w.id === a.id && w.selectable), "deactivated placeholder is no longer offered while active placeholders stay selectable");
  await admin.request("/api/shifts/" + only.id, "PATCH", { description: "Geänderter Hinweis" });
  const edited = await current(only.id);
  check(edited.description === "Geänderter Hinweis" && edited.occupiedCount === 2 && edited.bookings.some((x: any) => x.contractorWorkerId === b.id), "unrelated change of a shift keeps the deactivated placeholder's assignment");
  const inactiveCopy = await admin.request("/api/shifts/" + only.id + "/copy", "POST", { date: addDate(onlyDate, 2), withAssignments: true, confirm: true }, 409);
  check(inactiveCopy.conflicts?.some((x: any) => x.userId === "contractor:" + b.id && x.reasons.join(" ").includes("nicht aktiv")), "copy with assignments does not recreate a deactivated placeholder");
  await admin.request(workerPath(b.id), "PATCH", { isActive: true });

  // Monatsuebersicht je Unternehmen und je Platzhalter.
  const forB = await shift(addDate(date, 12), "08:00", "10:00");
  await book(forB.id, c.id);
  const forBMonth = addDate(date, 12).slice(0, 7);
  const ofB = await admin.request("/api/subcontractors/" + second.id + "/assignments?month=" + forBMonth);
  const ofA = await admin.request(assignmentPath(forBMonth));
  check(ofB.assignments.some((x: any) => x.shiftId === forB.id && x.contractorWorkerId === c.id && x.workerName === "MA 1") && !ofA.assignments.some((x: any) => x.contractorWorkerId === c.id), "monthly overview lists only the selected company's placeholders");
  const shared = (await admin.request(assignmentPath(onlyDate.slice(0, 7)))).assignments.filter((x: any) => x.shiftId === only.id);
  check(shared.map((x: any) => x.contractorWorkerId).sort().join() === [a.id, b.id].sort().join(), "monthly overview lists each placeholder of a shared shift separately");

  // Parallel: derselbe Platzhalter in zwei ueberlappenden Schichten bzw. zweimal in derselben Schicht.
  // Ohne confirm gelingt genau eine Einteilung; die zweite sieht die erste und
  // fragt nach (409 mit confirm). Mit confirm waeren beide gewollt - die
  // Ueberschneidung ist seit dem 12.10.2026 ein bestaetigbarer Hinweis.
  const raceDate = addDate(date, 14);
  const left = await shift(raceDate, "08:00", "12:00"), right = await shift(raceDate, "10:00", "14:00", {}, otherBranch.id);
  const crossing = await parallel([left, right].map(s => ({ path: "/api/contractor-bookings", data: { shiftId: s.id, contractorWorkerId: a.id } })));
  const placed = (await current(left.id)).bookings.length + (await current(right.id)).bookings.length;
  const askedCross = JSON.parse(crossing.find(r => r.status === 409)?.body ?? "{}");
  check(crossing.map(r => r.status).sort().join() === "200,409" && placed === 1 && askedCross.confirm === true, "concurrent unconfirmed assignments of one placeholder to overlapping shifts: one stored, the other asks for confirmation: " + crossing.map(r => r.status).join());
  const twice = await shift(addDate(date, 15), "08:00", "10:00", { maxEmployees: 2 });
  const doubled = await parallel([0, 1].map(() => ({ path: "/api/contractor-bookings", data: { shiftId: twice.id, contractorWorkerId: a.id, confirm: true } })));
  check(doubled.map(r => r.status).sort().join() === "200,409" && (await current(twice.id)).bookings.length === 1, "concurrent double assignment of one placeholder to the same shift stores exactly one: " + doubled.map(r => r.status).join());
  const deleted = await admin.request("/api/shifts/" + twice.id, "DELETE");
  check(deleted.success === true && deleted.assignmentsRemoved === 1 && !(await current(twice.id)), "deleting a future shift counts the removed placeholder assignment");

  // Umbenennung nach dem Einsatz: Plan und Uebersicht zeigen den aktuellen Namen.
  await admin.request(workerPath(b.id), "PATCH", { name: "MA 2 neu" });
  const renamedInPlan = (await current(only.id)).bookings.find((x: any) => x.contractorWorkerId === b.id);
  const renamedInOverview = (await admin.request(assignmentPath(onlyDate.slice(0, 7)))).assignments.find((x: any) => x.shiftId === only.id && x.contractorWorkerId === b.id);
  check(renamedInPlan && (renamedInPlan.user.firstName + " " + renamedInPlan.user.lastName) === "Sub Test A umbenannt · MA 2 neu" && renamedInOverview?.workerName === "MA 2 neu", "renamed placeholder appears under its current name in plan and overview");
  check(memberIds(await directory()) === before, "all placeholder planning operations leave employee account directory unchanged");
}
