# Übergabe – Smartplan-Abgleich P0 bis P6

Stand 12.10.2026. Dieses Dokument ist der Einstieg; Einzelheiten stehen in den verlinkten Dateien.

| | |
|---|---|
| Branch | `claude/wizardly-cerf-cxbutc` auf Basis von `master` `a9f5b9d`; `master` hat sich seither nicht bewegt, das Zusammenführen ist konfliktfrei |
| Eingespielt | **Nein.** Nichts davon läuft auf Netcup. Kein Pull Request angelegt. |
| Prüfstand | Ablauftests 1834/1834, Migrationstests 84/84, Unit-Tests (Lohn, PDF, Zeitkonto, Urlaub, Regeln, Check-in) grün, Produktions-Build erfolgreich, Browserprüfung je Paket bei 1366 und 375 px |
| Ziel | Smartplan (smartplanapp.com) mit eigenem Layout nachbauen; Schwerpunkte des Inhabers: Lohn, Stundenzettel, GPS-Check-in |

Weitere Dokumente:

- [`SMARTPLAN-ABGLEICH.md`](SMARTPLAN-ABGLEICH.md) – Plan, Paketliste P0–P12, Rechenregeln je Paket, offene Fragen.
- [`smartplan/`](smartplan/) – Funktionskatalog (385 Funktionen in vier Teilen) mit Abgleich gegen den Schichtplaner.
- [`FERTIGSTELLUNG.md`](FERTIGSTELLUNG.md) – Abnahmetabellen mit Nachweisen je Paket (neueste oben).
- [`../ANLEITUNG.md`](../ANLEITUNG.md) – Betrieb (Starten, Backup, Aktualisieren).

## Was umgesetzt ist

| Paket | Inhalt | Commits |
|---|---|---|
| P0 | Fehler aus dem Abgleich: Abwesenheit „direkt genehmigen“, Abwesenheiten deaktivierter Personen bleiben sichtbar, „Reaktivieren“, „als ungelesen markieren“, Zahlen im CSV als Zahlen (Formelschutz) | `9ee9618` |
| P1 | Lohn: Lohnarten, Personalnummer, Lohnart je Person und Arbeitsbereich, Zuschläge (Wochentage, Feiertage, Sonderdaten, Zeitblock, Prozent oder Betrag), Lohn je Buchung mit Rechenweg, Lohnexport CSV | `8e6e865`, `4346c44` |
| P2 | „Stunden und Lohn“: Plan/Ist je Schicht, Genehmigen, „Zeit wie geplant nachtragen“, Drucken; automatische Genehmigung einstellbar | `0ff8e24` |
| P3 | Stundenzettel je Person und Leistungsnachweis je Einsatzort als PDF | `5f4e78d` |
| P4 | Zeitkonten: Soll mit Startdatum (Woche/Monat), drei Berechnungsarten, Ausgleich, Saldo in „Stunden und Lohn“ und für Mitarbeitende | `0de1cc7` |
| P5 | Abwesenheit wirkt auf Schichten (bezahlt / 0 Stunden / austragen), Lohn mit Lohnart-Code, Stundenzettel, Zeitkonto; Urlaubskonto mit Anspruch, Übertrag, Korrekturen, Übersicht | `c21d5b3` und Folgekorrekturen |
| P6 | Planungsregeln je Person mit Verstoßliste im Wochenplan; Veröffentlichen mit Änderungsliste; Bearbeitungsmodus für veröffentlichte Pläne kommender Wochen | `b8cca24`, `8572300` und Folgekorrekturen |
| nebenbei | Anmeldeformulare senden per POST (Passwort nie in der Adresszeile); Testsuite gegen den Produktions-Build und mit `--nur=modul`; Vorschau mit Beispieldaten | `66b7f62`, `f2d8989`, `6c75b86` |

Wo im Programm: Navigation „Stunden und Lohn“ (`/hours`, `/payroll` leitet dorthin); Einstellungen › Planungsregeln,
Lohn, Zeitkonten, Urlaubskonto, Abwesenheiten (Lohnart-Code); Abwesenheiten › „Urlaubskonten“; Zeiterfassung ›
„Mein Stundenzettel“ und „Zeitkonto“; Wochenplan › Kasten „Regelverstöße“, „Veröffentlichen“, Weitere Aktionen ›
„Plan bearbeiten“.

Wer was darf (geprüft auf dem Server, getestet in `tests/*.ts`):

| Bereich | Sehen | Ändern |
|---|---|---|
| Lohn, Lohnexport, Lohnarten, Zuschläge | nur Administration | nur Administration |
| Stunden und Lohn (ohne Beträge) | Administration; Manager mit „Zeiterfassung einsehen“ am Standort und „Stunden einsehen“ für die Person | genehmigen und direkt ändern zusätzlich mit „Zeiterfassung bearbeiten“; eigene Buchungen nur Administration |
| Zeitkonto | Administration; Manager mit „Stunden einsehen“; die Person, wenn freigegeben | Administration |
| Urlaubskonto | Administration; Manager mit „Abwesenheiten entscheiden“; die Person, wenn freigegeben | Regeln und Korrekturen nur Administration |
| Abwesenheit „Person austragen“ | – | Administration oder „Schichten bearbeiten“ am Standort |
| Planungsregeln | Verstöße: Planung (Admin, Manager mit „Dienstplan ansehen“) | Regeln: Administration |
| Veröffentlichen, Plan bearbeiten | – | „Dienstplan veröffentlichen“ am Standort |

## Lokal prüfen

```
npm ci && npx prisma generate
npx tsc --noEmit && npx eslint src tests --quiet
npm run test:workflows                 # alle Abläufe gegen PGlite und eigenen Server (~15 min)
npx tsx tests/workflows.ts --nur=payroll,publishing   # nur einzelne Module (Namen in tests/workflows.ts)
npm run test:migration                 # jede Migration auf Altbestand
npm run test:payroll && npm run test:pdf && npm run test:accounts && npm run test:vacation && npm run test:rules
npm run build
npm run preview:test                   # Produktions-Build mit Beispieldaten auf Port 3310 (Zugang wird ausgegeben)
```

`preview:test` legt eine Testorganisation „AKRO Vorschau“ mit Lohnarten, Zuschlägen, Buchungen, Zeitkonto,
Urlaubskonto, Planungsregeln, einem Plan zum Bearbeiten (KW 43/2026) und einem Entwurf (KW 44/2026) an – nur im
Speicher, ohne echte Daten.

## Einspielen (Checkliste)

Neue Migrationen, in dieser Reihenfolge, alle additiv (keine Spalte und keine Tabelle wird entfernt):

| Migration | Wirkung auf Bestandsdaten |
|---|---|
| `20261012090000_payroll` | Lohnarten, Zuschläge, Personalnummer – leer |
| `20261013090000_time_approval` | **abgeschlossene Altbuchungen gelten als genehmigt**; laufende Stoppuhr bleibt offen; Schichtbezug nur aus dem Check-in |
| `20261014090000_time_accounts` | Zeitkonten zunächst aus |
| `20261015090000_absence_effects` | bereits genehmigte Abwesenheiten behalten ihren Status ohne Wirkung („abwesend“, 0 Stunden, bis neu entschieden) |
| `20261016090000_vacation_account` | Urlaubskonto zunächst aus |
| `20261017090000_planning_rules` | Regeln zunächst aus |
| `20261018090000_publishing` | veröffentlichte Pläne erhalten `publishedAt`; niemand ist im Bearbeitungsmodus |

1. Branch prüfen lassen und nach `master` zusammenführen (Pull Request auf Wunsch).
2. Backup der Betriebsdatenbank (Netcup-Verfahren per SSH, siehe `ANLEITUNG.md` › Backup).
3. Migrationsprobe an einer **Kopie** der Betriebsdaten: `DATABASE_URL=".../schichtplaner_kopie" npm run test:migration:copy`
   (bricht ab, wenn der Datenbankname nicht „copy“, „kopie“ oder „migtest“ enthält).
4. Einspielen wie bisher (`docker compose up -d --build` spielt die Migrationen beim Start ein), dann `docker compose ps` → `healthy`.
5. Kurzprüfung als Administration: Anmelden, Wochenplan öffnen, „Stunden und Lohn“ für den laufenden Monat, Lohnexport
   herunterladen, Einstellungen › Planungsregeln öffnen, eine Abwesenheit genehmigen (Dialog „Folgen der Abwesenheit“).
6. Rückweg: Die Migrationen ergänzen nur, der alte Code kommt mit den neuen Spalten und Tabellen grundsätzlich aus;
   zurückgespielt werden sie nicht. Ob der Start des alten Stands mit bereits eingespielten neueren Migrationen
   durchläuft, ist nicht getestet – sicherer Rückweg ist das Backup aus Schritt 2.

Neue Umgebungsvariablen braucht der Betrieb nicht.

## Nach dem Einspielen einrichten (Administration)

1. Einstellungen › Lohn: Lohnarten mit Stundensatz und Code, Personalnummern, Lohnart je Person oder Arbeitsbereich, Zuschläge.
2. Einstellungen › Abwesenheiten: je Art „bezahlt“ und Lohnart-Code für den Lohnexport.
3. Einstellungen › Zeiterfassung: „Selbst erfasste Zeiten automatisch genehmigen“ (Vorgabe aus).
4. Einstellungen › Zeitkonten: einschalten, Berechnungsart, Soll je Person mit Startdatum, Anfangssaldo als Ausgleich.
5. Einstellungen › Urlaubskonto: einschalten, Abwesenheitsart „Urlaub“, Tage je Jahr, Resturlaub je Person über
   „Saldo anpassen“ (Abwesenheiten › Urlaubskonten › Person).
6. Einstellungen › Planungsregeln: gewünschte Regeln einschalten, Abweichungen je Person.

## Offene Entscheidungen des Inhabers

- **Saldo im Zeitkonto:** heute Stand am Ende des gewählten Zeitraums (Tage nach heute zählen mit Planstunden, wie
  Smartplan) – oder Stand bis heute?
- **„Ist = Plan“:** Smartplan zählt eine Schicht ohne Erfassung als gearbeitet; hier heißt sie „nicht erfasst“ mit
  „Zeit wie geplant nachtragen“.
- **Lohn:** Lohnsoftware oder Steuerbüro (DATEV-Format?), Zuschläge und Sätze, Festgehälter/Minijobs; die Hinweise zu
  § 3b EStG, EFZG, ArbZG und MiLoG im Katalog Teil B vom Steuerbüro bestätigen lassen.
- **Stundenzettel:** Inhalt, Unterschrift von Mitarbeiter oder Kunde, Monatsabschluss.
- **Smartplan-Zugang** für den Abgleich im echten Konto (Layout für P12, offene Punkte im Katalog), siehe unten.
- Handy-App: reicht die Web-App mit Push, oder ist eine Store-App nötig? Welcher Smartplan-Tarif ist aktiv?

## Bewusst anders als Smartplan oder noch offen

- Bearbeitungsmodus nur für Wochen, die noch nicht begonnen haben (Check-in und Zeiterfassung nutzen den aktuellen
  Plan); „Bearbeitung verwerfen“ fehlt; „Stunden und Lohn“ zeigt für kommende Wochen den Planungsstand.
- Genehmigte Abwesenheit, „nicht verfügbar“ und Überschneidungen sperren das Einteilen hart (Smartplan: nur Regel).
- Bezahlte Abwesenheit zählt mit Planstunden der Schicht (Smartplan kennt auch Durchschnittswerte); halbe Urlaubstage im
  Antrag und Urlaubssperren fehlen.
- Lohn: kein Excel-Export, kein Exportverlauf, kein Lohnrecht für Manager, kein DATEV-Format.
- Planungsregeln: Stundenziel, „Stunden am Stück“, „von automatischer Planung ausschließen“ (erst mit P8),
  Wochentagsregeln (A58).

## Nächste Pakete

| Paket | Inhalt |
|---|---|
| P7 | Vorlagen über mehrere Wochen, Kopieren von Block/Tag/Woche, Person aufnehmen und verteilen |
| P8 | Regelbasierter Assistent „Besetzung vorschlagen“ (nutzt die Planungsregeln aus P6) |
| P9 | E-Mail-Versand, Passwort vergessen, Benachrichtigungseinstellungen, Kalender-Abo, „Ich“-Seite |
| P10 | Stempel-Terminal mit persönlicher PIN, Live-Übersicht „Wer ist im Dienst“ |
| P11 | Mitarbeiterprofil mit Reitern, Zusatzfelder, Dokumente, Ein- und Austritt, Anonymisierung |
| P12 | Layout-Angleich nach Durchsicht des echten Kontos |

Arbeitsweise je Paket (bewährt): Katalogzeilen lesen → Rechenkern als reine Funktion mit Unit-Test → Dienst und API mit
Rechteprüfung → Ablauftest in `tests/<paket>.ts` (in `tests/workflows.ts` eintragen) → Migrationstest → Oberfläche →
Vorschaudaten in `tests/preview.ts` und Browserprüfung bei 1366 und 375 px → Eintrag in `FERTIGSTELLUNG.md` und
`SMARTPLAN-ABGLEICH.md`.

## Smartplan-Zugang und Regeln

- Zugangsdaten nie in Chat, Code oder Repository – nur als Umgebungsvariablen `SMARTPLAN_EMAIL` und
  `SMARTPLAN_PASSWORD` in den Umgebungseinstellungen der Cloud-Sitzung (wirken erst in einer neuen Sitzung).
- Im echten Konto frei: lesen, Menüs, Formulare öffnen und abbrechen, Exporte herunterladen. **Vorher fragen:**
  speichern, veröffentlichen, Nachrichten/Push/E-Mails an Mitarbeitende, genehmigen, ablehnen, löschen,
  Einstellungen oder Abrechnung ändern.
- Bildschirmfotos und Exporte mit echten Personendaten bleiben außerhalb des Repositorys; der Katalog enthält nur
  Feldnamen und Abläufe.
