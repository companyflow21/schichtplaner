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
  const hanna = (await create(admin, [{ firstName: "Hanna", lastName: "Ohnezuordnung", email: "hanna@akro-test.invalid", role: "EMPLOYEE", branchIds: [s1.id] }])).members[0];
  await activate(hanna.activationUrl);
  await admin.request("/api/employees/" + hanna.id, "PATCH", { qualifications: ["Erste Hilfe"] });

  const day = addDate(berlinDate(), 45), week = isoWeek(day), dow = ((new Date(day).getUTCDay() + 6) % 7) + 1;
  const plan = (b: { id: string }) => "/api/schedules?kw=" + week.weekNumber + "&year=" + week.year + "&standort=" + b.id;
  const plan1 = (await mP.request(plan(s1))).schedule, plan2 = (await mP.request(plan(s2))).schedule;
  const shift = (await mP.request("/api/shifts", "POST", { scheduleId: plan1.id, dayOfWeek: dow, shiftFrom: "08:00", shiftTo: "16:00", maxEmployees: 3, title: "Objektschutz", requiredQualifications: ["Erste Hilfe"] })).shifts[0];
  const pforte = (await mP.request("/api/shifts", "POST", { scheduleId: plan2.id, dayOfWeek: dow, shiftFrom: "10:00", shiftTo: "14:00", maxEmployees: 1, title: "Pforte" })).shifts[0];

  // Verfuegbarkeit, Abwesenheit, Ueberschneidung, Deaktivierung
  await (await session("anna.besetzen@akro-test.invalid")).request("/api/availability", "POST", { date: day, timeFrom: "06:00", timeTo: "18:00", available: true });
  await (await session("emil.besetzen@akro-test.invalid")).request("/api/availability", "POST", { date: day, timeFrom: "07:00", timeTo: "17:00", available: false });
  await admin.request("/api/absences", "POST", { userId: p.Dora.user.id, categoryId: t.categoryId, dateFrom: day, dateTo: day, status: "APPROVED" }, 201);
  // Taetigkeit passt nicht zum Einsatzort (Anlage 2 verlangt "Pforte"): uebersteuerbar mit einer Bestaetigung.
  const pforteOhne = await mP.request("/api/bookings", "POST", { shiftId: pforte.id, userId: p.Fritz.user.id }, 409);
  check(pforteOhne.confirm === true && pforteOhne.warnings.some((w: string) => w.includes("Tätigkeit")), "activity mismatch asks for confirmation instead of blocking");
  await mP.request("/api/bookings", "POST", { shiftId: pforte.id, userId: p.Fritz.user.id, confirm: true });
  await admin.request("/api/employees/" + p.Gerd.id, "DELETE");

  const cand = await mP.request("/api/shifts/" + shift.id + "/candidates");
  const order = cand.members.map((m: any) => m.userId);
  const at = (name: string) => order.indexOf(p[name].user.id);
  const person = (userId: string) => cand.members.find((m: any) => m.userId === userId);
  const gesperrt = (userId: string) => cand.blocked.find((m: any) => m.userId === userId);
  const GROUPS = ["available", "open", "warning", "other"];
  check(cand.members.every((m: any, i: number) => i === 0 || GROUPS.indexOf(cand.members[i - 1].group) <= GROUPS.indexOf(m.group)), "candidates sorted by group");
  check(person(p.Anna.user.id).group === "available" && person(p.Anna.user.id).reasons.join().includes("Verfügbarkeit eingetragen"), "explicit availability comes first, with its reason");
  check(person(p.Bert.user.id).group === "open" && person(vera.user.id).group === "open" && person(p.Bert.user.id).reasons.join().includes("Keine Verfügbarkeit"), "matching people without availability entry come second");
  check(person(p.Cora.user.id).group === "warning" && person(p.Cora.user.id).confirm === true && person(p.Cora.user.id).reasons.join().includes("Erforderliche Qualifikation fehlt: Erste Hilfe"), "missing qualification comes third, overridable, reason shown");
  check(person(udo.user.id).group === "other" && person(udo.user.id).reasons.join().includes("nicht zugeordnet"), "plannable people from other locations come last");
  check(at("Anna") < at("Bert") && at("Bert") < at("Cora") && at("Cora") < order.indexOf(udo.user.id), "order: availability, no entry, warning, other location");
  check(gesperrt(p.Dora.user.id)?.reasons.join().includes("nicht verfügbar") && gesperrt(p.Emil.user.id)?.reasons.join().includes("Als nicht verfügbar eingetragen") && gesperrt(p.Fritz.user.id)?.reasons.join().includes("Überschneidung"), "absence, explicit unavailability and overlap listed as blocked, with reason");
  check(!person(p.Dora.user.id) && !person(p.Emil.user.id) && !person(p.Fritz.user.id), "blocked people are not selectable");
  check(!order.includes(p.Gerd.user.id) && !cand.blocked.some((m: any) => m.userId === p.Gerd.user.id), "inactive accounts are not offered");
  check(!order.includes(hanna.user.id) && !cand.blocked.some((m: any) => m.userId === hanna.user.id), "site assignment alone does not let a manager plan a person");
  check(JSON.stringify(cand).indexOf("@") === -1 && !JSON.stringify(cand).includes("qualifications"), "candidate list carries names and reasons only");
  const adminCand = await admin.request("/api/shifts/" + shift.id + "/candidates");
  check(adminCand.members.find((m: any) => m.userId === hanna.user.id)?.group === "open", "administration plans everyone assigned to the location");

  // --- Bestaetigung und harte Sperren in der API ---------------------------
  const ohne = await mP.request("/api/bookings", "POST", { shiftId: shift.id, userId: p.Cora.user.id }, 409);
  check(ohne.confirm === true && ohne.warnings.length === 1, "qualification warning requires exactly one confirmation");
  await mP.request("/api/bookings", "POST", { shiftId: shift.id, userId: p.Cora.user.id, confirm: true });
  await mP.request("/api/shifts/" + shift.id, "PATCH", { title: "Objektschutz Nord" });
  check((await mP.request(plan(s1))).schedule.shifts.find((s: any) => s.id === shift.id).title === "Objektschutz Nord", "a confirmed warning does not block later changes");
  await mP.request("/api/shifts/" + shift.id, "PATCH", { requiredQualifications: ["Erste Hilfe", "Brandschutz"] }, 409);
  for (const name of ["Dora", "Emil", "Fritz"]) {
    const hart = await mP.request("/api/bookings", "POST", { shiftId: shift.id, userId: p[name].user.id, confirm: true }, 409);
    check(!hart.confirm, "hard block for " + name + " stays despite confirmation");
  }
  await mP.request("/api/bookings", "POST", { shiftId: shift.id, userId: p.Gerd.user.id, confirm: true }, 403);
  await admin.request("/api/bookings", "POST", { shiftId: shift.id, userId: p.Gerd.user.id, confirm: true }, 409);
  await mP.request("/api/bookings", "POST", { shiftId: shift.id, userId: hanna.user.id, confirm: true }, 403);
  await mB.request("/api/bookings", "POST", { shiftId: shift.id, userId: p.Anna.user.id }, 404);
  const tinaS = await session("tina@akro-test.invalid");
  await tinaS.request("/api/bookings", "POST", { shiftId: shift.id, userId: tina.user.id, confirm: true }, 403);
  await mP.request("/api/bookings", "POST", { shiftId: shift.id, userId: p.Anna.user.id });
  await mP.request("/api/bookings", "POST", { shiftId: shift.id, userId: p.Bert.user.id });
  await mP.request("/api/bookings", "POST", { shiftId: shift.id, userId: vera.user.id, confirm: true }, 409);
  check((await mP.request("/api/shifts/" + shift.id + "/candidates")).members.every((m: any) => ![p.Anna, p.Bert, p.Cora].some((x) => x.user.id === m.userId)), "assigned people leave the selection");

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
