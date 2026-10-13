/**
 * Kunden und Einsatzorte archivieren: aus Planung, Listen und Auswahlfeldern
 * ausblenden, ohne die Historie zu veraendern. Schichten, Zeiten, Meldungen
 * und Check-ins bleiben unveraendert am Einsatzort; Standortrechte wirken dort
 * nur noch fuer die Historie (ARCHIVE_RIGHTS in access.ts). Endgueltig
 * loeschen bleibt Einsatzorten ohne Historie vorbehalten.
 */
import type { Prisma } from "@prisma/client";
import { addDate, berlinDate, weekDate } from "./berlin";
import { shiftEnded } from "./planning";

type Tx = Prisma.TransactionClient;

export const CUSTOMER_ARCHIVED = "Der Kunde ist archiviert. Bitte zuerst den Kunden wiederherstellen.";

/**
 * Was das Archivieren je Einsatzort verhindert (ein Satz je Einsatzort):
 * noch nicht beendete Schichten - laufend oder kuenftig, Entwurf oder
 * veroeffentlicht - und Plaene in Bearbeitung, deren Woche noch nicht vorbei
 * ist (Mitarbeitende saehen sonst bis zum Veroeffentlichen den alten Stand).
 */
export async function archiveBlockers(tx: Tx, orgId: string, branchIds: string[]): Promise<Map<string, string>> {
  const today = berlinDate(), year = Number(today.slice(0, 4));
  const scope = { organizationId: orgId, deletedAt: null, branchId: { in: branchIds }, year: { gte: year - 1 } };
  const [shifts, editing] = await Promise.all([
    tx.shift.findMany({ where: { deletedAt: null, schedule: scope }, select: { dayOfWeek: true, shiftFrom: true, shiftTo: true, schedule: { select: { year: true, weekNumber: true, branchId: true } } } }),
    tx.schedule.findMany({ where: { ...scope, editingSince: { not: null } }, select: { branchId: true, year: true, weekNumber: true }, orderBy: [{ year: "asc" }, { weekNumber: "asc" }] }),
  ]);
  const blockers = new Map<string, string>();
  for (const id of branchIds) {
    const open = shifts.filter((s) => s.schedule.branchId === id && !shiftEnded(s)).length;
    const weeks = editing.filter((s) => s.branchId === id && weekDate(s.year, s.weekNumber, 7) >= addDate(today, -1)).map((s) => "KW " + s.weekNumber + "/" + s.year);
    const reasons = [
      ...(open ? [open + (open === 1 ? " zukünftige/laufende Schicht" : " zukünftige/laufende Schichten") + " – zuerst löschen oder verschieben"] : []),
      ...(weeks.length ? [weeks.join(", ") + " in Bearbeitung – zuerst veröffentlichen oder verwerfen"] : []),
    ];
    if (reasons.length) blockers.set(id, reasons.join("; "));
  }
  return blockers;
}

/**
 * Einsatzort hat Historie und laesst sich nicht endgueltig loeschen:
 * Schichten (auch geloeschte), Briefings, Live-Sitzungen, Zeitbuchungen,
 * Check-ins oder Standortmeldungen.
 */
export async function branchHasHistory(tx: Tx, branchId: string): Promise<boolean> {
  const counts = await Promise.all([
    tx.shift.count({ where: { schedule: { branchId } } }),
    tx.schedule.count({ where: { branchId, OR: [{ briefings: { some: {} } }, { liveSession: { isNot: null } }] } }),
    tx.timeRecord.count({ where: { branchId } }),
    tx.checkin.count({ where: { branchId } }),
    tx.branchIssue.count({ where: { branchId } }),
  ]);
  return counts.some(Boolean);
}
