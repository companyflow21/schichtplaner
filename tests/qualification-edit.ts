/*
 * Katalogeintraege umbenennen und loeschen - geprueft ueber die echte API,
 * inklusive Nachziehen der Zuordnungen. Teil von tests/workflows.ts.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { TestContext } from "./permissions";

export async function qualificationEditTests(t: TestContext) {
  const { users, check } = t;
  const session = async (email: string) => { const s = new t.Session(); await s.login(email); return s; };
  const admin = await session(users.admin.email), mA = await session(users.managerA.email), sA = await session(users.staffA.email), foreign = await session(users.foreign.email);
  const staffA = "/api/employees/" + users.staffA.memberId;
  const create = async (name: string) => (await admin.request("/api/qualifications", "POST", { name }, 201)).qualification;
  const catalog = async () => (await admin.request("/api/qualifications")).qualifications as { id: string; name: string }[];

  const alt = await create("Umbenennen Alt"), other = await create("Umbenennen Fremd"), loose = await create("Löschbar");
  const original: string[] = (await admin.request(staffA)).qualifications;
  await admin.request(staffA, "PATCH", { qualifications: [...original, "Umbenennen Alt"] });

  // --- Umbenennen -----------------------------------------------------------
  await mA.request("/api/qualifications/" + alt.id, "PATCH", { name: "Manager Neu" }, 403);
  await sA.request("/api/qualifications/" + alt.id, "PATCH", { name: "Mitarbeiter Neu" }, 403);
  await foreign.request("/api/qualifications/" + alt.id, "PATCH", { name: "Fremd Neu" }, 404);
  await admin.request("/api/qualifications/" + alt.id, "PATCH", { name: "   " }, 400);
  await admin.request("/api/qualifications/" + alt.id, "PATCH", { name: "  umbenennen FREMD " }, 409);
  await admin.request("/api/qualifications/nicht-vorhanden", "PATCH", { name: "Irgendwas" }, 404);
  check((await admin.request(staffA)).qualifications.includes("Umbenennen Alt"), "rejected renames leave assignments untouched");

  await admin.request("/api/qualifications/" + alt.id, "PATCH", { name: "Umbenennen Neu" });
  check((await catalog()).some((q) => q.id === alt.id && q.name === "Umbenennen Neu") && !(await catalog()).some((q) => q.name === "Umbenennen Alt"), "catalog shows the new name");
  const renamed: string[] = (await admin.request(staffA)).qualifications;
  check(renamed.includes("Umbenennen Neu") && !renamed.includes("Umbenennen Alt") && renamed.length === original.length + 1, "member shows the new spelling, same count");
  await admin.request(staffA, "PATCH", { qualifications: [...original, "umbenennen neu"] });
  check((await admin.request(staffA)).qualifications.includes("Umbenennen Neu"), "new name is accepted case-insensitively for assignments");

  await admin.request("/api/qualifications/" + alt.id, "PATCH", { name: "UMBENENNEN NEU" });
  check((await catalog()).some((q) => q.id === alt.id && q.name === "UMBENENNEN NEU"), "case-only rename of the same entry is allowed");
  check((await admin.request(staffA)).qualifications.includes("UMBENENNEN NEU"), "case-only rename reaches the member as well");
  check(!(await foreign.request("/api/qualifications")).qualifications.some((q: any) => /umbenennen/i.test(q.name)), "foreign catalog is unaffected");

  // --- Loeschen -------------------------------------------------------------
  await mA.request("/api/qualifications/" + loose.id, "DELETE", undefined, 403);
  await foreign.request("/api/qualifications/" + loose.id, "DELETE", undefined, 404);
  const blocked = await admin.request("/api/qualifications/" + alt.id, "DELETE", undefined, 409);
  check(/1 Mitarbeitenden/.test(blocked.error) && /Bitte dort zuerst entfernen/.test(blocked.error), "delete of a used entry is refused with counts");
  check((await catalog()).some((q) => q.id === alt.id), "refused delete keeps the entry");

  await admin.request(staffA, "PATCH", { qualifications: original });
  await admin.request("/api/qualifications/" + alt.id, "DELETE");
  check(!(await catalog()).some((q) => q.id === alt.id), "entry is deletable once nobody uses it");
  await admin.request("/api/qualifications/" + loose.id, "DELETE");
  await admin.request("/api/qualifications/" + loose.id, "DELETE", undefined, 404);
  check(!(await catalog()).some((q) => q.id === loose.id), "unused entry is deleted");
  await admin.request("/api/qualifications/" + other.id, "DELETE");

  console.log("QUALIFICATION EDIT: " + t.counter() + " checks so far.");
}
