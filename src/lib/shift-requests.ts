import type { Prisma } from "@prisma/client";
import { berlinDate, berlinTime, minuteOfDay, shiftRange } from "./berlin";
import { branchHolders, can, type Access } from "./access";
import { isAdminRole, normalizeBranchRights } from "./access-shared";
import { checkAssignment, type ShiftWithRelations } from "./planning";

type Tx = Prisma.TransactionClient;

/** Jetzt in Berliner Ortsminuten - dieselbe Skala wie shiftRange(). */
export function berlinNowMinutes(now = new Date()): number {
  return Date.parse(berlinDate(now) + "T00:00:00Z") / 60000 + minuteOfDay(berlinTime(now));
}

/** Schicht hat noch nicht begonnen (Ortszeit Europe/Berlin). */
export function isFuture(shift: ShiftWithRelations): boolean {
  return shiftRange(shift).start > berlinNowMinutes();
}

/**
 * Ist die Person dem Standort zugeordnet (Freigabe "Offene Schichten sehen und
 * anfragen")? Admins arbeiten organisationsweit.
 */
export async function assignedToSite(tx: Tx, orgId: string, userId: string, branchId: string | null): Promise<boolean> {
  if (!branchId) return false;
  const member = await tx.organizationMember.findUnique({ where: { organizationId_userId: { organizationId: orgId, userId } }, select: { id: true, role: true, isActive: true } });
  if (!member?.isActive) return false;
  if (isAdminRole(member.role)) return true;
  const grant = await tx.branchAccess.findFirst({ where: { organizationId: orgId, branchId, memberId: member.id }, select: { rights: true } });
  return !!grant && normalizeBranchRights(grant.rights, member.role).includes("REQUEST_SHIFTS");
}

/**
 * Echter Tausch: requester (auf own) und partner (auf other) tauschen ihre
 * Schichten. Geprueft wird beim Antrag, bei der Zustimmung und - ohne die
 * bestaetigbaren Hinweise, die dort assign() behandelt - bei der Genehmigung:
 * - beide Zuweisungen bestehen noch, beide Schichten sind veroeffentlicht und kuenftig
 * - jede Person ist dem Standort der anderen Schicht zugeordnet
 * - withAssessment: keine Sperre und kein Hinweis fuer die neue Einteilung;
 *   die jeweils abgegebene Schicht zaehlt dabei nicht als Ueberschneidung.
 * Gruende der anderen Person werden nur allgemein genannt (Personaldaten).
 */
export async function exchangeProblems(tx: Tx, orgId: string, own: ShiftWithRelations, requester: string, other: ShiftWithRelations, partner: string, withAssessment: boolean): Promise<string[]> {
  const problems: string[] = [];
  if (!own.bookings.some(b => b.userId === requester) || !other.bookings.some(b => b.userId === partner)) problems.push("Eine der beiden Zuweisungen besteht nicht mehr.");
  if (own.bookings.some(b => b.userId === partner) || other.bookings.some(b => b.userId === requester)) problems.push("Beide sind bereits in einer der Schichten eingeteilt.");
  if (!own.schedule.isPublic || !other.schedule.isPublic) problems.push("Nur veröffentlichte Schichten können getauscht werden.");
  if (!isFuture(own) || !isFuture(other)) problems.push("Nur künftige Schichten können getauscht werden.");
  if (problems.length) return problems;
  if (!await assignedToSite(tx, orgId, requester, other.schedule.branchId)) problems.push("Du bist dem Standort der anderen Schicht nicht zugeordnet.");
  if (!await assignedToSite(tx, orgId, partner, own.schedule.branchId)) problems.push("Die andere Person ist dem Standort deiner Schicht nicht zugeordnet.");
  if (problems.length || !withAssessment) return problems;
  problems.push(...await checkAssignment(tx, other, requester, own.id));
  if ((await checkAssignment(tx, own, partner, other.id)).length) problems.push("Für die andere Person passt deine Schicht nicht (Voraussetzungen, Abwesenheit, Verfügbarkeit oder Überschneidung).");
  return problems;
}

/** Entscheiden darf, wer "Anträge bearbeiten" an allen betroffenen Standorten hat. */
export function canDecide(a: Access, branchIds: (string | null)[]): boolean {
  return branchIds.every(id => can(a, "HANDLE_REQUESTS", id));
}

/**
 * Wer die Entscheidung erhaelt: Personen mit "Anträge bearbeiten" an allen
 * betroffenen Standorten. Hat kein Manager alle Rechte, bleibt nur die
 * Administration (branchHolders enthaelt Admins immer).
 */
export async function deciders(tx: Tx, orgId: string, branchIds: (string | null)[]): Promise<string[]> {
  const sets = await Promise.all([...new Set(branchIds)].map(id => branchHolders(tx, orgId, id, ["HANDLE_REQUESTS"])));
  return sets.reduce((all, set) => all.filter(id => set.includes(id)));
}
