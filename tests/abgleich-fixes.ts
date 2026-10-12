/*
 * Korrekturen aus dem Smartplan-Abgleich (P0), aus dem Cloud-Branch
 * claude/wizardly-cerf-cxbutc auf die Hauptlinie portiert: Abwesenheiten der
 * Leitung sofort genehmigt, Abwesenheiten deaktivierter Personen bleiben
 * sichtbar (nur lesend), negative Zahlen im CSV bleiben Zahlen, Nachricht als
 * ungelesen markieren. "Reaktivieren" im Mitarbeitermenue war in der
 * Hauptlinie schon behoben; hier nur noch die Schnittstelle als Gegenprobe.
 * Teil von tests/workflows.ts (TEST_ONLY=abgleich-fixes).
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { berlinDate, isoWeek } from "../src/lib/berlin";
import { csvCell, csvFile } from "../src/lib/csv";
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

  // --- Deaktivieren (PATCH; DELETE ist in der Hauptlinie das endgueltige Loeschen): Abwesenheit bleibt sichtbar, ist aber nicht mehr entscheidbar ---
  const pending = (await admin.request("/api/absences", "POST", { userId: leaver.userId, categoryId, dateFrom: "2027-04-01", dateTo: "2027-04-01" }, 201)).absence;
  await admin.request("/api/employees/" + leaver.id, "PATCH", { isActive: false });
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

  // --- CSV: negative deutsche Zahlen bleiben Zahlen, Formelzeichen werden entschaerft ---
  check(csvCell("-1,50") === '"-1,50"' && csvCell("-12") === '"-12"' && csvCell("8,50") === '"8,50"', "csv: negative and plain German numbers stay numbers");
  check(csvCell("=1+1") === `"'=1+1"` && csvCell("-1+2") === `"'-1+2"` && csvCell("+491701234567") === `"'+491701234567"` && csvCell("@SUM(A1)") === `"'@SUM(A1)"`, "csv: formula-like text still gets the apostrophe");
  check(csvCell("–") === '"–"' && csvCell(null) === '""' && csvCell(7) === '"7"' && csvCell('a"b') === '"a""b"', "csv: dash, empty, count and quote escaping");
  const file = csvFile([["Name", "Abweichung"], ["Muster", "-1,50"]], "test.csv");
  // Response.text() verwirft die BOM, deshalb die Rohbytes lesen.
  const bytes = Buffer.from(await file.arrayBuffer());
  check(bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])) && bytes.subarray(3).toString("utf8") === ['"Name";"Abweichung"', '"Muster";"-1,50"'].join("\r\n") && file.headers.get("Content-Disposition") === 'attachment; filename="test.csv"', "csv: Excel file with BOM, semicolons and file name");

  // Durch die echte Auswertung: veroeffentlichte Schicht ohne erfasste Zeit ergibt eine negative Abweichung.
  const today = berlinDate();
  const month = today.slice(0, 7), period = "month=" + Number(month.slice(5)) + "&year=" + month.slice(0, 4);
  const customer = (await admin.request("/api/customers", "POST", { name: "Abgleich Kunde" })).customer;
  const site = (await admin.request("/api/branches", "POST", { customerId: customer.id, name: "Abgleich Objekt" })).branch;
  await admin.request("/api/employees/" + leaver.id + "/access", "PUT", { kind: "branch", branchId: site.id, rights: ["REQUEST_SHIFTS"] });
  const w = isoWeek(today);
  const plan = (await admin.request("/api/schedules?kw=" + w.weekNumber + "&year=" + w.year + "&standort=" + site.id)).schedule;
  const dayOfWeek = ((new Date(today + "T12:00:00Z").getUTCDay() + 6) % 7) + 1;
  const shift = (await admin.request("/api/shifts", "POST", { scheduleId: plan.id, dayOfWeek, shiftFrom: "08:00", shiftTo: "16:00", maxEmployees: 1, title: "CSV-Abweichung" })).shifts[0];
  await admin.request("/api/bookings", "POST", { shiftId: shift.id, userId: leaver.userId, confirm: true });
  await admin.request("/api/schedules/" + plan.id, "PATCH", { isPublic: true });
  const row = (await admin.request("/api/reporting?" + period)).employees.find((e: any) => e.userId === leaver.userId);
  check(row && row.deviationMinutes < 0, "report: planned shift without recorded time gives a negative deviation");
  const expected = '"' + (row.deviationMinutes / 60).toFixed(2).replace(".", ",") + '"';
  const line = ((await admin.request("/api/reporting/export?" + period)) as string).split("\r\n").find((l) => l.includes("Austritt"))!;
  check(line.split(";")[5] === expected && expected.startsWith('"-'), "export: negative deviation is a plain number cell (" + expected + "), not text with an apostrophe");

  // --- Nachricht als ungelesen markieren (Schnittstelle der Schaltflaeche "Ungelesen" im Postfach) ---
  const message = (await admin.request("/api/messages", "POST", { subject: "Ungelesen-Test", body: "Bitte lesen", recipientIds: [users.staffA.id] }, 201)).message;
  await sA.request("/api/messages/" + message.id);
  const unreadAfterOpen = (await sA.request("/api/messages?folder=inbox")).messages.find((m: any) => m.id === message.id);
  check(unreadAfterOpen?.recipients?.[0]?.isRead === true, "opening a message marks it read");
  await sA.request("/api/messages/" + message.id, "PATCH", { isRead: false });
  const marked = (await sA.request("/api/messages?folder=inbox")).messages.find((m: any) => m.id === message.id);
  check(marked?.recipients?.[0]?.isRead === false, "a read message can be marked unread again");
}
