# Schichtplaner – Lokal starten (AKRO)

## Einmalig
1. **Docker Desktop** installieren: https://www.docker.com/products/docker-desktop/ – danach PC neu starten und Docker Desktop öffnen.
2. Die Datei `.env` ist bereits mit zufälligen Passwörtern angelegt. **Nicht weitergeben, nicht löschen** (sonst kommt die App nicht mehr an die Datenbank).

## Starten
Im Ordner `schichtplaner` ein Terminal öffnen:

```
docker compose up -d --build
```

Der erste Start dauert einige Minuten. Danach im Browser: **https://localhost**
(Die Zertifikatswarnung beim ersten Aufruf ist lokal normal.)

## Ersteinrichtung
1. Auf **Registrieren** klicken und die Firma + dein Admin-Konto anlegen.
2. Danach ist die Registrierung automatisch gesperrt. Mitarbeiter legt nur noch der Admin an.

## Kunden, Standorte und Freigaben
Als Admin angemeldet:
1. **Einsatzorte** → „Kunde anlegen“, danach „Einsatzort anlegen“. Jeder Einsatzort gehört zu einem Kunden.
2. **Mitarbeiter** → Person öffnen → Abschnitt **Freigaben**: Standorte freigeben und bei Managern
   Mitarbeitende zuordnen. „Entziehen“ bzw. „Zuordnung entfernen“ wirkt sofort.
3. **Mitarbeiter** → „Neue Mitarbeiter anlegen“: je Person die Standorte wählen. Danach erscheinen die
   Aktivierungslinks zum persönlichen Weitergeben. Manager mit dem Recht „Schichten erstellen und bearbeiten“
   legen hier ebenfalls Mitarbeitende an – nur für ihre eigenen Standorte. Standorte ändern und neue Links gibt
   es in der Mitarbeiterliste über „Standorte“ bzw. „Einladungslink“.

Ohne Freigabe sehen Manager keine Standorte und Mitarbeitende nur ihre eigenen Schichten,
Zeiten und Abwesenheiten. Details: `docs/AKRO-ERWEITERUNG.md`, Abschnitte 5 und 6.

## Bedienung: Nachrichten, Tausch und Check-in

**Nachrichten** (Mehr → Postfach → „Neue Nachricht“)
- „An Zuständige“ wählt die zuständigen Manager: persönlich zugeordnete Manager und die Planung der eigenen
  Standorte. Ist niemand zuständig, steht dort ein Hinweis, und die Administration ist Ansprechpartner.
- „Bezug“ verknüpft die Nachricht mit einem Standort oder einer eigenen Schicht. Antworten behalten den Bezug.
- Empfänger prüft der Server: Man erreicht nur Personen, die man sehen darf, nie andere Organisationen.

**Übernahme, Abgabe und Tausch** (Startseite → Anträge)
- *Übernahme anfragen*: offene Schicht an einem zugeordneten Standort.
- *Zur Übernahme anbieten* (Abgabe): eigene künftige Schicht; eine Kollegin oder ein Kollege meldet sich.
- *Tausch anfragen*: eigene künftige Schicht gegen die Schicht einer anderen Person. Angeboten werden nur
  Tausche, für die beide geeignet und dem Standort der anderen Schicht zugeordnet sind. Die andere Person
  stimmt zu oder lehnt ab; danach entscheidet die Planung.
- Entscheiden darf nur, wer „Anträge und Schichtübernahmen bearbeiten“ an **allen** betroffenen Standorten hat,
  sonst die Administration. Eigene Anträge entscheidet man nie selbst. Eine Begründung ist optional.
- Bis zur Genehmigung bleibt die Besetzung unverändert. Die Genehmigung prüft alles erneut; ein Tausch ändert
  beide Schichten gemeinsam oder gar nicht. Offene eigene Anträge lassen sich zurückziehen.

**GPS-Check-in** (einrichten: Einsatzorte → Einsatzort bearbeiten → „GPS-Check-in“)
- Admin trägt Breiten- und Längengrad ein (oder „Aktuellen Standort übernehmen“ vor Ort), den Radius
  (Vorgabe 50 m) und schaltet „GPS-Check-in erforderlich“ ein.
- Mitarbeitende checken auf der Startseite ein („Jetzt einchecken“). Der Browser fragt nur in diesem Moment nach
  dem Standort; das funktioniert nur über HTTPS. Danach läuft die Zeiterfassung mit Pause, Fortsetzen und
  Auschecken. Ohne Check-in lässt sich an solchen Standorten keine Stoppuhr starten.
- Gespeichert werden Serverzeit, Minuten vor/nach Schichtbeginn, Entfernung, Genauigkeit und Alter der Position –
  keine Koordinaten. Browser-Positionen lassen sich fälschen: Der Check-in ist ein Hinweis auf Anwesenheit,
  kein fälschungssicherer Nachweis.
- Klappt es nicht (Freigabe verweigert, zu ungenau, zu alt, außerhalb, keine Koordinaten), kann eine manuelle
  Freigabe mit Begründung beantragt werden. Entscheiden dürfen Admins und Manager mit „Zeiterfassung bearbeiten“
  am Standort und „Stunden einsehen“ für die Person; die Zeit beginnt dann mit dem Zeitpunkt des Antrags.
- Übersicht „Check-ins heute“ und offene Freigaben stehen auf der Startseite der Planung.

## Datenschutz-Einstellungen (in `.env`)
| Schalter | Standard | Bedeutung |
|---|---|---|
| `AI_ENABLED` | `false` | KI aus – es gehen keine Daten an Anthropic/USA |
| `ALLOW_REGISTRATION` | `false` | Nach der Ersteinrichtung kann sich niemand selbst registrieren |

Passwörter: mindestens 12 Zeichen, Groß- und Kleinbuchstaben, eine Zahl.
Die Datenbank ist nur intern im Docker-Netz erreichbar, nicht von außen.

## Pilot-Performance-Test

**Voraussetzungen:** eine eigene Testinstallation (nicht die Produktivumgebung)
und dort angelegte Testkonten `load-user-001@akro-test.invalid` bis
`load-user-040@akro-test.invalid` mit gemeinsamem Passwort. Der Lasttest legt
selbst keine Benutzer an.

**Testdaten anlegen** (einmalig, wiederholbar) – direkt auf der
Testinstallation ausführen, `DATABASE_URL` muss auf deren Datenbank zeigen:

```
DATABASE_URL="postgresql://…" LOAD_USER_PASSWORD="…" npm run test:load:seed
```

Das Skript arbeitet nur in einer Organisation, deren Name „Test", „Pilot" oder
„Staging" enthält, legt die 40 Konten als Mitarbeiter an, veröffentlicht den
Wochenplan und weist jedem Konto eine Schicht zu. Es löscht nichts. Gibt es
mehrere passende Organisationen, wählt `LOAD_ORG_NAME` eine aus.

**Umgebungsvariablen:**

| Variable | Standard | Bedeutung |
|---|---|---|
| `LOAD_BASE_URL` | – | Adresse der Testinstallation (Pflicht) |
| `LOAD_USER_PASSWORD` | – | Passwort der Testkonten (Pflicht) |
| `LOAD_USER_PREFIX` | `load-user-` | Namensteil vor der laufenden Nummer |
| `LOAD_USERS` | `30` | Nutzer in der Normallast |
| `LOAD_DURATION_MINUTES` | `15` | Gesamtdauer; Phasen werden anteilig angepasst |
| `LOAD_SPIKE_USERS` | `40` | Nutzer in der Lastspitze |
| `LOAD_ALLOW_WRITES` | `false` | Schreibvorgänge nur in einer erkennbaren Testorganisation |

**Start:**

```
LOAD_BASE_URL="https://dienstplan.test.example" LOAD_USER_PASSWORD="…" npm run test:load:pilot
```

**Niemals gegen die Produktivdatenbank testen.** Ohne `LOAD_BASE_URL` startet
der Test nicht; es gibt bewusst keine Standardadresse.

Währenddessen in zwei weiteren Terminals mitschauen:

```
docker stats
```

```
docker compose logs -f app postgres caddy
```

## Backup
Bei laufender App im Ordner `schichtplaner` (PowerShell):

```
docker compose exec -T postgres pg_dump -U schichtplaner -f /tmp/backup.sql schichtplaner
docker compose cp postgres:/tmp/backup.sql "backups/schichtplaner-$(Get-Date -Format yyyy-MM-dd_HHmm).sql"
docker compose exec -T postgres rm /tmp/backup.sql
```

Die Datei im Ordner `backups` enthält personenbezogene Daten: sicher aufbewahren, nicht weitergeben.

## Aktualisieren
1. Backup wie oben ziehen.
2. `docker compose up -d --build` – baut die App neu und spielt ausstehende Datenbank-Migrationen automatisch ein.
3. Prüfen: `docker compose ps` zeigt die App als `healthy`, danach **https://localhost** öffnen.

## Stoppen
```
docker compose down
```

Die Daten bleiben erhalten. Niemals `docker compose down -v` ausführen – das löscht die Datenbank.
