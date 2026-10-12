## Planung (Dienstplan, Assistent, Tausch)

Quellen: Smartplan-Hilfe-Center, Kategorien 168 (Planungswerkzeug, 16 Artikel), 169 (Assistent, 4 Artikel, identisch mit 277/278/280/281 aus 168), 179 (Schichttausch, 3 Artikel); 12 Screenshots angesehen (Nummern A01–A12 im Text; Bilder nicht im Repo). Code-Abgleich am Stand `88c21eb`. Rollen in Smartplan: Inhaber, Admin, Superuser (Planer mit Einzelrechten), Mitarbeiter.

### Funktionen

| Nr | Funktion in Smartplan | Rolle | Details und Regeln (Felder, Optionen, Abläufe, Meldungen – in eigenen Worten, kein Copy-Paste) | Schichtplaner heute (Datei-Verweis) | Status | Aufwand |
|---|---|---|---|---|---|---|
| A1 | Planungswerkzeug je Standort | Admin, Superuser | Kopf „Plan erstellen für: Standort“ mit Link „Standort wechseln“. Planungswerkzeug nur im Browser, nicht in der App. | Standortwahl nach Kunde (`src/components/schedule/branch-picker.tsx`), Kopf mit Kunde/Standort (`schedule-toolbar.tsx`) | vorhanden | S |
| A2 | Planzeitraum frei wählen | Admin, Superuser | Feld „Zeitraum“ oben links mit Von–Bis-Datum. Ein Plan umfasst mehrere Wochen (untereinander dargestellt), höchstens 32 Wochen; große Pläne laden langsamer. Veröffentlicht wird der ganze Plan. | Plan = Standort + Kalenderwoche (`prisma/schema.prisma` Schedule), Veröffentlichung je Woche (`api/schedules/[id]/route.ts`) | anders gelöst | L |
| A3 | Planliste „Dienstpläne“ mit Archiv | alle | Menüpunkt listet aktuelle Pläne; vergangene Pläne unten im Archiv, gruppiert nach Standort, dann Jahr. Mitarbeitende öffnen dort veröffentlichte Pläne und geben Wünsche ab. | Keine Planliste; Blättern je Woche/Monat (`week-nav.tsx`, `month-grid.tsx`) | anders gelöst | M |
| A4 | Plan verlängern | Admin, Superuser | Im Bearbeitungsmodus Enddatum ändern; neue Wochen werden aus der Vorlage befüllt, ohne Vorlage leer. | Wochenpläne entstehen beim Öffnen automatisch (`ensureSchedule` in `src/lib/shift-service.ts`); Vorlagenfüllung fehlt (siehe A25) | anders gelöst | S |
| A5 | Folgeplan aus bestehendem Plan („Plan erweitern“) | Admin, Superuser | „Plan bearbeiten“ → „Plan erweitern“ öffnet neuen Plan mit Start am Tag nach dem alten Ende; Vorlage wird übernommen, Zeitraum und Schichten anpassbar. | Nur Wiederholung beim Anlegen einer Schicht (1–52 Wochen, `shiftInput.repeatWeeks`) | fehlt | M |
| A6 | Schichten anlegen je Tag | Admin, Superuser | Link „Schichten hinzufügen“ oben in jeder Tagesspalte und unter vorhandenen Zeitblöcken öffnet den Schichtdialog am Tag. | „+ Schicht“ je Tagesspalte, Seitenleiste `src/components/schedule/shift-form.tsx`, `POST /api/shifts` | vorhanden | S |
| A7 | Schichtdialog: Beginn und Ende | Admin, Superuser | Zwei große Zeitfelder (HH:MM). | `TimeInput`; Ende vor Beginn = Folgetag (`shift-form.tsx`) | vorhanden | S |
| A8 | Option „Schließdienst“ | Admin, Superuser | Kästchen „Schließdienst“ im Zeitbereich des Dialogs (Wirkung nicht beschrieben). | Kein Feld im Modell `Shift` | fehlt | S |
| A9 | Unbezahlte Pause | Admin, Superuser | Auswahl „Pause“ in Minuten je Zeitblock. | Pause in Minuten + Regel pro Schicht/pro Stunde (`Shift.pauseValue/pauseOption`) | vorhanden | S |
| A10 | Mehrere Schichten im selben Zeitblock | Admin, Superuser | Tabelle „Schichten mit diesen Zeiten“: je Zeile Position, Besetzung, Notiz; „Weitere Schicht hinzufügen“ ergänzt Zeile; „Erstellen“ legt alle an. | Eine Schicht mit „Benötigte Mitarbeitende“ (`maxEmployees`), gleiche Tätigkeit für alle Plätze; „Platz +“ auf der Karte (`api/shifts/[id]/places`) | teilweise | S |
| A11 | Position je Schicht | Admin, Superuser | Jede Schicht trägt eine Position (Farbpunkt); bestimmt, wer die Schicht übernehmen kann (Hervorhebung, Assistent, Tauschauswahl). | Arbeitsbereich (Farbe), Tätigkeit/Titel als Freitext mit Vorschlägen des Standorts, erforderliche Qualifikationen als bestätigbarer Hinweis (`assessAssignment` in `src/lib/planning.ts`) | anders gelöst | M |
| A12 | Besetzung direkt im Schichtdialog | Admin, Superuser | Spalte „Mitarbeiter“: „Unbesetzte Schicht“ oder Person wählen; Auswahlliste trennt Abwesende und Personen mit Freiwunsch in eigene Gruppen. | Erst anlegen, dann auf der Karte besetzen (`employee-picker.tsx`) | teilweise | S |
| A13 | Notiz je Schicht | Admin, Superuser | Optionales Notizfeld je Zeile. | Feld „Hinweise“ (`Shift.description`, 2000 Zeichen) | vorhanden | S |
| A14 | Zeitblock bearbeiten/löschen | Admin, Superuser | Zahnrad am Zeitblock öffnet den Dialog erneut, dort „Zeitblock löschen“ (alle Schichten des Blocks). | Bearbeiten/Löschen je Schicht mit Rückfrage und Benachrichtigung (`api/shifts/[id]/route.ts` DELETE) | anders gelöst | S |
| A15 | Darstellung Zeitblock mit Schichtzeilen | alle | Pro Tag Zeitblock-Kopf (z. B. 10:00–14:00), darunter je Schicht eine Zeile: Positionspunkt + Name oder „Unbesetzte Schicht“; leerer Tag „Keine Schichten“. | Karte je Schicht mit Zeit, „x offen/besetzt“, Namen (`shift-card.tsx`); Zeitzeilen nur in klassischer Tabelle (`classic-grid.tsx`) | anders gelöst | M |
| A16 | Abwesende je Tag im Plan | alle mit Planansicht | Rote Zeile unter dem Tageskopf „N abwesend“ mit Aufklappliste. | Nicht im Plan; nur in der Besetzungsauswahl (Gruppe „belegt oder abwesend“) und als unwirksame Zuweisung (`ineffectiveBookings`, `shift-card.tsx` `unavailable`) | teilweise | S |
| A17 | Mitarbeiter aus der Planung anlegen | Admin | Kachel „Neuen Mitarbeiter anlegen“ in der Werkzeugleiste. | Nur unter Mitarbeiter (`src/components/workforce/personnel.tsx`) | fehlt | S |
| A18 | Zeitblock kopieren | Admin, Superuser | Beim Überfahren der Blockzeit erscheint Kopiersymbol; Block „aufnehmen“, Zieltage werden beim Überfahren blau, Klick kopiert; mehrfach möglich; beenden mit Esc, Klick auf Quelle oder „Element loslassen“. | Einzelne Schicht auf ein Datum kopieren (Datumsfeld im Bearbeiten-Dialog, `api/shifts/[id]/copy`), ohne Zuweisungen | teilweise | M |
| A19 | Tag kopieren | Admin, Superuser | Kopiersymbol am Wochentag nimmt alle Blöcke des Tages auf; Zieltage anklicken; Beenden wie A18. | – | fehlt | S |
| A20 | Woche kopieren | Admin, Superuser | „Woche kopieren“ im Wochenkopf; Zielwoche (blau) anklicken; beenden mit Esc oder Klick auf Quellwoche. | Nur Wiederholung beim Anlegen (`repeatWeeks` 1–52 in `createShifts`) | teilweise | M |
| A21 | Mitarbeiter „aufnehmen“ und verteilen | Admin, Superuser | Rechts Person wählen → passende Schichten (nach Position) werden hervorgehoben; Kopiersymbol, dann Schichten anklicken = besetzen. Tage mit vorhandener Schicht werden rot, beim Überfahren Hinweis „hat in diesem Zeitraum schon eine Schicht“ mit Stundenzahl; beenden mit Esc, Symbol oder „Element loslassen“. | Besetzung nur einzeln je Schicht über Auswahlliste (`employee-picker.tsx`, `POST /api/bookings`) | fehlt | M |
| A22 | „Namen entfernen“ je Woche | Admin, Superuser | Knopf im Wochenkopf (vermutlich Besetzung der Woche leeren; im Konto prüfen). | – | fehlt | S |
| A23 | Reiter „Vorlage“ | Admin, Superuser | Reiter „Dienstplan“ / „Vorlage“; Vorlage zeigt Mo–So ohne Datum mit „Schichten hinzufügen“, Titel „Unbenannte Vorlage“, Knöpfe „Vorlage speichern“, „Vorlagen ansehen und importieren“. | – | fehlt | M |
| A24 | Vorlage über mehrere Wochen | Admin, Superuser | „Woche zur Vorlage hinzufügen/entfernen“; Vorlage wiederholt sich zyklisch über den Plan (2-Wochen-Vorlage: Vorlagenwoche 1 gilt für jede zweite Woche); „Woche kopieren“ auch in der Vorlage. | – | fehlt | M |
| A25 | Vorlage füllt den Plan automatisch | Admin, Superuser | Schichten und Besetzung der Vorlage erscheinen sofort in allen passenden Planwochen; Besetzung für wechselndes Personal im Plan, für festes Personal in der Vorlage. | Wiederholung erzeugt unabhängige Kopien ohne Verknüpfung (`createShifts`) | fehlt | L |
| A26 | Abgleich Vorlage ↔ Plan | System | Vorlagenänderung an Besetzung oder Zeitblock geht in alle Plantage, außer an Schichten mit manueller Planänderung (Plan hat Vorrang). Planänderungen gehen nie in die Vorlage. Neue Vorlagenschichten werden immer ergänzt, auch wenn dadurch Doppelbelegung entsteht. | – | fehlt | M |
| A27 | „Auf Vorlage zurücksetzen“ je Tag | Admin, Superuser | Erscheint unten am Tag, sobald der Tag von der Vorlage abweicht; überschreibt alle Änderungen dieses Tages. | – | fehlt | S |
| A28 | Vorlage speichern | Admin, Superuser | „Vorlage speichern“ → Titel eingeben → „Speichern“. | – | fehlt | S |
| A29 | Vorlagenverwaltung | Admin, Superuser | Liste links in drei Gruppen: benannte, unbenannte (automatisch im Hintergrund gesichert), archivierte. „Umbenennen“ direkt; Änderungen nur nach „Vorlage importieren“; Import überschreibt die aktuelle Vorlage des Plans. Bearbeiten nur aus einem Plan ohne eigene Vorlage. | – | fehlt | M |
| A30 | Vorlagenversionen | Admin, Superuser | „Vorlage speichern“ nach Änderung = neue Version; ältere Versionen in der Vorschau einsehbar und mit „Vorlage verwenden“ importierbar; „Als neue speichern“ = neue Vorlage mit Titel. | – | fehlt | M |
| A31 | Vorlage archivieren, wiederherstellen, löschen | Admin, Superuser | „Archivieren“ oben rechts; in „Archivierte Vorlagen“ ansehen, importieren, „Wiederherstellen“ oder „Endgültig löschen“. | – | fehlt | S |
| A32 | Vorlagen je Standort | Admin, Superuser | Vorlage Standorten zuordnen; Filter nach Standort oben links; Superuser sehen nur kontoweite Vorlagen und die ihrer Standorte. Beim Import werden Personen, die nicht zum Standort gehören, aus Schichten entfernt (Schicht bleibt unbesetzt). | – | fehlt | S |
| A33 | Positionen verwalten | Admin | Einstellungen › Positionen: anlegen (auch frühere wiederherstellen), Name und Farbe ändern, entfernen; Änderung wirkt sofort im Plan, Zuordnungen bleiben. | Arbeitsbereiche mit Titel/Farbe/Mitgliedern (`src/app/(dashboard)/divisions/page.tsx`), Qualifikationskatalog (`api/qualifications`), Tätigkeiten je Standort (`Branch.positions`) | anders gelöst | M |
| A34 | Positionen Mitarbeitern zuordnen | Admin | Mehrere Positionen je Person; im Profil oder gesammelt in der Position per Häkchenliste. | Arbeitsbereich-Mitglieder, Qualifikationen je Person, eine Tätigkeit je Person (`OrganizationMember.position`) | teilweise | S |
| A35 | Mitarbeitende ändern eigene Positionen | Admin (Schalter) | Kästchen „Mitarbeitende dürfen ihre Positionen selbst ändern“. | – | fehlt | S |
| A36 | Filter „Alle / Offene / Meine Schichten“ | alle | Filterleiste über dem Plan; „Offene Schichten“ hebt alle unbesetzten hervor; „Meine Schichten“ im veröffentlichten Plan. | Bereichsfilter und Filter „Schichten mit Anfragen“ (`schedule-options.tsx` DivisionFilter, `wish-plan.tsx` WishFilterToggle); Zähler „x offen“; kein Filter offen/meine | teilweise | S |
| A37 | Positionslegende als Filter | alle | Farbpunkte je Position in der Filterleiste; Klick hebt Schichten der Position samt offenen hervor. | Bereichsfilter blendet andere Bereiche aus (`DivisionFilter`) | vorhanden | S |
| A38 | Mitarbeiter im Plan hervorheben | Admin, Superuser | „Alle Mitarbeiter anzeigen“ rechts → Person wählen → ihre Schichten blau. | Leiste mit Personen des Plans, Wochenstunden, Hervorheben/Abdunkeln (`employee-nav.tsx`) | vorhanden | S |
| A39 | Filter im veröffentlichten Plan für Mitarbeitende | Mitarbeiter | Unter „Dienstpläne“ Plan öffnen, gleiche Filter nutzen. | Standort-Wochenplan mit Bereichsfilter; „Mein Dienstplan“ (`employee-grid.tsx`) ohne Filter | teilweise | S |
| A40 | Seitenleiste „Planübersicht“ | Admin, Superuser | Anzahl Schichten ohne Besetzung, vergebene Stunden, Gesamtstunden je Mitarbeiter je Woche. | Kennzahlen im Kopf (Schichten, offen, unbestätigt, `schedule-toolbar.tsx`); Wochenstunden je Person (`employee-nav.tsx`) | teilweise | S |
| A41 | Status je Mitarbeiter | Admin, Superuser | Nach Personenwahl: Stunden gesamt und je Position, „Stunden je Woche“ mit Schichtliste je Woche, Kopiersymbol (A21). | Nur Wochensumme (`employee-nav.tsx`) | teilweise | S |
| A42 | Regeldialog „Regeln für Mitarbeiter einrichten“ | Admin, Superuser | Großes Fenster: links Suche, „Allgemeine Einstellungen“, Personenliste mit Kennzeichen „Regeln weichen ab“; rechts Gruppen Zeitverteilung, Arbeitstage, Abwesenheit. Häkchen aktiviert, Zahl anklicken ändert; deaktivierte Regeln eingeklappt („N deaktivierte Regeln“ / „ausblenden“); speichert sofort, „Schließen“. Teil eines Zusatztarifs. | – (keine Regel-Engine) | fehlt | M |
| A43 | Personenregeln überschreiben allgemeine | Admin, Superuser | Je Person Werte ändern und Regeln einzeln an-/abschalten; Abweichung wird in der Liste markiert. | – | fehlt | S |
| A44 | Gewünschte Stunden je Woche/Monat (Ziel) | Admin, Superuser | Auswahl Woche oder Monat + Zahl. Nur für den Assistenten, kein Verstoß bei manueller Planung. Assistent stoppt bei Erreichen, verfehlt eher nach unten; je Zeitraum einzeln, kein Ausgleich über Wochen (dafür Zeitkonto). | Sollstunden je Woche/Monat am Mitglied (`targetHoursPerWeek/Month`), nur in der Auswertung | teilweise | S |
| A45 | Mindest-/Höchststunden („Max./Min. hinzufügen“) | Admin, Superuser | Zusätzliche harte Grenzen zum Ziel; Verstoß auch bei manueller Planung; Assistent überschreitet nie (Minimum nur, wenn genug passende Schichten). Empfehlung Spanne 2–3 h. | – | fehlt | S |
| A46 | Max. Stunden pro Tag | Admin, Superuser | Harte Regel; Assistent lässt lieber eine Schicht offen. Kann mit Ruhezeit kollidieren. | – | fehlt | S |
| A47 | Mindestruhezeit zwischen Schichten | Admin, Superuser | Stunden zwischen Ende und nächstem Beginn, tagübergreifend; harte Regel. Ausnahme bei A48: Lücken ≤ 15 min kein Verstoß, bis das Tagesziel erreicht ist. | – | fehlt | S |
| A48 | Gewünschte Stunden am Stück | Admin, Superuser | Für Folgen kurzer Schichten: Assistent reiht Schichten bis zum Ziel aneinander; als zusammenhängend gilt Lücke ≤ 15 min. | – | fehlt | M |
| A49 | Max. Arbeitstage in Folge | Admin, Superuser | Zahl einschließlich (3 = höchstens 3 Tage am Stück). | – | fehlt | S |
| A50 | Gewünschte Arbeitstage je Woche | Admin, Superuser | Weiches Ziel, eher weniger als mehr; Konflikt mit A49 erzeugt Verstöße. | – | fehlt | S |
| A51 | Arbeitstage zusammenhängend | Admin, Superuser | Mindestens zwei Arbeitstage am Stück; mit A56 kombinieren, damit Blöcke entstehen. | – | fehlt | S |
| A52 | Max. Wochenenden mit Schichten in Folge | Admin, Superuser | Zählt Wochenenden (Sa/So) mit mindestens einer Schicht, einschließlich; Menge der Schichten am Wochenende egal. | – | fehlt | S |
| A53 | Genehmigte Abwesenheit beachten | Admin, Superuser | Ohne Regel: Abwesende in eigener Gruppe der Auswahl, Zuweisung möglich. Mit Regel: Verstoß; Assistent lässt Person aus. Stundenweise Abwesenheit sperrt nur ihr Zeitfenster. | Genehmigte Abwesenheit sperrt immer, nur ganztägig (`assessAssignment`) | anders gelöst | S |
| A54 | Freier Tag je Wochenendschicht | Admin, Superuser | Je Sa/So mit Schicht mindestens ein freier Tag Mo–Fr der Folgewoche (je Tag, nicht je Schicht); Stundenziel hat Vorrang. | – | fehlt | S |
| A55 | Freiwünsche der Planabfrage beachten | Admin, Superuser | Ohne Regel: eigene Gruppe in der Auswahl. Mit Regel: Verstoß; im Assistenten harte Regel. | Eintrag „nicht verfügbar“ sperrt immer (`assessAssignment`) | anders gelöst | S |
| A56 | Freie Tage zusammenhängend | Admin, Superuser | Mindestens zwei freie Tage am Stück. | – | fehlt | S |
| A57 | Von automatischer Planung ausschließen | Admin, Superuser | Ganz oben in den Personenregeln; Person erhält keine Vorschläge (z. B. bereits manuell verplant). | – | fehlt | S |
| A58 | Wochentagsregeln | Admin, Superuser | Je Person Zeitfenster, in denen sie grundsätzlich nicht kann; Tage wählen; gilt jede, gerade oder ungerade Woche; „Wochentagsregel speichern“; mehrere Regeln je Person. | Verfügbarkeit nur je Datum, keine Wiederholung, nur selbst eingetragen (`api/availability/route.ts`, `Availability`) | teilweise | M |
| A59 | Regelverletzungen in der Seitenleiste | Admin, Superuser | Kasten „N Regelverstöße“ mit Aktualisieren und „Anzeigen“; Liste je Person mit Regeltext und Datum, Klick springt zur Stelle; Link „Regeln ansehen“; ohne Verstoß positive Meldung. | – | fehlt | M |
| A60 | Veröffentlichen trotz Regelverstoß | Admin, Superuser | Regelverstöße sind nur Hinweise; Veröffentlichen bleibt möglich (anders als Konflikte, A68). | – (keine Regeln) | fehlt | S |
| A61 | Planabfrage öffnen („Anfragen verwalten“) | Admin, Superuser | Dialog: Nein / Ja, Plan für Wünsche öffnen; „Jede Person muss mindestens [n] Schicht(en) übernehmen“; Nachricht an Mitarbeitende; „Abbrechen“, „Speichern und E-Mail senden“, „Speichern“. Status steht auf der Kachel. | Verfügbarkeit jederzeit selbst eintragen (`src/components/workforce/availability.tsx`); keine Abfrage je Plan, keine Mindestzahl, keine E-Mail | teilweise | M |
| A62 | Wünsche abgeben | Mitarbeiter | Im offenen Plan angeben, wann man nicht arbeiten kann; Hinweis auf der Seite „Dienstpläne“ oder per E-Mail. | Verfügbar/nicht verfügbar je Datum und Uhrzeit (`POST /api/availability`) | vorhanden | S |
| A63 | Rücklaufkontrolle | Admin, Superuser | Anzeige „x von y haben abgegeben“. | – | fehlt | S |
| A64 | Wünsche in der Planung sehen | Admin, Superuser | Person rechts wählen → betroffene Schichten rot, Hinweis beim Überfahren; in der Besetzungsauswahl eigene Gruppe; Zuweisung trotzdem erlaubt. | Auswahlliste mit Grund „Als nicht verfügbar eingetragen“, nicht wählbar (`shiftCandidates`) | anders gelöst | S |
| A65 | „Besetzung vorschlagen“ (Assistent) | Admin, Superuser | Kachel öffnet Dialog „bereit zur Planung“; bei vorhandener Besetzung Kästchen „Meine Änderungen sperren“ (sonst überschrieben); Hinweis: nicht rückgängig zu machen; „Besetzung vorschlagen“ → Ergebnis → „Schließen und Plan ansehen“. Voraussetzung: offene Schichten. | KI-Vorschlag per Sprachmodell, nur Admin, nur mit KI-Freigabe; Vorschläge einzeln/alle übernehmen (`ai-suggest-button.tsx`, `api/ai/suggest-schedule`) | anders gelöst | L |
| A66 | Rechenlogik des Assistenten | System | Ohne Regeln: keine offenen Schichten, Wochenenden und Tageszeiten gerecht, gleiche Stunden für alle; nur passende Position; berücksichtigt Regeln, genehmigte Abwesenheit, Wünsche; harte Regeln nie verletzen, lieber Schicht offen lassen. | Anweisung an das Sprachmodell (`src/lib/ai/auto-planner.ts`); Abwesenheit inkl. beantragter; Prüfung erst beim Übernehmen (`assign`) | teilweise | L |
| A67 | Ergebnisprüfung nach Vorschlag | Admin, Superuser | Regelverstöße erscheinen rechts (A59); danach manuell nacharbeiten. | Score und Begründung je Vorschlag in Seitenleiste | teilweise | S |
| A68 | Konfliktprüfung Überschneidung | System | Hinweis bei Auswahl, wenn Person im Zeitraum schon eingeteilt ist – auch in anderen Plänen; Zuweisung trotzdem möglich, dann „Konflikt“; Plan mit Konflikt lässt sich nicht veröffentlichen. Prüfung gegen die zuletzt veröffentlichte Fassung anderer Pläne. | Harte Sperre bei Zuweisung gegen alle Buchungen der Organisation inkl. Entwürfe, Nachtschicht (`assessAssignment`) | anders gelöst | S |
| A69 | Plan veröffentlichen | Admin, Superuser | Großer Knopf „Plan veröffentlichen“ oben in der Seitenleiste. | „Veröffentlichen“ je Woche mit Rückfrage, Benachrichtigung (`VisibilityToggle`, `api/schedules/[id]`) | vorhanden | S |
| A70 | Veröffentlichungsdialog mit Änderungen | Admin, Superuser | „Änderungen veröffentlichen?“: Kästchen „Betroffene benachrichtigen“; Abschnitte Zeitraum, neue, gelöschte, geänderte Schichten mit Datum, Person, Position, Zeit; grüner Kasten „Keine Konflikte“ oder Konfliktliste; „Prüfen und veröffentlichen“. | Einfache Rückfrage; Benachrichtigung immer; keine Änderungsliste | teilweise | M |
| A71 | Veröffentlichten Plan direkt ändern | Admin, Superuser | „Plan bearbeiten“ oben rechts; kleine Änderungen live: „Neue Schicht“, Tag anklicken, Schicht anklicken; auch in der App (Schicht, Tagesnachricht). | Änderungen sofort wirksam, Benachrichtigung, Bestätigung zurückgesetzt (`updateShift`, `assign`) | vorhanden | S |
| A72 | Plan zurück in die Planung | Admin, Superuser | Größere Änderungen im Planungsmodus: Mitarbeitende sehen weiter die alte Fassung, Tausch/Nachrichten/Bearbeiten gesperrt; Status „Plan wird bearbeitet“ (orange) → erneut veröffentlichen. Stunden in Stunden & Lohn erst danach überschrieben. | „Zurückziehen“ blendet den Plan für Mitarbeitende aus (`VisibilityToggle`) | fehlt | L |
| A73 | Vergangene Pläne bearbeiten | Admin, Superuser | Im Archiv nur veröffentlicht bearbeiten; Tagesübersicht → Schicht ändern; ändert nur Planstunden, Ist-Zeit in Stunden & Lohn; nachträglich Schicht anlegen (vergessenes Stempeln); unveröffentlicht archivierte Pläne sind gesperrt mit Fehlermeldung → bearbeiten und veröffentlichen. | Vergangene Wochen frei bearbeitbar; Plan und Zeiterfassung getrennt (`TimeRecord` ohne Schichtbezug) | vorhanden | S |
| A74 | Drucken / PDF | Admin, Mitarbeiter | Druckersymbol oben rechts im veröffentlichten Plan; sonst Browserdruck; PDF über Druckziel. | Kein Druckknopf, keine Druckansicht | fehlt | S |
| A75 | Echtzeit und eigene Übersicht | alle | Änderungen sofort für alle sichtbar; Mitarbeitende sehen eigene Schichten und Stunden jederzeit. | Socket.IO (`emitToBranch`), Startseite, „Mein Dienstplan“ | vorhanden | S |
| A76 | Schichtsichtbarkeit (Datenschutz) | Admin | Einstellungen › Datenschutz, vier Stufen: alles sichtbar (Standard); Namen verborgen; Namen und Position verborgen (graue Blöcke mit Zeit); nur eigene Schichten plus „N weitere Schichten“. Eigene und offene Schichten immer sichtbar; Admins/Superuser sehen alles; wirkt beim nächsten Öffnen. | Je Person und Standort: „Dienstplan ansehen“ (voll) oder „Offene Schichten“ (eigene + offene ohne Namen) (`src/lib/access.ts`, `visibleFor` in `api/schedules/route.ts`) | teilweise | M |
| A77 | Tagesansicht | alle | Klick auf Tag öffnet Tagesübersicht: Schichten links, rechts „Nachrichten des Tages“ mit Eingabefeld; Admin kann hier Schichten anlegen und Tausche freigeben. | Keine Tagesansicht; Nachrichten mit Schichtbezug im Postfach; Wochen-Briefing (`BriefingButton`) | teilweise | M |
| A78 | Einstellungen Schichttausch | Admin | Einstellungen › Schichttausch: „Tausch braucht Admin-Freigabe“; darunter „Offene Schichten ohne Freigabe“ (nur sichtbar bei Freigabepflicht); „Mitarbeitende dürfen nicht tauschen“; „Einstellungen speichern“. | Freigabe immer Pflicht, kein Schalter (`api/mod-requests/[id]/route.ts`) | fehlt | S |
| A79 | Schicht an bestimmte Person übergeben | Mitarbeiter | Eigene Schicht anklicken → „Schicht übergeben“ → Person wählen (nur passende Position, ohne Schicht im selben Zeitblock) → Empfänger erhält Nachricht, nimmt an/lehnt ab → ggf. Admin. | Abgabe an alle (SWAP, jemand meldet sich) oder Tausch Schicht gegen Schicht mit Zustimmung (EXCHANGE, `TauschAnfragen` in `requests.tsx`); gezielte Übergabe ohne Gegenschicht fehlt | teilweise | S |
| A80 | Schicht verfügbar machen | Mitarbeiter | „Schicht verfügbar machen“: im Plan als abzugeben markiert; geeignete Kollegen übernehmen; bis dahin bleibt die Schicht bei der Person; „Abbrechen“ nimmt das Angebot zurück. | „Zur Übernahme anbieten“ auf der Startseite (`dashboard.tsx`), Angebot nur für Geeignete in „Anträge“, Freiwilliger → Freigabe, „Zurückziehen“; im Plan nicht markiert | teilweise | S |
| A81 | Offene Schicht übernehmen | Mitarbeiter | Offene Schicht antippen → „Verfügbar“ → „Schicht nehmen“; nur mit passender Position und ohne Schicht im selben Zeitblock; Freigabe je nach A78. | „Übernahme anfragen“ auf der Karte (`shift-card.tsx`, TAKEOVER), Prüfung `checkAssignment`, Freigabe immer | vorhanden | S |
| A82 | Eingehende Übergaben unter „Ich“ | Mitarbeiter | „Eingehende Schichten“: annehmen/ablehnen; Anzeige, wessen Zustimmung noch fehlt (Kollege, Admin). Erst nach allen Zustimmungen im Plan. | „Anträge“ mit Zustimmen/Ablehnen und Status „wartet auf Zustimmung/Freigabe“ (`requests.tsx`) | vorhanden | S |
| A83 | Freigabe über Aktivitätszentrum | Admin, Superuser | Glocke oben rechts; Meldung erst, wenn beide Beteiligte zugestimmt haben; zeigt Personen, Schicht, Plan; genehmigen/ablehnen; Bereich „erledigt“ mit Zustimmungen. | Nachricht ins Postfach an Entscheider (`deciders`), Entscheidung unter „Anträge“; keine Glocke | teilweise | M |
| A84 | Tausch-Benachrichtigung filtern | Admin, Superuser | In den eigenen Benachrichtigungseinstellungen: alle Tausche oder nur bestimmte Positionen/Bereiche. | Empfänger = Recht „Anträge bearbeiten“ je Standort; keine eigene Auswahl | teilweise | S |
| A85 | Freigabe im Mitarbeiterprofil | Admin, Superuser | Profil zeigt offene „Eingehende“ und „Ausgehende Schichten“ inkl. Übernahme offener Schichten; dort freigeben/ablehnen. | – | fehlt | S |
| A86 | Freigabe im Plan | Admin, Superuser | Tagesansicht: „Tausch wartet auf Admin-Freigabe“ → Bearbeitungsleiste „Genehmigen“/„Ablehnen“. | Stern-Zähler auf der Schichtkarte mit Liste „Annehmen“/„Ablehnen“ (`WishCountBadge` in `wish-plan.tsx`) | vorhanden | S |
| A87 | Freigabe in der App | Admin, Superuser | Aktivitäten → „Anfragen“ zeigt wartende Freigaben. | Web-App, Seite „Anträge“ mobil | vorhanden | S |
| A88 | Tauschverlauf | Admin | Einstellungen › Schichttausch unten: Filter Mitarbeiter, Position, Zeitraum; Spalten Von, An, Schichtdatum, Zeit, Position, Standort, Genehmigt von, Datum. | Antragsliste mit Status und Begründung, höchstens 250, ohne Filter und ohne „genehmigt von“ (`GET /api/mod-requests`) | teilweise | S |
| A89 | Tausch durch Admin | Admin | Admin führt Tausch selbst aus = sofort bestätigt, im Verlauf „genehmigt von: Admin“. | Admin besetzt direkt um (Zuweisung lösen/neu), kein Verlaufseintrag | teilweise | S |
| A90 | Tausch nur im veröffentlichten Plan | System | Im Planungsmodus gesperrt (A72). | Nur veröffentlichte, künftige Schichten (`exchangeProblems`, `isFuture` in `src/lib/shift-requests.ts`) | vorhanden | S |
| A91 | Superuser mit Tauschrecht | Superuser | Superuser mit Recht „Tausch verwalten“ entscheiden, ohne Zugriff auf Einstellungen. | Manager mit „Anträge und Schichtübernahmen bearbeiten“ je Standort, keine Selbstgenehmigung (`canDecide`) | vorhanden | S |
| A92 | Arbeiten ohne Plan (Stempeluhr legt Schicht an) | Mitarbeiter | Mitarbeitende erfassen Zeiten per Stempeluhr ohne vorher geplante Schicht; sichtbar in Stempeluhr und Stunden & Lohn. | Stoppuhr/Zeiterfassung ohne Schichtbezug (`api/time/watch`, `TimeRecord`) | vorhanden | S |
| A93 | Vergabe „Wer zuerst kommt“ | Admin, Mitarbeiter | Planungsansatz mit freien Schichten, die Mitarbeitende selbst nehmen (Artikeltext leer, im Konto prüfen). | Live-Modus mit Tagen, Frist, Protokoll; Buchung läuft über Antrag + Freigabe (`api/live/route.ts`, `api/live/book/route.ts`, `live-mode.tsx`) | teilweise | M |

### Layout und Bedienung

**Hauptnavigation (alle Bildschirme)**
- Smartplan: waagerechte Leiste oben: Logo, Konto-/Standortauswahl (Aufklappliste), Menü Dienstpläne, Mitarbeiter, Nachrichten, Abwesenheit, Stunden & Lohn, Ich, Einstellungen (Aufklappliste), Glocke ganz rechts. Hilfe-Knopf unten rechts.
- Unterschied: Schichtplaner hat linke Seitenleiste mit Gruppen (Arbeit, Personal, Organisation) und untere Leiste auf dem Handy (`src/components/layout/nav-config.ts`); keine Glocke, Mitteilungen im Postfach.

**Planungswerkzeug (Entwurf) – Screenshots A02, A06, A08, A04**
- Aufbau: Zentrierter Titel „Plan erstellen für: Standort“ + Link „Standort wechseln“. Darunter eine Reihe gleich großer Kacheln: Zeitraum (Von–Bis), Anfragen verwalten (mit Status), Besetzung vorschlagen, Regeln einrichten, Neuer Mitarbeiter.
- Reiter „Dienstplan“ / „Vorlage“ + Link zu einem Erklärvideo.
- Filterleiste: „Anzeigen: Alle Schichten / Offene Schichten“ + Farblegende der Positionen; rechts Knopf „Anzeigen“ (Auge).
- Wochenblöcke untereinander über den ganzen Zeitraum; Wochenkopf mit „Woche kopieren“ und „Namen entfernen“; 7 Spalten mit Tag und Datum; „Schichten hinzufügen“ oben in jeder Spalte und unter jedem Zeitblock.
- Rechte Seitenleiste (ca. ein Fünftel): Regelverstöße-Kasten (Anzahl, Aktualisieren, Anzeigen, Liste mit Sprunglinks), großer Knopf „Plan veröffentlichen“ bzw. orange Statusleiste „Plan wird bearbeitet“ mit Aufklappmenü, Personenauswahl „Anzeigen: alle / Person“, „Planübersicht“ (offene Schichten, vergebene Stunden), „Stunden je Mitarbeiter“ je Woche; nach Personenwahl Status, Kopiersymbol mit Name und Stunden, Stunden je Woche und Position.
- Kopiermodus: gestrichelte Leiste „Element loslassen“ über der Seitenleiste; Ziele färben sich beim Überfahren; besetzte Schichten der gewählten Person hellblau, unpassende Zeilen ausgegraut; Konflikt als roter Hinweis direkt an der Zeile.
- Benutzerfreundlich: alles auf einem Bildschirm; Seitenleiste gibt laufend Rückmeldung (Stunden, Verstöße); Besetzen per Klick ohne Dialog; Esc beendet jeden Modus; Symbole erscheinen erst beim Überfahren (ruhiges Bild).
- Unterschied: Schichtplaner zeigt eine Woche je Seite mit dreizeiligem Kopf (Kunde/Standort + Ansichtsumschalter; KW-Blättern; Status, Kennzahlen, „Schicht hinzufügen“, „Veröffentlichen“, Menü „…“ mit Darstellung, klassischer Tabelle, Briefing, Live-Modus, KI, CSV) (`schedule-toolbar.tsx`). Keine rechte Seitenleiste; Personenleiste über dem Board (`employee-nav.tsx`). Monats- und Mitarbeiteransicht zusätzlich (`view-switcher.tsx`).

**Veröffentlichter Plan – Screenshot A01**
- Filterleiste „Anzeigen: Alle / Offene / Meine Schichten“ + Positionslegende; Wochenüberschrift groß und unterstrichen; Spaltenkopf Tag fett, Datum grau; rote Zeile „N abwesend ▾“ je Tag; grauer Zeitblock-Kopf, darunter Namen mit Positionspunkt; „Keine Schichten“ zentriert.
- Unterschied: Schichtplaner nutzt Karten je Schicht mit Statusmarke („x offen“/„besetzt“), Rahmenfarbe für offene, gestrichelt für unbestätigte (`shift-card.tsx`); keine Abwesendenzeile.

**Schichtdialog – Screenshot A03**
- Kleines Fenster direkt am Tag (mit Zeiger), nicht seitlich. Oben links große Felder Beginn/Ende, rechts „Schließdienst“ (Kästchen) und „Pause“ (Auswahl). Darunter Tabelle „Schichten mit diesen Zeiten“: Position (Farbpunkt + Auswahl), Mitarbeiter (Auswahl, Vorgabe „Unbesetzte Schicht“), Notiz; „+ Weitere Schicht hinzufügen“. Fußleiste „Abbrechen“ links, „Erstellen“ rechts in Hauptfarbe.
- Benutzerfreundlich: ein Zeitblock mit mehreren Positionen und Besetzung in einem Schritt.
- Unterschied: Schichtplaner öffnet rechte Seitenleiste mit Formularraster (Beginn, Ende, Einsatzort, Arbeitsbereich, Tätigkeit, Benötigte, Pause, Pausenregel, Wochentage, Wiederholen, Qualifikationen, Hinweise) und „Kopieren auf Datum“ (`shift-form.tsx`); Besetzung erst danach auf der Karte.

**Regeldialog – Screenshot A05**
- Großes Fenster „Regeln für die automatische Planung“. Links: Suchfeld, „Allgemeine Einstellungen“ (Zahnrad, markiert), Personen mit Initialen-Kreis, rot „Regeln weichen ab“. Rechts: Hinweis zum Tarif, Erklärtext, je Gruppe eine Tabelle: Kästchen | Regeltext (ggf. Auswahl Woche/Monat, Knöpfe „Max.“/„Min.“, Marke „NEU“) | Wert als große Zahl in hellgrüner Zelle zum Anklicken. Unter jeder Gruppe „N deaktivierte Regeln“. Unten links „Schließen“.
- Benutzerfreundlich: speichert sofort; deaktivierte Regeln eingeklappt; Abweichungen je Person auf einen Blick.

**Assistent – Screenshot A07**
- Fenster „Bereit, die Planung zu übernehmen“; Erklärung; Kästchen „Meine Änderungen sperren“ (vorausgewählt); fett: Vorschlag nicht rückgängig zu machen. Fußleiste „Schließen“ | „Besetzung vorschlagen“. Danach Abschluss mit „Schließen und Plan ansehen“; Ergebnis direkt im Plan, Verstöße rechts.
- Unterschied: Schichtplaner zeigt Vorschläge als Liste in einer Seitenleiste mit Bewertung („Sehr gut“ … „Niedrig“) und Einzel-/Gesamtübernahme; Plan bleibt bis zur Übernahme unverändert (`ai-suggest-button.tsx`).

**Planabfrage – Screenshot A09**
- Fenster „Anfragen für den Plan“: Erklärtext, zwei Optionsknöpfe (Nein / Ja), Satz mit Zahlenfeld für Mindestschichten, Textfeld „Nachricht an Mitarbeitende“, Fußleiste „Abbrechen“ | „Speichern und E-Mail senden“ | „Speichern“ (Hauptfarbe).
- Unterschied: Schichtplaner hat keine Abfrage je Plan; Mitarbeitende pflegen Verfügbarkeit unter „Anträge“ (`availability.tsx`).

**Veröffentlichen – Screenshot A10**
- Schmales Fenster: oben Kästchen „Betroffene benachrichtigen“ (grau hinterlegt), dann Abschnitte Zeitraum, neue, gelöschte, geänderte Schichten als Aufzählung, unten grüner Kasten mit Haken „Keine Konflikte“; „Abbrechen“ | „Prüfen und veröffentlichen“.
- Unterschied: Schichtplaner fragt nur „KW xx veröffentlichen?“ (`VisibilityToggle` in `schedule-options.tsx`).

**Tagesansicht Mitarbeiter / Tausch – Screenshot A11**
- Zweigeteilt: links Zeitblock-Kopf und eigene Schicht (Initialen, Name, Position) mit zwei Knöpfen „Schicht übergeben“ | „Schicht verfügbar machen“; rechts „Nachrichten des Tages“ mit Leerzustand und Eingabezeile „Nachricht senden“.
- App: Schicht antippen → „Übergeben“ oben rechts → Person per Pfeil wählen → „OK“ → „Schicht übergeben“; danach Statuszeile, wer noch zustimmen muss.
- Unterschied: Schichtplaner hat keine Tagesansicht; Abgabe auf der Startseite, Tausch und Entscheidungen unter „Anträge“ (`dashboard.tsx`, `requests.tsx`), Freigabe im Plan per Stern-Zähler (`wish-plan.tsx`).

**Tauschverlauf – Screenshot A12**
- Überschrift, darunter drei Filter in einer Reihe (Mitarbeiter, Positionen, „Zeitraum festlegen“), dann Tabelle mit acht Spalten; neueste oben.
- Unterschied: Schichtplaner zeigt Anträge als Karten ohne Filter.

### Regeln und Grenzfälle

- **Überschneidung (Konflikt):** Person hat im selben Zeitraum schon eine Schicht, auch in einem anderen Plan. Smartplan warnt, lässt zu, sperrt aber das Veröffentlichen. Andere Pläne zählen mit ihrer zuletzt veröffentlichten Fassung; Änderungen im Entwurf eines anderen Plans wirken erst nach dessen Veröffentlichung. Folge: zwei Pläne können sich gegenseitig blockieren; Lösung über die Reihenfolge (Person entfernen, einen Plan veröffentlichen, dann den anderen). Schichtplaner: harte Sperre schon bei der Zuweisung, gegen alle Buchungen inkl. Entwürfe, Nachtschichten über Mitternacht berücksichtigt – keine Blockade möglich.
- **Regelverstoß ≠ Konflikt:** Regelverstöße sind Hinweise, Veröffentlichen bleibt erlaubt.
- **Harte Regeln des Assistenten:** Min./Max.-Stunden, Max. Stunden je Tag, Mindestruhezeit, Freiwünsche. Lieber Schicht offen lassen als verletzen. **Weiche Ziele:** Stunden je Woche/Monat, Arbeitstage je Woche – eher unterschritten; Ziel je Zeitraum einzeln, kein Ausgleich über Wochen.
- **Standardverteilung ohne Regeln:** keine offenen Schichten, Wochenenden und Tageszeiten gerecht, gleiche Stunden für alle. Nur Personen mit passender Position.
- **Ruhezeit:** tagübergreifend gerechnet (Ende 23:00, Beginn 06:00 am Folgetag = Verstoß); Vorschlag 11 h (entspricht § 5 ArbZG); 11 h führt meist zu einer Schicht je Tag.
- **Kurzschichten:** Lücken ≤ 15 min gelten als zusammenhängend; > 15 min löst die Ruhezeitregel aus und beendet die Reihung.
- **Zählweisen:** Max. Tage in Folge und Max. Wochenenden in Folge einschließlich; Wochenende = Samstag und Sonntag; Anzahl Schichten am Wochenende egal.
- **Freier Tag je Wochenendschicht:** je gearbeitetem Wochenendtag ein freier Tag Mo–Fr der Folgewoche; Stundenziel hat Vorrang.
- **Zusammenhängend:** mindestens zwei Tage; nur beide Regeln (Arbeit + frei) zusammen ergeben Blöcke.
- **Abwesenheit:** genehmigt = vom Admin bestätigt oder angelegt; stundenweise Abwesenheit sperrt nur ihr Zeitfenster. Ohne Regel nur eigene Gruppe in der Auswahl. Schichtplaner: nur ganztägig, immer harte Sperre.
- **Wochentagsregeln:** jede, gerade oder ungerade Kalenderwoche.
- **Höchststunden je Woche:** nur über Max.-Grenze der Stundenregel; Max. je Tag separat.
- **Vorlage:** Planänderungen haben Vorrang vor späteren Vorlagenänderungen; neue Vorlagenschichten werden immer ergänzt und können Doppelbelegung erzeugen; „Zurücksetzen“ überschreibt den ganzen Tag; Import überschreibt die aktuelle Vorlage; Personen fremder Standorte fallen beim Import heraus.
- **Planumfang:** höchstens 32 Wochen je Plan.
- **Bearbeitungsmodus:** Mitarbeitende sehen die alte Fassung; Stunden in „Stunden & Lohn“ werden erst bei erneuter Veröffentlichung überschrieben; Tausch und Tagesnachrichten gesperrt.
- **Vergangene Pläne:** nur veröffentlicht bearbeiten; Änderung betrifft nur Planstunden, Ist-Zeiten bleiben in „Stunden & Lohn“.
- **Tausch:** Verantwortung bleibt bis zur Übernahme; Kandidaten nur mit passender Position und ohne Schicht im selben Zeitblock; Admin wird erst nach Zustimmung beider benachrichtigt; im Plan erst nach allen Zustimmungen; Admin-Tausch sofort gültig.
- **Sichtbarkeit:** eigene und offene Schichten sowie die Anzahl fremder Schichten bleiben immer sichtbar; Admins/Superuser sehen alles.
- **Pause:** unbezahlte Pause je Zeitblock; bezahlte Pause nicht beschrieben.
- **Nachtschichten, Zeitumstellung, Feiertage:** in den Artikeln nicht behandelt (nur Beispiel 22:00–24:00). Schichtplaner: Schichten über Mitternacht und Zeitumstellung in Europe/Berlin gelöst (`src/lib/berlin.ts`, `lastShiftDate`); Feiertage berechnet (`src/lib/holidays.ts`), im Dienstplan aber nicht angezeigt.

### Offen für die Erfassung im Konto

- „Schließdienst“: Wirkung auf Anzeige (offenes Ende?), Stunden und Zeiterfassung.
- Pausenauswahl: verfügbare Werte, bezahlte Pause, Pause je Stunde.
- „Namen entfernen“ (Wochenkopf) und Knopf „Anzeigen“ (Auge): genaue Wirkung und Optionen.
- Kopieren: werden Besetzungen mitkopiert (Zeitblock, Tag, Woche, Folgeplan)? Kopieren über Plangrenzen?
- Plan anlegen: Ablauf „Neuer Plan“, Plan-Name, mehrere Pläne je Standort, überlappende Zeiträume, Startdatum mitten in einer Vorlagenwoche.
- Schichten über Mitternacht: Darstellung, Tageszuordnung, Ruhezeit- und Tagesstundenberechnung; Verhalten bei Zeitumstellung.
- Feiertage im Plan: Anzeige, Regeln, Zuschläge.
- Genaue Meldungstexte und vollständige Liste der Verstoßarten (Seitenleiste, Veröffentlichungsdialog).
- Assistent: Laufzeit/Fortschritt, Verhalten bei unlösbaren Vorgaben, Umgang mit mehreren Standorten/Plänen, Pflicht der Position, Tarifgrenze („Plus“).
- Planabfrage aus Sicht der Mitarbeitenden (Artikel liegt in anderer Kategorie): Eingabeform, Frist, Erinnerung, Prüfung der Mindestschichten.
- Planungsansätze „Automatisierer“, „Wer zuerst kommt“, „Laissez-faire“: Abschnitte im Artikel leer.
- Tausch: Frist vor Schichtbeginn, Begründung bei Ablehnung, mehrere Interessenten an einer verfügbaren Schicht, Tausch über Standorte, echte Tauschpaare (Schicht gegen Schicht), Benachrichtigungstexte, Bereich „erledigt“ im Aktivitätszentrum.
- Benachrichtigungseinstellungen für Tausch je Position/Bereich: Felder und Vorgaben.
- Superuser: welche Planungsrechte einzeln vergeben werden (Planen, Veröffentlichen, Regeln, Vorlagen, Tausch) und je Standort.
- Druckansicht und PDF-Inhalt; Export des Plans (Excel?).
- Tagesansicht als Admin (Abwesende, Nachrichten, Bearbeitungsleiste) und Planansicht in der App.
- Sichtbarkeit von Abwesenheiten (eigene Einstellung) und ob die Abwesendenzeile für Mitarbeitende erscheint.
- Benachrichtigung bei Veröffentlichung: Kanal (E-Mail, Push), Inhalt, wer als „betroffen“ gilt.
- Stunden in der Seitenleiste: brutto oder abzüglich Pause.
- Position bei Schicht Pflicht oder optional; Schicht ohne Position.
