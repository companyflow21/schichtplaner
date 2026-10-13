# Übergabe: Port der Cloud-Pakete P0–P5 und Planungsregeln auf die Hauptlinie

Stand 13.10.2026, Branch `feat/plan-lifecycle-diff-conflicts` im externen Arbeitsordner
`schichtplaner-bausteine`. Grundlage: `docs/BERICHT-CLOUD-BRANCH-2026-10-12.md` und die
Entscheidung von AKRO (12.10.2026 spät), den Cloud-Branch `claude/wizardly-cerf-cxbutc`
(Basis `a9f5b9d`) **nicht zu mergen, sondern paketweise zu portieren** und den
Cloud-Bearbeitungsmodus (P6-Teil „Veröffentlichen/Bearbeiten“) zu verwerfen, weil die
Hauptlinie ihn mit Baustein 1/2 vollständiger hat. Nichts wurde in das Original
`schichtplaner` oder nach Netcup eingespielt.

Vorgehen je Paket: eigener Agent in eigenem Worktree, `git cherry-pick -x` der
Cloud-Commits, Konflikte zugunsten der Hauptlinie, Anpassung an deren Regeln
(gelöschte Personen `userId = null`/`FormerEmployee`, Sub-Platzhalter, Feiertage je
Einsatzort, Namensformat, Plan-Lebenszyklus), Tests im Hauptlinien-Stil, danach Merge
und Nachprüfung durch den Hauptagenten.

## Migrationen (alle additiv, neu nummeriert hinter `20261012120000_schedule_editing`)

| Migration | Inhalt | Datenänderung am Bestand |
|---|---|---|
| `20261013100000_payroll` | Lohnarten, Zuschläge, Personalnummer, Lohnart je Person/Arbeitsbereich | keine |
| `20261013110000_time_approval` | Genehmigung je Zeitbuchung, Schichtbezug, Einstellung Auto-Genehmigung | `approvedAt = updatedAt` für alle abgeschlossenen Altbuchungen (ohne Prüfer, Anzeige „automatisch übernommen“); `shiftId` aus Check-ins |
| `20261013120000_time_accounts` | Zeitkonten (Soll mit Startdatum, Rechenart, Gutschriften) | keine |
| `20261013130000_absence_effects` | Wirkung genehmigter Abwesenheit je Schicht | Altbestand genehmigter Abwesenheiten erscheint als „abwesend“ mit 0 Stunden |
| `20261013140000_vacation_account` | Urlaubskonto mit Regeln je Organisation/Person | keine |
| `20261013150000_planning_rules` | Planungsregeln je Organisation, Abweichungen je Person | keine (alle Regeln aus) |

Die Cloud-Migration `20261018090000_publishing` und das Cloud-Modell `ScheduleSnapshot` sind
**nicht** übernommen (Kollision mit `schedule_snapshots` der Hauptlinie).

## Was jetzt funktioniert

### Sicherheitsfix und P0 (Cloud `66b7f62`, `9ee9618`; Merge `08069d5`)
- Login-, Registrierungs- und Aktivierungsformular senden per POST. Vorher landeten E-Mail
  und Passwort bei einem Absenden vor dem Laden der Seite in der Adresszeile (Verlauf,
  Proxy-Logs). Regressionstest in `tests/abgleich-fixes.ts`. **Die Lücke besteht im Original
  und auf Netcup, bis dieser Stand übernommen ist.**
- CSV-Export: negative Zahlen bleiben Zahlen (`src/lib/csv.ts`); Abwesenheiten deaktivierter
  Personen bleiben der Administration sichtbar (nur lesend); Leitung kann Abwesenheiten direkt
  genehmigen; Nachrichten lassen sich als ungelesen markieren. „Reaktivieren“ war in der
  Hauptlinie bereits vorhanden.

### P1 Lohn (Cloud `8e6e865`, `4346c44`, `6c75b86`; Merge `588dbb9`)
- Lohnarten (Stundenlohn in Cent, Code für die Lohnsoftware), Personalnummer und
  Standard-Lohnart je Person, Lohnart je Arbeitsbereich (geht vor), Zuschläge nach
  Wochentagen/Feiertagen/Sonderdaten mit Zeitblock auch über Mitternacht, Prozent oder Betrag
  je Stunde; Lohnexport als CSV. Rechenregeln in `docs/AKRO-ERWEITERUNG.md` §8.
- Nur Administration (`requireAdmin` auf allen `/api/payroll/**`, Tests 403/404).
- Hauptlinien-Anpassungen: Zeiten gelöschter Personen als eigene Zeile „gelöscht“ (Name aus
  `FormerEmployee`, keine Personalnummer/Lohnart mehr – vor dem Löschen abrechnen);
  Platzhalter haben keine Zeiten; Feiertagszuschläge über `holidaysForRecord()` nach dem
  Bundesland des Einsatzorts, ohne Einsatzort Organisationsfeiertage; fehlendes Bundesland →
  Zuschlag 0 mit sichtbarem Hinweis und Link.
- Bekannt und unverändert: Rundung je Buchung auf Cent; im Export kann „Stunden × Satz“ um
  Cent vom Betrag abweichen. Kein Monatsabschluss – geänderte Sätze wirken rückwirkend.

### P2 Stunden prüfen und genehmigen, P3 Stundenzettel/Leistungsnachweis (Cloud `0ff8e24`, `d35d168`, `5f4e78d`; Merge `8ae705b`)
- Eine Seite „Stunden und Lohn“ (ersetzt die Lohnseite, `/payroll` leitet um): je Person und
  Schicht Plan, Ist, Abweichung, Status (genehmigt / offen / nicht erfasst / geplant / läuft /
  automatisch übernommen); Genehmigen je Buchung oder alle offenen, Rücknahme, Bearbeiten,
  „Zeit wie geplant nachtragen“, Druckansicht. Einstellung „Selbst erfasste Zeiten
  automatisch genehmigen“ (Standard aus) im Bereich Zeiterfassung.
- Rechte: Genehmigen durch Administration oder Manager mit „Zeiterfassung bearbeiten“ am
  Standort **und** „Stunden einsehen“ für die Person; eigene Buchungen nur Administration;
  Lohnspalten/Export nur Administration. Korrektur-Anträge der Mitarbeitenden unverändert.
- Stundenzettel je Person (Plan, Beginn, Ende, Pause, Stunden, Stunden je Zuschlag ohne
  Beträge, Nachweis GPS/Stoppuhr/manuell, Status, Unterschriftsfelder; Mitarbeitende unter
  „Zeiterfassung“) und Leistungsnachweis je Einsatzort als PDF.
- Hauptlinien-Anpassungen: gelöschte Personen als eigene Zeile (genehmigen ja, ändern 409,
  kein Nachtragen, kein Stundenzettel); Schichten nur mit Platzhaltern erzeugen kein „nicht
  erfasst“; bei Plänen in Bearbeitung kommt die Planspalte für Nicht-Planer aus dem
  eingefrorenen Stand (`frozenPlans()`), Ist und Check-in bleiben live.
- Regeln in `docs/AKRO-ERWEITERUNG.md` §9.

### Planungsregeln (Cloud `b8cca24`, `bc7dd6e`, `119d35a`; Merge `4e5e8c6`)
- Einstellungen › Planungsregeln (Administration): Mindest-/Höchststunden je Woche/Monat,
  Höchststunden am Tag, Ruhezeit, Arbeitstage am Stück und je Woche, keine einzelnen
  Arbeits-/freien Tage, Wochenenden in Folge, freier Werktag je Wochenendtag; Vorbelegung nach
  ArbZG (48 h/Woche, 10 h/Tag, 11 h Ruhezeit), alle Regeln standardmäßig aus; Abweichungen je
  Person.
- Wochenplan: Panel „Regelverstöße“ (orange, Hinweise – Einteilen und Veröffentlichen bleiben
  möglich) direkt unter dem Konfliktpanel, Sprung zur Karte; Veröffentlichen-Dialog zeigt
  „N Regelverstöße“. Gezählt werden alle Standorte und Entwürfe; genehmigte Abwesenheiten
  ausgenommen; Platzhalter und gelöschte Personen nie.
- Standortfremde Schichten werden Managern ohne Recht dort nicht benannt (wie Konfliktpanel).
- Offen (fachlich): Die Hauptlinie hat bereits Arbeitszeit-Hinweise (`src/lib/worktime.ts`,
  Mitarbeiteransicht) mit teils gleichen Prüfungen und anderen Texten; zusammenlegen oder
  beides lassen.

### P4 Zeitkonten, P5 Abwesenheit wirkt / Urlaubskonto
_(wird nach dem Merge von S4 ergänzt)_

## Vorläufige Fachannahmen (von AKRO zu bestätigen)
1. Die Genehmigung steuert Lohn, Export und Zeitkonto **nicht** – ungenehmigte Stunden werden
   mitbezahlt. Ansatzpunkt für „nur genehmigte Stunden“: `payrollData()` in
   `src/lib/payroll-service.ts`, Filter `approvedAt: { not: null }` (wirkt auf Lohn, Export
   und Zuschlagsstunden im Stundenzettel).
2. Zeitkonto-Saldo = Stand am Ende des gewählten Zeitraums (Tage nach heute mit Planstunden,
   wie Smartplan).
3. Geplante Schicht ohne Erfassung ist „nicht erfasst“ und lässt sich wie geplant nachtragen
   (kein stilles „Ist = Plan“; Mindestlohngesetz verlangt tatsächliche Aufzeichnung).
4. Lohnarten, Sätze, Zuschlagshöhen und die steuerliche Behandlung (§ 3b EStG) trägt AKRO mit
   dem Steuerbüro ein; die App gibt nichts vor.
5. Fehlt einem Einsatzort das Bundesland, gibt es keinen Feiertagszuschlag (auch nicht an
   bundesweiten Feiertagen) – alternativ bundesweite Feiertage annehmen (eine Zeile in
   `holidaysForRecord`).
6. Personalnummer/Lohnart gehen beim Löschen einer Person verloren (Datensparsamkeit) – vor
   dem Löschen abrechnen, oder `FormerEmployee` um die Personalnummer erweitern.

## Nachweise
_(Gesamtabnahme nach S4, siehe unten; Zwischenstände:)_
- `1238bc3` (Regeln + Lohn + P0): vollständige Workflow-Suite **3490/3490**, Lint 0/25,
  Migration 75/75, Lohn-Unit 39/39, Regeln-Unit 12/12.
- `8ae705b` (+ Freigabe/PDF): Lint 0/25, Migration 84/84, PDF-Unit 14/14, Module
  permissions/hours/timesheet/payroll/abgleich-fixes/planning-rules grün.
- Testbefund: Das Modul `messaging` besteht nur nach `permissions` (verdeckte
  Reihenfolge-Abhängigkeit, auch auf dem Stand vor dem Port; in der Gesamtsuite gegeben).

## Übernahme in das Original
Wie in `docs/UEBERGABE-BAUSTEINE.md` beschrieben (Branch holen, mergen, Prüfkette, Sicherung,
Migrationsprobe auf Kopie, Einspielen). Zusätzlich: Die sechs neuen Migrationen sind nirgends
angewandt; die Cloud-Migrationsnamen (`20261012090000_payroll` …) dürfen nie parallel dazu
eingespielt werden. Den Fork-Branch `master` nicht mehr als Basis für Cloud-Aufgaben nutzen;
der Original-Chat soll `feat/plan-delete-assign-copy-pdf` pushen.
