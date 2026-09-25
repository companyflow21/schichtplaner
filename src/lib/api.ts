import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { getCurrentMember } from "./auth-helpers";
import { db, isSerializationFailure } from "./db";
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
    // Auch nach allen Wiederholungen noch ein Konflikt: vorübergehend, kein Serverfehler.
    if (isSerializationFailure(error)) return NextResponse.json({ error: "Gleichzeitige Änderung, bitte erneut versuchen." }, { status: 409 });
    if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2002", "P2034"].includes(error.code)) return NextResponse.json({ error: "Der Eintrag wurde inzwischen geändert oder existiert bereits. Bitte neu laden." }, { status: 409 });
    console.error("API error", error);
    return NextResponse.json({ error: "Speichern oder Laden fehlgeschlagen. Bitte erneut versuchen." }, { status: 500 });
  }
}
/** SERIALIZABLE-Transaktion; Serialisierungskonflikte wiederholt der Datenbank-Client (src/lib/db.ts). */
export function serial<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return db.$transaction(work, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 20000 });
}
export const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Zeit bitte als HH:mm eingeben.");
