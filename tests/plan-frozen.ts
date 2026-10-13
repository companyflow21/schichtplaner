/*
 * Eingefrorene Mitarbeitersicht waehrend der Bearbeitung (BAUSTEINE.md,
 * Entscheidung 1): Solange ein Plan in Bearbeitung ist, sehen Mitarbeitende
 * in allen Leseansichten den Stand der Momentaufnahme, die Planung sieht die
 * Live-Zeilen. Nach Verwerfen bleibt der alte, nach Veroeffentlichen gilt der
 * neue Stand. Geprueft ueber die echte API; Teil von tests/workflows.ts.
 * Eigener Standort, Woche in gut drei Wochen (hinter den Abwesenheiten aus
 * tests/permissions.ts, vor den Grenzen Startseite 60 und Nachrichtenbezug 30
 * Tage), fruehe Uhrzeiten ohne Ueberschneidung mit anderen Reihen; dazu ein
 * Standort in der laufenden Woche fuer den Check-in.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { addDate, berlinDate, isoWeek, weekDate } from "../src/lib/berlin";
import type { TestContext } from "./permissions";
import { dayOfWeek, newPerson, type Sess } from "./people";

const EDITING_REQUESTS = "Diese Woche wird gerade überarbeitet. Anträge sind nach der Veröffentlichung wieder möglich.";

/** JSON zum Vergleich: Buchungen nach id, ohne Erzeugungszeit des Exports; loose ignoriert can.request und requestsPaused (Antraege ruhen waehrend der Bearbeitung). */
function norm(value: unknown, loose = false): string {
  return JSON.stringify(value, (key, v) => key === "generatedAt" || (loose && key === "requestsPaused") ? undefined
    : loose && key === "can" && v ? { ...v, request: "*" }
    : key === "bookings" && Array.isArray(v) ? [...v].sort((x: any, y: any) => x.id < y.id ? -1 : 1)
    : v);
}

export async function planFrozenTests(t: TestContext) {
  const { users, check } = t;
  const login = async (email: string) => { const s = new t.Session(); await s.login(email); return s; };
  const admin = await login(users.admin.email), sA = await login(users.staffA.email), sB = await login(users.staffB.email);

  // --- Struktur und Rechte ------------------------------------------------------
  const customer = (await admin.request("/api/customers", "POST", { name: "Eingefroren Kunde" })).customer;
  const site = async (name: string) => (await admin.request("/api/branches", "POST", { customerId: customer.id, name })).branch;
  const nord = await site("Eingefroren Nord"), heute = await site("Eingefroren Heute");
  const grant = (memberId: string, branchId: string, rights: string[]) => admin.request("/api/employees/" + memberId + "/access", "PUT", { kind: "branch", branchId, rights });
  await grant(users.staffA.memberId, nord.id, ["REQUEST_SHIFTS"]);
  await grant(users.staffB.memberId, nord.id, ["VIEW_SCHEDULE"]);
  const mgr = await newPerson(t, admin, "frozen.mgr", "Fritz", "Planblick", "MANAGER");
  await grant(mgr.memberId, nord.id, ["VIEW_SCHEDULE"]);
  const none = await newPerson(t, admin, "frozen.none", "Nina", "Ohnerecht");
  const division = (await admin.request("/api/divisions", "POST", { title: "Eingefroren Bereich", color: "#336699" }, 201)).division;

  const today = berlinDate();
  const w = isoWeek(addDate(today, 22));
  const day = (n: number) => weekDate(w.year, w.weekNumber, n);
  const sitePath = (branchId: string, date: string) => { const x = isoWeek(date); return "/api/schedules?kw=" + x.weekNumber + "&year=" + x.year + "&standort=" + branchId; };
  const mergedPath = "/api/schedules?kw=" + w.weekNumber + "&year=" + w.year;
  const planOf = async (s: Sess, branchId = nord.id, date = day(1)) => (await s.request(sitePath(branchId, date))).schedule;
  async function shift(date: string, from: string, to: string, extra: Record<string, unknown> = {}, branchId = nord.id) {
    const plan = await planOf(admin, branchId, date);
    return (await admin.request("/api/shifts", "POST", { scheduleId: plan.id, dayOfWeek: dayOfWeek(date), shiftFrom: from, shiftTo: to, maxEmployees: 1, title: "Eingefroren", confirm: true, ...extra })).shifts[0];
  }

  // --- Veroeffentlichter Stand: drei Schichten, staffA in zweien ----------------
  const S1 = await shift(day(1), "03:10", "05:10", { title: "Frühdienst", description: "Tor 3", pauseOption: "PER_SHIFT", pauseValue: 30, requiredQualifications: ["Erste Hilfe"], divisionId: division.id, assignees: [users.staffA.id] });
  const S2 = await shift(day(2), "03:10", "05:10", { title: "Offen" });
  const S3 = await shift(day(3), "03:10", "05:10", { title: "Mitteldienst", assignees: [users.staffA.id] });
  const plan = await planOf(admin);
  const editing = "/api/schedules/" + plan.id + "/editing";
  await admin.request("/api/schedules/" + plan.id, "PATCH", { isPublic: true });
  const message = (await admin.request("/api/messages", "POST", { subject: "Eingefroren Bezug", body: "Bitte Tor 3 nutzen.", recipientIds: [users.staffA.id], shiftId: S3.id }, 201)).message;
  await sA.request("/api/messages/" + message.id); // gelesen - der Zaehler bleibt danach stabil

  const range = "from=" + day(1) + "&to=" + day(7), period = "month=" + Number(day(1).slice(5, 7)) + "&year=" + day(1).slice(0, 4);
  /** Alle Leseansichten der Mitarbeitenden, die der Plan beruehrt. */
  const employeeViews = async () => ({
    planA: await sA.request(sitePath(nord.id, day(1))), planB: await sB.request(sitePath(nord.id, day(1))),
    mergedA: await sA.request(mergedPath), mergedB: await sB.request(mergedPath),
    dashA: await sA.request("/api/dashboard"), dashB: await sB.request("/api/dashboard"),
    monthB: await sB.request("/api/branches/" + nord.id + "/month?monat=" + day(1).slice(0, 7)),
    exportA: await sA.request("/api/schedules/export?" + range), exportB: await sB.request("/api/schedules/export?" + range + "&branchId=" + nord.id),
    refsA: await sA.request("/api/messages/references"), refsB: await sB.request("/api/messages/references"),
    inboxA: (await sA.request("/api/messages?folder=inbox")).messages.find((m: any) => m.id === message.id),
    detailA: (await sA.request("/api/messages/" + message.id)).message,
    // Monatsauswertung und Stunden-CSV: Planstunden laut veroeffentlichtem Stand.
    reportA: await sA.request("/api/reporting?" + period), csvA: await sA.request("/api/reporting/export?" + period),
  });
  const before = await employeeViews();
  const adminBefore = await planOf(admin);
  const own = (views: any, id: string) => views.planA.schedule.shifts.find((s: any) => s.id === id);
  check(own(before, S1.id)?.bookings[0]?.userId === users.staffA.id && own(before, S2.id)?.can.request === true && before.planB.schedule.shifts.length === 3, "published plan: staffA sees own and open shifts, staffB the full plan");
  check(before.dashA.own.some((s: any) => s.id === S1.id) && before.dashA.open.some((s: any) => s.id === S2.id), "published plan: own shift and requestable open shift on staffA's home page");
  check(before.inboxA.reference.includes("03:10–05:10") && before.refsA.shifts.some((s: any) => s.id === S1.id), "published plan: message reference and referencable own shift");
  // requestsPaused: Schichten des Plans in Standortplan, Mein Dienstplan und auf der Startseite der Mitarbeitenden.
  const planShifts = (v: any) => [v.planA, v.planB, v.mergedA, v.mergedB].flatMap((r: any) => r.schedule.shifts).concat(v.dashA.own, v.dashB.own).filter((s: any) => s.scheduleId === plan.id);
  const paused = (v: any, value: boolean) => planShifts(v).length > 0 && planShifts(v).every((s: any) => s.requestsPaused === value);
  check(paused(before, false) && before.dashA.own.some((s: any) => s.id === S1.id && s.requestsPaused === false), "published plan: employee views report requestsPaused false");

  // --- Bearbeitung: Zeit aendern, neu anlegen, loeschen, Zuweisung wechseln ------
  await admin.request(editing, "POST");
  await admin.request("/api/shifts/" + S3.id, "PATCH", { shiftFrom: "03:40", shiftTo: "05:40" });
  const S4 = await shift(day(4), "03:10", "05:10", { title: "Neu" });
  await admin.request("/api/shifts/" + S2.id, "DELETE");
  await admin.request("/api/bookings", "DELETE", { shiftId: S1.id, userId: users.staffA.id });
  await admin.request("/api/bookings", "POST", { shiftId: S1.id, userId: users.staffB.id, confirm: true });

  const during = await employeeViews();
  const strip = (v: any) => ({ ...v, dashA: { ...v.dashA, open: null }, dashB: { ...v.dashB, open: null } });
  for (const key of Object.keys(before)) check(norm((strip(before) as any)[key], true) === norm((strip(during) as any)[key], true), "while editing, employee view unchanged: " + key);
  check(during.planA.schedule.shifts.every((s: any) => s.can.request === false) && during.planB.schedule.shifts.every((s: any) => s.can.request === false), "while editing, requests rest (can.request false)");
  check(paused(during, true) && during.dashA.own.some((s: any) => s.id === S1.id && s.requestsPaused === true) && during.mergedA.schedule.shifts.some((s: any) => s.id === S1.id && s.requestsPaused === true), "while editing, employee views report requestsPaused true (site plan, merged view, home page)");
  check(!/"editing(Since|By)"|"status":"EDITING"/.test(JSON.stringify(during)), "while editing, employee responses name neither editingSince/editingBy nor the status");
  check(![...during.dashA.open, ...during.dashB.open].some((s: any) => s.scheduleId === plan.id), "while editing, the home page offers no shift of the plan for requests");
  check(own(during, S3.id).shiftFrom === "03:10" && own(during, S1.id)?.bookings[0]?.userId === users.staffA.id && !own(during, S4.id) && !!own(during, S2.id), "staffA still sees the published state (old time, own assignment, deleted shift, no new shift)");
  check(!during.dashB.own.some((s: any) => s.id === S1.id) && !during.refsB.shifts.some((s: any) => s.id === S1.id), "staffB's new live assignment stays invisible to staffB");

  const live = await planOf(admin), ids = (p: any) => p.shifts.map((s: any) => s.id).sort().join();
  const liveS1 = live.shifts.find((s: any) => s.id === S1.id);
  check(live.shifts.find((s: any) => s.id === S3.id).shiftFrom === "03:40" && live.shifts.some((s: any) => s.id === S4.id) && !live.shifts.some((s: any) => s.id === S2.id) && liveS1.bookings.map((b: any) => b.userId).join() === users.staffB.id, "admin sees the live state");
  check(live.status === "EDITING" && !!live.editingSince && !!live.editingBy?.name && live.shifts.every((s: any) => s.requestsPaused === true && s.can.edit === true), "planner response keeps the lifecycle fields; its shifts carry requestsPaused with edit rights (no employee hint)");
  const mgrPlan = await planOf(mgr.session);
  check(ids(mgrPlan) === ids(live) && mgrPlan.shifts.find((s: any) => s.id === S3.id).shiftFrom === "03:40", "manager with Dienstplan ansehen (planner) sees the live state");
  check((await mgr.session.request(mergedPath)).schedule.shifts.some((s: any) => s.id === S4.id), "planner's merged view is live too");
  check((await mgr.session.request("/api/branches/" + nord.id + "/month?monat=" + day(4).slice(0, 7))).days.some((d: any) => d.shifts.some((s: any) => s.id === S4.id)), "planner's month view is live too");

  // Ohne Buchung und ohne Standortrechte: nichts, weder live noch eingefroren.
  await none.session.request(sitePath(nord.id, day(1)), "GET", undefined, 404);
  const noneMerged = await none.session.request(mergedPath), noneDash = await none.session.request("/api/dashboard"), noneExport = await none.session.request("/api/schedules/export?" + range), noneRefs = await none.session.request("/api/messages/references");
  const planIds = new Set([S1.id, S2.id, S3.id, S4.id]);
  check(!noneMerged.schedule.shifts.some((s: any) => planIds.has(s.id)) && !noneDash.own.some((s: any) => planIds.has(s.id)) && !noneExport.rows.some((r: any) => r.branch === nord.name) && !noneRefs.shifts.some((s: any) => planIds.has(s.id)), "person without assignment and site rights sees nothing of the plan");

  // Bestaetigen ruht; Nachrichtenbezug folgt der Momentaufnahme.
  check((await sA.request("/api/bookings", "PATCH", { shiftId: S3.id }, 409)).error === EDITING_REQUESTS, "confirming during editing: 409 with explanation");
  await sA.request("/api/bookings", "PATCH", { shiftId: S1.id }, 409);
  check((await admin.request("/api/messages?folder=sent")).messages.find((m: any) => m.id === message.id).reference.includes("03:40–05:40"), "planner reads the message reference live");
  await sA.request("/api/messages", "POST", { subject: "Frage", body: "Zur Frühschicht.", recipientIds: [users.admin.id], shiftId: S1.id }, 201);
  await sA.request("/api/messages", "POST", { subject: "Frage", body: "Zur neuen Schicht.", recipientIds: [users.admin.id], shiftId: S4.id }, 404);

  // --- Verwerfen: weiterhin der alte Stand, live wiederhergestellt ---------------
  await admin.request(editing, "DELETE");
  const discarded = await employeeViews();
  for (const key of Object.keys(before)) check(norm((before as any)[key]) === norm((discarded as any)[key]), "after discard, employee view unchanged: " + key);
  check(norm(await planOf(admin)) === norm(adminBefore), "after discard the live state equals the published state");
  check(paused(discarded, false), "after discard, employee views report requestsPaused false again");
  await sA.request("/api/bookings", "PATCH", { shiftId: S3.id });

  // --- Erneut bearbeiten und veroeffentlichen: der neue Stand gilt ----------------
  await admin.request(editing, "POST");
  await admin.request("/api/shifts/" + S3.id, "PATCH", { shiftFrom: "03:40", shiftTo: "05:40" });
  const S5 = await shift(day(4), "03:10", "05:10", { title: "Neu" });
  await admin.request("/api/shifts/" + S2.id, "DELETE");
  await admin.request("/api/bookings", "DELETE", { shiftId: S1.id, userId: users.staffA.id });
  await admin.request("/api/bookings", "POST", { shiftId: S1.id, userId: users.staffB.id, confirm: true });
  await admin.request("/api/schedules/" + plan.id, "PATCH", { isPublic: true });
  const after = await employeeViews();
  check(own(after, S3.id).shiftFrom === "03:40" && !own(after, S1.id) && !own(after, S2.id) && own(after, S5.id)?.can.request === true, "after publishing, staffA sees the new state (new time, no longer assigned, new open shift)");
  check(after.planB.schedule.shifts.find((s: any) => s.id === S1.id).bookings.map((b: any) => b.userId).join() === users.staffB.id && after.dashB.own.some((s: any) => s.id === S1.id), "after publishing, staffB sees the new assignment");
  check(paused(after, false) && after.dashB.own.some((s: any) => s.id === S1.id && s.requestsPaused === false), "after publishing, employee views report requestsPaused false");
  check(!after.dashA.own.some((s: any) => s.id === S1.id) && after.dashA.own.find((s: any) => s.id === S3.id)?.shiftFrom === "03:40" && after.mergedA.schedule.shifts.find((s: any) => s.id === S3.id)?.shiftFrom === "03:40", "after publishing, staffA's home page and merged view follow");
  const plannedA = (views: any) => views.reportA.employees.find((e: any) => e.userId === users.staffA.id).plannedMinutes;
  check(plannedA(after) === plannedA(before) - 90, "after publishing, staffA's planned hours drop by the released shift (90 net minutes)");
  check(after.inboxA.reference.includes("03:40–05:40") && !after.refsA.shifts.some((s: any) => s.id === S1.id) && after.exportA.rows.some((r: any) => r.branch === nord.name && r.shiftFrom === "03:40"), "after publishing, message reference, references and export follow");

  // --- Check-in bleibt live, zeigt aber keine erst in der Bearbeitung angelegte Schicht
  await shift(today, "00:01", "00:02", { title: "Heute" }, heute.id);
  const current = await planOf(admin, heute.id, today);
  await admin.request("/api/schedules/" + current.id, "PATCH", { isPublic: true });
  await admin.request("/api/schedules/" + current.id + "/editing", "POST");
  const T = await shift(today, "00:03", "00:05", { title: "Heute neu", assignees: [users.staffA.id] }, heute.id);
  check(!(await sA.request("/api/checkin")).shifts.some((s: any) => s.id === T.id), "check-in does not list a shift created during editing");
  await admin.request("/api/schedules/" + current.id, "PATCH", { isPublic: true, notify: false });
  check((await sA.request("/api/checkin")).shifts.some((s: any) => s.id === T.id), "after publishing the shift is listed for check-in");
}
