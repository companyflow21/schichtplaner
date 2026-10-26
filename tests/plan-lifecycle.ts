/*
 * Plan-Lebenszyklus DRAFT -> PUBLISHED -> EDITING: Bearbeitung starten,
 * Aenderungsdiff, Veroeffentlichen mit Sammelmitteilung (abwaehlbar) und
 * Verwerfen mit exakter Wiederherstellung - geprueft ueber die echte API.
 * Teil von tests/workflows.ts (gleicher Server, gleiche In-Memory-Datenbank).
 * Eigene Personen, Standorte und Wochen (140-150 Tage voraus, dazu die
 * laufende und die naechste Woche an einem eigenen Standort).
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { addDate, berlinDate, isoWeek, weekDate } from "../src/lib/berlin";
import type { TestContext } from "./permissions";
import { dayOfWeek, newPerson, type Person, type Sess } from "./people";

const EDITING_REQUESTS = "Diese Woche wird gerade überarbeitet. Anträge sind nach der Veröffentlichung wieder möglich.";

export async function planLifecycleTests(t: TestContext) {
  const { users, check } = t;
  const login = async (email: string) => { const s = new t.Session(); await s.login(email); return s; };
  const admin = await login(users.admin.email), foreign = await login(users.foreign.email);

  // --- Struktur -----------------------------------------------------------------
  const customer = (await admin.request("/api/customers", "POST", { name: "Lebenszyklus Kunde" })).customer;
  const site = async (name: string) => (await admin.request("/api/branches", "POST", { customerId: customer.id, name })).branch;
  const nord = await site("Lebenszyklus Nord"), sued = await site("Lebenszyklus Süd"), ost = await site("Lebenszyklus Ost");
  const mgr = await newPerson(t, admin, "lz.mgr", "Mona", "Planer", "MANAGER");
  // Planen ohne "Dienstplan veröffentlichen".
  await admin.request("/api/employees/" + mgr.memberId + "/access", "PUT", { kind: "branch", branchId: nord.id, rights: ["EDIT_SHIFTS", "HANDLE_REQUESTS"] });
  const e1 = await newPerson(t, admin, "lz.e1", "Ella", "Eins", "EMPLOYEE", [nord.id]);
  const e2 = await newPerson(t, admin, "lz.e2", "Emil", "Zwei", "EMPLOYEE", [nord.id]);
  const e3 = await newPerson(t, admin, "lz.e3", "Erna", "Drei", "EMPLOYEE", [nord.id]);
  const e4 = await newPerson(t, admin, "lz.e4", "Enno", "Vier", "EMPLOYEE", [nord.id]);
  const staff = [e1, e2, e3, e4];

  const pathOf = (branchId: string, date: string) => { const w = isoWeek(date); return "/api/schedules?kw=" + w.weekNumber + "&year=" + w.year + "&standort=" + branchId; };
  const planOf = async (branchId: string, date: string, s: Sess = admin) => (await s.request(pathOf(branchId, date))).schedule;
  async function shift(branchId: string, date: string, from: string, to: string, extra: Record<string, unknown> = {}, as: Sess = admin) {
    const plan = await planOf(branchId, date);
    return (await as.request("/api/shifts", "POST", { scheduleId: plan.id, dayOfWeek: dayOfWeek(date), shiftFrom: from, shiftTo: to, maxEmployees: 1, title: "Lebenszyklus", confirm: true, ...extra })).shifts[0];
  }
  const inbox = async (p: Person): Promise<any[]> => (await p.session.request("/api/messages?folder=inbox")).messages;
  const mark = async () => new Map(await Promise.all(staff.map(async (p) => [p.id, new Set((await inbox(p)).map((m) => m.id))] as const)));
  const fresh = async (p: Person, before: Map<string, Set<string>>) => (await inbox(p)).filter((m) => !before.get(p.id)!.has(m.id));
  const silent = async (before: Map<string, Set<string>>, except: Person[] = []) => (await Promise.all(staff.filter((p) => !except.includes(p)).map((p) => fresh(p, before)))).every((m) => m.length === 0);
  /** Planer-Sicht der Schichten, stabil sortiert - fuer den exakten Vergleich vor/nach dem Verwerfen. */
  const normalized = async (branchId: string, date: string) => JSON.stringify((await planOf(branchId, date)).shifts.map((s: any) => ({ ...s, bookings: [...s.bookings].sort((x: any, y: any) => x.id < y.id ? -1 : 1) })).sort((x: any, y: any) => x.id < y.id ? -1 : 1));
  const requestOf = async (p: Person, id: string) => (await p.session.request("/api/mod-requests")).requests.find((r: any) => r.id === id);

  const today = berlinDate();
  const w = isoWeek(addDate(today, 140));
  const day = (n: number) => weekDate(w.year, w.weekNumber, n);
  const week = "KW " + w.weekNumber + "/" + w.year;
  const german = (date: string) => date.split("-").reverse().join(".");

  // === 1. Entwurf ================================================================
  const A = await shift(nord.id, day(1), "08:00", "16:00", { assignees: [e1.id] });
  const B = await shift(nord.id, day(2), "08:00", "16:00", { assignees: [e2.id] });
  const C = await shift(nord.id, day(3), "08:00", "16:00", { assignees: [e3.id] });
  const D = await shift(nord.id, day(4), "08:00", "16:00");
  let plan = await planOf(nord.id, day(1));
  const editing = "/api/schedules/" + plan.id + "/editing", diffPath = "/api/schedules/" + plan.id + "/diff", patchPath = "/api/schedules/" + plan.id;
  check(plan.status === "DRAFT" && plan.editingSince === null && plan.editingBy === null, "planner sees the draft status");
  const draftDiff = await admin.request(diffPath);
  check(draftDiff.status === "DRAFT" && draftDiff.diff.added.length === 4 && !draftDiff.diff.removed.length && !draftDiff.diff.changed.length && draftDiff.diff.affectedUserIds.length === 3, "diff of a draft: every shift is new");
  check((await admin.request(editing, "POST", undefined, 409)).error.includes("noch nicht veröffentlicht"), "a draft cannot be put into editing");
  await admin.request(editing, "DELETE", undefined, 409);

  await admin.request(patchPath, "PATCH", { isPublic: true });
  plan = await planOf(nord.id, day(1));
  const empty = (await admin.request(diffPath)).diff;
  check(plan.status === "PUBLISHED" && !empty.added.length && !empty.removed.length && !empty.changed.length && !empty.affectedUserIds.length && empty.openPlacesAdded === false, "published plan without editing: empty diff");
  const employeePlan = await planOf(nord.id, day(1), e2.session);
  check(employeePlan.status === undefined && employeePlan.editingBy === undefined && employeePlan.isPublic === true && employeePlan.shifts.find((s: any) => s.id === D.id).can.request === true, "employee sees isPublic only (no lifecycle fields) and may request the open shift");

  // Offene Antraege vor der Bearbeitung: Tausch A <-> C, Uebernahme von D.
  const exchange = (await e1.session.request("/api/mod-requests", "POST", { shiftId: A.id, kind: "EXCHANGE", targetShiftId: C.id, targetUserId: e3.id })).request;
  const takeover = (await e4.session.request("/api/mod-requests", "POST", { shiftId: D.id })).request;
  check(exchange.state === "OPEN" && takeover.state === "OPEN", "open exchange and takeover requests before editing");

  // === 2. Bearbeitung starten: Rechte ===========================================
  await e1.session.request(editing, "POST", undefined, 403);
  await foreign.request(editing, "POST", undefined, 404);
  await e1.session.request(diffPath, "GET", undefined, 403);
  await foreign.request(diffPath, "GET", undefined, 404);
  const started = await mgr.session.request(editing, "POST");
  check(started.schedule.status === "EDITING" && started.schedule.editingBy?.name === "Mona Planer" && !!started.schedule.editingSince && started.weekStarted === false && started.notice === null, "manager without publish right starts editing (status, name, no week-started notice)");
  check((await admin.request(editing, "POST", undefined, 409)).error.includes("bereits bearbeitet"), "editing cannot be started twice");
  await mgr.session.request(editing, "DELETE", undefined, 403);
  await e1.session.request(editing, "DELETE", undefined, 403);
  await foreign.request(editing, "DELETE", undefined, 404);
  await mgr.session.request(patchPath, "PATCH", { isPublic: true }, 403);
  plan = await planOf(nord.id, day(1));
  check(plan.status === "EDITING" && plan.editingBy?.name === "Mona Planer" && plan.editingSince === started.schedule.editingSince && plan.isPublic === true, "plan view shows editing status, start time and who started it");
  check((await planOf(nord.id, day(1), e2.session)).status === undefined, "employee view stays without lifecycle fields while editing");
  const unchanged = (await admin.request(diffPath)).diff;
  check(!unchanged.added.length && !unchanged.changed.length && !unchanged.removed.length && !unchanged.affectedUserIds.length, "diff right after the start is empty");

  // === 3. Waehrend der Bearbeitung: keine Einzelmitteilungen, Antraege ruhen ====
  let before = await mark();
  await mgr.session.request("/api/shifts/" + A.id, "PATCH", { shiftFrom: "09:00" });
  const E = await shift(nord.id, day(5), "08:00", "16:00", { maxEmployees: 2, assignees: [e2.id] }, mgr.session);
  const deleted = await mgr.session.request("/api/shifts/" + C.id, "DELETE");
  check(deleted.assignmentsRemoved === 1 && deleted.requestsClosed === 0, "deleting during editing removes the assignment but keeps open requests open");
  check(await silent(before), "no single messages while editing (change, create with assignment, delete)");
  check((await requestOf(e1, exchange.id)).state === "OPEN", "exchange naming the deleted shift stays open during editing");
  check((await e2.session.request("/api/mod-requests", "POST", { shiftId: D.id }, 409)).error === EDITING_REQUESTS, "new request during editing: 409 with explanation");
  check((await mgr.session.request("/api/mod-requests/" + takeover.id, "PATCH", { state: "ACCEPTED" }, 409)).error === EDITING_REQUESTS, "decision during editing: 409 with explanation");
  check((await planOf(nord.id, day(1), e2.session)).shifts.find((s: any) => s.id === D.id).can.request === false, "employees cannot request shifts of a plan in editing");
  check((await admin.request(patchPath, "PATCH", { isPublic: false }, 409)).error.includes("veröffentlichen oder verwerfen"), "withdrawing a plan in editing: 409");
  check((await admin.request("/api/live", "POST", { scheduleId: plan.id }, 409)).error.includes("überarbeitet"), "live mode cannot start during editing");
  const outside = await shift(sued.id, day(3), "18:00", "20:00");
  check((await admin.request("/api/shifts/" + outside.id, "PATCH", { branchId: nord.id }, 409)).error.includes("Zielstandort"), "moving a shift into a plan in editing: 409");
  check(await silent(before), "refused actions send no messages either");

  // === 4. Diff: genau 1 neu, 1 geaendert, 1 entfallen ============================
  const diff = (await mgr.session.request(diffPath)).diff;
  check(diff.added.length === 1 && diff.added[0].id === E.id && diff.added[0].openPlaces === 1 && diff.added[0].people.map((p: any) => p.name).join() === "Emil Zwei", "diff: the new shift with its person and open place");
  check(diff.changed.length === 1 && diff.changed[0].shift.id === A.id && diff.changed[0].changes.join() === "Zeit" && diff.changed[0].before.shiftFrom === "08:00" && diff.changed[0].after.shiftFrom === "09:00" && diff.changed[0].after.label.includes("09:00–16:00"), "diff: the changed shift with category Zeit, before and after");
  check(diff.removed.length === 1 && diff.removed[0].id === C.id && diff.removed[0].movedTo === null && diff.removed[0].label.includes(german(day(3))) && diff.removed[0].people.map((p: any) => p.name).join() === "Erna Drei", "diff: the deleted shift as removed, with label and person");
  check([...diff.affectedUserIds].sort().join() === [e1.id, e2.id, e3.id].sort().join() && diff.affected.length === 3 && diff.openPlacesAdded === true, "diff: affected people (not the unchanged one) and new open places");

  // === 5. Veroeffentlichen mit Mitteilung ========================================
  before = await mark();
  const published = await admin.request(patchPath, "PATCH", { isPublic: true });
  // Vier Mitarbeitende plus die Planerin (Planen schliesst "Offene Schichten sehen" ein).
  check(published.schedule.status === "PUBLISHED" && published.schedule.isPublic === true && published.notified === 5, "publishing the edits: status PUBLISHED, five people notified");
  check((await inbox(mgr)).filter((m) => m.subject === "Neue offene Schichten").length === 1, "planner with the request right gets 'Neue offene Schichten' once");
  const subject = "Dienstplan " + week + " aktualisiert";
  const m1 = await fresh(e1, before), m2 = await fresh(e2, before), m3 = await fresh(e3, before), m4 = await fresh(e4, before);
  const summary = (ms: any[]) => ms.filter((m) => m.subject === subject);
  const s1 = summary(m1), s2 = summary(m2), s3 = summary(m3);
  check(s1.length === 1 && s1[0].body.includes("Geändert:") && s1[0].body.includes("09:00–16:00") && s1[0].body.includes("vorher") && s1[0].body.includes("08:00–16:00") && !s1[0].body.includes("Neu:") && !s1[0].body.includes("Entfällt:"), "changed time: exactly one summary with section Geändert, old and new time");
  check(s2.length === 1 && s2[0].body.includes("Neu:") && s2[0].body.includes(german(day(5))) && !s2[0].body.includes("Geändert:") && !s2[0].body.includes("Entfällt:") && s2[0].body.includes("neue offene Schichten") && m2.length === 1, "new shift: exactly one summary with section Neu and the open-shift hint inside");
  check(s3.length === 1 && s3[0].body.includes("Entfällt:") && s3[0].body.includes(german(day(3))) && !s3[0].body.includes("Neu:") && m3.length === 1, "deleted shift: exactly one summary with section Entfällt, no extra message");
  check(m4.length === 1 && m4[0].subject === "Neue offene Schichten" && !summary(m4).length, "unaffected person with request right: only 'Neue offene Schichten'");
  check(m1.length === 2 && m1.filter((m) => m.subject === "Antrag hinfällig" && m.body.includes("entfällt")).length === 1, "requester of the exchange gets one summary and one 'Antrag hinfällig'");
  const closed = await requestOf(e1, exchange.id);
  check(closed.state === "DECLINED" && closed.decision?.note === "Schicht wurde abgesagt.", "exchange naming the removed shift is closed on publishing");
  check((await requestOf(e4, takeover.id)).state === "OPEN", "request on a shift that still exists stays open");
  const after = (await admin.request(diffPath)).diff;
  const afterPlan = await planOf(nord.id, day(1));
  check(afterPlan.status === "PUBLISHED" && afterPlan.editingSince === null && afterPlan.editingBy === null && !after.added.length && !after.changed.length && !after.removed.length, "after publishing: status PUBLISHED without editing fields, empty diff");
  check((await planOf(nord.id, day(1), e2.session)).shifts.find((s: any) => s.id === D.id).can.request === true, "requests are possible again after publishing");

  // === 6. Veroeffentlichen ohne Mitteilung ======================================
  await mgr.session.request(editing, "POST");
  before = await mark();
  await mgr.session.request("/api/shifts/" + B.id, "PATCH", { title: "Neue Tätigkeit" });
  await mgr.session.request("/api/bookings", "POST", { shiftId: E.id, userId: e1.id, confirm: true });
  check(await silent(before), "assignment and title change during editing send no message");
  const quiet = await admin.request(patchPath, "PATCH", { isPublic: true, notify: false });
  check(quiet.schedule.status === "PUBLISHED" && quiet.notified === 0 && await silent(before), "publishing without notification creates no inbox row at all");
  check((await planOf(nord.id, day(1))).shifts.find((s: any) => s.id === B.id).title === "Neue Tätigkeit", "edits are live after publishing without notification");
  await mgr.session.request("/api/mod-requests/" + takeover.id, "PATCH", { state: "DECLINED" });
  check((await requestOf(e4, takeover.id)).state === "DECLINED", "decisions work again after publishing");

  // Ohne Mitteilung wird ein Antrag zur entfallenen Schicht trotzdem geschlossen und mitgeteilt (Entscheidung).
  const H = await shift(nord.id, day(6), "18:00", "22:00");
  const voidable = (await e3.session.request("/api/mod-requests", "POST", { shiftId: H.id })).request;
  await admin.request(editing, "POST");
  before = await mark();
  await admin.request("/api/shifts/" + H.id, "DELETE");
  const decided = await admin.request(patchPath, "PATCH", { isPublic: true, notify: false });
  const voided = await fresh(e3, before);
  check(decided.notified === 1 && voided.length === 1 && voided[0].subject === "Antrag hinfällig" && await silent(before, [e3]), "notify=false: only the request decision is delivered");
  check((await e3.session.request("/api/mod-requests/" + voidable.id, "DELETE", undefined, 404)).error, "the voided request is no longer open");

  // === 7. Verwerfen stellt den veroeffentlichten Stand exakt wieder her ===========
  const original = await normalized(nord.id, day(1));
  await admin.request(editing, "POST");
  await admin.request("/api/shifts/" + A.id, "DELETE");
  await admin.request("/api/bookings", "DELETE", { shiftId: B.id, userId: e2.id });
  await admin.request("/api/bookings", "POST", { shiftId: B.id, userId: e4.id, confirm: true });
  await admin.request("/api/shifts/" + D.id, "PATCH", { branchId: sued.id, shiftFrom: "10:00", maxEmployees: 2 });
  await admin.request("/api/shifts/" + E.id, "PATCH", { title: "Andere Tätigkeit" });
  const F = await shift(nord.id, day(6), "08:00", "16:00", { assignees: [e3.id] });
  check((await planOf(sued.id, day(4))).shifts.some((s: any) => s.id === D.id), "shift moved to another site during editing");
  const moved = (await admin.request(diffPath)).diff;
  const movedD = moved.removed.find((r: any) => r.id === D.id), removedA = moved.removed.find((r: any) => r.id === A.id);
  check(moved.removed.length === 2 && movedD?.movedTo?.label.includes("Lebenszyklus Süd") && movedD.movedTo.shiftFrom === "10:00" && removedA?.movedTo === null, "diff: moved shift counts as removed and names its new place");
  check(moved.added.length === 1 && moved.added[0].id === F.id && moved.changed.length === 2 && moved.changed.find((c: any) => c.shift.id === B.id)?.changes.join() === "Besetzung" && moved.changed.find((c: any) => c.shift.id === E.id)?.changes.join() === "Titel", "diff: staffing and title changes grouped per shift");
  // Die ausgetragene Person ist inzwischen anderswo zur selben Zeit eingeteilt: Verwerfen darf keine Doppelbelegung erzeugen.
  const G = await shift(sued.id, day(2), "10:00", "12:00", { assignees: [e2.id] });
  const blocked = await admin.request(editing, "DELETE", undefined, 409);
  check(blocked.error.includes("Überschneidung") && blocked.conflicts?.some((c: string) => c.includes("Emil Zwei")), "discarding is refused when a restored assignment would overlap another shift");
  check((await planOf(nord.id, day(1))).status === "EDITING", "refused discard changes nothing");
  await admin.request("/api/bookings", "DELETE", { shiftId: G.id, userId: e2.id });
  before = await mark();
  const discarded = await admin.request(editing, "DELETE");
  check(discarded.restored === 4 && discarded.removed === 1 && discarded.skipped === 0 && discarded.schedule.status === "PUBLISHED", "discard: four shifts restored, the new one removed, nothing skipped");
  check(await normalized(nord.id, day(1)) === original, "discard restores fields and assignments exactly (same ids, same view)");
  check(!(await planOf(nord.id, day(1))).shifts.some((s: any) => s.id === F.id) && !(await planOf(sued.id, day(4))).shifts.some((s: any) => s.id === D.id), "new shift is gone and the moved shift is back");
  check(await silent(before), "discard sends no message");
  await admin.request(editing, "DELETE", undefined, 409);
  const back = (await admin.request(diffPath)).diff;
  check((await planOf(nord.id, day(1))).status === "PUBLISHED" && !back.added.length && !back.changed.length && !back.removed.length, "after discard the plan is published again with an empty diff");

  // === 8. Begonnene Woche: begonnene Schicht wird nicht zurueckgesetzt ==========
  const now = await shift(ost.id, today, "00:00", "00:30", { title: "Begonnen" });
  const current = await planOf(ost.id, today);
  await admin.request("/api/schedules/" + current.id, "PATCH", { isPublic: true });
  const running = await admin.request("/api/schedules/" + current.id + "/editing", "POST");
  check(running.weekStarted === true && running.notice?.includes("bereits begonnen"), "editing a started week returns a notice");
  await admin.request("/api/shifts/" + now.id, "PATCH", { title: "Nachträglich" });
  const kept = await admin.request("/api/schedules/" + current.id + "/editing", "DELETE");
  check(kept.skipped === 1 && kept.restored === 0 && (await planOf(ost.id, today)).shifts.find((s: any) => s.id === now.id).title === "Nachträglich", "a started shift is skipped by discard and keeps its state");

  // === 9. Tauschoptionen schliessen Plaene in Bearbeitung aus ===================
  const nextWeek = isoWeek(addDate(today, 7));
  const next = weekDate(nextWeek.year, nextWeek.weekNumber, 3);
  const X = await shift(ost.id, next, "08:00", "16:00", { assignees: [e1.id] });
  const nextPlan = await planOf(ost.id, next);
  await admin.request("/api/schedules/" + nextPlan.id, "PATCH", { isPublic: true });
  const own = async () => (await e1.session.request("/api/mod-requests/exchange-options")).own.map((s: any) => s.id);
  check((await own()).includes(X.id), "own published shift is offered for exchange");
  await admin.request("/api/schedules/" + nextPlan.id + "/editing", "POST");
  check(!(await own()).includes(X.id), "shifts of a plan in editing are not offered for exchange");
  await admin.request("/api/schedules/" + nextPlan.id + "/editing", "DELETE");
  check((await own()).includes(X.id), "after discard the shift is offered again");

  // === 10. Erstveroeffentlichung und Zurueckziehen ohne Mitteilung ================
  const later = addDate(day(1), 7);
  await shift(nord.id, later, "08:00", "16:00", { assignees: [e3.id] });
  const laterPlan = "/api/schedules/" + (await planOf(nord.id, later)).id;
  before = await mark();
  const first = await admin.request(laterPlan, "PATCH", { isPublic: true, notify: false });
  check(first.schedule.status === "PUBLISHED" && first.notified === 0 && await silent(before), "first publication from draft with notify=false sends nothing");
  const withdrawn = await admin.request(laterPlan, "PATCH", { isPublic: false, notify: false });
  check(withdrawn.schedule.status === "DRAFT" && withdrawn.notified === 0 && await silent(before), "withdrawing with notify=false sends nothing");
  await admin.request(laterPlan, "PATCH", { isPublic: true });
  check((await fresh(e3, before)).some((m) => m.subject === "Dienstplan veröffentlicht"), "default publication still informs the booked person");

  // === 11. Monatsplan: Lebenszyklus je Woche nur fuer die Planung =================
  // Eigener Standort: Eine Mitarbeiterin mit "Dienstplan ansehen" (der Monatsplan verlangt das Recht)
  // zaehlt sonst bei den Mitteilungen oben mit.
  const west = await site("Lebenszyklus West");
  const viewer = await newPerson(t, admin, "lz.view", "Vera", "Sicht");
  await admin.request("/api/employees/" + viewer.memberId + "/access", "PUT", { kind: "branch", branchId: west.id, rights: ["VIEW_SCHEDULE"] });
  await shift(west.id, day(2), "08:00", "16:00");
  const westPlan = "/api/schedules/" + (await planOf(west.id, day(2))).id;
  const monthWeek = async (s: Sess) => (await s.request("/api/branches/" + west.id + "/month?monat=" + day(2).slice(0, 7))).weeks.find((x: any) => x.year === w.year && x.weekNumber === w.weekNumber);
  const draftWeek = await monthWeek(admin), draftView = await monthWeek(viewer.session);
  check(draftWeek.status === "DRAFT" && draftWeek.isPublic === false && draftWeek.shifts === 1, "month view: planner gets status DRAFT for the week with its shift count");
  check(draftView.scheduleId === null && draftView.status === null, "month view: employee sees neither the draft nor a status");
  await admin.request(westPlan, "PATCH", { isPublic: true, notify: false });
  await admin.request(westPlan + "/editing", "POST");
  const editingWeek = await monthWeek(admin), editingView = await monthWeek(viewer.session);
  check(editingWeek.status === "EDITING" && editingWeek.scheduleId === draftWeek.scheduleId, "month view: status EDITING after starting the editing");
  check(editingView.scheduleId === draftWeek.scheduleId && editingView.isPublic === true && editingView.status === null, "month view: employee gets status null while editing");
  await admin.request(westPlan, "PATCH", { isPublic: true, notify: false });
  check((await monthWeek(admin)).status === "PUBLISHED" && (await monthWeek(viewer.session)).status === null, "month view: PUBLISHED after publishing, still null for the employee");
}
