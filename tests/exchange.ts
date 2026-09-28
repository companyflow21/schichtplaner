/*
 * Offene Schicht, Abgabe und echter Zwei-Schichten-Tausch - jeweils mit
 * Antrag, Zustimmung, Entscheidung (mit Begruendung), Ruecknahme,
 * Konflikten und gleichzeitigen Genehmigungen. Geprueft ueber die echte API.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { addDate, berlinDate, isoWeek } from "../src/lib/berlin";
import type { TestContext } from "./permissions";

export async function exchangeTests(t: TestContext) {
  const { users, check } = t;
  const session = async (email: string) => { const s = new t.Session(); await s.login(email); return s; };
  const admin = await session(users.admin.email), mA = await session(users.managerA.email), mB = await session(users.managerB.email);
  const sA = await session(users.staffA.email), sB = await session(users.staffB.email), loner = await session(users.loner.email), foreign = await session(users.foreign.email);
  const grant = (member: string, branchId: string, rights: string[]) => admin.request("/api/employees/" + member + "/access", "PUT", { kind: "branch", branchId, rights });

  // --- Eigene Standorte und Schichten ----------------------------------------
  const customer = (await admin.request("/api/customers", "POST", { name: "Tausch Kunde" })).customer;
  const nord = (await admin.request("/api/branches", "POST", { customerId: customer.id, name: "Tausch Nord" })).branch;
  const sued = (await admin.request("/api/branches", "POST", { customerId: customer.id, name: "Tausch Süd" })).branch;
  const plans = new Map<string, any>(), planPath = new Map<string, string>();
  async function shift(branchId: string, day: string, from: string, to: string, max = 1) {
    const w = isoWeek(day), key = branchId + w.year + "-" + w.weekNumber, path = "/api/schedules?kw=" + w.weekNumber + "&year=" + w.year + "&standort=" + branchId;
    if (!plans.has(key)) plans.set(key, (await admin.request(path)).schedule);
    const dayOfWeek = (new Date(day + "T12:00:00Z").getUTCDay() + 6) % 7 + 1;
    const created = (await admin.request("/api/shifts", "POST", { scheduleId: plans.get(key).id, dayOfWeek, shiftFrom: from, shiftTo: to, maxEmployees: max, title: "Tauschtest" })).shifts[0];
    planPath.set(created.id, path);
    return created;
  }
  const book = (shiftId: string, userId: string) => admin.request("/api/bookings", "POST", { shiftId, userId, confirm: true });
  const publishAll = async () => { for (const p of plans.values()) await admin.request("/api/schedules/" + p.id, "PATCH", { isPublic: true }); };
  /** Aktuelle Besetzung einer Schicht laut Standortplan (Admin-Sicht). */
  const holders = async (shiftId: string): Promise<string[]> => {
    const found = (await admin.request(planPath.get(shiftId)!)).schedule.shifts.find((s: any) => s.id === shiftId);
    return found.bookings.map((b: any) => b.userId).sort();
  };
  const inbox = async (s: InstanceType<TestContext["Session"]>, subject: string) => (await s.request("/api/messages?folder=inbox")).messages.filter((m: any) => m.subject === subject).length;

  const today = berlinDate(), d1 = addDate(today, 17), d2 = addDate(today, 18), d3 = addDate(today, 19), d4 = addDate(today, 20);
  const x = await shift(nord.id, d1, "08:00", "16:00"), y = await shift(sued.id, d2, "08:00", "16:00");
  const x2 = await shift(nord.id, d3, "06:00", "14:00"), y2 = await shift(sued.id, d4, "06:00", "14:00"), clash = await shift(sued.id, d4, "10:00", "18:00");
  const open = await shift(nord.id, d3, "18:00", "23:00");
  await book(x.id, users.staffA.id); await book(y.id, users.staffB.id);
  await book(x2.id, users.staffA.id); await book(y2.id, users.staffB.id);
  const past = await shift(nord.id, addDate(today, -8), "08:00", "12:00");
  await book(past.id, users.staffA.id);
  await publishAll();

  // --- Ohne Standortzuordnung kein Tausch -------------------------------------
  await grant(users.staffA.memberId, nord.id, ["REQUEST_SHIFTS"]);
  await grant(users.staffB.memberId, sued.id, ["REQUEST_SHIFTS"]);
  check((await sA.request("/api/mod-requests/exchange-options?shiftId=" + x.id)).options.length === 0, "no exchange partners without assignment to the other site");
  await sA.request("/api/mod-requests", "POST", { shiftId: x.id, kind: "EXCHANGE", targetShiftId: y.id, targetUserId: users.staffB.id }, 404);
  await grant(users.staffA.memberId, sued.id, ["REQUEST_SHIFTS"]);
  await grant(users.staffB.memberId, nord.id, ["REQUEST_SHIFTS"]);
  check((await sA.request("/api/mod-requests/exchange-options")).own.some((s: any) => s.id === x.id), "own future shifts offered for an exchange");
  const options = (await sA.request("/api/mod-requests/exchange-options?shiftId=" + x.id)).options;
  const option = options.find((o: any) => o.shiftId === y.id && o.userId === users.staffB.id);
  check(option && option.user === null, "exchange partner offered, without names for people without plan view");
  await sA.request("/api/mod-requests", "POST", { shiftId: past.id, kind: "SWAP" }, 409);
  await sA.request("/api/mod-requests", "POST", { shiftId: x.id, kind: "EXCHANGE", targetShiftId: y.id, targetUserId: users.staffA.id }, 400);

  // --- Tausch: Antrag -> Zustimmung -> Genehmigung ----------------------------
  const ex = (await sA.request("/api/mod-requests", "POST", { shiftId: x.id, kind: "EXCHANGE", targetShiftId: y.id, targetUserId: users.staffB.id, note: "Arzttermin" })).request;
  await sA.request("/api/mod-requests", "POST", { shiftId: x.id, kind: "EXCHANGE", targetShiftId: y.id, targetUserId: users.staffB.id }, 409);
  check((await holders(x.id)).join() === users.staffA.id && (await holders(y.id)).join() === users.staffB.id, "exchange request keeps both assignments");
  check((await inbox(sB, "Tauschanfrage")) >= 1, "partner is asked for consent");
  const forB = (await sB.request("/api/mod-requests")).requests.find((r: any) => r.id === ex.id);
  check(forB?.can.consent && !forB.can.decide && forB.targetShift?.id === y.id, "partner sees both shifts and may consent");
  await admin.request("/api/mod-requests/" + ex.id, "PATCH", { state: "ACCEPTED" }, 409);
  await loner.request("/api/mod-requests/" + ex.id, "PATCH", { consent: true }, 404);
  await sA.request("/api/mod-requests/" + ex.id, "PATCH", { consent: true }, 403);
  // Manager mit Recht nur an einem der beiden Standorte entscheidet nicht; dann die Administration.
  await grant(users.managerA.memberId, nord.id, ["HANDLE_REQUESTS"]);
  await sB.request("/api/mod-requests/" + ex.id, "PATCH", { consent: true });
  await sB.request("/api/mod-requests/" + ex.id, "PATCH", { consent: true }, 409);
  check((await inbox(admin, "Schichttausch zur Freigabe")) >= 1 && (await inbox(mA, "Schichttausch zur Freigabe")) === 0, "exchange approval goes to people with rights at both sites, otherwise to the administration");
  check((await mA.request("/api/mod-requests")).requests.find((r: any) => r.id === ex.id)?.can.decide === false, "manager with rights at one site only cannot decide");
  await mA.request("/api/mod-requests/" + ex.id, "PATCH", { state: "ACCEPTED" }, 403);
  await sB.request("/api/mod-requests/" + ex.id, "PATCH", { state: "ACCEPTED" }, 403);
  await grant(users.managerB.memberId, nord.id, ["HANDLE_REQUESTS"]);
  await grant(users.managerB.memberId, sued.id, ["HANDLE_REQUESTS"]);
  const decided = await mB.request("/api/mod-requests/" + ex.id, "PATCH", { state: "ACCEPTED", note: "Passt so." });
  check(decided.request.state === "ACCEPTED", "manager with rights at both sites approves the exchange");
  check((await holders(x.id)).join() === users.staffB.id && (await holders(y.id)).join() === users.staffA.id, "exchange swaps both assignments");
  await mB.request("/api/mod-requests/" + ex.id, "PATCH", { state: "ACCEPTED" }, 409);
  const mine = (await sA.request("/api/mod-requests")).requests.find((r: any) => r.id === ex.id);
  check(mine.state === "ACCEPTED" && mine.decision?.note === "Passt so." && (await inbox(sA, "Schichtantrag genehmigt")) >= 1 && (await inbox(sB, "Schichtantrag genehmigt")) >= 1, "requester sees status and reason; both parties are notified");

  // --- Zwischenzeitliche Aenderung verhindert die Genehmigung ------------------
  const ex2 = (await sA.request("/api/mod-requests", "POST", { shiftId: x2.id, kind: "EXCHANGE", targetShiftId: y2.id, targetUserId: users.staffB.id })).request;
  await sB.request("/api/mod-requests/" + ex2.id, "PATCH", { consent: true });
  await book(clash.id, users.staffA.id); // ueberschneidet sich mit y2
  await mB.request("/api/mod-requests/" + ex2.id, "PATCH", { state: "ACCEPTED" }, 409);
  check((await holders(x2.id)).join() === users.staffA.id && (await holders(y2.id)).join() === users.staffB.id, "rejected approval changes neither assignment (atomic)");
  await mB.request("/api/mod-requests/" + ex2.id, "PATCH", { state: "DECLINED", note: "Überschneidung mit neuer Einteilung." });
  check((await sA.request("/api/mod-requests")).requests.find((r: any) => r.id === ex2.id).state === "DECLINED", "declined exchange visible to requester");

  // --- Ablehnung durch die andere Person und Ruecknahme -----------------------
  const ex3 = (await sB.request("/api/mod-requests", "POST", { shiftId: x.id, kind: "EXCHANGE", targetShiftId: y.id, targetUserId: users.staffA.id })).request;
  await sA.request("/api/mod-requests/" + ex3.id, "PATCH", { consent: false, note: "Geht leider nicht." });
  check((await sB.request("/api/mod-requests")).requests.find((r: any) => r.id === ex3.id).state === "DECLINED" && (await inbox(sB, "Tausch abgelehnt")) >= 1, "partner declines, requester is informed");
  await mB.request("/api/mod-requests/" + ex3.id, "PATCH", { state: "ACCEPTED" }, 409);
  const ex4 = (await sB.request("/api/mod-requests", "POST", { shiftId: x.id, kind: "EXCHANGE", targetShiftId: y.id, targetUserId: users.staffA.id })).request;
  await loner.request("/api/mod-requests/" + ex4.id, "DELETE", undefined, 404);
  await sB.request("/api/mod-requests/" + ex4.id, "DELETE");
  check(!(await sB.request("/api/mod-requests")).requests.some((r: any) => r.id === ex4.id) && (await inbox(sA, "Antrag zurückgezogen")) >= 1, "own open request withdrawn, partner informed");
  check((await holders(x.id)).join() === users.staffB.id, "withdrawal leaves assignments unchanged");

  // --- Abgabe mit Ablehnung und Begruendung -----------------------------------
  const giveAway = (await sB.request("/api/mod-requests", "POST", { shiftId: x.id, kind: "SWAP" })).request;
  await mB.request("/api/mod-requests/" + giveAway.id, "PATCH", { state: "DECLINED", note: "Keine Vertretung verfügbar." });
  check((await sB.request("/api/mod-requests")).requests.find((r: any) => r.id === giveAway.id).decision.note === "Keine Vertretung verfügbar.", "hand-over declined with reason");

  // --- Offene Schicht: gleichzeitige Genehmigungen, genau eine Zuweisung -------
  const ta = (await sA.request("/api/mod-requests", "POST", { shiftId: open.id })).request;
  const tb = (await sB.request("/api/mod-requests", "POST", { shiftId: open.id })).request;
  const results = await Promise.all([ta, tb].map(r => fetch(t.base + "/api/mod-requests/" + r.id, { method: "PATCH", headers: { Cookie: mB.cookie(), "Content-Type": "application/json" }, body: JSON.stringify({ state: "ACCEPTED" }) }).then(res => res.status)));
  check(results.filter(s => s === 200).length === 1 && results.filter(s => s === 409).length === 1, "parallel approvals of one open place: exactly one succeeds");
  check((await holders(open.id)).length === 1, "open shift has exactly one valid assignment");

  // --- Keine Selbstgenehmigung, keine Organisationsgrenzen ---------------------
  await grant(users.managerB.memberId, nord.id, ["HANDLE_REQUESTS", "REQUEST_SHIFTS"]);
  const open2 = await shift(nord.id, d4, "18:00", "22:00");
  await publishAll();
  const own = (await mB.request("/api/mod-requests", "POST", { shiftId: open2.id })).request;
  await mB.request("/api/mod-requests/" + own.id, "PATCH", { state: "ACCEPTED" }, 403);
  await foreign.request("/api/mod-requests/" + own.id, "PATCH", { state: "ACCEPTED" }, 404);
  check(!(await foreign.request("/api/mod-requests")).requests.some((r: any) => r.id === own.id), "requests stay inside the organisation");
  await admin.request("/api/mod-requests/" + own.id, "PATCH", { state: "ACCEPTED" });
  check((await holders(open2.id)).join() === users.managerB.id, "someone else approves the manager's own request");

  console.log("EXCHANGE: " + t.counter() + " checks so far.");
}
