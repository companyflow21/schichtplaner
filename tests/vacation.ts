/*
 * Urlaubskonto (P5) ueber die echte API: Regeln nur fuer Admins, Anspruch und
 * Abzug genehmigten Urlaubs, beantragt, Korrekturen in halben Tagen, Kosten im
 * Antrag, abweichende Regeln je Person, Sichtbarkeit und Uebersicht.
 * Teil von tests/workflows.ts. Alles im Urlaubsjahr 2029, damit keine
 * Abwesenheiten anderer Tests hineinzaehlen.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { TestContext } from "./permissions";

export async function vacationTests(t: TestContext) {
  const { users, check, categoryId } = t;
  const session = async (email: string) => { const s = new t.Session(); await s.login(email); return s; };
  const admin = await session(users.admin.email), mA = await session(users.managerA.email), mB = await session(users.managerB.email);
  const sA = await session(users.staffA.email), foreign = await session(users.foreign.email);
  const account = (s: any, userId?: string, extra = "", status = 200) => s.request("/api/vacation?date=2029-12-31" + (userId ? "&userId=" + userId : "") + extra, "GET", undefined, status);

  // --- Rechte auf die Regeln ---------------------------------------------------------------
  await sA.request("/api/vacation/settings", "GET", undefined, 403);
  await mA.request("/api/vacation/settings", "PATCH", { enabled: true }, 403);
  check(!(await account(admin, users.staffA.id)).active, "switched off: no vacation account");
  const sick = (await admin.request("/api/absences/categories", "POST", { name: "Krankheit Urlaubstest", color: "#aa3333", isPaid: true }, 201)).category;
  await admin.request("/api/vacation/settings", "PATCH", { yearStart: "13-01" }, 400);
  await foreign.request("/api/vacation/settings", "PATCH", { categoryId }, 404);

  // --- Einschalten: 28 Tage, Konto ab 2029, Uebertrag hoechstens 5 ----------------------------
  const settings = (await admin.request("/api/vacation/settings", "PATCH", { enabled: true, categoryId, daysPerYear: 28, carryOverMax: 5, startDate: "2029-01-01", excludedWeekdays: [7, 6, 6] })).settings;
  check(settings.enabled && settings.excludedWeekdays.join() === "6,7" && settings.startDate.startsWith("2029-01-01"), "settings saved; free weekdays deduplicated");
  // 2029: Mo 05.-Fr 09.03. genehmigt (5), Mo 03.-Fr 07.09. beantragt (5), Krankheit zaehlt nicht.
  await admin.request("/api/absences", "POST", { userId: users.staffA.id, categoryId, dateFrom: "2029-03-05", dateTo: "2029-03-09", status: "APPROVED" }, 201);
  await sA.request("/api/absences", "POST", { userId: users.staffA.id, categoryId, dateFrom: "2029-09-03", dateTo: "2029-09-07" }, 201);
  await admin.request("/api/absences", "POST", { userId: users.staffA.id, categoryId: sick.id, dateFrom: "2029-04-02", dateTo: "2029-04-06", status: "APPROVED" }, 201);
  const view = await account(admin, users.staffA.id);
  check(view.active && view.canEdit && view.categoryName === "Urlaub" && view.years.length === 1, "account active from 2029, admin may correct it");
  const y = view.current;
  check(y.entitlement === 28 && y.taken + y.planned === 5 && y.pending === 5 && y.available === 23, "28 days, 5 approved are deducted, 5 requested are shown but not deducted, sick days do not count");

  // --- Korrektur in halben Tagen -------------------------------------------------------------
  const adjust = (s: any, days: number, status = 201) => s.request("/api/vacation/members/" + users.staffA.memberId + "/adjustments", "POST", { date: "2029-01-01", days, comment: "Resturlaub Einführung" }, status);
  await adjust(admin, 0.3, 400);
  await adjust(admin, 0, 400);
  await adjust(mA, 2, 403);
  await foreign.request("/api/vacation/members/" + users.staffA.memberId + "/adjustments", "POST", { date: "2029-01-01", days: 1, comment: "fremd" }, 404);
  const correction = (await adjust(admin, 2.5)).adjustment;
  const corrected = (await account(admin, users.staffA.id)).current;
  check(corrected.adjustments === 2.5 && corrected.available === 25.5 && corrected.entries.some((e: any) => e.kind === "ADJUSTMENT" && e.days === 2.5 && e.label === "Resturlaub Einführung") && corrected.entries.at(-1).balance === 25.5, "+2,5 days correction is on the statement");

  // --- Kosten fuer den Antrag: Mo-So, Wochenende frei -------------------------------------------
  const cost = await account(admin, users.staffA.id, "&from=2029-10-01&to=2029-10-07");
  check(cost.cost === 5, "a request from Monday to Sunday costs 5 days");

  // --- Sichtbarkeit ----------------------------------------------------------------------
  const own = await account(sA);
  check(own.active && !own.canEdit && own.current.available === 25.5, "the person sees the own account but cannot correct it");
  await admin.request("/api/employees/" + users.managerA.memberId + "/access", "PUT", { kind: "staff", memberId: users.staffA.memberId, rights: ["VIEW_HOURS", "MANAGE_ABSENCES"] });
  await admin.request("/api/employees/" + users.managerB.memberId + "/access", "PUT", { kind: "staff", memberId: users.staffA.memberId, rights: [] });
  check((await account(mA, users.staffA.id)).current.available === 25.5, "manager who decides the person's absences sees the account");
  await account(mB, users.staffA.id, "", 404);
  await account(foreign, users.staffA.id, "", 404);
  await admin.request("/api/vacation/settings", "PATCH", { visible: false });
  await account(sA, undefined, "", 404);
  await admin.request("/api/vacation/settings", "PATCH", { visible: true });

  // --- Abweichende Regel: 20 Tage ab 01.07.2029 -> 6/12 = 10 ------------------------------------
  await mA.request("/api/vacation/members/" + users.staffB.memberId, "PUT", { daysPerYear: 20 }, 403);
  await admin.request("/api/vacation/members/" + users.staffB.memberId, "PUT", { daysPerYear: 20, startDate: "2029-07-01" });
  const b = (await account(admin, users.staffB.id)).current;
  check(b.entitlement === 10 && b.entries[0].label.includes("6/12"), "joined in July: 6 of 12 months of 20 days");

  // --- Uebersicht ---------------------------------------------------------------------------
  const all = await admin.request("/api/vacation/overview?date=2029-12-31");
  const rowB = all.people.find((p: any) => p.userId === users.staffB.id);
  check(all.enabled && rowB?.deviates && rowB.daysPerYear === 20 && all.people.some((p: any) => p.userId === users.staffA.id && p.current.pending === 5), "overview for admins: everybody, own rules marked, requests shown");
  await admin.request("/api/employees/" + users.managerA.memberId + "/access", "PUT", { kind: "staff", memberId: users.staffB.memberId, rights: [] });
  const managed = await mA.request("/api/vacation/overview?date=2029-12-31");
  check(managed.people.some((p: any) => p.userId === users.staffA.id) && !managed.people.some((p: any) => p.userId === users.staffB.id), "overview for a manager: only people whose absences they decide");
  await sA.request("/api/vacation/overview", "GET", undefined, 404);
  await admin.request("/api/vacation/members/" + users.staffB.memberId, "PUT", { included: false });
  check(!(await account(admin, users.staffB.id)).active && !(await admin.request("/api/vacation/overview?date=2029-12-31")).people.some((p: any) => p.userId === users.staffB.id), "excluded person has no account");

  // --- Korrektur loeschen, ausschalten -------------------------------------------------------------
  await foreign.request("/api/vacation/adjustments/" + correction.id, "DELETE", undefined, 404);
  await mA.request("/api/vacation/adjustments/" + correction.id, "DELETE", undefined, 403);
  await admin.request("/api/vacation/adjustments/" + correction.id, "DELETE");
  check((await account(admin, users.staffA.id)).current.available === 23, "deleted correction no longer counts");
  await admin.request("/api/vacation/settings", "PATCH", { enabled: false });
  check(!(await account(sA)).active && !(await mA.request("/api/vacation/overview")).enabled, "switched off again: no account, no overview");
}
