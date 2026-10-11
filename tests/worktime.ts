/*
 * Arbeitszeithinweise (nur Hinweise, keine Sperren) nach den Grundregeln des
 * ArbZG und der betrieblichen Vorgabe; Sichtbarkeit auf Datenbankebene.
 *   npx tsx tests/worktime.ts
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from "node:assert/strict";
import net from "node:net";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

let checks = 0;
function check(value: unknown, message: string) { assert.ok(value, message); checks++; console.log("PASS: " + message); }

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => { const { port } = server.address() as net.AddressInfo; server.close(() => resolve(port)); });
  });
}

async function main() {
  const sql = new PGlite();
  for (const migration of (await readdir("prisma/migrations")).filter((x) => /^\d/.test(x)).sort()) await sql.exec(await readFile("prisma/migrations/" + migration + "/migration.sql", "utf8"));
  const port = await freePort();
  const socket = new PGLiteSocketServer({ db: sql, host: "127.0.0.1", port });
  await socket.start();
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: "postgresql://postgres:postgres@127.0.0.1:" + port + "/postgres", max: 1 }) });
  (globalThis as any).prisma = db;
  try {
    const { plannedWork, workTimeHints, loadPlannedWork } = await import("../src/lib/worktime");
    const shift = (week: number, day: number, from: string, to: string, pause = 0, year = 2026) => ({ dayOfWeek: day, shiftFrom: from, shiftTo: to, pauseOption: "PER_SHIFT", pauseValue: pause, schedule: { year, weekNumber: week } });
    const rules = (work: any[], from: string, to: string, max: number | null = null) => workTimeHints(work, from, to, max).map(h => h.date + " " + h.rule);
    const kw42 = ["2026-10-12", "2026-10-18"] as const;

    // Gemeldetes Beispiel: 7 x 15:00-23:30 mit 30 Min. Pause (56 h netto).
    const laith = [1, 2, 3, 4, 5, 6, 7].map(d => plannedWork("l", shift(42, d, "15:00", "23:30", 30), "NW"));
    const laithRules = rules(laith, ...kw42);
    check(laithRules.includes("2026-10-18 SONNTAG"), "Sonntagsarbeit wird mit Ersatzruhetag-Hinweis genannt");
    check(laithRules.includes("2026-10-18 TAGE_AM_STUECK"), "7 Tage am Stück werden genannt");
    check(laithRules.includes("2026-10-12 WOCHE_48"), "56 h in der Woche: Hinweis auf 48 h und Ausgleich");
    check(!laithRules.some(r => /TAG_8|TAG_10|PAUSE|RUHEZEIT/.test(r)), "8 h je Tag, 30 Min. Pause und 15,5 h Ruhezeit lösen nichts aus");
    check(laithRules.length === 3, "genau drei Hinweise, keine Doppelungen");

    // Tageshoechstzeit und Pausen.
    check(rules([plannedWork("x", shift(42, 1, "06:00", "18:00", 30), null)], ...kw42).join() === "2026-10-12 TAG_10,2026-10-12 PAUSE", "11,5 h mit 30 Min.: über 10 h und Pause unter 45 Min.");
    check(rules([plannedWork("x", shift(42, 1, "08:00", "17:30", 30), null)], ...kw42).join() === "2026-10-12 TAG_8", "9 h mit 30 Min.: nur Hinweis auf Ausgleich über 8 h");
    check(rules([plannedWork("x", shift(42, 1, "07:00", "14:00", 0), null)], ...kw42).join() === "2026-10-12 PAUSE", "7 h ohne Pause: mindestens 30 Min. vorgeschrieben");
    check(rules([plannedWork("x", shift(42, 1, "07:00", "13:00", 0), null)], ...kw42).length === 0, "genau 6 h ohne Pause: kein Hinweis");

    // Ruhezeit ueber Mitternacht und ueber die Wochengrenze.
    check(rules([plannedWork("x", shift(42, 1, "14:00", "22:00", 30), null), plannedWork("x", shift(42, 2, "06:00", "14:00", 30), null)], ...kw42).join() === "2026-10-13 RUHEZEIT", "8 h Ruhezeit zwischen Spät- und Frühdienst");
    check(rules([plannedWork("x", shift(41, 7, "22:00", "06:00", 30), null), plannedWork("x", shift(42, 1, "14:00", "22:00", 30), null)], ...kw42).join() === "2026-10-12 RUHEZEIT", "Nachtschicht vom Sonntag davor: Ruhezeit in der neuen Woche, Sonntag der Vorwoche nicht erneut");

    // Feiertag am Einsatzort: 31.10.2026 (Samstag) nur in Thueringen.
    const kw44 = ["2026-10-26", "2026-11-01"] as const;
    check(rules([plannedWork("x", shift(44, 6, "08:00", "16:00", 30), "TH")], ...kw44).join() === "2026-10-31 FEIERTAG", "Jena: Arbeit am Reformationstag mit Ersatzruhetag-Hinweis");
    check(rules([plannedWork("x", shift(44, 6, "08:00", "16:00", 30), "NW")], ...kw44).length === 0, "Köln: 31.10. ist kein Feiertag");
    check(workTimeHints([plannedWork("x", shift(44, 6, "08:00", "16:00", 30), "TH")], ...kw44, null)[0].text.includes("Reformationstag"), "Hinweis nennt den Feiertag");

    // Nacht der Zeitumstellung: 9 echte Stunden ohne Pause.
    const kw43 = ["2026-10-19", "2026-10-25"] as const;
    check(rules([plannedWork("x", shift(43, 6, "22:00", "06:00", 0), null)], ...kw43).join() === "2026-10-24 TAG_8,2026-10-24 PAUSE", "Rückstellung: 9 h Nachtdienst zählt echt, Pause fehlt");

    // Betriebliche Vorgabe nur, wenn eingeschaltet.
    const long = [plannedWork("x", shift(42, 3, "08:00", "17:00", 30), null)];
    check(rules(long, ...kw42, 8).includes("2026-10-14 BETRIEB_TAG") && !rules(long, ...kw42, null).includes("2026-10-14 BETRIEB_TAG"), "Vorgabe 8 h pro Tag wirkt nur eingeschaltet");

    // Sichtbarkeit: Schichten an nicht einsehbaren Standorten zaehlen nicht mit.
    const org = await db.organization.create({ data: { name: "Hinweise" } });
    const user = await db.user.create({ data: { email: "w@x.invalid", firstName: "W", lastName: "X", passwordHash: "x" } });
    const customer = await db.customer.create({ data: { organizationId: org.id, name: "K" } });
    const seen = await db.branch.create({ data: { organizationId: org.id, customerId: customer.id, name: "Sichtbar", holidayState: "TH" } });
    const hidden = await db.branch.create({ data: { organizationId: org.id, customerId: customer.id, name: "Verborgen" } });
    for (const [branch, day, from, to] of [[seen, 1, "14:00", "22:00"], [hidden, 2, "06:00", "14:00"]] as const) {
      const plan = await db.schedule.create({ data: { organizationId: org.id, branchId: branch.id, weekNumber: 42, year: 2026 } });
      const s = await db.shift.create({ data: { scheduleId: plan.id, dayOfWeek: day, shiftFrom: from, shiftTo: to, pauseValue: 30, maxEmployees: 1 } });
      await db.booking.create({ data: { shiftId: s.id, userId: user.id } });
    }
    const all = await loadPlannedWork(db as any, org.id, [user.id], 2026, 42, null);
    const own = await loadPlannedWork(db as any, org.id, [user.id], 2026, 42, [seen.id]);
    check(rules(all.work, all.from, all.to).join() === "2026-10-13 RUHEZEIT", "Admin: Ruhezeit über beide Standorte erkannt (Entwürfe zählen mit)");
    check(own.work.length === 1 && rules(own.work, own.from, own.to).length === 0, "Manager ohne Planansicht am zweiten Standort: dessen Schicht bleibt verborgen");
    console.log("SUCCESS: " + checks + " Arbeitszeit-Prüfungen bestanden.");
  } finally {
    await db.$disconnect();
    await socket.stop();
    await sql.close();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
