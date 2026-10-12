/*
 * Konfliktpruefung einer Standortwoche (GET /api/schedules/conflicts) ueber
 * die echte API: nachtraeglich entstehende Konflikte (Abwesenheit,
 * Verfuegbarkeit, Qualifikation, Taetigkeit, Deaktivierung), Ueberschneidung
 * ueber Standorte mit Sichtbarkeit nach Rechten, Zugriff, Echtzeit-Signale
 * und Leerzustand. Teil von tests/workflows.ts; eigene Personen, Standorte
 * und eine Woche rund 150 Tage in der Zukunft.
 *
 * Eine Ueberschneidung legt die Planung beim Einteilen nach ausdruecklicher
 * Bestaetigung an (confirm: true); eine Zeitaenderung, die eine neue
 * Ueberschneidung erzeugen wuerde, lehnt die API weiterhin ab.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { io, type Socket } from "socket.io-client";
import { addDate, berlinDate, isoWeek, weekDate } from "../src/lib/berlin";
import type { TestContext } from "./permissions";
import { newPerson, planner, type Sess } from "./people";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function conflictTests(t: TestContext) {
  const { users, check } = t;
  const admin = new t.Session(); await admin.login(users.admin.email);
  const foreign = new t.Session(); await foreign.login(users.foreign.email);

  // --- Struktur ---------------------------------------------------------------
  const customer = (await admin.request("/api/customers", "POST", { name: "Konflikt Kunde" })).customer;
  const nord = (await admin.request("/api/branches", "POST", { customerId: customer.id, name: "Konflikt Nord", positions: ["Sicherheit"] })).branch;
  const sued = (await admin.request("/api/branches", "POST", { customerId: customer.id, name: "Konflikt Süd" })).branch;
  const kai = await newPerson(t, admin, "konflikt-kai", "Kai", "Konflikt");
  const lea = await newPerson(t, admin, "konflikt-lea", "Lea", "Konflikt");
  const ron = await newPerson(t, admin, "konflikt-ron", "Ron", "Konflikt");
  const mia = await newPerson(t, admin, "konflikt-mia", "Mia", "Planerin", "MANAGER");
  for (const p of [kai, lea, ron]) await admin.request("/api/employees/" + p.memberId, "PATCH", { position: "Sicherheit", qualifications: ["Erste Hilfe"] });
  // Mia plant Nord (Dienstplan ansehen folgt aus "Schichten bearbeiten"), Sued sieht sie nicht.
  await admin.request("/api/employees/" + mia.memberId + "/access", "PUT", { kind: "branch", branchId: nord.id, rights: ["EDIT_SHIFTS"] });

  const w = isoWeek(addDate(berlinDate(), 150));
  const mo = weekDate(w.year, w.weekNumber, 1), di = addDate(mo, 1), mi = addDate(mo, 2), don = addDate(mo, 3), fr = addDate(mo, 4);
  const path = (branchId: string) => "/api/schedules/conflicts?kw=" + w.weekNumber + "&year=" + w.year + "&standort=" + branchId;
  const conflicts = (s: Sess = admin, branchId = nord.id): Promise<any> => s.request(path(branchId));
  const of = (r: any, shiftId: string, kind?: string): any[] => r.items.filter((c: any) => c.shiftId === shiftId && (!kind || c.kind === kind));
  const N = planner(admin, nord.id), S = planner(admin, sued.id);
  const extra = { title: "Konflikttest" };

  const A = await N.shift(di, "08:00", "16:00", 1, { ...extra, requiredQualifications: ["Erste Hilfe"] });
  const B = await N.shift(mi, "08:00", "16:00", 1, extra);
  const C = await N.shift(don, "08:00", "16:00", 1, extra);
  const E = await N.shift(fr, "08:00", "16:00", 1, extra);
  for (const s of [A, B, C]) await N.book(s.id, kai.id);
  await N.book(E.id, ron.id);

  // --- Zugriff und Ausgangslage -----------------------------------------------------
  const clean = await conflicts();
  check(clean.items.length === 0 && clean.counts.fehler === 0 && clean.counts.hinweis === 0, "conflicts: valid assignments yield no conflicts and zero counts");
  check((await conflicts(mia.session)).items.length === 0, "conflicts: manager with plan rights at the site may read the check");
  await kai.session.request(path(nord.id), "GET", undefined, 403);
  await mia.session.request(path(sued.id), "GET", undefined, 403);
  await foreign.request(path(nord.id), "GET", undefined, 404);
  await admin.request("/api/schedules/conflicts?kw=99&year=" + w.year + "&standort=" + nord.id, "GET", undefined, 400);

  // Echtzeit: Mias Verbindung sitzt nur im Raum von Nord.
  const socket: Socket = io(t.base, { path: "/api/ws", transports: ["websocket"], extraHeaders: { Cookie: mia.session.cookie() }, reconnection: false, forceNew: true });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Socket-Verbindung kam nicht zustande")), 10000);
    socket.once("connect", () => { clearTimeout(timer); resolve(); });
    socket.once("connect_error", (error) => { clearTimeout(timer); reject(error); });
  });
  await sleep(800); // Raeume vergibt der Server nach dem Verbindungsaufbau.
  const signals: string[] = [];
  socket.on("schedule:updated", () => signals.push("schedule:updated"));
  socket.on("booking:changed", () => signals.push("booking:changed"));
  /** Aktion ausfuehren und auf das inhaltslose Signal im Raum von Nord warten. */
  async function signalled<T>(action: () => Promise<T>, event: string, message: string): Promise<T> {
    signals.length = 0;
    const result = await action();
    const start = Date.now();
    while (!signals.includes(event) && Date.now() - start < 6000) await sleep(100);
    check(signals.includes(event), message);
    return result;
  }

  try {
    // --- (a) Abwesenheit: beantragt zaehlt nicht, genehmigt ist ein Konflikt --------
    const absence = (await kai.session.request("/api/absences", "POST", { userId: kai.id, categoryId: t.categoryId, dateFrom: di, dateTo: di }, 201)).absence;
    check(of(await conflicts(), A.id).length === 0, "conflicts: a pending absence is no conflict");
    await signalled(() => admin.request("/api/absences/" + absence.id, "PATCH", { status: "APPROVED" }), "schedule:updated", "conflicts: approving an absence signals the plans of the person's sites");
    let r = await conflicts();
    const away = of(r, A.id, "absence");
    const bookingA = (await N.view(A.id, di)).bookings[0];
    check(away.length === 1 && away[0].severity === "fehler" && away[0].text === "Genehmigte Abwesenheit." && away[0].userId === kai.id && away[0].bookingId === bookingA.id && away[0].personKey === kai.id && away[0].name === "Kai Konflikt" && away[0].date === di,
      "conflicts: approved absence afterwards marks the assignment as error (person, booking, day; no absence type)");

    // --- (b) Verfuegbarkeit: "nicht verfuegbar" ist ein Konflikt, ausserhalb eines Fensters ein Hinweis
    await signalled(() => kai.session.request("/api/availability", "POST", { date: mi, timeFrom: "07:00", timeTo: "12:00", available: false }), "schedule:updated", "conflicts: an availability entry signals the plans of the person's sites");
    await kai.session.request("/api/availability", "POST", { date: don, timeFrom: "08:00", timeTo: "12:00", available: true });
    r = await conflicts();
    const blocked = of(r, B.id), outside = of(r, C.id);
    check(blocked.length === 1 && blocked[0].kind === "unavailable" && blocked[0].severity === "fehler" && blocked[0].text === "Als nicht verfügbar eingetragen.", "conflicts: entered unavailability afterwards is an error");
    check(outside.length === 1 && outside[0].kind === "availability" && outside[0].severity === "hinweis" && outside[0].text === "Schicht liegt außerhalb der eingetragenen Verfügbarkeit.", "conflicts: shift beyond the entered availability window is a hint");

    // --- (c) Stammdaten: Qualifikation entfernt, Taetigkeit geaendert -> Hinweise ----
    await signalled(() => admin.request("/api/employees/" + kai.memberId, "PATCH", { qualifications: [] }), "schedule:updated", "conflicts: changing qualifications signals the plans of the person's sites");
    r = await conflicts();
    const qual = of(r, A.id, "qualification");
    check(qual.length === 1 && qual[0].severity === "hinweis" && qual[0].text === "Erforderliche Qualifikation fehlt: Erste Hilfe.", "conflicts: removed qualification afterwards is a hint naming the qualification");
    await admin.request("/api/employees/" + kai.memberId, "PATCH", { position: "Reinigung" });
    r = await conflicts();
    check([A, B, C].every((s) => of(r, s.id, "position").some((c) => c.severity === "hinweis" && c.text === "Tätigkeit passt nicht zum Einsatzort.")), "conflicts: changed position afterwards is a hint on every shift at the site");
    check(of(r, A.id).map((c: any) => c.severity).join() === "fehler,hinweis,hinweis", "conflicts: per assignment errors come before hints");

    // --- (d) Konto deaktiviert -> einziger Grund ----------------------------------
    await signalled(() => admin.request("/api/employees/" + ron.memberId, "PATCH", { isActive: false }), "schedule:updated", "conflicts: deactivating an account signals the plans of the person's sites");
    r = await conflicts();
    const gone = of(r, E.id);
    check(gone.length === 1 && gone[0].kind === "inactive" && gone[0].severity === "fehler" && gone[0].text === "Mitarbeiter ist nicht aktiv." && gone[0].userId === ron.id, "conflicts: deactivated account afterwards is the only error of that assignment");
    const count = (severity: string) => r.items.filter((c: any) => c.severity === severity).length;
    check(r.counts.fehler === 3 && r.counts.hinweis === 5 && r.counts.fehler === count("fehler") && r.counts.hinweis === count("hinweis"), "conflicts: counts match the items (3 errors, 5 hints)");
    const mine = await conflicts(mia.session);
    check(JSON.stringify(mine.counts) === JSON.stringify(r.counts), "conflicts: the site manager sees the same check as the administration");

    // --- Ueberschneidung ueber Standorte ------------------------------------------
    const N1 = await N.shift(mo, "08:00", "16:00", 1, extra);
    const S1 = await S.shift(mo, "16:00", "20:00", 1, extra);
    await N.book(N1.id, lea.id);
    await S.book(S1.id, lea.id); // grenzt an, ueberschneidet sich nicht
    check(of(await conflicts(), N1.id).length === 0, "conflicts: adjacent shifts at two sites do not overlap");
    const refused = await admin.request("/api/shifts/" + S1.id, "PATCH", { shiftFrom: "12:00" }, 409);
    check(refused.error.includes("Lea: Zeitliche Überschneidung mit einer anderen Schicht.") && refused.error.includes("Zuweisung zuerst lösen") && !refused.confirm, "conflicts: a time change that would create an overlap is refused and explains the way to confirm it");
    // Bestaetigter Weg ueber die API: Zuweisung loesen, Zeit aendern, mit Bestaetigung neu einteilen.
    await admin.request("/api/bookings", "DELETE", { shiftId: S1.id, userId: lea.id });
    await admin.request("/api/shifts/" + S1.id, "PATCH", { shiftFrom: "12:00" });
    const asked = await admin.request("/api/bookings", "POST", { shiftId: S1.id, userId: lea.id }, 409);
    check(asked.confirm === true && asked.warnings.join() === "Zeitliche Überschneidung mit einer anderen Schicht.", "conflicts: assigning across sites with an overlap asks for confirmation");
    await S.book(S1.id, lea.id);
    r = await conflicts();
    const cross = of(r, N1.id, "overlap");
    check(cross.length === 1 && cross[0].severity === "fehler" && cross[0].text === "Zeitliche Überschneidung mit einer anderen Schicht." && cross[0].userId === lea.id, "conflicts: overlap across sites is an error at the assignment");
    check(cross[0].other?.shiftId === S1.id && cross[0].other.date === mo && cross[0].other.from === "12:00" && cross[0].other.to === "20:00" && cross[0].other.branchId === sued.id && cross[0].other.branchName === "Konflikt Süd", "conflicts: administration sees the other shift with its site");
    const hidden = of(await conflicts(mia.session), N1.id, "overlap");
    check(hidden.length === 1 && hidden[0].other?.shiftId === S1.id && hidden[0].other.branchId === undefined && hidden[0].other.branchName === undefined && !JSON.stringify(hidden).includes("Konflikt Süd"), "conflicts: manager without plan rights at the other site gets no site name (shown as 'anderer Standort')");
    const back = of(await conflicts(admin, sued.id), S1.id, "overlap");
    check(back.length === 1 && back[0].other?.shiftId === N1.id && back[0].other.branchName === "Konflikt Nord", "conflicts: the other site lists the same overlap pointing back");

    // Zuweisung am anderen Standort aufheben: Signal auch an Nord, Eintrag verschwindet ohne Neupruefen.
    await signalled(() => admin.request("/api/bookings", "DELETE", { shiftId: S1.id, userId: lea.id }), "booking:changed", "conflicts: releasing an assignment at another site signals this site too");
    check(of(await conflicts(), N1.id).length === 0 && of(await conflicts(admin, sued.id), S1.id).length === 0, "conflicts: overlap disappears after the assignment is released");

    // --- Loeschen: Eintraege verschwinden, am Ende leer -------------------------
    await admin.request("/api/shifts/" + A.id, "DELETE");
    r = await conflicts();
    check(of(r, A.id).length === 0 && r.counts.fehler === 2 && r.counts.hinweis === 3, "conflicts: entries of a deleted shift disappear and counts follow");
    for (const [shift, person] of [[B, kai], [C, kai], [E, ron], [N1, lea]] as const) await admin.request("/api/bookings", "DELETE", { shiftId: shift.id, userId: person.id });
    r = await conflicts();
    check(r.items.length === 0 && r.counts.fehler === 0 && r.counts.hinweis === 0, "conflicts: week without assignments is empty");
  } finally {
    socket.close();
  }
}
