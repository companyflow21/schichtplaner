# Fertigstellung – Arbeitsliste

Stand 28.09.2026, Branch `feat/kommunikation-tausch-gps` (Basis `7d80426`, läuft produktiv).
Status: `bestanden` · `fehlgeschlagen` · `nicht geprüft` · `offen` (fachliche Entscheidung).
Alle Nachweise hier sind **lokal** (PGlite-Workflowtests, isolierte Docker-Testinstallation). Diese Erweiterung
ist **nicht** auf Netcup eingespielt.

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
| P1 | Smartphone-GPS mit echtem Gerät | Check-in am realen Dienstort über HTTPS | nicht geprüft | Nur simulierte Positionen. Gerätetest steht aus |
| P1 | Betrieb Netcup | Sicherung, Probelauf auf Kopie, Einspielen | nicht geprüft | Nicht beauftragt |

## Prüfungen am 28.09.2026 (lokal)

| Prüfung | Ergebnis |
|---|---|
| `npx tsc --noEmit --incremental false` | 0 Fehler |
| `npm run lint` | 0 Fehler, 25 Warnungen – alle in unveränderten Altdateien |
| `npm run test:workflows` | 1086/1086 |
| `npm run test:migration` | 60/60 |
| `npx tsx tests/checkin-unit.ts` | 38/38 |
| `npm run build` | erfolgreich; zusätzlich Docker-Build der Testinstallation |

Die Workflowtests liefen vor den letzten reinen Layoutkorrekturen im Postfach (`2b4055b`); diese sind mit
Typprüfung, ESLint und im Browser geprüft.

## Offene fachliche Entscheidungen (vor produktiver Aktivierung des Check-ins)

- **Beschlossen:** Radius 50 m (Inhaber). Zweck: Zeitstempel für Pünktlichkeit und Anwesenheit am Dienstort.
- **Vorschlag, nicht beschlossen:** Genauigkeit höchstens 50 m (sonst belegt die Position den 50-m-Radius nicht),
  Position höchstens 2 Minuten alt, Check-in ab 30 Minuten vor Schichtbeginn bis Schichtende, „pünktlich“ = bis
  Schichtbeginn. Konstanten in `src/lib/checkin.ts`.
- **Zu klären:** Wer darf Check-in-Daten sehen (derzeit: Admins; Manager mit „Zeiterfassung einsehen“ am Standort
  und „Stunden einsehen“ für die Person)? Wie lange werden sie aufbewahrt (derzeit unbegrenzt, kein Löschlauf)?
  Koordinaten werden derzeit nicht gespeichert – soll es dabei bleiben?
- Vorhandene offene Punkte aus `docs/AKRO-ERWEITERUNG.md` Abschnitt 5 bleiben unverändert offen.

## Nächste Schritte

1. Gerätetest mit einem echten Smartphone am Dienstort (HTTPS) und Ergebnis hier eintragen.
2. Entscheidungen oben klären.
3. Auf Auftrag: Netcup-Einspielung nach bekanntem Ablauf (Sicherung, Probelauf der Migration auf Kopie, Deploy).

## Aufwand

Teilaufgaben liefen parallel in Agenten: Bestandsaufnahme (Sonnet, Haiku), Nachrichten (Sonnet),
GPS-Einstellungen (Haiku), Check-in (Opus); Tausch, Integration und Prüfung im Hauptagenten. Genaue
Kostenangaben liegen nicht vor; bekannt sind nur Tokenzahlen je Agent (etwa 80 000–245 000).
