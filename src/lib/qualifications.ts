import type { Prisma } from "@prisma/client";
import { ApiError } from "./errors";

type Tx = Prisma.TransactionClient;

/** Vergleichsform: aeussere Leerzeichen weg, Gross-/Kleinschreibung egal. */
export function normalizeQualification(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * Prueft gewaehlte Qualifikationen gegen den Katalog der Organisation und
 * liefert sie in der Schreibweise des Katalogs, ohne Doppelte. Unbekannte
 * Eintraege lehnt der Server ab - neue Eintraege legt nur die Administration
 * im Katalog an.
 */
export async function catalogQualifications(tx: Tx, organizationId: string, names: string[]): Promise<string[]> {
  const wanted = [...new Map(names.map((n) => [normalizeQualification(n), n.trim()])).entries()].filter(([key]) => key);
  if (!wanted.length) return [];
  const found = await tx.qualification.findMany({ where: { organizationId, normalizedName: { in: wanted.map(([key]) => key) } }, select: { name: true, normalizedName: true } });
  const byKey = new Map(found.map((q) => [q.normalizedName, q.name]));
  const missing = wanted.filter(([key]) => !byKey.has(key)).map(([, name]) => name);
  if (missing.length) throw new ApiError("Qualifikation nicht im Katalog: " + missing.join(", ") + ".", 400);
  return wanted.map(([key]) => byKey.get(key)!);
}
