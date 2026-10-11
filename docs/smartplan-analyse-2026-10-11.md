# Smartplan-Analyse für den AKRO-Schichtplaner

Oct 11, 2026 · @Yahya

Smartplan wurde in einer frischen Testumgebung komplett eingerichtet und aktiv bedient; die wichtigsten Muster für den AKRO-Schichtplaner sind der Status-Lebenszyklus des Dienstplans, der Änderungs-Diff vor dem Veröffentlichen und die Regelbruch-Prüfung.

## Überblick und Methodik

Ziel: Smartplan als Referenz für den bestehenden AKRO-Schichtplaner (Next.js, React, TypeScript, PostgreSQL/Prisma, eigener Echtzeitserver; Struktur Organisation → Kunde → Standort → Wochenplan → Schicht) aktiv durchspielen und daraus konkrete, überprüfbare Verbesserungen ableiten.

Testumgebung: frischer Smartplan-Trial-Account (30 Tage kostenlos), Firma „UNREAL Logi". Einrichtung mit Branche „Dienstleistungen" (keine Branche „Sicherheitsdienst" wählbar) und den vier AKRO-nahen Jobpositionen Sicherheitsmitarbeiter, Reinigungskraft, Servicekraft, Brandschutzhelfer. Drei erkennbar fiktive Demo-Mitarbeiter (Max Mustermann, Erika Beispiel, Tom Test) ohne E-Mail-Adresse — es wurden keine Einladungen verschickt, keine Kosten ausgelöst. Die Telefonnummer im Profil ist ein Pflichtfeld und wurde mit einem Platzhalter (+49 1575 0000000) befüllt; bei Bedarf im Profil ändern.

Alle Teständerungen (Dienstplan, Schichtübertragung, Abwesenheit) blieben nach einem vollständigen Neuladen erhalten — serverseitig persistiert, selbst geprüft.

Status-Legende in diesem Dokument: **selbst geprüft** = Ablauf vollständig durchgespielt · **nur sichtbar** = Einstellung/Schaltfläche gesehen, Wirkung nicht ausgelöst · **vermutet / nicht zugänglich** = nicht prüfbar (z. B. Mitarbeiter-App ohne zweiten Login). Aus ausgeblendeten Schaltflächen wird keine serverseitige Berechtigungssicherheit abgeleitet.

## Bedienkonzept der Referenz

Smartplan organisiert alles in **Firma → Standorte → Dienstpläne → Schichten**. Ein Dienstplan ist ein frei wählbarer Zeitraum (hier 2 Wochen) an einem Standort — kein starrer Wochenplan. Kunden als eigene Ebene gibt es nicht; AKROs Ebene Kunde → Standort ist dort flach als „Standort“ abgebildet.

Die Navigationslogik: eine schlanke globale Topbar (Dienstpläne · Stempeluhr · Mitarbeiter · Nachrichten · Abwesenheit · Zeiterfassung · Profil · Einstellungen), darunter arbeitet fast alles **ohne Seitenwechsel**: Schichten werden in Popovern direkt in der Zelle angelegt und bearbeitet, Bestätigungen laufen über Modals mit klar benannten Konsequenzen.

Die drei prägendsten Muster:

1. **Vorlage + Plan als Paar.** Jeder Dienstplan hat eine Wochen-Vorlage; jede dort angelegte Schicht wird sofort automatisch in alle Wochen des Zeitraums kopiert. Abweichungen im Plan sind erlaubt, pro Zelle erscheint dann „Vorlage folgen“ als Rücksetzer.
2. **Expliziter Status-Lebenszyklus.** Planung → Veröffentlicht → „Unter Bearbeitung“ (oranges Banner). Jeder Übergang hat einen Dialog, der benennt, was Mitarbeiter währenddessen können und was nicht.
3. **Live-Kontext-Sidebar.** Rechts stehen ständig: Regelverstöße, freie Schichten, besetzte Stunden, Wochenstunden je Mitarbeiter — jede Änderung aktualisiert die Zahlen sofort.

Onboarding-Hilfen während der Einrichtung: geführte Tooltips am jeweils nächsten Schritt („Wähle das Start- und Enddatum… Probiere es zunächst mit 1 Monat“), ein Video-Tutorial-Link in der Tab-Leiste, proaktiver Support-Chat. Kleinere Schwäche: vereinzelt unübersetzte dänische Texte („MED FRAVÆR I PERIODEN“ im Abwesenheits-Filter).

&#91;image: Startseite „Dienstpläne“ nach Neuladen: Plankarte mit Badge ZUKÜNFTIGE und Hinweis „Es gibt 1 freie Schicht im Dienstplan“\]

## Geprüfte Abläufe (Schrittfolgen)

### 1 · Konto-Einrichtung — selbst geprüft

Start auf /account/setup/company, zwei Schritte mit Fortschrittsbalken. Schritt 1: Branche (Mehrfachauswahl mit Suche), Land (vorbelegt Deutschland), 3 vorbereitete Jobpositions-Felder mit automatischen Farbpunkten, „+ Weitere Jobposition hinzufügen“. Schritt 2: eigene Angaben (Vorname, Nachname, Telefon als Pflichtfeld, eigene Rolle — „Keine Position“ vorausgewählt) plus 3 optionale Mitarbeiterzeilen mit Positions-Checkboxen. Entscheidender Vertrauensanker im Text: „Sie werden nicht automatisch eingeladen, sondern erst, wenn du dich dafür entscheidest.“ Fehlervalidierung erst beim Absenden, roter Hinweis direkt am Feld. Nach „Speichern und loslegen“ landet man ohne Umweg auf der Dienstpläne-Startseite; Branche und Positionen sind später editierbar.

### 2 · Mitarbeiter und Berechtigungen — selbst geprüft

Einstieg über Topbar „Mitarbeiter“. Oben eine Statuskarte („4 Mitarbeiter, 3 nicht eingeladen“) mit direktem Call-to-Action. Tabelle mit Umschalter Detailliert/Einfach, pro Zeile Inline-Buttons „Bearbeiten“ und „E-Mail hinzufügen und einladen“; links Filter nach Arbeitsbereich und Status (Administratoren, Superuser, Mitarbeiter, Nicht eingeladen, Deaktiviert); oben Excel-Export und Spaltenkonfiguration. Das Bearbeiten-Modal trennt Basisdaten, Rolle im Dienstplan (Positions-Checkboxen plus „Übernimmt keine Schichten“) und einklappbare „Zusätzliche Infos“ (Mitarbeiternummer im Lohnsystem, Lohnart, CPR-Nummer) — letztere mit Sichtbarkeits-Label „Administratoren“. Löschen ist nur als Link im Profil, Deaktivieren ist der primäre Weg. Rollenwirkung (Superuser vs. Mitarbeiter) nur sichtbar, nicht mit zweitem Login geprüft.

&#91;image: Mitarbeiterliste mit Statusfiltern, Inline-Einladung je Zeile und Excel-Export\]

### 3 · Dienstplan anlegen, Schichten erstellen, veröffentlichen — selbst geprüft

1. Startseite → Karte „Neuen Dienstplan erstellen“. Die Einrichtungsseite führt über eine horizontale Schrittleiste: Zeitraum wählen → Wünsche berücksichtigen (deaktivierbar) → Personalbesetzung vorschlagen → Regeln aufstellen → Mitarbeiter einteilen. Alles außer Zeitraum ist optional — der schnelle Weg bleibt frei.
2. Titel oben rechts eintragen (ohne expliziten Klick auf „Speichern“ geht er verloren), Zeitraum per Doppel-Datepicker (hier 12.10.–25.10.).
3. Tab „Dienstplan-Vorlage“: pro Wochentag „Schicht erstellen“ — ein Popover direkt in der Spalte mit Start/Ende (Freitext plus 15-Minuten-Dropdown), Schlussdienst-Checkbox, Schichtpause, dann je Zeile Jobposition + Personalbesetzung + Anmerkung. „+ Schicht hinzufügen“ erzeugt mehrere Schichten im selben Zeitfenster. Das Personal-Dropdown zeigt je Person die aktuelle Schichtzahl („Max Mustermann – 3 Schichten“) und erlaubt Inline-Neuanlage („Gebe den Namen des Mitarbeiters ein“); das Positions-Dropdown endet mit „+ Neue Jobposition erstellen“.
4. Jede Vorlagen-Schicht erscheint sofort in beiden Wochen des Plans; die Sidebar zählt live mit (freie Schichten, besetzte Stunden, Wochenstunden je Mitarbeiter). Nachtschicht 20:00–04:00 wird ohne Sonderbehandlung über Mitternacht akzeptiert.
5. „Dienstplan veröffentlichen“ öffnet einen Dialog mit angehaktem „Sende eine Benachrichtigung…“, einer Liste dessen, was Mitarbeiter danach können (einsehen, tauschen, Kalender-Sync, Arbeitszeiten bearbeiten) und einem Konfliktcheck („Keine Konflikte gefunden“) als Freigabe.
6. Nach dem Veröffentlichen wechselt die Ansicht in einen Lesemodus mit Filter-Chips (Alle Schichten · Freie Schichten mit Zähler · Meine Schichten · je Jobposition) und Druck-Button.

&#91;image: Dienstplan-Einrichtung: Schrittleiste oben, Vorlage-Tab, rechte Sidebar mit Veröffentlichen-Button und Kennzahlen\]

&#91;image: Schicht-Popover in der Tageszelle: Zeiten, Schlussdienst, Pause, Jobposition, Personalbesetzung, Notiz\]

&#91;image: Vorlage mit zugewiesener Schicht und freier Schicht; Sidebar zählt freie Schichten und Stunden live\]

&#91;image: Veröffentlichen-Dialog mit Benachrichtigungs-Checkbox, Fähigkeiten-Liste und grünem Konfliktcheck\]

### 4 · Freie Schicht besetzen im veröffentlichten Plan — selbst geprüft

Klick auf einen Tag öffnet eine Tagesdetail-Ansicht (statt Popover): Schichtliste links, rechts ein Tages-Nachrichtenboard („Heutige Nachrichten“ mit Eingabefeld). Hover auf eine Schicht blendet „Schicht übertragen“ und „Schicht bearbeiten“ ein. „Übertragen“ öffnet ein Inline-Panel mit Personen-Dropdown und Checkbox „Tausch ohne Genehmigung durchsetzen“ — der Admin kann also wahlweise direkt zuweisen oder den Genehmigungsweg erzwingen. Nach dem Bestätigen steht der Name sofort in der Zelle, der Zähler „Freie Schichten“ sinkt von 2 auf 1.

&#91;image: Tagesdetail: Schichtzeile mit Hover-Aktionen „Schicht übertragen“ / „Schicht bearbeiten“, rechts Tages-Nachrichten\]

&#91;image: Übertragen-Panel mit Empfänger-Dropdown und „Tausch ohne Genehmigung durchsetzen“\]

### 5 · Veröffentlichten Plan ändern: Statuswechsel und Änderungs-Diff — selbst geprüft

1. „Dienstplan bearbeiten“ öffnet ein Menü (Gehe zur Planung, Neue Schicht hinzufügen, Stundenbericht, Dienstplan erweitern, Dienstplan löschen).
2. „Gehe zur Planung“ fragt per Modal ab und benennt die Konsequenzen wörtlich: Mitarbeiter sehen weiterhin ihre aktuellen Schichten, können aber keine Schichten tauschen, keine Nachrichten schreiben, keine Arbeitszeiten bearbeiten.
3. Im Planungsmodus hängt rechts ein oranges Banner „Dienstplan ist unter Bearbeitung“; sein Dropdown bietet drei Zustände: weiter bearbeiten, Änderungen speichern & veröffentlichen, Änderungen löschen (Rollback zum ursprünglichen Plan).
4. Beim erneuten Veröffentlichen fasst der Dialog die Änderungen als Diff zusammen — Zeitraum / Neue Schichten / Gelöschte Schichten / Veränderte Schichten, jeweils mit Einträgen oder „keine“ — plus Konfliktcheck und abwählbarer Benachrichtigung.

&#91;image: Status-Dropdown: unter Bearbeitung · speichern & veröffentlichen · Änderungen löschen\]

&#91;image: Erneutes Veröffentlichen: Änderungs-Diff nach Kategorien plus Konfliktcheck\]

### 6 · Konflikte und Regelwerk — selbst geprüft

Test: zweite Schicht 10:00–18:00 für Max Mustermann am Tag seiner 08:00–16:00-Schicht, zusätzlich mit einer Jobposition, die er nicht besitzt. Ergebnis nach Klick auf die Prüfleiste „Auf Regelbruch überprüfen“: Kopfzeile wird rot („2 Regelverstöße“), beide Schichtkarten im Grid werden rot hinterlegt mit Inline-Label „Konflikte mit Schicht“, und das Panel listet die Verstöße pro Mitarbeiter als klickbare Chips („Jobposition fehlt — morgen“, „Konflikte mit anderen Schichten im Zeitraum — morgen“). Wichtig: Die Prüfung läuft auf Abruf (↻), nicht live — nach dem Löschen der Konflikt-Schicht blieb die Anzeige stehen, bis neu geprüft wurde. Das Regelwerk (Modal „Regeln für Mitarbeiter aufstellen“) hat global und je Mitarbeiter schaltbare Regeln: bevorzugte Wochenstunden (Default 37), Mindestpause zwischen Schichten (11 h), zusammenhängende Arbeitstage, max. Arbeitstage in Folge (5), Abwesenheit berücksichtigen, freier Tag pro Wochenendschicht.

&#91;image: Konfliktdarstellung: rote Schichtkarten mit Label, rotes Zähler-Banner, Verletzungen je Mitarbeiter als Chips\]

&#91;image: Regel-Modal: globale Regeln mit Zahlenwerten, deaktivierte Regeln gezählt, links Überschreibung je Mitarbeiter\]

### 7 · Abwesenheit — selbst geprüft

Einstieg Topbar „Abwesenheit“: Monatskalender mit Kalenderwochen, deutschen Feiertagen und Zähler offener Abwesenheitsanfragen. „+ Abwesenheit erstellen“ führt in drei Schritten: Person wählen (Suchliste) → Zeitraum als Schnellwahl (Heute / Morgen / Zeitraum wählen, Ganztägig-Checkbox) plus Art (Urlaub, Krank, „+ Art hinzufügen“) und Anmerkung mit expliziter Sichtbarkeitsangabe („sichtbar für Admin und Tom“) → Button heißt „Konsequenzen aus Abwesenheit anzeigen“: eine Zwischenseite prüft gegen den Dienstplan („Tom hat keine bevorstehenden Schichten in dem Zeitraum“) und erst dann wird genehmigt/erstellt. Danach liegt der Eintrag als grüner Balken im Kalender; links entstehen automatisch Filter (Arbeitsbereich, Art, Mitarbeiter mit/ohne Abwesenheit). In den Einstellungen zuschaltbar: Urlaubskonto mit Urlaubsjahr und Verfallsfrist — nur sichtbar.

&#91;image: Konsequenzen-Zwischenseite vor dem Genehmigen einer Abwesenheit\]

### 8 · Zeiterfassung und Stempeluhr — teils geprüft

Zeiterfassung: Monatsübersicht mit IST/SOLL-Stunden und Abweichung in Prozent, Tabelle je Mitarbeiter (Stunden laut Dienstplan vs. Stunden nach Änderungen, Lohn, Bestätigt), Zeilen aufklappbar bis zur Einzelschicht mit Link „Zum Dienstplan“ für Korrekturen; Excel-Export und „Lohn für den Zeitraum erstellen“ — Übersicht selbst geprüft, Lohnlauf nur sichtbar. Stempeluhr: pro Standort eine Kiosk-Ansicht („Stempeluhr öffnen“) und/oder Stempeln per Smartphone-App in definierten Bereichen (Geofencing); Richtlinien-Einstellungen regeln Ein-/Ausstempeln außerhalb der Planzeit (z. B. „Arbeitszeit ab Einstempeln berechnen“), Pausenerfassung und ungeplante Schichten — alles nur sichtbar, da kein Mitarbeiter-Login vorhanden.

&#91;image: Zeiterfassung: aufgeklappte Mitarbeiterzeile mit Soll/Ist je Schicht und Link zur Korrektur im Dienstplan\]

&#91;image: Stempeluhr-Einstellungen: Tablet/Kiosk vs. App mit Bereichen, darunter Richtlinien-Dropdowns\]

## Priorisierte übertragbare Verbesserungen

Priorität 1–3 = erstes Paket (nächster Abschnitt). Umsetzungsideen beziehen sich auf die bestehende AKRO-Struktur Organisation → Kunde → Standort → Wochenplan → Schicht; was der AKRO-Schichtplaner heute schon kann, ist vor Umsetzung gegen den aktuellen Stand zu prüfen (Projektdateien waren in dieser Sitzung nicht zugreifbar).

| Prio | Beobachtung in Smartplan | Nutzen | Umsetzungsidee für AKRO | Abnahmekriterium |
| --- | --- | --- | --- | --- |
| 1 | Veröffentlichen-Dialog mit Änderungs-Diff (Neu/Gelöscht/Verändert/Zeitraum), Konfliktcheck und abwählbarer Benachrichtigung | Planer sieht vor dem Senden exakt, was Mitarbeiter treffen wird; verhindert versehentliche Massen-Pushes | Beim Veröffentlichen eines Wochenplans serverseitig Diff gegen letzte veröffentlichte Version berechnen (Prisma: Snapshot- oder Versionstabelle je Schicht) und im Modal gruppiert anzeigen; Checkbox „Betroffene benachrichtigen“ | Modal zeigt bei 1 geänderten, 1 neuen, 1 gelöschten Schicht alle drei korrekt gruppiert; ohne Änderungen steht überall „keine“; abgewählte Benachrichtigung löst keinen Versand aus |
| 2 | Expliziter Plan-Lebenszyklus: Entwurf → Veröffentlicht → Unter Bearbeitung (oranges Banner) mit Konsequenzen-Dialog und „Änderungen löschen“ (Rollback) | Klarer mentaler Zustand; Mitarbeiter sehen nie halbfertige Pläne; Änderungen sind gefahrlos verwerfbar | Statusfeld am Wochenplan (DRAFT / PUBLISHED / EDITING) + Banner-Komponente; beim Wechsel zu EDITING publizierte Version einfrieren, Mitarbeitersicht serviert weiter die eingefrorene; „Änderungen verwerfen“ stellt sie wieder her | Nach „Bearbeiten“ sieht ein Mitarbeiter-Account unverändert den alten Plan; „Verwerfen“ stellt ihn byte-gleich wieder her; Statusbanner ist auf jeder Planseite sichtbar |
| 3 | Konflikt-Prüfung: überlappende Schichten und fehlende Qualifikation werden rot markiert, Verstöße je Mitarbeiter als klickbare Chips gelistet | Doppelbuchungen und Fehlbesetzungen fallen vor der Veröffentlichung auf, nicht am Einsatztag | Prüfregeln als Service (Überlappung je Mitarbeiter über Kunden/Standorte hinweg, Qualifikation/Position, später Ruhezeit); rote Schichtkarte + Inline-Label, Panel mit Sprung zur Schicht; Prüfung bei jedem Speichern (AKRO hat Echtzeitserver → live statt on-demand wie Smartplan) | Zwei überlappende Schichten desselben Mitarbeiters an verschiedenen Standorten werden beim Anlegen markiert; Klick auf den Panel-Eintrag scrollt zur Schicht; nach Löschen verschwindet der Eintrag ohne manuelles Neuprüfen |
| 4 | Live-Sidebar: freie Schichten, besetzte Stunden, Wochenstunden je Mitarbeiter, aktualisiert bei jeder Änderung | Besetzungslücken und Überstunden sind beim Planen ständig sichtbar | Sidebar am Wochenplan mit Aggregaten (SQL-Views oder berechnet im Loader), über Echtzeitserver aktualisiert; Filter „Gesamt / je Position / je Mitarbeiter“ | Zuweisung einer 8-h-Schicht erhöht die Wochenstunden des Mitarbeiters sichtbar ohne Reload; Zähler „offene Schichten“ stimmt mit Filterergebnis überein |
| 5 | Schicht-Popover in der Zelle: Zeiten mit 15-min-Stepper, Pause, mehrere Schichten je Zeitfenster, Personen-Dropdown mit Schichtzahl, Inline-Neuanlage von Person und Position | Weniger Klicks und kein Kontextverlust beim Massenanlegen | Bestehendes Schichtformular als Popover/Popper an der Zelle verankern; im Personen-Select Wochenstunden/Schichtzahl anzeigen; „+ weitere Schicht“ im selben Popover | Schicht anlegen inkl. Zuweisung in ≤ 4 Klicks ab Zelle; Select zeigt je Person aktuelle Wochenstunden; zwei Schichten im selben Zeitfenster ohne erneutes Öffnen anlegbar |
| 6 | Wochen-Vorlage kopiert sich automatisch in alle Wochen; Abweichung zeigt „Vorlage folgen“ als Rücksetzer; „Woche kopieren“ je Woche | Wiederkehrende Besetzungen (Objektschutz-Dauerposten) in Minuten statt je Woche neu | Vorlage je Standort/Objekt (AKRO hat Wochenpläne → Vorlage als Quelle beim Anlegen neuer Wochen); Abweichungs-Indikator + Rücksetzer je Zelle | Neue Woche aus Vorlage enthält alle Vorlagen-Schichten; manuell geänderte Zelle zeigt Rücksetzer, der exakt den Vorlagenstand wiederherstellt |
| 7 | Abwesenheit mit Konsequenzen-Zwischenseite (betroffene Schichten) vor Genehmigung; Anmerkung mit expliziter Sichtbarkeitsangabe | Genehmigung kollidiert nie unbemerkt mit eingeplanten Schichten | Vor dem Speichern einer Abwesenheit Schichten im Zeitraum abfragen und anzeigen (inkl. Option „Schichten freigeben“); Sichtbarkeits-Hinweis am Notizfeld | Abwesenheit über einem eingeplanten Tag zeigt die betroffenen Schichten namentlich an, bevor gespeichert werden kann |
| 8 | Freie (unbesetzte) Schichten als eigener Zustand: Zähler-Chip, Filter, Übertragen-Aktion, Hinweis auf der Plankarte | Offene Posten sind auf einen Blick auffindbar statt per Durchscrollen | Status „unbesetzt“ prominent: Filter-Chip mit Zähler im Plankopf, Badge auf der Planübersicht, Aktion „zuweisen“ direkt an der Karte | Chip zeigt korrekte Anzahl; Klick filtert auf unbesetzte Schichten; Zuweisung aus der Karte reduziert den Zähler sofort |
| 9 | Übertragen-Dialog mit Checkbox „Tausch ohne Genehmigung durchsetzen“ | Admin-Schnellweg und Genehmigungsprozess in einem UI | Beim Umhängen einer Schicht wählbar: direkt zuweisen vs. Anfrage an Mitarbeiter (später, wenn Mitarbeiter-Logins existieren) | Direktmodus ändert sofort; Anfragemodus erzeugt offenen Vorgang statt Änderung |
| 10 | Nachrichtenboard je Tag in der Tagesansicht; Benachrichtigungstexte erklären Folgen in Alltagssprache | Absprachen bleiben beim Tag statt in WhatsApp verstreut | Kommentarfeld je Tag/Schicht im Wochenplan (Echtzeitserver vorhanden); Konsequenz-Sätze in alle Bestätigungsdialoge übernehmen | Nachricht an Tag X ist nach Reload für zweiten Browser sichtbar; jeder destruktive Dialog benennt konkret, was passiert |

## Erstes Umsetzungspaket (klar begrenzt)

Drei Verbesserungen, die zusammen den größten Alltagsnutzen bringen und sich gegenseitig stützen — bewusst ohne Zeiterfassung, Stempeluhr, Mitarbeiter-App und Schichttausch:

1. **Plan-Lebenszyklus mit sicherem Bearbeiten** (Prio 2): Statusfeld DRAFT / PUBLISHED / EDITING am Wochenplan, Banner-Komponente, eingefrorene veröffentlichte Version für die Mitarbeitersicht, „Änderungen verwerfen“. Das ist die Grundlage für den Diff.
2. **Veröffentlichen-Dialog mit Änderungs-Diff und Benachrichtigungs-Option** (Prio 1): Diff gegen die eingefrorene Version, gruppiert nach Neu / Geändert / Gelöscht, Checkbox für Benachrichtigungen.
3. **Live-Konfliktprüfung mit Inline-Markierung** (Prio 3): Überlappung je Mitarbeiter (kunden- und standortübergreifend) und fehlende Qualifikation; rote Karte + Label + Panel mit Sprung zur Schicht; dank Echtzeitserver live statt on-demand — damit besser als die Referenz.

Sinnvolle Reihenfolge: 1 → 2 → 3. Die Abnahmekriterien stehen in der Tabelle oben. Alles passt in die bestehende deutsche AKRO-Oberfläche und berührt das Datenmodell nur additiv (Statusfeld, Versions-/Snapshot-Tabelle, Prüfservice).

## Offene Fragen und nicht geprüfte Bereiche

Nicht geprüft / nicht zugänglich:

- **Mitarbeitersicht, App und Push-Benachrichtigungen**: Es existiert kein zweiter Login (Demo-Mitarbeiter ohne E-Mail). Was ein Mitarbeiter bei Veröffentlichung, Tausch oder Nachricht tatsächlich sieht, ist nur aus Admin-Dialogtexten bekannt — vermutet.
- **Schichttausch aus Mitarbeitersicht**: Nur die Einstellungen gesehen (Standard: Tausch frei bei passender Jobposition; optional Admin-Genehmigung oder Verbot) plus Tausch-Übersicht mit Filtern — nur sichtbar.
- **Stempeluhr-Kiosk und App-Stempeln**: Einstellungen und Richtlinien gesehen, kein Stempelvorgang ausgelöst — nur sichtbar.
- **Lohnlauf, Excel-Exporte, Schnittstellen/API**: Buttons vorhanden, nicht ausgeführt — nur sichtbar.
- **Serverseitige Berechtigungen**: Aus sichtbaren/ausgeblendeten UI-Elementen (z. B. Lohnfelder „Administratoren“) wird keine geprüfte Zugriffssicherheit abgeleitet.
- **Mehrere Standorte**: „+ Standort hinzufügen“ vorhanden, nicht angelegt — wie Pläne und Mitarbeiter über Standorte verteilt werden, ist ungeprüft.

Offene Fragen für die Umsetzung:

- [ ] Abgleich mit dem Ist-Stand des AKRO-Schichtplaners: Die Projektdateien (AGENTS.md, docs/AKRO-ERWEITERUNG.md, ANLEITUNG.md, docs/FERTIGSTELLUNG.md) waren in dieser Sitzung nicht zugreifbar. Vor Umsetzung prüfen, welche der 10 Punkte bereits ganz oder teilweise existieren.
- [ ] Soll die Mitarbeitersicht im ersten Paket die eingefrorene veröffentlichte Version anzeigen (empfohlen), oder reicht zunächst ein reiner Status-Hinweis?
- [ ] Welche Benachrichtigungskanäle hat die AKRO-App heute (E-Mail, Push, keine)? Davon hängt ab, was die Checkbox im Veröffentlichen-Dialog auslöst.
- [ ] Konfliktprüfung: Soll Überlappung kundenübergreifend hart blocken oder nur warnen (Smartplan warnt nur)?
- [ ] Testumgebung: Smartplan-Trial läuft 30 Tage; Platzhalter-Telefonnummer im Profil bei Bedarf ersetzen. Weitere Erkundung (z. B. zweiter Standort, Personalbesetzungs-Vorschlag, Wünsche/Verfügbarkeiten der Mitarbeiter) jederzeit möglich.
