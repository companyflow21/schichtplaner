# Fertigstellung – Arbeitsliste

Stand 28.09.2026, Branch `feat/kommunikation-tausch-gps` (Basis `7d80426`, läuft produktiv).
Status: `bestanden` · `fehlgeschlagen` · `nicht geprüft` · `offen` (fachliche Entscheidung).
Nachweise sind lokal (PGlite-Workflowtests, isolierte Docker-Testinstallation), soweit nicht anders vermerkt.
Auf Netcup eingespielt: `9eabd44` am 28.09.2026, `b5efa55` am 29.09.2026 (Löschen, Qualifikationen bearbeiten, Push).

## Smartplan-Abgleich: P6 (12.10.2026)

Branch `claude/wizardly-cerf-cxbutc`. Noch nicht eingespielt. Migrationen `20261017090000_planning_rules` und
`20261018090000_publishing` sind additiv (veröffentlichte Pläne erhalten `publishedAt`); vorher auf einer Kopie prüfen.

| Prio | Ablauf / Dateien | Abnahmekriterium | Status | Nachweis |
|---|---|---|---|---|
| P1 | Regelkern – `lib/planning-rules.ts` | Stunden je Woche/Monat (min/max), Stunden am Tag, Ruhezeit (Lücke ≤ 15 min zusammenhängend), Tage am Stück, Tage je Woche, einzelne Arbeits-/freie Tage, Wochenenden in Folge, freier Werktag je Wochenendtag; Nachtschicht zählt am Anfangstag | bestanden | `npm run test:rules` (19) |
| P1 | Regeln und Verstöße – `api/planning-rules`, `api/schedules/[id]/violations` | Einstellungen nur Admin; Abweichung je Person ersetzt die Regel, „allgemein“ setzt zurück; Verstöße über alle Standorte und Entwürfe, ohne Abwesenheitstage; nur Planung sieht sie; Veröffentlichen trotz Verstoß | bestanden | `tests/planning-rules.ts` |
| P0 | Veröffentlichen mit Änderungsliste – `lib/publishing.ts`, `api/schedules/[id]/publish` | Erste Veröffentlichung: alle neu, alle Berechtigten benachrichtigt; danach neue/gelöschte/geänderte Schichten gegenüber dem zuletzt gesehenen Stand; Benachrichtigung abwählbar | bestanden | `tests/publishing.ts` |
| P0 | Bearbeitungsmodus – `api/schedules/[id]/edit` | Nur kommende Wochen (laufende 409); Mitarbeitende sehen den alten Stand (Wochenplan, eigener Plan); Anfragen und Bestätigen 409; keine Einzelnachrichten; Wiederveröffentlichen benachrichtigt nur Betroffene mit ihren Änderungen | bestanden | `tests/publishing.ts` |
| P1 | Zurückziehen | Stand bleibt für die Änderungsliste; erneutes Veröffentlichen informiert alle wie bisher | bestanden | `tests/publishing.ts` |
| P1 | Migrationen | Additiv; ohne Eintrag alle Regeln aus; eine Regelzeile je Organisation, eine Abweichung je Person; ein gespeicherter Stand je Plan, Löschen kaskadiert | bestanden | `npm run test:migration` (84) |
| P1 | Oberfläche | Einstellungen › Planungsregeln, Kasten „Regelverstöße“ mit Sprung zur Schicht, Dialog „Änderungen veröffentlichen?“, „Plan bearbeiten“, Status „Wird bearbeitet“, Hinweis für Mitarbeitende, 375 px | nicht geprüft | Browser (Produktions-Build, `npm run preview:test`) |

### Prüfungen (lokal)

| Prüfung | Ergebnis |
|---|---|
| `npx tsc --noEmit` | 0 Fehler |
| `npx eslint src tests --quiet` | 0 Fehler |
| `npm run test:workflows` | nicht geprüft |
| `npm run test:migration` | 84/84 |
| `npm run test:rules` | 19/19 |
| `npm run build` | nicht geprüft |

## Smartplan-Abgleich: P4 und P5 (12.10.2026)

Branch `claude/wizardly-cerf-cxbutc` (`0de1cc7`, `c21d5b3` und Folgekorrekturen). Noch nicht eingespielt. Migrationen `20261014090000_time_accounts`,
`20261015090000_absence_effects` und `20261016090000_vacation_account` sind additiv; vorher auf einer Kopie prüfen.

| Prio | Ablauf / Dateien | Abnahmekriterium | Status | Nachweis |
|---|---|---|---|---|
| P1 | Zeitkonto – `lib/time-account.ts`, `lib/time-account-service.ts`, `api/time-accounts` | Soll je Person mit Startdatum (Woche/Monat), anteilig nach Werktagen; Ist − Soll, Plan − Soll, Ist − Plan; Ausgleich ± Stunden; nur Admin ändert | bestanden | `npm run test:accounts` (15), `tests/time-accounts.ts` |
| P1 | Sichtbarkeit Zeitkonto | Admin; Manager mit „Stunden einsehen“; die Person nur bei Freigabe; fremde Organisation 404 | bestanden | `tests/time-accounts.ts` |
| P0 | Abwesenheit wirkt – `lib/absence-effects.ts`, `api/absences`, `api/absences/effects` | Beim Genehmigen je Schicht bezahlt / 0 Stunden / aus der Schicht nehmen; Vorgabe aus der Abwesenheitsart; Rücknahme und Löschen heben die Wirkung auf | bestanden | `tests/absence-effects.ts` |
| P0 | Rechte | „Aus der Schicht nehmen“ nur mit „Schichten bearbeiten“ oder Admin (403); Entscheidung je Schicht nur bei Genehmigung (sonst 400); Mitarbeitende nicht | bestanden | `tests/absence-effects.ts` |
| P1 | Lohn, Export, Stundenzettel, Zeitkonto | Bezahlte Abwesenheit mit Planstunden und Lohnart-Code der Abwesenheitsart; Lohnexport-Zeile „Abwesenheit“; Stundenzettel „abwesend: … (bezahlt)“; Ausgleich aufs Zeitkonto | bestanden | `tests/absence-effects.ts` |
| P1 | Urlaubskonto – `lib/vacation.ts`, `lib/vacation-service.ts`, `api/vacation` | Anspruch jährlich oder monatlich, anteilig ab Beginn, Übertrag mit Grenze, freie Wochentage und Feiertage, genommen/geplant/beantragt, Korrektur in halben Tagen, Kosten im Antrag | bestanden | `npm run test:vacation` (12), `tests/vacation.ts` |
| P1 | Sichtbarkeit Urlaubskonto | Admin; Manager mit „Abwesenheiten entscheiden“; die Person bei Freigabe; Übersicht nur für Entscheidende; Regeln und Korrekturen nur Admin | bestanden | `tests/vacation.ts` |
| P1 | Migrationen | Zeitkonten und Urlaubskonto zunächst aus; Altabwesenheiten behalten ihren Status ohne Wirkung; eindeutige Schlüssel; Löschen kaskadiert | bestanden | `npm run test:migration` (79) |
| P1 | Oberfläche | Dialog „Folgen für die Schichten“, Urlaubshinweis im Antrag, „Urlaubskonten“ unter Abwesenheiten, eigenes Konto, Einstellungen Zeitkonten und Urlaubskonto, Saldo-Spalte, 375 px ohne Überbreite | bestanden | Browser (Produktions-Build, `npm run preview:test`, 1366 und 375 px): Genehmigen mit Folgen-Dialog (eine Schicht, drei Optionen), Zeile „abwesend“ mit 7,50 h und 112,50 € in „Stunden und Lohn“, Urlaubskonten und Kontoauszug, eigene Karte „10 von 34,5 Tagen · verfügbar 24,5“, Hinweis im Antrag „dieser Zeitraum 5 · danach 19,5“, eigenes Zeitkonto; keine Überbreite. Dabei behoben: Kontoauszug und Zeitkonto-Dialog waren auf 375 px zu breit, Ansichtsknöpfe ohne Namen auf dem Handy |

### Prüfungen (lokal)

| Prüfung | Ergebnis |
|---|---|
| `npx tsc --noEmit` | 0 Fehler |
| `npx eslint src tests --quiet` | 0 Fehler |
| `npm run test:workflows` | 1687/1687 |
| `npm run test:migration` | 79/79 |
| `npm run test:payroll` / `test:accounts` / `test:vacation` / `test:pdf` | 31/31, 15/15, 12/12, 14/14 |
| `npm run build` | erfolgreich |

## Smartplan-Abgleich: P2 und P3 (12.10.2026)

Branch `claude/wizardly-cerf-cxbutc`. Noch nicht eingespielt. Migration `20261013090000_time_approval` vorher auf einer Kopie prüfen.

| Prio | Ablauf / Dateien | Abnahmekriterium | Status | Nachweis |
|---|---|---|---|---|
| P1 | Schichtbezug je Buchung – `lib/time-service.ts` (`shiftForTime`), `api/time`, `api/time/watch`, Check-in | Buchung wird der einzigen überschneidenden veröffentlichten Schicht zugeordnet; Check-in setzt die Schicht direkt; ohne eindeutige Schicht kein Bezug | bestanden | `tests/hours.ts` |
| P0 | Genehmigung – `api/time/approve` | Nur Prüfende (Admin; Manager mit „Zeiterfassung bearbeiten“ am Standort und „Stunden einsehen“); eigene nur Admin; fremde Organisation 404; laufende Stoppuhr 409; Rücknahme möglich | bestanden | `tests/hours.ts` |
| P1 | Anfangsstatus – `initialApproval` | Einträge der Prüfenden für andere und der Administration genehmigt; eigene offen, mit „automatisch genehmigen“ genehmigt | bestanden | `tests/hours.ts` |
| P1 | Direkte Änderung durch Prüfende – `api/time/[id]` | Sofort wirksam, genehmigt, als entschiedene Korrektur mit Vorher/Nachher im Verlauf; Mitarbeitende beantragen weiter | bestanden | `tests/hours.ts`; bestehende Korrekturtests unverändert grün |
| P1 | Stundenbericht – `lib/hours.ts`, `api/hours` | Plan/Ist/Abweichung je Schicht; Status genehmigt/offen/nicht erfasst/geplant/läuft; Buchungen ohne Schicht als eigene Zeile; Sichtbarkeit wie Auswertung; Lohn nur Admin | bestanden | `tests/hours.ts` |
| P1 | Migration `20261013090000_time_approval` | Additiv; abgeschlossene Altbuchungen gelten als genehmigt, laufende nicht; Schicht nur aus dem Check-in übernommen | bestanden | `npm run test:migration` (69) |
| P1 | Stundenzettel – `lib/timesheet.ts`, `api/timesheet` | Eigene immer, fremde mit Rechten; Zuschlagsstunden ohne Beträge; Personalnummer und Soll nur für Person und Administration | bestanden | `tests/timesheet.ts` |
| P1 | Leistungsnachweis je Einsatzort – `api/timesheet/site` | Nur mit „Zeiterfassung einsehen“ am Standort; Summe je Person; Einsatzort ist Pflicht | bestanden | `tests/timesheet.ts` |
| P1 | PDF – `lib/timesheet-pdf.ts` | Stundenzettel und Leistungsnachweis als A4-PDF mit Summen und Unterschriftsfeldern | bestanden | `npm run test:pdf` (14); Browser: Download beider PDFs, Sichtprüfung |
| P1 | Oberfläche „Stunden und Lohn“ (`/hours`, ersetzt `/payroll`) | Genehmigen, Alle genehmigen, Bearbeiten, „Zeit wie geplant nachtragen“, Drucken ohne Navigation, 375 px ohne Überbreite | bestanden | Browser (Produktions-Build): Genehmigen, Nachtragen-Dialog mit Planzeiten, Druckansicht, Stundenzettel 18 KB, Leistungsnachweis 11 KB, `/payroll` → `/hours` |
| P1 | „Ist = Plan“ ohne Erfassung (Smartplan B35) | Geplante Schicht zählt ohne Buchung als gearbeitet | offen | Fachliche Entscheidung AKRO; heute „nicht erfasst“ mit „Zeit wie geplant nachtragen“ |

### Prüfungen (lokal)

| Prüfung | Ergebnis |
|---|---|
| `npx tsc --noEmit --incremental false` | 0 Fehler |
| `npx eslint` (geänderte Dateien) | 0 Fehler; Warnungen nur in unverändertem Altcode |
| `npm run test:workflows` | 1483/1483 |
| `npm run test:migration` | 69/69 |
| `npm run test:payroll` / `test:pdf` | 31/31, 14/14 |
| `npm run build` | erfolgreich |

## Smartplan-Abgleich: P0 und P1 (12.10.2026)

Branch `claude/wizardly-cerf-cxbutc`, Basis `a9f5b9d`. Plan, Funktionskatalog und Paketliste: `docs/SMARTPLAN-ABGLEICH.md`.
Noch nicht eingespielt.

| Prio | Ablauf / Dateien | Abnahmekriterium | Status | Nachweis |
|---|---|---|---|---|
| P1 | CSV: negative Werte – `lib/csv.ts`, `api/reporting/export` | „-1,50“ bleibt Zahl, Formeln weiter neutralisiert | bestanden | `tests/payroll-unit.ts` |
| P2 | „Reaktivieren“ im Profilmenü – `employees/employee-detail.tsx` | Menüpunkt reaktiviert über die bestehende Schnittstelle (nur Admin) | bestanden | `tests/abgleich-fixes.ts` |
| P1 | Abwesenheit durch Leitung – `employees/absence-form.tsx` | „Direkt genehmigen“ (vorbelegt) für fremde zugeordnete Personen und eigene bei Admins; Mitarbeitende können nicht selbst genehmigen | bestanden | `tests/abgleich-fixes.ts` |
| P1 | Abwesenheiten deaktivierter Personen – `api/absences` | Bleiben sichtbar, nicht entscheidbar, nicht neu eintragbar; nach Reaktivieren wieder entscheidbar | bestanden | `tests/abgleich-fixes.ts` |
| P2 | Nachricht als ungelesen – `portal/message-list.tsx` | Knopf „Ungelesen“ für ausgewählte Nachrichten | bestanden | `tests/abgleich-fixes.ts` |
| P0 | Lohn nur für die Administration – `api/payroll/**` | Manager und Mitarbeitende 403; fremde Organisation 404 | bestanden | `tests/payroll.ts` |
| P1 | Lohnarten, Personalnummer, Lohnart je Person/Arbeitsbereich | Titel und Personalnummer eindeutig (409), fremde Lohnart 404, genutzte Lohnart nicht löschbar, inaktive fällt auf die Person zurück | bestanden | `tests/payroll.ts`, `tests/migration.ts` |
| P1 | Zuschläge – `lib/payroll.ts`, `lib/payroll-input.ts` | Wochentage, Feiertage, Sonderdaten, Block über Mitternacht, Prozent/Betrag, Personen/Arbeitsbereiche, addierend; Zeitumstellung März/Oktober; anteilige Pause | bestanden | `tests/payroll-unit.ts` (31) |
| P1 | Lohn je Buchung über echte Schicht – `lib/payroll-service.ts` | Buchung in veröffentlichter Schicht erhält Lohnart des Arbeitsbereichs; ohne Schicht die der Person; Standortfilter | bestanden | `tests/payroll.ts` |
| P1 | Lohnexport CSV – `api/payroll/export` | Zeile je Person und Lohnart/Zuschlag mit Personalnummer, Code, Stunden, Satz, Betrag; ohne Sätze nur Stunden; Personen abwählbar | bestanden | `tests/payroll.ts` |
| P1 | Migration `20261012090000_payroll` | Rein additiv, Bestand unverändert | bestanden | `npm run test:migration` (66) |
| P1 | Oberfläche „Einstellungen › Lohn“ und „Lohn“ | Bedienbar auf Desktop und 375 px ohne Überbreite | bestanden | Browser (Produktions-Build, `npm run preview:test`): Einstellungen mit Zuschlagsformular, Lohn Oktober mit Rechenweg (Elke 300,00 €, Emil 168,75 € inkl. Sonntag), Export-Dialog und CSV-Download; 1366 px und 375 px ohne Überbreite (vorher 78 px in der Monatsleiste, behoben) |
| P0 | Anmeldeformulare vor der Hydrierung – `(auth)/login`, `register`, `activate` | Zugangsdaten landen nie in der Adresse | bestanden | Browser ohne JavaScript: Absenden bleibt auf `/login` ohne Parameter (vorher `?email=…&password=…`) |
| P1 | Steuerliche Behandlung der Zuschläge | Sätze und Vorrangregeln mit Steuerbüro abgestimmt | offen | Fachliche Entscheidung AKRO |

### Prüfungen am 12.10.2026 (lokal)

| Prüfung | Ergebnis |
|---|---|
| `npx tsc --noEmit --incremental false` | 0 Fehler |
| `npx eslint` (geänderte Dateien) | 0 Fehler; 1 Warnung in unverändertem Altcode (`absence-form.tsx`, ungenutzter Import) |
| `npm run test:workflows` | 1368/1368 |
| `npm run test:migration` | 66/66 |
| `npm run test:payroll` | 31/31 |
| `npm run build` | erfolgreich |
| Hinweis Testumgebung | `test:workflows` mit `TEST_NODE_ENV=production`: Echtzeit-Test in `tests/permissions.ts` bekommt über HTTP keine Socket-Verbindung (unabhängig von P0/P1, nicht weiter untersucht); im Entwicklungsmodus wird die Oberfläche im Headless-Browser nicht interaktiv. Browserprüfungen deshalb über `npm run preview:test`. |

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
