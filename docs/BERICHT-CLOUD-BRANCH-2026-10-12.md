# Bericht: Cloud-Branch `claude/wizardly-cerf-cxbutc` (Smartplan-Abgleich P0–P6)

Geprüft am 12.10.2026 (23:00–23:30) im externen Ordner `schichtplaner-bausteine`, lesend per
`git fetch` vom Fork `companyflow21/schichtplaner`, Prüfkette in einem eigenen Worktree
(`.claude/worktrees/cloud-review`, frisches `npm ci`), dazu ein lesender Review-Agent.
Nichts wurde zusammengeführt, verändert oder eingespielt.

## 1. Was der Branch enthält (bestätigt)

HEAD `d8c8a69`, **Basis `a9f5b9d` (29.09.2026)**, 27 Commits, 141 Dateien, +8006/−146 Zeilen,
7 neue Migrationen, 17 neue Prisma-Modelle/Enums. Die Pakete entsprechen der Beschreibung:

| Paket | Commit | Umfang | Inhalt (verifiziert im Code) |
|---|---|---|---|
| P0 Fehlerkorrekturen | `9ee9618` | 8 Dateien | Admin-Abwesenheit direkt genehmigen, Abwesenheiten Deaktivierter sichtbar, „Reaktivieren“, „als ungelesen“, CSV-Negativzahlen |
| Sicherheitsfix | `66b7f62` | 3 Dateien, 3 Zeilen | `method="post"` an Login-, Registrierungs- und Aktivierungsformular (vorher GET-Submit vor Hydration → E-Mail/Passwort in der URL). **Betrifft das Original und die Hauptlinie ebenso; konfliktfrei einzeln übernehmbar.** |
| P1 Lohn | `8e6e865`, `4346c44` | 25 Dateien, +1543 | Lohnarten (Cent-Integer), Personalnummer, Lohnart je Bereich, Zuschläge (Tage/Feiertage/Sonderdaten, Block über Mitternacht), Seite „Lohn“, CSV-Export; nur Admin (`requireAdmin` in allen `/api/payroll/**`) |
| P2 Stundenfreigabe | `0ff8e24` | 31 Dateien, +1010/−318 | Seite „Stunden und Lohn“, Genehmigen (Admin; Manager mit EDIT_TIME am Standort + VIEW_HOURS für die Person), Korrekturantragsweg bleibt |
| P3 PDF | `5f4e78d` | 10 Dateien | Stundenzettel je Person, Leistungsnachweis je Einsatzort |
| P4 Zeitkonten | `0de1cc7` | 25 Dateien, +928 | Soll mit Startdatum, drei Rechenarten, Gutschriften/Abzüge, Saldo |
| P5 Abwesenheit/Urlaub | `c21d5b3` | 41 Dateien, +1606 | Abwesenheit wirkt auf Schichten/Stunden/Lohn, Urlaubskonto mit Regeln je Person |
| P6 Regeln | `b8cca24` | 18 Dateien, +885 | Planungsregeln (ArbZG-Vorgaben, alle aus), Verstoßliste im Wochenplan |
| P6 Veröffentlichen/Bearbeiten | `8572300`, `1340ab8` | 26 Dateien, +646 | Veröffentlichen-Dialog mit Änderungsliste, Bearbeitungsmodus mit eingefrorener Sicht – **ohne „Verwerfen“** |

## 2. Testaussagen – auf diesem Rechner reproduziert

| Prüfung (Cloud-Branch, Worktree, Ports 3414/55548) | Behauptet | Ergebnis hier |
|---|---|---|
| `npx tsc --noEmit --incremental false` | 0 Fehler | **0 Fehler** |
| `npm run lint` | – | **0 Fehler, 25 Warnungen** (Referenz) |
| `npm run test:migration` | 84/84 | **84/84** |
| `npm run test:workflows` (vollständig, 21 Module) | 1834/1834 | **FINAL SUCCESS 1834/1834** |
| Build, Browserprüfung, Unit-Tests Lohn/PDF/Zeitkonto/Urlaub/Regeln | laut Doku grün | nicht wiederholt |

Bestehende Tests wurden nicht abgeschwächt (Diff der `tests/` enthält nur Hinzufügungen; in
`workflows.ts` wurde die Registrierung auf ein Array umgestellt).

## 3. Das Kernproblem: falsche Basis

Die Cloud-Übergabe (`docs/UEBERGABE.md:7`) schreibt: Basis `master` `a9f5b9d`, „`master` hat sich
seither nicht bewegt, das Zusammenführen ist konfliktfrei“. Das ist falsch:

- Die App lebt seit dem 01.10. auf `feat/plan-delete-assign-copy-pdf`; Netcup läuft `1d2046d`
  (06.10.) mit 10 Migrationen. Auf dem Fork steht dieser Branch bei `2e116d3`, lokal im Original
  bei `c36a59f` – der Original-Chat hat seine letzten Commits nicht gepusht, und `master` auf dem
  Fork ist seit dem 29.09. eingefroren. Die Cloud konnte den echten Stand nicht sehen.
- Seit `a9f5b9d` hat die Hauptlinie **85 Commits**: Design-Paket, Subunternehmer-Platzhalter,
  Mitarbeiter-/Schichtlöschung mit Historie (`userId` nullable, `FormerEmployee`), Parallelzugriffs-
  Fixes, Bundesland je Einsatzort, Namensformat – und das heutige Paket (Lebenszyklus,
  Konfliktprüfung, Design-Stufe 1, Endstand `2c6285c`).
- Probe-Merge Cloud → Integrationsstand `a794955` (ohne Arbeitsbaum): **30 echte Konfliktdateien**,
  darunter `prisma/schema.prisma`, `planning.ts`, `shift-service.ts`, `overview.ts`,
  `schedule-toolbar.tsx`, `schedule-grid.tsx`, `shift-card.tsx`, alle Plan-, Buchungs-, Antrags-
  und Zeit-Routen, `publish-dialog.tsx` (in beiden Linien neu angelegt).

### P6 ist eine zweite Implementierung von Baustein 1/2

| | Cloud (P6) | Hauptlinie (heute) |
|---|---|---|
| Status | `Schedule.editing` (bool), `publishedAt` (geschrieben, nie gelesen) | `editingSince`, `editingById`; Status abgeleitet DRAFT/PUBLISHED/EDITING |
| Snapshot | Modell `ScheduleSnapshot`, Tabelle `schedule_snapshots`: `id`, `scheduleId`, `shifts` Json – **mit Namen und Profilbild**, bleibt dauerhaft | gleicher Modell- und Tabellenname, andere Spalten (`scheduleId` PK, `data`): nur IDs, wird beim Veröffentlichen/Verwerfen gelöscht |
| Verwerfen | fehlt (laut Cloud-Doku offen) | vorhanden (`DELETE …/editing`, begonnene Schichten geschützt) |
| Bearbeiten laufende Woche | gesperrt | erlaubt mit Hinweis |
| Recht zum Start | PUBLISH_SCHEDULE | EDIT_SHIFTS |
| Eingefrorene Sicht | 4 Lesepfade; Lücken in report/access/messages/hours | 6 Lesepfade inkl. Auswertung/CSV |
| Migration | `20261018090000_publishing` | `20261012120000_schedule_editing` |

Nach einer Zusammenführung würde die Cloud-Migration mit „relation `schedule_snapshots` already
exists“ abbrechen – und weil die Migrationen beim Container-Start laufen, wäre das ein
**Startausfall der App**.

### Migrations-Dublette

`20261012090000_payroll` (Cloud) hat denselben Zeitstempel wie `20261012090000_branch_holiday_state`
(Hauptlinie). Solange die Cloud-Migrationen nirgends angewandt sind (laut Cloud-Doku: nicht
eingespielt), lassen sie sich umbenennen.

## 4. Fachliche und technische Risiken (Review)

**P0 – vor jeder Zusammenführung**
1. Doppelte Tabelle/Modell `ScheduleSnapshot` mit anderer Struktur (siehe oben).
2. Falsche Produktionsannahme: Direktes Einspielen des Cloud-Branches ist ausgeschlossen.

**P1 – fachlich klären, bevor etwas davon produktiv geht**
1. **Die Stundenfreigabe steuert den Lohn nicht:** `payrollData` filtert nicht nach `approvedAt`;
   Zeitkonten zählen „genehmigt und offen“. Ungenehmigte Stunden werden mitbezahlt und exportiert.
2. **Feiertagszuschläge** nutzen die organisationsweite `holidays`-Tabelle, nicht das Bundesland je
   Einsatzort der Hauptlinie (NRW/Thüringen parallel). Ohne konfigurierte Org-Feiertage rechnet der
   Zuschlag still 0.
3. **Zuschlagslogik** (Block gehört zum Starttag; alle Zuschläge addieren sich ohne Vorrang) ist keine
   § 3b-EStG-Logik – wie die Cloud selbst schreibt: vom Steuerbüro freigeben lassen.
4. **Nach dem Port zu erwarten:** Die Hauptlinie hat `userId` bei `Booking`, `TimeRecord`,
   `Checkin` nullable (Löschhistorie, Sub-Platzhalter); Cloud-Code wie `publishing.ts:25/38`
   (`b.user.firstName`) und `payroll-service.ts:107` setzt `userId` voraus → Laufzeitfehler bei
   Platzhaltern, Zeiten gelöschter Personen fallen still aus dem Lohn.

**P2**
- Rundung je Buchung/Zeile; im Export weichen „Stunden × Satz“ vom Betrag ab.
- Migration `time_approval` markiert alle Altbuchungen pauschal als genehmigt (ohne Prüfer).
- Snapshot speichert dauerhaft Namen/Profilbild (Datenschutz, widerspricht `FormerEmployee`).
- Regelverstoß-Antwort nennt Managern `shiftIds` fremder Standorte.
- Manuelle Zeiten in Umstellungsnächten ohne Test (nur Stoppuhr getestet).

## 5. Was erhaltenswert ist

- **Sofort übernehmen (konfliktfrei):** Sicherheitsfix `66b7f62`. Die Lücke besteht im Original und
  in der Hauptlinie.
- **Mit Prüfung übernehmen:** P0-Korrekturen `9ee9618` (8 Dateien; Konflikte mit den Abwesenheits-
  und Postfach-Routen der Hauptlinie wahrscheinlich, aber klein).
- **Portieren, nicht mergen:** P1–P5 (Lohn, Freigabe, PDF, Zeitkonten, Abwesenheit/Urlaub) und
  die Planungsregeln aus P6 – es gibt dafür kein Gegenstück in der Hauptlinie. Voraussetzung:
  Anpassung an `userId: string | null`/`FormerEmployee`, Feiertage je Einsatzort
  (`branchHolidays`), neue Migrationszeitstempel hinter `20261012120000`, ein
  Testauswahl-Mechanismus (`TEST_ONLY` kebab-case) statt zwei.
- **Verwerfen:** Cloud-P6 Veröffentlichen/Bearbeitungsmodus (`publishing.ts`, `publish-dialog.tsx`,
  Routen `[id]/edit`/`[id]/publish`, Migration `publishing`, Felder `editing`/`publishedAt`).
  Die Hauptlinie ist vollständiger (Verwerfen, Platzhalter, Löschhistorie, Auswertung).
  Übernehmen daraus nur zwei Ideen: Regelverstöße im Veröffentlichen-Dialog anzeigen und das
  Regelverstoß-Panel neben dem Konfliktpanel einbauen.

## 6. Empfohlenes Vorgehen

1. **Original-Chat pusht seinen aktuellen Stand** (`feat/plan-delete-assign-copy-pdf` ≥ `c36a59f`)
   auf den Fork, damit Cloud-Sitzungen künftig auf der richtigen Basis aufsetzen. Jede Cloud-
   Aufgabe nennt ausdrücklich diesen Branch als Basis.
2. Reihenfolge der Übernahme in die Hauptlinie: erst das heutige Paket (`2c6285c`, Übergabe in
   `docs/UEBERGABE-BAUSTEINE.md`), dann `66b7f62`, dann `9ee9618`, dann der Port P1–P5 + Regeln.
3. Der Port ist Arbeit für Agenten im externen Ordner: 5 Pakete, ~8000 Zeilen, 7 Migrationen,
   30 Konfliktdateien. Realistisch ein bis zwei Arbeitstage mit Prüfkette je Paket; nicht als ein
   großer Merge, sondern paketweise mit eigener Migration und eigenem Test.
4. **Entscheidungen von AKRO vorher:** (a) Soll die Freigabe den Lohn steuern (nur genehmigte
   Stunden werden bezahlt)? (b) Zeitkonto-Saldo: Stand am Ende des Zeitraums (Smartplan) oder bis
   heute? (c) „Ist = Plan“ ohne Erfassung (Smartplan) oder „nicht erfasst“ mit Nachtragen (Cloud-
   Empfehlung, MiLoG)? (d) Zuschlagssätze und Lohnarten vom Steuerbüro.

## 7. Bewertung in einem Satz

Die Cloud hat in einem Tag fachlich viel und sauber getestet gebaut (alle Zahlen stimmen), aber auf
einem zwei Wochen alten Stand – P6 doppelt den heutigen Baustein 1/2, und die Lohnlogik kennt die
Löschhistorie, Sub-Platzhalter und Standort-Feiertage der Hauptlinie nicht. Nichts davon darf
direkt eingespielt werden; P1–P5 und die Planungsregeln sind es wert, auf die Hauptlinie portiert zu
werden.
