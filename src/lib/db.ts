import { Prisma, PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

/** Hoechstzahl Versuche einer Transaktion bei einem Serialisierungskonflikt. */
const TRANSACTION_ATTEMPTS = 5;
/** Vor Versuch n+1 zufaellig 0 bis BACKOFF_BASE_MS * 2^n warten (zusammen hoechstens 3 s). */
const BACKOFF_BASE_MS = 100;

/**
 * Vorübergehender Serialisierungskonflikt (SQLSTATE 40001): PostgreSQL hat
 * die ganze Transaktion zurückgerollt, ein neuer Versuch ist daher sicher.
 * Prisma meldet ihn als P2034 oder, beim COMMIT, als rohen Adapterfehler.
 * Deadlocks, fachliche Sperren (ApiError) und alle anderen Fehler zählen nicht.
 */
export function isSerializationFailure(error: unknown): boolean {
  const adapter = error instanceof Prisma.PrismaClientKnownRequestError ? error.meta?.driverAdapterError : error;
  const e = adapter as { name?: unknown; cause?: { originalCode?: unknown } } | null | undefined;
  return e?.name === "DriverAdapterError" && e.cause?.originalCode === "40001";
}

function createClient(): PrismaClient {
  // Prisma 7 needs a driver adapter; the connection is opened lazily on first query.
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL, max: Number(process.env.DATABASE_POOL_MAX || 10) });
  const base = new PrismaClient({
    adapter,
    log: process.env.DATABASE_LOG_QUERIES === "true" ? ["query"] : [],
  });
  const transaction = base.$transaction.bind(base) as (...args: unknown[]) => Promise<unknown>;
  // Die Erweiterung aendert nur das Verhalten von $transaction, nicht dessen
  // Signatur; als PrismaClient bleibt db ueberall als Transaktions-Client nutzbar.
  return base.$extends({
    client: {
      /**
       * Transaktionen mit Callback werden bei einem Serialisierungskonflikt
       * vollständig neu ausgeführt (exponentielle Pause mit Zufallsanteil).
       * Während der Pause ist keine Verbindung belegt. Der Callback darf
       * deshalb nichts außerhalb der Transaktion auslösen; Socket-Signale und
       * Ähnliches erst nach ihrem Ende. Stapel ($transaction([...])) laufen
       * unverändert einmal.
       */
      async $transaction(...args: unknown[]) {
        if (typeof args[0] !== "function") return transaction(...args);
        for (let attempt = 1; ; attempt++) {
          try {
            return await transaction(...args);
          } catch (error) {
            if (!isSerializationFailure(error)) throw error;
            if (attempt >= TRANSACTION_ATTEMPTS) {
              console.warn("Serialisierungskonflikt nach " + attempt + " Versuchen");
              throw error;
            }
            await new Promise(resolve => setTimeout(resolve, Math.random() * BACKOFF_BASE_MS * 2 ** attempt));
          }
        }
      },
    } as { $transaction: PrismaClient["$transaction"] },
  }) as unknown as PrismaClient;
}

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const db = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
