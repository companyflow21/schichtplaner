/*
 * Einteilen durch die Planung (verbindlich, ohne Bestaetigung), Mitarbeiter
 * wechseln, Anlegen mit Mitarbeiterauswahl und Kopieren auf mehrere Tage -
 * geprueft ueber die echte API. Teil von tests/workflows.ts (gleicher Server,
 * gleiche In-Memory-Datenbank). Eigene Struktur (Kunde, zwei Standorte) und
 * Termine 60-110 Tage in der Zukunft, damit andere Reihen unberuehrt bleiben.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { addDate, berlinDate, berlinTime, isoWeek, weekDate } from "../src/lib/berlin";
import type { TestContext } from "./permissions";

type S = InstanceType<TestContext["Session"]>;

export async function assignmentTests(t: TestContext) {
  const { users, check } = t;
  const session = async (name: string) => { const s = new t.Session(); await s.login(users[name].email); return s; };
  const admin = await session("admin"), mA = await session("managerA"), mB = await session("managerB"), viewer = await session("viewer");
  const sA = await session("staffA"), sB = await session("staffB"), emp = await session("employee"), rep = await session("replacement"), loner = await session("loner"), foreign = await session("foreign");
  const grant = (member: string, branchId: string, rights: string[]) => admin.request("/api/employees/" + member + "/access", "PUT", { kind: "branch", branchId, rights });
  const id = users;

  // --- Struktur ---------------------------------------------------------------
  const customer = (await admin.request("/api/customers", "POST", { name: "Zuweisung Kunde" })).customer;
  const nord = (await admin.request("/api/branches", "POST", { customerId: customer.id, name: "Zuweisung Nord" })).branch;
  const sued = (await admin.request("/api/branches", "POST", { customerId: customer.id, name: "Zuweisung Süd" })).branch;
  await grant(id.managerA.memberId, nord.id, ["EDIT_SHIFTS", "PUBLISH_SCHEDULE", "HANDLE_REQUESTS"]);
  for (const name of ["staffA", "staffB", "employee", "replacement"]) await grant(id[name].memberId, nord.id, ["REQUEST_SHIFTS"]);

  const today = berlinDate();
  const dow = (date: string) => ((new Date(date + "T12:00:00Z").getUTCDay() + 6) % 7) + 1;
  const planPath = (branchId: string, date: string) => { const w = isoWeek(date); return "/api/schedules?kw=" + w.weekNumber + "&year=" + w.year + "&standort=" + branchId; };
  const plan = async (branchId: string, date: string) => (await admin.request(planPath(branchId, date))).schedule;
  const publish = async (branchId: string, date: string) => admin.request("/api/schedules/" + (await plan(branchId, date)).id, "PATCH", { isPublic: true });
  const where = new Map<string, string>();
  async function shift(branchId: string, date: string, from: string, to: string, extra: Record<string, unknown> = {}, as: S = admin) {
    const created = (await as.request("/api/shifts", "POST", { scheduleId: (await plan(branchId, date)).id, dayOfWeek: dow(date), shiftFrom: from, shiftTo: to, maxEmployees: 1, title: "Zuweisungstest", ...extra })).shifts[0];
    where.set(created.id, planPath(branchId, date));
    return created;
  }
  /** Schicht laut Standortplan (Admin-Sicht), also auch Bestaetigungsstatus. */
  const current = async (shiftId: string) => (await admin.request(where.get(shiftId)!)).schedule.shifts.find((s: any) => s.id === shiftId);
  const holders = async (shiftId: string) => (await current(shiftId)).bookings.map((b: any) => b.userId).sort().join();
  const book = (shiftId: string, userId: string, as: S = admin) => as.request("/api/bookings", "POST", { shiftId, userId, confirm: true });
  const inbox = async (s: S): Promise<any[]> => (await s.request("/api/messages?folder=inbox")).messages;
  const snapshot = async (s: S) => new Set((await inbox(s)).map((m) => m.id));
  const fresh = async (s: S, before: Set<string>) => (await inbox(s)).filter((m) => !before.has(m.id));
  const requestOf = async (s: S, requestId: string) => (await s.request("/api/mod-requests")).requests.find((r: any) => r.id === requestId);
  const titled = async (branchId: string, date: string, title: string) => (await plan(branchId, date)).shifts.filter((s: any) => s.title === title && s.date === date);

  // === 1. Einteilung durch die Planung ist verbindlich =======================
  const d1 = addDate(today, 60);
  const s1 = await shift(nord.id, d1, "08:00", "16:00", { maxEmployees: 2 });
  await publish(nord.id, d1);
  const aBefore = await snapshot(sA);
  const direct = (await mA.request("/api/bookings", "POST", { shiftId: s1.id, userId: id.staffA.id })).booking;
  check(direct.confirmation === "PLANNER" && direct.confirmedAt && direct.bookedBy === id.managerA.id, "manager assignment is stored as binding (PLANNER, confirmed now, booked by the planner)");
  const assigned = await fresh(sA, aBefore);
  check(assigned.length === 1 && assigned[0].subject === "Neue Schicht" && assigned[0].body.includes("fest eingeteilt") && !/bestätigen/i.test(assigned[0].body), "assignment message says 'fest eingeteilt' and asks for no confirmation");
  const own = (await sA.request("/api/bookings", "PATCH", { shiftId: s1.id })).booking;
  check(own.confirmation === "PLANNER" && own.confirmedAt === direct.confirmedAt, "employee confirmation is a no-op for planner assignments");
  const ownView = (await sA.request(planPath(nord.id, d1))).schedule.shifts.find((s: any) => s.id === s1.id).bookings.find((b: any) => b.userId === id.staffA.id);
  check(ownView.confirmation === "PLANNER" && ownView.confirmedAt, "employee sees the own assignment as binding");

  // Genehmigte Uebernahme: ebenfalls verbindlich, ohne Bestaetigungsaufforderung.
  const bBefore = await snapshot(sB);
  const takeover = (await sB.request("/api/mod-requests", "POST", { shiftId: s1.id })).request;
  await mA.request("/api/mod-requests/" + takeover.id, "PATCH", { state: "ACCEPTED" });
  const approved = (await current(s1.id)).bookings.find((b: any) => b.userId === id.staffB.id);
  check(approved?.confirmation === "PLANNER" && approved.confirmedAt, "approved takeover is binding (PLANNER)");
  check((await fresh(sB, bBefore)).every((m) => !/bestätigen/i.test(m.subject + m.body)), "approval messages ask for no confirmation");

  // Aenderung: Zuweisungen bleiben verbindlich, Information nur bei relevanter Aenderung.
  const editA = await snapshot(sA), editB = await snapshot(sB);
  await admin.request("/api/shifts/" + s1.id, "PATCH", { description: "Neuer Hinweis" });
  let edited = await current(s1.id);
  check(edited.bookings.every((b: any) => b.confirmation === "PLANNER" && b.confirmedAt) && (await fresh(sA, editA)).length === 0, "note-only change keeps the assignments binding and sends no message");
  await admin.request("/api/shifts/" + s1.id, "PATCH", { shiftFrom: "09:00" });
  edited = await current(s1.id);
  const infoA = await fresh(sA, editA), infoB = await fresh(sB, editB);
  check(edited.bookings.every((b: any) => b.confirmation === "PLANNER" && b.confirmedAt) && edited.bookings.find((b: any) => b.userId === id.staffA.id).confirmedAt === direct.confirmedAt, "time change keeps confirmations");
  check(infoA.length === 1 && infoB.length === 1 && infoA[0].subject === "Schicht geändert" && infoA[0].body.includes("09:00–16:00") && infoA[0].body.includes("08:00–16:00") && !/bestätigen/i.test(infoA[0].body), "time change: one information per person, old and new time, no confirmation request");

  // === 2. Mitarbeiter wechseln ===============================================
  // Mehrere Plaetze: genau eine Zuweisung wird ersetzt.
  const r1 = { a: await snapshot(sA), b: await snapshot(sB), e: await snapshot(emp) };
  const swapped = (await mA.request("/api/bookings", "PUT", { shiftId: s1.id, userId: id.staffA.id, replacementUserId: id.employee.id })).booking;
  check(swapped.userId === id.employee.id && swapped.confirmation === "PLANNER" && swapped.confirmedAt, "replacement is binding (PLANNER)");
  check(await holders(s1.id) === [id.staffB.id, id.employee.id].sort().join(), "replace on a two-place shift swaps exactly one assignment");
  const outA = await fresh(sA, r1.a), inE = await fresh(emp, r1.e);
  check(outA.length === 1 && outA[0].subject === "Schichtzuweisung geändert" && inE.length === 1 && inE[0].subject === "Neue Schicht" && inE[0].body.includes("fest eingeteilt") && (await fresh(sB, r1.b)).length === 0, "replace: exactly one message per affected person, none to the colleague");

  // Offene Antraege: Abgabe der ersetzten Person und Tauschanfrage abgelehnt, Uebernahme der neuen Person erfuellt.
  const d2 = addDate(today, 62), d3 = addDate(today, 63);
  const S2 = await shift(nord.id, d2, "08:00", "16:00", { maxEmployees: 2 });
  const X = await shift(nord.id, d3, "08:00", "16:00");
  await book(S2.id, id.staffA.id); await book(X.id, id.staffB.id);
  await publish(nord.id, d2); await publish(nord.id, d3);
  const giveAway = (await sA.request("/api/mod-requests", "POST", { shiftId: S2.id, kind: "SWAP" })).request;
  const wish = (await rep.request("/api/mod-requests", "POST", { shiftId: S2.id })).request;
  const exchange = (await sB.request("/api/mod-requests", "POST", { shiftId: X.id, kind: "EXCHANGE", targetShiftId: S2.id, targetUserId: id.staffA.id })).request;
  const r2 = { a: await snapshot(sA), b: await snapshot(sB), r: await snapshot(rep) };
  await mA.request("/api/bookings", "PUT", { shiftId: S2.id, userId: id.staffA.id, replacementUserId: id.replacement.id });
  check(await holders(S2.id) === id.replacement.id, "replacement with open requests succeeds");
  const g = await requestOf(sA, giveAway.id), w = await requestOf(rep, wish.id), e = await requestOf(sB, exchange.id);
  check(g.state === "DECLINED" && g.decision?.note === "Zuweisung wurde von der Planung geändert." && e.state === "DECLINED", "open hand-over and exchange request for the replaced assignment are declined");
  check(w.state === "ACCEPTED" && w.decision?.note === "Direkt eingeteilt.", "open takeover request of the replacement counts as fulfilled");
  const m2 = { a: await fresh(sA, r2.a), b: await fresh(sB, r2.b), r: await fresh(rep, r2.r) };
  check(m2.a.length === 1 && m2.a[0].subject === "Schichtzuweisung geändert" && m2.r.length === 1 && m2.r[0].subject === "Neue Schicht" && m2.b.length === 1 && m2.b[0].subject === "Schichtantrag erledigt", "request cleanup: exactly one message per person (replaced, replacement, other party)");

  // Fehlschlaege lassen die urspruengliche Zuweisung vollstaendig bestehen.
  const d4 = addDate(today, 64);
  const F = await shift(nord.id, d4, "08:00", "16:00", { maxEmployees: 2, requiredQualifications: ["Brandschutz"] });
  await book(F.id, id.employee.id);
  await publish(nord.id, d4);
  const blocker = await shift(sued.id, d4, "10:00", "14:00");
  await book(blocker.id, id.staffA.id);
  const overlap = await mA.request("/api/bookings", "PUT", { shiftId: F.id, userId: id.employee.id, replacementUserId: id.staffA.id, confirm: true }, 409);
  check(overlap.error.includes("Überschneidung") && !overlap.confirm && await holders(F.id) === id.employee.id, "overlap blocks the replacement, original assignment intact");
  const absence = (await rep.request("/api/absences", "POST", { userId: id.replacement.id, categoryId: t.categoryId, dateFrom: d4, dateTo: d4 }, 201)).absence;
  await admin.request("/api/absences/" + absence.id, "PATCH", { status: "APPROVED" });
  const absent = await admin.request("/api/bookings", "PUT", { shiftId: F.id, userId: id.employee.id, replacementUserId: id.replacement.id, confirm: true }, 409);
  check(absent.error.includes("Abwesenheit") && await holders(F.id) === id.employee.id, "approved absence blocks the replacement, original assignment intact");
  const hint = await mA.request("/api/bookings", "PUT", { shiftId: F.id, userId: id.employee.id, replacementUserId: id.staffB.id }, 409);
  check(hint.confirm === true && hint.warnings.some((x: string) => x.includes("Brandschutz")) && await holders(F.id) === id.employee.id, "qualification hint asks for one confirmation, original assignment intact");
  await mA.request("/api/bookings", "PUT", { shiftId: F.id, userId: id.employee.id, replacementUserId: id.loner.id, confirm: true }, 403);
  check(await holders(F.id) === id.employee.id, "manager cannot replace with a person outside the planning pool");
  await foreign.request("/api/bookings", "PUT", { shiftId: F.id, userId: id.employee.id, replacementUserId: id.staffB.id, confirm: true }, 404);
  await mB.request("/api/bookings", "PUT", { shiftId: F.id, userId: id.employee.id, replacementUserId: id.staffB.id, confirm: true }, 404);
  await admin.request("/api/bookings", "PUT", { shiftId: F.id, userId: id.loner.id, replacementUserId: id.staffB.id, confirm: true }, 404);
  await admin.request("/api/bookings", "PUT", { shiftId: F.id, userId: id.employee.id, replacementUserId: id.employee.id }, 400);
  await mA.request("/api/bookings", "PUT", { shiftId: F.id, userId: id.employee.id, replacementUserId: id.staffB.id, confirm: true });
  check(await holders(F.id) === id.staffB.id, "confirmed hint: replacement saved");
  await book(F.id, id.employee.id);
  await admin.request("/api/bookings", "PUT", { shiftId: F.id, userId: id.staffB.id, replacementUserId: id.employee.id, confirm: true }, 409);
  check(await holders(F.id) === [id.staffB.id, id.employee.id].sort().join(), "replacement already on the shift is rejected");

  // Vergangene Schicht und Check-in: Zuweisung bleibt Nachweis.
  const past = await shift(nord.id, addDate(today, -3), "08:00", "12:00");
  await book(past.id, id.staffA.id);
  const ended = await admin.request("/api/bookings", "PUT", { shiftId: past.id, userId: id.staffA.id, replacementUserId: id.staffB.id, confirm: true }, 409);
  check(ended.error.includes("beendet") && await holders(past.id) === id.staffA.id, "ended shift: no replacement");
  await admin.request("/api/bookings", "DELETE", { shiftId: past.id, userId: id.staffA.id }, 409);
  check(await holders(past.id) === id.staffA.id, "ended shift: no unassignment");
  const startAt = new Date(Date.now() - 10 * 60000), endAt = new Date(Date.now() + 120 * 60000), nowDate = berlinDate(startAt);
  const running = await shift(nord.id, nowDate, berlinTime(startAt), berlinTime(endAt));
  await book(running.id, id.loner.id);
  await publish(nord.id, nowDate);
  await loner.request("/api/checkin", "POST", { shiftId: running.id, manual: { failure: "DENIED", reason: "Ortung im Gebäude nicht möglich" } });
  const checkedIn = await admin.request("/api/bookings", "PUT", { shiftId: running.id, userId: id.loner.id, replacementUserId: id.staffB.id, confirm: true }, 409);
  check(checkedIn.error.includes("eingecheckt") && await holders(running.id) === id.loner.id, "check-in of the replaced person blocks the replacement");
  await admin.request("/api/bookings", "DELETE", { shiftId: running.id, userId: id.loner.id }, 409);
  check(await holders(running.id) === id.loner.id, "check-in blocks the unassignment");

  // Aufheben: offene Antraege der Person zu dieser Schicht in derselben Transaktion schliessen.
  const d5 = addDate(today, 65);
  const U = await shift(nord.id, d5, "08:00", "16:00");
  await book(U.id, id.staffA.id);
  await publish(nord.id, d5);
  const offer = (await sA.request("/api/mod-requests", "POST", { shiftId: U.id, kind: "SWAP" })).request;
  const r3 = await snapshot(sA);
  await mA.request("/api/bookings", "DELETE", { shiftId: U.id, userId: id.staffA.id });
  const gone = await fresh(sA, r3);
  check((await requestOf(sA, offer.id)).state === "DECLINED" && gone.length === 1 && gone[0].subject === "Schichtzuweisung aufgehoben" && await holders(U.id) === "", "unassignment declines the open hand-over and sends one message");

  // === 3. Anlegen mit Mitarbeiterauswahl =====================================
  const d6 = addDate(today, 70), w6 = isoWeek(d6);
  const plan6 = await plan(nord.id, d6);
  const occ = [2, 4].flatMap((d) => [weekDate(w6.year, w6.weekNumber, d), addDate(weekDate(w6.year, w6.weekNumber, d), 7)]).sort();
  await publish(nord.id, occ[0]); await publish(nord.id, occ[3]);
  const create = { scheduleId: plan6.id, dayOfWeek: 2, repeatDays: [2, 4], repeatWeeks: 2, shiftFrom: "07:00", shiftTo: "15:00", maxEmployees: 3, title: "Serie mit Auswahl", requiredQualifications: ["Brandschutz"] };
  const unknown = await admin.request("/api/shifts", "POST", { ...create, userIds: [id.staffA.id] }, 400);
  check(unknown.error.includes("userIds"), "unknown field userIds is rejected instead of ignored");
  await admin.request("/api/shifts", "POST", { ...create, userId: id.staffA.id }, 400);
  await admin.request("/api/shifts", "POST", { ...create, maxEmployees: 1, assignees: [id.staffA.id, id.employee.id] }, 400);
  await admin.request("/api/shifts", "POST", { ...create, assignees: [id.staffA.id, id.staffA.id] }, 400);
  await mA.request("/api/shifts", "POST", { ...create, assignees: [id.loner.id] }, 403);
  const preview = await mA.request("/api/shifts", "POST", { ...create, assignees: [id.employee.id, id.staffA.id], preview: true });
  check(preview.preview && preview.occurrences.map((o: any) => o.date).join() === occ.join() && preview.occurrences.every((o: any) => !o.endsNextDay && !o.duplicate) && preview.conflicts.length === 0, "preview lists all occurrences (repeatDays x repeatWeeks) without conflicts");
  check(preview.warnings.length === 4 && preview.warnings.every((x: any) => x.userId === id.staffA.id && x.name === "Emil Einser" && x.reasons.join().includes("Brandschutz")), "preview names the person, date and cause of each hint");
  check((await titled(nord.id, occ[0], "Serie mit Auswahl")).length === 0 && (await titled(nord.id, occ[3], "Serie mit Auswahl")).length === 0, "preview creates nothing");
  // Konflikt an einem Termin: nichts wird angelegt.
  const clash = await shift(sued.id, occ[1], "12:00", "18:00");
  await book(clash.id, id.employee.id);
  const conflict = await mA.request("/api/shifts", "POST", { ...create, assignees: [id.employee.id, id.staffA.id], confirm: true }, 409);
  const c0 = conflict.conflicts?.[0];
  check(conflict.conflicts?.length === 1 && c0.userId === id.employee.id && c0.date === occ[1] && c0.reasons.join().includes("Überschneidung") && conflict.error.includes("Mara Test") && conflict.error.includes(occ[1].slice(8, 10) + "." + occ[1].slice(5, 7) + "." + occ[1].slice(0, 4)), "conflict on one occurrence: 409 with person, date and cause");
  check(occ.every(Boolean) && (await titled(nord.id, occ[0], "Serie mit Auswahl")).length === 0 && (await titled(nord.id, occ[3], "Serie mit Auswahl")).length === 0, "conflict: no shift and no assignment created");
  const conflictPreview = await mA.request("/api/shifts", "POST", { ...create, assignees: [id.employee.id], preview: true });
  check(conflictPreview.conflicts.length === 1 && conflictPreview.conflicts[0].date === occ[1], "preview shows the conflict as well");
  await admin.request("/api/bookings", "DELETE", { shiftId: clash.id, userId: id.employee.id });
  const hints = await mA.request("/api/shifts", "POST", { ...create, assignees: [id.employee.id, id.staffA.id] }, 409);
  check(hints.confirm === true && hints.warnings.length === 4 && (await titled(nord.id, occ[0], "Serie mit Auswahl")).length === 0, "hints without confirmation: 409, nothing created");
  const c6 = { a: await snapshot(sA), e: await snapshot(emp), b: await snapshot(sB) };
  const series = (await mA.request("/api/shifts", "POST", { ...create, assignees: [id.employee.id, id.staffA.id], confirm: true })).shifts;
  check(series.length === 4 && series.map((s: any) => s.date).join() === occ.join() && series.every((s: any) => s.bookings.length === 2 && s.bookings.every((b: any) => b.confirmation === "PLANNER" && b.confirmedAt)), "confirmed: four shifts, each with both binding assignments");
  const n6 = { a: await fresh(sA, c6.a), e: await fresh(emp, c6.e), b: await fresh(sB, c6.b) };
  check(n6.a.length === 1 && n6.a[0].subject === "Neue Schichten" && n6.a[0].body.split("\n").length === 5 && n6.e.length === 1, "one summary message per assignee for the whole series");
  check(n6.b.length === 1 && n6.b[0].subject === "Neue offene Schichten" && n6.b[0].body.includes("KW " + w6.weekNumber), "one open-shift notice per person with access, not per week");
  const empty = (await admin.request("/api/shifts", "POST", { scheduleId: plan6.id, dayOfWeek: 1, shiftFrom: "06:00", shiftTo: "07:00", maxEmployees: 1, title: "Ohne Auswahl" })).shifts;
  check(empty.length === 1 && empty[0].bookings.length === 0, "without selection the shift stays open");

  // === 4. Kopieren auf mehrere Tage ==========================================
  const d7 = addDate(today, 80);
  const night = await shift(nord.id, d7, "22:00", "06:00", { maxEmployees: 2, title: "Nachtkopie", pauseValue: 30, description: "Pforte nutzen", requiredQualifications: ["Erste Hilfe"] });
  await book(night.id, id.staffA.id); await book(night.id, id.staffB.id);
  await publish(nord.id, d7);
  const targets = [addDate(d7, 1), addDate(d7, 2), addDate(d7, 8)];
  const copyUrl = "/api/shifts/" + night.id + "/copy";
  const copyPreview = await admin.request(copyUrl, "POST", { dates: targets, preview: true });
  check(copyPreview.occurrences.map((o: any) => o.date).join() === targets.join() && copyPreview.occurrences.every((o: any) => o.endsNextDay && o.shiftFrom === "22:00" && o.shiftTo === "06:00" && !o.duplicate), "copy preview: night shift on each target day, ends next day");
  check((await titled(nord.id, targets[0], "Nachtkopie")).length === 0 && (await titled(nord.id, targets[2], "Nachtkopie")).length === 0, "copy preview creates nothing");
  check((await admin.request(copyUrl, "POST", { dates: [d7], preview: true })).occurrences[0].duplicate === true, "copy preview flags an identical shift as duplicate");
  await mB.request(copyUrl, "POST", { dates: targets }, 404);
  await grant(id.viewer.memberId, nord.id, ["VIEW_SCHEDULE"]);
  await viewer.request(copyUrl, "POST", { dates: targets }, 403);
  await foreign.request(copyUrl, "POST", { dates: targets }, 404);
  await admin.request(copyUrl, "POST", { dates: [] }, 400);
  await admin.request(copyUrl, "POST", { dates: ["2026-02-30"] }, 400);
  await admin.request(copyUrl, "POST", { dates: [targets[0], targets[0]] }, 400);
  await admin.request(copyUrl, "POST", { dates: Array.from({ length: 63 }, (_, i) => addDate(d7, i + 1)) }, 400);
  await admin.request(copyUrl, "POST", { date: targets[0], dates: targets }, 400);
  const copies = (await admin.request(copyUrl, "POST", { dates: targets })).shifts;
  check(copies.length === 3 && copies.map((s: any) => s.date).join() === targets.join() && copies.every((s: any) => s.endsNextDay && s.shiftFrom === "22:00" && s.shiftTo === "06:00" && s.bookings.length === 0 && s.maxEmployees === 2 && s.pauseValue === 30 && s.description === "Pforte nutzen" && s.title === "Nachtkopie" && s.requiredQualifications.join() === "Erste Hilfe" && s.branchId === nord.id), "copy to several days keeps times, details and location, without assignments by default");
  const legacy = (await admin.request(copyUrl, "POST", { date: addDate(d7, 40) })).shifts;
  check(legacy.length === 1 && legacy[0].date === addDate(d7, 40), "single { date } still copies");
  // Mit Zuweisungen: Konflikt an einem Tag -> nichts angelegt.
  const late = await shift(sued.id, addDate(d7, 20), "23:00", "23:30");
  await book(late.id, id.staffA.id);
  const copyConflict = await admin.request(copyUrl, "POST", { dates: [addDate(d7, 19), addDate(d7, 20)], withAssignments: true }, 409);
  check(copyConflict.conflicts.length === 1 && copyConflict.conflicts[0].userId === id.staffA.id && copyConflict.conflicts[0].date === addDate(d7, 20) && copyConflict.error.includes("Emil Einser"), "copy with assignments: conflict names person and date");
  check((await titled(nord.id, addDate(d7, 19), "Nachtkopie")).length === 0 && (await titled(nord.id, addDate(d7, 20), "Nachtkopie")).length === 0, "copy conflict: nothing created");
  const t1 = addDate(d7, 30), t2 = addDate(d7, 31);
  await publish(nord.id, t1); await publish(nord.id, t2);
  const c7 = { a: await snapshot(sA), b: await snapshot(sB) };
  const withPeople = (await admin.request(copyUrl, "POST", { dates: [t1, t2], withAssignments: true })).shifts;
  check(withPeople.length === 2 && withPeople.every((s: any) => s.bookings.map((b: any) => b.userId).sort().join() === [id.staffA.id, id.staffB.id].sort().join() && s.bookings.every((b: any) => b.confirmation === "PLANNER")), "copy with assignments re-assigns both people (binding)");
  const n7 = { a: await fresh(sA, c7.a), b: await fresh(sB, c7.b) };
  check(n7.a.length === 1 && n7.a[0].subject === "Neue Schichten" && n7.b.length === 1, "copy with assignments: one message per person for the whole copy");

  // Nirgends eine Aufforderung zur Bestaetigung.
  for (const s of [sA, sB, emp, rep, loner]) check((await inbox(s)).every((m) => !/bitte bestätigen/i.test(m.subject + " " + m.body)), "no 'Bitte bestätigen' in any inbox");
  console.log("ASSIGNMENT: " + t.counter() + " checks so far.");
}
