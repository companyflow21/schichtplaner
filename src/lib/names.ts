/**
 * Anzeigename einer Person im Schichtplan nach der Organisationseinstellung
 * "Namensformat" (Einstellungen -> Schichtplan). Gespeicherte Namen bleiben
 * unveraendert. Platzhalter von Subunternehmern ("Firma · Name") behalten
 * ihre Form; der Altwert NICKNAME und ein noch nicht geladenes Format zeigen
 * "Vorname Nachname". short: kompakte Monatsansicht, der zweite Namensteil
 * wird abgekuerzt.
 */
export function formatName(p: { firstName: string; lastName: string }, format: string | null | undefined, options: { contractor?: boolean; short?: boolean } = {}): string {
  const first = p.firstName.trim(), last = p.lastName.trim();
  if (options.contractor) return (first + " " + last).trim();
  switch (format) {
    case "LASTNAME_FIRSTNAME": return options.short ? last + (first ? ", " + first.charAt(0) + "." : "") : [last, first].filter(Boolean).join(", ");
    case "LASTNAME": return last || first;
    case "FIRSTNAME": return first || last;
    default: return options.short ? first + (last ? " " + last.charAt(0) + "." : "") : (first + " " + last).trim();
  }
}
