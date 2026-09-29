# Fertigstellung – Arbeitsliste

Stand 28.09.2026, Branch `feat/kommunikation-tausch-gps` (Basis `7d80426`, läuft produktiv).
Status: `bestanden` · `fehlgeschlagen` · `nicht geprüft` · `offen` (fachliche Entscheidung).
Nachweise sind lokal (PGlite-Workflowtests, isolierte Docker-Testinstallation), soweit nicht anders vermerkt.
Am 28.09.2026 um 22:17 Uhr auf Netcup eingespielt: laufender Commit `9eabd44`.

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
