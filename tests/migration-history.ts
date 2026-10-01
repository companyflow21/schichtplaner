/*
 * Prueft die Migration 20261001090000_employee_delete_history_confirmation
 * an einem Altbestand: Die frueheren Migrationen laufen zuerst, dann werden
 * typische Altdaten angelegt, danach laeuft die neue Migration.
 * - Bestaetigungsherkunft nur fuer eindeutige Faelle (keine erfundene
 *   Mitarbeiterbestaetigung)
 * - keine Zeile geht verloren, Personen bleiben zugeordnet
 * - Historie haengt nicht mehr per CASCADE am Konto (RESTRICT), genau eine
 *   Personenreferenz (CHECK), Autorenschaft wird beim Kontoloeschen leer
 * Arbeitet ausschliesslich mit einer eigenen In-Memory-Datenbank.
 */
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const NEW_MIGRATION = "20261001090000_employee_delete_history_confirmation";
let checks = 0;
function check(value: unknown, message: string) {
  assert.ok(value, message);
  checks++;
  console.log("PASS: " + message);
}
async function rows<T = Record<string, unknown>>(sql: PGlite, text: string): Promise<T[]> {
  return (await sql.query<T>(text)).rows;
}
async function fails(sql: PGlite, text: string): Promise<boolean> {
  try { await sql.exec(text); return false; } catch { return true; }
}

async function main() {
  const sql = new PGlite();
  const all = (await readdir("prisma/migrations")).filter((x) => /^\d/.test(x)).sort();
  for (const m of all.filter((x) => x < NEW_MIGRATION)) await sql.exec(await readFile("prisma/migrations/" + m + "/migration.sql", "utf8"));
  const now = "CURRENT_TIMESTAMP";
  await sql.exec(`
    INSERT INTO "organizations" ("id","name","updatedAt") VALUES ('org','Altbestand',${now});
    INSERT INTO "users" ("id","email","firstName","lastName","updatedAt") VALUES
      ('admin','admin@akro-test.invalid','Ada','Admin',${now}),('u1','u1@akro-test.invalid','Uwe','Eins',${now}),('u2','u2@akro-test.invalid','Ute','Zwei',${now});
    INSERT INTO "organization_members" ("id","organizationId","userId","role","isActivated") VALUES
      ('mA','org','admin','ADMIN',true),('m1','org','u1','EMPLOYEE',true),('m2','org','u2','EMPLOYEE',true);
    INSERT INTO "customers" ("id","organizationId","name","updatedAt") VALUES ('c1','org','Kunde',${now});
    INSERT INTO "branches" ("id","organizationId","customerId","name") VALUES ('b1','org','c1','Objekt');
    INSERT INTO "schedules" ("id","organizationId","branchId","weekNumber","year","isPublic","updatedAt") VALUES ('S','org','b1',40,2026,true,${now});
    INSERT INTO "shifts" ("id","scheduleId","dayOfWeek","shiftFrom","shiftTo","maxEmployees") VALUES
      ('s1','S',1,'06:00','14:00',4),('s2','S',2,'22:00','06:00',2);
    INSERT INTO "bookings" ("id","shiftId","userId","bookedAt","bookedBy","confirmedAt") VALUES
      ('emp','s1','u1','2026-09-20 08:00:00','admin','2026-09-21 09:00:00'),
      ('plan','s1','u2','2026-09-20 08:30:00','admin',NULL),
      ('self','s2','u1','2026-09-20 09:00:00','u1',NULL),
      ('none','s2','u2','2026-09-20 09:30:00',NULL,NULL);
    INSERT INTO "time_records" ("id","userId","organizationId","branchId","date","timeFrom","timeTo","type","updatedAt") VALUES
      ('t1','u1','org','b1','2026-09-28','06:00','14:00','MANUAL',${now});
    INSERT INTO "checkins" ("id","organizationId","userId","shiftId","branchId","timeRecordId","method","status","lateMinutes") VALUES
      ('c1','org','u1','s1','b1','t1','GPS','CONFIRMED',0);
    INSERT INTO "messages" ("id","organizationId","senderId","subject","body") VALUES ('msg','org','u1','Info','Text');
    INSERT INTO "message_recipients" ("messageId","userId") VALUES ('msg','u2');
    INSERT INTO "topics" ("id","organizationId","title","createdById") VALUES ('top','org','Thema','admin');
    INSERT INTO "topic_posts" ("id","topicId","userId","text") VALUES ('post','top','u1','Beitrag');
    INSERT INTO "employee_notes" ("id","subjectId","authorId","text") VALUES ('note','u2','u1','Notiz');
    INSERT INTO "portal_files" ("id","organizationId","name","path","size","uploadedById") VALUES ('file','org','plan.pdf','x/plan.pdf',10,'u1');
  `);
  const count = async (table: string) => Number((await rows<{ n: number }>(sql, `SELECT count(*)::int AS n FROM "${table}"`))[0].n);
  const tables = ["bookings", "time_records", "checkins", "messages", "topic_posts", "employee_notes", "portal_files", "users", "organization_members"];
  const before = Object.fromEntries(await Promise.all(tables.map(async (t) => [t, await count(t)] as const)));

  await sql.exec(await readFile("prisma/migrations/" + NEW_MIGRATION + "/migration.sql", "utf8"));
  check(true, "migration runs on the legacy data");
  for (const t of tables) check(await count(t) === before[t], t + ": no row lost");

  const b = Object.fromEntries((await rows<{ id: string; userId: string | null; confirmation: string | null; confirmedAt: Date | null; bookedAt: Date }>(sql, `SELECT "id","userId","confirmation","confirmedAt","bookedAt" FROM "bookings"`)).map((r) => [r.id, r]));
  check(b.emp.confirmation === "EMPLOYEE" && b.emp.confirmedAt?.toISOString() === "2026-09-21T09:00:00.000Z", "own confirmation kept as EMPLOYEE with its timestamp");
  check(b.plan.confirmation === "PLANNER" && b.plan.confirmedAt?.getTime() === b.plan.bookedAt.getTime(), "assignment by someone else becomes PLANNER from the assignment time");
  check(b.self.confirmation === null && b.self.confirmedAt === null, "self-entered booking stays unconfirmed (origin unclear)");
  check(b.none.confirmation === null && b.none.confirmedAt === null, "booking without bookedBy stays unconfirmed (origin unclear)");
  check(Object.values(b).every((r) => r.userId), "all bookings keep their person");
  check((await rows(sql, `SELECT 1 FROM "time_records" WHERE "userId" = 'u1' AND "formerEmployeeId" IS NULL`)).length === 1, "time record keeps its person");

  // Genau eine Personenreferenz.
  await sql.exec(`INSERT INTO "former_employees" ("id","organizationId","firstName","lastName") VALUES ('f1','org','Uwe','Eins')`);
  check(await fails(sql, `INSERT INTO "bookings" ("id","shiftId") VALUES ('x1','s2')`), "booking without any person is rejected");
  check(await fails(sql, `INSERT INTO "bookings" ("id","shiftId","userId","formerEmployeeId") VALUES ('x2','s2','u2','f1')`), "booking with account and snapshot is rejected");
  check(await fails(sql, `INSERT INTO "time_records" ("id","organizationId","date","type","updatedAt") VALUES ('x3','org','2026-09-28','MANUAL',${now})`), "time record without any person is rejected");

  // Konto mit Historie laesst sich nicht still loeschen.
  check(await fails(sql, `DELETE FROM "users" WHERE "id" = 'u1'`), "deleting an account with history is refused (RESTRICT)");
  check(await count("time_records") === before.time_records && await count("checkins") === before.checkins && await count("bookings") === before.bookings, "refused delete leaves history untouched");

  // Nach dem Umhaengen auf die Momentaufnahme: Konto weg, Historie da, Autorenschaft leer.
  await sql.exec(`
    UPDATE "bookings" SET "userId" = NULL, "formerEmployeeId" = 'f1' WHERE "userId" = 'u1';
    UPDATE "time_records" SET "userId" = NULL, "formerEmployeeId" = 'f1' WHERE "userId" = 'u1';
    UPDATE "checkins" SET "userId" = NULL, "formerEmployeeId" = 'f1' WHERE "userId" = 'u1';
    DELETE FROM "users" WHERE "id" = 'u1';
  `);
  check((await rows(sql, `SELECT 1 FROM "users" WHERE "id" = 'u1'`)).length === 0, "account deleted after history moved to the snapshot");
  check(await count("bookings") === before.bookings && await count("time_records") === before.time_records && await count("checkins") === before.checkins, "history rows still there");
  check((await rows(sql, `SELECT 1 FROM "organization_members" WHERE "userId" = 'u1'`)).length === 0, "membership cascades with the account");
  check((await rows<{ senderId: string | null }>(sql, `SELECT "senderId" FROM "messages" WHERE "id" = 'msg'`))[0].senderId === null, "message stays, sender empty");
  check((await rows<{ userId: string | null }>(sql, `SELECT "userId" FROM "topic_posts" WHERE "id" = 'post'`))[0].userId === null, "topic post stays, author empty");
  check((await rows<{ authorId: string | null }>(sql, `SELECT "authorId" FROM "employee_notes" WHERE "id" = 'note'`))[0].authorId === null, "note about another person stays, author empty");
  check((await rows<{ uploadedById: string | null }>(sql, `SELECT "uploadedById" FROM "portal_files" WHERE "id" = 'file'`))[0].uploadedById === null, "file stays, uploader empty");

  // Neues Personalrecht ist speicherbar.
  await sql.exec(`INSERT INTO "staff_assignments" ("id","organizationId","managerMemberId","employeeMemberId","rights","updatedAt") VALUES ('sa','org','mA','m2','{DELETE_EMPLOYEE}',${now})`);
  check((await rows(sql, `SELECT 1 FROM "staff_assignments" WHERE 'DELETE_EMPLOYEE' = ANY("rights")`)).length === 1, "staff right DELETE_EMPLOYEE can be stored");

  await sql.close();
  console.log("SUCCESS: " + checks + " history migration checks passed.");
}

main().catch((error) => { console.error(error); process.exit(1); });
