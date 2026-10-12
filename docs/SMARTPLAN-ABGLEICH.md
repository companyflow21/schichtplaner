# Smartplan-Abgleich – Plan und Arbeitsstand

Stand 12.10.2026. Der Abgleich stützt sich auf alle 106 Artikel des offiziellen Smartplan-Hilfe-Centers
(mit Screenshots) und den Code im Stand `88c21eb`. Smartplan selbst ist noch nicht im Konto durchgesehen;
was die Artikel offenlassen, steht in den Katalogteilen unter „Offen für die Erfassung im Konto“.

## Ziel (Vorgaben des Inhabers vom 12.10.2026)

- Der Schichtplaner wird das eigene Endprodukt und löst Smartplan ab.
- Funktionsumfang: alles, was Smartplan kann. Einzelne Punkte ändert AKRO bewusst ab; sie werden bei der
  jeweiligen Funktion im Funktionskatalog vermerkt, sobald AKRO sie benennt.
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

## Funktionskatalog

Je Funktion: Smartplan-Verhalten in eigenen Worten, Rolle, Stand im Schichtplaner mit Datei-Verweis, Status und Aufwand
(S < 1 Tag, M 1–3 Tage, L > 3 Tage). Dazu je Teil Layout und Bedienung, Regeln und offene Punkte.

| Teil | Inhalt | Funktionen | vorhanden | teilweise | anders gelöst | fehlt |
|---|---|---|---|---|---|---|
| [A – Planung](smartplan/A-planung.md) | Dienstplan, Vorlagen, Regeln, Assistent, Veröffentlichen, Tausch | 93 | 19 | 25 | 12 | 37 |
| [B – Zeit und Lohn](smartplan/B-zeit-lohn.md) | Stempeluhr, Terminal, Stunden und Lohn, Zuschläge, Export, Zeitkonten, Stundenzettel | 88 | 3 | 25 | 4 | 56 |
| [C – Personal, Standorte, Abwesenheit](smartplan/C-personal-orte-abwesenheit.md) | Rollen und Rechte, Mitarbeitende, Standorte, Abwesenheit, Urlaubskonto | 112 | 20 | 30 | 21 | 41 |
| [D – Allgemeines und App](smartplan/D-allgemein-app.md) | Einrichtung, Nachrichten, Benachrichtigungen, Kalender, Anmeldung, Mitarbeiter-App, DSGVO | 92 | 14 | 30 | 15 | 33 |
| **Summe** | | **385** | **56** | **110** | **52** | **167** |

„Anders gelöst“ heißt: AKRO hat bewusst eine eigene Lösung (z. B. Kunden → Einsatzorte, harte Sperre bei
Überschneidungen, GPS-Check-in nur am Einsatzort der Schicht). Die Zeilen sagen jeweils, was davon übernommen werden sollte.

**Handy-App:** Die Web-App mit Push kann die Store-App ersetzen, wenn der Push-Test auf echten Android- und
iPhone-Geräten besteht und ein E-Mail-Ersatz für nicht zugestellte Pushes eingerichtet ist (Teil D).

**Stundenzettel:** Smartplan hat laut Hilfe-Center keinen eigenen Stundenzettel (nur Druck der Stundenliste und Excel).
Inhalt und Form legt AKRO selbst fest (Vorschlag in Teil B, Abschnitt „Stundenzettel“).

## Paketliste

Reihenfolge nach den Schwerpunkten des Inhabers (Lohn, Stundenzettel, GPS) und nach Abhängigkeiten.
Jedes Paket wird wie bisher mit Tests, Browserprüfung und Eintrag in `FERTIGSTELLUNG.md` abgeschlossen.

| Paket | Inhalt | Katalog | Aufwand | Status |
|---|---|---|---|---|
| P0 | Fehler aus dem Abgleich: Admin-Abwesenheit bleibt „ausstehend“, Abwesenheiten deaktivierter Personen verschwinden, „Reaktivieren“ ohne Funktion, E-Mail nach Aktivierung änderbar, „als ungelesen markieren“ ohne Knopf, negative Werte im CSV als Text | C76, C41, C44, C24, D27, B69 | S | umgesetzt (`9ee9618`); C24 (E-Mail-Sperre) erst mit P9, weil Mitarbeitende ihre E-Mail heute nicht selbst ändern können |
| P1 | Lohn: Lohnarten, Personalnummer, Lohnart je Person und Arbeitsbereich, Zuschläge (Tage, Feiertage, Sonderdaten, Zeitblock auch über Mitternacht, Prozent oder Betrag), Lohn je Buchung mit Rechenweg, Lohnexport CSV mit und ohne Sätze | B47–B58, B63–B67 | L | umgesetzt (`8e6e865`); offen: Excel-Datei, Lohnexport-Verlauf, Lohnrecht für Manager, DATEV-Format |
| P2 | Stunden prüfen und genehmigen: Buchung ↔ Schicht, Genehmigungsstatus, „Stunden und Lohn“ als ein Bildschirm (aufklappbar, Bearbeiten-Dialog, Rot/Grün, Dezimalstunden), freier Zeitraum, Drucken | B28–B42 | L | umgesetzt (`0ff8e24`); offen: „Ist = Plan“ ohne Erfassung (Entscheidung), „nicht erschienen“, Pausen mit Uhrzeit, Aktivitätsprotokoll im Dialog |
| P3 | Stundenzettel und Leistungsnachweis je Kunde/Einsatzort als PDF, Monatsabschluss | B42, Teil B „Stundenzettel“ | M | umgesetzt (`5f4e78d`); offen: Monatsabschluss, elektronische Bestätigung |
| P4 | Zeitkonten: Soll mit Startdatum, laufender Saldo, Ausgleich, Ansicht für Mitarbeitende | B77–B88 | M | umgesetzt (`0de1cc7`); offen: Saldo im Lohnexport, Kappungsgrenzen |
| P5 | Abwesenheit wirkt auf Schichten, Stunden und Lohn; Abwesenheitsvergütung; Urlaubskonto | B59–B62, B87, C77–C81, C98–C112 | L | umgesetzt (`c21d5b3`); offen: Vergütung nach Durchschnitt statt Planstunden, halbe Urlaubstage im Antrag, Urlaubssperren |
| P6 | Planungsregeln je Person mit Verstoßliste (Höchststunden, Ruhezeit, Tage am Stück …), Veröffentlichungsdialog mit Änderungsliste, Bearbeitungsmodus | A42–A60, A70, A72 | L | offen |
| P7 | Vorlagen über mehrere Wochen, Kopieren von Block/Tag/Woche, Person aufnehmen und verteilen | A18–A32 | L | offen |
| P8 | Regelbasierter Assistent „Besetzung vorschlagen“ | A65–A67 | L | offen |
| P9 | E-Mail-Versand, Passwort vergessen, Benachrichtigungseinstellungen, Kalender-Abo, „Ich“-Seite | Teil D | L | offen |
| P10 | Stempel-Terminal mit persönlicher PIN, Live-Übersicht „Wer ist im Dienst“ | B9–B16, B24–B27 | M | offen |
| P11 | Mitarbeiterprofil mit Reitern, Zusatzfelder, Dokumente, Ein- und Austritt, Anonymisierung | Teil C | L | offen |
| P12 | Layout-Angleich: Navigation oben mit Glocke, Planansicht mit Seitenleiste – nach Durchsicht des echten Kontos | A, B, D „Layout“ | L | offen |

## Offene Fragen an den Inhaber

- Lohn: Welche Lohnsoftware oder welches Steuerbüro (z. B. DATEV)? Welche Zuschläge (Nacht, Sonntag, Feiertag) in welcher Höhe?
  Welche Lohnarten? Gibt es Festgehälter oder Minijobs? Die Hinweise zu § 3b EStG, EFZG, ArbZG und MiLoG in Teil B
  vom Steuerbüro bestätigen lassen. P1 wird so gebaut, dass AKRO Sätze und Zuschläge selbst einträgt.
- Stundenzettel: Inhalt, Unterschrift von Mitarbeiter oder Kunde, PDF?
- Was genau ändert AKRO gegenüber Smartplan ab?
- Handy-App: Reicht die Web-App mit Push, oder ist eine Store-App nötig?
- Welcher Smartplan-Tarif ist im AKRO-Konto aktiv? Davon hängt ab, was dort sichtbar ist.

## Lohn (P1) – so rechnet der Schichtplaner

- Grundlage sind die erfassten Zeitbuchungen (Ist) im Zeitraum, nach Buchungsdatum wie die Monatsauswertung.
  Ohne Buchung gibt es keinen Lohn; „Ist = Plan, solange nichts geändert ist“ (Smartplan, B35) folgt mit P2.
- Lohnart: die des Arbeitsbereichs der Schicht, sonst die der Person. Die Schicht ergibt sich aus dem Check-in
  oder aus der einzigen veröffentlichten Schicht der Person, die sich mit der Buchung überschneidet.
- Zuschlag: Minuten der Buchung im Zeitblock an passenden Tagen (Wochentag, Feiertag der Organisation oder
  Sonderdatum); ein Block gehört zu dem Tag, an dem er beginnt. Prozent beziehen sich auf die geltende Lohnart.
  Mehrere Zuschläge werden addiert – Vorrangregeln (z. B. Feiertag auf Sonntag) bildet AKRO über die Einstellungen ab.
- Pausen sind nur als Summe erfasst und werden anteilig auf die Zeitblöcke verteilt. Buchungen nur mit Dauer
  erhalten nur ganztägige Zuschläge.
- Zeitumstellung: Stoppuhr und Check-in zählen die echte Dauer, manuelle Von/Bis-Zeiten die Wanduhr.
- Lohndaten sieht und exportiert nur die Administration. Lohnkosten ohne Arbeitgeberanteile.

## Stunden prüfen (P2) und Stundenzettel (P3) – so arbeitet der Schichtplaner

- Jede Buchung gehört zu höchstens einer geplanten Schicht: über den Check-in oder als einzige veröffentlichte
  Schicht der Person, mit der sie sich überschneidet. „Stunden und Lohn“ zeigt je Schicht Plan, Ist, Abweichung
  und Status; Buchungen ohne Schicht stehen als eigene Zeile.
- Status: **genehmigt**, **offen** (noch nicht genehmigt), **nicht erfasst** (Schicht vorbei, keine Buchung),
  **geplant** (Schicht in der Zukunft), **läuft** (Stoppuhr). Anders als Smartplan zählt eine Schicht ohne Buchung
  nicht als gearbeitet; „Zeit wie geplant nachtragen“ erfasst sie mit einem Klick.
- Genehmigen dürfen Admins und Manager mit „Zeiterfassung bearbeiten“ am Standort und „Stunden einsehen“ für die
  Person; eigene Buchungen nur Admins. Ändern Prüfende eine fremde Buchung, gilt das sofort und bleibt mit
  Vorher/Nachher im Verlauf. Mitarbeitende beantragen Korrekturen wie bisher.
- Einstellung „Selbst erfasste Zeiten automatisch genehmigen“ (Einstellungen › Zeiterfassung), Vorgabe aus.
  Bei Einführung gelten alle abgeschlossenen Altbuchungen als genehmigt.
- Stundenzettel (PDF) je Person und Zeitraum mit Zuschlagsstunden, Nachweis (GPS, Stoppuhr, manuell), Status und
  Unterschriftsfeldern; Mitarbeitende erstellen ihren eigenen unter „Zeiterfassung“. Leistungsnachweis (PDF) je
  Einsatzort für den Kunden.

## Zeitkonten (P4) – so rechnet der Schichtplaner

- Einstellungen › Zeitkonten: einschalten, Berechnungsart **Ist − Soll** (Vorgabe), **Plan − Soll** oder **Ist − Plan**,
  je Person abweichend; Personen lassen sich ausnehmen. Sichtbarkeit für Mitarbeitende ist einstellbar (Vorgabe aus).
- Soll je Person mit Startdatum (Woche oder Monat, z. B. 40 h/Woche ab 01.01.); ein neuer Eintrag gilt ab seinem
  Datum. Beginnt oder endet ein Soll mitten in der Periode, zählt es anteilig nach Werktagen Mo–Fr.
- Ist = alle abgeschlossenen Buchungen (genehmigt und offen) plus bezahlte Abwesenheit (P5); Tage nach heute
  zählen mit Planstunden.
- Ausgleich (± Stunden mit Datum und Text), z. B. Überstunden ausbezahlt oder Übertrag bei Einführung.
- Sehen: Administration; Manager mit „Stunden einsehen“ für die Person; die Person selbst, wenn freigegeben.
  Ändern nur die Administration. Saldo als Spalte in „Stunden und Lohn“, eigener Stand unter „Zeiterfassung“.

## Abwesenheit wirkt (P5) – so arbeitet der Schichtplaner

- Beim Genehmigen (oder sofort genehmigten Eintragen) zeigt ein Dialog die gebuchten Schichten im Zeitraum. Je Schicht:
  **Stunden zählen** (bezahlt, Planstunden), **0 Stunden** oder **aus der Schicht nehmen** (Schicht wird wieder offen).
  Vorgabe aus der Abwesenheitsart (bezahlt → Stunden zählen). Optional ein Ausgleich in Stunden aufs Zeitkonto.
- „Aus der Schicht nehmen“ nur mit „Schichten bearbeiten“ am Standort oder als Administration; die Entscheidung je
  Schicht ändern Admins und Manager mit „Abwesenheiten entscheiden“.
- Bezahlte Abwesenheit erscheint in „Stunden und Lohn“ (Status „abwesend“), im Lohn als eigene Zeile mit dem
  Lohnart-Code der Abwesenheitsart (Einstellungen › Abwesenheiten), im Lohnexport, Stundenzettel und Zeitkonto.
- Wird die Genehmigung zurückgenommen oder die Abwesenheit gelöscht, entfallen Stunden und Lohn; eine bereits
  freigegebene Schicht bleibt offen. Altbestand (vor der Migration genehmigt) erscheint als „abwesend“ mit 0 Stunden,
  bis die Abwesenheit erneut entschieden wird.
- Genehmigt wird mit Person und Zeitpunkt gespeichert.

## Urlaubskonto (P5) – so rechnet der Schichtplaner

- Einstellungen › Urlaubskonto: einschalten, abgezogene Abwesenheitsart (z. B. „Urlaub“), Tage je Jahr (Vorgabe 30),
  Beginn des Urlaubsjahres (Vorgabe 01.01.), Zuteilung ganz zu Jahresbeginn oder monatlich ein Zwölftel,
  Übertrag ins nächste Jahr (optional mit Höchstgrenze), Wochentage ohne Abzug (Vorgabe Sa, So), Feiertage zählen
  (Vorgabe nein), Sichtbarkeit für Mitarbeitende (Vorgabe ja).
- Je Person abweichend: Tage je Jahr, Beginn (z. B. Eintritt – dann anteilig nach vollen Monaten), Übertrag,
  ohne Konto. Das Konto beginnt mit dem Urlaubsjahr, in dem es eingeschaltet wird; Resturlaub per „Saldo anpassen“.
- Genehmigter Urlaub wird abgezogen (genommen bis heute, geplant danach); beantragter Urlaub wird angezeigt, aber
  nicht abgezogen. Korrekturen in ganzen oder halben Tagen mit Kommentar, nur durch die Administration.
- Der Antrag zeigt „verfügbar · dieser Zeitraum · danach“. Kontoauszug je Urlaubsjahr. Übersicht „Urlaubskonten“
  unter Abwesenheiten für Administration und Manager mit „Abwesenheiten entscheiden“.

## Nächster Schritt

P6 (Planungsregeln je Person mit Verstoßliste, Veröffentlichungsdialog mit Änderungsliste, Bearbeitungsmodus).
Parallel, sobald die Zugangsdaten gesetzt sind: Erfassung im Konto nach den Regeln oben, offene Punkte klären,
Layout für P12 festhalten.

## Quellen (öffentlich, abgerufen 12.10.2026)

- Smartplan-Hilfe: [Export hours to Excel](https://smartplan-knowledge-base.helpscoutdocs.com/article/229-export-hours-to-excel),
  [Hours and salary](https://smartplan-knowledge-base.helpscoutdocs.com/article/374-introduction-hours-and-salary)
- [Smartplan im App Store](https://apps.apple.com/app/id1100134190)
- Verzeichnisse: [ki-syndikat.de](https://www.ki-syndikat.de/tools/smartplan/), [SoftGuide](https://www.softguide.de/programm/smartplan-1),
  [trusted.de](https://trusted.de/smartplan)
