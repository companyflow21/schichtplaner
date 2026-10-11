/*
 * Gezielter Kopievergleich fuer die Migrationen
 *   20261001090000_employee_delete_history_confirmation und
 *   20261001120000_subcontractors
 * (tests/migration-copy.ts gilt nur fuer die aeltere Standortmigration).
 *
 * Laeuft nur gegen eine Datenbank, deren Name "copy", "kopie" oder "migtest"
 * enthaelt. Gibt keine Zugangsdaten und keine Inhalte aus, nur Zeilenzahlen,
 * Hashwerte und Pruefergebnisse. Ablage der Vergleichsdatei ausserhalb des Repositorys.
 *
 *   DATABASE_URL=… npx tsx tests/migration-copy-current.ts snapshot <datei.json>
 *   npx tsx tests/migration-copy-current.ts vergleich <quelle.json> <kopie.json>
 *   DATABASE_URL=… npx tsx tests/migration-copy-current.ts vorher <datei.json>
 *   (prisma migrate deploy gegen dieselbe Kopie)
 *   DATABASE_URL=… npx tsx tests/migration-copy-current.ts nachher <datei.json>
 *
 *   Rein ergaenzende Migration (neue Spalten): vor dem Einspielen "snapshot" der Kopie, danach
 *   DATABASE_URL=… npx tsx tests/migration-copy-current.ts additiv <snapshot.json> branches.holidayState …
 *   (alle Bestandsspalten unveraendert, genannte neue Spalten ueberall NULL).
 *
 * "snapshot" darf auch die Quelle lesen (nur lesend); vorher/nachher/additiv nur Kopien.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { Client } from "pg";

type TableState = { columns: string[]; rows: number; hash: string };
type Snapshot = { tables: Record<string, TableState>; bookings?: Record<string, { confirmation: string | null; confirmedAt: string | null }> };

const [mode, fileA, fileB] = process.argv.slice(2);
const NEW_MIGRATIONS = ["20261001090000_employee_delete_history_confirmation", "20261001120000_subcontractors"];
const NEW_TABLES = ["former_employees", "subcontractors", "contractor_workers"];
let failures = 0;
function check(ok: boolean, message: string) { console.log((ok ? "PASS: " : "FEHLER: ") + message); if (!ok) failures++; }

async function connect(requireCopy: boolean): Promise<Client> {
  const url = process.env.DATABASE_URL ?? "";
  const name = decodeURIComponent(new URL(url || "postgresql://x/none").pathname.slice(1));
  if (!url) throw new Error("DATABASE_URL fehlt.");
  if (requireCopy && !/(copy|kopie|migtest)/i.test(name)) throw new Error("Abbruch: nur gegen eine Kopie (Datenbankname mit copy, kopie oder migtest).");
  const client = new Client({ connectionString: url });
  await client.connect();
  return client;
}

async function columnsOf(db: Client, table: string): Promise<string[]> {
  return (await db.query(`SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 ORDER BY column_name`, [table])).rows.map((r) => r.column_name);
}

/** Reihenfolgeunabhaengiger Hash ueber die genannten Spalten (jsonb normalisiert Werte). */
async function tableState(db: Client, table: string, columns: string[], exclude: string[] = []): Promise<TableState> {
  const all = await columnsOf(db, table);
  const drop = all.filter((c) => !columns.includes(c) || exclude.includes(c));
  const minus = drop.length ? " - ARRAY[" + drop.map((c) => "'" + c.replace(/'/g, "''") + "'").join(",") + "]::text[]" : "";
  const r = (await db.query(`SELECT count(*)::int AS n, coalesce(md5(string_agg(h, '' ORDER BY h)), '') AS hash FROM (SELECT md5((to_jsonb(t)${minus})::text) AS h FROM "${table}" t) s`)).rows[0];
  return { columns: columns.filter((c) => !exclude.includes(c)), rows: r.n, hash: r.hash };
}

async function tables(db: Client): Promise<string[]> {
  return (await db.query(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name <> '_prisma_migrations' ORDER BY 1`)).rows.map((r) => r.table_name);
}

async function snapshot(db: Client, exclude: Record<string, string[]> = {}): Promise<Snapshot> {
  const out: Snapshot = { tables: {} };
  for (const t of await tables(db)) out.tables[t] = await tableState(db, t, await columnsOf(db, t), exclude[t]);
  return out;
}

const iso = (v: Date | null) => (v ? new Date(v).toISOString() : null);

async function main() {
  if (mode === "snapshot") {
    const db = await connect(false);
    const s = await snapshot(db);
    writeFileSync(fileA, JSON.stringify(s));
    console.log("Snapshot: " + Object.keys(s.tables).length + " Tabellen, " + Object.values(s.tables).reduce((a, t) => a + t.rows, 0) + " Zeilen.");
    await db.end();
  } else if (mode === "vergleich") {
    const a: Snapshot = JSON.parse(readFileSync(fileA, "utf8")), b: Snapshot = JSON.parse(readFileSync(fileB, "utf8"));
    check(Object.keys(a.tables).join() === Object.keys(b.tables).join(), "gleiche Tabellen (" + Object.keys(a.tables).length + ")");
    for (const [t, s] of Object.entries(a.tables)) check(b.tables[t]?.rows === s.rows && b.tables[t]?.hash === s.hash, t + ": " + s.rows + " Zeilen, Hash gleich");
  } else if (mode === "vorher") {
    const db = await connect(true);
    if ((await columnsOf(db, "bookings")).includes("confirmation")) throw new Error("Die Kopie ist bereits migriert. Bitte eine frische Kopie verwenden.");
    // confirmedAt aendert sich erwartungsgemaess; es wird gesondert gegen den Erwartungswert geprueft.
    const s = await snapshot(db, { bookings: ["confirmedAt"] });
    s.bookings = {};
    for (const b of (await db.query(`SELECT id, "userId", "bookedBy", "bookedAt", "confirmedAt" FROM bookings`)).rows) {
      s.bookings[b.id] = b.confirmedAt ? { confirmation: "EMPLOYEE", confirmedAt: iso(b.confirmedAt) }
        : b.bookedBy && b.bookedBy !== b.userId ? { confirmation: "PLANNER", confirmedAt: iso(b.bookedAt) }
        : { confirmation: null, confirmedAt: null };
    }
    writeFileSync(fileA, JSON.stringify(s));
    const counts = Object.values(s.bookings).reduce((m, e) => { const k = e.confirmation ?? "leer"; m[k] = (m[k] ?? 0) + 1; return m; }, {} as Record<string, number>);
    console.log("Vorher: " + Object.keys(s.tables).length + " Tabellen; erwartete Bestaetigungen " + JSON.stringify(counts));
    await db.end();
  } else if (mode === "nachher") {
    const db = await connect(true);
    const before: Snapshot = JSON.parse(readFileSync(fileA, "utf8"));
    const applied = (await db.query(`SELECT migration_name, finished_at IS NOT NULL AS done, rolled_back_at IS NOT NULL AS back FROM _prisma_migrations`)).rows;
    for (const m of NEW_MIGRATIONS) check(applied.some((r) => r.migration_name === m && r.done && !r.back), "Migration " + m + " abgeschlossen");
    check(!applied.some((r) => !r.done || r.back), "keine offene oder zurueckgerollte Migration");
    for (const [t, s] of Object.entries(before.tables)) {
      const now = await tableState(db, t, s.columns);
      check(now.rows === s.rows && now.hash === s.hash, t + ": " + s.rows + " Zeilen, Bestandsspalten unveraendert");
    }
    const rows = (await db.query(`SELECT id, confirmation, "confirmedAt", "formerEmployeeId", "contractorWorkerId", num_nonnulls("userId", "formerEmployeeId", "contractorWorkerId") AS persons FROM bookings`)).rows;
    const wrong = rows.filter((r) => { const e = before.bookings![r.id]; return !e || e.confirmation !== r.confirmation || e.confirmedAt !== iso(r.confirmedAt); });
    check(wrong.length === 0 && rows.length === Object.keys(before.bookings!).length, "Bestaetigungsherkunft exakt wie berechnet (" + rows.length + " Buchungen, Abweichungen " + wrong.length + ")");
    check(rows.every((r) => r.formerEmployeeId === null && r.contractorWorkerId === null), "keine erfundenen Historien- oder Subunternehmer-Zuordnungen");
    check(rows.every((r) => r.persons === 1), "genau eine Personenreferenz je Buchung");
    for (const t of ["time_records", "checkins"]) {
      const bad = (await db.query(`SELECT count(*)::int AS n FROM "${t}" WHERE "formerEmployeeId" IS NOT NULL OR "userId" IS NULL`)).rows[0].n;
      check(bad === 0, t + ": alle Eintraege behalten ihr Konto");
    }
    for (const t of NEW_TABLES) {
      if (before.tables[t]) continue;
      const n = (await db.query(`SELECT count(*)::int AS n FROM "${t}"`)).rows[0].n;
      check(n === 0, t + ": neu und leer");
    }
    const orphans = (await db.query(`SELECT
      (SELECT count(*) FROM shifts s LEFT JOIN schedules p ON p.id = s."scheduleId" WHERE p.id IS NULL)
      + (SELECT count(*) FROM bookings b LEFT JOIN shifts s ON s.id = b."shiftId" WHERE s.id IS NULL)
      + (SELECT count(*) FROM bookings b LEFT JOIN users u ON u.id = b."userId" WHERE b."userId" IS NOT NULL AND u.id IS NULL) AS n`)).rows[0].n;
    check(Number(orphans) === 0, "keine verwaisten Schicht- oder Personenbezuege");
    await db.end();
    console.log(failures ? "ERGEBNIS: " + failures + " Fehler." : "ERGEBNIS: Kopiemigration bestanden.");
  } else if (mode === "additiv") {
    const db = await connect(true);
    const before: Snapshot = JSON.parse(readFileSync(fileA, "utf8"));
    const applied = (await db.query(`SELECT migration_name, finished_at IS NOT NULL AS done, rolled_back_at IS NOT NULL AS back FROM _prisma_migrations`)).rows;
    check(applied.length > 0 && !applied.some((r) => !r.done || r.back), "alle Migrationen abgeschlossen, keine offen oder zurueckgerollt (" + applied.length + ")");
    check(Object.keys(before.tables).join() === (await tables(db)).filter((t) => before.tables[t]).join(), "keine Tabelle entfernt");
    for (const [t, st] of Object.entries(before.tables)) {
      const now = await tableState(db, t, st.columns);
      check(now.rows === st.rows && now.hash === st.hash, t + ": " + st.rows + " Zeilen, Bestandsspalten unveraendert");
    }
    for (const spec of process.argv.slice(4)) {
      const [t, c] = spec.split(".");
      const n = (await db.query(`SELECT count(*)::int AS n FROM "${t.replace(/"/g, "")}" WHERE "${c.replace(/"/g, "")}" IS NOT NULL`)).rows[0].n;
      check(n === 0, spec + ": neu und ueberall leer");
    }
    await db.end();
    console.log(failures ? "ERGEBNIS: " + failures + " Fehler." : "ERGEBNIS: ergaenzende Migration auf der Kopie bestanden.");
  } else {
    throw new Error("Unbekannter Modus. Erlaubt: snapshot, vergleich, vorher, nachher, additiv.");
  }
  if (failures) process.exitCode = 1;
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exit(1); });
