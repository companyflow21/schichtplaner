# Externer Arbeitsordner: Bausteine „Smartplan-Paket 1“

Angelegt am 12.10.2026 als unabhängiger Git-Klon von `../schichtplaner`
(Basis: `baa88d9` auf `feat/plan-delete-assign-copy-pdf`).
Arbeitsbranch hier: `feat/plan-lifecycle-diff-conflicts`.

## Zweck

Die drei Bausteine aus `docs/smartplan-analyse-2026-10-11.md` (Abschnitt „Erstes
Umsetzungspaket“) werden hier vollständig vorbereitet: Code, Tests, Doku, Patch.
Die Übergabe in das eigentliche Projekt erfolgt später als Ganzes.

## Regeln für diesen Ordner

- Das Original `../schichtplaner` wird **nicht** verändert. Keine Dateien dorthin
  kopieren, keine Git-Operationen dort ausführen, `origin` nur zum Lesen (`git fetch`).
- Eigene Testports, damit nichts mit dem Original kollidiert (Original: 3305/55439,
  `test:push` 55441, `load-local` 3337/55447):
  Agent Lebenszyklus `TEST_PORT=3405`/`TEST_DB_PORT=55539`, Agent Konflikte 3406/55540,
  UI-Agent 3407/55541, Hauptagent 3408/55542; lokale Vorschau auf Port 3447.
- Umsetzungsagenten arbeiten in eigenen Worktrees unter `.claude/worktrees/`; der
  Hauptagent integriert deren Branches hier und führt die gemeinsamen Prüfungen aus.
- Keine `.env` aus dem Original übernehmen. Tests laufen in flüchtigem PGlite.
- Vollständige Testläufe (`npm run test:workflows`) nie gleichzeitig mit
  Quellcodeänderungen oder Builds in diesem Ordner starten.
- Die Fachregeln aus `CLAUDE.md` gelten unverändert.

## Fachliche Entscheidungen (AKRO, 12.10.2026)

1. **Mitarbeitersicht während „Bearbeitung“ ist eingefroren.** Mitarbeitende sehen bis
   zur Veröffentlichung exakt den Stand des Snapshots (Wochenplan, Mein Dienstplan,
   Startseite, Monat, PDF/CSV). Anträge und Tausch für diese Woche sind währenddessen
   gesperrt. Check-in und Zeiterfassung bleiben auf Live-Daten; beim Bearbeiten der
   laufenden Woche warnt die App.
2. **Direkte Änderungen an veröffentlichten Plänen bleiben erlaubt** (sofortige
   Einzelmitteilung wie bisher). „Bearbeitung starten“ ist der Weg für größere
   Umplanungen mit Diff, gebündelter Mitteilung und Verwerfen.
3. **Zeitliche Überschneidung wird von Sperre auf Hinweis umgestellt** (wie Smartplan):
   Einteilen trotz Überschneidung ist nach ausdrücklicher Bestätigung möglich; in der
   Wochenansicht wird sie rot markiert. Gilt für Personen und Sub-Platzhalter.

Technische Festlegungen des Hauptagenten (reversibel): Status abgeleitet aus
`isPublic` + `editSnapshot` (kein Rename), Snapshot beim Start der Bearbeitung,
Konfliktprüfung als Lesedienst ohne Schemaänderung, Severity im Konfliktpanel nach Art
(Überschneidung/Abwesenheit/inaktiv/nicht verfügbar = rot; Qualifikation/Tätigkeit/
Arbeitsbereich/Verfügbarkeitsfenster = orange).

## Zuständigkeiten (zwei Sitzungen, Stand 12.10.2026)

- **Sitzung „Dienstplan App“ (Integration):** Bausteine 1–3 inkl. Oberfläche
  (Statusbalken mit Bearbeiten/Veröffentlichen/Verwerfen, Veröffentlichen-Dialog mit
  Diff und Benachrichtigungs-Checkbox, Konfliktpanel/-markierung), eingefrorene
  Mitarbeitersicht, Überschneidung → Hinweis. Merges in
  `feat/plan-lifecycle-diff-conflicts` nur durch diese Sitzung, nacheinander, mit
  gemeinsamen Prüfungen.
- **Sitzung „Design Baustein“:** Design-Stufe 1 ausschließlich auf
  `feat/design-stufe-1` (Hauptnavigation, Wochenraster mit Heute-Markierung,
  Schicht-Dialog, Bestätigungsdialoge mit Folgen, Erklärtexte, Schrift/Kontrast),
  Ports ab 3409/55543, Vorschau ab 3448. Berührungspunkte in `schedule-toolbar.tsx`,
  `schedule-grid.tsx`, `shift-card.tsx`, `api/dashboard/route.ts` und
  `workforce/dashboard.tsx` werden vor dem Merge gemeldet.
- Keine direkten Dateiänderungen im Hauptarbeitsbaum; Umsetzung nur in
  Worktrees/Branches. Nichts aus dem Klon ins Original oder nach Netcup einspielen,
  bevor AKRO die Übergabe freigibt.

## Reihenfolge

1. Plan-Lebenszyklus (DRAFT / PUBLISHED / EDITING, eingefrorene Mitarbeitersicht, Verwerfen)
2. Veröffentlichen-Dialog mit Änderungs-Diff und abwählbarer Benachrichtigung
3. Live-Konfliktprüfung mit Inline-Markierung und Sprung zur Schicht
4. Design-Stufe 1 nach `docs/smartplan-design-2026-10-12.md` (Hauptnavigation,
   Wochenraster mit Heute-Markierung und „Heute“-Knopf, Schicht-Dialog, Statusbalken)
   sowie die dort als „billig und wirksam“ genannten Punkte (Bestätigungsdialoge mit
   Folgen, Löschen rot abgesetzt, ⓘ-Erklärtexte, handlungsorientierte Warnungen,
   größere Schrift/mehr Kontrast). Stufe 2 und 3 sind nicht beauftragt.

## Übergabe

Am Ende: ein Branch mit nachvollziehbaren Commits, `git format-patch` gegen die
Basis, Prüfnachweise und ein Übergabetext in `docs/UEBERGABE-BAUSTEINE.md`.

## Port des Cloud-Branches (ab 13.10.2026, Entscheidung AKRO vom 12.10. spät)

Grundlage: `docs/BERICHT-CLOUD-BRANCH-2026-10-12.md`. Der Cloud-Branch `cloud/wizardly-cerf-cxbutc`
(Basis `a9f5b9d`) wird nicht gemerged, sondern paketweise per Cherry-pick auf die Hauptlinie
portiert; Cloud-P6 „Bearbeitungsmodus/Veröffentlichen“ wird verworfen (Doppelung von Baustein 1/2).
Integration jetzt durch die Design-Sitzung (die integrierende Sitzung ist beendet).

| Schritt | Cloud-Commits | Agent / Ports | Status |
|---|---|---|---|
| S1 Sicherheitsfix + P0 | 66b7f62, 9ee9618 | sonnet, 3415/55549 | läuft |
| S2 P1 Lohn | 8e6e865, 4346c44, 6c75b86 | opus, 3416/55550 | läuft |
| S5 Planungsregeln (P6 ohne Bearbeitungsmodus) | b8cca24, bc7dd6e, 119d35a | 3417/55551 | nach S1 |
| S3 P2 Freigabe + P3 PDF | 0ff8e24, d35d168, 5f4e78d | opus, 3418/55552 | nach S2 |
| S4 P4 Zeitkonten + P5 Abwesenheit/Urlaub | 0de1cc7, c21d5b3, ef304e8, 8b69405 | opus, 3419/55553 | nach S3 und S5 |
| Abschluss | Gesamtprüfung, Browser-Tests, Übergabe, Bundle/Patches | Hauptagent | – |

Feste Regeln für den Port: Migrationen umbenennen (`20261013100000_payroll`, `…110000_time_approval`,
`…120000_time_accounts`, `…130000_absence_effects`, `…140000_vacation_account`,
`…150000_planning_rules`); `userId` nullable (`FormerEmployee`, Platzhalter) berücksichtigen;
Feiertage je Einsatzort (`branchHolidays`); Namen über `formatName`; Tests im Hauptlinien-Stil
(`TEST_ONLY`, kebab-case). Vorläufige Fachannahmen bis AKRO entscheidet: Freigabe steuert den Lohn
nicht; Zeitkonto-Saldo bis Ende des Zeitraums; „nicht erfasst“ mit Nachtragen statt „Ist = Plan“;
Lohnsätze und Zuschläge trägt AKRO selbst ein.
