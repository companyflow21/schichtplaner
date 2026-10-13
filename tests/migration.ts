/*
 * Prueft die Migration auf Kunden und Standortplaene an einem Altbestand:
 * Die alten Migrationen laufen zuerst, dann werden typische Altdaten
 * angelegt (org-weite Wochenplaene mit Schichten mehrerer Standorte,
 * Schichten ohne Standort, Widersprueche, Briefing, Live-Daten,
 * Nachrichten, Zeitbuchungen), danach laeuft die neue Migration.
 * Arbeitet ausschliesslich mit einer eigenen In-Memory-Datenbank.
 */
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const NEW_MIGRATION = "20260924090000_customers_branch_access";
let checks = 0;
function check(value: unknown, message: string) {
  assert.ok(value, message);
  checks++;
  console.log("PASS: " + message);
}

async function database(upTo: string) {
  const sql = new PGlite();
  const migrations = (await readdir("prisma/migrations")).filter((x) => /^\d/.test(x) && x < upTo).sort();
  for (const migration of migrations) await sql.exec(await readFile("prisma/migrations/" + migration + "/migration.sql", "utf8"));
  return sql;
}

async function rows<T = Record<string, unknown>>(sql: PGlite, text: string, params: unknown[] = []): Promise<T[]> {
  return (await sql.query<T>(text, params)).rows;
}

const now = "CURRENT_TIMESTAMP";

async function legacyData(sql: PGlite) {
  await sql.exec(`
    INSERT INTO "organizations" ("id","name","updatedAt","scheduleVisibility") VALUES ('orgA','Alt-Organisation',${now},'ALL'),('orgB','Andere Organisation',${now},'OWN_ONLY');
    INSERT INTO "users" ("id","email","firstName","lastName","updatedAt") VALUES
      ('u1','u1@akro-test.invalid','Uwe','Eins',${now}),('u2','u2@akro-test.invalid','Ute','Zwei',${now}),
      ('u3','u3@akro-test.invalid','Udo','Drei',${now}),('uB','ub@akro-test.invalid','Bea','Fremd',${now});
    INSERT INTO "organization_members" ("id","organizationId","userId","role","isActivated") VALUES
      ('m1','orgA','u1','EMPLOYEE',true),('m2','orgA','u2','EMPLOYEE',true),('m3','orgA','u3','MANAGER',true),('mB','orgB','uB','ADMIN',true);
    INSERT INTO "branches" ("id","organizationId","name") VALUES ('A1','orgA','Objekt Nord'),('A2','orgA','Objekt Sued'),('B1','orgB','Fremdobjekt');

    -- KW 10/2026: organisationsweiter Altplan, veroeffentlicht, eigene Darstellung
    INSERT INTO "schedules" ("id","organizationId","branchId","weekNumber","year","isPublic","settingsLayout","showTitle","showPauses","updatedAt")
      VALUES ('S','orgA',NULL,10,2026,true,'LAYOUT_2',false,true,${now});
    INSERT INTO "shifts" ("id","scheduleId","branchId","dayOfWeek","shiftFrom","shiftTo","maxEmployees","title","deletedAt") VALUES
      ('s1','S','A1',1,'06:00','14:00',2,'Frueh',NULL),
      ('s2','S','A2',2,'14:00','22:00',1,'Spaet',NULL),
      ('s3','S',NULL,3,'08:00','16:00',1,'Ohne Standort',NULL),
      ('s4','S','A1',4,'08:00','16:00',1,'Geloescht','2026-03-01 10:00:00'),
      ('s8','S','A1',5,'22:00','06:00',1,'Nacht',NULL),
      ('s10','S','A1',3,'17:00','21:00',1,'Abend',NULL),
      ('s11','S','A2',3,'06:00','07:00',1,'Kurz',NULL);
    INSERT INTO "bookings" ("id","shiftId","userId","confirmedAt") VALUES
      ('b1','s1','u1','2026-02-27 09:00:00'),('b2','s2','u2',NULL),('b3','s3','u3',NULL),('b8','s8','u1',NULL),
      ('b10','s10','u3',NULL),('b11','s11','u3',NULL);
    INSERT INTO "mod_requests" ("id","shiftId","userId","kind","state") VALUES ('r2','s2','u2','SWAP','OPEN');
    INSERT INTO "messages" ("id","organizationId","senderId","subject","body","shiftId") VALUES ('msg1','orgA','u1','Schichtinfo','Bitte Pforte nutzen.','s1');
    INSERT INTO "message_recipients" ("messageId","userId") VALUES ('msg1','u2');
    INSERT INTO "briefings" ("id","scheduleId","text","updatedAt") VALUES ('br1','S','Briefing KW 10',${now});
    INSERT INTO "live_sessions" ("id","scheduleId","isActive","bookRequests","allowExceeds") VALUES ('L','S',true,true,false);
    INSERT INTO "live_days" ("id","liveSessionId","dayOfWeek","enabled")
      SELECT 'LD' || d, 'L', d, d <> 7 FROM generate_series(1,7) d;
    INSERT INTO "live_logs" ("id","liveSessionId","shiftId","userId","action") VALUES
      ('LL1','L','s1','u1','BOOK'),('LL2','L','s2','u2','BOOK'),('LL3','L','s3','u3','BOOK');

    -- KW 11/2026: Entwurf
    INSERT INTO "schedules" ("id","organizationId","branchId","weekNumber","year","isPublic","updatedAt") VALUES ('S2','orgA',NULL,11,2026,false,${now});
    INSERT INTO "shifts" ("id","scheduleId","branchId","dayOfWeek","shiftFrom","shiftTo") VALUES ('s5','S2','A1',1,'08:00','16:00');
    INSERT INTO "bookings" ("id","shiftId","userId") VALUES ('b5','s5','u1');

    -- KW 12/2026: vorhandener Standortplan mit widerspruechlicher Schicht
    INSERT INTO "schedules" ("id","organizationId","branchId","weekNumber","year","isPublic","updatedAt") VALUES ('SB','orgA','A2',12,2026,true,${now});
    INSERT INTO "shifts" ("id","scheduleId","branchId","dayOfWeek","shiftFrom","shiftTo") VALUES ('s6','SB','A1',1,'08:00','16:00'),('s7','SB',NULL,2,'08:00','16:00');

    -- Fremde Organisation
    INSERT INTO "schedules" ("id","organizationId","branchId","weekNumber","year","isPublic","updatedAt") VALUES ('SX','orgB',NULL,10,2026,true,${now});
    INSERT INTO "shifts" ("id","scheduleId","branchId","dayOfWeek","shiftFrom","shiftTo") VALUES ('x1','SX','B1',1,'06:00','14:00');
    INSERT INTO "bookings" ("id","shiftId","userId") VALUES ('bx','x1','uB');

    INSERT INTO "time_records" ("id","userId","organizationId","date","type","timeFrom","timeTo","durationHours","durationMinutes","updatedAt") VALUES
      ('t1','u1','orgA','2026-03-02','MANUAL','06:00','14:00',NULL,NULL,${now}),
      ('t2','u2','orgA','2026-03-03','MANUAL_DURATION',NULL,NULL,8,0,${now}),
      ('t3','u3','orgA','2026-03-04','MANUAL','08:00','16:00',NULL,NULL,${now}),
      ('t4','u1','orgA','2026-03-05','MANUAL','08:00','10:00',NULL,NULL,${now}),
      ('t5','u1','orgA','2026-03-09','MANUAL','08:00','16:00',NULL,NULL,${now}),
      ('t6','u1','orgA','2026-03-06','WATCH','23:00','05:00',NULL,NULL,${now}),
      ('t7','u1','orgA','2026-03-07','MANUAL','01:00','04:00',NULL,NULL,${now}),
      ('t9','u3','orgA','2026-03-04','MANUAL_DURATION',NULL,NULL,2,0,${now}),
      ('tB','uB','orgB','2026-03-02','MANUAL','06:00','14:00',NULL,NULL,${now});
  `);
}

async function main() {
  const sql = await database(NEW_MIGRATION);
  await legacyData(sql);
  const count = async (table: string) => Number((await rows<{ n: number }>(sql, `SELECT count(*)::int AS n FROM "${table}"`))[0].n);
  const before: Record<string, number> = {};
  for (const table of ["shifts", "bookings", "mod_requests", "messages", "message_recipients", "live_logs", "time_records", "branches", "schedules", "briefings", "live_sessions", "live_days"]) before[table] = await count(table);
  const bookingsBefore = await rows(sql, `SELECT "id","shiftId","userId","confirmedAt" FROM "bookings" ORDER BY "id"`);

  await sql.exec(await readFile("prisma/migrations/" + NEW_MIGRATION + "/migration.sql", "utf8"));
  console.log("PASS: migration applied on legacy data");

  for (const table of ["shifts", "bookings", "mod_requests", "messages", "message_recipients", "live_logs", "time_records", "branches"]) {
    check((await count(table)) === before[table], table + " unchanged in number");
  }
  check(JSON.stringify(await rows(sql, `SELECT "id","shiftId","userId","confirmedAt" FROM "bookings" ORDER BY "id"`)) === JSON.stringify(bookingsBefore), "bookings unchanged incl. confirmations");

  const place = async (shift: string) => (await rows<{ branch: string | null; week: number; public: boolean; schedule: string; deleted: boolean }>(sql,
    `SELECT sc."branchId" AS branch, sc."weekNumber" AS week, sc."isPublic" AS public, sc."id" AS schedule, s."deletedAt" IS NOT NULL AS deleted
     FROM "shifts" s JOIN "schedules" sc ON sc."id" = s."scheduleId" WHERE s."id" = $1`, [shift]))[0];
  const expected: Record<string, [string | null, number, boolean]> = {
    s1: ["A1", 10, true], s2: ["A2", 10, true], s3: [null, 10, true], s4: ["A1", 10, true], s8: ["A1", 10, true],
    s10: ["A1", 10, true], s11: ["A2", 10, true], s5: ["A1", 11, false], s6: ["A1", 12, true], s7: ["A2", 12, true], x1: ["B1", 10, true],
  };
  for (const [shift, [branch, week, isPublic]] of Object.entries(expected)) {
    const p = await place(shift);
    check(p.branch === branch && p.week === week && p.public === isPublic, `shift ${shift} lies in plan ${branch ?? "ohne Standort"} KW ${week} (${isPublic ? "veroeffentlicht" : "Entwurf"})`);
  }
  check((await place("s3")).schedule === "S", "shift without location stays in the legacy plan");
  check((await place("s7")).schedule === "SB", "shift without own location keeps its location plan");
  check((await place("s4")).deleted, "deleted shift stays deleted after the move");
  check((await place("s1")).schedule === (await place("s8")).schedule && (await place("s1")).schedule !== (await place("s2")).schedule, "one plan per location and week");

  const a1w10 = await rows<{ settingsLayout: string; showTitle: boolean; showPauses: boolean }>(sql, `SELECT "settingsLayout","showTitle","showPauses" FROM "schedules" WHERE "branchId"='A1' AND "weekNumber"=10`);
  check(a1w10.length === 1 && a1w10[0].settingsLayout === "LAYOUT_2" && a1w10[0].showTitle === false && a1w10[0].showPauses === true, "display settings copied from the legacy plan");
  check((await rows(sql, `SELECT 1 FROM "schedules" WHERE "organizationId"='orgA' AND "branchId"='B1'`)).length === 0, "no plan links a foreign organization's location");

  const briefings = await rows<{ branchId: string | null; text: string }>(sql, `SELECT sc."branchId", b."text" FROM "briefings" b JOIN "schedules" sc ON sc."id" = b."scheduleId" WHERE sc."weekNumber" = 10 AND sc."organizationId" = 'orgA' ORDER BY sc."branchId" NULLS FIRST`);
  check(briefings.length === 3 && briefings.every((b) => b.text === "Briefing KW 10"), "briefing kept on the legacy plan and copied into each location plan");

  const sessions = await rows<{ id: string; branchId: string | null; isActive: boolean; bookRequests: boolean; days: number; disabled: number }>(sql,
    `SELECT l."id", sc."branchId", l."isActive", l."bookRequests",
            (SELECT count(*)::int FROM "live_days" d WHERE d."liveSessionId" = l."id") AS days,
            (SELECT count(*)::int FROM "live_days" d WHERE d."liveSessionId" = l."id" AND NOT d."enabled") AS disabled
     FROM "live_sessions" l JOIN "schedules" sc ON sc."id" = l."scheduleId" WHERE sc."organizationId" = 'orgA' ORDER BY sc."branchId" NULLS FIRST`);
  check(sessions.length === 3 && sessions.every((s) => s.isActive && s.bookRequests && s.days === 7 && s.disabled === 1), "live session with its days copied into each location plan");
  const logs = await rows<{ id: string; branchId: string | null }>(sql, `SELECT lg."id", sc."branchId" FROM "live_logs" lg JOIN "live_sessions" l ON l."id" = lg."liveSessionId" JOIN "schedules" sc ON sc."id" = l."scheduleId" ORDER BY lg."id"`);
  check(logs.find((l) => l.id === "LL1")?.branchId === "A1" && logs.find((l) => l.id === "LL2")?.branchId === "A2" && logs.find((l) => l.id === "LL3")?.branchId === null, "live logs follow their shifts");

  check((await rows<{ shiftId: string }>(sql, `SELECT "shiftId" FROM "messages" WHERE "id"='msg1'`))[0].shiftId === "s1", "message keeps its shift");
  check((await rows<{ shiftId: string; state: string }>(sql, `SELECT "shiftId","state" FROM "mod_requests" WHERE "id"='r2'`))[0].state === "OPEN", "request keeps shift and state");

  check((await count("customers")) === 0 && (await rows(sql, `SELECT 1 FROM "branches" WHERE "customerId" IS NOT NULL`)).length === 0, "no customer invented, legacy locations stay unassigned");

  const times = Object.fromEntries((await rows<{ id: string; branchId: string | null }>(sql, `SELECT "id","branchId" FROM "time_records"`)).map((r) => [r.id, r.branchId]));
  check(times.t1 === "A1", "time record overlapping a published shift gets its location");
  check(times.t2 === "A2", "duration record matches the shift of the same day");
  check(times.t3 === null, "record at a shift without location stays unassigned");
  check(times.t4 === null, "record without shift stays unassigned");
  check(times.t5 === null, "record at a draft shift stays unassigned");
  check(times.t6 === "A1" && times.t7 === "A1", "overnight shift assigns records before and after midnight");
  check(times.t9 === null, "ambiguous day (two locations) stays unassigned");
  check(times.tB === "B1", "assignment stays within the organization");

  const columns = await rows(sql, `SELECT 1 FROM information_schema.columns WHERE table_name IN ('shifts','organizations') AND column_name IN ('branchId','scheduleVisibility')`);
  check(columns.length === 0, "shift location and organisation-wide visibility removed");

  const rejects = async (statement: string, message: string) => {
    await assert.rejects(sql.exec(statement), Error, message);
    checks++;
    console.log("PASS: " + message);
  };
  await rejects(`INSERT INTO "schedules" ("id","organizationId","branchId","weekNumber","year","updatedAt") VALUES ('bad','orgA','B1',20,2026,${now})`, "plan cannot use a location of another organisation");
  await sql.exec(`INSERT INTO "customers" ("id","organizationId","name","updatedAt") VALUES ('cB','orgB','Fremdkunde',${now})`);
  await rejects(`UPDATE "branches" SET "customerId"='cB' WHERE "id"='A1'`, "location cannot belong to a customer of another organisation");
  await rejects(`INSERT INTO "branch_access" ("id","organizationId","memberId","branchId","updatedAt") VALUES ('ba','orgA','mB','A1',${now})`, "grant cannot mix members of another organisation");
  await rejects(`INSERT INTO "branch_access" ("id","organizationId","memberId","branchId","updatedAt") VALUES ('ba','orgA','m1','B1',${now})`, "grant cannot mix locations of another organisation");
  await rejects(`INSERT INTO "time_records" ("id","userId","organizationId","branchId","date","type","updatedAt") VALUES ('tx','u1','orgA','B1','2026-03-02','MANUAL',${now})`, "time record cannot use a location of another organisation");
  await sql.close();

  // Widerspruch ohne eindeutige Aufloesung: die Migration bricht ab und
  // laesst den Altbestand unveraendert.
  const conflict = await database(NEW_MIGRATION);
  await conflict.exec(`
    INSERT INTO "organizations" ("id","name","updatedAt") VALUES ('o','Org',${now});
    INSERT INTO "branches" ("id","organizationId","name") VALUES ('b','o','Objekt');
    INSERT INTO "schedules" ("id","organizationId","branchId","weekNumber","year","isPublic","updatedAt") VALUES ('p1','o',NULL,10,2026,true,${now}),('p2','o',NULL,10,2026,false,${now});
    INSERT INTO "shifts" ("id","scheduleId","branchId","dayOfWeek","shiftFrom","shiftTo") VALUES ('a','p1','b',1,'08:00','16:00'),('c','p2','b',2,'08:00','16:00');
  `);
  await assert.rejects(conflict.exec(await readFile("prisma/migrations/" + NEW_MIGRATION + "/migration.sql", "utf8")), /unterschiedlichem Veroeffentlichungs/);
  await conflict.exec("ROLLBACK");
  check((await rows(conflict, `SELECT 1 FROM information_schema.columns WHERE table_name='shifts' AND column_name='branchId'`)).length === 1, "contradictory legacy plans abort the migration without changes");
  await conflict.close();

  // Qualifikationskatalog und Monatssoll: Altbestand ohne Verlust uebernehmen.
  const CATALOG = "20260925090000_qualification_catalog_monthly_target";
  const cat = await database(CATALOG);
  await cat.exec(`
    INSERT INTO "organizations" ("id","name","updatedAt","nameFormat") VALUES ('q1','Org Eins',${now},'NICKNAME'),('q2','Org Zwei',${now},'LASTNAME_FIRSTNAME');
    INSERT INTO "users" ("id","email","firstName","lastName","nickname","updatedAt") VALUES ('qa','qa@akro-test.invalid','Anna','Alt','Anni',${now}),('qb','qb@akro-test.invalid','Bernd','Alt',NULL,${now}),('qc','qc@akro-test.invalid','Cleo','Fremd',NULL,${now});
    INSERT INTO "organization_members" ("id","organizationId","userId","role","isActivated","qualifications","targetHoursPerWeek") VALUES
      ('qm1','q1','qa','EMPLOYEE',true,ARRAY['Erste Hilfe',' Brandschutz '],38.5),
      ('qm2','q1','qb','EMPLOYEE',true,ARRAY['erste hilfe','Erste Hilfe'],20),
      ('qm3','q2','qc','EMPLOYEE',true,ARRAY['Erste Hilfe'],40);
    INSERT INTO "schedules" ("id","organizationId","weekNumber","year","updatedAt") VALUES ('qp','q1',12,2026,${now});
    INSERT INTO "shifts" ("id","scheduleId","dayOfWeek","shiftFrom","shiftTo","requiredQualifications","deletedAt") VALUES ('qs1','qp',1,'22:00','06:00',ARRAY['ERSTE HILFE','Nachtwache'],NULL),('qs2','qp',2,'08:00','16:00',ARRAY['Sachkunde 34a'],${now});
  `);
  await cat.exec(await readFile("prisma/migrations/" + CATALOG + "/migration.sql", "utf8"));
  const catalog = await rows<{ organizationId: string; name: string; normalizedName: string }>(cat, `SELECT "organizationId","name","normalizedName" FROM "qualifications" ORDER BY "organizationId","normalizedName"`);
  const names = (org: string) => catalog.filter((c) => c.organizationId === org).map((c) => c.name).join("|");
  check(names("q1") === "Brandschutz|Erste Hilfe|Nachtwache|Sachkunde 34a", "catalog takes every qualification of members and shifts (also deleted shifts), trimmed, once per name");
  check(names("q2") === "Erste Hilfe", "catalog stays per organisation");
  check(catalog.every((c) => c.normalizedName === c.name.trim().toLowerCase()), "catalog stores the normalized name for uniqueness");
  const members = await rows<{ id: string; qualifications: string[]; targetHoursPerWeek: number; targetHoursPerMonth: number | null }>(cat, `SELECT "id","qualifications","targetHoursPerWeek","targetHoursPerMonth" FROM "organization_members" ORDER BY "id"`);
  check(members[0].qualifications.join("|") === "Erste Hilfe| Brandschutz " && members[1].qualifications.join("|") === "erste hilfe|Erste Hilfe", "existing member assignments stay unchanged");
  check(members.every((m) => m.targetHoursPerMonth === null) && members[0].targetHoursPerWeek === 38.5 && members[1].targetHoursPerWeek === 20, "monthly target starts empty, weekly values stay, no conversion");
  check((await rows<{ requiredQualifications: string[] }>(cat, `SELECT "requiredQualifications" FROM "shifts" WHERE "id"='qs1'`))[0].requiredQualifications.join("|") === "ERSTE HILFE|Nachtwache", "shift requirements stay unchanged");
  check((await rows<{ nickname: string | null; nameFormat: string }>(cat, `SELECT u."nickname", o."nameFormat" FROM "users" u, "organizations" o WHERE u."id"='qa' AND o."id"='q1'`))[0].nickname === "Anni", "stored nicknames and name format stay untouched");
  await assert.rejects(cat.exec(`INSERT INTO "qualifications" ("id","organizationId","name","normalizedName") VALUES ('dup','q1','ERSTE HILFE','erste hilfe')`), /unique|eindeutig|duplicate/i);
  check(true, "catalog rejects a second entry with the same normalized name");
  await cat.exec(`INSERT INTO "qualifications" ("id","organizationId","name","normalizedName") VALUES ('ok','q2','Brandschutz','brandschutz')`);
  check((await rows(cat, `SELECT 1 FROM "qualifications" WHERE "organizationId"='q2'`)).length === 2, "same name is allowed in another organisation");
  await cat.close();

  // Tausch, Standortbezug und Check-in: rein additiv, Bestand bleibt unveraendert.
  const CHECKIN = "20260929090000_exchange_messages_checkin";
  const gps = await database(CHECKIN);
  await gps.exec(`
    INSERT INTO "organizations" ("id","name","updatedAt") VALUES ('g1','Org GPS',${now});
    INSERT INTO "users" ("id","email","firstName","lastName","updatedAt") VALUES ('ga','ga@akro-test.invalid','Gabi','Alt',${now});
    INSERT INTO "branches" ("id","organizationId","name") VALUES ('gb','g1','Altstandort');
    INSERT INTO "schedules" ("id","organizationId","branchId","weekNumber","year","updatedAt") VALUES ('gp','g1','gb',40,2026,${now});
    INSERT INTO "shifts" ("id","scheduleId","dayOfWeek","shiftFrom","shiftTo") VALUES ('gs','gp',1,'22:00','06:00');
    INSERT INTO "mod_requests" ("id","shiftId","userId","kind") VALUES ('gr','gs','ga','SWAP');
    INSERT INTO "messages" ("id","organizationId","senderId","subject","body","shiftId") VALUES ('gm','g1','ga','Alt','Text','gs');
  `);
  await gps.exec(await readFile("prisma/migrations/" + CHECKIN + "/migration.sql", "utf8"));
  const site = (await rows<{ latitude: number | null; checkinRadiusM: number; gpsCheckinRequired: boolean; name: string }>(gps, `SELECT "latitude","checkinRadiusM","gpsCheckinRequired","name" FROM "branches" WHERE "id"='gb'`))[0];
  check(site.name === "Altstandort" && site.latitude === null && site.checkinRadiusM === 50 && site.gpsCheckinRequired === false, "existing sites keep their data, get radius 50 m and no required check-in");
  const request = (await rows<{ kind: string; targetShiftId: string | null; state: string }>(gps, `SELECT "kind","targetShiftId","state" FROM "mod_requests" WHERE "id"='gr'`))[0];
  check(request.kind === "SWAP" && request.targetShiftId === null && request.state === "OPEN", "existing requests stay single-shift hand-overs");
  check((await rows<{ branchId: string | null; shiftId: string }>(gps, `SELECT "branchId","shiftId" FROM "messages" WHERE "id"='gm'`))[0].shiftId === "gs", "existing messages keep their shift reference");
  const add = (id: string, status: string) => gps.exec(`INSERT INTO "checkins" ("id","organizationId","userId","shiftId","branchId","method","status","lateMinutes") VALUES ('${id}','g1','ga','gs','gb','MANUAL','${status}',5)`);
  await add("c1", "DECLINED"); await add("c2", "PENDING");
  await assert.rejects(add("c3", "CONFIRMED"), /unique|duplicate/i);
  await add("c4", "DECLINED");
  check((await rows(gps, `SELECT 1 FROM "checkins"`)).length === 3, "at most one active check-in per shift and person; declined ones stay as history");
  await gps.close();

  // Push: bestehende Empfaengerzeilen gelten als erledigt (kein Nachschicken alter Mitteilungen).
  const PUSH = "20260929120000_push_subscriptions";
  const push = await database(PUSH);
  await push.exec(`
    INSERT INTO "organizations" ("id","name","updatedAt") VALUES ('p1','Org Push',${now});
    INSERT INTO "users" ("id","email","firstName","lastName","updatedAt") VALUES ('pa','pa@akro-test.invalid','Paul','Alt',${now});
    INSERT INTO "messages" ("id","organizationId","senderId","subject","body") VALUES ('pm','p1','pa','Alt','Text');
    INSERT INTO "message_recipients" ("messageId","userId","isRead") VALUES ('pm','pa',false);
  `);
  await push.exec(await readFile("prisma/migrations/" + PUSH + "/migration.sql", "utf8"));
  const recipient = (await rows<{ pushedAt: Date | null; isRead: boolean }>(push, `SELECT "pushedAt","isRead" FROM "message_recipients" WHERE "messageId"='pm'`))[0];
  check(recipient.pushedAt !== null && recipient.isRead === false, "existing unread messages are marked as pushed, read state unchanged");
  await push.close();

  // Bundesland je Einsatzort: rein additiv; bestehende Standorte bleiben ohne Angabe (keine Ableitung aus Name oder Adresse).
  const HOLIDAY = "20261012090000_branch_holiday_state";
  const hol = await database(HOLIDAY);
  await hol.exec(`
    INSERT INTO "organizations" ("id","name","updatedAt") VALUES ('h1','Org Feiertag',${now});
    INSERT INTO "branches" ("id","organizationId","name","address","latitude","longitude") VALUES ('hb','h1','Jena','Teststraße 1, 07743 Jena',50.9,11.6);
  `);
  await hol.exec(await readFile("prisma/migrations/" + HOLIDAY + "/migration.sql", "utf8"));
  const holidaySite = (await rows<{ holidayState: string | null; name: string; address: string; latitude: number }>(hol, `SELECT "holidayState","name","address","latitude" FROM "branches" WHERE "id"='hb'`))[0];
  check(holidaySite.holidayState === null && holidaySite.name === "Jena" && holidaySite.address === "Teststraße 1, 07743 Jena" && holidaySite.latitude === 50.9, "existing sites keep their data and get no derived federal state");
  await hol.close();

  // Plan-Lebenszyklus: rein additiv; bestehende Plaene bleiben Entwurf oder veroeffentlicht, keiner ist in Bearbeitung.
  const EDITING = "20261012120000_schedule_editing";
  const edit = await database(EDITING);
  await edit.exec(`
    INSERT INTO "organizations" ("id","name","updatedAt") VALUES ('e1','Org Lebenszyklus',${now});
    INSERT INTO "branches" ("id","organizationId","name") VALUES ('eb','e1','Objekt');
    INSERT INTO "schedules" ("id","organizationId","branchId","weekNumber","year","isPublic","updatedAt") VALUES ('ep','e1','eb',10,2027,true,${now}),('ed','e1','eb',11,2027,false,${now});
  `);
  await edit.exec(await readFile("prisma/migrations/" + EDITING + "/migration.sql", "utf8"));
  const plans = await rows<{ id: string; isPublic: boolean; editingSince: Date | null; editingById: string | null }>(edit, `SELECT "id","isPublic","editingSince","editingById" FROM "schedules" ORDER BY "id"`);
  check(plans.length === 2 && plans.every((p) => p.editingSince === null && p.editingById === null) && plans.find((p) => p.id === "ep")?.isPublic === true && plans.find((p) => p.id === "ed")?.isPublic === false, "existing plans keep draft/published and are not in editing");
  check((await rows(edit, `SELECT 1 FROM "schedule_snapshots"`)).length === 0, "no snapshots for existing plans");
  await edit.exec(`INSERT INTO "schedule_snapshots" ("scheduleId","data") VALUES ('ep','{"version":1,"shifts":[]}')`);
  await assert.rejects(edit.exec(`INSERT INTO "schedule_snapshots" ("scheduleId","data") VALUES ('ep','{}')`), /unique|duplicate/i);
  await assert.rejects(edit.exec(`INSERT INTO "schedule_snapshots" ("scheduleId","data") VALUES ('fehlt','{}')`), /foreign key/i);
  await edit.exec(`DELETE FROM "schedules" WHERE "id"='ep'`);
  check((await rows(edit, `SELECT 1 FROM "schedule_snapshots"`)).length === 0, "at most one snapshot per plan, only for existing plans, removed with the plan");
  await edit.close();

  // Planungsregeln: additiv, ohne Eintrag alles aus; je Organisation eine Zeile, je Person eine Abweichung.
  const RULES = "20261013150000_planning_rules";
  const pr = await database(RULES);
  await pr.exec(`
    INSERT INTO "organizations" ("id","name","updatedAt") VALUES ('p1','Org Regeln',${now});
    INSERT INTO "users" ("id","email","firstName","lastName","updatedAt") VALUES ('pa','pa@akro-test.invalid','Pia','Alt',${now});
    INSERT INTO "organization_members" ("id","organizationId","userId","role","isActivated") VALUES ('pm','p1','pa','EMPLOYEE',true);
  `);
  await pr.exec(await readFile("prisma/migrations/" + RULES + "/migration.sql", "utf8"));
  check((await rows(pr, `SELECT 1 FROM "planning_rules"`)).length === 0, "no organization gets rules by the migration");
  await pr.exec(`INSERT INTO "planning_rules" ("id","organizationId","updatedAt") VALUES ('r1','p1',${now})`);
  check(JSON.stringify((await rows<{ rules: unknown }>(pr, `SELECT "rules" FROM "planning_rules"`))[0].rules) === "{}", "rules default to an empty set (all off)");
  await assert.rejects(pr.exec(`INSERT INTO "planning_rules" ("id","organizationId","updatedAt") VALUES ('r2','p1',${now})`), /unique|duplicate/i);
  await pr.exec(`INSERT INTO "planning_rule_overrides" ("id","organizationId","memberId","rules","updatedAt") VALUES ('o1','p1','pm','{"rest":{"enabled":false,"hours":11}}',${now})`);
  await assert.rejects(pr.exec(`INSERT INTO "planning_rule_overrides" ("id","organizationId","memberId","updatedAt") VALUES ('o2','p1','pm',${now})`), /unique|duplicate/i);
  await pr.exec(`DELETE FROM "organization_members" WHERE "id"='pm'`);
  check((await rows(pr, `SELECT 1 FROM "planning_rule_overrides"`)).length === 0, "one rule set per organization, one override per person; removed with the member");
  await pr.close();
  // Lohn: rein additiv nach dem Plan-Lebenszyklus; Personalnummer eindeutig je Organisation, genutzte Lohnart
  // nicht loeschbar. Zeiten geloeschter Personen (userId NULL) und das Bundesland je Einsatzort bleiben unberuehrt.
  const PAYROLL = "20261013100000_payroll";
  check(PAYROLL > EDITING && PAYROLL > HOLIDAY, "payroll migration is ordered after the plan lifecycle and federal state migrations");
  const pay = await database(PAYROLL);
  await pay.exec(`
    INSERT INTO "organizations" ("id","name","updatedAt") VALUES ('l1','Org Lohn',${now}),('l2','Org Zwei',${now});
    INSERT INTO "users" ("id","email","firstName","lastName","updatedAt") VALUES ('la','la@akro-test.invalid','Lea','Alt',${now}),('lb','lb@akro-test.invalid','Leo','Alt',${now});
    INSERT INTO "organization_members" ("id","organizationId","userId","role","isActivated","position") VALUES ('lm1','l1','la','EMPLOYEE',true,'Wache'),('lm2','l1','lb','EMPLOYEE',true,null),('lm3','l2','la','EMPLOYEE',true,null);
    INSERT INTO "divisions" ("id","organizationId","title") VALUES ('ld','l1','Empfang');
    INSERT INTO "branches" ("id","organizationId","name","holidayState") VALUES ('lbr','l1','Objekt Lohn','NW');
    INSERT INTO "former_employees" ("id","organizationId","firstName","lastName") VALUES ('lf','l1','Fritz','Frueher');
    INSERT INTO "time_records" ("id","organizationId","userId","formerEmployeeId","branchId","date","timeFrom","timeTo","type","updatedAt") VALUES ('lt','l1',null,'lf','lbr','2026-10-01','08:00','16:00','MANUAL',${now});
  `);
  await pay.exec(await readFile("prisma/migrations/" + PAYROLL + "/migration.sql", "utf8"));
  const kept = (await rows<{ userId: string | null; formerEmployeeId: string | null; holidayState: string | null }>(pay, `SELECT t."userId",t."formerEmployeeId",b."holidayState" FROM "time_records" t JOIN "branches" b ON b."id"=t."branchId" WHERE t."id"='lt'`))[0];
  check(kept.userId === null && kept.formerEmployeeId === "lf" && kept.holidayState === "NW", "time records of deleted people and the federal state per site stay unchanged");
  const member = (await rows<{ position: string | null; personnelNumber: string | null; payTypeId: string | null }>(pay, `SELECT "position","personnelNumber","payTypeId" FROM "organization_members" WHERE "id"='lm1'`))[0];
  check(member.position === "Wache" && member.personnelNumber === null && member.payTypeId === null, "existing members keep their data and start without personnel number and pay type");
  check((await rows<{ payTypeId: string | null }>(pay, `SELECT "payTypeId" FROM "divisions" WHERE "id"='ld'`))[0].payTypeId === null, "existing work areas start without their own pay type");
  await pay.exec(`UPDATE "organization_members" SET "personnelNumber"='100' WHERE "id"='lm1'; UPDATE "organization_members" SET "personnelNumber"='100' WHERE "id"='lm3';`);
  await assert.rejects(pay.exec(`UPDATE "organization_members" SET "personnelNumber"='100' WHERE "id"='lm2'`), /unique|duplicate/i);
  check(true, "personnel numbers are unique within an organisation but may repeat across organisations");
  await pay.exec(`INSERT INTO "pay_types" ("id","organizationId","title","hourlyRateCents") VALUES ('lp','l1','Normal',1500); UPDATE "organization_members" SET "payTypeId"='lp' WHERE "id"='lm1';`);
  await assert.rejects(pay.exec(`DELETE FROM "pay_types" WHERE "id"='lp'`), /foreign key|violates/i);
  check(true, "a pay type in use cannot be deleted");
  await pay.exec(`INSERT INTO "surcharges" ("id","organizationId","name","rateKind","rate") VALUES ('ls','l1','Nacht','PERCENT',2500)`);
  const surcharge = (await rows<{ weekdays: number[]; allPeople: boolean; timeFrom: string; timeTo: string }>(pay, `SELECT "weekdays","allPeople","timeFrom","timeTo" FROM "surcharges" WHERE "id"='ls'`))[0];
  check(surcharge.weekdays.length === 0 && surcharge.allPeople && surcharge.timeFrom === "00:00" && surcharge.timeTo === "00:00", "surcharge defaults: no days, everyone, whole day");
  await pay.close();

  // Stunden genehmigen: nach dem Lohn. Abgeschlossene Altbuchungen gelten als genehmigt (approvedAt = updatedAt,
  // ohne Pruefer - "automatisch uebernommen"), laufende Stoppuhren nicht; Schicht nur aus dem Check-in (timeRecordId
  // ist eindeutig, also hoechstens ein Check-in je Buchung). Zeiten geloeschter Personen (userId NULL) ebenso.
  const APPROVAL = "20261013110000_time_approval";
  check(APPROVAL > PAYROLL && APPROVAL < RULES, "time approval migration is ordered after payroll and before the planning rules");
  const ap = await database(APPROVAL);
  await ap.exec(`
    INSERT INTO "organizations" ("id","name","updatedAt") VALUES ('a1','Org Zeit',${now});
    INSERT INTO "users" ("id","email","firstName","lastName","updatedAt") VALUES ('aa','aa@akro-test.invalid','Anna','Alt',${now});
    INSERT INTO "former_employees" ("id","organizationId","firstName","lastName") VALUES ('af','a1','Franz','Frueher');
    INSERT INTO "branches" ("id","organizationId","name") VALUES ('ab','a1','Objekt');
    INSERT INTO "schedules" ("id","organizationId","branchId","weekNumber","year","isPublic","updatedAt") VALUES ('ap','a1','ab',40,2026,true,${now});
    INSERT INTO "shifts" ("id","scheduleId","dayOfWeek","shiftFrom","shiftTo") VALUES ('as','ap',1,'08:00','16:00'),('as2','ap',2,'08:00','16:00');
    INSERT INTO "time_records" ("id","userId","formerEmployeeId","organizationId","branchId","date","type","timeFrom","timeTo","durationHours","updatedAt") VALUES
      ('t1','aa',null,'a1','ab','2026-09-28','MANUAL','08:00','16:00',null,'2026-09-28 17:00:00'),
      ('t2','aa',null,'a1','ab','2026-09-28','WATCH','08:00',null,null,${now}),
      ('t3','aa',null,'a1','ab','2026-09-28','WATCH','08:00','16:00',null,'2026-09-28 16:00:00'),
      ('t4',null,'af','a1','ab','2026-09-29','WATCH','08:00','16:00',null,'2026-09-29 16:00:00'),
      ('t5','aa',null,'a1',null,'2026-09-30','MANUAL_DURATION',null,null,4,'2026-09-30 12:00:00');
    INSERT INTO "checkins" ("id","organizationId","userId","formerEmployeeId","shiftId","branchId","method","status","lateMinutes","timeRecordId") VALUES
      ('ac','a1','aa',null,'as','ab','GPS','CONFIRMED',0,'t3'),
      ('ad','a1','aa',null,'as','ab','MANUAL','DECLINED',0,null),
      ('ae','a1',null,'af','as2','ab','GPS','CONFIRMED',0,'t4');
  `);
  await ap.exec(await readFile("prisma/migrations/" + APPROVAL + "/migration.sql", "utf8"));
  type Approval = { id: string; userId: string | null; formerEmployeeId: string | null; approvedAt: Date | null; approvedById: string | null; legacy: boolean; shiftId: string | null; timeTo: string | null };
  const approvals = new Map((await rows<Approval>(ap, `SELECT "id","userId","formerEmployeeId","approvedAt","approvedById","approvedAt" = "updatedAt" AS "legacy","shiftId","timeTo" FROM "time_records"`)).map((r) => [r.id, r]));
  const at = (id: string) => approvals.get(id)!;
  check(["t1", "t3", "t4", "t5"].every((id) => at(id).approvedAt !== null && at(id).legacy) && at("t2").approvedAt === null, "finished legacy records (manual, stopwatch, duration) count as approved at their last change, a running stopwatch stays open");
  check([...approvals.values()].every((r) => r.approvedById === null), "legacy approval has no reviewer (shown as 'automatisch übernommen')");
  check(at("t4").userId === null && at("t4").formerEmployeeId === "af" && at("t4").legacy && at("t4").shiftId === "as2", "records of deleted people are approved the same way and keep their snapshot person");
  check(at("t1").shiftId === null && at("t2").shiftId === null && at("t3").shiftId === "as" && at("t5").shiftId === null, "the shift is taken over from the check-in only (a declined check-in without record changes nothing)");
  check(at("t1").timeTo === "16:00" && at("t2").timeTo === null, "times stay unchanged");
  await assert.rejects(ap.exec(`INSERT INTO "checkins" ("id","organizationId","userId","shiftId","branchId","method","status","lateMinutes","timeRecordId") VALUES ('ax','a1','aa','as2','ab','GPS','DECLINED',0,'t3')`), /unique|duplicate/i);
  check(true, "a time record has at most one check-in, so the shift taken over is unambiguous");
  await ap.exec(`DELETE FROM "shifts" WHERE "id"='as2'`);
  const orphan = (await rows<{ shiftId: string | null }>(ap, `SELECT "shiftId" FROM "time_records" WHERE "id"='t4'`))[0];
  check(orphan && orphan.shiftId === null, "deleting a shift keeps the time record and only clears its shift link");
  const autoDefault = await rows<{ d: string }>(ap, `SELECT column_default AS "d" FROM information_schema.columns WHERE table_name='time_settings' AND column_name='autoApprove'`);
  check(autoDefault.length === 1 && autoDefault[0].d === "false", "auto-approval setting exists and defaults to off");
  await ap.close();

  // Zeitkonten (Cloud: 20261014090000_time_accounts): additiv nach der Stundenfreigabe und vor den Planungsregeln,
  // zunaechst aus, ohne Konto fuer bestehende Personen; ein Soll je Person und Startdatum. Konto, Soll und Ausgleich
  // haengen an der Mitgliedschaft und entfallen mit dem Loeschen der Person (geloeschte Personen haben kein Zeitkonto).
  const ACCOUNTS = "20261013120000_time_accounts";
  check(ACCOUNTS > APPROVAL && ACCOUNTS < RULES, "time account migration is ordered after time approval and before the planning rules");
  const acc = await database(ACCOUNTS);
  await acc.exec(`
    INSERT INTO "organizations" ("id","name","updatedAt") VALUES ('k1','Org Konto',${now});
    INSERT INTO "users" ("id","email","firstName","lastName","updatedAt") VALUES ('ka','ka@akro-test.invalid','Kai','Alt',${now});
    INSERT INTO "organization_members" ("id","organizationId","userId","role","isActivated","targetHoursPerMonth") VALUES ('km','k1','ka','EMPLOYEE',true,160);
    INSERT INTO "time_settings" ("id","organizationId","autoApprove") VALUES ('ks','k1',true);
    INSERT INTO "former_employees" ("id","organizationId","firstName","lastName") VALUES ('kf','k1','Kurt','Frueher');
    INSERT INTO "time_records" ("id","organizationId","userId","formerEmployeeId","date","type","timeFrom","timeTo","updatedAt") VALUES ('kr','k1',null,'kf','2026-09-28','MANUAL','08:00','16:00',${now});
  `);
  await acc.exec(await readFile("prisma/migrations/" + ACCOUNTS + "/migration.sql", "utf8"));
  const ts = (await rows<{ autoApprove: boolean; accountsEnabled: boolean; accountMethod: string; accountVisible: boolean }>(acc, `SELECT "autoApprove","accountsEnabled","accountMethod","accountVisible" FROM "time_settings" WHERE "id"='ks'`))[0];
  check(ts.autoApprove === true && ts.accountsEnabled === false && ts.accountMethod === "ACTUAL_MINUS_TARGET" && ts.accountVisible === false, "existing time settings keep their values; accounts start switched off");
  check((await rows(acc, `SELECT 1 FROM "time_accounts"`)).length === 0 && (await rows(acc, `SELECT 1 FROM "target_hours"`)).length === 0, "no account and no target is derived for existing people (not even from the monthly target hours)");
  const formerTime = (await rows<{ userId: string | null; formerEmployeeId: string | null }>(acc, `SELECT "userId","formerEmployeeId" FROM "time_records" WHERE "id"='kr'`))[0];
  check(formerTime.userId === null && formerTime.formerEmployeeId === "kf", "times of deleted people stay unchanged history");
  await acc.exec(`INSERT INTO "target_hours" ("id","organizationId","memberId","startDate","minutes","period") VALUES ('kt1','k1','km','2026-01-05',2400,'WEEK')`);
  await assert.rejects(acc.exec(`INSERT INTO "target_hours" ("id","organizationId","memberId","startDate","minutes","period") VALUES ('kt2','k1','km','2026-01-05',1200,'WEEK')`), /unique|duplicate/i);
  check(true, "one target per person and start date");
  await acc.exec(`
    INSERT INTO "time_accounts" ("id","organizationId","memberId","updatedAt") VALUES ('kc','k1','km',${now});
    INSERT INTO "time_compensations" ("id","organizationId","memberId","date","minutes","description") VALUES ('kx','k1','km','2026-01-05',720,'Anfangssaldo');
  `);
  await assert.rejects(acc.exec(`INSERT INTO "time_accounts" ("id","organizationId","memberId","updatedAt") VALUES ('kc2','k1','km',${now})`), /unique|duplicate/i);
  await acc.exec(`DELETE FROM "organization_members" WHERE "id"='km'`);
  check((await rows(acc, `SELECT 1 FROM "target_hours"`)).length === 0 && (await rows(acc, `SELECT 1 FROM "time_accounts"`)).length === 0 && (await rows(acc, `SELECT 1 FROM "time_compensations"`)).length === 0, "one account per person; account, targets and compensations are removed with the member");
  await acc.close();

  // Abwesenheit wirkt (Cloud: 20261015090000_absence_effects): Altbestand ohne Wirkung und ohne "genehmigt von" - eine
  // genehmigte Altabwesenheit erscheint in "Stunden und Lohn" als abwesend mit 0 Stunden. Entscheidung je Schicht
  // eindeutig; Zuweisungen (auch geloeschter Personen und Platzhalter) bleiben unberuehrt.
  const EFFECTS = "20261013130000_absence_effects";
  check(EFFECTS > ACCOUNTS && EFFECTS < RULES, "absence effects migration is ordered after the time accounts and before the planning rules");
  const eff = await database(EFFECTS);
  await eff.exec(`
    INSERT INTO "organizations" ("id","name","updatedAt") VALUES ('e1','Org Abw',${now});
    INSERT INTO "users" ("id","email","firstName","lastName","updatedAt") VALUES ('ea','ea@akro-test.invalid','Eva','Alt',${now});
    INSERT INTO "former_employees" ("id","organizationId","firstName","lastName") VALUES ('ef','e1','Ernst','Frueher');
    INSERT INTO "subcontractors" ("id","organizationId","name","updatedAt") VALUES ('esc','e1','Sub GmbH',${now});
    INSERT INTO "contractor_workers" ("id","organizationId","subcontractorId","name","updatedAt") VALUES ('ew','e1','esc','Platzhalter 1',${now});
    INSERT INTO "absence_categories" ("id","organizationId","name","isPaid") VALUES ('ec','e1','Urlaub',true);
    INSERT INTO "absences" ("id","userId","categoryId","dateFrom","dateTo","status") VALUES ('ex','ea','ec','2026-09-01','2026-09-02','APPROVED');
    INSERT INTO "schedules" ("id","organizationId","weekNumber","year","isPublic","updatedAt") VALUES ('ep','e1',36,2026,true,${now});
    INSERT INTO "shifts" ("id","scheduleId","dayOfWeek","shiftFrom","shiftTo","maxEmployees") VALUES ('es','ep',2,'08:00','16:00',3);
    INSERT INTO "bookings" ("id","shiftId","userId","formerEmployeeId","contractorWorkerId") VALUES ('eb1','es','ea',null,null),('eb2','es',null,'ef',null),('eb3','es',null,null,'ew');
  `);
  await eff.exec(await readFile("prisma/migrations/" + EFFECTS + "/migration.sql", "utf8"));
  const legacy = (await rows<{ status: string; approvedById: string | null; approvedAt: Date | null }>(eff, `SELECT "status","approvedById","approvedAt" FROM "absences" WHERE "id"='ex'`))[0];
  check(legacy.status === "APPROVED" && legacy.approvedById === null && legacy.approvedAt === null && (await rows(eff, `SELECT 1 FROM "absence_shifts"`)).length === 0, "approved legacy absences keep their status, have no approver and no effects (shown as absent with 0 hours)");
  check((await rows<{ payCode: string | null }>(eff, `SELECT "payCode" FROM "absence_categories" WHERE "id"='ec'`))[0].payCode === null, "categories start without payroll code");
  check((await rows(eff, `SELECT 1 FROM "bookings" WHERE "shiftId"='es'`)).length === 3, "assignments of people, deleted people and placeholders stay unchanged");
  await eff.exec(`INSERT INTO "absence_shifts" ("id","absenceId","shiftId","handling") VALUES ('f1','ex','es','PAID')`);
  await assert.rejects(eff.exec(`INSERT INTO "absence_shifts" ("id","absenceId","shiftId","handling") VALUES ('f2','ex','es','UNPAID')`), /unique|duplicate/i);
  await assert.rejects(eff.exec(`INSERT INTO "absence_shifts" ("id","absenceId","shiftId","handling") VALUES ('f3','ex','fehlt','PAID')`), /foreign key/i);
  await eff.exec(`DELETE FROM "absences" WHERE "id"='ex'`);
  check((await rows(eff, `SELECT 1 FROM "absence_shifts"`)).length === 0, "one decision per absence and shift, only for existing shifts; removed with the absence");
  await eff.close();

  // Urlaubskonto (Cloud: 20261016090000_vacation_account): additiv und zunaechst aus; je Organisation eine Regel, je
  // Person eine Abweichung. Regeln und Korrekturen haengen an der Mitgliedschaft und entfallen mit der Person.
  const VACATION = "20261013140000_vacation_account";
  check(VACATION > EFFECTS && VACATION < RULES, "vacation account migration is ordered after the absence effects and before the planning rules");
  const vac = await database(VACATION);
  await vac.exec(`
    INSERT INTO "organizations" ("id","name","updatedAt") VALUES ('u1','Org Urlaub',${now});
    INSERT INTO "users" ("id","email","firstName","lastName","updatedAt") VALUES ('ua','ua@akro-test.invalid','Uwe','Alt',${now});
    INSERT INTO "organization_members" ("id","organizationId","userId","role","isActivated") VALUES ('um','u1','ua','EMPLOYEE',true);
  `);
  await vac.exec(await readFile("prisma/migrations/" + VACATION + "/migration.sql", "utf8"));
  check((await rows(vac, `SELECT 1 FROM "vacation_settings"`)).length === 0, "no organization gets a vacation account by the migration");
  await vac.exec(`INSERT INTO "vacation_settings" ("id","organizationId","updatedAt") VALUES ('v1','u1',${now})`);
  const vs = (await rows<{ enabled: boolean; daysPerYear: number | null; yearStart: string; excludedWeekdays: number[]; carryOver: boolean; visible: boolean; categoryId: string | null }>(vac, `SELECT "enabled","daysPerYear","yearStart","excludedWeekdays","carryOver","visible","categoryId" FROM "vacation_settings"`))[0];
  check(!vs.enabled && vs.categoryId === null && vs.daysPerYear === null && vs.yearStart === "01-01" && vs.excludedWeekdays.join() === "6,7" && vs.carryOver && vs.visible, "defaults: off, no category, no vacation days preset (cloud: 30), calendar year, weekends free, carry-over, visible");
  await assert.rejects(vac.exec(`INSERT INTO "vacation_settings" ("id","organizationId","updatedAt") VALUES ('v2','u1',${now})`), /unique|duplicate/i);
  await vac.exec(`INSERT INTO "vacation_rules" ("id","organizationId","memberId","updatedAt") VALUES ('r1','u1','um',${now})`);
  await assert.rejects(vac.exec(`INSERT INTO "vacation_rules" ("id","organizationId","memberId","updatedAt") VALUES ('r2','u1','um',${now})`), /unique|duplicate/i);
  await vac.exec(`INSERT INTO "vacation_adjustments" ("id","organizationId","memberId","date","days","comment") VALUES ('a1','u1','um','2026-01-01',2.5,'Resturlaub')`);
  check(true, "one settings row per organization, one rule per person");
  await vac.exec(`DELETE FROM "organization_members" WHERE "id"='um'`);
  check((await rows(vac, `SELECT 1 FROM "vacation_rules"`)).length === 0 && (await rows(vac, `SELECT 1 FROM "vacation_adjustments"`)).length === 0, "rules and corrections are removed with the member");
  await vac.close();

  console.log("SUCCESS: " + checks + " migration checks passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
