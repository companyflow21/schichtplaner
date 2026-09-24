/*
 * Qualifikationskatalog, Sollstunden pro Monat und entfernter Spitzname -
 * geprueft ueber die echte API. Vierter Teil von tests/workflows.ts.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { berlinDate, isoWeek } from "../src/lib/berlin";
import type { TestContext } from "./permissions";

export async function catalogTargetTests(t: TestContext) {
  const { users, check } = t;
  const session = async (email: string) => { const s = new t.Session(); await s.login(email); return s; };
  const admin = await session(users.admin.email), mB = await session(users.managerB.email), sB = await session(users.staffB.email), foreign = await session(users.foreign.email);
  const staffB = users.staffB.memberId;

  // --- Katalog: nur Admins legen an, keine Doppelten -----------------------
  await admin.request("/api/qualifications", "POST", { name: "  erste hilfe " }, 409);
  await admin.request("/api/qualifications", "POST", { name: "BRANDSCHUTZ" }, 409);
  await mB.request("/api/qualifications", "POST", { name: "Managerwunsch" }, 403);
  await sB.request("/api/qualifications", "POST", { name: "Mitarbeiterwunsch" }, 403);
  await sB.request("/api/qualifications", "GET", undefined, 403);
  const parallel = await Promise.all(["Nachtwache", "nachtwache", " NACHTWACHE", "Nachtwache ", "nachtWache", "Nachtwache"].map(async (name) => {
    const res = await fetch(t.base + "/api/qualifications", { method: "POST", headers: { Cookie: admin.cookie(), "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
    return res.status;
  }));
  check(parallel.filter((s) => s === 201).length === 1 && parallel.filter((s) => s === 409).length === 5, "parallel creation with different case and spaces yields exactly one entry");
  const catalog = (await mB.request("/api/qualifications")).qualifications.map((q: any) => q.name);
  check(catalog.filter((n: string) => n.toLowerCase() === "nachtwache").length === 1 && catalog.includes("Erste Hilfe"), "managers read the catalog of their organisation");
  await foreign.request("/api/qualifications", "POST", { name: "Erste Hilfe" }, 201);
  check(!(await foreign.request("/api/qualifications")).qualifications.some((q: any) => q.name === "Nachtwache"), "catalog is separated by organisation");

  // --- Zuordnungen nur aus dem Katalog, in Katalog-Schreibweise ------------
  await admin.request("/api/employees/" + staffB, "PATCH", { qualifications: ["Erfunden"] }, 400);
  await admin.request("/api/employees/" + staffB, "PATCH", { qualifications: [" erste hilfe", "NACHTWACHE", "Erste Hilfe"] });
  check((await admin.request("/api/employees/" + staffB)).qualifications.join("|") === "Erste Hilfe|Nachtwache", "member qualifications are stored in catalog spelling, without duplicates");
  const branch = (await mB.request("/api/branches?right=EDIT_SHIFTS")).branches[0];
  const week = isoWeek(berlinDate());
  const plan = (await mB.request("/api/schedules?kw=" + week.weekNumber + "&year=" + week.year + "&standort=" + branch.id)).schedule;
  await mB.request("/api/shifts", "POST", { scheduleId: plan.id, dayOfWeek: 3, shiftFrom: "22:00", shiftTo: "06:00", maxEmployees: 1, requiredQualifications: ["Unbekannt"] }, 400);
  const nacht = (await mB.request("/api/shifts", "POST", { scheduleId: plan.id, dayOfWeek: 3, shiftFrom: "22:00", shiftTo: "06:00", maxEmployees: 1, requiredQualifications: ["brandschutz"] })).shifts[0];
  check(nacht.requiredQualifications.join() === "Brandschutz" && nacht.endsNextDay === true, "manager picks catalog entries for a night shift");
  await foreign.request("/api/shifts/" + nacht.id, "PATCH", { requiredQualifications: ["Erste Hilfe"] }, 404);

  // --- Sollstunden pro Monat -----------------------------------------------
  const month = berlinDate().slice(0, 7), period = "month=" + Number(month.slice(5)) + "&year=" + month.slice(0, 4);
  const profile = await admin.request("/api/employees/" + staffB);
  check(profile.targetHoursPerMonth === null && profile.targetHoursPerWeek === 40, "monthly target starts unset, weekly value is kept");
  const soll = async () => {
    const row = (await admin.request("/api/reporting?" + period)).employees.find((e: any) => e.userId === users.staffB.id);
    const csv: string = await admin.request("/api/reporting/export?" + period);
    return { status: row.targetStatus, minutes: row.targetMinutes, cell: csv.split("\r\n").find((l) => l.includes("Zweier"))!.split(";")[2] };
  };
  const unset = await soll();
  check(unset.status === "unset" && unset.minutes === null && unset.cell === '""', "unset monthly target: no value in report, empty cell in export");
  await admin.request("/api/employees/" + staffB, "PATCH", { targetHoursPerMonth: 0 });
  const zero = await soll();
  check(zero.status === "set" && zero.minutes === 0 && zero.cell === '"0,00"', "an explicit 0 is kept apart from unset");
  await admin.request("/api/employees/" + staffB, "PATCH", { targetHoursPerMonth: 160 });
  const set = await soll();
  check(set.minutes === 160 * 60 && set.cell === '"160,00"' && (await admin.request("/api/employees/" + staffB)).targetHoursPerWeek === 40, "monthly target in report and export; weekly value untouched");
  await admin.request("/api/employees/" + staffB, "PATCH", { targetHoursPerMonth: null });
  check((await soll()).status === "unset", "monthly target can be reset to unset");
  await mB.request("/api/employees/" + staffB, "PATCH", { targetHoursPerMonth: 100 }, 404);
  await sB.request("/api/employees/" + staffB, "PATCH", { targetHoursPerMonth: 100 }, 403);
  const own = await sB.request("/api/employees/" + staffB);
  check(own.canSeeContract === true && own.targetHoursPerMonth === null, "own contract data stays visible to the person");
  check((await mB.request("/api/reporting?" + period)).employees.every((e: any) => e.userId === users.managerB.id || e.targetStatus === "hidden"), "target hours of others stay hidden from managers");

  // --- Spitzname entfernt, gespeicherte Werte bleiben unberuehrt ------------
  const settings = await admin.request("/api/settings");
  check(settings.organization.nameFormat === "FIRSTNAME_LASTNAME", "former name format 'nickname' falls back to first and last name");
  await admin.request("/api/settings", "PATCH", { nameFormat: "NICKNAME" }, 400);
  const updated = await admin.request("/api/employees/" + staffB, "PATCH", { phone: "0228 1", nickname: "" });
  check(!("nickname" in updated), "nickname is neither written nor returned");
  const shown = JSON.stringify([await admin.request("/api/employees?status=all"), await admin.request("/api/employees/" + staffB), await mB.request("/api/shifts/" + nacht.id + "/candidates")]);
  check(!shown.includes("Elli") && !shown.includes("nickname"), "stored nickname appears in no list, profile or selection");

  console.log("CATALOG/TARGETS: " + t.counter() + " checks so far.");
}
