/*
 * Mitarbeiteranlage mit Standorten und Besetzung nach Standortzuordnung -
 * geprueft ueber die echte API. Dritter Teil von tests/workflows.ts (gleicher
 * Server, gleiche In-Memory-Datenbank).
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { addDate, berlinDate, isoWeek } from "../src/lib/berlin";
import type { TestContext } from "./permissions";

export async function staffSiteTests(t: TestContext) {
  const { users, check, password } = t;
  const session = async (email: string) => { const s = new t.Session(); await s.login(email); return s; };
  const admin = await session(users.admin.email), mB = await session(users.managerB.email), mA = await session(users.managerA.email);
  const anonymous = new t.Session();
  const activate = (url: string, expected = 200) => anonymous.request("/api/auth/activate", "POST", { token: new URL(url).searchParams.get("token"), password }, expected);
  const access = (memberId: string) => admin.request("/api/employees/" + memberId + "/access");

  // --- Struktur: Kunde 1 mit fuenf Standorten, Kunde 2 mit einem ----------
  const kunde = async (name: string) => (await admin.request("/api/customers", "POST", { name })).customer;
  const k1 = await kunde("Kunde Anlage Eins"), k2 = await kunde("Kunde Anlage Zwei");
  const standort = async (customerId: string, name: string, extra: Record<string, unknown> = {}) => (await admin.request("/api/branches", "POST", { customerId, name, ...extra })).branch;
  const s1 = await standort(k1.id, "Anlage 1"), s2 = await standort(k1.id, "Anlage 2", { positions: ["Pforte"] }), s3 = await standort(k1.id, "Anlage 3");
  const s4 = await standort(k1.id, "Anlage 4"), s5 = await standort(k1.id, "Anlage 5"), s6 = await standort(k2.id, "Anlage 6");

  // Planende Managerin: Schichten an 1, 2 (Kunde 1) und 6 (Kunde 2), an 3 nur ansehen.
  const paula = (await admin.request("/api/employees", "POST", { employees: [{ firstName: "Paula", lastName: "Planer", email: "paula.planer@akro-test.invalid", role: "MANAGER" }] }, 201)).members[0];
  check(paula.activationUrl?.includes("/activate?token=") && !JSON.stringify(paula).includes("activationToken"), "creator receives the activation link, never the token field");
  await activate(paula.activationUrl);
  const mP = await session("paula.planer@akro-test.invalid");
  const grant = (memberId: string, branchId: string, rights: string[]) => admin.request("/api/employees/" + memberId + "/access", "PUT", { kind: "branch", branchId, rights });
  await grant(paula.id, s1.id, ["EDIT_SHIFTS"]); await grant(paula.id, s2.id, ["EDIT_SHIFTS"]); await grant(paula.id, s6.id, ["EDIT_SHIFTS"]); await grant(paula.id, s3.id, ["VIEW_SCHEDULE"]);

  // --- Manager legen nur Mitarbeitende an, nur an eigenen Planungsstandorten
  const row = (email: string, branchIds: string[], role = "EMPLOYEE") => ({ firstName: "Test", lastName: email.split("@")[0], email, role, branchIds });
  const create = (s: typeof mP, employees: unknown[], expected = 201) => s.request("/api/employees", "POST", { employees }, expected);
  await create(mP, [row("hoch-manager@akro-test.invalid", [s1.id], "MANAGER")], 403);
  await create(mP, [row("hoch-admin@akro-test.invalid", [], "ADMIN")], 403);
  await create(mP, [row("nur-ansicht@akro-test.invalid", [s3.id])], 403);
  await create(mP, [row("ohne-freigabe@akro-test.invalid", [s4.id])], 403);
  await create(mP, [row("erfunden@akro-test.invalid", ["kein-standort"])], 403);
  await create(mP, [row("ohne-standort@akro-test.invalid", [])], 400);
  await create(mP, [row("gemischt-gut@akro-test.invalid", [s1.id]), row("gemischt-hoch@akro-test.invalid", [s1.id], "MANAGER")], 403);
  await create(mP, [row("gemischt-gut@akro-test.invalid", [s1.id]), row("gemischt-fremd@akro-test.invalid", [s4.id])], 403);
  check((await admin.request("/api/employees?status=all&search=gemischt")).members.length === 0, "a rejected batch creates nobody");
  await create(mP, [row(users.staffA.email, [s1.id])], 409);
  await create(mA, [row("ohne-planung@akro-test.invalid", [s1.id])], 403);
  await (await session(users.staffA.email)).request("/api/employees", "POST", { employees: [row("mitarbeiter@akro-test.invalid", [s1.id])] }, 403);
  await (await session(users.foreign.email)).request("/api/employees", "POST", { employees: [row("fremd-org@akro-test.invalid", [s1.id])] }, 404);
  await create(admin, [row("admin-falsch@akro-test.invalid", ["kein-standort"])], 404);
  await create(admin, [row("manager-standort@akro-test.invalid", [s1.id], "MANAGER")], 400);

  // Manipulierte Zusatzfelder vergeben weder Rechte noch Aktivierung.
  const manip = (await create(mP, [{ ...row("zusatzfelder@akro-test.invalid", [s1.id]), rights: ["VIEW_SCHEDULE", "EDIT_SHIFTS"], isActivated: true, isActive: true, createdByMemberId: users.admin.memberId, organizationId: "fremd" }])).members[0];
  const manipAccess = await access(manip.id);
  check(manip.role === "EMPLOYEE" && manip.isActivated === false && manipAccess.grants.length === 1 && manipAccess.grants[0].rights.join() === "REQUEST_SHIFTS", "extra request fields grant no rights and no activation");

  // Gueltige Anlage: einzelne Standorte, auch ueber Kunden hinweg.
  const [tina, udo] = (await create(mP, [
    { firstName: "Tina", lastName: "Zweistand", email: "tina@akro-test.invalid", role: "EMPLOYEE", branchIds: [s1.id, s2.id, s1.id] },
    { firstName: "Udo", lastName: "Kundenwechsel", email: "udo@akro-test.invalid", role: "EMPLOYEE", branchIds: [s2.id, s6.id] },
  ])).members;
  const tinaAccess = await access(tina.id), udoAccess = await access(udo.id);
  const ids = (grants: any[]) => grants.map((g) => g.branchId).sort().join();
  const kunde1 = [s1, s2, s3, s4, s5].filter((b) => tinaAccess.grants.some((g: any) => g.branchId === b.id));
  check(kunde1.map((b) => b.id).join() === [s1.id, s2.id].join() && ids(tinaAccess.grants) === [s1.id, s2.id].sort().join() && tinaAccess.grants.every((g: any) => g.rights.join() === "REQUEST_SHIFTS"), "employee assigned to exactly two of five customer locations, as open-shift assignment only");
  check(ids(udoAccess.grants) === [s2.id, s6.id].sort().join(), "assignment across customers");
  check(tinaAccess.managers.length === 1 && tinaAccess.managers[0].memberId === paula.id && tinaAccess.managers[0].rights.join() === "ASSIGN_SHIFTS", "creating manager may plan the new person, nothing more");

  // --- Aktivierungslink: Manager nur fuer selbst angelegte Konten ----------
  const renewed = await mP.request("/api/employees/" + tina.id + "/invite", "POST");
  check(renewed.url.includes("/activate?token="), "manager renews the activation link of an account they created");
  await activate(tina.activationUrl, 400);
  await activate(renewed.url);
  await mP.request("/api/employees/" + tina.id + "/invite", "POST", undefined, 409);
  await mB.request("/api/employees/" + udo.id + "/invite", "POST", undefined, 403);
  await mP.request("/api/employees/" + users.staffB.memberId + "/invite", "POST", undefined, 403);
  const vera = (await create(admin, [{ firstName: "Vera", lastName: "Verwaltung", email: "vera@akro-test.invalid", role: "EMPLOYEE", branchIds: [s1.id, s4.id] }])).members[0];
  await admin.request("/api/employees/" + paula.id + "/access", "PUT", { kind: "staff", memberId: vera.id, rights: ["ASSIGN_SHIFTS"] });
  await mP.request("/api/employees/" + vera.id + "/invite", "POST", undefined, 403);
  await activate(udo.activationUrl);
  await activate(vera.activationUrl);
  const list = await mP.request("/api/employees?status=all");
  const zeile = (id: string) => list.members.find((m: any) => m.id === id);
  check(list.canCreate && zeile(manip.id).canInvite && !zeile(vera.id).canInvite && zeile(tina.id).sites.length === 2, "staff list offers creation, invitation and locations within the manager's scope");

  // --- Standortzuordnung spaeter aendern -----------------------------------
  const sitesP = (await mP.request("/api/employees/" + tina.id + "/sites")).sites;
  check(sitesP.map((s: any) => s.id).sort().join() === [s1.id, s2.id, s6.id].sort().join() && sitesP.filter((s: any) => s.assigned).length === 2, "manager changes assignments only among own planning locations");
  await mP.request("/api/employees/" + tina.id + "/sites", "PUT", { branchIds: [s1.id, s3.id] }, 403);
  await mP.request("/api/employees/" + tina.id + "/sites", "PUT", { branchIds: [s1.id, s6.id] });
  check(ids((await access(tina.id)).grants) === [s1.id, s6.id].sort().join(), "manager moves an employee between own locations");
  await grant(tina.id, s6.id, ["VIEW_SCHEDULE"]);
  await mP.request("/api/employees/" + tina.id + "/sites", "PUT", { branchIds: [s1.id] }, 403);
  check((await access(tina.id)).grants.some((g: any) => g.branchId === s6.id && g.rights.includes("VIEW_SCHEDULE")), "manager cannot remove a grant that goes beyond the assignment");
  await admin.request("/api/employees/" + tina.id + "/sites", "PUT", { branchIds: [s1.id, s2.id] });
  check(ids((await access(tina.id)).grants) === [s1.id, s2.id].sort().join(), "administration changes any assignment");
  await mP.request("/api/employees/" + vera.id + "/sites", "PUT", { branchIds: [s2.id] });
  check(ids((await access(vera.id)).grants) === [s2.id, s4.id].sort().join(), "locations outside the manager's scope stay untouched");
  await admin.request("/api/employees/" + vera.id + "/sites", "PUT", { branchIds: [s1.id, s4.id] });
  await mP.request("/api/employees/" + users.staffB.memberId + "/sites", "GET", undefined, 404);
  await mP.request("/api/employees/" + users.managerB.memberId + "/sites", "PUT", { branchIds: [s1.id] }, 404);
  await admin.request("/api/employees/" + users.managerB.memberId + "/sites", "GET", undefined, 400);
  check((await admin.request("/api/employees/" + vera.id + "/sites")).sites.length >= 6, "administration sees all locations");

  // --- Besetzen: Personen fuer Anlage 1 ------------------------------------
  const namen = ["Anna Verfuegbar", "Bert Offen", "Cora Hinweis", "Dora Urlaub", "Emil Nein", "Fritz Doppelt", "Gerd Inaktiv"];
  const angelegt = (await create(mP, namen.map((n) => {
    const [firstName, lastName] = n.split(" ");
    return { firstName, lastName, email: firstName.toLowerCase() + ".besetzen@akro-test.invalid", role: "EMPLOYEE", branchIds: firstName === "Fritz" ? [s1.id, s2.id] : [s1.id] };
  }))).members;
  const p: Record<string, any> = Object.fromEntries(angelegt.map((m: any) => [m.user.firstName, m]));
  for (const m of angelegt) await activate(m.activationUrl);
  for (const name of ["Anna", "Bert", "Dora", "Emil", "Fritz", "Gerd"]) await admin.request("/api/employees/" + p[name].id, "PATCH", { qualifications: ["Erste Hilfe"] });
  await admin.request("/api/employees/" + vera.id, "PATCH", { qualifications: ["Erste Hilfe"] });
  // Weitere Personen (von der Administration angelegt, ohne Personalzuordnung):
  // Hanna an Anlage 1, Ida an Anlage 2, Jan an Anlage 6 (anderer Kunde), Kai an
  // Anlage 3 (Paula nur Ansicht), Lea und Mo ohne Standort. Quirin plant wie
  // Paula an Anlage 1, aber nur dort.
  const weitere = (await create(admin, [
    { firstName: "Hanna", lastName: "Ohnezuordnung", email: "hanna@akro-test.invalid", role: "EMPLOYEE", branchIds: [s1.id] },
    { firstName: "Ida", lastName: "Nebenan", email: "ida@akro-test.invalid", role: "EMPLOYEE", branchIds: [s2.id] },
    { firstName: "Jan", lastName: "Anderkunde", email: "jan@akro-test.invalid", role: "EMPLOYEE", branchIds: [s6.id] },
    { firstName: "Kai", lastName: "Fremdstandort", email: "kai@akro-test.invalid", role: "EMPLOYEE", branchIds: [s3.id] },
    { firstName: "Lea", lastName: "Persoenlich", email: "lea@akro-test.invalid", role: "EMPLOYEE", branchIds: [] },
    { firstName: "Mo", lastName: "Persoenlich", email: "mo@akro-test.invalid", role: "EMPLOYEE", branchIds: [] },
    { firstName: "Quirin", lastName: "Zweitplaner", email: "quirin@akro-test.invalid", role: "MANAGER" },
  ])).members;
  const q: Record<string, any> = Object.fromEntries(weitere.map((m: any) => [m.user.firstName, m]));
  for (const m of weitere) await activate(m.activationUrl);
  for (const name of ["Hanna", "Ida", "Jan", "Kai", "Lea", "Mo"]) await admin.request("/api/employees/" + q[name].id, "PATCH", { qualifications: ["Erste Hilfe"] });
  for (const name of ["Lea", "Mo"]) await admin.request("/api/employees/" + paula.id + "/access", "PUT", { kind: "staff", memberId: q[name].id, rights: ["ASSIGN_SHIFTS"] });
  await grant(q.Quirin.id, s1.id, ["EDIT_SHIFTS"]);
  const mQ = await session("quirin@akro-test.invalid");

  const day = addDate(berlinDate(), 45), week = isoWeek(day), dow = ((new Date(day).getUTCDay() + 6) % 7) + 1;
  const plan = (b: { id: string }) => "/api/schedules?kw=" + week.weekNumber + "&year=" + week.year + "&standort=" + b.id;
  const plan1 = (await mP.request(plan(s1))).schedule, plan2 = (await mP.request(plan(s2))).schedule;
  const shift = (await mP.request("/api/shifts", "POST", { scheduleId: plan1.id, dayOfWeek: dow, shiftFrom: "08:00", shiftTo: "16:00", maxEmployees: 6, title: "Objektschutz", requiredQualifications: ["Erste Hilfe"] })).shifts[0];
  const pforte = (await mP.request("/api/shifts", "POST", { scheduleId: plan2.id, dayOfWeek: dow, shiftFrom: "10:00", shiftTo: "14:00", maxEmployees: 1, title: "Pforte" })).shifts[0];

  // Verfuegbarkeit, Abwesenheit, Ueberschneidung, Deaktivierung
  await (await session("anna.besetzen@akro-test.invalid")).request("/api/availability", "POST", { date: day, timeFrom: "06:00", timeTo: "18:00", available: true });
  await (await session("emil.besetzen@akro-test.invalid")).request("/api/availability", "POST", { date: day, timeFrom: "07:00", timeTo: "17:00", available: false });
  for (const userId of [p.Dora.user.id, q.Ida.user.id, q.Mo.user.id]) await admin.request("/api/absences", "POST", { userId, categoryId: t.categoryId, dateFrom: day, dateTo: day, status: "APPROVED" }, 201);
  // Taetigkeit passt nicht zum Einsatzort (Anlage 2 verlangt "Pforte"): Hinweis mit einer Bestaetigung.
  const pforteOhne = await mP.request("/api/bookings", "POST", { shiftId: pforte.id, userId: p.Fritz.user.id }, 409);
  check(pforteOhne.confirm === true && pforteOhne.warnings.some((w: string) => w.includes("Tätigkeit")), "activity mismatch asks for confirmation instead of blocking");
  await mP.request("/api/bookings", "POST", { shiftId: pforte.id, userId: p.Fritz.user.id, confirm: true });
  await admin.request("/api/employees/" + p.Gerd.id, "DELETE");

  // --- Reihenfolge der Auswahl (Paula: Anlage 1, 2 und 6 planen) ---------
  const ALLOWED = ["userId", "firstName", "lastName", "group", "selectable", "confirm", "reasons", "hints"];
  const cand = (await mP.request("/api/shifts/" + shift.id + "/candidates")).candidates;
  const order = cand.map((m: any) => m.userId);
  const c = (m: any) => cand.find((x: any) => x.userId === m.user.id);
  const reasons = (m: any) => c(m)?.reasons.join(" ") ?? "";
  check(cand.every((m: any, i: number) => i === 0 || cand[i - 1].group <= m.group), "candidates ordered by group 1 to 5");
  check([p.Anna, p.Bert, p.Cora, tina, vera, q.Hanna].every((m) => c(m)?.group === 1 && c(m).selectable), "group 1: free employees of this location, including those created by others");
  check(order[0] === p.Anna.user.id && reasons(p.Anna).includes("Verfügbar eingetragen"), "explicitly available person first within the group");
  check(reasons(p.Bert).includes("Frei") && !c(p.Bert).confirm, "no availability entry counts as free");
  check(c(p.Cora).group === 1 && c(p.Cora).confirm && c(p.Cora).hints.join().includes("Erforderliche Qualifikation fehlt: Erste Hilfe") && order.indexOf(p.Cora.user.id) < order.indexOf(p.Bert.user.id), "missing qualification keeps group and name order, shows a hint");
  check([p.Dora, p.Emil, p.Fritz].every((m) => c(m)?.group === 2 && !c(m).selectable), "group 2: busy or absent employees of this location, not selectable");
  check(reasons(p.Dora).includes("Genehmigte Abwesenheit") && reasons(p.Emil).includes("Als nicht verfügbar eingetragen") && reasons(p.Fritz).includes("Überschneidung"), "group 2 shows the reason");
  check(c(udo)?.group === 3 && c(udo).selectable && reasons(udo).includes("Standort Anlage 2"), "group 3: free employees of another managed location of the same customer");
  check(c(q.Ida)?.group === 4 && !c(q.Ida).selectable && reasons(q.Ida).includes("Abwesenheit"), "group 4: absent employees of that location, with reason");
  check(c(q.Lea)?.group === 5 && c(q.Lea).selectable && reasons(q.Lea).includes("Persönlich zugeordnet") && c(q.Mo)?.group === 5 && !c(q.Mo).selectable && order.indexOf(q.Lea.user.id) < order.indexOf(q.Mo.user.id), "group 5: personally assigned staff, free before blocked");
  check(!c(q.Jan) && !c(q.Kai), "no candidates from another customer or from locations the manager does not plan");
  check(!c(p.Gerd), "inactive accounts are not offered");
  check(cand.every((m: any) => Object.keys(m).every((k) => ALLOWED.includes(k))) && !JSON.stringify(cand).includes("@"), "candidate list carries names and short reasons only");
  const adminCand = (await admin.request("/api/shifts/" + shift.id + "/candidates")).candidates;
  const ac = (m: any) => adminCand.find((x: any) => x.userId === m.user.id);
  check(ac(q.Hanna)?.group === 1 && ac(q.Kai)?.group === 3 && ac(udo)?.group === 3 && ac(q.Ida)?.group === 4 && ac(q.Jan)?.group === 5, "administration: this location, then all locations of the customer, then everyone else");

  // --- Zwei Manager am selben Standort -------------------------------------
  const qCand = (await mQ.request("/api/shifts/" + shift.id + "/candidates")).candidates;
  check(qCand.some((m: any) => m.userId === p.Bert.user.id && m.group === 1 && m.selectable) && !qCand.some((m: any) => m.group >= 3), "second manager sees the location's employees, nothing beyond own locations");
  await mQ.request("/api/bookings", "POST", { shiftId: shift.id, userId: p.Bert.user.id });
  await mQ.request("/api/employees/" + p.Bert.id, "GET", undefined, 404);
  check(!(await mQ.request("/api/employees")).members.some((m: any) => m.id === p.Bert.id), "second manager assigns an employee created by the first, without seeing the profile");
  await mQ.request("/api/bookings", "POST", { shiftId: shift.id, userId: udo.user.id, confirm: true }, 403);
  await mQ.request("/api/bookings", "POST", { shiftId: shift.id, userId: q.Lea.user.id }, 403);
  await mQ.request("/api/bookings", "POST", { shiftId: pforte.id, userId: udo.user.id, confirm: true }, 404);

  // --- Bestaetigung, harte Sperren und manipulierte Anfragen ---------------
  const ohne = await mP.request("/api/bookings", "POST", { shiftId: shift.id, userId: p.Cora.user.id }, 409);
  check(ohne.confirm === true && ohne.warnings.length === 1, "qualification hint requires exactly one confirmation");
  await mP.request("/api/bookings", "POST", { shiftId: shift.id, userId: p.Cora.user.id, confirm: "ja" }, 400);
  await mP.request("/api/bookings", "POST", { shiftId: shift.id, userId: p.Cora.user.id, confirm: true });
  await mP.request("/api/shifts/" + shift.id, "PATCH", { title: "Objektschutz Nord" });
  check((await mP.request(plan(s1))).schedule.shifts.find((s: any) => s.id === shift.id).title === "Objektschutz Nord", "a confirmed hint does not block later changes");
  await mP.request("/api/shifts/" + shift.id, "PATCH", { requiredQualifications: ["Erste Hilfe", "Brandschutz"] }, 409);
  for (const m of [p.Dora, p.Emil, p.Fritz, q.Ida, q.Mo]) {
    const hart = await mP.request("/api/bookings", "POST", { shiftId: shift.id, userId: m.user.id, confirm: true }, 409);
    check(!hart.confirm, "hard block for " + m.user.firstName + " stays despite confirmation");
  }
  await mP.request("/api/bookings", "POST", { shiftId: shift.id, userId: udo.user.id, confirm: true });
  check(ids((await access(udo.id)).grants) === [s2.id, s6.id].sort().join(), "a temporary assignment elsewhere does not change the location assignment");
  await mP.request("/api/bookings", "POST", { shiftId: shift.id, userId: q.Lea.user.id });
  const manipuliert = (await mP.request("/api/bookings", "POST", { shiftId: shift.id, userId: p.Anna.user.id, bookedBy: users.admin.id, confirmedAt: "2026-01-01T00:00:00Z", id: "eigene-id" })).booking;
  check(manipuliert.bookedBy === paula.userId && manipuliert.confirmedAt === null && manipuliert.id !== "eigene-id", "extra booking fields are ignored");
  await mP.request("/api/bookings", "POST", { shiftId: shift.id, userId: q.Jan.user.id, confirm: true }, 403);
  await mP.request("/api/bookings", "POST", { shiftId: shift.id, userId: q.Kai.user.id, confirm: true }, 403);
  await mP.request("/api/bookings", "POST", { shiftId: shift.id, userId: users.foreign.id, confirm: true }, 403);
  await mP.request("/api/bookings", "POST", { shiftId: shift.id, userId: p.Gerd.user.id, confirm: true }, 403);
  await admin.request("/api/bookings", "POST", { shiftId: shift.id, userId: p.Gerd.user.id, confirm: true }, 409);
  await mB.request("/api/bookings", "POST", { shiftId: shift.id, userId: p.Anna.user.id }, 404);
  const tinaS = await session("tina@akro-test.invalid");
  await tinaS.request("/api/bookings", "POST", { shiftId: shift.id, userId: tina.user.id, confirm: true }, 403);
  await tinaS.request("/api/bookings", "POST", { shiftId: shift.id, userId: vera.user.id }, 403);
  await mP.request("/api/bookings", "POST", { shiftId: shift.id, userId: q.Hanna.user.id });
  await mP.request("/api/bookings", "POST", { shiftId: shift.id, userId: vera.user.id, confirm: true }, 409);
  const booked = [p.Anna, p.Bert, p.Cora, udo, q.Lea, q.Hanna].map((m) => m.user.id);
  check((await mP.request("/api/shifts/" + shift.id + "/candidates")).candidates.every((m: any) => !booked.includes(m.userId)), "assigned people leave the selection");

  // --- Standortzuordnung zeigt offene Plaetze, nicht den ganzen Plan -------
  const offen = (await mP.request("/api/shifts", "POST", { scheduleId: plan1.id, dayOfWeek: dow, shiftFrom: "18:00", shiftTo: "22:00", maxEmployees: 1, title: "Abend" })).shifts[0];
  await admin.request("/api/schedules/" + plan1.id, "PATCH", { isPublic: true });
  const tinaPlan = await tinaS.request(plan(s1));
  check(!tinaPlan.access.view && tinaPlan.access.request && tinaPlan.schedule.shifts.some((s: any) => s.id === offen.id && s.bookings.length === 0) && !tinaPlan.schedule.shifts.some((s: any) => s.id === shift.id), "assigned employee sees open places only, not the full plan");
  await tinaS.request("/api/branches/" + s1.id + "/month", "GET", undefined, 403);
  await tinaS.request("/api/employees", "GET", undefined, 403);
  await tinaS.request("/api/employees/" + p.Anna.id, "GET", undefined, 404);
  await tinaS.request("/api/mod-requests", "POST", { shiftId: offen.id });
  check(!(await mP.request(plan(s1))).schedule.shifts.find((s: any) => s.id === offen.id).bookings.length, "a takeover request does not assign the employee");
  check(!(await tinaS.request("/api/branches")).branches.some((b: any) => b.id === s3.id || b.id === s6.id), "employee sees only assigned locations");

  console.log("STAFF SITES: " + t.counter() + " checks so far.");
}
