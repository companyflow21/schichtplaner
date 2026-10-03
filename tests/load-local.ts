/*
 * Isolierter lokaler Belastungstest, niemals gegen .env-Datenbanken.
 * Voraussetzung: npm run build; danach npx tsx tests/load-local.ts.
 * --serve haelt dieselbe fluechtige Testinstallation fuer Browserpruefungen offen.
 *
 * PGlite und ein Pool mit einer Verbindung bilden weder den PostgreSQL-Server
 * noch Netzwerk, Proxy und Hardware des Betriebs ab. Dieser Lauf ist deshalb
 * nur ein lokaler Funktions-/Belastungsnachweis, keine Server-Kapazitaetsfreigabe.
 */
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, readFile, readdir, rm, rmdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";

const base = "http://127.0.0.1:3337";
const database = "postgresql://postgres:postgres@127.0.0.1:55447/postgres";
const organizationName = "AKRO Codex Lasttest";
const users = 100;
const serve = process.argv.includes("--serve");
const password = randomBytes(24).toString("base64url");
const secret = randomBytes(32).toString("hex");
const wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
const account = (n: number) => "load-user-" + String(n).padStart(3, "0") + "@akro-test.invalid";
const childEnv: NodeJS.ProcessEnv = {
  ...process.env,
  NODE_ENV: "production", PORT: "3337", DATABASE_URL: database,
  DATABASE_POOL_MAX: "1", DATABASE_LOG_QUERIES: "false",
  AUTH_SECRET: secret, AUTH_TRUST_HOST: "true", AUTH_URL: base, APP_URL: base,
  AI_ENABLED: "false", ALLOW_REGISTRATION: "false", PUSH_LOOP_DISABLED: "1",
  VAPID_PUBLIC_KEY: "", VAPID_PRIVATE_KEY: "", NEXT_TELEMETRY_DISABLED: "1",
  TZ: "Europe/Berlin", LOAD_BASE_URL: base, LOAD_USER_PASSWORD: password,
  LOAD_USER_PREFIX: "load-user-", LOAD_ORG_NAME: organizationName,
  LOAD_USERS: String(users), LOAD_SPIKE_USERS: "103", LOAD_WAVE_USERS: String(users),
  LOAD_ALLOW_WRITES: "false", LOAD_DURATION_MINUTES: "6",
};

async function stop(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const finished = once(child, "exit").catch(() => undefined);
  if (process.platform === "win32" && child.pid) {
    const killer = spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], { windowsHide: true, stdio: "ignore" });
    await Promise.race([once(killer, "exit").catch(() => undefined), wait(5000)]);
  } else {
    child.kill("SIGTERM");
  }
  await Promise.race([finished, wait(8000)]);
  if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
}

async function script(file: string, timeoutMs: number, env = childEnv): Promise<void> {
  const child = spawn(process.execPath, ["node_modules/tsx/dist/cli.mjs", file], {
    env, cwd: process.cwd(), windowsHide: true, stdio: ["ignore", "pipe", "inherit"],
  });
  let output = "";
  child.stdout?.on("data", (chunk: Buffer) => {
    process.stdout.write(chunk);
    output = (output + chunk.toString()).slice(-12000);
  });
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; void stop(child); }, timeoutMs);
  try {
    const [code] = await once(child, "close");
    assert.ok(!timedOut, file + ": Zeitlimit erreicht");
    assert.equal(code, 0, file + ": fehlgeschlagen");
    if (file === "tests/login-wave.ts" || file === "tests/load-pilot.ts") {
      assert.ok(/(?:^|\n)Ergebnis: BESTANDEN(?:\r?\n|$)/.test(output), file + ": vollstaendiger Erfolgsbericht fehlt");
    }
  } finally {
    clearTimeout(timer);
    await stop(child);
  }
}

class Session {
  private cookies = new Map<string, string>();
  private cookie() { return [...this.cookies].map(([key, value]) => key + "=" + value).join("; "); }
  private remember(response: Response) {
    for (const cookie of response.headers.getSetCookie()) {
      const pair = cookie.split(";")[0], index = pair.indexOf("=");
      if (index > 0) this.cookies.set(pair.slice(0, index), pair.slice(index + 1));
    }
  }
  async request(path: string, method = "GET", data?: unknown) {
    const response = await fetch(base + path, {
      method, redirect: "manual", signal: AbortSignal.timeout(120_000),
      headers: { Cookie: this.cookie(), "Content-Type": "application/json" },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    });
    this.remember(response);
    assert.equal(response.status, 200, method + " " + path + ": HTTP " + response.status);
    return response.json();
  }
  async login(email: string) {
    const csrf = await this.request("/api/auth/csrf");
    const response = await fetch(base + "/api/auth/callback/credentials", {
      method: "POST", redirect: "manual", signal: AbortSignal.timeout(120_000),
      headers: { Cookie: this.cookie(), "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ csrfToken: csrf.csrfToken, email, password, callbackUrl: base + "/dashboard" }),
    });
    this.remember(response);
    assert.equal((await this.request("/api/auth/session")).user?.email, email, "Anmeldung fuer Schreibtest");
  }
}

async function main() {
  // Keine Zieladresse als Parameter: die Datenbank wird ausschliesslich hier erzeugt.
  await readFile(".next/BUILD_ID", "utf8");
  console.log("LOKALER TEST: 100 Konten, PGlite in RAM; kein Nachweis fuer den echten Server.");
  const sql = new PGlite();
  const socket = new PGLiteSocketServer({ db: sql, host: "127.0.0.1", port: 55447 });
  let server: ChildProcess | undefined;
  let credentialsDir: string | undefined;
  let socketStarted = false;
  const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: database, max: 1 }) });
  try {
    for (const migration of (await readdir("prisma/migrations")).filter(name => /^\d/.test(name)).sort()) {
      await sql.exec(await readFile(join("prisma/migrations", migration, "migration.sql"), "utf8"));
    }
    await socket.start();
    socketStarted = true;
    const organization = await client.organization.create({ data: { name: organizationName } });
    const owner = await client.user.create({
      data: { email: "admin@akro-test.invalid", firstName: "Admin", lastName: "Lasttest", passwordHash: await bcrypt.hash(password, 12) },
    });
    await client.organizationMember.create({
      data: { organizationId: organization.id, userId: owner.id, role: "OWNER", isActivated: true },
    });
    await client.$disconnect();
    await script("tests/seed-load-pilot.ts", 180_000);
    // Booking.user ist seit den Subunternehmer-/Loeschaenderungen optional.
    const targets = (await client.booking.findMany({
      where: { user: { email: { in: Array.from({ length: users }, (_, i) => account(i + 1)) } } },
      select: { id: true, shiftId: true, user: { select: { email: true } } },
    })).flatMap(target => target.user ? [{ id: target.id, shiftId: target.shiftId, email: target.user.email }] : []);
    assert.equal(targets.length, users, "genau eine synthetische Buchung je Testkonto");
    assert.equal(new Set(targets.map(target => target.email)).size, users, "100 unterschiedliche Testkonten");
    await client.$disconnect();

    let serverLog = "";
    server = spawn(process.execPath, ["node_modules/tsx/dist/cli.mjs", "tests/load-local-server.ts"], {
      env: childEnv, cwd: process.cwd(), windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
    });
    const remember = (chunk: Buffer) => { serverLog = (serverLog + chunk.toString()).slice(-12000); };
    server.stdout?.on("data", remember);
    server.stderr?.on("data", remember);
    server.on("error", rememberError);
    function rememberError(error: Error) { serverLog += error.message; }

    let ready = false;
    for (let attempt = 0; attempt < 120; attempt++) {
      if (server.exitCode !== null) break;
      try {
        if ((await fetch(base + "/api/health", { signal: AbortSignal.timeout(1500) })).ok) { ready = true; break; }
      } catch { /* Start noch nicht beendet. */ }
      await wait(500);
    }
    assert.ok(ready, "Lokaler Produktionsserver startet. " + serverLog.replaceAll(password, "[TESTPASSWORT]").replaceAll(secret, "[TESTSCHLUESSEL]"));

    if (serve) {
      credentialsDir = await mkdtemp(join(tmpdir(), "akro-codex-test-"));
      const credentialsFile = join(credentialsDir, "credentials.json");
      await writeFile(credentialsFile, JSON.stringify({
        base, adminEmail: owner.email, employeeEmail: account(users), password,
        note: "Nur synthetische lokale Testkonten. Datei wird beim Beenden geloescht.",
      }), { mode: 0o600 });
      console.log("Browser-Testinstallation: " + base);
      console.log("Kurzfristige Testzugangsdatei: " + credentialsFile);
      console.log("Zum Beenden Strg+C; danach verschwinden Daten und Zugangsdatei.");
      await new Promise<void>(resolve => {
        process.once("SIGINT", resolve); process.once("SIGTERM", resolve);
        server?.once("exit", resolve);
      });
      return;
    }

    await script("tests/login-wave.ts", 300_000);
    await script("tests/load-pilot.ts", 720_000, { ...childEnv, LOAD_SPIKE_USERS: String(users) });
    console.log("\nSchreibpruefung: 100 eigene Buchungen gleichzeitig bestaetigen.");
    const sessions = targets.map(() => new Session());
    // Die Anmeldewelle wurde bereits separat geprueft; hier Anmeldung mit 10 Arbeitern.
    let next = 0;
    await Promise.all(Array.from({ length: 10 }, async () => {
      while (next < targets.length) {
        const index = next++;
        await sessions[index].login(targets[index].email);
      }
    }));
    const start = performance.now();
    const results = await Promise.allSettled(targets.map(async (target, index) => {
      const started = performance.now();
      const result = await sessions[index].request("/api/bookings", "PATCH", { shiftId: target.shiftId });
      assert.equal(result.booking?.id, target.id, "eigene Buchung bestaetigt");
      assert.ok(result.booking?.confirmedAt, "API liefert Bestaetigungszeit");
      return performance.now() - started;
    }));
    const elapsed = performance.now() - start;
    const durations = results.flatMap(result => result.status === "fulfilled" ? [result.value] : []).sort((a, b) => a - b);
    console.log("Bestätigungen erfolgreich: " + durations.length + "/100; Gesamt " + Math.round(elapsed) + " ms; p95 " + Math.round(durations[Math.ceil(durations.length * 0.95) - 1] ?? 0) + " ms.");
    assert.equal(durations.length, users, "alle 100 gleichzeitigen Bestaetigungen erfolgreich");
    const persisted = await sql.query<{ count: number }>(
      'SELECT count(*)::int AS count FROM bookings WHERE "confirmedAt" IS NOT NULL'
    );
    assert.equal(persisted.rows[0].count, users, "100 Bestaetigungen dauerhaft in der fluechtigen Datenbank");
    assert.ok(durations[Math.ceil(users * 0.95) - 1] < 1500, "Bestaetigung p95 unter 1500 ms");
    console.log("Lokaler Lauf bestanden. PostgreSQL-/Server-/Netzwerk-/Langzeitnachweis weiterhin offen.");
  } finally {
    await client.$disconnect();
    const cleanupError = (reason: unknown) => {
      const code = (reason as NodeJS.ErrnoException | null)?.code;
      if (code === "ECONNRESET" || code === "EPIPE" || code === "ECONNABORTED") return;
      console.error("Fehler beim Testabbau:", reason);
      process.exitCode = 1;
    };
    process.on("unhandledRejection", cleanupError);
    try {
      if (socketStarted) await Promise.race([socket.stop(), wait(5000)]);
      if (server) await stop(server);
      await sql.close();
      if (credentialsDir) {
        await rm(join(credentialsDir, "credentials.json"), { force: true });
        await rmdir(credentialsDir);
      }
    } finally {
      process.off("unhandledRejection", cleanupError);
    }
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });

