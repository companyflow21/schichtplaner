/*
 * Transaktionshelfer serial(): Wiederholung nur bei SQLSTATE 40001 oder P2034
 * (roher DriverAdapterError beim COMMIT oder Prisma mit/ohne Adapterfehler), 409
 * nach ausgeschoepften Versuchen, keine Wiederholung bei anderen Fehlern.
 * Ohne Datenbank: $transaction wird nachgebildet.
 *
 *   npx tsx tests/serial-retry.ts
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from "node:assert/strict";
import { Prisma } from "@prisma/client";

let checks = 0;
function check(value: unknown, message: string) { assert.ok(value, message); checks++; console.log("PASS: " + message); }

const adapterError = (code: string) => Object.assign(new Error("adapter"), { name: "DriverAdapterError", cause: { originalCode: code } });
const p2034 = (code: string) => new Prisma.PrismaClientKnownRequestError("conflict", { code: "P2034", clientVersion: "test", meta: { driverAdapterError: adapterError(code) } });
const plainP2034 = () => new Prisma.PrismaClientKnownRequestError("conflict", { code: "P2034", clientVersion: "test" });

let attempts = 0;
let script: (attempt: number) => unknown = () => "ok";
const fakeDb = { $transaction: async (_work: (tx: any) => Promise<unknown>) => { void _work; attempts++; return script(attempts); } };
(globalThis as any).prisma = fakeDb;

async function main() {
  // Retry-Jitter auslassen; Verhalten und Versuchszahl bleiben gleich.
  const random = Math.random;
  Math.random = () => 0;
  try {
  const { serial, api, ApiError } = await import("../src/lib/api");
  const run = async (plan: (attempt: number) => unknown, retry = true) => { attempts = 0; script = plan; return serial(async () => "unused", { retry }); };

  check(await run((n) => { if (n < 3) throw adapterError("40001"); return "gespeichert"; }) === "gespeichert" && attempts === 3, "raw DriverAdapterError 40001 (COMMIT) is retried until success");
  check(await run((n) => { if (n < 2) throw p2034("40001"); return "gespeichert"; }) === "gespeichert" && attempts === 2, "P2034 carrying adapter code 40001 is retried");
  check(await run((n) => { if (n < 2) throw plainP2034(); return "gespeichert"; }) === "gespeichert" && attempts === 2, "Prisma P2034 without adapter metadata is retried");

  let exhausted: unknown;
  try { await run(() => { throw adapterError("40001"); }); } catch (error) { exhausted = error; }
  check(exhausted instanceof ApiError && (exhausted as any).status === 409 && attempts === 7, "after 7 attempts the helper answers 409");
  attempts = 0; script = () => { throw adapterError("40001"); };
  const response = await api(() => serial(async () => "unused", { retry: true }));
  check(response.status === 409 && (await response.json()).error.includes("Gleichzeitige"), "api() turns exhausted retries into HTTP 409");

  for (const [label, error] of [["raw adapter 40001", adapterError("40001")], ["Prisma P2034", plainP2034()]] as const) {
    const res = await api(async () => { throw error; });
    check(res.status === 409 && typeof (await res.json()).error === "string", "api() maps " + label + " to HTTP 409 even without a retrying caller");
  }
  const originalErrorLog = console.error;
  let logged = 0;
  console.error = () => { logged++; };
  try {
    const res = await api(async () => { throw new Error("unrelated application failure"); });
    check(res.status === 500 && logged === 1, "api() preserves unrelated errors as logged HTTP 500 instead of masking them as a conflict");
  } finally { console.error = originalErrorLog; }

  for (const [label, error] of [["deadlock 40P01", adapterError("40P01")], ["unique violation 23505", adapterError("23505")], ["business error (ApiError)", new ApiError("Schicht ist bereits besetzt.", 409)], ["plain error", new Error("x")]] as const) {
    let thrown: unknown;
    try { await run(() => { throw error; }); } catch (e) { thrown = e; }
    check(thrown === error && attempts === 1, label + " is not retried");
  }
  let without: unknown;
  try { await run(() => { throw adapterError("40001"); }, false); } catch (e) { without = e; }
  check(attempts === 1 && (without as any).name === "DriverAdapterError", "without retry option a conflict is passed on unchanged");

  // COMMIT scheitert nach abgeschlossenem Callback: naechster Versuch bekommt
  // eine neue Transaktion. Die eigene Testtransaktion macht Writes erst beim
  // erfolgreichen Commit sichtbar; reale DB-Endzustaende prueft postgres-concurrency.ts.
  const originalTransaction = fakeDb.$transaction;
  const committed: { bookings: string[]; messages: string[] } = { bookings: [], messages: [] };
  let callbacks = 0;
  attempts = 0;
  fakeDb.$transaction = async work => {
    attempts++;
    const pending = { bookings: [] as string[], messages: [] as string[] };
    const result = await work(pending);
    if (attempts === 1) throw adapterError("40001");
    committed.bookings.push(...pending.bookings);
    committed.messages.push(...pending.messages);
    return result;
  };
  try {
    const result = await serial(async tx => {
      callbacks++;
      const pending = tx as unknown as typeof committed;
      pending.bookings.push("assignment");
      pending.messages.push("assignment notification");
      return "committed";
    }, { retry: true });
    check(result === "committed" && attempts === 2 && callbacks === 2, "commit-time failure reruns the completed callback in a fresh transaction");
    check(committed.bookings.length === 1 && committed.messages.length === 1, "only successful transaction writes survive the commit retry (one assignment and one notification)");
  } finally { fakeDb.$transaction = originalTransaction; }
  console.log("SUCCESS: " + checks + " serial() checks passed.");
  } finally { Math.random = random; }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
