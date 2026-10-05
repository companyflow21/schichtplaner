/*
 * Parallelzugriffe gegen echtes PostgreSQL ueber die laufende App (mehrere
 * Verbindungen im Pool, mehrere Sitzungen, gleichzeitige HTTP-Anfragen).
 * Prueft je Runde: letzter Platz, derselbe Sub-Platzhalter in ueberlappenden
 * Schichten, doppelte Genehmigung desselben Antrags. Erwartung jeweils genau
 * ein Erfolg, Endzustand in der Datenbank korrekt.
 *
 * Nur gegen eine Testinstallation: Datenbankname mit "test", keine akro-group-Adresse.
 * Legt eine eigene Organisation "Parallelitaet Test …" an und loescht nichts.
 *
 *   CONCURRENCY_BASE_URL=http://127.0.0.1:18080 DATABASE_URL=… npx tsx tests/postgres-concurrency.ts
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { Client } from "pg";

const base = process.env.CONCURRENCY_BASE_URL ?? "";
const url = process.env.DATABASE_URL ?? "";
const rounds = Number(process.env.CONCURRENCY_ROUNDS || 10);
const dbName = decodeURIComponent(new URL(url || "postgresql://x/none").pathname.slice(1));
if (!base || /akro-group\./i.test(base)) throw new Error("CONCURRENCY_BASE_URL fehlt oder zeigt auf den Betrieb.");
if (!url || !/test/i.test(dbName)) throw new Error("DATABASE_URL muss auf eine Testdatenbank zeigen (Name mit test).");

const password = randomBytes(18).toString("base64url");
const id = (p: string) => p + "-" + randomBytes(6).toString("hex");
let failures = 0, checks = 0;
function check(ok: boolean, message: string) { checks++; if (!ok) failures++; console.log((ok ? "PASS: " : "FEHLER: ") + message); }

class Session {
  jar = new Map<string, string>();
  cookie() { return [...this.jar].map(([k, v]) => k + "=" + v).join("; "); }
  remember(r: Response) { for (const c of r.headers.getSetCookie()) { const p = c.split(";")[0], i = p.indexOf("="); this.jar.set(p.slice(0, i), p.slice(i + 1)); } }
  async raw(path: string, method = "GET", data?: unknown) {
    const r = await fetch(base + path, { method, redirect: "manual", signal: AbortSignal.timeout(60_000), headers: { Cookie: this.cookie(), "Content-Type": "application/json" }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
    this.remember(r);
    return { status: r.status, body: await r.json().catch(() => ({})) as any };
  }
  async login(email: string) {
    const csrf = (await this.raw("/api/auth/csrf")).body.csrfToken;
    const r = await fetch(base + "/api/auth/callback/credentials", { method: "POST", redirect: "manual", headers: { Cookie: this.cookie(), "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ csrfToken: csrf, email, password, callbackUrl: base + "/dashboard" }) });
    this.remember(r);
    if ((await this.raw("/api/auth/session")).body.user?.email !== email) throw new Error("Anmeldung fehlgeschlagen: " + email);
  }
}

/** Montag einer kuenftigen ISO-Woche und deren Kennung. */
function futureWeek(weeksAhead: number) {
  const d = new Date(); d.setUTCHours(12, 0, 0, 0); d.setUTCDate(d.getUTCDate() + 7 * weeksAhead);
  const t = new Date(d); t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  const year = t.getUTCFullYear();
  return { year, weekNumber: Math.ceil(((t.getTime() - Date.UTC(year, 0, 1)) / 86400000 + 1) / 7) };
}

async function main() {
  const db = new Client({ connectionString: url });
  await db.connect();
  const q = async (text: string, values: unknown[] = []) => (await db.query(text, values)).rows;
  const hash = await bcrypt.hash(password, 10);
  const stamp = new Date().toISOString().slice(0, 16);
  const org = id("org"), customer = id("cust"), branch = id("br"), sub = id("sub"), worker = id("w");
  await q(`INSERT INTO organizations (id, name, "updatedAt") VALUES ($1, $2, now())`, [org, "Parallelitaet Test " + stamp]);
  const people: { userId: string; memberId: string; email: string; role: string }[] = [];
  const person = async (role: string, n: number) => {
    const userId = id("u"), memberId = id("m"), email = `parallel-${role.toLowerCase()}-${n}-${org.slice(-6)}@akro-test.invalid`;
    await q(`INSERT INTO users (id, email, "firstName", "lastName", "passwordHash", "updatedAt") VALUES ($1, $2, $3, $4, $5, now())`, [userId, email, role === "ADMIN" ? "Admin" : "Person", String(n), hash]);
    await q(`INSERT INTO organization_members (id, "organizationId", "userId", role, "isActivated") VALUES ($1, $2, $3, $4, true)`, [memberId, org, userId, role]);
    people.push({ userId, memberId, email, role });
    return { userId, memberId, email };
  };
  const admins = [await person("ADMIN", 1), await person("ADMIN", 2)];
  const staff = []; for (let n = 1; n <= 10; n++) staff.push(await person("EMPLOYEE", n));
  await q(`INSERT INTO customers (id, "organizationId", name, "updatedAt") VALUES ($1, $2, 'Testkunde', now())`, [customer, org]);
  await q(`INSERT INTO branches (id, "organizationId", "customerId", name) VALUES ($1, $2, $3, 'Testobjekt')`, [branch, org, customer]);
  for (const s of staff) await q(`INSERT INTO branch_access (id, "organizationId", "memberId", "branchId", rights, "updatedAt") VALUES ($1, $2, $3, $4, ARRAY['VIEW_SCHEDULE','REQUEST_SHIFTS']::"BranchRight"[], now())`, [id("ba"), org, s.memberId, branch]);
  await q(`INSERT INTO subcontractors (id, "organizationId", name, "updatedAt") VALUES ($1, $2, 'Sub Parallel', now())`, [sub, org]);
  await q(`INSERT INTO contractor_workers (id, "organizationId", "subcontractorId", name, "updatedAt") VALUES ($1, $2, $3, 'MA 1', now())`, [worker, org, sub]);
  const week = futureWeek(3);
  const schedule = id("sch");
  await q(`INSERT INTO schedules (id, "organizationId", "branchId", "weekNumber", year, "isPublic", "updatedAt") VALUES ($1, $2, $3, $4, $5, true, now())`, [schedule, org, branch, week.weekNumber, week.year]);
  const shift = async (day: number, from: string, to: string, max: number) => { const s = id("sh"); await q(`INSERT INTO shifts (id, "scheduleId", "dayOfWeek", "shiftFrom", "shiftTo", "maxEmployees") VALUES ($1, $2, $3, $4, $5, $6)`, [s, schedule, day, from, to, max]); return s; };

  const adminSessions = await Promise.all(admins.map(async (a) => { const s = new Session(); await s.login(a.email); return s; }));
  const staffSessions = await Promise.all(staff.map(async (p) => { const s = new Session(); await s.login(p.email); return s; }));
  console.log(`Testorganisation angelegt (2 Admins, 10 Mitarbeitende, KW ${week.weekNumber}/${week.year}); ${rounds} Runden.`);

  // Vorpruefung ohne Parallelitaet: trennt allgemeine Fehler von Wettlauf-Fehlern.
  // CONCURRENCY_COLD_START=1 laesst sie aus: dann trifft der erste Ansturm direkt eine frisch gestartete App.
  const single = process.env.CONCURRENCY_COLD_START === "1" ? null : await shift(7, "20:00", "21:00", 1);
  if (single) {
  const t0 = Date.now();
  const one = await adminSessions[0].raw("/api/bookings", "POST", { shiftId: single, userId: staff[0].userId, confirm: true });
  check(one.status === 200, `Vorpruefung: einzelne Einteilung HTTP ${one.status} in ${Date.now() - t0} ms${one.status === 200 ? "" : " " + JSON.stringify(one.body).slice(0, 160)}`);
  if (one.status !== 200) throw new Error("Einzelne Einteilung scheitert – Parallelitaet nicht pruefbar.");
  }

  // Verbindungen der App waehrend der Parallelphasen mitschreiben.
  let maxConnections = 0, sampling = true;
  const mainPid = Number((await q(`SELECT pg_backend_pid() AS p`))[0].p);
  const probe = new Client({ connectionString: url });
  await probe.connect();
  const sampler = (async () => { while (sampling) { const n = Number((await probe.query(`SELECT count(*) AS n FROM pg_stat_activity WHERE datname = current_database() AND pid NOT IN (pg_backend_pid(), $1)`, [mainPid])).rows[0].n); maxConnections = Math.max(maxConnections, n); await new Promise((r) => setTimeout(r, 20)); } })();

  const stat = (rs: { status: number }[]) => rs.map((r) => r.status).sort().join(",");
  for (let round = 1; round <= rounds; round++) {
    const day = ((round - 1) % 7) + 1, h = String(6 + Math.floor((round - 1) / 7) * 6).padStart(2, "0");
    // A: letzter Platz – 10 Einteilungen gleichzeitig ueber zwei Admin-Sitzungen.
    const last = await shift(day, `${h}:00`, `${h}:30`, 1);
    const a = await Promise.all(staff.map((p, i) => adminSessions[i % 2].raw("/api/bookings", "POST", { shiftId: last, userId: p.userId, confirm: true })));
    const storedA = Number((await q(`SELECT count(*) AS n FROM bookings WHERE "shiftId" = $1`, [last]))[0].n);
    check(a.filter((r) => r.status === 200).length === 1 && a.every((r) => r.status === 200 || r.status === 409) && storedA === 1, `Runde ${round} letzter Platz: genau 1 Einteilung gespeichert (${stat(a)})`);

    // B: derselbe Platzhalter gleichzeitig in zwei ueberlappende Schichten.
    const left = await shift(day, `${h}:40`, `${h}:55`, 2), right = await shift(day, `${h}:45`, `${String(Number(h) + 1).padStart(2, "0")}:00`, 2);
    const b = await Promise.all([left, right].map((s, i) => adminSessions[i].raw("/api/contractor-bookings", "POST", { shiftId: s, contractorWorkerId: worker, confirm: true })));
    const storedB = Number((await q(`SELECT count(*) AS n FROM bookings WHERE "contractorWorkerId" = $1 AND "shiftId" IN ($2, $3)`, [worker, left, right]))[0].n);
    check(stat(b) === "200,409" && storedB === 1, `Runde ${round} Platzhalter-Ueberschneidung: genau 1 Einsatz gespeichert (${stat(b)})`);

    // C: Uebernahmeantrag, zwei Admins genehmigen gleichzeitig.
    const open = await shift(day, `${String(Number(h) + 2).padStart(2, "0")}:00`, `${String(Number(h) + 3).padStart(2, "0")}:00`, 1);
    const asker = staffSessions[round % staffSessions.length], askerId = staff[round % staff.length].userId;
    const created = await asker.raw("/api/mod-requests", "POST", { shiftId: open, kind: "TAKEOVER" });
    if (created.status !== 200) { check(false, `Runde ${round} Antrag anlegen: HTTP ${created.status} ${JSON.stringify(created.body).slice(0, 160)}`); continue; }
    const c = await Promise.all(adminSessions.map((s) => s.raw("/api/mod-requests/" + created.body.request.id, "PATCH", { state: "ACCEPTED", confirm: true })));
    const storedC = Number((await q(`SELECT count(*) AS n FROM bookings WHERE "shiftId" = $1 AND "userId" = $2`, [open, askerId]))[0].n);
    const state = (await q(`SELECT state FROM mod_requests WHERE id = $1`, [created.body.request.id]))[0].state;
    check(stat(c) === "200,409" && storedC === 1 && state === "ACCEPTED", `Runde ${round} doppelte Genehmigung: genau 1 Entscheidung, Antrag ${state} (${stat(c)})`);
  }
  sampling = false; await sampler; await probe.end();
  console.log(`Hoechstzahl gleichzeitiger Datenbankverbindungen (ohne Pruefverbindung): ${maxConnections}`);
  check(maxConnections > 1, "Parallelphase lief ueber mehrere Datenbankverbindungen");
  await db.end();
  console.log(failures ? `ERGEBNIS: ${failures} von ${checks} Pruefungen fehlgeschlagen.` : `ERGEBNIS: ${checks} von ${checks} Parallelitaetspruefungen bestanden.`);
  if (failures) process.exitCode = 1;
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exit(1); });
