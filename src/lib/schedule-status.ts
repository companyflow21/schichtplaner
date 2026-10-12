import type { Schedule } from "@prisma/client";
import type { ScheduleStatus } from "@/types/schedule";

type Status = Pick<Schedule, "isPublic" | "editingSince">;

/**
 * Lebenszyklus eines Wochenplans, abgeleitet statt gespeichert:
 * - DRAFT: nicht veroeffentlicht, fuer Mitarbeitende unsichtbar
 * - PUBLISHED: veroeffentlicht; Aenderungen wirken sofort und werden einzeln mitgeteilt
 * - EDITING: veroeffentlicht und in Bearbeitung (editingSince, Momentaufnahme in
 *   schedule_snapshots). Planung aendert weiter die Live-Zeilen, aber ohne
 *   Einzelmitteilungen; Antraege ruhen. Beim Veroeffentlichen gibt es eine
 *   Sammelmitteilung je betroffener Person, Verwerfen stellt den Stand wieder her.
 * isPublic behaelt ueberall die Bedeutung "fuer Mitarbeitende sichtbar".
 */
export function scheduleStatus(s: Status): ScheduleStatus {
  if (!s.isPublic) return "DRAFT";
  return s.editingSince ? "EDITING" : "PUBLISHED";
}

/** Einzelmitteilungen an Mitarbeitende nur bei veroeffentlichten Plaenen ausserhalb der Bearbeitung. */
export function notifiesEmployees(s: Status): boolean {
  return scheduleStatus(s) === "PUBLISHED";
}

export function isEditing(s: Status): boolean {
  return scheduleStatus(s) === "EDITING";
}

export const EDITING_REQUESTS = "Diese Woche wird gerade überarbeitet. Anträge sind nach der Veröffentlichung wieder möglich.";
