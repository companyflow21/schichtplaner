# Betriebsübergabe an Claude

Stand: 05.10.2026. Diese Datei beschreibt das Betriebsverfahren; den tatsächlichen Prüfstand führt `docs/FERTIGSTELLUNG.md`, dort zuerst den aktuellen Abschlussabschnitt lesen. Lokale PostgreSQL-, Restore- und Kopiemigrationsproben vom 03.–05.10. sind dort dokumentiert. Sie bestätigen keine Veröffentlichung auf Netcup. Nur im Projekt `schichtplaner` arbeiten. Keine Datenbank zurücksetzen, kein `docker compose down -v`, keine bestehenden Volumes löschen und keine Testdaten in Betriebsdatenbanken anlegen. Änderungen im Betrieb und Veröffentlichung benötigen einen ausdrücklichen Auftrag.

## Ausgangslage

- Docker Desktop ist inzwischen lokal vorhanden; PostgreSQL-Werkzeuge laufen im getrennten Testcontainer. Bei fehlendem PATH den tatsächlich installierten Docker-Pfad verwenden; keine neue Installation erforderlich.
- Die localhost-Testports 15432 und 18080 wurden vom Hauptagenten als frei geprüft. Dies vor dem Start erneut prüfen.
- `docker-compose.test.yml` beschreibt ein eigenes Projekt, Netzwerk, Volume und die Datenbank `schichtplaner_test`. Die vorhandene Testinstallation wurde separat geprüft; vor jedem weiteren Lauf die tatsächliche Isolation erneut verifizieren.
- PostgreSQL und Test-App sind in der Konfiguration ausschließlich an localhost gebunden: `127.0.0.1:15432` und `127.0.0.1:18080`.
- Der Dockerfile verwendet Node 24 und startet `server.ts` über `tsx`, einschließlich Socket.IO. Der Test-Compose-Migrationsdienst nutzt den `builder` und `prisma migrate deploy`; die App wartet auf dessen erfolgreichen Abschluss.
- Maßgeblich sind `ANLEITUNG.md`, die aktuelle Arbeitsliste und die tatsächlich ausgeführten Prüfungen. Keine früheren Testergebnisse als neuen Betriebsnachweis übernehmen.

## 1. Isolierte Testinstallation starten

1. Docker-Verfügbarkeit und freien Speicher auf dem vorgesehenen Testhost feststellen. Host, Compose-Projekt, Netzwerk, Volume, Datenbank und erreichbare Adresse dokumentieren. Prüfen, dass nichts mit der Betriebsinstallation geteilt wird; ein anderer Datenbankname allein genügt nicht.
2. Ausschließlich eigene Testkonfiguration `.env.test` verwenden. Benötigt werden mindestens `POSTGRES_PASSWORD`, `AUTH_SECRET` und `APP_URL`; `AI_ENABLED=false` setzen. Vorhandene Testwerte verwenden oder deren Bereitstellung klären. Betriebs-`.env` nicht kopieren oder ausgeben. Bei Erstregistrierung die geltende Registrierungskonfiguration prüfen und danach wieder schließen.
3. Aus dem Projektverzeichnis zunächst nur Konfiguration validieren, dann starten:

   ```text
   docker compose -p schichtplaner-test -f docker-compose.test.yml --env-file .env.test config --quiet
   docker compose -p schichtplaner-test -f docker-compose.test.yml --env-file .env.test up -d --build
   docker compose -p schichtplaner-test -f docker-compose.test.yml --env-file .env.test ps -a
   ```

4. Erfolg nachweisen: PostgreSQL meldet Version und die erwartete Testdatenbank; `migrate` beendet sich mit Exitcode 0; App wird healthy; `/api/health`, Anmeldung und zwei Browser mit Echtzeitänderung funktionieren. Neue Testorganisation und getrennte Admin-, Manager- und Mitarbeiterkonten verwenden. Testkonfiguration und Ergebnisse ohne Geheimnisse dokumentieren.

## 2. Sicherung und Wiederherstellung zuerst proben

1. Quelle und Ziel anhand Verbindung/Host, Container bzw. Cluster, Datenbank, Rollen und Compose-Volume verifizieren. Eine Betriebssicherung nur im dafür erteilten Auftrag erstellen und außerhalb des Repositorys geschützt ablegen.
2. `scripts/backup-database.ps1` ist auf `docker-compose.yml`, Dienst `postgres`, Benutzer und Datenbank `schichtplaner` zugeschnitten. Für Test-Compose oder einen entfernten Host nicht blind ausführen. Das passende Verfahren muss explizit auf die verifizierte Quelle zeigen.
3. Das Skript liefert einen Custom-Dump, `pg_restore --list` und SHA256. Lesbarkeit allein ist kein Wiederherstellungstest. Dump-Prüfsumme prüfen und den Dump mit `pg_restore --exit-on-error` in eine **separate, neu angelegte, leere Kopiedatenbank** wiederherstellen. Keine bestehende Datenbank leeren oder mit `--clean` überschreiben.
4. Wiederhergestellte Kopie anhand Zeilenzahlen, stabilen Datenhashes und Referenzen mit der gesicherten Quelle vergleichen. Quelle während des Vergleichs unverändert halten oder einen konsistenten Sicherungszeitpunkt zugrunde legen. Dauer, Datenumfang, Dump-Hash, Wiederherstellungsbefehl ohne Zugangsdaten und Ergebnis festhalten. Rohdaten und personenbezogene Inhalte bleiben geschützt.

## 3. Die aktuellen Migrationen an der Kopie prüfen

Die neuesten Migrationen sind `20261001090000_employee_delete_history_confirmation` und `20261001120000_subcontractors`. Zuerst den tatsächlichen Stand von `_prisma_migrations` und das Schema der Kopie feststellen; nur ausstehende Migrationen einspielen.

**Wichtig:** `tests/migration-copy.ts` prüft die ältere Standortmigration und verlangt die alte Spalte `organizations.scheduleVisibility`. Eine aktuelle Kopie wird deshalb abgewiesen. Außerdem erwartet das Skript leere Kundenstammdaten und unveränderte Buchungsbestätigungen; das passt nicht allgemein zum aktuellen Bestand. `npm run test:migration:copy` nicht als Nachweis für diese beiden Migrationen verwenden. Der aktuelle Vergleich ist `tests/migration-copy-current.ts`: `snapshot`/`vergleich` für den Restore, `vorher`/`nachher` für die beiden Migrationen. Verbindung und Isolation vorher separat verifizieren; Vergleichsdateien geschützt außerhalb des Repositorys speichern.

1. Vorher: Zeilenzahlen **aller vorhandenen Fachtabellen** sichern. Pro Tabelle einen deterministischen Hash der nach Primärschlüssel sortierten Zeilen über die erhalten bleibenden Spalten bilden. Vergleichsdaten geschützt außerhalb des Repositorys ablegen. Zusätzlich die Zuordnungen Schicht→Plan→Standort→Organisation sowie Buchung/Check-in/Zeit→Person, Nachrichten/Anträge/Live-Protokolle→Schicht erfassen.
2. Erwartete Transformation festlegen: Bei Migration 090000 erhalten Buchungen mit `confirmedAt` die Herkunft `EMPLOYEE`; bisher unbestätigte fremd eingeteilte Buchungen erhalten `PLANNER` und `confirmedAt=bookedAt`. Andere Bestätigungen bleiben leer. Diese Felder gegen den **berechneten Erwartungswert** vergleichen; nicht pauschal aus der Prüfung streichen. Alle anderen Bestandsfelder und Referenzen müssen unverändert bleiben.
3. `prisma migrate deploy` mit expliziter Verbindung zur verifizierten Kopie ausführen. URL, Passwort und Dump-Inhalte nicht in Ausgabe oder Nachweis kopieren. Migrationsergebnis und `_prisma_migrations` prüfen.
4. Nachher: Gleiche Zeilenzahlen und Hashes der unveränderten Bestandsfelder sowie exakt erwartete Bestätigungswerte nachweisen. Neu angelegte Tabellen `former_employees`, `subcontractors` und `contractor_workers` sind nach reinem Einspielen zunächst leer, soweit sie vorher nicht bestanden. Bestehende Buchungen haben keine erfundenen Subzuordnungen.
5. Referenzvergleich: keine verwaisten Personen-/Schichtbezüge; genau eine Personenreferenz je Buchung; genau eine Konto-/Historienreferenz je Zeit und Check-in. Sub-Platzhalter und Unternehmen gehören zur selben Organisation, ihre Einsätze zur Organisation des Plans. Unveränderte Plan-, Wochen-, Standort- und Veröffentlichungszuordnungen nachweisen.
6. Auf einer separaten Testkopie die neuen Beschränkungen tatsächlich auslösen: ungültige Mehrfach-Personenreferenz, fremde Subzuweisung sowie organisationsfremdes Verschieben von Schicht, Plan oder bereits eingesetztem Platzhalter müssen scheitern. Anschließend gültige Besetzung, Deaktivierung mit erhaltener Historie und Mitarbeiterlöschung mit erhaltenen Zeiten/Check-ins/vergangenen Einsätzen prüfen. Vergleiche vor diesen absichtlichen Teständerungen abschließen.

## 4. PostgreSQL-Parallelität und 100 Nutzer getrennt prüfen

- **Mehrverbindungstest:** Gegen echtes PostgreSQL mit mehreren unabhängigen Verbindungen/Requests zeitgleich den letzten Schichtplatz besetzen, denselben Sub-Platzhalter in überlappende Schichten setzen und dieselbe Antragsentscheidung ausführen. Erwartung: höchstens ein erfolgreicher konkurrierender Vorgang, keine Überbesetzung, Überschneidung oder doppelte Entscheidung; Fehler verständlich und Endzustand nach Neuladen korrekt. PGlite-Workflowtests ersetzen diesen Nachweis nicht.
- **Lasttest:** Ausschließlich die synthetische Testinstallation verwenden. `tests/seed-load-pilot.ts` unterstützt über `LOAD_USERS` und `LOAD_SPIKE_USERS` mehr als die in der Anleitung genannten 40 Konten. Für den gesonderten 100-Nutzer-Lauf beide Werte beim Anlegen **und** beim Lastlauf auf 100 setzen; `LOAD_ORG_NAME`, `DATABASE_URL`, `LOAD_BASE_URL` und Testpasswort bewusst auf die Testinstallation ausrichten. Zunächst ohne Schreiblast, danach gezielt mit `LOAD_ALLOW_WRITES=true` prüfen. Keine Betriebskopie mit diesen Seeds befüllen.
- Aus `test:load:pilot` Fehlerquote, Lese-/Schreib-p95 und Echtzeitverbindungen festhalten; CPU, RAM, Datenbankverbindungen und Dauer mitschreiben. Der vorhandene Lasttest besitzt gestufte Phasen und ist kein Nachweis, dass 100 Personen jede Funktion zugleich bedienen. Ressourcen, Grenzen oder Preise nicht schätzen; tatsächliche Messwerte nennen.

## 5. Veröffentlichung und Rückweg

Erst nach erfolgreicher Kopiemigration, geprobter Wiederherstellung, PostgreSQL-Parallelitätsprüfung, Lastprüfung und Hauptabläufen auf Desktop/Smartphone einen konkreten Veröffentlichungsstand mit verbleibenden Einschränkungen vorlegen. Die Betriebsveröffentlichung erst im ausdrücklich erteilten Auftrag ausführen.

Vor dem Betriebswechsel alten Code-/Image-Stand, Konfiguration und verifizierten Dump sichern, Schreibzugriffe für den vereinbarten Wechsel unterbrechen und den Sicherungszeitpunkt dokumentieren. Ausstehende Migrationen und neuen App-Stand gemäß tatsächlich vorhandener Zielinstallation ausrollen. Danach Health, Anmeldung, Rollen/Isolation, Subbesetzung/-übersicht und Socket.IO prüfen; Ergebnis in der Arbeitsliste festhalten.

Rückweg vorher auf der Kopie proben: alter Code-/Image-Stand **und** dazu passender verifizierter Dump werden gemeinsam wiederhergestellt. Code allein setzt das Schema nicht zurück. Den Dump in eine neue separate Datenbank wiederherstellen und nach Prüfung kontrolliert umschalten; keine Rückmigration durch nachträgliches Umschreiben angewandter SQL-Dateien. Schreibzugriffe nach dem Sicherungszeitpunkt würden beim Rückweg fehlen: deshalb Schreibsperre bzw. gesonderte Sicherung und Übernahme dieser Änderungen vorab vereinbaren.

Ausgeführte und ausstehende Nachweise stehen in der aktuellen Arbeitsliste. Lokale synthetische Proben ersetzen weder die Sicherung/Kopiemigration mit Betriebsdaten noch die Nachprüfung auf Netcup und echten Geräten.
