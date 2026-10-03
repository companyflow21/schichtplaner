/*
 * Nur fuer den PGlite-Lasttest: server.ts und gebaute Next-Routen muessen
 * denselben Prisma-Client verwenden, weil PGlite eine einzige Verbindung hat.
 * Normale Produktionsstarts verwenden weiterhin server.ts direkt.
 */
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

if (process.env.DATABASE_URL !== "postgresql://postgres:postgres@127.0.0.1:55447/postgres") {
  throw new Error("Dieser Teststarter ist ausschliesslich fuer die lokale PGlite-Datenbank bestimmt.");
}
const shared = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL, max: 1 }),
});
(globalThis as typeof globalThis & { prisma: PrismaClient }).prisma = shared;
void import("../server");

