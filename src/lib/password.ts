/**
 * Passwortpruefung ausserhalb des Haupt-Threads.
 *
 * bcryptjs rechnet in reinem JavaScript. Auf dem Haupt-Thread blockiert jede
 * Pruefung mit Kostenfaktor 12 alle anderen Anfragen; bei einer Anmeldewelle
 * summiert sich das zu Sekunden. Hier laeuft dieselbe Bibliothek in einem
 * kleinen Pool von Worker-Threads: gleiche Hashes, gleiches Ergebnis, kein
 * neues Paket. Der Pool entsteht erst bei der ersten Pruefung.
 */
import bcrypt from "bcryptjs";
import { availableParallelism } from "node:os";
import { Worker } from "node:worker_threads";

// Als Quelltext (eval), damit der Next.js-Bundler den Worker nicht anfasst;
// bcryptjs wird zur Laufzeit aus node_modules des Arbeitsverzeichnisses geladen.
const CODE = `
const { parentPort } = require("node:worker_threads");
const loaded = require("node:module").createRequire(process.cwd() + "/package.json")("bcryptjs");
const bcrypt = loaded.compareSync ? loaded : loaded.default;
parentPort.on("message", ({ id, password, hash }) => {
  try { parentPort.postMessage({ id, ok: bcrypt.compareSync(password, hash) }); }
  catch (error) { parentPort.postMessage({ id, error: String((error && error.message) || error) }); }
});`;

// Ein Kern bleibt fuer Anfragen, Datenbank und Proxy frei.
const SIZE = Math.max(1, Math.min(4, availableParallelism() - 1));

type Job = { resolve: (ok: boolean) => void; reject: (error: Error) => void };
type Slot = { worker: Worker; jobs: Map<number, Job> };

let pool: Slot[] | null = null;
let nextId = 0;

function start(): Slot {
  const slot: Slot = { worker: new Worker(CODE, { eval: true }), jobs: new Map() };
  slot.worker.unref();
  slot.worker.on("message", ({ id, ok, error }: { id: number; ok?: boolean; error?: string }) => {
    const job = slot.jobs.get(id);
    if (!job) return;
    slot.jobs.delete(id);
    if (error !== undefined) job.reject(new Error(error));
    else job.resolve(ok === true);
  });
  // Stirbt ein Worker, scheitern nur seine offenen Pruefungen; er wird ersetzt.
  let failed = false;
  const fail = (error: Error) => {
    if (failed) return;
    failed = true;
    for (const job of slot.jobs.values()) job.reject(error);
    slot.jobs.clear();
    const index = pool?.indexOf(slot) ?? -1;
    if (pool && index >= 0) pool[index] = start();
  };
  slot.worker.once("error", fail);
  slot.worker.once("exit", (code) => { if (code !== 0) fail(new Error("Passwort-Worker beendet (" + code + ")")); });
  return slot;
}

/** Vergleicht ein Passwort mit einem bcrypt-Hash, ohne den Haupt-Thread zu blockieren. */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  try {
    pool ??= Array.from({ length: SIZE }, start);
  } catch (error) {
    // Ohne Worker weiter wie bisher, nur langsamer - die Anmeldung faellt nicht aus.
    console.warn("Passwort-Worker nicht verfuegbar, Pruefung im Haupt-Thread:", error);
    return bcrypt.compare(password, hash);
  }
  const slot = pool.reduce((a, b) => (b.jobs.size < a.jobs.size ? b : a));
  const id = ++nextId;
  return new Promise<boolean>((resolve, reject) => {
    slot.jobs.set(id, { resolve, reject });
    slot.worker.postMessage({ id, password, hash });
  });
}
