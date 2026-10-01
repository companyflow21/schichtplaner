/**
 * Antwort von GET /api/schedules/export - die Datengrundlage des
 * Dienstplan-PDFs. Nur Felder, die die anfragende Person im Plan ohnehin
 * sehen darf (gleiche Regeln wie GET /api/schedules), keine Kontaktdaten.
 */
export type ScheduleExportRow = {
  /** Kalendertag des Schichtbeginns (JJJJ-MM-TT, Europe/Berlin). */
  date: string;
  /** Voller deutscher Wochentag, z. B. "Montag". */
  weekday: string;
  shiftFrom: string;
  shiftTo: string;
  /** Nachtschicht: endet am Folgetag. */
  endsNextDay: boolean;
  /** Taetigkeit: Titel der Schicht, ersatzweise der Arbeitsbereich; sonst leer. */
  title: string;
  branch: string;
  /** Leer bei Altbestand ohne Kunde. */
  customer: string;
  /** Namen, soweit sichtbar; geloeschte Personen mit Zusatz "(gelöscht)". */
  assigned: string[];
  /** Offene Plaetze (bei der Planung nur wirksame Zuweisungen gerechnet). */
  open: number;
  /** Benoetigte Plaetze insgesamt und belegte Plaetze (auch nicht sichtbar benannte). */
  places: number;
  occupied: number;
  /** false: Entwurf, noch nicht veroeffentlicht. */
  isPublic: boolean;
};

export type ScheduleExport = {
  period: { from: string; to: string };
  /** Namen der aktiven Filter. */
  filters: { customer?: string; branch?: string; person?: string };
  /** ISO-Zeitpunkt der Erstellung. */
  generatedAt: string;
  /** Personen, die im Zeitraum (mit Kunden-/Standortfilter, ohne Personenfilter) sichtbar sind. */
  people: { userId: string; name: string }[];
  /** Kunden und Standorte im Zeitraum - fuer die Auswahl in der Oberflaeche. */
  customers: { id: string; name: string }[];
  branches: { id: string; name: string; customerId: string | null }[];
  rows: ScheduleExportRow[];
};
