/*
 * Push-Hintergrundlauf gegen eine eigene fluechtige Datenbank (PGlite) mit
 * einem Test-Absender - ohne echte Push-Dienste.
 *
 *   npx tsx tests/push-outbox.ts
 */
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";

let checks = 0;
function check(value: unknown, message: string) { assert.ok(value, message); checks++; console.log("PASS: " + message); }

async function main() {
  const sql = new PGlite();
  for (const m of (await readdir("prisma/migrations")).filter((x) => /^\d/.test(x)).sort()) await sql.exec(await readFile("prisma/migrations/" + m + "/migration.sql", "utf8"));
  const now = new Date("2026-09-29T10:00:00Z"), fresh = "'2026-09-29 09:59:00'", old = "'2026-09-29 07:00:00'";
  await sql.exec(`
    INSERT INTO "organizations" ("id","name","updatedAt") VALUES ('o1','Org 1',CURRENT_TIMESTAMP),('o2','Org 2',CURRENT_TIMESTAMP);
    INSERT INTO "users" ("id","email","firstName","lastName","updatedAt") VALUES
      ('u1','u1@akro-test.invalid','A','A',CURRENT_TIMESTAMP),('u2','u2@akro-test.invalid','B','B',CURRENT_TIMESTAMP),
      ('u3','u3@akro-test.invalid','C','C',CURRENT_TIMESTAMP),('u4','u4@akro-test.invalid','D','D',CURRENT_TIMESTAMP);
    INSERT INTO "organization_members" ("id","organizationId","userId","role","isActivated","isActive") VALUES
      ('m1','o1','u1','EMPLOYEE',true,true),('m2','o1','u2','EMPLOYEE',true,true),('m3','o1','u3','EMPLOYEE',true,false),('m4','o2','u4','EMPLOYEE',true,true);
    INSERT INTO "push_subscriptions" ("id","organizationId","userId","endpoint","p256dh","auth","updatedAt") VALUES
      ('s1','o1','u1','https://fcm.googleapis.com/fcm/send/eins','k','a',CURRENT_TIMESTAMP),
      ('s2','o1','u1','https://web.push.apple.com/zwei','k','a',CURRENT_TIMESTAMP),
      ('s3','o1','u3','https://fcm.googleapis.com/fcm/send/inaktiv','k','a',CURRENT_TIMESTAMP),
      ('s4','o2','u4','https://fcm.googleapis.com/fcm/send/fremd','k','a',CURRENT_TIMESTAMP);
    INSERT INTO "messages" ("id","organizationId","senderId","subject","body","createdAt") VALUES
      ('n1','o1','u2','Geheimer Betreff','Geheimer Text',${fresh}),('n2','o1','u2','Neue Schicht','x',${fresh}),
      ('n3','o1','u1','An B','x',${fresh}),('n4','o1','u1','An inaktiv','x',${fresh}),
      ('n5','o1','u2','Gelesen','x',${fresh}),('n6','o1','u2','Alt','x',${old}),('n7','o2','u4','Andere Org','x',${fresh});
    INSERT INTO "message_recipients" ("messageId","userId","isRead") VALUES
      ('n1','u1',false),('n2','u1',false),('n3','u2',false),('n4','u3',false),('n5','u1',true),('n6','u1',false),('n7','u4',false);
  `);
  const socket = new PGLiteSocketServer({ db: sql, host: "127.0.0.1", port: 55441 });
  await socket.start();
  process.env.DATABASE_URL = "postgresql://postgres:postgres@127.0.0.1:55441/postgres";
  process.env.DATABASE_POOL_MAX = "1";
  const { processPushOutbox, isPushEndpoint } = await import("../src/lib/push");
  const { db } = await import("../src/lib/db");
  try {
    const calls: { endpoint: string; payload: string }[] = [];
    const sender = async (s: { endpoint: string }, payload: string) => {
      calls.push({ endpoint: s.endpoint, payload });
      if (s.endpoint.endsWith("/zwei")) throw Object.assign(new Error("gone"), { statusCode: 410 });
    };
    const sent = await processPushOutbox(sender, now);
    const to = (suffix: string) => calls.filter((c) => c.endpoint.endsWith(suffix));
    check(to("/eins").length === 1 && JSON.parse(to("/eins")[0].payload).body.includes("2 neue Mitteilungen"), "one grouped notice per device for two new messages");
    check(calls.every((c) => !c.payload.includes("Geheim") && !c.payload.includes("Neue Schicht")), "notice carries no subject or text");
    check(!to("/inaktiv").length, "inactive members get no push");
    check(to("/fremd").length === 1, "each organisation only pushes to devices registered for it");
    check(sent === 2 && calls.length === 3, "read, old and device-less messages are skipped");
    check(!(await db.pushSubscription.findUnique({ where: { id: "s2" } })), "expired subscription (410) is removed");
    check((await db.messageRecipient.count({ where: { pushedAt: null } })) === 0, "every recipient row is marked as handled");
    check((await processPushOutbox(sender, now)) === 0 && calls.length === 3, "a second run sends nothing again");
    check(isPushEndpoint("https://fcm.googleapis.com/fcm/send/x") && isPushEndpoint("https://web.push.apple.com/x") && !isPushEndpoint("http://fcm.googleapis.com/x") && !isPushEndpoint("https://example.com/x") && !isPushEndpoint("https://fcm.googleapis.com.evil.test/x"), "only https endpoints of known push services are accepted");
    console.log("SUCCESS: " + checks + " push outbox checks passed.");
  } finally {
    await db.$disconnect();
    await socket.stop();
    await sql.close();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
