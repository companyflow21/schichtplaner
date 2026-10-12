/*
 * Korrekturen aus dem Smartplan-Abgleich (P0, docs/SMARTPLAN-ABGLEICH.md):
 * Abwesenheiten der Leitung sofort genehmigt, Abwesenheiten deaktivierter
 * Personen bleiben sichtbar, Reaktivieren, Nachricht als ungelesen markieren.
 * Teil von tests/workflows.ts.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { TestContext } from "./permissions";

export async function abgleichFixTests(t: TestContext) {
  const { users, check, categoryId } = t;
  const session = async (email: string) => { const s = new t.Session(); await s.login(email); return s; };
  const admin = await session(users.admin.email), sA = await session(users.staffA.email);

  // --- Abwesenheit: eingetragen von der Leitung = genehmigt; eigener Antrag bleibt offen ---
  const leaver = (await admin.request("/api/employees", "POST", { employees: [{ firstName: "Ida", lastName: "Austritt", email: "ida.austritt@akro-test.invalid", role: "EMPLOYEE" }] }, 201)).members[0];
  const byAdmin = (await admin.request("/api/absences", "POST", { userId: leaver.userId, categoryId, dateFrom: "2027-03-01", dateTo: "2027-03-02", status: "APPROVED" }, 201)).absence;
  check(byAdmin.status === "APPROVED", "absence entered by the administration is approved at once");
  const own = (await sA.request("/api/absences", "POST", { userId: users.staffA.id, categoryId, dateFrom: "2027-03-03", dateTo: "2027-03-03", status: "APPROVED" }, 201)).absence;
  check(own.status === "PENDING", "an employee cannot approve the own absence by sending the status");
  await admin.request("/api/absences/" + own.id, "DELETE");

  // --- Deaktivieren: Abwesenheit bleibt sichtbar, ist aber nicht mehr entscheidbar ---
  const pending = (await admin.request("/api/absences", "POST", { userId: leaver.userId, categoryId, dateFrom: "2027-04-01", dateTo: "2027-04-01" }, 201)).absence;
  await admin.request("/api/employees/" + leaver.id, "DELETE");
  const listed = (await admin.request("/api/absences?year=2027")).absences as any[];
  const keptApproved = listed.find((x) => x.id === byAdmin.id), keptPending = listed.find((x) => x.id === pending.id);
  check(keptApproved && keptPending, "absences of a deactivated person stay visible to the administration");
  check(keptPending.canDecide === false && keptApproved.canDecide === false, "absences of a deactivated person are read-only");
  await admin.request("/api/absences/" + pending.id, "PATCH", { status: "APPROVED" }, 404);
  const options = (await admin.request("/api/absences?year=2027")).people as any[];
  check(!options.some((p) => p.userId === leaver.userId), "a deactivated person cannot be chosen for new absences");
  await admin.request("/api/absences", "POST", { userId: leaver.userId, categoryId, dateFrom: "2027-05-01", dateTo: "2027-05-01" }, 404);

  // --- Reaktivieren ueber dieselbe Schnittstelle wie der Menuepunkt ---
  await sA.request("/api/employees/" + leaver.id, "PATCH", { isActive: true }, 404);
  await admin.request("/api/employees/" + leaver.id, "PATCH", { isActive: true });
  const again = (await admin.request("/api/absences?year=2027")).absences as any[];
  check(again.find((x) => x.id === pending.id)?.canDecide === true, "after reactivation the open request can be decided again");
  await admin.request("/api/absences/" + pending.id, "PATCH", { status: "APPROVED" });

  // --- Nachricht als ungelesen markieren ---
  const message = (await admin.request("/api/messages", "POST", { subject: "Ungelesen-Test", body: "Bitte lesen", recipientIds: [users.staffA.id] }, 201)).message;
  await sA.request("/api/messages/" + message.id);
  const unreadAfterOpen = (await sA.request("/api/messages?folder=inbox")).messages.find((m: any) => m.id === message.id);
  check(unreadAfterOpen?.recipients?.[0]?.isRead === true, "opening a message marks it read");
  await sA.request("/api/messages/" + message.id, "PATCH", { isRead: false });
  const marked = (await sA.request("/api/messages?folder=inbox")).messages.find((m: any) => m.id === message.id);
  check(marked?.recipients?.[0]?.isRead === false, "a read message can be marked unread again");
}
