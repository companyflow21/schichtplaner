/*
 * KI-Werkzeug "getSchedule" auf Datenbankebene (PGlite, alle Migrationen):
 * Eingeteilte Personen erscheinen mit dem Namen, den auch der Dienstplan zeigt -
 * Konto, Subunternehmer-Platzhalter ("Sub A · MA 1") und geloeschte Person.
 *
 *   npx tsx tests/ai-schedule-names.ts
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from "node:assert/strict";
import net from "node:net";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

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
  // src/lib/db.ts nimmt diesen Client statt eines eigenen (siehe tests/employee-delete-db.ts).
  (globalThis as any).prisma = db;
  const { executeTool } = await import("../src/lib/ai/chat-tools");

  const org = await db.organization.create({ data: { name: "KI-Namen" } });
  const admin = await db.user.create({ data: { email: "admin@x.invalid", firstName: "Alex", lastName: "Admin", passwordHash: "x" } });
  await db.organizationMember.create({ data: { organizationId: org.id, userId: admin.id, role: "ADMIN", isActivated: true } });
  const customer = await db.customer.create({ data: { organizationId: org.id, name: "Kunde" } });
  const branch = await db.branch.create({ data: { organizationId: org.id, customerId: customer.id, name: "Objekt" } });
  const schedule = await db.schedule.create({ data: { organizationId: org.id, branchId: branch.id, weekNumber: 40, year: 2026 } });
  const shift = await db.shift.create({ data: { scheduleId: schedule.id, dayOfWeek: 1, shiftFrom: "08:00", shiftTo: "16:00", maxEmployees: 3 } });
  const sub = await db.subcontractor.create({ data: { organizationId: org.id, name: "Sub A" } });
  const worker = await db.contractorWorker.create({ data: { organizationId: org.id, subcontractorId: sub.id, name: "MA 1" } });
  const former = await db.formerEmployee.create({ data: { organizationId: org.id, firstName: "Fritz", lastName: "Früher" } });
  await db.booking.create({ data: { shiftId: shift.id, userId: admin.id } });
  await db.booking.create({ data: { shiftId: shift.id, contractorWorkerId: worker.id } });
  await db.booking.create({ data: { shiftId: shift.id, formerEmployeeId: former.id } });

  const { content } = await executeTool("getSchedule", { weekNumber: 40, year: 2026 }, org.id, admin.id);
  console.log(content);
  assert.ok(content.includes("Alex Admin"), "Konto mit Namen");
  assert.ok(content.includes("Sub A · MA 1"), "Platzhalter wie im Dienstplan");
  assert.ok(content.includes("Fritz Früher"), "geloeschte Person mit gespeichertem Namen");
  assert.ok(!content.includes("Gelöschte Person"), "kein Platzhalter als geloeschte Person");
  console.log("SUCCESS: KI-Dienstplan zeigt Konto, Platzhalter und geloeschte Person korrekt.");
  await db.$disconnect();
  await socket.stop();
  await sql.close();
}

main().catch((error) => { console.error(error); process.exit(1); });
