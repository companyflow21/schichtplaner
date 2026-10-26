# Übergabe: Design-Durchgang mit Impeccable (23.–26.10.2026)

Branch `feat/plan-lifecycle-diff-conflicts` im Klon `schichtplaner-bausteine`, Basis des
Durchgangs `7121c61` (nach Monats-Veröffentlichen `94ccf73` und Archivieren `a92da53`).
Auftrag AKRO (23.10.2026): die bestehende App gestalterisch und in der Bedienung deutlich
verbessern – professionell, übersichtlich, im Arbeitsalltag schnell: „Wer arbeitet wann und wo?
Welche Dienste sind offen? Wo besteht Handlungsbedarf?“ Umgesetzt mit dem Impeccable-Skill
(critique, audit, layout, distill, adapt, harden, clarify, colorize, polish) und fünf
parallelen Umsetzungsagenten in eigenen Worktrees; Integration und Abnahme durch die Hauptsitzung.
Nichts davon ist im Original oder auf Netcup.

## 1. Bestand und Bewertung (Critique, dual-agent)

Live geprüft auf einer lokalen Testinstallation mit synthetischen Daten (1280 px und 375 px,
Disposition und Mitarbeiter). Snapshot: `.impeccable/critique/2026-10-23T18-03-26Z__src-components-schedule-schedule-grid-tsx.md`
(git-ignoriert).

| Heuristik | Score | Kernbefund |
|---|---|---|
| Systemstatus | 2 | „103 Bestätigungen offen“ im Wochenplan gegen „12“ auf der Startseite; beendete Schichten zählten mit |
| Sprache | 3 | „Owner“, „wirksame Einteilung“, „Kapazität erhöhen“ |
| Kontrolle | 3 | Kapazität erhöhen ohne Rückgängig |
| Konsistenz | 2 | offen orange hier, rot „offen / Konflikt“ dort; zwei Wochennavigationen; „7.5 h“ neben „7,5 h“ |
| Fehlervermeidung | 2 | Dialog startete 08:00–17:00 ohne Pause; Live-Änderung an veröffentlichter Woche ohne Hinweis |
| Wiedererkennen | 3 | Monatsdetails nur im Tooltip |
| Effizienz | 2 | Standort nie gemerkt; keine Tastenkürzel |
| Reduktion | 2 | Karte 531 px hoch, Belegung vierfach, 13 Bedienelemente vor dem Raster |
| Fehlerbehebung | 3 | Konflikttexte konkret |
| Hilfe | 2 | keine ⓘ im Wochenraster |
| **Gesamt** | **24/40** | Acceptable · technisches Audit 15/20 Good |

Detektor (`impeccable detect`): 4 Code-Befunde (2× `animate-bounce` im nicht verlinkten KI-Chat,
2 Seitenstreifen). Im Browser gemessen: Status-Badges 4,36–4,48:1, Dunkelmodus `text-primary`
3,2–3,6:1 an 124 Elementen des Wochenplans, Tab-Zähler 3,4:1, Fokusring an Pfeilen abgeschnitten,
Fokus nach Wochenwechsel und Dialog auf BODY, ein Seitentitel für alle Seiten.

Die fünf wichtigsten Probleme: (1) Wochenansicht zeigt den Plan nicht (1280×800: erste Karte
bei 622 px, Sonntag abgeschnitten; 375 px: erste Schicht bei 999 px hinter sechs Bedienzeilen);
(2) Signale für Handlungsbedarf widersprechen sich; (3) Tastatur und Fokus brechen;
(4) Kontraste im Dunkelmodus und an Status-Badges unter 4,5:1; (5) Live-Änderung ohne Hinweis,
driftendes Vokabular.

## 2. Umgesetzt (Arbeitspakete, Reihenfolge der Merges)

### WP5 Fundament – Fokus, Kontrast, Dunkelmodus, Bewegung, Schicht-Dialog, Seitenleiste
Merge `54a8d3f` (Agent sonnet), Nacharbeit `b050c72`, `4ac8ecf`.
- Fokus: globaler Ring 3 px in `--ring` mit 2 px Abstand (`globals.css`); `Button`, `Input`,
  `Select`, `Switch`, `Textarea`, `Checkbox`, `Tabs`, `Badge`, `Calendar` und `selectClass`
  ohne eigene halbstarke Ringe (`ring-ring/50` ≈ 2,5:1). Gemessen: Ring hell 6,59:1 auf Papier /
  7,56:1 auf Karte (vorher 2,49 / 2,61), dunkel 7,77 / 6,26 (vorher 2,12 / 1,94).
- Kontrast hell: Statusfarben eine Stufe dunkler im selben Farbton (`#237249→#1c6d44`,
  `#a15700→#924e00`, `#af431f→#a73c17`); Badge-Text auf Tönung mindestens 4,58:1 über Karte,
  Papier, Panelkopf, vertiefter Fläche, Heute-Fläche und `--muted`. `--service`/`--fire` bleiben.
- Dunkelmodus: `--primary`/`--ring` `#4d7dff→#8db0ff` (Text ≥ 4,56:1, Primärknopf 8,37:1;
  vorher 15 von 15 gemessenen Textstellen unter 4,5:1). Feiertagstext im Abwesenheitskalender
  auf `text-primary`.
- Bewegung: bei `prefers-reduced-motion` laufen `animate-spin` (2 s) und `animate-pulse` (3 s)
  langsamer weiter statt zu stehen; Sheet 250/200 ms mit `--akro-schwung` (vorher 500/300).
- Schicht-Dialog: Fokus kehrt zum öffnenden Element zurück (vorher BODY); Pflichtfelder mit
  Sternchen und Legende (Labels unverändert, `getByLabel(..., exact)` trifft weiter); neue
  optionale Props `vorlage` (Vorbelegung) und `planStatus` (Hinweis „Veröffentlichte Woche: Die
  Änderung ist sofort sichtbar, eingeteilte Personen werden benachrichtigt.“ bzw. „Wird erst
  beim Veröffentlichen sichtbar.“).
- Seitenleiste: unter 1280 px eingeklappt, ab 1280 ausgeklappt; gespeicherte Wahl hat Vorrang;
  Einklapp-Knopf 44 px.

### WP2 Schichtkarte
Merge `2adcd37` (Agent opus).
- Eine Informationshierarchie: Zeit (bei Nachtschicht „+1“ mit „endet am Folgetag“), Tätigkeit ·
  Bereich · Pause, dann genau ein Belegungsstatus (Konflikt > „N offen“ > Hinweis > „Voll
  besetzt“) neben „12/13“; der Satz „12 von 13 besetzt“ und der Seitenstreifen (`LAYOUT_2` ist
  jetzt eine getönte Kopfzeile) entfallen. Offene Bestätigungen als Uhr mit Zähler.
- Personenzeilen 24-px-Avatar, Name 13 px gekürzt mit Tooltip; Aktionen bei Hover/Fokus, auf
  Touch immer sichtbar und 44 px; ein Tabstopp je Zeile (Pfeiltasten wechseln die Aktionen).
- „+ Platz“ mit Toast und „Rückgängig“ (nimmt den Platz über `DELETE …/places` zurück).
- Personenauswahl: Suchfeld beschriftet, Zeilen mobil 44 px, 16 px Schrift.
- Gemessen bei 135 px Spaltenbreite: Karte mit 13 Personen 613→297 px (zugeklappt), offen
  386→217, Konflikt 340→215, Nacht/voll 372→181, beendet 368→203; Tabstopps 30→17.

### WP1 Wochenplan-Kopf, Raster, Standortwahl
Merge `840f634` (Agent opus), Verdrahtung `a7889fe`.
- Kopf in zwei Zeilen: Kunde + Objekt als `h1`, rechts Ansicht; Zeitraum (gemeinsamer
  `WeekSwitcher`) · Status · Kennwertzeile („11 offene Plätze · 1 Bestätigung offen · 0 Anfragen ·
  Keine Konflikte“) · Aktionen nach Lebenszyklus (veröffentlicht: „Bearbeitung starten“ ist die
  Hauptaktion, „Schicht hinzufügen“ Nebenaktion; Entwurf ohne Schichten: „Schicht hinzufügen“
  Hauptaktion). Kennzahl-Kacheln entfallen; Seltenes im ⋯-Menü; „Stunden als CSV“ ab Tablet sichtbar.
- Zählregel „Bestätigungen offen“: nur Zuweisungen mit Konto, unbestätigt, nicht gelöscht, nicht
  von der Planung fest eingeteilt, Schicht noch nicht beendet (`endsAt`). Werk Nord im Test: 5→1.
- Hinweise einzeilig; Bundesland-Hinweis je Einsatzort pro Sitzung schließbar; ohne Konflikte kein
  Panel, mit Konflikten Zähler in der Kopfzeile und aufklappbare Liste.
- Raster: sieben Spalten ab 952 px ohne inneren Scroll, Spaltenhöhe 16 rem; Tage als `h2` in
  `section`; Tagesknöpfe heißen „Schicht hinzufügen am Mo 26.10.“.
- Tastatur: nach Blättern und „Heute“ liegt der Fokus auf dem Zeitraum.
- Handy: Zeitraumzeile klebt unter der Kopfschiene; in der aktuellen Woche Sprung zum heutigen Tag.
- Standort merken: ohne `?standort` direkt zum einzigen oder zuletzt gesehenen Einsatzort;
  „Standort wechseln“ öffnet die Auswahl (`?wahl=1`); Auswahl mit einem Satz plus ⓘ, offene
  Plätze orange „N offen oder Konflikt“ (die Status-API trennt Konflikte nicht).
- Neue Schichten übernehmen Zeiten, Pause (nur „Pro Schicht“), Tätigkeit, Plätze und Bereich
  der zuletzt angelegten Schicht der Woche; der Dialog zeigt den Planstatus-Hinweis.
- Gemessen 1280×800: erste Karte 874→403 px (Entwurf mit Statusbalken und Konflikten 860→442,
  Ziel ≤ 420 dort verfehlt); Raster 1120→980 px bei 980 px Inhalt; 375×812: erste Karte
  1573→596 px, Seitenhöhe 9316→8149; Bedienelemente vor der ersten Karte 23→15.

### WP3 Mitarbeiteransicht, Wochen-Navigation, klassische Tabelle, Monat
Merge (siehe `git log`, Agent opus).
- Überschrift = Ansichtsname („Mein Dienstplan“, „Mitarbeiteransicht“, „Klassische Tabelle“,
  „Monatsplan Objekt X“); PDF-Export als Nebenaktion, mobil Symbol mit 44 px; Ansichtsschalter
  mobil drei gleich breite Felder à 44 px.
- `week-nav.tsx` auf dem gemeinsamen `WeekSwitcher`; „Woche wählen“ (Monate mit KW, Jahr
  wechseln, Feld KW + Jahr mit Prüfung) ersetzt Monatschips und „Springe zu“; mobil klebende
  Zeitraumzeile, Fokus nach dem Blättern auf dem Zeitraum.
- Schichtzeilen: Tag · Zeit · Einsatzort · Status; heute blau; beendete Schichten gedämpft mit
  Badge „beendet“; „Bestätigung offen“ bei Altbuchungen; Stunden „18,83 h“; „⚠“ ist ein Symbol;
  gekürzte Namen mit Tooltip; Leerzellen mit lesbarem Strich; Bereichsfarbe als Punkt.
- Nachtschicht in allen Ansichten „+1“ mit „endet am Folgetag“ wie die Karte.
- Monat: KW- und Tageszahl-Links 24 px, Tageszeilen mobil 44 px.
- Gemessen: erste Schicht „Mein Dienstplan“ 375 px 474→355, 1280 px 331→284; Klassisch 375 px
  472→350; Ziele unter 24 px im Monat (1280) 36→0, unter 44 px (375) 15→0; kein Überlauf.

### WP4 Startseite, Vokabular, Seitentitel, Dunkelmodus-Hardcodes
Merge (siehe `git log`, Agent sonnet).
- Startseite der Disposition: `h1` „Heute“ (vorher „Übersicht“, Kopfschiene sagte schon
  „Heute“); „Heute im Dienstplan“ als Zeilen mit Zeit, Einsatzort, Badge („N offen“, „besetzt“,
  „Entwurf“, „N unbestätigt“) und den ersten drei Namen, Rest als „+N“ mit allen Namen im Titel;
  Nachtschichten „+1“; „Offene Aufgaben“ ohne leere Zelle (Flex statt Raster).
- Eine Zählregel „Bestätigungen offen“: `openConfirmations` in `src/lib/dashboard-tasks.ts`
  (Buchung mit Person, ohne `confirmedAt`, nicht `former`, nicht `PLANNER`, nur veröffentlichte,
  noch nicht beendete Schichten); der Wochenkopf (`offeneBestätigungen` in
  `schedule-toolbar.tsx`) folgt demselben Wortlaut – nachgezogen um „nur veröffentlicht“.
- Startseite der Mitarbeitenden: „Abweichung zum Plan −7,5 h“ mit echtem Minus, Komma und
  ⓘ-Erklärung; alle Stunden „7,5 h“; leere Listen zu einem Satz zusammengefasst, mit Link
  „Standortpläne ansehen“, wenn Pläne vorliegen.
- Anträge: `akro-panel` statt `Card`, Skelett statt „Lädt …“, Namen im Organisationsformat,
  Zeilentitel „Übernahme angefragt“, „Zur Übernahme angeboten (Abgabe)“, „Tausch“ (ANLEITUNG.md).
- Dokumenttitel je Seite „… · AKRO Schichtplaner“ (21 Seiten geprüft; 17 `page.tsx` mit
  `metadata`, 8 kleine `layout.tsx` als Titel-Hüllen für Client-Seiten); Kopfschiene mit `p` statt
  `h2`; keine Floskel-Untertitel mehr auf Mitarbeiter- und Zeiterfassungsseite.
- Mitarbeiterliste: „Owner“ → „Inhaber“, Suchfeld mit `aria-label`, Tab-Zähler in
  `text-muted-foreground` (gemessen 7,1/8,2:1, dunkel 5,7/8,0:1).
- Zeiterfassung: Stunden „7,5 h“ (vorher „7h 30m“/„0h“), Suchfeld beschriftet, Statussymbole in
  `text-primary`.
- Dunkelmodus und Kleinfehler: `bg-card`/`text-primary-foreground` statt Weiß in Skeletons,
  Fehler- und 404-Seite; `bg-muted/50 p-4` statt der ungültigen Utility; `animate-pulse` statt
  `animate-bounce`; 404-Link „Zur Startseite“ → `/dashboard`.
- Tests: `tests/requests-paused.tsx` 14 → 33 Prüfungen (Startseiten-Zeilen, Zählregel);
  `tests/ui-design.mjs` erwartet die H1 „Heute“ für alle Rollen.

## 3. Abnahme auf dem integrierten Stand (26.10.2026)

| Prüfung | Ergebnis |
|---|---|
| `npx tsc --noEmit` | 0 Fehler |
| `npm run lint` | 0 Fehler, 25 Warnungen (Bestand) |
| Rendertests `requests-paused` / `month-publish` / `plan-banner` / `schedule-actions` / `conflict-card` / `rule-violations` / `archive-ui` / `info-hint` | 33 / 16 / 45 / 48 / 18 / 12 / 17 / 6 |
| `npm run test:workflows` (3408/55542), erster Lauf | abgebrochen in `catalog-targets`: Die Prüfung „member qualifications are stored in catalog spelling“ erwartete fest „Nachtwache“, obwohl sechs parallele Anlagen mit verschiedener Schreibweise um den Katalogeintrag rennen; keine Designänderung beteiligt (seit `7121c61` nur `api/dashboard` und `lib/dashboard-tasks.ts` serverseitig geändert). Test in `b9504e5` auf die tatsächlich gewonnene Katalog-Schreibweise umgestellt. |
| `npm run test:workflows`, zweiter Lauf | FINAL SUCCESS 4324/4324 |
| `npm run build` | ok (Webpack, 5 s Compile) |
| Browser-Tests auf dem Build (`tests/load-local.ts --serve`, 3337) | `ui-quality` 16/16 · `ui-shift-location` bestanden · `ui-design` 71/71 |
| Sichtprüfung (Playwright-Screenshots, 1280×800 und 375×812, Admin und Mitarbeiter) | Wochenplan: Kopf zweizeilig, sieben Tage ohne Scroll, Raster ab y ≈ 293; mobil erste Tageskarte bei y ≈ 510 unter klebender Zeitraumzeile, Seitenhöhe 1753 px (vorher 5977); Startseite „Heute“ mit Aufgabenzeile und Zeilenliste „Heute im Dienstplan“; Monatsplan mit Überschrift, Zeitraum und „Heute“; „Mein Dienstplan“ mobil mit Inhalt in der ersten Bildschirmhöhe. Kein waagerechter Überlauf. |

Nicht ausgeführt: `tests/postgres-concurrency.ts`, `tests/race-bookings.ts` (nur gegen echtes
PostgreSQL); Migrationstest unverändert gegenüber `a92da53` (keine Schemaänderung in diesem
Durchgang); Dunkelmodus nur durch den Fundament-Agenten gemessen (Wochenplan, Startseite,
Mitarbeiterliste), nicht flächendeckend.

Kleinere Sichtbefunde, nicht behoben: In „Mein Dienstplan“ rutscht auf dem Handy der
deaktivierte „Heute“-Knopf in eine zweite Zeile unter die Zeitraumzeile (Platz neben dem
„Woche wählen“-Symbol fehlt).

## 4. Entscheidungen und Annahmen (für AKRO)
- Veröffentlichte Woche: „Bearbeitung starten“ ist die Hauptaktion, direkte Änderungen bleiben
  erlaubt (Entscheidung 2a vom 12.10.) und werden im Dialog erklärt.
- Standort wird je Browser gemerkt (`localStorage`); bei nur einem Einsatzort entfällt die Auswahl.
- Seitenleiste startet unter 1280 px eingeklappt (Wochenraster braucht den Platz).
- Statusfarben und Dunkelmodus-Blau sind geringfügig dunkler bzw. heller als das Designsystem
  der Webseiten – nur Helligkeit, derselbe Farbton, belegt durch Kontrastmessung.
- Konfliktliste im Wochenplan ist standardmäßig zugeklappt (Karten zeigen den Konflikt).
- Auf dem Handy entfällt in der aktuellen Woche der deaktivierte „Heute“-Knopf.

## 5. Offen
- Entwurf mit Statusbalken und Konflikten: erste Karte bei 442 px (Ziel ≤ 420).
- Wochenstunden je Kandidat in der Personenauswahl: die Kandidaten-API liefert sie nicht.
- Tastenkürzel (Woche vor/zurück, neue Schicht) und „Vorwoche übernehmen“ für leere Wochen: nicht
  umgesetzt (wären neue Funktionen).
- Die klebende Zeitraumzeile nutzt die feste Kopfhöhe 75 px aus `top-nav.tsx`.
- Dev-Server: `127.0.0.1` hydriert wegen Next-HMR-Origin-Prüfung nicht; Vorschau über
  `localhost` oder Produktions-Build (`next build --webpack`, Turbopack scheitert an einer
  `node_modules`-Verknüpfung in Worktrees).
