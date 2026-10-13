# AKRO Dienstplaner – Erweiterung und Übergabe

Stand: 24.09.2026. Abschnitte 1–4 beschreiben die Erweiterung vom 19.09.2026, Abschnitt 5 die
Trennung nach Kunde, Standort und Zuständigkeit vom 24.09.2026. Das bestehende Projekt wurde erweitert; kein neues Projekt erstellt.
Vorhandene lokale Änderungen wurden erhalten. Betriebsdaten wurden nicht migriert oder mit Testdaten überschrieben.

## 1. Analyse und ergänzte Funktionen

### Vorhandene Basis
Next.js 16 / React 19, PostgreSQL mit Prisma 7, NextAuth-Credentials,
React Query, shadcn/Tailwind und eigener Socket.IO-Server.
Bereits vorhanden: Wochen-/Monatsansichten, Arbeitsbereiche, Mitarbeiterverwaltung,
Abwesenheitsanträge, manuelle Zeiterfassung, Stoppuhr, Postfach und Auswertung.
Lücken waren insbesondere fehlende Einsatzortverknüpfung, Freigabeworkflows,
Pausenprotokollierung, Schichtbestätigungen und mandantensichere Zeitdaten.
Eine bestehende Abweichung zwischen Schema und Migration (`mod_requests.note`) wurde repariert.

### Dienstplanung
- Einsatzort, Arbeitsbereich, Tätigkeit, Hinweise und benötigte Qualifikationen im vorhandenen Schichtformular.
- Wiederholung für ausgewählte Wochentage über 1–52 Wochen. Die erzeugten Schichten bleiben einzeln bearbeitbar; keine zusätzliche Serienverwaltung.
- Kopie auf mehrere Tage mit Vorschau; Zuweisungen optional (standardmäßig aus), dann mit allen Prüfungen.
- Entwurf bleibt für Mitarbeiter unsichtbar. Veröffentlichung informiert aktive Teammitglieder.
- Zuweisungen durch Planung/Administration sind sofort verbindlich (Herkunft PLANNER); Änderungen werden nur mitgeteilt.
  Die Bestätigung durch Mitarbeitende gilt nur noch für Altbestand ohne eindeutige Herkunft.
- Zuweisung prüft Kapazität, aktive Mitgliedschaft, Qualifikationen, Tätigkeit am Einsatzort,
  Arbeitsbereichszugehörigkeit, genehmigte Abwesenheiten, Verfügbarkeit und Überschneidungen – auch nachts und über Jahresgrenzen.
- Konflikte werden serverseitig mit verständlicher Meldung abgewiesen.
- Mitarbeiter können sich nicht mehr direkt einbuchen: Übernahme und Tausch benötigen Freigabe.

### Personen und Orte
- Bestehende Personendetails um Tätigkeit, Beschäftigungsart, Wochen-Sollstunden,
  Qualifikationen und Aktivstatus erweitert.
- Einmaliger Einladungslink mit sieben Tagen Gültigkeit und Passwortaktivierung.
  Ein neuer Link macht den alten ungültig. Links werden durch die Administration weitergegeben; kein E-Mail-Versand eingerichtet.
- Einsatzorte mit Adresse, Treffpunkt, Tätigkeiten, Hinweisen und Aktivstatus
  direkt im vorhandenen Bereich für Arbeitsbereiche. Seit 24.09.2026 gehört jeder Einsatzort zu einem Kunden (Abschnitt 5).

### Verfügbarkeit, Abwesenheiten und Anträge
- Verfügbare/nicht verfügbare Zeitfenster im bestehenden Abwesenheitsbereich.
  Ohne Eintrag gilt eine Person grundsätzlich als verfügbar; positive Einträge begrenzen die angegebenen Tage.
- Bestehende Urlaubs-/Krankheits-/sonstige Kategorien weiterverwendet.
- Anträge und Entscheidungen erzeugen interne Benachrichtigungen.
- Tausch: eigene Schicht anbieten → geeigneter Kollege meldet sich → Administration genehmigt.
  Die ursprüngliche Zuweisung bleibt bis zur Genehmigung erhalten.
- Freigabe prüft Konflikte erneut und tauscht atomar. Keine doppelte Genehmigung.

### Zeit und Auswertung
- Arbeitsbeginn, Pause, Fortsetzen und Ende werden serverseitig gespeichert.
  Laufende Stoppuhr überlebt Neuladen; reale Zeitstempel berücksichtigen Zeitumstellungen.
- Korrekturantrag mit Begründung, Vorher-/Nachher-Daten und Freigabe.
  Zwischenzeitlich veränderte Datensätze können nicht unbemerkt überschrieben werden.
- Erfasste Zeiten werden nicht gelöscht; Korrekturen bleiben nachvollziehbar.
- Monatsauswertung enthält Soll, veröffentlichten Plan, tatsächliche Nettozeit und Ist-minus-Plan.
- CSV mit UTF-8-BOM, Semikolon, deutschen Dezimalwerten und Schutz gegen Tabellenformeln;
  lässt sich in Excel öffnen. Dienstplan als PDF (A4 quer) aus Wochen- und Monatsansicht; kein XLSX-Export.
- Sollberechnung: Wochenstunden / 5 × Montag–Freitag des Monats. Keine automatische Feiertags-,
  Urlaubs-, Tarif- oder Lohnabrechnung. Planvergleich umfasst den ganzen Monat einschließlich künftiger Schichten.
- Manuelle Von/Bis-Zeiten sind lokale Uhrzeiten; bei einer Zeitumstellung ist die reine Dauererfassung
  bzw. eine begründete Korrektur zu verwenden. Unveränderte Stoppuhr-Zeitstempel bleiben bei reiner Kommentarkorrektur erhalten.

### Kommunikation und Startseite
- Vorhandenes Postfach weiterverwendet: Einzel-/Teamnachrichten, Lesestatus und Schichtbezug.
- Systembenachrichtigungen sind echte Nachrichten in derselben Datenbank, keine Beispieldaten.
- Rollenabhängige Startseite: heutige/nächste Schichten, passende offene Schichten,
  fehlende Bestätigungen, Abwesenheiten, Anträge, Nachrichten und Monatsstunden.
- Blau-türkise Palette, mobile Karten/Formulare und reduzierte rollengerechte Navigation.
  Bestehende optionale KI-Seiten wurden nicht entfernt, aber aus der Hauptnavigation genommen.
- OWNER/ADMIN bleiben Administratoren. Seit 24.09.2026 planen Manager nur noch mit ausdrücklicher
  Freigabe je Standort und je zugeordneter Person (Abschnitt 5).

## 2. Geänderte Dateien

Die Liste betrifft diese Erweiterung; der Arbeitsbaum enthielt vorher bereits zahlreiche Designänderungen.

| Bereich | Dateien (relativ zum Projekt) |
| --- | --- |
| Datenbank | `prisma/schema.prisma`, `prisma/migrations/20260919090000_internal_workflows/migration.sql` |
| Gemeinsame Regeln | neue `src/lib/api.ts`, `berlin.ts`, `planning.ts`, `shift-service.ts`, `time-service.ts`, `report.ts` |
| Anmeldung/Infrastruktur | `src/lib/auth.ts`, `auth-helpers.ts`, `db.ts`, `socket.ts`, `utils/calendar.ts`; `src/i18n/request.ts`; `src/app/api/me/route.ts` |
| Planung-APIs | `src/app/api/schedules/route.ts`, `schedules/[id]/route.ts`, `schedules/[id]/briefing/route.ts`; `shifts/route.ts`, `shifts/[id]/route.ts`, neue `shifts/[id]/copy/route.ts`, `shifts/[id]/candidates/route.ts`; `bookings/route.ts`, `live/book/route.ts` |
| Anträge/Orte | neue `src/app/api/availability/route.ts`, `branches/route.ts`; `mod-requests/route.ts`, `mod-requests/[id]/route.ts`, `absences/route.ts`, `absences/[id]/route.ts` |
| Personal | `src/app/api/employees/route.ts`, `employees/[id]/route.ts`, neue `employees/[id]/invite/route.ts`, `auth/activate/route.ts` |
| Zeiten/Auswertung | `src/app/api/time/route.ts`, `time/[id]/route.ts`, `time/watch/route.ts`, neue `time/corrections/route.ts`; `reporting/route.ts`, `reporting/export/route.ts` |
| Dashboard/Nachrichten | neue `src/app/api/dashboard/route.ts`; `src/app/api/messages/route.ts` |
| Seiten/Design | `src/app/page.tsx`, `layout.tsx`, `globals.css`; `(auth)/login/page.tsx`, neue `(auth)/activate/page.tsx`; `(dashboard)/layout.tsx`, neue `(dashboard)/dashboard/page.tsx`; bestehende `(dashboard)/divisions/page.tsx`, `employees/absences/page.tsx`, `portal/inbox/page.tsx` |
| Neue integrierte UI | `src/components/workforce/{client,dashboard,requests,availability,locations,personnel}.tsx` |
| Bestehende UI | `src/components/layout/{top-nav,mobile-nav}.tsx`; `schedule/{shift-form,shift-card,employee-picker,schedule-options,live-mode}.tsx`; `employees/{employee-detail,absence-form}.tsx`; `divisions/division-form.tsx`; `time/{stopwatch,time-record-form,time-list}.tsx`; `reporting/{hours-table,export-modal}.tsx`; `portal/compose-message.tsx`; `src/types/schedule.ts` |
| Bestehende KI-Kompatibilität | `src/lib/ai/chat-tools.ts` nutzt zentrale Buchungsregeln und prüft Planungsrechte; kleine Lint-Korrekturen in `anomaly-detector.ts` und `employee-recommender.ts` |
| Tests/Dokumentation | `tests/workflows.ts`, `package.json`, `package-lock.json`, dieses Dokument |

## 3. Datenbank und Inbetriebnahme

### Additive Änderungen
- OrganizationMember: Aktivierungsablauf, Tätigkeit, Beschäftigungsart, Sollstunden, Qualifikationen.
- Branch: Treffpunkt, Hinweise, Tätigkeiten, Aktivstatus.
- Shift: Einsatzort-Fremdschlüssel und erforderliche Qualifikationen.
- Booking: Bestätigungszeitpunkt.
- ModRequest: Antragsart, übernehmende Person; fehlendes bestehendes Notizfeld nachgezogen.
- Message: optionaler Schichtbezug.
- TimeRecord: verpflichtende Organisationszuordnung, Beginn/Ende/Pausenbeginn als Zeitstempel, Pausensekunden.
- Neue Tabellen `availabilities` und `time_corrections` mit Fremdschlüsseln und Indizes.

Die Migration läuft in einer Transaktion. Alte Zeitdaten werden zuerst über ihre Kategorie,
sonst nur bei eindeutig einzelner Organisationsmitgliedschaft zugeordnet.
Bei mehrdeutigen Altbeständen bricht sie ab, statt Daten einer Organisation zu erraten.
Solche Fälle vor dem Rollout fachlich klären und eine kontrollierte Zuordnungsmigration vorbereiten.
Alte WATCH-Einträge werden aus Berliner Ortszeit in UTC-Zeitstempel überführt;
mehrdeutige Uhrzeiten am Winterzeitwechsel müssen fachlich geprüft werden.

### Vor dem produktiven Einsatz
1. PostgreSQL sichern und diese Migration zuerst auf einer Kopie der realen Daten testen.
2. `DATABASE_URL`, `AUTH_SECRET`, `APP_URL` und `AUTH_TRUST_HOST` passend zur Installation setzen.
   `ALLOW_REGISTRATION=false` für den internen Regelbetrieb, `AI_ENABLED=false` solange nicht gewünscht.
   `TZ=Europe/Berlin` auch im App-Prozess setzen.
3. Bestehenden Deploymentweg nutzen. Bei Node:
   `npm ci`, `npx prisma generate`, `npx prisma migrate deploy`, `npm run build`.
4. Für Echtzeitfunktionen den vorhandenen `server.ts` verwenden:
   Entwicklung `npm run dev:server`; Produktion `NODE_ENV=production npx tsx server.ts`
   (in PowerShell NODE_ENV vor dem Aufruf als Umgebungsvariable setzen).
   Der bestehende Docker-Aufbau startet diesen Server bereits.
5. Im bestehenden Docker-Setup nach Backup `docker compose up -d --build` ausführen
   und Erfolg des `migrate`-Dienstes sowie App-Healthcheck prüfen.
6. Aktivierte Administratoranmeldung prüfen, weitere Mitarbeitende über Einladungslinks freischalten.
   Bestehende nicht aktivierte Einladungen neu ausstellen.

Keine Migration wurde gegen eine reale Installation ausgeführt: lokal war weder eine
erreichbare Betriebsdatenbank noch Docker verfügbar. Vorhandene .env-Geheimnisse wurden nicht verändert.
Ein reiner `next dev`/`next start`-Prozess hat keinen Socket.IO-Server; die Oberfläche zeigt dann
fehlende Live-Verbindung. HTTP-Funktionen funktionieren trotzdem.

## 4. Testanleitung und Nachweise

### Automatisiert
```text
npx prisma generate
npx tsc --noEmit --incremental false
npx eslint src tests --quiet
npm run test:workflows
npm run build
```

`test:workflows` erzeugt eine vollständig getrennte, flüchtige PostgreSQL-Engine
(PGlite), spielt alle Migrationen ein, startet Next auf 127.0.0.1:3305 und führt echte
Anmeldungen und HTTP-Requests aus. Die Testdaten gehen nie in die konfigurierte Betriebsdatenbank.
Port 55439 wird für die Testdatenbank verwendet. Tests nicht parallel ausführen.
Ein anderer HTTP-Port ist über `TEST_PORT` möglich. `--serve` hält die Testumgebung
für eine manuelle Browserprüfung offen; sie endet beim Stoppen des Testprozesses.

Geprüft: zwei getrennte Organisationen; anonyme/Employee/Admin-Zugriffe; Aktivierung;
Entwurfsschutz; Veröffentlichung; Bestätigung und Rücknahme bei Änderung; Kopieren und Wiederholung;
Nacht-/Jahreswechsel; Kollisionen, Abwesenheiten, Qualifikationen, Verfügbarkeiten;
Tausch und offene Übernahme einschließlich Doppelgenehmigung; Stoppuhr/Pause;
Zeitkorrektur und Fremdzugriff; Stunden-/CSV-Auswertung; interne Nachricht und Lesestatus.

### Manuell als Administrator
1. Mitarbeitenden anlegen, Personendetails ergänzen, Einladung erzeugen.
2. Einsatzort mit Treffpunkt/Hinweisen und eine passende Tätigkeit anlegen.
3. In einer Woche eine Nachtschicht erstellen, wiederholen, kopieren und Person zuweisen.
4. Überlappende Schicht bzw. eine Person ohne Qualifikation zuweisen: verständliche Ablehnung erwarten.
5. Entwurf mit Mitarbeiterkonto vergleichen, veröffentlichen, Nachrichteneingang prüfen.
6. Zeit/Einsatzort ändern: neue Nachricht prüfen. Einteilung durch Planung bleibt verbindlich;
   nur Altbestand ohne eindeutige Herkunft erfordert erneut die Mitarbeiterbestätigung.
7. Urlaubs-, Tausch-, Übernahme- und Korrekturanträge prüfen und genehmigen/ablehnen.
8. Auswertung samt Pausenabzug kontrollieren und CSV in Excel öffnen.

### Manuell als Mitarbeiter
1. Einladung aktivieren, anmelden. Keine Personal-/Einstellungsverwaltung in der Navigation.
2. Eigene nächste Schicht samt Treffpunkt sehen. Einteilung durch Planung ist „fest eingeteilt“;
   nur unbestätigten Altbestand ohne eindeutige Herkunft selbst bestätigen.
3. Offene passende Schicht anfragen und eine eigene Schicht zum Tausch anbieten.
4. Verfügbarkeit eintragen; Abwesenheit beantragen und Entscheidung im Postfach prüfen.
5. Stoppuhr starten, pausieren, Seite neu laden, fortsetzen und beenden.
6. Korrektur mit Begründung anfragen: Stunden ändern sich erst nach Freigabe.
7. Eigene Monatsstunden/CSV und Schichtnachrichten prüfen.
8. Dieselben Schritte auf Smartphone-Breite prüfen; Tabellen sind horizontal scrollbar.

Die Tests ersetzen keine Abnahme gegen echte Betriebsdaten, keinen produktiven
Mehrbenutzer-Lasttest und keine Prüfung tariflicher/arbeitsrechtlicher Anforderungen.

## 5. Kunden, Standorte und Freigaben (24.09.2026)

### Struktur
- Organisation → Kunde → Standort → Wochenplan je Standort und Kalenderwoche → Schicht.
  `Shift.branchId` entfällt; der Standort einer Schicht ist der Standort ihres Plans. Arbeitsbereiche bleiben unverändert.
- Neue Standorte brauchen einen Kunden. Standorte ohne Kunde (Altbestand) stehen unter „Ohne Kunde“;
  neue Schichten sind dort erst nach der Zuordnung möglich. Pläne ohne Standort sieht nur die Administration.
- Kein Kundenzugang: Kunden sind interne Planungsdaten.

### Rollen und Freigaben
- OWNER und ADMIN: organisationsweit. MANAGER: nur freigegebene Standorte und zugeordnete Personen.
  EMPLOYEE: eigene Daten; mit Standortfreigabe zusätzlich offene Schichten bzw. der veröffentlichte Standortplan.
- Ohne Freigabe kein Zugriff. Entzug und Deaktivierung wirken bei der nächsten Anfrage;
  offene Echtzeitverbindungen werden sofort angepasst bzw. getrennt.

| Standortrecht (`branch_access`) | Wirkung |
| --- | --- |
| Dienstplan ansehen | Vollständiger Standortplan mit Namen; Manager sehen auch Entwürfe |
| Schichten erstellen und bearbeiten | Anlegen, ändern, kopieren, besetzen |
| Dienstplan veröffentlichen | Wochenpläne freigeben oder zurückziehen |
| Anträge und Schichtübernahmen bearbeiten | Übernahmen und Tausch entscheiden |
| Zeiterfassung einsehen / bearbeiten | Zeiten des Standorts – für andere Personen nur zusammen mit „Stunden einsehen“ |
| Standortmeldungen bearbeiten | Interne Meldungen mit Status, zuständiger Person und Zeitstempel |
| Offene Schichten sehen und anfragen | Offene Plätze ohne Namen anderer; Übernahme anfragen |

| Personalrecht (`staff_assignments`, nur Manager) | Wirkung |
| --- | --- |
| In Schichten einplanen | Person steht beim Besetzen zur Auswahl |
| Personalprofil ansehen | Kontaktdaten, Tätigkeit, Qualifikationen |
| Stammdaten bearbeiten | Tätigkeit, Beschäftigungsart, Sollstunden, Qualifikationen, Notizen |
| Abwesenheiten einsehen und entscheiden | Anträge sehen, genehmigen, ablehnen |
| Stunden einsehen | Zeitbuchungen und Monatswerte an Standorten mit „Zeiterfassung einsehen“ |

Folgerechte werden automatisch gesetzt (Bearbeiten, Veröffentlichen und Anträge ⇒ Ansehen ⇒ Offene Schichten;
Zeiten bearbeiten ⇒ Zeiten einsehen; Stammdaten bearbeiten ⇒ Profil ansehen). Mitarbeitende können nur
„Dienstplan ansehen“ und „Offene Schichten“ erhalten. Voreinstellungen in der Oberfläche: Plan ansehen,
Planen, Standortverantwortung; für Mitarbeitende Offene Schichten, Standortplan ansehen; für Personal
Einplanen, Personalverantwortung.

### Startseite, Monatsplan und Zeiterfassung
- Startseite für Admins und Manager: Kundenkarten mit Standorten, offenen Plätzen der nächsten 28 Tage
  (auch in Entwürfen), Entwurfswochen und Standortmeldungen. Ein Klick öffnet den Monatsplan, „offene Plätze“
  die betroffenen Tage. Zähler erscheinen nur mit dem passenden Recht. Mitarbeitende behalten ihre Startseite.
- Monatsplan je Standort in Europe/Berlin, inklusive Nachtschichten über Monats- und Jahresgrenzen.
  Fehlende Besetzung = benötigte minus wirksam zugewiesene Plätze (inaktive oder abwesende Personen zählen nicht).
- Zeitbuchungen erhalten einen Standort, wenn sie sich (Berliner Zeit) mit genau einem Standort einer
  veröffentlichten, eigenen Schicht überschneiden; ohne Uhrzeit zählt das Datum. Unklare Buchungen sehen nur
  die Person und die Administration, die sie in der Zeiterfassung zuordnen kann.

### Durchsetzung
Zentral in `src/lib/access.ts` für Seiten, Schnittstellen, Suche, Zählwerte, CSV-Export, Nachrichtenempfänger
und Echtzeiträume. Zusammengesetzte Fremdschlüssel und der Trigger `akro_same_organization` verhindern
Verknüpfungen über Organisationsgrenzen.

### Migration `20260924090000_customers_branch_access`
- Teilt Wochenpläne mit Schichten mehrerer Standorte verlustfrei auf: Schichten samt Buchungen und Anträgen,
  Veröffentlichungsstatus und Darstellung, Briefings (kopiert), Live-Sitzungen (kopiert) und Live-Protokolle.
  Bei widersprüchlichen Altdaten bricht sie ohne Änderung ab.
- Legt keine Kunden und keine Freigaben an.
- Geprüft mit `npm run test:migration` (flüchtige Datenbank) und `npm run test:migration:copy`
  (Kopie echter Daten, Datenbankname mit copy, kopie oder migtest).
- Am 24.09.2026 in die lokale Produktivinstallation (Docker-Projekt `schichtplaner`) eingespielt – nach Backup
  `backups/schichtplaner-2026-09-24_1409.sql` und Probelauf auf einer Kopie davon (26/26 Prüfungen).
  Datenstand danach: eine Organisation, ein Konto (Inhaber), keine Kunden, keine Standorte, 11 leere Wochenpläne ohne Standort.

### Einrichtung durch die Administration
1. **Einsatzorte**: „Kunde anlegen“, danach „Einsatzort anlegen“; Altstandorte über „Kunden zuordnen“.
2. **Mitarbeiter** → Person → **Freigaben** → „Standort freigeben“, Umfang wählen, „Freigeben“.
3. Bei Managern „Mitarbeitende zuordnen“; einzelne Rechte über „Rechte ändern“.
4. „Entziehen“ bzw. „Zuordnung entfernen“ nimmt die Freigabe sofort zurück.

### Offene fachliche Punkte
- Welche Freigaben erhalten Manager und Mitarbeitende beim Anlegen?
- Dürfen Admins eigene Zeitkorrekturen genehmigen (derzeit ja; Manager nein)?
- Vorläufig festgelegt: KI, Zeitkategorien und Dateiverwaltung nur für Admins; Sollstunden anderer nur für Admins;
  Themen und Portal-Dateien organisationsweit; Admin-Namen für alle als Ansprechpartner sichtbar.

## 6. Mitarbeitende mit Standorten anlegen und besetzen

### Standortzuordnung
- Beim Anlegen erhält jede Person mit der Rolle Mitarbeiter einzelne Standorte, auch über Kunden hinweg.
  Die Zuordnung ist für den Pilot die Freigabe „Offene Schichten sehen und anfragen“: offene Plätze ohne Namen
  anderer und Übernahmeanträge – kein vollständiger Standortplan, keine Personaldaten.
- Admins: alle Rollen und Standorte. Manager: nur die Rolle Mitarbeiter und nur Standorte, an denen sie selbst
  „Schichten erstellen und bearbeiten“ haben; geprüft in `POST /api/employees`, eine abgelehnte Zeile verwirft die
  ganze Anfrage. Manager legen nur neue E-Mail-Adressen an; bestehende Benutzerkonten bindet die Administration an.
- Der anlegende Manager erhält für die neue Person genau das Personalrecht „In Schichten einplanen“.
- Ändern: Mitarbeiterliste → „Standorte“ (`/api/employees/[id]/sites`). Manager nur für Personen, die sie einplanen
  dürfen, und nur an eigenen Planungsstandorten; Freigaben mit mehr als der Zuordnung ändert nur die Administration.
- Aktivierungslink: erscheint nach dem Anlegen im Dialog; einen neuen gibt es in der Mitarbeiterliste
  („Einladungslink“). Manager nur für selbst angelegte, noch nicht aktivierte Konten (`createdByMemberId`,
  Migration `20260924150000_member_created_by`).

### Besetzen
Voraussetzung ist „Schichten erstellen und bearbeiten“ am Standort der Schicht. Die Auswahl hat genau diese
Reihenfolge; der Grund steht an der Person:
1. Freie Mitarbeitende des Standorts der Schicht.
2. Belegte oder abwesende Mitarbeitende dieses Standorts – sichtbar; Belegte (Überschneidung) nach Bestätigung
   wählbar, Abwesende und Gesperrte nicht.
3. Freie Mitarbeitende anderer Standorte desselben Kunden, die die planende Person mit „Schichten erstellen und
   bearbeiten“ verwaltet.
4. Belegte oder abwesende Mitarbeitende dieser Standorte – wie Gruppe 2.
5. Übrige: bei Managern persönlich mit „In Schichten einplanen“ zugeordnete Personen, bei Admins alle weiteren.
   Freie sind wählbar, gesperrte sichtbar.

- Für die Gruppen 1–4 genügt die Standortzuordnung; eine Personalzuordnung ist nicht nötig. Dieselbe Regel gilt in
  `GET /api/shifts/[id]/candidates` und `POST /api/bookings` (`planningPool` in `src/lib/planning.ts`). Die
  Auswahl gibt nur Namen und kurze Gründe aus; ein Personalprofil entsteht daraus nicht.
- Frei ist, wer keine zeitliche Überschneidung, keine genehmigte Abwesenheit und keine ausdrücklich eingetragene
  Nichtverfügbarkeit hat; ohne Verfügbarkeitseintrag gilt eine Person als frei. Ausdrücklich Verfügbare stehen
  innerhalb ihrer Gruppe zuerst.
- Hinweise ändern Gruppe und Reihenfolge nicht und verlangen genau eine Bestätigung: fehlende Qualifikation,
  unpassende Tätigkeit, fremder Arbeitsbereich, Schicht außerhalb der eingetragenen Verfügbarkeit. API:
  `POST /api/bookings` antwortet ohne `confirm: true` mit 409 und `{ confirm: true, warnings }`. Eine bestätigte
  Einteilung sperrt auch spätere Änderungen der Schicht nicht, solange kein neuer Hinweis entsteht.
- Zeitliche Überschneidung (organisationsweit, auch über Standorte): Hinweis mit Bestätigung durch die Planung
  (Entscheidung vom 12.10.2026); die Person steht als „belegt“ in Gruppe 2 bzw. 4. Mitarbeitende können sich nicht
  selbst überschneidend einteilen: Übernahme- und Tauschanträge mit Überschneidung werden abgelehnt.
- Gesperrt, auch mit Bestätigung: genehmigte Abwesenheit, eingetragene Nichtverfügbarkeit,
  inaktives Konto, inaktiver Standort, fehlende Rechte, volle Schicht.
- Eine Einteilung an einem anderen Standort ändert die Standortzuordnung der Person nicht. Mitarbeitende tragen
  sich nie selbst ein; sie stellen Übernahme- oder Tauschanträge.

## 7. Subunternehmer und Planungsplatzhalter (01.10.2026)

- Subunternehmer sind eigene interne Unternehmensstammdaten, getrennt von Kunden und Organisationen.
  Darunter stehen beliebig viele benannte Platzhalter (z.B. MA 1, MA 2). Es werden keine `User`,
  Mitgliedschaften, E-Mail-Adressen oder Aktivierungslinks dafür angelegt.
- OWNER/ADMIN verwalten Unternehmen und Platzhalter und besetzen vorhandene Schichten damit.
  Manager erhalten keine neuen Rechte. Die bestehende Standortplansicht zeigt berechtigten Personen
  die Besetzung mit Unternehmensname und Platzhalter; Entwürfe bleiben Mitarbeitern verborgen.
- Ein Platzhalter zählt als ein belegter Platz. Kapazität, doppelte Einteilung, Aktivstatus und
  zeitliche Überschneidung werden in derselben serialisierbaren Transaktion wie die Buchung geprüft.
  Eine Überschneidung ist ein Hinweis mit Bestätigung durch die Planung. Bei geforderter Qualifikation,
  Tätigkeit oder einem nicht allgemeinen Arbeitsbereich weist die Auswahl auf die fehlenden Angaben hin und
  verlangt ebenfalls die Bestätigung der Planung.
  Urlaub und Verfügbarkeit werden für diese kontolosen Platzhalter nicht geführt.
- Kopieren mit Zuweisungen übernimmt auch Platzhalter und prüft den Zieltermin erneut.
  Änderungen einer belegten Schicht prüfen Konflikte und neu entstehende fachliche Hinweise.
  Platzhalter erhalten keine Benachrichtigungen, Übernahme-/Tauschanträge, Bestätigungsaufforderungen
  oder Zeiterfassung. Eine direkte Einteilung ist verbindlich (`PLANNER`).
- Die Monatsübersicht unter Subunternehmer zeigt belegte Schichten je Unternehmen/Platzhalter,
  einschließlich Entwürfen und Nachtschichten aus dem Vormonat. Sie ist kein Iststunden- oder
  Abrechnungsnachweis. Umbenennungen erscheinen auch in der Historie unter dem aktuellen Namen.
- Deaktivierung verhindert neue Einteilungen, erhält vorhandene Einsätze und deren belegte Plätze.
  Vergangene Zuweisungen können nicht entfernt werden. Eine endgültige Löschung von Subs/Platzhaltern
  wird nicht angeboten.
- Migration `20261001120000_subcontractors` ergänzt Tabellen und eine dritte mögliche Personenreferenz
  an Buchungen. Der CHECK erlaubt genau eine Referenz; Fremdschlüssel und Trigger verhindern
  Verbindungen über Organisationsgrenzen. Vorhandene Buchungen werden nicht verändert.
- Lokale Prüfergebnisse stehen in `docs/FERTIGSTELLUNG.md`; Betriebsinstallation und Betriebsdaten
  wurden für diese Erweiterung nicht geändert.

## 8. Lohn (Port P1 aus dem Cloud-Branch, 13.10.2026, nicht eingespielt)

Herkunft: Cloud-Commits `8e6e865`, `4346c44`, `6c75b86` (Branch `claude/wizardly-cerf-cxbutc`), an die
Hauptlinie angepasst. Sätze, Lohnarten und Zuschläge trägt AKRO selbst ein; der Code gibt keine vor.

- **Grundlage:** abgeschlossene Zeitbuchungen (Ist) im Zeitraum, nach Buchungsdatum wie die Monatsauswertung;
  laufende Stoppuhren zählen nicht. Ohne Buchung kein Lohn. Genehmigt/ungenehmigt unterscheidet P1 nicht.
- **Lohnart:** die des Arbeitsbereichs der Schicht vor der Standard-Lohnart der Person; inaktive zählen nicht. Die
  Schicht ergibt sich aus dem Check-in oder aus der einzigen veröffentlichten Schicht der Person, die sich mit der
  Buchung überschneidet.
- **Zeiten ohne Lohnart:** Stunden erscheinen in Lohnseite und Export als Zeile „Ohne Lohnart“ mit 0,00 € und dem
  Hinweis „Keine Lohnart hinterlegt.“; Prozentzuschläge ergeben dann 0,00 € mit Hinweis, feste Beträge je Stunde
  werden gezahlt.
- **Zuschläge:** Minuten im Zeitblock an passenden Tagen (Wochentag, Feiertag, Sonderdatum je Jahr); ein Block gehört
  zu dem Tag, an dem er beginnt; Pausen anteilig; mehrere Zuschläge addieren sich (keine Vorrangregel, keine
  § 3b-EStG-Logik). Buchungen nur mit Dauer erhalten nur ganztägige Zuschläge.
- **Feiertage je Einsatzort:** gesetzliche Feiertage im Bundesland des Einsatzorts der Zeitbuchung
  (`branchHolidays`); Zeiten ohne Einsatzort nutzen die Feiertage der Organisation (Einstellungen › Abwesenheiten).
  Hat ein Einsatzort kein Bundesland, gibt es dort keinen Feiertagszuschlag, auch nicht an bundesweiten Feiertagen;
  die Lohnseite nennt den Einsatzort („Für Einsatzort X ist kein Bundesland festgelegt …“). Die Planansicht zeigt in
  diesem Fall die bundesweiten Feiertage – bewusste Abweichung, damit kein Zuschlag auf einer Vermutung beruht.
- **Gelöschte Personen:** ihre Zeiten bleiben im Lohn, als eigene Zeile mit dem Namen aus der Momentaufnahme
  („gelöscht“); der Arbeitsbereich kommt über die behaltene Zuweisung. Personalnummer, Standard-Lohnart und
  personenbezogene Zuschläge gehen mit dem Konto verloren (Hinweis in der Zeile; seit Port P5 auch bezahlte
  Abwesenheiten, Abschnitt 10). Lohn daher vor dem Löschen abrechnen.
- **Sub-Platzhalter:** haben keine Zeitbuchungen und damit keinen Lohn; Platzhalter in derselben Schicht stören die
  Zuordnung nicht.
- **Neuberechnung:** Lohn wird bei jedem Aufruf aus den aktuellen Sätzen berechnet; geänderte Sätze oder gelöschte
  Zuschläge ändern auch vergangene Zeiträume. Es gibt keinen Abschluss.
- **Rundung:** Cent-Beträge je Buchung und Zeile; im Export kann „Stunden × Satz“ deshalb um Cent vom Betrag abweichen.
- **Rechte:** Lohnseite, Einstellungen und alle `/api/payroll/**` nur Inhaber/Administration (`requireAdmin`); Disposition
  und Mitarbeitende 403, fremde Organisation 404.
- **Export:** CSV (Semikolon, UTF-8 mit BOM) je Person und Lohnart/Zuschlag mit Personalnummer, Nachname, Vorname,
  Code, Stunden, optional Satz und Betrag; Personen abwählbar. Kein DATEV-Format.
- **Bedienung:** Navigation „Lohn“ (Gruppe Organisation, mobil unter „Mehr“); Einstellungen › Lohnarten/Zuschläge
  (`/settings?bereich=payroll`). Seit dem Port P2 ist die Lohnseite in „Stunden und Lohn“ aufgegangen (`/payroll`
  leitet nach `/hours`, Abschnitt 9); Rechenregeln und Rechte unverändert.
- **Migration `20261013100000_payroll`:** rein additiv (Tabellen `pay_types`, `surcharges`; Spalten `personnelNumber`,
  `payTypeId`); im Cloud-Branch hieß sie `20261012090000_payroll` (Zeitstempel-Dublette).
- **Offen (AKRO/Steuerbüro):** Sätze und Lohnarten, Vorrangregeln der Zuschläge, steuerliche Behandlung; ob nur
  freigegebene Stunden bezahlt werden (Stundenfreigabe, P2).

## 9. Stunden prüfen (Port P2) und Stundenzettel (Port P3), 13.10.2026, nicht eingespielt

Herkunft: Cloud-Commits `0ff8e24`, Teil von `d35d168`, `5f4e78d` (Branch `claude/wizardly-cerf-cxbutc`), an die
Hauptlinie angepasst. Seite „Stunden und Lohn“ (`/hours`) ersetzt die Lohnseite aus Abschnitt 8.

- **Schichtbezug:** Jede Zeitbuchung gehört zu höchstens einer geplanten Schicht (`time_records.shiftId`): über den
  Check-in, sonst die einzige veröffentlichte Schicht der Person, mit der sie sich überschneidet (Regel wie
  `branchForTime`). Buchungen ohne Schicht stehen als eigene Zeile. Check-in und Zeiterfassung nutzen immer die
  Live-Zeilen, auch wenn der Plan in Bearbeitung ist.
- **Status je Schicht:** genehmigt, offen, **nicht erfasst** (Schicht vorbei, keine Buchung), geplant (Zukunft), läuft
  (Stoppuhr). Eine Schicht ohne Buchung zählt nicht als gearbeitet; „Zeit wie geplant nachtragen“ erfasst sie mit
  einem Klick – nur für Personen mit Konto.
- **Genehmigen:** Administration, oder Disposition mit „Zeiterfassung bearbeiten“ am Standort der Buchung und „Stunden
  einsehen“ für die Person; eigene Buchungen nur die Administration. Rücknahme möglich. Prüfende ändern fremde
  Buchungen direkt (sofort wirksam, genehmigt, Vorher/Nachher als entschiedene Korrektur im Verlauf); Einträge der
  Prüfenden für andere gelten als genehmigt. Mitarbeitende beantragen Korrekturen wie bisher (`time/corrections`).
- **Automatisch genehmigen:** Einstellungen › Zeiterfassung › „Selbst erfasste Zeiten automatisch genehmigen“
  (Vorgabe aus). Solche Buchungen haben keinen Prüfer und erscheinen als „automatisch übernommen“.
- **Altbestand:** Die Migration `20261013110000_time_approval` (Cloud: `20261013090000_time_approval`) setzt für alle
  abgeschlossenen Altbuchungen `approvedAt = updatedAt` ohne Prüfer (`approvedById` leer) – Anzeige „automatisch
  übernommen“, im Stundenzettel „autom. übernommen“. Laufende Stoppuhren bleiben offen. Den Schichtbezug übernimmt
  sie nur aus dem Check-in (je Buchung höchstens einer, `timeRecordId` eindeutig). Zeiten gelöschter Personen werden
  ebenso behandelt.
- **Gelöschte Personen:** Zeiten und vergangene Zuweisungen erscheinen nur für die Administration als eigene Zeile
  („gelöscht“, Name aus `FormerEmployee`); genehmigen geht, ändern und nachtragen nicht. Kein Stundenzettel für
  gelöschte Personen (Drucken der Seite bleibt möglich).
- **Sub-Platzhalter:** haben keine Zeiten; eine nur mit Platzhaltern besetzte Schicht erzeugt keine Zeile und kein
  „nicht erfasst“.
- **Pläne in Bearbeitung:** Wer den Plan nicht live sieht (Mitarbeitende, Disposition ohne „Dienstplan ansehen“),
  bekommt in „Stunden und Lohn“ und im Stundenzettel die Planspalte aus der Momentaufnahme
  (`lib/schedule-frozen.ts`); Iststunden bleiben live. Planende sehen die Live-Zeilen.
- **Stundenzettel (PDF):** je Person und Zeitraum mit Plan, Beginn, Ende, Pause, Stunden, Stunden je Zuschlag (ohne
  Beträge; Feiertage nach Bundesland des Einsatzorts wie im Lohn), Nachweis (GPS, Check-in freigegeben, Stoppuhr,
  manuell, Dauer), Status und Unterschriftsfeldern; Name immer mit Vor- und Nachname. Mitarbeitende erstellen ihren
  eigenen unter Zeiterfassung › „Mein Stundenzettel“. **Leistungsnachweis (PDF)** je Einsatzort für den Kunden, wenn
  oben ein Standort gewählt ist.
- **Vorläufige Fachannahmen (AKRO entscheidet):** Die Genehmigung steuert Lohn, Lohnexport und Auswertung **nicht** –
  offene Stunden werden mitbezahlt (der Exportdialog nennt ihre Zahl). „Nicht erfasst“ mit Nachtragen statt „Ist =
  Plan“. Automatische Genehmigung standardmäßig aus. Soll später nur Genehmigtes bezahlt werden, setzt der Filter an
  einer Stelle an: in `payrollData()` (`lib/payroll-service.ts`) in der Abfrage `db.timeRecord.findMany` zusätzlich
  `approvedAt: { not: null }` – das wirkt dann auf Lohnseite, Lohnexport und Stundenzettel-Zuschläge gemeinsam.

## 10. Zeitkonten, Abwesenheit, Urlaubskonto – so rechnet der Schichtplaner (Port P4/P5, 13.10.2026, nicht eingespielt)

Herkunft: Cloud-Commits `0de1cc7` (Zeitkonten), `c21d5b3` (Abwesenheit wirkt, Urlaubskonto), `ef304e8` und `8b69405`
(Branch `claude/wizardly-cerf-cxbutc`), an die Hauptlinie angepasst. Sollstunden, Urlaubstage und Lohnart-Codes trägt
AKRO selbst ein; der Code gibt keine vor.

### Zeitkonten (P4)

- **Einstellungen › Zeitkonten** (`/settings?bereich=accounts`, nur Administration): einschalten (Vorgabe aus),
  Berechnungsart **Ist − Soll** (Vorgabe), **Plan − Soll** oder **Ist − Plan**, Sichtbarkeit für Mitarbeitende (Vorgabe
  aus); je Person einbeziehen/ausnehmen, eigene Berechnungsart und Sichtbarkeit.
- **Soll** je Person ab einem Startdatum, je Woche (Mo–So) oder je Kalendermonat; jeder Eintrag gilt bis zum nächsten,
  gerechnet wird ab dem ersten Eintrag, auch rückwirkend. Beginnt oder endet ein Soll mitten in einer Woche bzw. einem
  Monat, zählt es anteilig nach Werktagen Mo–Fr. Aus „Sollstunden/Monat“ der Person wird nichts abgeleitet (der Wert
  dient nur als Vorschlag im Eingabefeld).
- **Ist** = abgeschlossene Zeitbuchungen der Person nach Buchungsdatum (genehmigt und offen; laufende Stoppuhr nicht)
  plus bezahlte Abwesenheit mit den Planstunden der Schicht, wenn für die Schicht keine Zeit erfasst ist. **Plan** =
  Planminuten veröffentlichter Schichten aus `planning.ts` (echte Dauer in Europe/Berlin, also 7 bzw. 9 Stunden in den
  Nächten der Zeitumstellung; die Cloud rechnete mit der Wanduhr). Tage nach heute zählen bei „Ist − Soll“ mit ihren
  Planstunden.
- **Ausgleich** ± Stunden mit Datum und Text (z. B. ausbezahlte Überstunden, Anfangssaldo), zählt in der Periode seines
  Datums, vor dem ersten Soll in der ersten. Auch beim Genehmigen einer Abwesenheit buchbar.
- **Anzeige:** Spalte „Saldo“ in „Stunden und Lohn“ und Knopf „Zeitkonto“ im aufgeklappten Personeneintrag (Perioden
  mit Soll, Plan, Ist, Ausgleich, laufendem Saldo; bei 375 px ohne Plan- und Ausgleichsspalte); eigener Stand unter
  Zeiterfassung, nur wenn sichtbar.
- **Pläne in Bearbeitung:** Wer den Plan nicht live sieht (Mitarbeitende, Disposition ohne „Dienstplan ansehen“), bekommt
  die Planstunden der Momentaufnahme – wie „Stunden und Lohn“; Ist bleibt live.
- **Gelöschte Personen und Platzhalter:** Konto, Soll und Ausgleich hängen an der Mitgliedschaft und werden mit der
  Person gelöscht. Zeilen gelöschter Personen in „Stunden und Lohn“ haben keinen Saldo, ihr Konto antwortet 404 – den
  Saldo daher vor dem Löschen festhalten (z. B. als Lohnabrechnung). Platzhalter von Subunternehmern haben kein Zeitkonto.
- **Vorläufige Fachannahmen (AKRO entscheidet):** Saldo = Stand am Ende des gewählten Zeitraums, Tage nach heute mit
  Planstunden (wie Smartplan); die Stundenfreigabe steuert den Saldo nicht (offene Buchungen zählen).
- **Migration `20261013120000_time_accounts`** (Cloud: `20261014090000_time_accounts`): rein additiv, Konten zunächst
  aus, kein Konto und kein Soll für den Bestand.

### Abwesenheit wirkt (P5)

- **Genehmigen mit Folgen:** Beim Genehmigen (Liste, Formular, „Direkt genehmigen“) zeigt „Folgen der Abwesenheit“ die
  Schichten der Person, die den Zeitraum berühren (Nachtschichten auch an ihrem Folgetag, wie Konfliktprüfung und
  Einteilen; veröffentlicht, in Bearbeitung oder Entwurf). Je Schicht: **zählt Stunden (bezahlt)**, **zählt 0 Stunden**
  oder **Person austragen**. Vorgabe aus der Abwesenheitsart (bezahlt → Stunden, unbezahlt → 0); ausgetragen wird nie
  als Vorgabe. Optional ein Ausgleich auf das Zeitkonto.
- **Person austragen ist eine Planänderung** wie „Zuweisung aufheben“ (gemeinsamer Ablauf `releaseAssignment` in
  `lib/shift-requests.ts`, auch von `DELETE /api/bookings` genutzt): nur Administration oder „Schichten bearbeiten“ am
  Standort (sonst 403), nicht nach Schichtende oder Check-in (409 – dann wird die ganze Genehmigung nicht gespeichert),
  offene Anträge der Person zu dieser Schicht werden abgelehnt (Beteiligte werden wie beim Aufheben informiert). Die
  Person erhält „Schichtzuweisung aufgehoben“ nur bei veröffentlichten Plänen außerhalb der Bearbeitung
  (`notifiesEmployees`); bei Plänen in Bearbeitung kommt die Änderung mit der Sammelmitteilung beim Veröffentlichen, bei
  Entwürfen gar nicht. Nach dem Speichern gehen `booking:changed` (Standort, Person, Beteiligte) und `schedule:updated`
  hinaus. Andere Personen und Platzhalter in derselben Schicht bleiben.
- **Konfliktprüfung:** Bleibt die Person eingeteilt, meldet das Konfliktpanel die Zuweisung weiter rot als „Genehmigte
  Abwesenheit (bezahlt).“ bzw. „(0 Stunden).“ – mit dem Umgang, ohne die Art.
- **Wirkung:** „Stunden und Lohn“ Status **abwesend** (Ist = Planstunden bzw. 0, kein Nachtragen); Altbestand ohne
  Entscheidung: abwesend mit 0 Stunden („ohne Festlegung“). Lohn: eigene Zeile „Abwesenheit: Art“ mit Planminuten ×
  Stundenlohn der geltenden Lohnart (Arbeitsbereich vor Person), ohne Zuschläge, mit dem Lohnart-Code der
  Abwesenheitsart (Einstellungen › Abwesenheiten, sonst Code der Lohnart); Lohnexport Art „Abwesenheit“; Stundenzettel
  „abwesend: Art (bezahlt)“; Zeitkonto (Ist). Der Leistungsnachweis für den Kunden enthält keine Abwesenheiten.
- **Gezählt** wird bezahlte Abwesenheit nur bei veröffentlichten Plänen, solange die Zuweisung besteht und die Schicht
  den Zeitraum der Abwesenheit berührt, je Person und Schicht (mehrere Abwesende einer Schicht stören sich nicht); hat
  die Person für die Schicht doch Zeit erfasst, gilt die Zeit (keine Doppelzahlung).
- **Datenschutz:** Die Art der Abwesenheit nennen „Stunden und Lohn“ und Stundenzettel nur der Person selbst, der
  Administration und der Disposition mit „Abwesenheiten entscheiden“ für die Person; sonst „Genehmigte Abwesenheit“ mit
  dem Umgang. Die Vorschau nennt Standort, Kunde, Titel und Arbeitsbereich nur mit „Dienstplan ansehen“ am Standort.
  Den Lohnart-Code einer Abwesenheitsart liefert die Schnittstelle nur der Administration.
- **Rücknahme:** Zurück auf „offen“ oder Löschen hebt Stunden und Lohn auf; ausgetragene Schichten bleiben offen. Ändert
  die Entscheidung eine genehmigte Abwesenheit (Zeitraum, Art), gilt für neu betroffene Schichten die Vorgabe,
  bestehende Entscheidungen bleiben. Genehmigt wird mit Person und Zeitpunkt gespeichert.
- **Gelöschte Personen:** Ihre Abwesenheiten und Entscheidungen werden mit der Person gelöscht (wie bisher). Behaltene
  Zuweisungen erscheinen danach als „nicht erfasst“; bezahlte Abwesenheit fehlt im Lohn – der Hinweis an Lohnzeilen
  gelöschter Personen nennt das. Lohn daher vor dem Löschen abrechnen.
- **Vorläufig (AKRO entscheidet):** Die Genehmigung der Stunden steuert den Lohn nicht. Lohnfortzahlung
  (Lohnausfallprinzip, Zuschläge bei Abwesenheit) mit dem Steuerbüro klären.
- **Migration `20261013130000_absence_effects`** (Cloud: `20261015090000_absence_effects`): rein additiv; genehmigte
  Altabwesenheiten behalten ihren Status, ohne „genehmigt von“ und ohne Entscheidung (erscheinen als abwesend mit 0
  Stunden, bis sie erneut entschieden werden).

### Urlaubskonto (P5)

- **Einstellungen › Urlaubskonto** (`/settings?bereich=vacation`, nur Administration): einschalten (Vorgabe aus),
  abgezogene Abwesenheitsart, **Urlaubstage je Jahr (keine Vorgabe – ohne Eintrag kein Konto; die Cloud gab 30 vor)**,
  Beginn des Urlaubsjahres (Vorgabe 01.01.), Beginn des Kontos (beim ersten Einschalten das aktuelle Urlaubsjahr),
  Zuteilung ganz zu Jahresbeginn (bei späterem Beginn anteilig nach vollen Monaten) oder monatlich ein Zwölftel, Übertrag
  ins nächste Jahr (Vorgabe ja, optional Höchstgrenze), Wochentage ohne Abzug (Vorgabe Sa, So), „Urlaub an Feiertagen
  zählt“ (Vorgabe nein), Sichtbarkeit für Mitarbeitende (Vorgabe ja). Je Person abweichend: Tage, Beginn (z. B.
  Eintritt), Übertrag, ohne Konto.
- **Feiertage (Hauptlinie):** An einem Urlaubstag mit eingeplanter Schicht (veröffentlichter Plan) gelten die gesetzlichen
  Feiertage im Bundesland ihres Einsatzorts (`holidaysForRecord`/`branchHolidays`, wie im Lohn; Einsatzort ohne
  Bundesland: kein Feiertag); mehrere Schichten: Feiertag, wenn er es an einem ihrer Einsatzorte ist. Nur wo kein
  Einsatzort beteiligt ist (keine Schicht an dem Tag, Plan ohne Standort), gelten die Feiertage der Organisation
  (Einstellungen › Abwesenheiten). Die Cloud nahm immer die Organisationsfeiertage.
- **Abzug:** genehmigter Urlaub (genommen bis heute, geplant danach); beantragter wird angezeigt („beantragt“), aber
  nicht abgezogen. Korrekturen ± ganze oder halbe Tage mit Kommentar, nur durch die Administration (Kontoauszug ›
  „Saldo anpassen“).
- **Anzeige:** im Antrag „Urlaubskonto: verfügbar … · dieser Zeitraum … · danach …“; unter „Abwesenheiten“ das eigene
  Konto (wenn sichtbar) und die Ansicht „Urlaubskonten“ (Administration; Disposition für Personen mit „Abwesenheiten
  entscheiden“) mit Kontoauszug je Urlaubsjahr.
- **Gelöschte Personen:** Regeln, Korrekturen und Abwesenheiten gehen mit der Person; kein Konto (404), keine Zeile in der
  Übersicht. Deaktivierte Personen stehen nicht in der Übersicht, ihr Konto bleibt für die Administration abrufbar.
- **Migration `20261013140000_vacation_account`** (Cloud: `20261016090000_vacation_account`): rein additiv, zunächst aus;
  `daysPerYear` ohne Vorgabe (Cloud: `DEFAULT 30`).

### Rechte (serverseitig, Tests in `tests/time-accounts.ts`, `tests/absence-effects.ts`, `tests/vacation.ts`)

| Was | Wer | Sonst |
|---|---|---|
| Zeitkonten einrichten, Soll, Ausgleich buchen/löschen, Person ein-/ausnehmen | Administration | Disposition und Mitarbeitende 403, fremde Organisation 404 |
| Zeitkonto/Saldo einer Person sehen | Administration; Disposition mit „Stunden einsehen“ für die Person; die Person selbst, wenn sichtbar | 404 |
| Folgen einer Abwesenheit sehen und festlegen | Administration; Disposition mit „Abwesenheiten entscheiden“ (nicht für sich) | 404; Folgen ohne Genehmigung 400 |
| Person austragen | Administration; „Schichten bearbeiten“ am Standort der Schicht | 403; nach Schichtende/Check-in 409 |
| Urlaubskonto einrichten, Regeln je Person, Korrekturen | Administration | Disposition und Mitarbeitende 403, fremde Organisation 404 |
| Urlaubskonto einer Person sehen, Übersicht | Administration; Disposition mit „Abwesenheiten entscheiden“; die Person selbst, wenn sichtbar (Übersicht nicht) | 404 |
| Lohnart-Code einer Abwesenheitsart | Administration | wird anderen nicht geliefert |

### Offen (fachlich, AKRO)

- Saldo-Stichtag (Ende des Zeitraums oder heute); Lohn und Saldo nur aus genehmigten Stunden.
- Lohnfortzahlung bei Abwesenheit (Lohnausfallprinzip, Zuschläge, Code je Art) mit dem Steuerbüro.
- Urlaubsregeln: Übertrag und Verfall (z. B. bis 31.03.), Teilurlaub, Urlaubstage je Person – trägt AKRO ein.
- Feiertage für Urlaubstage ohne Schicht: Organisationsfeiertage oder Bundesland des Stamm-Einsatzorts?
- Soll die Konfliktprüfung den Umgang „bezahlt/0 Stunden“ der Disposition ohne „Abwesenheiten entscheiden“ zeigen?
