# Smartplan-Analyse: Layout, Design & Benutzerfreundlichkeit

12.10.2026 · Vorgabe von AKRO (Yahya). Übertragen aus dem PDF gleichen Namens; Bilder
sind nicht enthalten.

## Überblick

Smartplan ist das Vorbild: Diese Analyse hält fest, was Smartplan bei Layout, Design und
Bedienung richtig macht — und was davon der eigene AKRO-Schichtplaner übernehmen
sollte. Grundlage ist der Live-Account (UNREAL Logi, unreallogi.smartplanapp.io),
durchgesehen am 12. Oktober 2026.

Der AKRO-Schichtplaner existiert bereits (Next.js, deutsche Oberfläche, Struktur
Organisation → Kunde → Standort → Wochenplan → Schicht). Ziel ist nicht, Smartplan zu
kopieren, sondern die bewährten Interaktionsmuster zu übernehmen: verständliche
Abläufe, wenige Klicks, klare Rückmeldungen, gute mobile Bedienbarkeit.

## Layout & Seitenaufbau

Smartplans Stärke ist eine flache Struktur: alles Wichtige liegt höchstens zwei Klicks
entfernt. Die Oberfläche folgt überall demselben Muster — das macht sie schnell erlernbar.

- **Eine feste Hauptnavigation oben.** Sieben Module, immer sichtbar, jeweils Icon +
  Beschriftung: Dienstpläne, Stempeluhr, Mitarbeiter, Nachrichten, Abwesenheit,
  Zeiterfassung, Profil, Einstellungen. Das aktive Modul ist farbig (Türkis) markiert,
  rechts sitzt eine Glocke für Benachrichtigungen. Keine verschachtelten Menüs auf
  oberster Ebene.
- **Jede Seite nach demselben Schema.** Oben links der Kontext (Name, Zeitraum,
  Standort), oben rechts die Aktionen (z. B. „Dienstplan bearbeiten“, Drucken). Darunter
  eine Filterleiste, dann der Inhalt. Details öffnen sich als kleine Dialoge/Popover direkt
  am Klickort — man verlässt die Seite fast nie.
- **Die Plan-Ansicht als Wochenraster.** Tage als Spalten, der heutige Tag rot
  hervorgehoben, Schichten als Karten mit Uhrzeit-Kopfzeile und Mitarbeiter-Avatar.
  Leere Tage zeigen ausdrücklich „Keine Schichten“. Navigation über Pfeile, einen
  „Heute“-Knopf und „Gesamten Dienstplan anzeigen“.
- **Zwei klar getrennte Zustände: veröffentlicht vs. in Planung.** Im Planungsmodus
  erscheint ein orangefarbener Balken „Dienstplan ist unter Bearbeitung“, rechts eine
  Seitenleiste mit Live-Zahlen (besetzte Stunden, freie Schichten, Wochenstunden je
  Mitarbeiter) und einer Regelprüfung („Auf Regelbruch überprüfen“). Oben führt eine
  Werkzeugleiste Schritt für Schritt durch die Einrichtung.
- **Listen mit Filterspalte links.** Die Mitarbeiterliste kombiniert Suche und Filter
  (Arbeitsbereiche mit Farbpunkten, Status) links mit einer Tabelle rechts; dazu
  Umschalter „Detailliert/Einfach“, Sammelaktionen und Excel-Export. Die Einstellungen
  nutzen dasselbe Prinzip: links ein Themenmenü mit Icons, rechts pro Thema eine Seite
  mit kurzen Erklärtexten.

Dieser Grundriss gilt für fast jede Smartplan-Seite; die Seitenleiste rechts erscheint nur
im Planungsmodus.

## Design

Das Design ist bewusst zurückhaltend: viel Weiß, wenig Farbe — und Farbe hat immer eine
Bedeutung.

- **Farben als Sprache.** Türkis/Grün ist die einzige Markenfarbe und steht für
  Hauptaktionen und aktive Zustände. Signalfarben sparsam: Rot für Heute-Markierung,
  Warnungen und Löschen, Orange für den Status „in Bearbeitung“, Grün für freie
  Schichten. Arbeitsbereiche bekommen je einen Farbpunkt, der überall identisch
  auftaucht — im Filter, in der Tabelle, an der Schicht.
- **Typografie und Hierarchie.** Eine einzige serifenlose Schrift, Hierarchie nur über
  Größe und Fettung: Seitentitel fett, Beschriftungen klein und grau, Werte in
  Normalschrift. Sekundäraktionen sind graue Rahmen-Buttons, die Hauptaktion der
  Seite ist der eine gefüllte Button in der Markenfarbe.
- **Komponenten.** Wenige, immer gleiche Bausteine: Karten mit viel Weißraum, dezente
  Trennlinien statt Rahmen, runde Avatare mit Initialen, Pillen-Filter, Toggle-Schalter,
  kleine Info-Icons (ⓘ) mit Erklärung direkt am Element. Dialoge als kompakte Popover
  am Klickort, nicht als seitenfüllende Fenster.
- **Schwächen, die man nicht kopieren sollte:** unübersetzte dänische Texte;
  sehr kleine, kontrastarme Beschriftungen (hellgrau auf weiß), die auf Baustellen-/
  Außendienst-Bildschirmen schwer lesbar sind; ein dauerhaft überlagerndes Werbe-Widget.

## Benutzerfreundlichkeit

- **Klare Rückmeldungen vor Folgen.** Vor dem Wechsel in den Planungsmodus erklärt ein
  Dialog in einfachen Worten, was das für die Mitarbeiter bedeutet. Gefährliche Aktionen
  („Dienstplan löschen“) sind rot abgesetzt und stehen ganz unten im Menü.
- **Status immer sichtbar.** Der orange Balken lässt nie Zweifel, ob ein Plan live ist.
  Die Seitenleiste zählt live mit. Fehlende Inhalte werden benannt statt leer gelassen
  („Keine Schichten“, „Derzeit keine Aktivitäten“).
- **Wenige Klicks für häufige Aufgaben.** Schichten entstehen direkt in der Tageszelle
  über ein kompaktes Popover: Start/Ende, Pause, Jobposition, Besetzung oder „Freie
  Schicht“, optionale Notiz — und „+ Schicht hinzufügen“ für mehrere Schichten im
  selben Zeitraum. Wochen lassen sich als Vorlage speichern und wieder einfügen; Pläne
  lassen sich „erweitern“ statt neu anlegen.
- **Hilfe am Ort des Geschehens.** Jede komplexere Funktion hat ein ⓘ-Icon oder einen
  kurzen Erklärtext direkt auf der Seite; Video-Tutorials dort, wo man sie braucht.
- **Aufgaben statt Funktionen.** Die Oberfläche spricht die Sprache des Planers
  („Wünsche berücksichtigen“, „Auf Regelbruch überprüfen“ statt „Konfiguration“).
  Warnungen sind handlungsorientiert formuliert und direkt verlinkt („3 Personen wurden
  nicht eingeladen, gebe jetzt ihre E-Mail-Adressen an“).
- **Schwächen:** Der Einstieg in den Planungsmodus braucht drei Schritte; die
  Einstellungen haben 15+ Unterpunkte; manche Information steht doppelt.

## Empfehlungen für den AKRO-Schichtplaner

Die fünf Muster mit dem größten Nutzen fürs Geld:

| # | Muster aus Smartplan | Umsetzung im AKRO-Schichtplaner |
|---|---|---|
| 1 | Wochenraster mit Heute-Markierung, Schicht-Karten, „Heute“-Knopf | Kern der Plan-Ansicht; leere Tage beschriften („Keine Schichten“) |
| 2 | Entwurf vs. veröffentlicht mit farbigem Statusbalken | Oranger Balken „in Bearbeitung“; Mitarbeiter sehen nur Veröffentlichtes |
| 3 | Schicht-Anlage als Popover direkt in der Tageszelle | Ein Dialog: Zeit, Pause, Position, Besetzung/„Freie Schicht“, Notiz |
| 4 | Eine Markenfarbe + Bereichsfarben mit fester Bedeutung | AKRO-Farbe für Hauptaktionen; je Bereich (Sicherheit, Reinigung, Service, Fire & Safety) ein Farbpunkt, überall identisch |
| 5 | Live-Zähler beim Planen (Stunden je Mitarbeiter/Woche, freie Schichten) | Seitenleiste in der Planung; später Regelprüfung (Ruhezeiten, Maximalstunden) |

Dazu übernehmen, weil billig und wirksam: Bestätigungsdialoge, die Folgen in einfachen
Sätzen erklären; Löschen immer rot und abgesetzt; ⓘ-Erklärtexte direkt am Element;
Wochen-Vorlagen („Woche zu Vorlage hinzufügen“); handlungsorientierte Warnungen mit
Link („2 Mitarbeiter ohne E-Mail — jetzt einladen“).

Bewusst besser machen als Smartplan: durchgängig deutsche Texte ohne
Lokalisierungslücken; größere Schrift und mehr Kontrast (Mitarbeiter schauen unterwegs
aufs Handy); Planungsmodus mit einem Klick erreichbar statt über drei Schritte; keine
überlagernden Werbe-/Chat-Widgets.

Weglassen (für ~20 Mitarbeiter unnötig, spart Entwicklungskosten): automatische
Personalbesetzungs-Vorschläge, Lohnmodul, SMS-Versand, Schnittstellen/API-Seite,
CPR-/Personalnummern-Spalten.

## Umsetzungsplan

1. **Stufe 1 — Grundgerüst angleichen:** feste Hauptnavigation mit Icons und aktiver
   Markierung; Wochenraster mit Heute-Hervorhebung und „Heute“-Knopf; Schicht-Dialog
   nach Smartplan-Muster; Statusbalken Entwurf/Veröffentlicht. Überschaubare
   Oberflächen-Anpassungen an der bestehenden Next.js-App.
2. **Stufe 2 — Alltag beschleunigen:** Wochen-Vorlagen, Plan verlängern/erweitern,
   Live-Stundenzähler je Mitarbeiter in der Planung, Bereichsfarben durchgängig,
   Bestätigungsdialoge mit Folgen-Erklärung.
3. **Stufe 3 — Komfort:** Filterleiste (Alle/Freie/Meine Schichten, je Bereich),
   Excel-Export der Stunden, Abwesenheitskalender mit Antrags-Zähler, Regelprüfung.

Abnahme-Test je Stufe: Eine neue Bürokraft muss ohne Einweisung eine Woche planen und
veröffentlichen können.

Nächster Schritt: Stufe 1 als konkrete Aufgabenliste für die Entwicklung formulieren.
