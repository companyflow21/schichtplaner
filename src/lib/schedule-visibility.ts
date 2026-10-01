import type { Prisma } from "@prisma/client";
import { branchIds, can, type Access } from "./access";
import { ineffectiveBookings, type ShiftWithRelations } from "./planning";

type Tx = Prisma.TransactionClient;

/** Ohne "Dienstplan ansehen" nur eigene und noch offene Schichten - nicht den ganzen Plan. */
export function visibleFor(a: Access) {
  return (s: { schedule: { branchId: string | null }; bookings: { userId: string | null }[]; maxEmployees: number }) =>
    can(a, "VIEW_SCHEDULE", s.schedule.branchId) || s.bookings.some(b => b.userId === a.userId) || s.bookings.length < s.maxEmployees;
}

/**
 * Zusammengefuehrte Sicht (GET /api/schedules ohne Standort, Export):
 * Admins alles; sonst eigene veroeffentlichte Schichten, Standorte mit
 * "Dienstplan ansehen" (Manager auch Entwuerfe) und freigegebene Standorte
 * mit "Offene Schichten sehen und anfragen" (nur veroeffentlicht).
 * Als OR-Liste fuer shift.findMany; danach zusaetzlich visibleFor filtern.
 * Achtung Admin: [{}] als einziges OR-Element liefert in Prisma keine Zeilen
 * (GET /api/schedules ohne Standort zeigt Admins deshalb nichts - bestehendes
 * Verhalten, hier bewusst unveraendert). Der Export nutzt es innerhalb von AND.
 */
export function mergedScope(a: Access): Prisma.ShiftWhereInput[] {
  const view = branchIds(a, "VIEW_SCHEDULE"), request = branchIds(a, "REQUEST_SHIFTS");
  const manager = a.role === "MANAGER";
  return a.isAdmin ? [{}] : [
    { schedule: { isPublic: true }, bookings: { some: { userId: a.userId } } },
    ...(view?.length ? [{ schedule: { branchId: { in: view }, ...(manager ? {} : { isPublic: true }) } }] : []),
    ...(request?.length ? [{ schedule: { branchId: { in: request }, isPublic: true } }] : []),
  ];
}

/** Unwirksame Zuweisungen (inaktiv, abwesend) zaehlen nur fuer die Planung - sonst leer. */
export async function ineffectiveFor(tx: Tx, a: Access, shifts: ShiftWithRelations[]): Promise<Set<string>> {
  const manager = a.role === "MANAGER";
  const planned = shifts.filter(s => can(a, "VIEW_SCHEDULE", s.schedule.branchId) && (a.isAdmin || manager));
  return ineffectiveBookings(tx, a.orgId, planned);
}
