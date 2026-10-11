/*
 * Planstunden auf Datenbankebene (PGlite, alle Migrationen): eine zentrale
 * Nettozeit je Schicht (Pause genau einmal, echte Minuten bei Zeitumstellung)
 * fuer Dienstplan, Auswertung und CSV. Plan = veroeffentlichte Schichten;
 * Entwurfsstunden nur fuer die Planung, nie in der Mitarbeitersicht.
 *
 *   npx tsx tests/planned-hours.ts
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
    const { plannedMinutes } = await import("../src/lib/planning");
    const { monthlyReport } = await import("../src/lib/report");
    const { accessFor } = await import("../src/lib/access");
    const at = (year: number, weekNumber: number, dayOfWeek: number, shiftFrom: string, shiftTo: string, pauseOption = "PER_SHIFT", pauseValue = 0) =>
      plannedMinutes({ dayOfWeek, shiftFrom, shiftTo, pauseOption, pauseValue, schedule: { year, weekNumber } });

    // Reine Berechnung.
    check(at(2026, 42, 1, "15:00", "23:30", "PER_SHIFT", 30) === 480, "8,5 h mit 30 Min. Pause ergeben 8 h netto");
    check(at(2026, 42, 1, "22:00", "06:00") === 480, "Nachtschicht ohne Zeitumstellung: 8 h");
    check(at(2026, 43, 6, "22:00", "06:00") === 540, "Nacht 24./25.10.2026 (Rueckstellung): 9 echte Stunden");
    check(at(2027, 12, 6, "22:00", "06:00") === 420, "Nacht 27./28.03.2027 (Vorstellung): 7 echte Stunden");
    check(at(2026, 42, 2, "08:00", "16:00", "PER_HOUR", 10) === 400, "Pause pro Stunde: 8 volle Stunden x 10 Min.");
    check(at(2026, 42, 2, "08:00", "08:20", "PER_SHIFT", 30) === 0, "Pause laenger als Schicht ergibt 0, nicht negativ");

    // Daten: Laith-Beispiel (KW 42 veroeffentlicht), Entwuerfe an zwei Standorten, Monatsgrenze.
    const org = await db.organization.create({ data: { name: "Planstunden" } });
    const person = async (email: string, role: string, firstName: string) => {
      const user = await db.user.create({ data: { email, firstName, lastName: "Test", passwordHash: "x" } });
      const member = await db.organizationMember.create({ data: { organizationId: org.id, userId: user.id, role: role as any, isActivated: true } });
      return { user, member };
    };
    const admin = await person("admin@x.invalid", "ADMIN", "Ada");
    const manager = await person("manager@x.invalid", "MANAGER", "Mia");
    const employee = await person("ma@x.invalid", "EMPLOYEE", "Laith");
    const customer = await db.customer.create({ data: { organizationId: org.id, name: "Kunde" } });
    const koeln = await db.branch.create({ data: { organizationId: org.id, customerId: customer.id, name: "Köln" } });
    const bonn = await db.branch.create({ data: { organizationId: org.id, customerId: customer.id, name: "Bonn" } });
    await db.branchAccess.create({ data: { organizationId: org.id, memberId: manager.member.id, branchId: koeln.id, rights: ["VIEW_SCHEDULE", "VIEW_TIME"] as any } });
    await db.branchAccess.create({ data: { organizationId: org.id, memberId: manager.member.id, branchId: bonn.id, rights: ["VIEW_TIME"] as any } });
    await db.staffAssignment.create({ data: { organizationId: org.id, managerMemberId: manager.member.id, employeeMemberId: employee.member.id, rights: ["VIEW_HOURS"] as any } });
    const plan = (branchId: string, weekNumber: number, isPublic: boolean) => db.schedule.create({ data: { organizationId: org.id, branchId, weekNumber, year: 2026, isPublic } });
    const assign = async (scheduleId: string, dayOfWeek: number, shiftFrom: string, shiftTo: string, pauseValue: number) => {
      const shift = await db.shift.create({ data: { scheduleId, dayOfWeek, shiftFrom, shiftTo, pauseOption: "PER_SHIFT", pauseValue, maxEmployees: 1 } });
      await db.booking.create({ data: { shiftId: shift.id, userId: employee.user.id, bookedBy: admin.user.id } });
      return shift;
    };
    const kw42 = await plan(koeln.id, 42, true);
    for (let day = 1; day <= 7; day++) await assign(kw42.id, day, "15:00", "23:30", 30);
    const kw43Koeln = await plan(koeln.id, 43, false);
    await assign(kw43Koeln.id, 1, "08:00", "16:00", 30);
    const kw43Bonn = await plan(bonn.id, 43, false);
    await assign(kw43Bonn.id, 2, "08:00", "12:00", 0);
    const kw44 = await plan(koeln.id, 44, true);
    await assign(kw44.id, 6, "22:00", "06:00", 30); // Sa 31.10. bis So 01.11.

    const report = async (member: typeof admin.member, month: number, selfOnly = false) => {
      const a = await accessFor({ ...member } as any);
      const r = await monthlyReport(a, month, 2026, { selfOnly });
      return r.employees.find((e: any) => e.userId === employee.user.id)!;
    };
    const octAdmin = await report(admin.member, 10);
    // 7 x 480 (KW 42) + 450 (31.10., Monat nach Schichtbeginn) = 3810
    check(octAdmin.plannedMinutes === 3810, "Oktober: veroeffentlichter Plan 7 x 8 h + Nachtschicht 31.10. (7,5 h) = 63,5 h");
    check(octAdmin.draftMinutes === 450 + 240, "Admin sieht Entwurfsstunden beider Standorte getrennt (11,5 h)");
    check(octAdmin.shiftCount === 8, "Schichtanzahl zaehlt nur veroeffentlichte Schichten");
    const novAdmin = await report(admin.member, 11);
    check(novAdmin.plannedMinutes === 0 && novAdmin.shiftCount === 0, "November: Nachtschicht vom 31.10. zaehlt nicht doppelt");

    const octManager = await report(manager.member, 10);
    check(octManager.plannedMinutes === 3810, "Manager mit Personal- und Zeitrechten sieht denselben Plan");
    check(octManager.draftMinutes === 450, "Manager sieht Entwuerfe nur am Standort mit \"Dienstplan ansehen\" (Köln, nicht Bonn)");

    const octSelf = await report(employee.member, 10, true);
    check(octSelf.plannedMinutes === 3810, "Mitarbeiter sieht den eigenen veroeffentlichten Plan");
    check(octSelf.draftMinutes === null, "Mitarbeiter erfaehrt keine Entwurfsstunden");

    // Ruecknahme der Veroeffentlichung: KW 42 wird wieder Entwurf.
    await db.schedule.update({ where: { id: kw42.id }, data: { isPublic: false } });
    const withdrawn = await report(admin.member, 10);
    check(withdrawn.plannedMinutes === 450 && withdrawn.draftMinutes === 3360 + 450 + 240, "Zurueckgezogener Plan wandert vom Plan in die Entwurfsstunden");
    const withdrawnSelf = await report(employee.member, 10, true);
    check(withdrawnSelf.plannedMinutes === 450 && withdrawnSelf.draftMinutes === null, "Nach Ruecknahme sieht der Mitarbeiter nur noch Veroeffentlichtes");
    console.log("SUCCESS: " + checks + " Planstunden-Pruefungen bestanden.");
  } finally {
    await db.$disconnect();
    await socket.stop();
    await sql.close();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
