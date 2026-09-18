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

## Datenschutz-Einstellungen (in `.env`)
| Schalter | Standard | Bedeutung |
|---|---|---|
| `AI_ENABLED` | `false` | KI aus – es gehen keine Daten an Anthropic/USA |
| `ALLOW_REGISTRATION` | `false` | Nach der Ersteinrichtung kann sich niemand selbst registrieren |

Passwörter: mindestens 12 Zeichen, Groß- und Kleinbuchstaben, eine Zahl.
Die Datenbank ist nur intern im Docker-Netz erreichbar, nicht von außen.

## Stoppen / Backup
```
docker compose down
docker compose exec postgres pg_dump -U schichtplaner schichtplaner > backup.sql
```
