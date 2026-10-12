/**
 * Konfliktpruefung einer Standortwoche (GET /api/schedules/conflicts) - nur
 * fuer die Planung. fehler (rot): Ueberschneidung, genehmigte Abwesenheit,
 * Konto nicht aktiv, als nicht verfuegbar eingetragen. hinweis (orange):
 * Qualifikation, Taetigkeit, Arbeitsbereich, ausserhalb der eingetragenen
 * Verfuegbarkeit.
 */
export type ConflictSeverity = "fehler" | "hinweis";
export type ConflictKind = "overlap" | "absence" | "inactive" | "unavailable" | "qualification" | "position" | "division" | "availability";

export type ConflictItem = {
  shiftId: string;
  /** Kalendertag der Schicht (YYYY-MM-DD). */
  date: string;
  bookingId: string;
  personKey: string;
  userId?: string;
  contractorWorkerId?: string;
  name: string;
  severity: ConflictSeverity;
  kind: ConflictKind;
  /** Derselbe Text wie bei der Pruefung beim Einteilen. */
  text: string;
  /**
   * Nur bei Ueberschneidung: die andere Schicht. Standort nur, wenn die
   * betrachtende Person dessen Dienstplan sehen darf - sonst "anderer Standort".
   */
  other?: { shiftId: string; date: string; from: string; to: string; branchId?: string; branchName?: string };
};

export type WeekConflicts = { items: ConflictItem[]; counts: { fehler: number; hinweis: number } };
