/*
 * Nachrichten: Standort-/Schichtbezug, Zustaendigkeits-Gruppierung und
 * Sichtbarkeit - geprueft ueber die echte API. Eigener, unabhaengiger
 * Kunde/Standort, um nicht vom Zustand fruehererer Testteile abzuhaengen.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { addDate, berlinDate, isoWeek } from "../src/lib/berlin";
import type { TestContext } from "./permissions";

export async function messagingTests(t: TestContext) {
  const { users, check } = t;
  const session = async (email: string) => { const s = new t.Session(); await s.login(email); return s; };
  const admin = await session(users.admin.email), mA = await session(users.managerA.email), mB = await session(users.managerB.email);
  const sA = await session(users.staffA.email), loner = await session(users.loner.email), foreign = await session(users.foreign.email);

  // --- Aufbau: eigener Kunde mit zwei Standorten, Zustaendigkeit fuer A ---
  const customer = (await admin.request("/api/customers", "POST", { name: "Kunde Nachrichten" })).customer;
  const branchA = (await admin.request("/api/branches", "POST", { customerId: customer.id, name: "Nachrichten Standort A" })).branch;
  const branchB = (await admin.request("/api/branches", "POST", { customerId: customer.id, name: "Nachrichten Standort B" })).branch;
  const grant = (memberId: string, branchId: string, rights: string[]) => admin.request("/api/employees/" + memberId + "/access", "PUT", { kind: "branch", branchId, rights });
  const staff = (managerMemberId: string, employeeMemberId: string, rights: string[]) => admin.request("/api/employees/" + managerMemberId + "/access", "PUT", { kind: "staff", memberId: employeeMemberId, rights });
  await grant(users.managerA.memberId, branchA.id, ["EDIT_SHIFTS", "PUBLISH_SCHEDULE", "HANDLE_REQUESTS"]);
  await staff(users.managerA.memberId, users.staffA.memberId, ["ASSIGN_SHIFTS", "VIEW_PROFILE"]);

  const day = addDate(berlinDate(), 26), week = isoWeek(day), dow = ((new Date(day).getUTCDay() + 6) % 7) + 1;
  const plan = (await mA.request("/api/schedules?kw=" + week.weekNumber + "&year=" + week.year + "&standort=" + branchA.id)).schedule;
  const shift = (await mA.request("/api/shifts", "POST", { scheduleId: plan.id, dayOfWeek: dow, shiftFrom: "08:00", shiftTo: "16:00", maxEmployees: 2, title: "Objektschutz" })).shifts[0];
  await admin.request("/api/bookings", "POST", { shiftId: shift.id, userId: users.staffA.id });
  await admin.request("/api/schedules/" + plan.id, "PATCH", { isPublic: true });

  // --- Zustaendigkeit: Mitarbeitende sehen ihren Manager, sonst niemand Fremdes ---
  const aRecipients = await sA.request("/api/messages/recipients");
  const zust = aRecipients.recipients.filter((r: any) => r.group === "zustaendig").map((r: any) => r.id);
  check(zust.includes(users.managerA.id) && aRecipients.noResponsible === false, "employee sees the assigned manager as a responsible contact");
  check(aRecipients.recipients.find((r: any) => r.id === users.admin.id)?.group === "administration", "administration is grouped separately from responsible managers");
  // Ein Manager ohne jeden Bezug zu staffA (keine Zuordnung, keine gemeinsamen Standorte).
  const stranger = (await admin.request("/api/employees", "POST", { employees: [{ firstName: "Fremd", lastName: "Manager", email: "fremd.manager@akro-test.invalid", role: "MANAGER" }] }, 201)).members[0];
  check(!aRecipients.recipients.some((r: any) => r.id === stranger.userId || r.id === stranger.user?.id), "unrelated manager stays invisible to the employee");

  const mARecipients = await mA.request("/api/messages/recipients");
  check(mARecipients.recipients.find((r: any) => r.id === users.staffA.id)?.group === "weitere" && mARecipients.recipients.find((r: any) => r.id === users.admin.id)?.group === "administration" && mARecipients.noResponsible === false, "manager callers only distinguish administration from everyone else");

  const lonerRecipients = await loner.request("/api/messages/recipients");
  check(lonerRecipients.noResponsible === true && !lonerRecipients.recipients.some((r: any) => r.group === "zustaendig"), "employee without a responsible manager gets no 'zustaendig' group");
  const lonerMsg = (await loner.request("/api/messages", "POST", { subject: "Frage", body: "Wer ist zustaendig?", recipientIds: [users.admin.id] }, 201)).message;
  check(lonerMsg.subject === "Frage", "employee without a manager writes to the administration instead");

  // --- Schreiben, Antworten, Ungelesen-Zaehler ----------------------------
  const before = (await mA.request("/api/messages")).unreadCount;
  const sent = (await sA.request("/api/messages", "POST", { subject: "Dienstfrage", body: "Wann beginnt die Schicht?", recipientIds: [users.managerA.id] }, 201)).message;
  check((await mA.request("/api/messages")).unreadCount === before + 1, "manager's unread count rises with the new message");
  const managerView = await mA.request("/api/messages/" + sent.id);
  check(managerView.message.body === "Wann beginnt die Schicht?", "manager reads the message from the assigned employee");
  check((await mA.request("/api/messages")).unreadCount === before, "reading the message lowers the unread count");
  const aUnreadBefore = (await sA.request("/api/messages")).unreadCount;
  await mA.request("/api/messages/" + sent.id + "/reply", "POST", { body: "08:00 Uhr" }, 201);
  check((await sA.request("/api/messages")).unreadCount === aUnreadBefore + 1, "employee's unread count rises with the manager's reply");
  const detail = await sA.request("/api/messages/" + sent.id);
  check(detail.message.replies.some((r: any) => r.body === "08:00 Uhr") && detail.message.replies[0].sender.id === users.managerA.id, "employee sees the manager's reply");
  check((await sA.request("/api/messages")).unreadCount === aUnreadBefore, "reading the reply lowers the unread count again");

  // --- Unerreichbare Empfaenger und fremde Nachrichten ---------------------
  await sA.request("/api/messages", "POST", { subject: "Fremd", body: "x", recipientIds: [stranger.userId] }, 403);
  const foreignMsg = (await mB.request("/api/messages", "POST", { subject: "Intern B", body: "y", recipientIds: [users.staffB.id] }, 201)).message;
  await sA.request("/api/messages/" + foreignMsg.id, "GET", undefined, 404);

  // --- Standortbezug: speichern, anzeigen, ablehnen ------------------------
  const withBranch = (await mA.request("/api/messages", "POST", { subject: "Info Standort", body: "Neue Anweisung.", recipientIds: [users.staffA.id], branchId: branchA.id }, 201)).message;
  check(withBranch.branchId === branchA.id, "message stores the referenced site");
  const branchDetail = await sA.request("/api/messages/" + withBranch.id);
  check(branchDetail.message.reference === "Bezug: Standort " + branchA.name, "site reference is shown to sender and recipient");
  await mA.request("/api/messages", "POST", { subject: "Fremdstandort", body: "z", recipientIds: [users.staffA.id], branchId: branchB.id }, 404);
  const foreignOrgCustomer = (await foreign.request("/api/customers", "POST", { name: "Fremd Nachrichten" })).customer;
  const foreignOrgBranch = (await foreign.request("/api/branches", "POST", { customerId: foreignOrgCustomer.id, name: "Fremd Standort" })).branch;
  await admin.request("/api/messages", "POST", { subject: "Fremde Organisation", body: "z", recipientIds: [users.staffA.id], branchId: foreignOrgBranch.id }, 404);

  // --- Schichtbezug: Standort wird abgeleitet, Widerspruch schlaegt fehl ---
  const withShift = (await mA.request("/api/messages", "POST", { subject: "Zur Schicht", body: "Bitte puenktlich.", recipientIds: [users.staffA.id], shiftId: shift.id }, 201)).message;
  check(withShift.branchId === branchA.id && withShift.shiftId === shift.id, "shift reference derives the site automatically");
  await mA.request("/api/messages", "POST", { subject: "Widerspruch", body: "z", recipientIds: [users.staffA.id], shiftId: shift.id, branchId: branchB.id }, 400);
  const shiftDetail = await sA.request("/api/messages/" + withShift.id);
  check(!!shiftDetail.message.reference?.startsWith("Bezug: Schicht ") && shiftDetail.message.reference.includes("08:00") && shiftDetail.message.reference.includes(branchA.name), "shift reference is shown with weekday, time and site");

  // --- Antwort erbt den Bezug -----------------------------------------------
  const reply = (await sA.request("/api/messages/" + withShift.id + "/reply", "POST", { body: "Alles klar." }, 201)).message;
  check(reply.shiftId === shift.id && reply.branchId === branchA.id, "a reply inherits the shift and site reference of the parent");

  // --- Referenzen fuer die Auswahl ------------------------------------------
  const aRefs = await mA.request("/api/messages/references");
  check(aRefs.branches.some((b: any) => b.id === branchA.id) && !aRefs.branches.some((b: any) => b.id === branchB.id), "planner may reference own planning sites only");
  check(aRefs.shifts.some((s: any) => s.id === shift.id), "planner may reference an upcoming shift of an own site");
  const employeeRefs = await sA.request("/api/messages/references");
  check(employeeRefs.shifts.some((s: any) => s.id === shift.id) && employeeRefs.branches.some((b: any) => b.id === branchA.id) && !employeeRefs.branches.some((b: any) => b.id === branchB.id), "employee may reference the own upcoming booking and its site, nothing unrelated");

  // --- Fremde Organisation sieht nichts --------------------------------------
  const foreignRecipients = await foreign.request("/api/messages/recipients");
  check(!foreignRecipients.recipients.some((r: any) => r.id === users.staffA.id || r.id === users.managerA.id), "foreign organisation admin cannot see our staff as recipients");
  await foreign.request("/api/messages/" + withShift.id, "GET", undefined, 404);

  console.log("MESSAGING: " + t.counter() + " checks so far.");
}
