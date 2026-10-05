# Fertigstellung – Arbeitsliste

## Subunternehmer mit Planungsplatzhaltern (01.10.2026)

Auftrag: Unternehmen mit beliebig vielen benannten Platzhaltern ohne Zugang anlegen,
damit offene Schichten besetzen und Einsätze je Subunternehmer nachvollziehen.
Umsetzung: getrennte Stammdaten, keine Benutzerkonten, Einladungen oder Zeiterfassung.
Verwaltung und neue Einteilung zunächst nur OWNER/ADMIN; bestehende Managerrechte bleiben unverändert.
Deaktivierung verhindert neue Einteilungen; vorhandene Einsätze bleiben erhalten und belegt.

| Prio | Ablauf / Dateien | Abnahmekriterium | Status | Nachweis |
|---|---|---|---|---|
| P1 | `prisma/schema.prisma`, Migration `20261001120000_subcontractors` | Bestand bleibt unverändert; genau eine Personenreferenz, keine fremde Organisation, kein Konto für Platzhalter | bestanden (lokal) | `tests/subcontractor-migration.ts`: 21/21 (jede Ablehnung mit erwartetem Constraint/Trigger), bestehende Migrationstests: 61/61, Historie: 29/29; Prisma-Client erzeugt |
| P1 | `api/subcontractors/**`, Verwaltung | Unternehmen/Platzhalter anlegen, umbenennen, deaktivieren; nur eigene Organisation und Administration | bestanden (lokal) | `tests/subcontractors.ts` im vollständigen HTTP-Testlauf; Mitgliederverzeichnis bleibt unverändert |
| P1 | `lib/planning.ts`, `lib/shift-service.ts`, `api/contractor-bookings`, Schichtauswahl | Belegter Platz, Name mit Sub, Kapazität/Überschneidung/Parallelzugriff geprüft; Kopieren behält Zuordnung | bestanden (lokal) | HTTP-Tests: gemischte Besetzung, Rücknahme fehlerhafter Änderung, Kopieren; zwei Parallelfälle jeweils 1×200/1×409 und genau eine gespeicherte Buchung |
| P1 | Monatsübersicht Subunternehmer | Einsätze je Platzhalter und Sub, einschließlich Nachtschichten aus dem Vormonat | bestanden (lokal) | HTTP-Tests: Dezember/Januar, veröffentlichte/Entwurfspläne, Zuordnung und Deaktivierung nach erneutem Lesen |
| P2 | Desktop/mobile Bedienung | Hauptablauf bedienbar und nach Neuladen erhalten | bestanden (lokal) | Browser auf lokaler Produktionsinstanz (synthetische Daten, 1440 und 375 px): Sub A, MA 1–3 (Namensvorschlag) angelegt, nach Neuladen vorhanden, umbenannt; MA 1 über Auswahl mit Hinweisdialog eingeteilt („Sub A · MA 1“, 13/13 voll, keine Bestätigung offen); Kopie mit gemischter Besetzung inkl. Vorschau/Hinweis; Monatsübersicht; MA 1 deaktiviert → Einsätze bleiben, nicht mehr angeboten; künftige Zuweisung mit Sicherheitsabfrage entfernt; 375 px ohne Überlauf, „Subunternehmer“ unter „Mehr“ |
| P2 | Typprüfung/Lint/Build | Keine neuen Prüfungsfehler | bestanden | Typprüfung 0 Fehler; Lint 0 Fehler, 25 bestehende Warnungen; finaler Next-Build nach HTTP-Testlauf erfolgreich |
| P1 | Betriebsfreigabe der Erweiterung | Sicherung, Migration auf Kopie, Einspielen und Nachprüfung | nicht geprüft | Kein Auftrag zur Änderung der Betriebsinstallation; nur lokale Vorbereitung |

Arbeitsteilung: Planung, Oberfläche und gezielte Tests getrennt delegiert; Schema,
Stammdaten-API und gemeinsame Prüfung beim Hauptagenten. Kostenmessung liegt nicht vor.
Prüfungen am 01.10.2026: gezielter Lauf mit Grundablauf 277/277; vollständiger
Workflow-/Rechtetest 2425/2425 (inklusive 140 zusätzlicher Subunternehmer-Prüfungen).
Der erste vollständige Lauf brach im bestehenden Einladungsablauf mit HTTP 500
und einem JSON-Lesefehler ab. Die unveränderte Wiederholung bestand vollständig;
Ursache des einmaligen Fehlers ist nicht abschließend geklärt. Keine Tests abgeschwächt.
Da npm/npx hier nicht im Suchpfad liegen, wurden die Paketwerkzeuge mit dem
vorhandenen Node-Runtime direkt aufgerufen; Testdatenbanken waren flüchtig und isoliert.

Einschränkungen: Die Übersicht zeigt geplante Einsätze, keine Istzeiten oder Abrechnung.
Qualifikation, Tätigkeit und Arbeitsbereich werden bei Anforderungen durch die Planung
extern bestätigt, da Platzhalter keine Personaldaten besitzen. Es gibt kein technisches
Anzahl-Limit für Platzhalter; große Bestände wurden nicht als Lasttest geprüft.

Vor Einspielen: Sicherung und Migration auf einer verifizierten Datenbankkopie prüfen;
die neue Migration wurde nicht gegen Betriebsdaten ausgeführt.

## Design-Paket, Subunternehmer-Abschluss und Gesamtprüfung (01.10.2026, abends)

Grundlage: Branch `feat/plan-delete-assign-copy-pdf` (4884201) plus uncommittete Arbeiten (Postfach/CSV/Adresse,
Subunternehmer, Design). Live läuft weiterhin `a9f5b9d` (am 01.10. per Dateiabgleich geprüft); nichts eingespielt, nichts committet.

| Prio | Ablauf / Dateien | Abnahmekriterium | Status | Nachweis |
|---|---|---|---|---|
| P1 | Design-Paket (Version C, Wochenansicht mit Tageskarten) – 23 Dateien in `layout/`, `ui/`, `schedule/`, `workforce/`, `globals.css` | Appweit übernommen, alle Funktionen erhalten | bestanden (lokal) | Drei-Wege-Zusammenführung gegen Paketbasis `a9f5b9d`; Konflikte nur in `dashboard`, `shift-card`, `schedule-toolbar` – PDF, Wechseln, Kopieren, gelöschte Personen, „fest eingeteilt“, Subunternehmer, CSV, Adresse erhalten. `tests/ui-design.mjs` 71/71 (Admin/Manager/Mitarbeiter, 1440/375 px) |
| P1 | Postfach-Fehler, CSV-Monatswahl, Adresse kopieren | Ehrliche Fehler, Wiederholen, Teilerfolge; CSV wählbar; Adresse ohne Treffpunkt | bestanden (lokal) | `tests/message-list-requests.ts`; `tests/ui-quality.mjs` 16/16 |
| P2 | `tests/ui-design.mjs` an aktuelle Fachregeln angepasst | Keine Abschwächung | erledigt | (1) Planer-Einteilung ist „fest eingeteilt“ statt Bestätigen-Knopf (prüft zusätzlich `confirmation = PLANNER` und dass kein Knopf erscheint); (2) Vorbereitung entfernt nur Zuweisungen nicht beendeter Schichten (beendete → 409 als Nachweis) |
| P2 | `lib/ai/chat-tools.ts` | KI-Dienstplan nennt Platzhalter und gelöschte Personen richtig | behoben | Vorher „Gelöschte Person“ für beide; `tests/ai-schedule-names.ts` scheitert mit alter, besteht mit neuer Fassung |
| P2 | `api/shifts/[id]` DELETE | `assignmentsRemoved` zählt auch Platzhalter | behoben | `tests/subcontractors.ts` („deleting a future shift counts …“) |
| P2 | `migration-history.ts` | Test unabhängig von der Rechner-Zeitzone | behoben | 29/29 in Europe/Berlin und UTC |

Prüfungen auf dem Endstand: Typprüfung 0 Fehler; Lint 0 Fehler, 25 alte Warnungen; Migration 61/61; Historie 29/29;
Subunternehmer-Migration 21/21; Mitarbeiterlöschung DB 26/26; Postfach-Regression bestanden; KI-Namen bestanden;
Workflow/Rechte 2479/2479 (Zahl der HTTP-Prüfungen schwankt mit der Uhrzeit, jede Einzelprüfung besteht); Build erfolgreich;
Browser 71/71 + 16/16 (Playwright mit lokalem Chrome, lokale Produktionsinstanz Port 3337, synthetische Daten).
Einladungs-500 trat in drei Volltests nicht auf; vermutete Ursache: nicht atomar geschriebene Next-Manifeste bei
Dateiänderungen während des Dev-Testlaufs – Suite daher nie parallel zu Dateiänderungen ausführen.

Offen zum Zeitpunkt dieser Übergabe (die ersten beiden Punkte werden im nachfolgenden Abschnitt bearbeitet):
- P2 Bedienung: Wechseln/Entfernen erscheinen auch bei beendeten Schichten (vorbestehend, durch das Design jetzt immer sichtbar); der Server lehnt mit verständlicher Meldung ab.
- Manager kopiert eine Schicht mit Platzhalter und „Zuweisungen übernehmen“ → ganze Kopie 403, auch für die Mitarbeiterzuweisungen.
- Parallelzugriffe sind nur mit einer Testverbindung geprüft (PGlite); echtes PostgreSQL-Verhalten unter Last nicht nachgewiesen.
- Kein Nachweis für 100 gleichzeitige Mitarbeiter auf einem Server; geplant auf separatem Netcup-Testserver (Bestellung erst nach Freigabe).
- Vor Betriebsfreigabe: Commit, Sicherung, Migrationen `20261001090000` und `20261001120000` auf Datenbankkopie, Einspielen, echte Geräte (GPS/Push).

## Bedienbausteine zur Übernahme durch Claude (01.–02.10.2026)

Auftrag: Die beiden offenen Bedienpunkte fertig umsetzen und eine sparsame,
prüfbare Übergabe vorbereiten. Bestehende Arbeiten bleiben erhalten. Keine neuen
Managerrechte: Bei Sub-Besetzung kann ein Manager die Schicht ausdrücklich ohne
Zuweisungen kopieren. Administration kann weiterhin die gesamte Besetzung übernehmen.

| Prio | Ablauf / Dateien | Abnahmekriterium | Status | Nachweis |
|---|---|---|---|---|
| P2 | `planning.ts`, `types/schedule.ts`, `schedule/shift-card.tsx` | Wechseln/Entfernen für Konten und Sub-Platzhalter am echten Berliner Schichtende ausblenden; Historie und Kopieren erhalten | bestanden (lokal) | `tests/schedule-actions.tsx`: 45/45, inklusive Nachtschicht, Jahreswechsel und beider Zeitumstellungen; Browser: beendete Karte ohne Aktionen, zukünftige mit 2 Entfernen/1 Wechseln. Timer im Browser nicht über ein tatsächliches Ende beobachtet |
| P2 | `schedule/copy-shift-dialog.tsx`, `tests/subcontractors.ts` | Manager + Sub: ausgeschalteter, gesperrter Schalter mit Erklärung; Vorschau/Speichern ohne Zuweisungen; normale Mitarbeiterkopie unverändert | bestanden (lokal) | Workflow/Rechte 2508/2508. Erster Lauf scheiterte an fehlender Mitarbeiterfreigabe im neuen Testaufbau; explizit ergänzt. Browser: Admin-Übernahme möglich, Manager-Schalter gesperrt, tatsächliche Kopie nach Navigation 0/2 besetzt, Mitarbeiterkopie freigeschaltet |
| P2 | Mobiler Kopierdialog | Kalender, Hinweis und Aktionen bei 375 px bedienbar, große Touchflächen erhalten | bestanden (lokal) | Abstände ausschließlich im Kopierdialog reduziert; finale Browserprüfung 375×812, höchstens 1 px Subpixel-Rundung; `manager-kopie-mobil.png` |
| P2 | Typprüfung/Lint/Build | Keine neuen Prüfungsfehler | bestanden (lokal) | Typprüfung 0 Fehler, Lint 0 Fehler/25 bestehende Warnungen; abschließender Build nach reiner Abstandsänderung erfolgreich. Volltest davor, danach Browser erneut geprüft |
| P2 | `docs/UEBERGABE-CLAUDE.md`, `docs/bausteine-2026-10-01/` | Eigene Ergänzungen als Patch gegen den vorherigen Arbeitsstand mit SHA256 abgrenzen | bestanden | Rückwärtsprüfung des finalen Patches; Code liegt bereits im Arbeitsverzeichnis. Kein Commit/Deploy |
| P1 | `docs/UEBERGABE-BETRIEB.md` | Isolierter PostgreSQL-Start, Sicherung/Restore, beide aktuellen Migrationen, Parallelzugriff und 100-Nutzer-Prüfung konkret vorbereitet | vorbereitet; Betriebsnachweise nicht geprüft | Kein verfügbares Docker/psql/pg_dump; keine Betriebskonfiguration geändert, nichts bestellt oder veröffentlicht. Altes Kopiemigrations-Skript passt nicht allgemein zu den aktuellen Migrationen |

Die obigen Ergebnisse wurden in diesem Auftrag tatsächlich geprüft. Frühere
Design-/Betriebseinträge sind historische Übergaben, keine erneute Prüfung hier.

Stand 28.09.2026, Branch `feat/kommunikation-tausch-gps` (Basis `7d80426`, läuft produktiv).
Status: `bestanden` · `fehlgeschlagen` · `nicht geprüft` · `offen` (fachliche Entscheidung).
Nachweise sind lokal (PGlite-Workflowtests, isolierte Docker-Testinstallation), soweit nicht anders vermerkt.
Auf Netcup eingespielt: `9eabd44` am 28.09.2026, `b5efa55` am 29.09.2026 (Löschen, Qualifikationen bearbeiten, Push).

## Betriebsnachweise auf echtem PostgreSQL (03.–05.10.2026, lokal)

Stand: Commit `ede961e`. Umgebung: Docker Desktop auf dem Arbeits-PC, Compose-Projekt `schichtplaner-test`
(eigenes Netz, Volume `schichtplaner-test_postgres_test_data`, Datenbank `schichtplaner_test`, PostgreSQL 16.15),
`.env.test`, App nur an `127.0.0.1:18080` (Override außerhalb des Repositorys). Nur synthetische Daten
(„AKRO Pilot“, Fremdmandant, eigene Testorganisationen). Live (`a9f5b9d`) und Betriebsdaten unberührt.
Diese Ergebnisse sind jetzt ausgeführt; frühere Einträge oben bleiben historische Nachweise.

| Nachweis | Ergebnis | Beleg |
|---|---|---|
| Testinstallation | bestanden | Build 7 min, `migrate` Exit 0 (beide neuen Migrationen), App healthy, `/api/health` und `/login` 200; Admin-/Mitarbeiteranmeldung |
| Sicherung/Wiederherstellung (Probe) | bestanden | Quelle `schichtplaner_test` (Stand Live: 8 Migrationen); `pg_dump -Fc` 115 kB, 255 Einträge, SHA256 lokal = Container; `pg_restore --exit-on-error` in **neue leere** `schichtplaner_kopie2`; 39 Tabellen / 445 Zeilen, alle Hashes gleich (`tests/migration-copy-current.ts snapshot/vergleich`) |
| Kopiemigration (Probe) | bestanden | `prisma migrate deploy` auf `kopie2` (Ziel vorher per `migrate status` geprüft), 7 s; 51/51: alle Bestandsspalten unverändert, Bestätigungsherkunft 59× EMPLOYEE / 6× PLANNER exakt wie berechnet, keine erfundenen Zuordnungen, neue Tabellen leer, keine verwaisten Bezüge |
| Schutzregeln auf PostgreSQL | bestanden | 10/10 in zurückgerollter Transaktion: Doppel-/Leer-Personenreferenz, fremder Platzhalter, Verschieben von Schicht/Plan/Platzhalter in fremde Organisation, RESTRICT für Unternehmen und Konten, Deaktivierung erhält Einsatz |
| Parallelzugriffe, mehrere Verbindungen | bestanden | `tests/postgres-concurrency.ts`: 10 Runden warm 32/32, 3 Kaltstarts 10+10+4: je genau 1 Erfolg bei 10 gleichzeitigen Einteilungen auf den letzten Platz, beim selben Platzhalter in überlappenden Schichten und bei doppelter Antragsgenehmigung; App nutzte bis zu 12 Datenbankverbindungen |
| Echtzeit, zwei Browser | bestanden | Admin ändert Schicht, offene Mitarbeiter-Startseite zeigt sie nach 1,9 s ohne Neuladen |
| Last 100 Nutzer, nur Lesen | bestanden (lokal) | 6 min, App+DB auf 4 Kerne begrenzt: 4060 Anfragen, 0 Fehler, p95 125–191 ms, Login p95 1,96 s, 100/100 Sockets, 0 Abbrüche; Spitze App 2,6 Kerne/550 MiB, DB 0,3 Kerne/52 MiB, 12 Verbindungen |
| Last 100 Nutzer, mit Schreiben | fehlgeschlagen (Testkriterium) | 4294 Anfragen, Lesen 0 Fehler (p95 ≤ 413 ms), 187 Schreibvorgänge (100/100 Bestätigungen); 119 Antragsversuche fachlich korrekt mit 409 abgewiesen (zweiter Antrag je Schicht, begonnene Schicht) – der Lasttest zählt sie als Fehler; **1 echter Fehler: Serialisierungskonflikt (40001) als HTTP 500** |

Befunde:
- **P1 offen – Serialisierungskonflikte:** 20 Transaktionen in API-Routen wiederholen bei 40001 nicht und antworten mit 500,
  u. a. `POST /api/mod-requests` (im Lasttest aufgetreten), `POST /api/time/watch`, Zeitkorrekturen, Schicht-/Planbearbeitung,
  Freigaben. Lösungsvorschlag: je Route prüfen, ob die Arbeit außer `tx` nebenwirkungsfrei ist, dann `{ retry: true }` setzen
  und mit einem Parallelfall in `tests/postgres-concurrency.ts` absichern. Nicht umgesetzt (Auftrag: nur Betriebsnachweise).
- Lasttest-Werkzeug: Ausweichpfad „Nachricht an anderes Testkonto“ ist für Mitarbeitende gesperrt (403, gewollt); wiederholte
  Tauschanträge werden als Fehler gezählt. Für ein aussagekräftiges Schreibkriterium muss der Test fachliche 409 trennen.
- Umgebung: Windows-Standby („Modern Standby“) hielt Docker an (Herzschlag-Lücken 115 s, 173 s, 769 s, später ~47 h).
  Dadurch ungültige Läufe (erster Parallelitätslauf hing; zwei Lastläufe mit Socket-Abbrüchen) – verworfen; gültige Läufe
  sind per lückenlosem Docker-Herzschlag belegt.

Nicht nachgewiesen (Blocker):
- Sicherung, Wiederherstellung und Kopiemigration **mit Betriebsdaten**: braucht ausdrücklichen Auftrag für eine Betriebssicherung
  auf Netcup; Verfahren und Vergleichsskript sind erprobt.
- Kapazität auf vergleichbarer Hardware: lokal nur Näherung (4 Kerne eines anderen Prozessors); separater Testserver nicht bestellt.
- Rückweg mit altem Image-Stand plus Dump auf einer Kopie: lokal kein Image von `a9f5b9d` vorhanden; auf Netcup vor dem Update proben.

## Erweiterung Kommunikation, Tausch, GPS-Check-in

| Prio | Ablauf / Dateien | Abnahmekriterium | Status | Nachweis |
|---|---|---|---|---|
| P1 | Nachrichten an Zuständige – `src/lib/messages.ts`, `api/messages/**`, `components/portal/**`, `lib/access.ts` (`visiblePeople`) | Mitarbeiter schreibt dem zuständigen Manager, Antwort kommt an, Ungelesen-Zähler steigt und fällt | bestanden | `tests/messaging.ts`; Browser (375 px): „An Zuständige“, Senden mit Schichtbezug, Antwort als Manager |
| P0 | Empfänger-/Lesezugriff | Unberechtigte lesen nichts, fremde Empfänger 403, fremde Organisation 404 | bestanden | `tests/messaging.ts`, `tests/permissions.ts` |
| P1 | Admin als Ansprechpartner | Ohne zuständigen Manager `noResponsible` und Schreiben an die Administration | bestanden | `tests/messaging.ts` |
| P1 | Standort-/Schichtbezug | Bezug geprüft (404 fremd, 400 widersprüchlich), vererbt, angezeigt | bestanden | `tests/messaging.ts`; Browser |
| P2 | Postfach mobil (Altfehler) | Keine Überbreite bei 375 px, Zeilen lesbar | bestanden | Browser: Breite 627 → 375 px; Commit `2b4055b` |
| P1 | Fehler: Antwort blieb ungelesen | Öffnen des Verlaufs markiert Antworten als gelesen | bestanden | Regressionscheck in `tests/messaging.ts` |
| P1 | Offene Schicht anfragen | Antrag → Freigabe → genau eine Zuweisung, auch bei gleichzeitigen Genehmigungen | bestanden | `tests/exchange.ts` (parallel: 1×200, 1×409) |
| P1 | Abgabe (bisher „Tausch“ genannt) | Anbieten, Übernahme, Genehmigung/Ablehnung mit Begründung | bestanden | `tests/workflows.ts`, `tests/exchange.ts` |
| P1 | Echter Zwei-Schichten-Tausch – `lib/shift-requests.ts`, `api/mod-requests/**`, `workforce/requests.tsx` | Zustimmung/Ablehnung der Gegenseite, Genehmigung tauscht beide atomar, Rücknahme | bestanden | `tests/exchange.ts` |
| P0 | Tausch: Rechte und Konflikte | Keine Selbstgenehmigung; Entscheidung nur mit Recht an allen Standorten, sonst Admin; zwischenzeitliche Überschneidung verhindert Genehmigung ohne Teiländerung | bestanden | `tests/exchange.ts` |
| P1 | GPS-Einstellungen je Standort – `api/branches`, `workforce/locations.tsx` | Nur Admins; Koordinaten paarweise; Pflicht nur mit Koordinaten | bestanden | `tests/sites-gps.ts` (inkl. Regressionsfall Koordinaten löschen) |
| P1 | GPS-Check-in – `lib/checkin.ts`, `api/checkin/**`, `api/time/watch`, `workforce/checkins.tsx` | Innerhalb 50 m startet genau eine Zeiterfassung; zweiter Check-in 409 | bestanden | `tests/checkin.ts`; Browser (simulierte Position, 17 m) |
| P0 | Check-in: Ablehnungen | Außerhalb, ungenau, veraltet, fremde Schicht, fremde Organisation korrekt abgewiesen; Stoppuhr ohne Check-in gesperrt | bestanden | `tests/checkin.ts`; Browser (200 m, ±80 m, Stoppuhr 409) |
| P1 | Manuelle Ersatzfreigabe | Begründung Pflicht, nur Berechtigte, nie selbst, doppelte Entscheidung 409, Verlauf bleibt | bestanden | `tests/checkin.ts`; Teilindex `checkins_active_key` in `tests/migration.ts` |
| P1 | Nachtschicht, Zeitumstellung, Neuladen, Pause, Auschecken | Fenster und Verspätung in Europe/Berlin; Zustand übersteht Neuladen | bestanden | `tests/checkin-unit.ts` (38); Browser: Pause → Neuladen → Fortsetzen → Auschecken, Standort bleibt |
| P1 | Migration `20260929090000_exchange_messages_checkin` | Rein additiv, Bestand unverändert | bestanden | `npm run test:migration` (60) |
| P0 | Dateiablage: Ordnerpfad ohne Organisationsprüfung – `api/files/route.ts` | Fremde oder fehlende Ordner-ID ergibt 404, fremde Ordnernamen erscheinen nie | bestanden | `tests/files.ts` |
| P1 | Stoppuhr-Sperre las beliebige Verlaufszeile – `lib/checkin.ts` | Abgelehnter oder ersetzter Antrag verdeckt keinen gültigen Check-in | bestanden | `tests/checkin.ts` |
| P1 | Zeitumstellung Check-in-Fenster und Tausch – `lib/checkin.ts`, `lib/shift-requests.ts` | Geschlossenes Fenster öffnet in der wiederholten Stunde nicht erneut; begonnene Schicht gilt nicht wieder als künftig | bestanden | `tests/checkin-unit.ts` (44), `tests/exchange-dst.ts` |
| P1 | Tausch scheitert erst bei der zweiten Einteilung | Beide alten Buchungen, Antrag und Benachrichtigungen bleiben unverändert | bestanden | `tests/exchange.ts` |
| P2 | Login-Sperre begrenzt – `lib/login-throttle.ts` | 5 Versuche / 15 Minuten unverändert, Speicher begrenzt | bestanden | `npm run test:login-throttle` |
| P0 | Abhängigkeiten aktualisiert: Next.js 16.3.6, Prisma 7.10.0, Docker-Image Node 24 (Node 20 ohne Wartung seit 04/2026), `npm audit fix` | `npm audit`: keine kritische Lücke mehr; alle Prüfungen grün; Docker-Start mit Migration | bestanden | `npm audit` 45 → 5 (kritisch 4 → 0; verbleibend 4 hoch nur im Prisma-CLI, Behebung wäre Rückstufung auf Prisma 6); Workflow 1136/1136; Testinstallation unter Node 24 gesund, Anmeldung für Admin/Manager/Mitarbeiter |
| P2 | `npm start` / `start:server` starteten ohne Socket.IO bzw. eine nie erzeugte Datei | Beide starten den eigenen Server wie Docker | bestanden (Code) | `scripts/start.mjs`; Docker unverändert über `server.ts` |
| P1 | Kunden/Einsatzorte löschen – `api/customers/[id]`, `api/branches/[id]` | Nur Admins, nur ohne fachliche Daten, sonst verständliche 409 | bestanden | `tests/org-delete.ts`; Browser |
| P1 | Qualifikationen umbenennen/löschen – `api/qualifications/[id]`, Einstellungen | Umbenennen zieht nach; Löschen nur ungenutzt; nur Admins | bestanden | `tests/qualification-edit.ts`; Browser (Umbenennen, Löschen abgelehnt) |
| P1 | Browser-Push – `lib/push.ts`, `api/push`, `public/sw.js`, Manifest | Hinweis ohne Inhalte nach gespeicherter Mitteilung; nur aktive Mitglieder, nur eigene Organisation; abgelaufene Abos entfernt; nur bekannte Push-Dienste | bestanden (lokal) | `tests/push-outbox.ts` (9), `tests/push-api.ts`, Migration; Browser-Vorschau blockiert Benachrichtigungen und Service Worker → Gerätetest steht aus |
| P1 | Push auf echtem Android- und iPhone-Gerät | Hinweis kommt bei geschlossener App | nicht geprüft | Erst nach Einspielen mit HTTPS möglich |
| P1 | Smartphone-GPS mit echtem Gerät | Check-in am realen Dienstort über HTTPS | nicht geprüft | Nur simulierte Positionen. Gerätetest steht aus |
| P1 | Betrieb Netcup | Sicherung, Probelauf auf Kopie, Einspielen, Nachprüfung | bestanden | Stand vorher `7d80426`, 301 Dateien identisch; Sicherung `db-before-9eabd44-20260928T201400Z.dump` (lesbar), Code-Archiv, Rollback-Images `rollback-7d80426`; Migration auf wiederhergestellter Kopie ohne Änderung am Bestand; danach 7/7 Migrationen, App unter Node 24 gesund, 0 Neustarts, `/api/health` und `/login` 200. Kein Standort hat GPS-Pflicht |
| P1 | Betrieb Netcup `b5efa55` | Sicherung, Probelauf, Einspielen, Nachprüfung | bestanden | Stand vorher `9eabd44`, 320 Dateien identisch; Sicherung `db-before-b5efa55-20260929T135831Z.dump`, Code, `.env`-Kopie, Rollback-Images `rollback-9eabd44`; Push-Migration auf Kopie ohne Änderung am Bestand, keine alten Mitteilungen offen; Push-Schlüssel in `.env` erzeugt (nicht ausgegeben); 8/8 Migrationen, „Push aktiv“, `/api/health`, `/login`, `sw.js`, Manifest 200 |
| P1 | Anmeldung in der Produktion | Anmeldung mit echtem Konto nach dem Update | nicht geprüft | Kein vorgesehenes Testkonto; Anmeldung durch den Nutzer nötig |

## Prüfungen am 28.09.2026 (lokal)

| Prüfung | Ergebnis |
|---|---|
| `npx tsc --noEmit --incremental false` | 0 Fehler |
| `npm run lint` | 0 Fehler, 25 Warnungen – alle in unveränderten Altdateien |
| `npm run test:workflows` | 1251/1251 |
| `npm run test:migration` | 61/61 |
| `npm run test:checkin` | 44/44 |
| `npm run test:login-throttle` | bestanden |
| `npm run test:push` | 9/9 |
| `npm run build` | erfolgreich; zusätzlich Docker-Build der Testinstallation |

Übernommen aus der Vorbereitung vom 28.09.2026 (Pakete 01, 02, Sicherungsskript aus 05) nach Prüfung jeder Änderung.
Nicht übernommen: Paket 03 (Postfach seitenweise, passt nicht zum aktuellen Stand). Paket 04 (Versionen) umgesetzt über `npm install`/`npm audit fix`, nicht über die vorbereitete Lock-Datei.

## Offene fachliche Entscheidungen (vor produktiver Aktivierung des Check-ins)

- **Beschlossen:** Radius 50 m (Inhaber). Zweck: Zeitstempel für Pünktlichkeit und Anwesenheit am Dienstort.
- **Vorschlag, nicht beschlossen:** Genauigkeit höchstens 50 m (sonst belegt die Position den 50-m-Radius nicht),
  Position höchstens 2 Minuten alt, Check-in ab 30 Minuten vor Schichtbeginn bis Schichtende, „pünktlich“ = bis
  Schichtbeginn. Konstanten in `src/lib/checkin.ts`.
- **Zu klären:** Wer darf Check-in-Daten sehen (derzeit: Admins; Manager mit „Zeiterfassung einsehen“ am Standort
  und „Stunden einsehen“ für die Person)? Wie lange werden sie aufbewahrt (derzeit unbegrenzt, kein Löschlauf)?
  Koordinaten werden derzeit nicht gespeichert – soll es dabei bleiben?
- **Zu klären:** Die GPS-Pflicht sperrt nur einen neuen Stoppuhr-Start im offenen Fenster. Eine vor dem Fenster gestartete Stoppuhr und manuelle Zeitbuchungen bleiben möglich. Soll GPS jede Zeiterfassung für solche Schichten absichern, braucht es eine Ausnahme- und Freigaberegel.
- **Zu klären:** Eine manuelle Freigabe startet die Zeit rückwirkend ab dem Antrag, auch wenn die Einteilung inzwischen entfernt wurde oder die Schicht vorbei ist.
- Vorhandene offene Punkte aus `docs/AKRO-ERWEITERUNG.md` Abschnitt 5 bleiben unverändert offen.

## Nächste Schritte

1. Gerätetest mit einem echten Smartphone am Dienstort (HTTPS) und Ergebnis hier eintragen.
2. Entscheidungen oben klären.
3. Nach dem Deploy: Anmeldung in der Produktion prüfen; GPS-Check-in erst nach den Entscheidungen oben je Standort einschalten.

## Aufwand

Teilaufgaben liefen parallel in Agenten: Bestandsaufnahme (Sonnet, Haiku), Nachrichten (Sonnet),
GPS-Einstellungen (Haiku), Check-in (Opus); Tausch, Integration und Prüfung im Hauptagenten. Genaue
Kostenangaben liegen nicht vor; bekannt sind nur Tokenzahlen je Agent (etwa 80 000–245 000).
