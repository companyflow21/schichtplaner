# Fertigstellung – Arbeitsliste

## Diagnose: Mitarbeiter sehen keine Pläne (11.10.2026)

Auftrag: Ursache der fehlenden Mitarbeitersicht feststellen. Die laufende Netcup-App
und ihre tatsächlich konfigurierte Datenbank wurden ausschließlich lesend geprüft;
die Datenbankabfragen liefen in einer ausdrücklich schreibgeschützten Transaktion.
Keine Konten, Freigaben, Planstatus oder Betriebsdateien verändert.

| Prio | Ablauf / Dateien | Abnahmekriterium | Status | Nachweis |
|---|---|---|---|---|
| P1 | Veröffentlichung / Mitarbeitersicht | Tatsächlichen Planstatus mit den Sichtbarkeitsregeln abgleichen | bestanden (Diagnose); Veröffentlichung ausstehend | In der Betriebsdatenbank sind alle 223 nicht gelöschten Wochenpläne Entwürfe, kein Plan ist veröffentlicht. Die laufende App verwendet diese Datenbank. `src/lib/schedule-visibility.ts` zeigt Mitarbeitern nur veröffentlichte Schichten; vorhandene Einteilungen umgehen den Entwurfsschutz nicht |
| P1 | Standortfreigaben / Navigation | Eigene Einteilungen von vollständigen Standortplänen unterscheiden | bestanden (Diagnose) | Kein aktives, aktiviertes Mitarbeiterkonto besitzt `VIEW_SCHEDULE`. Vorhandene Mitarbeiterfreigaben enthalten ausschließlich `REQUEST_SHIFTS`. Eigene veröffentlichte Einteilungen benötigen keine zusätzliche Planfreigabe; der vollständige Standortplan benötigt ausdrücklich „Dienstplan ansehen“ |
| P1 | `tests/workflows.ts`, `tests/permissions.ts`, `tests/staff-sites.ts` | Entwurfsschutz, veröffentlichte eigene Schichten und Standortfreigaben mit getrennten Testkonten nachweisen | bestanden (lokal) | 650/650 Prüfungen mit `TEST_ONLY=permissions,staff-sites` in flüchtiger PGlite-Datenbank, alle Migrationen angewandt; keine Betriebsdaten. Eigene veröffentlichte Schichten sichtbar, Entwürfe verborgen, vollständige Pläne nur mit zusätzlicher Freigabe. Erster Versuch durch lokale Netzwerksperre mit `EACCES` abgebrochen, anschließender Lauf außerhalb dieser Sperre erfolgreich |
| P2 | `ANLEITUNG.md` | Veröffentlichung je Standort und Woche sowie zusätzliche Planfreigabe verständlich erklären | bestanden | Bedienweg und Unterschied zwischen gespeichertem Entwurf, eigenen Einteilungen und vollständigem Standortplan ergänzt |

Nächster Schritt im Betrieb: die fachlich fertigen Standort-/Wochenpläne über
„Woche“ → „Veröffentlichen“ freigeben. Eine Veröffentlichung und weitergehende
Standortrechte waren mit der Diagnose nicht beauftragt. Es wurde kein Codefehler
als Ursache bestätigt. Keine erneute Gesamtabnahme; Anmeldung und Mitarbeitersicht
mit echten Konten wurden nicht im Browser geprüft. UI-Pfad unabhängig durch einen
Agenten gelesen, Serverdiagnose und Testlauf zentral; keine genaue Kostenmessung verfügbar.

## Aktueller Abschlussauftrag (05.10.2026)

Ziel: den vorhandenen Funktionsumfang abschließen, ohne neue Funktionen oder Rechte
hinzuzufügen. Basis ist `aa07282`; die nachfolgenden älteren Abschnitte sind historische
Nachweise. Dieser Abschnitt bestimmt den aktuellen Stand. Betriebsdaten und die laufende
Betriebsinstallation werden in diesem Auftrag nicht verändert.

| Prio | Ablauf / Dateien | Abnahmekriterium | Status | Nachweis |
|---|---|---|---|---|
| P0 | `.dockerignore`, Docker-Build | Lokale Sicherungen und Agenteneinstellungen gelangen nicht in Build-Kontext oder Image | bestanden (lokal) | `backups` und `.claude` ausdrücklich ausgeschlossen; im neu gebauten Builder-Image beide Pfade mit `test ! -e` geprüft, Exit 0. Die zwei Sicherungsdateien wurden nicht verändert |
| P2 | `docker-compose.test.yml` | Test-App ausschließlich über localhost erreichbar | bestanden (lokal) | Standard-Portbindung `127.0.0.1:18080:3000`; Compose-Konfiguration gültig. Neue Test-App ebenfalls nur an localhost gestartet |
| P1 | Gleichzeitige Änderungen: `src/lib/api.ts`, 19 API-Routen | Zurückgerollte Schreibkonflikte begrenzt wiederholen; keine HTTP 500 bei 40001/P2034; fachliche Sperren bleiben bestehen | bestanden (lokal) | Alle 34 direkten `serial()`-Aufrufe der API geprüft; 20 bisher ohne Wiederholung ergänzt. Regression 15/15, alte Fassung scheitert am neuen Fall P2034 ohne Adaptermetadaten. Benachrichtigungen in der Transaktion, Echtzeitversand danach |
| P1 | `tests/serial-retry.ts`, `tests/postgres-concurrency.ts` | Doppelantrag, doppelte Genehmigung und Stoppuhr aus zwei Sitzungen erzeugen genau einen korrekten Datensatz und keine doppelten Mitteilungen | bestanden (lokal) | PostgreSQL 16.15: 202/202 in zehn Runden, bis zu zwölf App-Verbindungen. Letzter Platz, Sub-Überschneidung, Doppelantrag/-genehmigung, START/PAUSE/RESUME jeweils genau ein Erfolg; Endzustände und einmalige Mitteilungen per SQL geprüft |
| P1 | `tests/load-pilot.ts` | 100 Nutzer mit gültigen Schreibvorgängen; unveränderte Fehler- und Antwortzeitgrenzen | bestanden (lokal) | 6,3 min, 4227/4227 Anfragen erfolgreich, 0 Fehler; Lese-p95 höchstens 149 ms, Schreib-p95 höchstens 228 ms, Login-p95 1655 ms. 100/100 Sockets, 0 Abbrüche. 174 Schreibvorgänge entsprechen per SQL genau 100 bestätigten Buchungen und 74 eindeutigen offenen Angeboten, keine Doppelanträge |
| P1 | Gesamtabnahme | Typprüfung, Lint, Migrationen, Workflow/Rechte und Produktions-Build bestehen | bestanden (lokal) | Workflow/Rechte 2491/2491; Migration 61/61, Historie 29/29, Subunternehmer 21/21, Mitarbeiterlöschung DB 26/26; Typprüfung 0 Fehler, Lint 0 Fehler/25 bestehende Warnungen; Host- und Docker-Produktions-Build erfolgreich |
| P2 | `docs/AKRO-ERWEITERUNG.md`, `ANLEITUNG.md`, `docs/UEBERGABE-BETRIEB.md` | Anleitung entspricht verbindlicher Planer-Einteilung und tatsächlich geprüftem Betrieb | bestanden | Bestätigung nur für Altbestand ohne eindeutige Herkunft; gültige Schreiblast beschrieben; Docker-Verfügbarkeit, localhost-Bindung und aktuelles Kopievergleichsskript berichtigt. Aktueller Status hier, ältere Ergebnisse als Historie |
| P2 | Desktop/mobile Oberfläche, echte Geräte | Hauptabläufe bedienbar; GPS und Push auf echten Geräten nachweisen | teilweise bestanden (historisch), heute nicht erneut geprüft | Browsernachweise 71/71 + 16/16 sowie Manager-Kopie bei 375 px vom 01.–02.10.; heute keine UI-Änderungen. Echte GPS-/Push-Geräteprüfungen stehen weiterhin aus |
| P1 | Schicht bearbeiten: `schedule/shift-form.tsx`, `tests/ui-shift-location.mjs` | Einsatzort und Arbeitsbereich bleiben beim Bearbeiten erhalten, auch wenn die Auswahllisten erst nach dem Öffnen laden. Unverändertes Speichern verschiebt nichts | behoben, lokal geprüft (11.10.2026); noch nicht eingespielt | Im Betrieb gemeldet: Bonn-Schicht sprang auf den ersten Ort der Liste („Apolda“). Ursache: Die Felder setzten ihren Wert nur einmal beim Öffnen. Lädt die Liste später, wählt der Browser den ersten Eintrag. Der Fehler besteht seit `0471e31` (19.09.) und trifft auch den Arbeitsbereich, der beim Speichern still entfernt wurde. Server und bisherige Tests sahen eine gültige Verschiebung. Regressionstest mit verzögerten Listen: vorher 5 Fehler, nachher 7/7 (zweimal), Typprüfung und Lint ohne Fehler. `tests/ui-design.mjs` heute nicht aussagekräftig: Sonntagabend sind die Grundschichten der Woche beendet, der Test sucht dann einen Entfernen-Knopf, den es bei beendeten Schichten nicht gibt. Er scheitert vor dem Schichtformular |
| P1 | Einspielen auf Netcup | Aktuelle Betriebssicherung, Restore/Kopiemigration, Rückfallversion, Einspielen und Anmeldung nachweisen | bestanden (06.10.2026, ausdrücklicher Auftrag) bis auf Anmeldung mit echtem Konto | Ausgangsstand `a9f5b9d`: 335/335 Dateien gleich, 8/8 Migrationen. Drei `pg_dump -Fc`-Sicherungen (40 Tabellendaten, lesbar) und Code-Archiv ohne `.env` unter `/root/schichtplaner-backups`, Rückfall-Images `:rollback-a9f5b9d`. Betriebsdaten in Wegwerf-PostgreSQL im internen Docker-Netz: Restore 40/40 gleich, Betrieb während Sicherung unverändert; Kopiemigration 51/51 (3 Einteilungen → PLANNER). Neue und alte App starten auf den Kopien (Health ok, Login 200). Ausgerollt 15:12, rund 10 s Unterbrechung: Migrationen 10/10, Live-Ordner 382/382 Dateien gleich `1d2046d`. Konten, Mitgliedschaften, Pläne, Schichten, Einteilungen und Freigaben per Hash unverändert. HTTPS Health/Login 200, Echtzeit `/api/ws` 200, Anmeldeseite ohne Konsolenfehler. Kopie danach entfernt. Anmeldung mit echtem Konto durch AKRO offen |

Prüfumgebung: eigenes Docker-Netz und eigenes Volume `schichtplaner-test_postgres_test_data`,
PostgreSQL 16.15, Port ausschließlich `127.0.0.1:15432`; zehn vollständig angewandte
Migrationen. Vorhandene Organisationen ausschließlich synthetische Pilot-/Testdaten.
Keine Tests gegen die Betriebsdatenbank, keine Datenbank-Resets und keine Volumes gelöscht.

Lastumgebung: neues Produktionsimage `schichtplaner-final:20261005`, KI aus,
App auf vier CPUs begrenzt; PostgreSQL auf CPUs 0–3 gebunden, Docker-Engine mit
16 CPUs. Dies ist ein lokaler Funktions-/Lastnachweis, kein Kapazitätsnachweis
für einen bestimmten Netcup-Server. CPU-/RAM-Spitzen dieses Laufs wurden nicht
als dauerhafter Messbericht gespeichert. Der Rechner wurde während der Prüfung
vorübergehend wach gehalten; die verwendeten Testcontainer danach gestoppt.

Die zusätzliche SQL-Nachkontrolle brach zunächst wegen einer falschen Abfrage im
temporären Prüfhelfer ab (`mod_requests` hat keine eigene `organizationId`).
Korrigiert wurde nur diese lesende Kontrolle: Organisation über Schicht/Plan
verknüpfen. Sie bestand danach mit 100/100 Bestätigungen, 74/74 Anträgen und null
Doppelanträgen; App-Code, Testkriterien und Lastlauf wurden dabei nicht verändert.

**Freigabestand (06.10.2026):** `1d2046d` läuft auf Netcup (dienstplan.akro-group.com),
Funktionsumfang eingefroren. Keine offenen bestätigten P0/P1-Codefehler aus diesem
Abschlussauftrag. Ausgelegt für vorerst höchstens zehn gleichzeitige Nutzer; der lokale
100-Nutzer-Lauf deckt das ab. Offen: Anmeldung mit echten Admin-/Mitarbeiterkonten durch
AKRO, echte GPS-/Push-Gerätetests. Rückweg bei Bedarf: Images `:rollback-a9f5b9d` und
Code-Archiv zusammen mit der Sicherung `db-a9f5b9d-*-c.dump` in eine neue Datenbank
wiederherstellen, nicht nur den Code zurücksetzen.

Fachlicher Umfang eingefroren: Verwaltung, Planung einschließlich Sub-Platzhaltern,
Freigaben, Zeit, Monatsauswertung/CSV und Nachrichten nach den bestehenden Regeln.
Neue Manager-/Mitarbeiterrechte bleiben ausdrücklich zu vergeben; Selbstgenehmigung
eigener Zeitkorrekturen durch Admins bleibt wie dokumentiert. KI bleibt optional und
im aktuellen Testbetrieb ausgeschaltet. Offene GPS-Vorgaben werden nicht stillschweigend
entschieden; eine GPS-Pflicht erst nach gesonderter Entscheidung und Gerätetest aktivieren.

Aufteilung dieses Abschlusses: API-Prüfung/-Korrektur und gezielte Regressionstests
getrennt delegiert, Integration und vollständige gemeinsame Abnahme beim Hauptagenten.
Keine erneute Gesamtanalyse je Agent und keine parallelen Workflow-/Build-Läufe.
Genaue Token-/Kostenmessung liegt für diesen Auftrag nicht vor.

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
- **P1 damals offen, am 05.10. behoben – Serialisierungskonflikte:** 20 Transaktionen in API-Routen wiederholen bei 40001 nicht und antworten mit 500,
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

## Nächste Schritte (historischer Stand 28.09.2026)

1. Gerätetest mit einem echten Smartphone am Dienstort (HTTPS) und Ergebnis hier eintragen.
2. Entscheidungen oben klären.
3. Nach dem Deploy: Anmeldung in der Produktion prüfen; GPS-Check-in erst nach den Entscheidungen oben je Standort einschalten.

## Aufwand

Teilaufgaben liefen parallel in Agenten: Bestandsaufnahme (Sonnet, Haiku), Nachrichten (Sonnet),
GPS-Einstellungen (Haiku), Check-in (Opus); Tausch, Integration und Prüfung im Hauptagenten. Genaue
Kostenangaben liegen nicht vor; bekannt sind nur Tokenzahlen je Agent (etwa 80 000–245 000).
