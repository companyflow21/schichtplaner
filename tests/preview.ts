/*
 * Browser-Vorschau mit Produktions-Build und Beispieldaten, ohne die
 * Integrationstests davor. Eigene In-Memory-Datenbank, nie .env-Daten.
 * Aufruf: npm run build && npx tsx tests/preview.ts
 * Anmeldung: admin@akro-test.invalid / AkroTest2026!Only (Port PREVIEW_PORT, Vorgabe 3310)
 */
import { readFile, readdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";
import { isoWeek } from "../src/lib/berlin";

async function main() {
  const sql = new PGlite();
  for (const m of (await readdir("prisma/migrations")).filter((x) => /^\d/.test(x)).sort()) await sql.exec(await readFile("prisma/migrations/" + m + "/migration.sql", "utf8"));
  const dbPort = Number(process.env.PREVIEW_DB_PORT || 55440), port = Number(process.env.PREVIEW_PORT || 3310);
  const socket = new PGLiteSocketServer({ db: sql, host: "127.0.0.1", port: dbPort });
  await socket.start();
  const url = "postgresql://postgres:postgres@127.0.0.1:" + dbPort + "/postgres";
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url, max: 1 }) });
  const password = "AkroTest2026!Only", passwordHash = await bcrypt.hash(password, 10);

  // --- Beispieldaten fuer Lohn (Oktober 2026) ------------------------------------
  const org = await db.organization.create({ data: { name: "AKRO Vorschau" } });
  const person = async (key: string, firstName: string, lastName: string, role: "ADMIN" | "EMPLOYEE") => {
    const user = await db.user.create({ data: { firstName, lastName, email: key + "@akro-test.invalid", passwordHash } });
    const member = await db.organizationMember.create({ data: { userId: user.id, organizationId: org.id, role, isActivated: true } });
    return { user, member };
  };
  await person("admin", "Alex", "Test", "ADMIN");
  const elke = await person("elke", "Elke", "Zweier", "EMPLOYEE"), emil = await person("emil", "Emil", "Einser", "EMPLOYEE");
  await person("ida", "Ida", "Ohnenummer", "EMPLOYEE");
  const normal = await db.payType.create({ data: { organizationId: org.id, title: "Normalstunden", hourlyRateCents: 1500, code: "100" } });
  const zulage = await db.payType.create({ data: { organizationId: org.id, title: "Objektzulage", hourlyRateCents: 1800, code: "110" } });
  await db.organizationMember.update({ where: { id: elke.member.id }, data: { personnelNumber: "4711", payTypeId: normal.id } });
  await db.organizationMember.update({ where: { id: emil.member.id }, data: { personnelNumber: "4712", payTypeId: normal.id } });
  const empfang = await db.division.create({ data: { organizationId: org.id, title: "Empfang", color: "#0ea5e9", payTypeId: zulage.id } });
  await db.surcharge.createMany({ data: [
    { organizationId: org.id, name: "Nacht", code: "200", weekdays: [1, 2, 3, 4, 5, 6, 7], timeFrom: "20:00", timeTo: "06:00", rateKind: "PERCENT", rate: 2500 },
    { organizationId: org.id, name: "Sonntag", code: "300", weekdays: [7], rateKind: "PERCENT", rate: 5000 },
    { organizationId: org.id, name: "Heiligabend ab 14 Uhr", code: "310", dates: ["12-24"], timeFrom: "14:00", timeTo: "00:00", rateKind: "AMOUNT", rate: 500 },
  ] });
  const customer = await db.customer.create({ data: { organizationId: org.id, name: "Kunde Nord" } });
  const branch = await db.branch.create({ data: { organizationId: org.id, customerId: customer.id, name: "Objekt Nord" } });
  const week = isoWeek("2026-10-05");
  const schedule = await db.schedule.create({ data: { organizationId: org.id, branchId: branch.id, year: week.year, weekNumber: week.weekNumber, isPublic: true } });
  const shift = await db.shift.create({ data: { scheduleId: schedule.id, dayOfWeek: 1, shiftFrom: "22:00", shiftTo: "06:00", divisionId: empfang.id, title: "Empfang Nacht" } });
  // Dienstag ohne Zeiterfassung: erscheint als "nicht erfasst".
  const missing = await db.shift.create({ data: { scheduleId: schedule.id, dayOfWeek: 2, shiftFrom: "08:00", shiftTo: "16:00", pauseOption: "PER_SHIFT", pauseValue: 30, title: "Empfang Tag" } });
  for (const s of [shift, missing]) await db.booking.create({ data: { shiftId: s.id, userId: elke.user.id } });
  const manual = (userId: string, date: string, timeFrom: string, timeTo: string, breakMinutes = 0, extra: { branchId?: string; shiftId?: string; approved?: boolean } = {}) =>
    db.timeRecord.create({ data: { organizationId: org.id, userId, date: new Date(date), type: "MANUAL", timeFrom, timeTo, breakSeconds: breakMinutes * 60, branchId: extra.branchId ?? null, shiftId: extra.shiftId ?? null, approvedAt: extra.approved === false ? null : new Date() } });
  await manual(elke.user.id, "2026-10-05", "22:00", "06:00", 0, { branchId: branch.id, shiftId: shift.id });
  await manual(elke.user.id, "2026-10-07", "08:00", "16:30", 30, { approved: false });
  await manual(emil.user.id, "2026-10-11", "08:00", "16:00", 30);

  // --- Zeitkonto, Urlaubskonto, Abwesenheit mit gebuchter Schicht -----------------------
  await db.timeSettings.create({ data: { organizationId: org.id, accountsEnabled: true, accountVisible: true } });
  await db.targetHours.create({ data: { organizationId: org.id, memberId: elke.member.id, startDate: new Date("2026-10-05"), minutes: 40 * 60, period: "WEEK" } });
  const urlaub = await db.absenceCategory.create({ data: { organizationId: org.id, name: "Urlaub", color: "#16a34a", isPaid: true, payCode: "500" } });
  await db.vacationSettings.create({ data: { organizationId: org.id, enabled: true, categoryId: urlaub.id, startDate: new Date("2026-01-01") } });
  await db.vacationAdjustment.create({ data: { organizationId: org.id, memberId: emil.member.id, date: new Date("2026-01-01"), days: 4.5, comment: "Resturlaub 2025" } });
  await db.absence.create({ data: { userId: emil.user.id, categoryId: urlaub.id, dateFrom: new Date("2026-08-03"), dateTo: new Date("2026-08-14"), status: "APPROVED", approvedAt: new Date() } });
  // Elke beantragt Urlaub am Mittwoch der Folgewoche, an dem sie eingeplant ist: Genehmigen zeigt die Schicht.
  const next = isoWeek("2026-10-12");
  const nextPlan = await db.schedule.create({ data: { organizationId: org.id, branchId: branch.id, year: next.year, weekNumber: next.weekNumber, isPublic: true } });
  const wed = await db.shift.create({ data: { scheduleId: nextPlan.id, dayOfWeek: 3, shiftFrom: "08:00", shiftTo: "16:00", pauseOption: "PER_SHIFT", pauseValue: 30, title: "Empfang Tag" } });
  await db.booking.create({ data: { shiftId: wed.id, userId: elke.user.id } });
  await db.absence.create({ data: { userId: elke.user.id, categoryId: urlaub.id, dateFrom: new Date("2026-10-14"), dateTo: new Date("2026-10-16") } });

  // --- Planungsregeln, Bearbeitungsmodus, erste Veroeffentlichung -----------------------
  // Ruhezeit 11 h und hoechstens 10 h am Tag: Elkes Nacht bis Di 06:00 und Di ab 08:00 verstossen.
  await db.planningRules.create({ data: { organizationId: org.id, rules: { rest: { enabled: true, hours: 11 }, dailyHours: { enabled: true, max: 10 } } } });
  await db.branchAccess.create({ data: { organizationId: org.id, memberId: elke.member.id, branchId: branch.id, rights: ["VIEW_SCHEDULE", "REQUEST_SHIFTS"] } });
  const coming = isoWeek("2026-10-19"), draftWeek = isoWeek("2026-10-26");
  const comingPlan = await db.schedule.create({ data: { organizationId: org.id, branchId: branch.id, year: coming.year, weekNumber: coming.weekNumber, isPublic: true, publishedAt: new Date() } });
  const comingMon = await db.shift.create({ data: { scheduleId: comingPlan.id, dayOfWeek: 1, shiftFrom: "08:00", shiftTo: "16:00", pauseOption: "PER_SHIFT", pauseValue: 30, title: "Empfang Tag" } });
  await db.shift.create({ data: { scheduleId: comingPlan.id, dayOfWeek: 2, shiftFrom: "08:00", shiftTo: "16:00", pauseOption: "PER_SHIFT", pauseValue: 30, title: "Empfang Tag" } });
  await db.booking.create({ data: { shiftId: comingMon.id, userId: elke.user.id } });
  const draft = await db.schedule.create({ data: { organizationId: org.id, branchId: branch.id, year: draftWeek.year, weekNumber: draftWeek.weekNumber } });
  for (const day of [1, 2, 3]) await db.shift.create({ data: { scheduleId: draft.id, dayOfWeek: day, shiftFrom: "06:00", shiftTo: "14:00", title: "Frühdienst" } });
  await db.$disconnect();

  const base = "http://127.0.0.1:" + port;
  const child = spawn(process.execPath, ["node_modules/tsx/dist/cli.mjs", "server.ts"], {
    cwd: process.cwd(), stdio: "inherit",
    env: { ...process.env, NODE_ENV: "production", PORT: String(port), DATABASE_URL: url, DATABASE_POOL_MAX: "1", AUTH_SECRET: "preview-secret-only-0123456789abcdef0123", AUTH_TRUST_HOST: "true", AUTH_URL: base, APP_URL: base, AI_ENABLED: "false", ALLOW_REGISTRATION: "false", PUSH_LOOP_DISABLED: "1", NEXT_TELEMETRY_DISABLED: "1", TZ: "Europe/Berlin" },
  });
  for (let i = 0; i < 120; i++) { try { if ((await fetch(base + "/api/health")).ok) break; } catch {} await new Promise((r) => setTimeout(r, 500)); }
  console.log("PREVIEW " + base + " — admin@akro-test.invalid / " + password);
  await new Promise<void>((resolve) => { process.on("SIGTERM", resolve); process.on("SIGINT", resolve); child.on("exit", () => resolve()); });
  child.kill("SIGTERM");
  await socket.stop();
  await sql.close();
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
