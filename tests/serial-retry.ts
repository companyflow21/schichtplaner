/*
 * Transaktionshelfer serial(): Wiederholung nur bei SQLSTATE 40001 - als
 * roher DriverAdapterError (COMMIT) oder als P2034 mit Adapterfehler -, 409
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

let attempts = 0;
let script: (attempt: number) => unknown = () => "ok";
(globalThis as any).prisma = { $transaction: async () => { attempts++; return script(attempts); } };

async function main() {
  const { serial, api, ApiError } = await import("../src/lib/api");
  const run = async (plan: (attempt: number) => unknown, retry = true) => { attempts = 0; script = plan; return serial(async () => "unused", { retry }); };

  check(await run((n) => { if (n < 3) throw adapterError("40001"); return "gespeichert"; }) === "gespeichert" && attempts === 3, "raw DriverAdapterError 40001 (COMMIT) is retried until success");
  check(await run((n) => { if (n < 2) throw p2034("40001"); return "gespeichert"; }) === "gespeichert" && attempts === 2, "P2034 carrying adapter code 40001 is retried");

  let exhausted: unknown;
  try { await run(() => { throw adapterError("40001"); }); } catch (error) { exhausted = error; }
  check(exhausted instanceof ApiError && (exhausted as any).status === 409 && attempts === 7, "after 7 attempts the helper answers 409");
  attempts = 0; script = () => { throw adapterError("40001"); };
  const response = await api(() => serial(async () => "unused", { retry: true }));
  check(response.status === 409 && (await response.json()).error.includes("Gleichzeitige"), "api() turns exhausted retries into HTTP 409");

  for (const [label, error] of [["deadlock 40P01", adapterError("40P01")], ["unique violation 23505", adapterError("23505")], ["business error (ApiError)", new ApiError("Schicht ist bereits besetzt.", 409)], ["plain error", new Error("x")]] as const) {
    let thrown: unknown;
    try { await run(() => { throw error; }); } catch (e) { thrown = e; }
    check(thrown === error && attempts === 1, label + " is not retried");
  }
  let without: unknown;
  try { await run(() => { throw adapterError("40001"); }, false); } catch (e) { without = e; }
  check(attempts === 1 && (without as any).name === "DriverAdapterError", "without retry option a conflict is passed on unchanged");
  console.log("SUCCESS: " + checks + " serial() checks passed.");
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
