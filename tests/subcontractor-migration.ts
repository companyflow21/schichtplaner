/* Neue Sub-Migration auf isoliertem Altbestand; keine Betriebsdatenbank. */
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const NEW_MIGRATION = "20261001120000_subcontractors";
let checks = 0;
function check(value: unknown, message: string) { assert.ok(value, message); checks++; console.log("PASS: " + message); }

async function main() {
  const sql = new PGlite();
  try {
    for (const m of (await readdir("prisma/migrations")).filter(x => /^\d/.test(x) && x < NEW_MIGRATION).sort()) await sql.exec(await readFile("prisma/migrations/" + m + "/migration.sql", "utf8"));
    const rows = async (text: string) => (await sql.query<Record<string, unknown>>(text)).rows;
    const snapshot = async () => JSON.stringify(await rows('SELECT * FROM "bookings" ORDER BY "id"'));
    // Nur der erwartete Mechanismus (Constraint oder Trigger) zaehlt, nicht irgendein Fehler.
    async function rejected(text: string, reason: RegExp, message: string) {
      let error: unknown;
      try { await sql.exec(text); } catch (e) { error = e; }
      const actual = error instanceof Error ? error.message : "nicht abgelehnt";
      check(reason.test(actual), message + (reason.test(actual) ? "" : " – tatsächlich: " + actual));
    }
    await sql.exec(`
      INSERT INTO "organizations" ("id","name","updatedAt") VALUES ('oa','Altbestand',CURRENT_TIMESTAMP),('ob','Andere Organisation',CURRENT_TIMESTAMP);
      INSERT INTO "users" ("id","email","firstName","lastName","updatedAt") VALUES ('u','sub-test@akro-test.invalid','Ute','Bestand',CURRENT_TIMESTAMP);
      INSERT INTO "former_employees" ("id","organizationId","firstName","lastName") VALUES ('f','oa','Franz','Historie');
      INSERT INTO "customers" ("id","organizationId","name","updatedAt") VALUES ('ca','oa','Kunde A',CURRENT_TIMESTAMP),('cb','ob','Kunde B',CURRENT_TIMESTAMP);
      INSERT INTO "branches" ("id","organizationId","customerId","name") VALUES ('ba','oa','ca','Standort A'),('bb','ob','cb','Standort B');
      INSERT INTO "schedules" ("id","organizationId","branchId","weekNumber","year","updatedAt") VALUES ('pa','oa','ba',40,2026,CURRENT_TIMESTAMP),('pb','ob','bb',40,2026,CURRENT_TIMESTAMP);
      INSERT INTO "shifts" ("id","scheduleId","dayOfWeek","shiftFrom","shiftTo","maxEmployees") VALUES ('sa','pa',1,'08:00','16:00',4),('sb','pb',1,'08:00','16:00',4);
      INSERT INTO "bookings" ("id","shiftId","userId","formerEmployeeId","confirmation","confirmedAt","bookedBy") VALUES
        ('old-user','sa','u',NULL,'PLANNER','2026-09-28 08:00:00','u'),('old-former','sa',NULL,'f','EMPLOYEE','2026-09-28 09:00:00',NULL);
    `);
    const before = snapshot();
    const legacy = JSON.parse(await before) as Record<string, unknown>[];
    await sql.exec(await readFile("prisma/migrations/" + NEW_MIGRATION + "/migration.sql", "utf8"));
    const migrated = (await rows('SELECT * FROM "bookings" ORDER BY "id"')).map(({ contractorWorkerId, ...r }) => { check(contractorWorkerId === null, "legacy booking has no contractor reference"); return r; });
    check(JSON.stringify(migrated) === JSON.stringify(legacy), "new migration preserves both account and former-person bookings, including confirmation and timestamps");
    await sql.exec(`
      INSERT INTO "subcontractors" ("id","organizationId","name","updatedAt") VALUES ('sca','oa','Sub A',CURRENT_TIMESTAMP),('scb','ob','Sub B',CURRENT_TIMESTAMP);
      INSERT INTO "contractor_workers" ("id","organizationId","subcontractorId","name","updatedAt") VALUES ('wa','oa','sca','MA 1',CURRENT_TIMESTAMP),('wb','ob','scb','MA 1',CURRENT_TIMESTAMP);
      INSERT INTO "bookings" ("id","shiftId","contractorWorkerId","confirmation") VALUES ('sub-booking','sa','wa','PLANNER');
    `);
    check((await rows('SELECT * FROM "bookings" WHERE "id" = \'sub-booking\'')).length === 1, "same-organisation placeholder booking is accepted without an account");
    await rejected(`INSERT INTO "bookings" ("id","shiftId") VALUES ('none','sa')`, /bookings_person_check/, "booking without any person is rejected");
    await rejected(`INSERT INTO "bookings" ("id","shiftId","userId","contractorWorkerId") VALUES ('two-user','sa','u','wa')`, /bookings_person_check/, "booking cannot reference account and placeholder together");
    await rejected(`INSERT INTO "bookings" ("id","shiftId","formerEmployeeId","contractorWorkerId") VALUES ('two-former','sa','f','wa')`, /bookings_person_check/, "booking cannot reference historical person and placeholder together");
    await rejected(`INSERT INTO "bookings" ("id","shiftId","contractorWorkerId") VALUES ('duplicate','sa','wa')`, /bookings_shiftId_contractorWorkerId_key/, "same placeholder cannot book the same shift twice");
    await rejected(`INSERT INTO "contractor_workers" ("id","organizationId","subcontractorId","name","updatedAt") VALUES ('mixed','ob','sca','Mischung',CURRENT_TIMESTAMP)`, /contractor_workers_subcontractorId_organizationId_fkey/, "composite foreign key prevents worker belonging to another organisation than its company");
    await rejected(`INSERT INTO "bookings" ("id","shiftId","contractorWorkerId") VALUES ('foreign-booking','sb','wa')`, /nicht zur gleichen Organisation/, "booking insert prevents cross-organisation placeholder assignment");
    await rejected(`UPDATE "bookings" SET "contractorWorkerId" = 'wb' WHERE "id" = 'sub-booking'`, /nicht zur gleichen Organisation/, "booking update prevents cross-organisation placeholder assignment");
    await rejected(`UPDATE "shifts" SET "scheduleId" = 'pb' WHERE "id" = 'sa'`, /Schicht kann nicht in eine fremde Organisation/, "shift cannot be moved to foreign organisation with existing contractor booking");
    await rejected(`UPDATE "schedules" SET "organizationId" = 'ob', "branchId" = NULL WHERE "id" = 'pa'`, /Plan mit Sub-Einsaetzen/, "plan cannot be moved to foreign organisation with existing contractor booking");
    await rejected(`UPDATE "contractor_workers" SET "organizationId" = 'ob', "subcontractorId" = 'scb' WHERE "id" = 'wa'`, /Platzhalter mit Einsaetzen/, "placeholder with booking cannot be moved to another organisation even with a matching company");
    await rejected(`DELETE FROM "contractor_workers" WHERE "id" = 'wa'`, /bookings_contractorWorkerId_fkey/, "placeholder with booking cannot be deleted and erase history");
    await sql.exec(`UPDATE "subcontractors" SET "isActive" = false WHERE "id" = 'sca'; UPDATE "contractor_workers" SET "isActive" = false WHERE "id" = 'wa';`);
    check((await rows('SELECT * FROM "bookings" ORDER BY "id"')).length === 3, "rejected writes and deactivation preserve all three bookings");

    // Firma samt Platzhaltern: Verschieben ueber ON UPDATE CASCADE und Loeschen bleiben gesperrt.
    await rejected(`UPDATE "subcontractors" SET "organizationId" = 'ob' WHERE "id" = 'sca'`, /Platzhalter mit Einsaetzen/, "company with booked placeholders cannot be moved to another organisation via cascade");
    await rejected(`DELETE FROM "subcontractors" WHERE "id" = 'sca'`, /contractor_workers_subcontractorId_organizationId_fkey/, "company with placeholders cannot be deleted");
    await rejected(`INSERT INTO "subcontractors" ("id","organizationId","name","updatedAt") VALUES ('dup','oa','Sub A',CURRENT_TIMESTAMP)`, /subcontractors_organizationId_name_key/, "company name is unique within one organisation");
    await rejected(`INSERT INTO "contractor_workers" ("id","organizationId","subcontractorId","name","updatedAt") VALUES ('dup-w','oa','sca','MA 1',CURRENT_TIMESTAMP)`, /contractor_workers_subcontractorId_name_key/, "placeholder name is unique within one company");
    // Der neue Trigger darf gewoehnliche Buchungen nicht behindern.
    await sql.exec(`
      INSERT INTO "shifts" ("id","scheduleId","dayOfWeek","shiftFrom","shiftTo","maxEmployees") VALUES ('sa2','pa',2,'08:00','16:00',2);
      INSERT INTO "bookings" ("id","shiftId","userId","confirmation") VALUES ('new-user','sa2','u','PLANNER');
      UPDATE "bookings" SET "confirmation" = 'PLANNER' WHERE "id" = 'old-former';
    `);
    check((await rows(`SELECT "id" FROM "bookings" WHERE "id" IN ('new-user','old-former') AND "confirmation" = 'PLANNER'`)).length === 2, "account and historical bookings stay writable after the migration");
    console.log("Subcontractor migration: " + checks + " checks passed.");
  } finally { await sql.close(); }
}

main().catch(e => { console.error(e); process.exitCode = 1; });
