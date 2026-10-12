# Übergabe: Smartplan-Paket 1 (Plan-Lebenszyklus, Veröffentlichen-Diff, Konfliktprüfung)

Stand 12.10.2026, Branch `feat/plan-lifecycle-diff-conflicts` im externen Arbeitsordner
`schichtplaner-bausteine` (unabhängiger Klon, Basis `c36a59f` des Originals). Nichts wurde
in das Original `schichtplaner` oder nach Netcup eingespielt. Vorgabe: `docs/smartplan-analyse-2026-10-11.md`
(Abschnitt „Erstes Umsetzungspaket“); Gestaltung: `docs/smartplan-design-2026-10-12.md`.
Design-Stufe 1 der parallelen Sitzung ist auf demselben Branch integriert und in
`docs/UEBERGABE-DESIGN-STUFE-1.md` beschrieben.

## Fachliche Entscheidungen von AKRO (12.10.2026)

1. Während „Bearbeitung“ sehen Mitarbeitende den eingefrorenen veröffentlichten Stand.
2. Direkte Änderungen an veröffentlichten Plänen bleiben erlaubt (sofortige Einzelmitteilung).
3. Zeitliche Überschneidung ist beim Einteilen ein bestätigbarer Hinweis, keine Sperre mehr
   (Personen und Sub-Platzhalter, organisationsweit). Mitarbeitende können sich weiterhin
   nicht selbst überschneidend einteilen (Anträge werden abgelehnt).

## Was jetzt funktioniert

### Baustein 1 – Plan-Lebenszyklus DRAFT → PUBLISHED → EDITING

- Status wird abgeleitet (`src/lib/schedule-status.ts`): `!isPublic` → DRAFT,
  `editingSince` gesetzt → EDITING, sonst PUBLISHED. `isPublic` behält überall die Bedeutung
  „für Mitarbeitende sichtbar“; kein Rename, alle bestehenden Sichtbarkeitsfilter unverändert.
- Schema additiv: `Schedule.editingSince`, `Schedule.editingById`, Tabelle `schedule_snapshots`
  (`scheduleId` PK/FK cascade, `takenAt`, `data` Json). Migration
  `prisma/migrations/20261012120000_schedule_editing`, Test in `tests/migration.ts`.
- „Bearbeitung starten“ `POST /api/schedules/[id]/editing` (EDIT_SHIFTS; 409 bei DRAFT/EDITING):
  nimmt den Snapshot aller nicht gelöschten Schichten mit Buchungen; Antwort enthält
  `weekStarted` und `notice`, wenn die Woche bereits begonnen hat.
- Während EDITING: keine Einzelmitteilungen an Mitarbeitende (`notifiesEmployees`), Schicht
  löschen schließt offene Anträge nicht, Anträge/Entscheidungen und Live-Modus-Start 409
  (`EDITING_REQUESTS`), `shiftView.can.request=false`, Zurückziehen 409, Verlegen einer Schicht
  in einen EDITING-Plan 409 (heraus erlaubt, zählt als entfernt).
- „Verwerfen“ `DELETE /api/schedules/[id]/editing` (PUBLISH_SCHEDULE): stellt Schichtfelder und
  Buchungen aus dem Snapshot wieder her, löscht während der Bearbeitung neu angelegte Schichten
  (soft), begonnene Schichten und Schichten mit Check-in bleiben unverändert (`skipped`);
  409 mit `conflicts[]`, wenn die Wiederherstellung eine Überschneidung erzeugen würde.
- Eingefrorene Mitarbeitersicht (`src/lib/schedule-frozen.ts`): Nicht-Planer lesen bei
  EDITING-Plänen die Snapshot-Schichten in Standortplan, „Mein Dienstplan“, Startseite
  (eigene und anfragbare Schichten), Monatsansicht, PDF-Daten, Nachrichtenbezug sowie
  Planstunden der Monatsauswertung/CSV (`src/lib/report.ts`, eigener Commit `9130d14`).
  Bestätigen von Altbestand (`PATCH /api/bookings`) ist während EDITING gesperrt (409).
  Check-in und Zeiterfassung bleiben auf Live-Daten (Entscheidung 1), neu angelegte Schichten
  erscheinen dort nicht.

### Baustein 2 – Veröffentlichen mit Änderungs-Diff und abwählbarer Benachrichtigung

- `GET /api/schedules/[id]/diff` (`src/lib/schedule-diff.ts`): Neu / Geändert (Tags Zeit, Tag,
  Titel, Pause, Qualifikation, Arbeitsbereich, Plätze, Besetzung) / Entfallen, betroffene
  Personen, `openPlacesAdded`. DRAFT → alles neu; PUBLISHED → leer.
- `PATCH /api/schedules/[id] { isPublic: true, notify? }` (Standard `notify=true`, bestehender
  API-Vertrag bleibt): aus DRAFT wie bisher; aus EDITING eine Sammelmitteilung je betroffener
  Person („Dienstplan KW x/yyyy aktualisiert“ mit Neu/Geändert/Entfällt), „Neue offene
  Schichten“ an REQUEST_SHIFTS-Inhaber bei neuen offenen Plätzen; mit `notify=false` entsteht
  keine Postfachzeile und damit auch kein Push. Unabhängig davon: offene Anträge zu entfallenen
  Schichten werden geschlossen („Antrag hinfällig“). Danach `schedule:updated` und `message:new`.
- Oberfläche: `src/components/schedule/publish-dialog.tsx` (Diff-Gruppen mit „keine“,
  Erstveröffentlichung, Betroffene, Checkbox, Konfliktzähler mit Sprung),
  `plan-status-banner.tsx` (Balken für DRAFT/EDITING mit Veröffentlichen/Verwerfen, kein Balken
  bei PUBLISHED), Toolbar mit „Bearbeitung starten“ und Badge „In Bearbeitung“, Zurückziehen rot
  am Ende des Popovers (gesperrt bei EDITING). Bestätigungsdialoge nennen die Folgen.

### Baustein 3 – Live-Konfliktprüfung

- Lesedienst `GET /api/schedules/conflicts?kw&year&standort` (`src/lib/conflicts.ts`, nur
  Planer): alle Konflikte bestehender Zuweisungen der Standortwoche mit wenigen mengenbasierten
  Abfragen, dieselben Regeln und Texte wie beim Einteilen. Schwere fest nach Art: rot =
  Überschneidung, genehmigte Abwesenheit, Konto nicht aktiv, als nicht verfügbar eingetragen;
  orange = Qualifikation, Tätigkeit, Arbeitsbereich, außerhalb der Verfügbarkeit. Gegenschicht
  einer Überschneidung wird nur mit „Dienstplan ansehen“ am anderen Standort benannt.
- Oberfläche: rote/orange Schichtkarte mit Badge und Inline-Text je Zuweisung, Panel
  `conflict-panel.tsx` mit Zählern, Einträgen je Person und Sprung zur Karte.
- Live: Realtime-Signale zusätzlich bei Abwesenheit, Verfügbarkeit, Personaldaten und
  standortübergreifenden Buchungen; der Query-Key `["schedule","conflicts",…]` lädt bei jedem
  `schedule:updated`/`booking:changed` neu.

### Baustein 3b – Überschneidung als Hinweis

- `assessAssignment`/`assessContractorAssignment`: Überschneidung in `warnings`; Einteilen,
  Wechseln, Anlegen/Kopieren mit Personen und Genehmigen durch die Planung verlangen
  `confirm: true` (vorhandene Dialoge „Trotz Hinweis …“). Zeitänderung mit neuer Überschneidung
  einer eingeteilten Person: 409 mit Hinweis, die Zuweisung zu lösen und neu einzuteilen.
  Anträge von Mitarbeitenden mit Überschneidung bleiben abgelehnt. `serial()` verhindert
  weiterhin nur die doppelte Buchung derselben Schicht.

## Nachweise

Zentrale Gesamtabnahme auf `badfea6` (12.10.2026, 16:53–17:23, flüchtige PGlite,
Ports 3408/55542, Rechner sonst weitgehend frei):

| Prüfung | Ergebnis |
|---|---|
| `npx prisma generate`, `npx tsc --noEmit --incremental false` | 0 Fehler |
| `npm run lint` | 0 Fehler, 25 bestehende Warnungen (Referenzwert) |
| `npm run test:migration` / `:history` / `:subcontractors` | 65 / 29 / 21 bestanden |
| `tests/plan-banner.tsx`, `conflict-card.tsx`, `schedule-actions.tsx`, `info-hint.tsx` | 45 / 17 / 45 / 6 |
| `npm run test:push`, `test:checkin`, `tests/serial-retry.ts` | 9 / 44 / 15 |
| `npm run test:workflows` (vollständig, alle Module inkl. `plan-lifecycle`, `plan-frozen`, `conflicts`, `dashboard-tasks`) | FINAL SUCCESS 3156/3156 |
| `npm run build` | erfolgreich |

### Browserabnahme (12.10.2026, 17:25–17:35)

Lokale Produktionsinstanz (`npm run build` + `npx tsx tests/load-local.ts --serve`, PGlite im
RAM, synthetische Daten „AKRO Codex Lasttest“ mit 100 Konten, Port 3337), Admin im
Browser, Mitarbeiterkonten parallel über die HTTP-API mit eigenen Sitzungen. Alle Punkte
tatsächlich bedient, nicht nur gesehen:

| Ablauf | Ergebnis |
|---|---|
| Veröffentlichte Woche KW 42 → „Bearbeitung starten“ | Dialog mit Folgen und Warnzeile „Woche hat bereits begonnen“; danach Badge „In Bearbeitung“, Balken mit Zeitpunkt und Name, Toast mit Serverhinweis |
| Während EDITING: Platz besetzt, Zeit einer Schicht geändert (14–22 → 13–21), Schicht gelöscht, neue Schicht angelegt | Planer sieht alles live; Mitarbeiter (API: Standortplan, „Mein Dienstplan“, Startseite) sieht unverändert 14:00–22:00 mit `can.request=false`; Postfach bleibt leer |
| „Änderungen veröffentlichen“ | Dialog gruppiert korrekt: 1 neue (Sa, 1 Platz offen), 2 geänderte (Di „Zeit“ mit vorher/nachher, Fr „Besetzung“), 1 entfallene (Do), „Betroffene Personen: 27“, Checkbox an. Nach Bestätigen Toast „27 Personen benachrichtigt“, Badge „Veröffentlicht“, Balken weg; Mitarbeiter sieht jetzt 13:00–21:00 und hat genau eine Mitteilung „Dienstplan KW 42/2026 aktualisiert“ mit Abschnitt „Geändert … vorher …“ |
| Zweiter Durchlauf: Bearbeitung, Zeit geändert, „Verwerfen“ | Roter Dialog mit Folgen; danach Schicht wieder 08:00–17:00, Status PUBLISHED, keine Mitteilung |
| Dritter Durchlauf: Zuweisung aufgehoben, Checkbox „Betroffene benachrichtigen“ abgewählt | Toast „ohne Benachrichtigung“; betroffene Person hat 0 Mitteilungen (API) |
| Konfliktprüfung: genehmigte Abwesenheit per API für eine eingeteilte Person angelegt | Panel aktualisiert sich ohne Neuladen: „1 Konflikt, 0 Hinweise – Test 100 – Di 13.10., 13:00–21:00 · Genehmigte Abwesenheit.“; Klick springt zur Karte, Karte rot mit Badge „Konflikt“ |
| Entwurfswoche KW 43 mit einer Schicht | Oranger Balken „Entwurf – für Mitarbeitende unsichtbar“ mit genau einem Knopf „Veröffentlichen“; Dialog „Erstveröffentlichung: 1 Schicht ist neu“, übrige Gruppen „keine“; Toast „keine Person benachrichtigt“, Badge „Veröffentlicht“ |
| 375 px (Entwurfsbanner und Veröffentlichen-Dialog) | `scrollWidth` = `clientWidth` = 375, Dialog 343 px breit, keine Elemente über den Rand; Aktionen gestapelt |

Nicht im Browser geprüft: Mitarbeiterkonto in der Oberfläche (nur per API), Verwerfen mit
Überschneidungskonflikt, Benachrichtigung „Neue offene Schichten“ an Standortfreigaben
(keine Freigaben in den Testdaten), Push auf echten Geräten.

Nachweise der Einzelbausteine vor der Integration (Agentenläufe, jeweils flüchtige PGlite):
Konfliktprüfung 1235, Lebenszyklus 1264 (+65 Migrationsprüfungen), Überschneidung 1400,
eingefrorene Sicht 1477, UI: Rendertests 45/17/45 und `next build` erfolgreich.

## Bekannte Einschränkungen und offene Punkte

- Hinweis für Mitarbeitende, warum Anträge während EDITING gesperrt sind, fehlt noch in der
  Oberfläche (Flag `requestsPaused` + Satz; Mini-Baustein nach der Abnahme).
- Verwerfen lehnt auch dann mit 409 ab, wenn die Überschneidung schon im veröffentlichten Stand
  bestand (sichere Seite; fachlich zu entscheiden, ob nur neue Überschneidungen zählen sollen).
- Eine Schicht, die aus einem EDITING-Plan an einen veröffentlichten anderen Standort verschoben
  wird, erscheint dort sofort live.
- `visiblePeople`, `referencableBranches`, `responsibleManagerIds` und die Antragslisten werten
  weiter Live-Buchungen aus; Arbeitsbereichstitel und Standortdaten kommen live.
- Der Check-in-Filter für neu angelegte Schichten vergleicht `createdAt` mit `editingSince`
  (gleiche Uhren von App und Datenbank vorausgesetzt).
- Zeitbuchungen über bestätigten Doppelschichten an zwei Standorten erhalten nach bestehender
  Regel keinen Standort; Planstunden zählen beide Schichten.
- Leerer Entwurf (0 Schichten) zeigt keinen Balken und keinen Veröffentlichen-Knopf.
- Verwerfen-Konflikte erscheinen als Toast-Liste (20 s), nicht im Dialog.
- Konfliktprüfung: keine Signale bei Standortpositionen, Arbeitsbereichsmitgliedern und
  Platzhalter-Buchungen (dort greift die 30-s-Aktualisierung).
- Nicht ausgeführt: `tests/postgres-concurrency.ts` und `tests/race-bookings.ts` (nur gegen
  echtes PostgreSQL), Browser-Tests `tests/ui-*.mjs` (kein Playwright im Ordner).
- Kein Betriebsnachweis: Migration `20261012120000_schedule_editing` ist nicht gegen eine
  Kopie der Betriebsdaten gelaufen.

## Übernahme in das Original

1. Im Original `git fetch` vom Klon (`git remote add bausteine ../schichtplaner-bausteine`) und
   den Branch `feat/plan-lifecycle-diff-conflicts` auf den aktuellen Stand mergen; der Branch
   basiert auf `c36a59f` des Originals, spätere Commits dort vorher einbeziehen.
2. `npm ci`, `npx prisma generate`, `npx tsc --noEmit --incremental false`, `npm run lint`,
   `npm run test:migration`, `npm run test:workflows`, `npm run build`.
3. Vor dem Einspielen auf Netcup: Sicherung, Migration auf verifizierter Kopie
   (`docs/UEBERGABE-BETRIEB.md`), Rückfallversion, Einspielen, Anmeldung mit echten Konten.
4. Danach fachlich entscheiden: Verwerfen bei vorbestehender Überschneidung; Sichtbarkeiten
   der Live-Restpfade (oben).
