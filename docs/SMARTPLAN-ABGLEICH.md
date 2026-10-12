# Smartplan-Abgleich – Plan und Arbeitsstand

Stand 12.10.2026. **Vorläufig:** Der Abgleich unten stützt sich nur auf öffentliche Angaben (Quellen am Ende).
Smartplan selbst ist noch nicht durchgesehen.

## Ziel (Vorgaben des Inhabers vom 12.10.2026)

- Der Schichtplaner wird das eigene Endprodukt und löst Smartplan ab.
- Funktionsumfang: alles, was Smartplan kann. Einzelne Punkte ändert AKRO bewusst ab; sie stehen je Funktion
  in der Spalte „AKRO-Abweichung“ des Funktionskatalogs.
- Design: Layout und Bedienführung wie Smartplan. Logo, Farben, Texte, Grafiken und Code von Smartplan werden
  nicht übernommen; das AKRO-Erscheinungsbild bleibt.
- Schwerpunkte: Lohn, Stundenzettel, GPS-Check-in.
- Smartplan wird im Web und in der Handy-App erfasst. Zugänge für alle Rollen sind vorhanden.

## Vorgehen

1. **Erfassung:** jede Seite je Rolle (Admin, Planer, Mitarbeiter) und die Handy-App durchgehen. Felder, Pflichtfelder,
   Abläufe, Meldungen, Exporte und Benachrichtigungen im Funktionskatalog festhalten. Grenzfälle gezielt ansehen:
   Nachtschicht über Mitternacht, Zeitumstellung, Feiertage, Überschneidungen, Ruhezeiten, Zuschläge, Sichtbarkeit je Rolle.
2. **Abgleich:** je Funktion vorhanden / teilweise / fehlt gegenüber dem Schichtplaner.
3. **Umsetzung in Paketen** nach Priorität, je Paket mit Tests und Browserprüfung; Arbeitsliste wie in `FERTIGSTELLUNG.md`.
4. **Layout** je Bildschirm im jeweiligen Paket angleichen.
5. **Umstieg:** Daten aus Smartplan-Exporten übernehmen, Parallelbetrieb, dann Abschaltung.

## Zugang zu Smartplan aus der Cloud-Sitzung

- Netzwerkfreigabe der Umgebung: `smartplanapp.com` und `smartplanapp.io` (Anmeldung `auth.smartplanapp.io`,
  App `app.smartplanapp.io`). Am 12.10.2026 waren Anmeldeseite und App-Adresse erreichbar.
- Zugangsdaten nur als Umgebungsvariablen `SMARTPLAN_EMAIL` und `SMARTPLAN_PASSWORD` in den Umgebungseinstellungen,
  nie im Chat oder im Repo. Sie gelten erst in einer neu gestarteten Sitzung.
- Browser: global installiertes Playwright mit Chromium, Proxy aus `HTTPS_PROXY`,
  `NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt`. Anmeldeformular: `#id_username`, `#id_password`, Kästchen `remember_me`.
  Verlangt Smartplan einen Bestätigungscode, den Inhaber fragen.

## Regeln für die Erfassung im echten Konto

- **Ohne Rückfrage:** Seiten ansehen, Menüs, Filter und Ansichten wechseln, Formulare öffnen und abbrechen,
  Exporte herunterladen.
- **Vorher fragen:** alles, was speichert, veröffentlicht, Nachrichten, Push oder E-Mails an Mitarbeitende auslöst,
  genehmigt, ablehnt, löscht oder Einstellungen und Abrechnung ändert. Grund: Echtbetrieb – Mitarbeitende werden
  benachrichtigt, Pläne und Lohndaten ändern sich.
- Screenshots, Exporte und Notizen mit echten Personendaten nur im Scratchpad der Sitzung, nie im Repo.
  Im Funktionskatalog nur Feldnamen und Abläufe, keine Namen oder Daten von Mitarbeitenden.

## Vorläufiger Abgleich (öffentliche Angaben)

| Bereich | Smartplan (öffentlich beschrieben) | Schichtplaner heute | Einschätzung |
|---|---|---|---|
| Plan erstellen | Kopieren, Vorlagen | Wiederholung 1–52 Wochen, Kopie auf Datum; keine Vorlagen | teilweise |
| Automatische Planung | Regelbasierte Vorschläge (Höchststunden, Abstand zwischen Schichten, Wünsche) | Optionaler KI-Planer; keine festen Regeln für Höchststunden oder Ruhezeit | teilweise |
| Veröffentlichen, Bestätigen | vorhanden | vorhanden | vorhanden |
| Tausch, offene Schichten | Tausch über die App, Freigabe | Abgabe, Zwei-Schichten-Tausch, offene Schicht anfragen, Freigabe | vorhanden |
| Stempeluhr | Stempeln per Smartphone/Tablet, GPS-Prüfung, Pausen | GPS-Check-in (50 m), Stoppuhr, Pause | vorhanden; Gerätetest offen |
| Zeitänderungen | Genehmigen oder ablehnen | Korrekturantrag mit Freigabe | vorhanden |
| Abwesenheiten | Urlaub, Krankheit, sonstige, Antrag per App | vorhanden mit Freigabe | vorhanden |
| Überstunden | Überstundensaldo in der App | Soll/Ist je Monat, kein fortlaufendes Konto | teilweise |
| Urlaubskonto | in Smartplan zu prüfen | fehlt | offen |
| Stunden und Lohn | Lohnberechnung aus erfasster Zeit inkl. Zuschläge und Abwesenheiten, Export Excel/CSV | CSV-Stundenexport; keine Lohnsätze, keine Zuschläge | fehlt |
| Stundenzettel | in Smartplan zu prüfen; von AKRO gewünscht | fehlt | fehlt |
| Nachrichten | Teamkanal | Postfach mit Bezug, Browser-Push | vorhanden |
| Handy-App | iOS und Android | Web-App mit Browser-Push | teilweise |
| Schnittstelle (API) | im höheren Tarif | keine | fehlt; Bedarf klären |

## Funktionskatalog (wird bei der Erfassung gefüllt)

Je Bereich eine Tabelle: Bildschirm · Rolle · Felder und Aktionen · Regeln und Meldungen · Schichtplaner heute · AKRO-Abweichung.

Bereiche: Dienstplan · Mitarbeitende · Abwesenheiten · Stempeluhr und Zeiterfassung · Stunden und Lohn ·
Stundenzettel · Nachrichten · Einstellungen · Handy-App.

## Offene Fragen an den Inhaber

- Lohn: Welche Lohnsoftware oder welches Steuerbüro (z. B. DATEV)? Welche Zuschläge (Nacht, Sonntag, Feiertag) in welcher Höhe? Welche Lohnarten?
- Stundenzettel: Inhalt, Unterschrift von Mitarbeiter oder Kunde, PDF?
- Was genau ändert AKRO gegenüber Smartplan ab?
- Handy-App: Reicht die Web-App mit Push, oder ist eine Store-App nötig?

## Nächster Schritt

Neue Sitzung mit gesetzten Zugangsdaten: Erfassung nach den Regeln oben, Funktionskatalog füllen, danach Abgleich und Paketliste.

## Quellen (öffentlich, abgerufen 12.10.2026)

- Smartplan-Hilfe: [Export hours to Excel](https://smartplan-knowledge-base.helpscoutdocs.com/article/229-export-hours-to-excel),
  [Hours and salary](https://smartplan-knowledge-base.helpscoutdocs.com/article/374-introduction-hours-and-salary)
- [Smartplan im App Store](https://apps.apple.com/app/id1100134190)
- Verzeichnisse: [ki-syndikat.de](https://www.ki-syndikat.de/tools/smartplan/), [SoftGuide](https://www.softguide.de/programm/smartplan-1),
  [trusted.de](https://trusted.de/smartplan)
