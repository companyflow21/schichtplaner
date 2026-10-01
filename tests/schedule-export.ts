/*
 * Dienstplan-Export (GET /api/schedules/export): Sichtbarkeit wie in der
 * Planansicht, Filter, Zeitraumgrenzen - ueber die echte API. Laeuft als
 * Folgereihe von tests/workflows.ts (gleicher Server, gleiche Datenbank).
 * Die Daten liegen in einer Woche weit in der Zukunft und an eigenen
 * Standorten ("Export ..."), damit andere Reihen nicht stoeren.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { addDate, berlinDate, isoWeek, weekDate } from "../src/lib/berlin";
import type { TestContext } from "./permissions";
import { newPerson } from "./people";

export async function scheduleExportTests(t: TestContext) {
  const { users, check } = t;
  const session = async (name: string) => { const s = new t.Session(); await s.login(users[name].email); return s; };
  const admin = await session("admin"), mA = await session("managerA"), mB = await session("managerB");
  // Eigener Manager nur mit "Dienstplan ansehen": der geteilte "viewer" ist nach tests/permissions.ts deaktiviert.
  const viewerPerson = await newPerson(t, admin, "export-viewer", "Vera", "Exportblick", "MANAGER"), viewer = viewerPerson.session;
  const sA = await session("staffA"), sB = await session("staffB"), loner = await session("loner"), employee = await session("employee"), foreign = await session("foreign");

  // --- Daten: zwei Kunden, drei Standorte, sechs Schichten ----------------
  const customer = async (s: any, name: string) => (await s.request("/api/customers", "POST", { name })).customer;
  const k1 = await customer(admin, "Export Kunde Eins"), k2 = await customer(admin, "Export Kunde Zwei");
  const branch = async (s: any, customerId: string, name: string) => (await s.request("/api/branches", "POST", { customerId, name })).branch;
  const b1 = await branch(admin, k1.id, "Export Standort A"), b2 = await branch(admin, k1.id, "Export Standort B"), b3 = await branch(admin, k2.id, "Export Standort C");
  const foreignCustomer = await customer(foreign, "Export Fremdkunde"), foreignBranch = await branch(foreign, foreignCustomer.id, "Export Fremdstandort");

  const grant = (member: string, branchId: string, rights: string[]) => admin.request("/api/employees/" + member + "/access", "PUT", { kind: "branch", branchId, rights });
  await grant(users.managerA.memberId, b1.id, ["EDIT_SHIFTS", "PUBLISH_SCHEDULE"]);
  await grant(users.managerB.memberId, b3.id, ["EDIT_SHIFTS"]);
  await grant(viewerPerson.memberId, b1.id, ["VIEW_SCHEDULE"]);
  await grant(users.staffA.memberId, b1.id, ["REQUEST_SHIFTS"]);

  const mon = weekDate(isoWeek(addDate(berlinDate(), 150)).year, isoWeek(addDate(berlinDate(), 150)).weekNumber, 1);
  const nextMon = addDate(mon, 7);
  const weekOf = (date: string) => { const w = isoWeek(date); return "kw=" + w.weekNumber + "&year=" + w.year; };
  const plan = async (s: any, b: any, date: string) => (await s.request("/api/schedules?" + weekOf(date) + "&standort=" + b.id)).schedule;
  const addShift = async (s: any, schedule: any, dayOfWeek: number, shiftFrom: string, shiftTo: string, maxEmployees: number, title: string) =>
    (await s.request("/api/shifts", "POST", { scheduleId: schedule.id, dayOfWeek, shiftFrom, shiftTo, maxEmployees, title })).shifts[0];
  const book = (shift: any, person: string) => admin.request("/api/bookings", "POST", { shiftId: shift.id, userId: users[person].id });
  const publish = (schedule: any) => admin.request("/api/schedules/" + schedule.id, "PATCH", { isPublic: true });

  const planA1 = await plan(admin, b1, mon), planA2 = await plan(admin, b1, nextMon), planB = await plan(admin, b2, mon), planC = await plan(admin, b3, mon);
  const s1 = await addShift(admin, planA1, 1, "08:00", "16:00", 3, "Tagdienst");
  const s2 = await addShift(admin, planA1, 1, "22:00", "06:00", 1, "Nachtdienst");
  await addShift(admin, planA1, 2, "09:00", "17:00", 3, "Frühdienst");
  const s4 = await addShift(admin, planA2, 1, "10:00", "18:00", 2, "Spätdienst");
  const s5 = await addShift(admin, planB, 1, "17:00", "21:00", 1, "Pforte");
  const s6 = await addShift(admin, planC, 3, "08:00", "12:00", 1, "Streife");
  const foreignPlan = await plan(foreign, foreignBranch, mon);
  await addShift(foreign, foreignPlan, 1, "08:00", "16:00", 1, "Fremdschicht");
  await book(s1, "staffA"); await book(s1, "staffB"); await book(s2, "employee"); await book(s4, "staffA"); await book(s5, "staffA"); await book(s6, "staffB");
  // Veroeffentlicht: A (Woche 1) und B; Entwuerfe: A (Woche 2) und C.
  await publish(planA1); await publish(planB); await foreign.request("/api/schedules/" + foreignPlan.id, "PATCH", { isPublic: true });

  const path = (query: Record<string, string>) => "/api/schedules/export?" + new URLSearchParams(query);
  const week = { from: mon, to: addDate(mon, 13) };
  const get = (s: any, query: Record<string, string> = {}, expected = 200) => s.request(path({ ...week, ...query }), "GET", undefined, expected);
  const tag = (r: any) => r.title + "@" + r.branch.replace("Export Standort ", "");
  const mine = (data: any) => data.rows.filter((r: any) => r.branch.startsWith("Export "));
  const tags = (data: any) => mine(data).map(tag);
  const same = (data: any, expected: string[], message: string) => check(JSON.stringify([...tags(data)].sort()) === JSON.stringify([...expected].sort()), message + " - " + tags(data).join(", "));

  // --- Administration: alles im Zeitraum, sortiert, vollstaendig ------------
  const all = await get(admin);
  same(all, ["Tagdienst@A", "Nachtdienst@A", "Frühdienst@A", "Spätdienst@A", "Pforte@B", "Streife@C"], "admin export has every shift of the organization incl. drafts, none of the foreign organization");
  check(!JSON.stringify(all).includes("Fremd"), "admin export contains nothing from the other organization");
  check(all.period.from === week.from && all.period.to === week.to && !!all.generatedAt && Object.keys(all.filters).length === 0, "export reports period, generation time and no filters");
  const order = mine(all).map((r: any) => r.date + " " + r.shiftFrom + " " + r.branch);
  check(JSON.stringify(order) === JSON.stringify([...order].sort()), "rows are sorted by date, start time and location");
  const row = (data: any, name: string) => data.rows.find((r: any) => tag(r) === name);
  check(row(all, "Nachtdienst@A").endsNextDay === true && row(all, "Nachtdienst@A").shiftTo === "06:00" && row(all, "Tagdienst@A").endsNextDay === false, "overnight shift is marked as ending the next day");
  check(row(all, "Tagdienst@A").weekday === "Montag" && row(all, "Tagdienst@A").date === mon && row(all, "Frühdienst@A").weekday === "Dienstag", "weekday and date of a shift");
  check(row(all, "Tagdienst@A").open === 1 && row(all, "Tagdienst@A").places === 3 && row(all, "Tagdienst@A").occupied === 2, "open places of a multi-place shift (3 places, 2 assigned)");
  check(row(all, "Frühdienst@A").open === 3 && row(all, "Frühdienst@A").assigned.length === 0 && row(all, "Nachtdienst@A").open === 0, "unassigned and full shifts report open places correctly");
  check(JSON.stringify(row(all, "Tagdienst@A").assigned) === JSON.stringify(["Emil Einser", "Elke Zweier"]) && row(all, "Tagdienst@A").isPublic === true && row(all, "Spätdienst@A").isPublic === false, "admin sees all names and the draft flag");
  check(row(all, "Pforte@B").customer === "Export Kunde Eins" && row(all, "Streife@C").customer === "Export Kunde Zwei" && row(all, "Streife@C").branch === "Export Standort C", "rows carry location and customer");
  const names = all.people.map((p: any) => p.name);
  check(["Emil Einser", "Elke Zweier", "Mara Test"].every(n => names.includes(n)) && all.people.every((p: any) => p.userId && !("email" in p)), "people lists the visible persons without contact data");
  check(all.branches.some((b: any) => b.id === b1.id && b.customerId === k1.id) && all.customers.some((c: any) => c.id === k2.id), "export lists customers and locations of the result");
  check(!/@akro-test|phone|passwordHash|activation/i.test(JSON.stringify(all)), "export contains no contact or authentication data");

  // --- Filter: Kunde, Standort, Person, Zeitraum -----------------------------
  const byCustomer = await get(admin, { customerId: k1.id });
  same(byCustomer, ["Tagdienst@A", "Nachtdienst@A", "Frühdienst@A", "Spätdienst@A", "Pforte@B"], "customer filter keeps only that customer's locations");
  check(byCustomer.filters.customer === "Export Kunde Eins" && !byCustomer.filters.branch, "customer filter is named in the result");
  same(await get(admin, { customerId: k2.id }), ["Streife@C"], "second customer filter");
  const byBranch = await get(admin, { branchId: b2.id });
  same(byBranch, ["Pforte@B"], "location filter");
  check(byBranch.filters.branch === "Export Standort B", "location filter is named in the result");
  const byPerson = await get(admin, { userId: users.staffA.id });
  same(byPerson, ["Tagdienst@A", "Spätdienst@A", "Pforte@B"], "person filter keeps only shifts of that person");
  check(byPerson.filters.person === "Emil Einser" && byPerson.people.some((p: any) => p.name === "Elke Zweier"), "person filter is named; people list stays complete for the selection");
  same(await get(admin, { customerId: k1.id, branchId: b1.id, userId: users.staffB.id }), ["Tagdienst@A"], "filters combine");
  const mismatch = await get(admin, { customerId: k1.id, branchId: b3.id });
  check(mine(mismatch).length === 0, "location of another customer yields an empty result");
  const twoDays = await get(admin, { to: addDate(mon, 1) });
  check(JSON.stringify(mine(twoDays).map(tag)) === JSON.stringify(["Tagdienst@A", "Pforte@B", "Nachtdienst@A", "Frühdienst@A"]), "range is inclusive, ordered by day, start time, location - " + mine(twoDays).map(tag).join(", "));
  check(mine(await get(admin, { from: addDate(mon, 2), to: addDate(mon, 6) })).map(tag).join() === "Streife@C", "shifts outside the range are not exported");
  check(mine(await get(admin, { from: nextMon, to: nextMon })).map(tag).join() === "Spätdienst@A", "range of a single day in the second week");
  const empty = await get(admin, { from: addDate(mon, 20), to: addDate(mon, 30) });
  check(mine(empty).length === 0 && Array.isArray(empty.rows), "empty range yields empty rows");

  // --- Grenzen und Eingaben ---------------------------------------------------
  const long = await get(admin, { to: addDate(mon, 61) });
  check(long.rows.length >= 6, "exactly 62 days are allowed");
  const tooLong = await get(admin, { to: addDate(mon, 62) }, 400);
  check(/62 Tage/.test(tooLong.error), "more than 62 days is rejected with a German message");
  check(/Ende .* vor dem Beginn/.test((await get(admin, { from: addDate(mon, 5), to: mon }, 400)).error), "to before from is rejected");
  await get(admin, { from: "2026-02-30" }, 400);
  await get(admin, { to: "morgen" }, 400);
  await admin.request("/api/schedules/export?from=" + mon, "GET", undefined, 400);
  await admin.request("/api/schedules/export", "GET", undefined, 400);
  await new t.Session().request(path(week), "GET", undefined, 307);
  await get(admin, { customerId: foreignCustomer.id }, 404);
  await get(admin, { branchId: foreignBranch.id }, 404);
  await get(admin, { userId: users.foreign.id }, 404);
  await get(admin, { branchId: "gibt-es-nicht" }, 404);

  // --- Manager: nur freigegebene Standorte, Entwuerfe nur mit "Plan ansehen" -
  same(await get(mA), ["Tagdienst@A", "Nachtdienst@A", "Frühdienst@A", "Spätdienst@A"], "manager A sees location A including the draft week, nothing else");
  same(await get(viewer), ["Tagdienst@A", "Nachtdienst@A", "Frühdienst@A", "Spätdienst@A"], "manager with only 'view schedule' sees the same plan incl. drafts");
  same(await get(mB), ["Streife@C"], "manager B sees only the draft of his location");
  check(row(await get(mA), "Tagdienst@A").assigned.length === 2 && (await get(mA, { customerId: k1.id })).filters.customer === "Export Kunde Eins", "manager with plan right sees the names");
  same(await get(mA, { customerId: k1.id }), ["Tagdienst@A", "Nachtdienst@A", "Frühdienst@A", "Spätdienst@A"], "customer filter does not reveal locations without a grant");
  same(await get(mA, { branchId: b1.id }), ["Tagdienst@A", "Nachtdienst@A", "Frühdienst@A", "Spätdienst@A"], "granted location filter");
  same(await get(mA, { userId: users.staffA.id }), ["Tagdienst@A", "Spätdienst@A"], "person filter only covers shifts the manager can see");
  await get(mA, { branchId: b2.id }, 404);
  await get(mA, { branchId: b3.id }, 404);
  await get(mA, { customerId: k2.id }, 404);
  await get(mA, { userId: users.foreign.id }, 404);
  await get(mB, { customerId: k1.id }, 404);
  same(await get(mB, { branchId: b3.id }), ["Streife@C"], "manager B location filter");

  // --- Mitarbeitende: eigene veroeffentlichte und offene Schichten, keine fremden Namen
  const own = await get(sA);
  same(own, ["Tagdienst@A", "Frühdienst@A", "Pforte@B"], "employee sees own published shifts and open published shifts of the granted location, no drafts, no full shifts");
  check(JSON.stringify(row(own, "Tagdienst@A").assigned) === JSON.stringify(["Emil Einser"]) && row(own, "Tagdienst@A").occupied === 2 && row(own, "Tagdienst@A").open === 1, "employee sees only the own name, but the true number of open places");
  check(row(own, "Frühdienst@A").assigned.length === 0 && row(own, "Frühdienst@A").open === 3, "open shift of the location shows its open places");
  check(!/Elke|Zweier|Mara/.test(JSON.stringify(own)), "employee export contains no other person's name");
  check(own.people.length === 1 && own.people[0].userId === users.staffA.id, "employee people list contains only the person");
  same(await get(sB), ["Tagdienst@A"], "employee without grants sees only the own published shift, not the own shift in a draft");
  check(JSON.stringify(row(await get(sB), "Tagdienst@A").assigned) === JSON.stringify(["Elke Zweier"]) && !/Einser|Emil/.test(JSON.stringify(await get(sB))), "other employees' names stay hidden");
  same(await get(employee), ["Nachtdienst@A"], "employee sees the own overnight shift");
  check(mine(await get(loner)).length === 0, "employee without assignments and grants gets nothing");
  same(await get(sA, { userId: users.staffA.id }), ["Tagdienst@A", "Pforte@B"], "employee may filter by the own person");
  await get(sA, { userId: users.staffB.id }, 404);
  await get(sA, { userId: users.foreign.id }, 404);
  same(await get(sA, { branchId: b2.id }), ["Pforte@B"], "employee may filter a location where only an own shift is visible");
  await get(sA, { branchId: b3.id }, 404);
  await get(sA, { customerId: k2.id }, 404);
  await get(loner, { branchId: b1.id }, 404);
  await get(loner, { userId: users.staffA.id }, 404);

  // --- Fremde Organisation -----------------------------------------------------
  const foreignData = await get(foreign);
  check(mine(foreignData).length === 1 && mine(foreignData)[0].title === "Fremdschicht" && !JSON.stringify(foreignData).includes("Export Standort"), "foreign organization only sees its own shift");
  await get(foreign, { branchId: b1.id }, 404);
  await get(foreign, { customerId: k1.id }, 404);
  await get(foreign, { userId: users.staffA.id }, 404);

  // --- Gleiche Regeln wie die Planansicht (GET /api/schedules) ------------------
  const key = (date: string, from: string, to: string, title: string, branchName: string, open: number, who: string[]) => [date, from, to, title, branchName, open, [...who].sort().join("+")].join("|");
  // Planansicht der Woche: zusammengefuehrt (GET /api/schedules) - fuer Admins je Standort, weil die zusammengefuehrte Sicht fuer sie nichts liefert (OR: [{}]).
  const planView = async (s: any, date: string, perBranch: boolean) => (perBranch
    ? (await Promise.all([b1, b2, b3].map(async b => (await s.request("/api/schedules?" + weekOf(date) + "&standort=" + b.id)).schedule.shifts as any[]))).flat()
    : (await s.request("/api/schedules?" + weekOf(date))).schedule.shifts as any[])
    .filter(x => x.branch?.name.startsWith("Export ")).map(x => key(x.date, x.shiftFrom, x.shiftTo, x.title ?? "", x.branch.name, x.missing, x.bookings.map((b: any) => b.user.firstName + " " + b.user.lastName))).sort();
  const exported = async (s: any, from: string, to: string) => mine(await s.request(path({ from, to }))).map((r: any) => key(r.date, r.shiftFrom, r.shiftTo, r.title, r.branch, r.open, r.assigned)).sort();
  async function parity(label: string) {
    for (const [who, s] of Object.entries({ admin, mA, mB, viewer, sA, sB, loner, employee })) {
      for (const date of [mon, nextMon]) {
        const a = JSON.stringify(await planView(s, date, who === "admin")), b = JSON.stringify(await exported(s, date, addDate(date, 6)));
        check(a === b, label + ": " + who + " export equals the plan view of the week of " + date + (a === b ? "" : "\nplan:   " + a + "\nexport: " + b));
      }
    }
  }
  await parity("same rules");

  // Genehmigte Abwesenheit: fuer die Planung zaehlt die Zuweisung nicht als wirksam (gleiche Regel wie in der Planansicht).
  const absence = (await sB.request("/api/absences", "POST", { userId: users.staffB.id, categoryId: t.categoryId, dateFrom: mon, dateTo: mon }, 201)).absence;
  await admin.request("/api/absences/" + absence.id, "PATCH", { status: "APPROVED" });
  const planned = await get(admin);
  check(row(planned, "Tagdienst@A").open === 2 && row(planned, "Tagdienst@A").assigned.length === 2, "planners count an absent person as not effectively assigned");
  check(row(await get(mA), "Tagdienst@A").open === 2 && row(await get(sA), "Tagdienst@A").open === 1, "employees without plan right still see the plain number of open places");
  await parity("same rules with absence");

  console.log("SCHEDULE EXPORT: " + t.counter() + " checks so far.");
}
