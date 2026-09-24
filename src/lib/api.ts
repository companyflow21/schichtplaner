import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { getCurrentMember } from "./auth-helpers";
import { db } from "./db";
import { ApiError } from "./errors";

export { ApiError };
export async function requireMember() {
  const member = await getCurrentMember();
  if (!member) throw new ApiError("Bitte erneut anmelden.", 401);
  return member;
}
export async function body<T extends z.ZodType>(request: Request, schema: T): Promise<z.output<T>> {
  let input: unknown;
  try { input = await request.json(); } catch { throw new ApiError("Ungültige Anfrage."); }
  return schema.parse(input);
}
export async function api(work: () => Promise<unknown>) {
  try {
    const result = await work();
    return result instanceof Response ? result : NextResponse.json(result);
  } catch (error) {
    if (error instanceof ApiError) return NextResponse.json({ ...error.details, error: error.message }, { status: error.status });
    if (error instanceof z.ZodError) return NextResponse.json({ error: error.issues.map(i => i.message).join("; ") }, { status: 400 });
    if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2002", "P2034"].includes(error.code)) return NextResponse.json({ error: "Der Eintrag wurde inzwischen geändert oder existiert bereits. Bitte neu laden." }, { status: 409 });
    console.error("API error", error);
    return NextResponse.json({ error: "Speichern oder Laden fehlgeschlagen. Bitte erneut versuchen." }, { status: 500 });
  }
}
/**
 * Vorübergehender Serialisierungskonflikt (SQLSTATE 40001): PostgreSQL hat
 * die ganze Transaktion zurückgerollt, ein neuer Versuch ist daher sicher.
 * Prisma meldet ihn als P2034 oder, beim COMMIT, als rohen Adapterfehler.
 * Deadlocks, fachliche Sperren (ApiError) und alle anderen Fehler zählen nicht.
 */
function isSerializationFailure(error: unknown): boolean {
  const adapter = error instanceof Prisma.PrismaClientKnownRequestError ? error.meta?.driverAdapterError : error;
  const e = adapter as { name?: unknown; cause?: { originalCode?: unknown } } | null | undefined;
  return e?.name === "DriverAdapterError" && e.cause?.originalCode === "40001";
}
const SERIAL_ATTEMPTS = 7;

/**
 * SERIALIZABLE-Transaktion. Mit retry wird sie bei einem Serialisierungs-
 * konflikt höchstens SERIAL_ATTEMPTS-mal vollständig neu ausgeführt; work muss
 * dann frei von Nebenwirkungen außerhalb von tx sein (Socket-Signale erst danach).
 * Die Pausen wachsen exponentiell mit Zufallsanteil (zusammen höchstens ~3 s),
 * damit gleichzeitige Versuche nicht erneut aufeinandertreffen.
 */
export async function serial<T>(work: (tx: Prisma.TransactionClient) => Promise<T>, options: { retry?: boolean } = {}): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await db.$transaction(work, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 20000 });
    } catch (error) {
      if (!options.retry || !isSerializationFailure(error)) throw error;
      if (attempt >= SERIAL_ATTEMPTS) {
        console.warn("Serialisierungskonflikt nach " + attempt + " Versuchen");
        throw new ApiError("Gleichzeitige Änderung, bitte erneut versuchen.", 409);
      }
      await new Promise(resolve => setTimeout(resolve, Math.random() * 25 * 2 ** attempt));
    }
  }
}
export const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Zeit bitte als HH:mm eingeben.");
