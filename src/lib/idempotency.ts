/**
 * Idempotency-Key fuer Schreibanfragen (derzeit POST /api/bookings).
 *
 * Der Client schickt je Aktion eine UUIDv4 im Header "Idempotency-Key" und
 * wiederholt sie bei erneutem Senden. Das Ergebnis der ersten Ausfuehrung
 * wird gespeichert - ein Erfolg in derselben Transaktion wie die Aktion,
 * eine endgueltige fachliche Ablehnung (409) danach. Wiederholungen erhalten
 * diese Antwort, ohne die Aktion erneut auszufuehren. Ohne Header bleibt
 * alles wie bisher.
 */
import { z } from "zod";
import type { IdempotencyKey, Prisma } from "@prisma/client";
import { db } from "./db";
import { ApiError } from "./errors";

type Tx = Prisma.TransactionClient;

/** Gueltigkeit eines Keys. */
const TTL_MS = 24 * 60 * 60 * 1000;
const headerSchema = z.uuidv4("Idempotency-Key muss eine UUID (Version 4) sein.");

/** Ein Key im Rahmen einer Person, eines Endpunkts und einer konkreten Anfrage. */
export type IdempotencyScope = { organizationId: string; userId: string; scope: string; key: string; fingerprint: string };

/** Optionaler Header "Idempotency-Key"; ein ungueltiger Wert ergibt 400. */
export function idempotencyKeyHeader(request: Request): string | null {
  const value = request.headers.get("idempotency-key");
  return value === null ? null : headerSchema.parse(value.trim()).toLowerCase();
}

/**
 * Frueheres Ergebnis zu diesem Key oder null. Derselbe Key fuer eine andere
 * Anfrage (anderer fingerprint) ergibt 422; ein abgelaufener wird geloescht.
 */
export async function storedResponse(tx: Tx, s: IdempotencyScope): Promise<IdempotencyKey | null> {
  const found = await tx.idempotencyKey.findUnique({ where: { userId_scope_key: { userId: s.userId, scope: s.scope, key: s.key } } });
  if (!found) return null;
  if (found.expiresAt <= new Date()) {
    await tx.idempotencyKey.delete({ where: { id: found.id } });
    return null;
  }
  if (found.fingerprint !== s.fingerprint) throw new ApiError("Dieser Idempotency-Key gehört zu einer anderen Anfrage.", 422);
  return found;
}

/** Ergebnis in der laufenden Transaktion speichern (Erfolg). */
export async function rememberResponse(tx: Tx, s: IdempotencyScope, status: number, response: unknown) {
  await tx.idempotencyKey.create({ data: { ...s, status, response: toJson(response), expiresAt: new Date(Date.now() + TTL_MS) } });
}

/** Endgueltige Ablehnung nach der zurueckgerollten Transaktion speichern; ein vorhandener Eintrag bleibt. */
export async function rememberRejection(s: IdempotencyScope, status: number, response: unknown) {
  await db.idempotencyKey.createMany({ data: [{ ...s, status, response: toJson(response), expiresAt: new Date(Date.now() + TTL_MS) }], skipDuplicates: true });
}

/** Gespeicherte Antwort erneut ausliefern, gekennzeichnet als Wiederholung. */
export function replay(found: IdempotencyKey): Response {
  return Response.json(found.response, { status: found.status, headers: { "Idempotent-Replayed": "true" } });
}

/** Abgelaufene Keys entfernen (stuendlich aus server.ts). */
export function removeExpiredIdempotencyKeys() {
  return db.idempotencyKey.deleteMany({ where: { expiresAt: { lt: new Date() } } });
}

/** Wie die spaetere JSON-Antwort (Datumswerte als ISO-Text). */
function toJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}
