/**
 * Standortzuordnung von Mitarbeitenden.
 *
 * Fuer den Pilot ist die Zuordnung die bestehende Standortfreigabe "Offene
 * Schichten sehen und anfragen" (REQUEST_SHIFTS): offene Plaetze ohne Namen
 * anderer Personen und Uebernahmeantraege - kein vollstaendiger
 * Standortplan und keine Personaldaten.
 *
 * - Admins ordnen Mitarbeitende allen Standorten zu.
 * - Manager nur Standorten, an denen sie selbst "Schichten erstellen und
 *   bearbeiten" (EDIT_SHIFTS) haben, und nur Personen, die ihnen mit
 *   "Einplanen" zugeordnet sind.
 * - Freigaben, die ueber die Zuordnung hinausgehen (etwa "Dienstplan
 *   ansehen"), aendert nur die Administration.
 */
import type { Prisma } from "@prisma/client";
import { ApiError } from "./errors";
import { branchIds, type Access } from "./access";
import { normalizeBranchRights, type BranchRightKey } from "./access-shared";

type Tx = Prisma.TransactionClient;
type Target = { id: string; userId: string; role: string; isActive: boolean };

export const SITE_RIGHTS: BranchRightKey[] = ["REQUEST_SHIFTS"];

/** Standorte, die die angemeldete Person vergeben darf; null bedeutet: alle (Admin). */
export function siteScope(a: Access): string[] | null {
  return branchIds(a, "EDIT_SHIFTS");
}

/** Konten anlegen: Admins, und Manager mit mindestens einem Standort, an dem sie planen. */
export function canCreateStaff(a: Access): boolean {
  return a.isAdmin || (a.role === "MANAGER" && (siteScope(a)?.length ?? 0) > 0);
}

/** Standortzuordnung dieser Person aendern. Nur fuer Mitarbeitende; Manager erhalten Freigaben. */
export function canManageSites(a: Access, target: Target): boolean {
  if (target.role !== "EMPLOYEE") return false;
  if (a.isAdmin) return true;
  return a.role === "MANAGER" && target.isActive && (a.staff.get(target.userId)?.rights.has("ASSIGN_SHIFTS") ?? false) && (siteScope(a)?.length ?? 0) > 0;
}

/** Die Freigabe ist nichts weiter als die Zuordnung - nur dann darf ein Manager sie entfernen. */
function onlySite(rights: readonly string[], role: string): boolean {
  return normalizeBranchRights(rights, role).every((r) => SITE_RIGHTS.includes(r));
}

function assigned(rights: readonly string[], role: string): boolean {
  return normalizeBranchRights(rights, role).includes("REQUEST_SHIFTS");
}

/** Prueft die gewuenschten Standorte: im eigenen Bereich (403) und in der Organisation vorhanden (404). */
export async function checkSites(tx: Tx, a: Access, wanted: string[]): Promise<string[]> {
  const unique = [...new Set(wanted)];
  const scope = siteScope(a);
  if (scope && unique.some((id) => !scope.includes(id))) throw new ApiError("Du kannst nur Standorte zuordnen, an denen du Schichten bearbeiten darfst.", 403);
  const found = unique.length ? await tx.branch.count({ where: { organizationId: a.orgId, id: { in: unique } } }) : 0;
  if (found !== unique.length) throw new ApiError("Standort nicht gefunden.", 404);
  return unique;
}

/** Standorte im Bereich der angemeldeten Person, mit dem Stand fuer diese Person. */
export async function sitesOf(tx: Tx, a: Access, target: Target) {
  const scope = siteScope(a);
  const [branches, grants] = await Promise.all([
    tx.branch.findMany({
      where: { organizationId: a.orgId, ...(scope ? { id: { in: scope } } : {}) },
      orderBy: { name: "asc" },
      select: { id: true, name: true, isActive: true, customer: { select: { id: true, name: true } } },
    }),
    tx.branchAccess.findMany({ where: { memberId: target.id, organizationId: a.orgId }, select: { branchId: true, rights: true } }),
  ]);
  const rightsAt = new Map(grants.map((g) => [g.branchId, g.rights]));
  return branches.map((b) => {
    const rights = rightsAt.get(b.id);
    return { ...b, assigned: !!rights && assigned(rights, target.role), locked: !a.isAdmin && !!rights && !onlySite(rights, target.role) };
  });
}

/**
 * Setzt die Zuordnung innerhalb des eigenen Bereichs: fehlende Standorte
 * erhalten die Zuordnung, abgewaehlte verlieren sie. Standorte ausserhalb
 * des Bereichs bleiben unberuehrt.
 */
export async function setSites(tx: Tx, a: Access, target: Target, wanted: string[]) {
  const unique = await checkSites(tx, a, wanted);
  const scope = siteScope(a);
  const current = await tx.branchAccess.findMany({
    where: { memberId: target.id, organizationId: a.orgId, ...(scope ? { branchId: { in: scope } } : {}) },
    select: { id: true, branchId: true, rights: true },
  });
  for (const grant of current) {
    if (unique.includes(grant.branchId)) {
      if (!assigned(grant.rights, target.role)) await tx.branchAccess.update({ where: { id: grant.id }, data: { rights: [...new Set([...grant.rights, ...SITE_RIGHTS])] as BranchRightKey[] } });
      continue;
    }
    if (!a.isAdmin && !onlySite(grant.rights, target.role)) throw new ApiError("Diese Freigabe umfasst mehr als die Standortzuordnung. Ändern kann sie nur die Administration.", 403);
    await tx.branchAccess.delete({ where: { id: grant.id } });
  }
  const have = new Set(current.map((g) => g.branchId));
  const missing = unique.filter((id) => !have.has(id));
  if (missing.length) await tx.branchAccess.createMany({ data: missing.map((branchId) => ({ organizationId: a.orgId, memberId: target.id, branchId, rights: SITE_RIGHTS })) });
}

/** Aktivierungslink; APP_URL ist die oeffentliche Adresse hinter dem Proxy. */
export function activationUrl(request: Request, token: string): string {
  return new URL("/activate?token=" + token, process.env.APP_URL || new URL(request.url).origin).toString();
}
