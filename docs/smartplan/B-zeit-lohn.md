## Zeit und Lohn (Stempeluhr, Stunden und Lohn, Zeitkonten)

Quellen: Smartplan-Hilfe, Kategorien 170 (Stempeluhr, 6 Artikel), 172 (Stunden und Lohn, 9 Artikel), 173 (Zeitkonten, 5 Artikel), ergänzend 240/368 (Stempeluhr für Mitarbeitende), 624 (Zeitumstellung), 188 (Abwesenheit genehmigen), 395 (Superuser-Rechte), 217 (Preise). 21 Screenshots angesehen (Nummern B01–B21 im Text; Bilder nicht im Repo).
Code geprüft: Stand `88c21eb`. Pfade relativ zu `src/`, sofern nicht anders angegeben.

### Funktionen

Aufwand „–“: nichts zu tun.

| Nr | Funktion in Smartplan | Rolle | Details und Regeln | Schichtplaner heute (Datei-Verweis) | Status | Aufwand |
|---|---|---|---|---|---|---|
| B1 | Stempeluhr: freischalten, Weg wählen | Admin | Einstellungen „Stempeluhr und Zeiterfassung“ (Tarif-Kennzeichen). Schalter „Zugang zur Stempeluhr“. Zwei Wege: Gerät am Arbeitsplatz oder Handy-App mit GPS-Bereichen. Daneben „Stempeluhr öffnen“ und ein aufklappbarer Block mit den Einstellungen. Alle Einstellungen gelten für das ganze Konto, nicht je Standort oder Person. | GPS je Einsatzort (`Branch.gpsCheckinRequired`, `components/workforce/locations.tsx`). Die Stoppuhr ist immer verfügbar. `TimeSettings.whoCanUse`, `watchAutoStop` und `warningsMaxHours` werden gespeichert, aber nirgends angewandt (`app/api/settings/route.ts`). | teilweise | S |
| B2 | Einstellung: erwartetes Ende bei ungeplanter Schicht | Admin | Ja/Nein. Bei Ja gibt die Person beim Anlegen einer ungeplanten Schicht ein voraussichtliches Ende an. Es steht im Aktivitätsprotokoll und dient als Ersatz, falls das Ausstempeln vergessen wird. Das echte Ausstempeln überschreibt es. | Fehlt, weil es keine ungeplanten Schichten gibt. | fehlt | S |
| B3 | Einstellung: Pausenerfassung | Admin | Drei Modi: (a) Der Admin gibt die Pause in der Schicht vor, sie wird automatisch abgezogen, keine Eingabe. (b) Die Pausendauer wird beim Ausstempeln aus einer Liste gewählt. (c) Die Pause wird während der Schicht ein- und ausgestempelt. Bezahlte Pausen nicht erfassen, weil erfasste Pausen von der Anwesenheit abgezogen werden. | Plan-Pause je Schicht (`Shift.pauseOption`/`pauseValue`) wirkt nur auf die Planstunden. Beim Ist gibt es nur Modus (c) über die Stoppuhr (`app/api/time/watch/route.ts`). Keine Wahl; die Plan-Pause wird von gestempelten Zeiten nicht abgezogen. | teilweise | M |
| B4 | Einstellung: Einstempeln vor Schichtbeginn | Admin | Legt fest, ob frühes Einstempeln ab Stempelzeit oder ab geplantem Beginn zählt. Die genauen Optionen stehen nicht in den Artikeln. | Zeit zählt ab Check-in; Check-in ab 30 Min. vor Beginn (`lib/checkin.ts` `WINDOW_BEFORE_MIN`). Keine Einstellung. | fehlt | S |
| B5 | Einstellung: Ausstempeln nach Planende | Admin | Legt fest, wie Zeit nach dem geplanten Ende zählt. Optionen nicht beschrieben. | Die Stoppuhr zählt bis „Auschecken“. Keine Einstellung. | fehlt | S |
| B6 | Einstellung: Folgen bei fehlendem Einstempeln | Admin | Z. B. Person als nicht erschienen bzw. abwesend markieren. Ausnahmeliste für einzelne Mitarbeitende. | Nicht-Erscheinen wird nicht erkannt. Die Übersicht zeigt nur erfolgte Check-ins (`components/workforce/checkins.tsx`). | fehlt | M |
| B7 | Einstellung: Zeiterfassungen automatisch genehmigen | Admin | Ja/Nein. Bei Ja gelten Stempelzeiten ohne Prüfung als genehmigt. | Zeitbuchungen haben keinen Genehmigungsstatus (`prisma/schema.prisma` `TimeRecord`). | fehlt | S |
| B8 | Einstellung: Mitarbeitende dürfen eigene Zeiten bearbeiten | Admin | Unabhängig von der Stempeluhr. Betrifft nur die Ist-Zeit einer Schicht, nicht die Planschicht. Änderungen gehen in die Genehmigung (B38). | Korrekturantrag ist immer erlaubt (`app/api/time/[id]/route.ts`). Neue manuelle Buchungen für sich selbst sind immer möglich und sofort wirksam, ohne Freigabe (`app/api/time/route.ts` POST). Kein Schalter. | teilweise | S |
| B9 | Gerät: Stempeluhr öffnen mit Link und Gerätecode | Admin | Dialog in drei Schritten: Link auf dem Gerät öffnen; 6-stelligen Gerätecode eingeben (kennen nur Admins, „Code ändern“ und Speichern); Hinweis auf den persönlichen 4-stelligen Code. Danach bleibt das Gerät als Stempeluhr angemeldet. Hilfe für Schnellzugriff: Lesezeichen, Desktop- oder Startbildschirm-Verknüpfung, Browser-Startseite. | – | fehlt | M |
| B10 | Gerät: Links je Standort | Admin | Bei aufgeteilten Standorten gibt es je Standort einen eigenen Link, der nur dessen Mitglieder und Aktivität zeigt. Ein Gerätecode gilt für alle. Ist die Sichtbarkeit auf die eigenen Standorte beschränkt, wird der Gesamtlink gesperrt. | – | fehlt | S |
| B11 | Gerät: Startseite | Mitarbeiter | Kopfleiste: Namenssuche, große Uhrzeit mit Datum, Beenden-Symbol. Links „Heutige Mitarbeitende“ (mit Schicht heute), darunter „Alle Mitarbeitenden“ mit Avatar oder Initialen, Name und ggf. Telefon. Rechts „Heutige Aktivität“ in zeitlicher Reihenfolge: Name, ein-/ausgestempelt, Pause, Uhrzeit. Die Aktivität sieht jeder am Gerät. | – | fehlt | M |
| B12 | Gerät: persönlicher 4-stelliger Code | Mitarbeiter | Nach Klick auf den eigenen Namen erscheint ein Ziffernblock. Ein Link darunter schickt den Code per E-Mail. Der Code steht auch oben im eigenen Profil. | Fehlt: keine PIN, kein E-Mail-Versand. | fehlt | M |
| B13 | Gerät: in geplante Schicht einstempeln | Mitarbeiter | Name → Code → Schicht wählen (bei mehreren) → „Einstempeln“ → zurück zur Startseite; der Eintrag erscheint rechts. | Check-in nur am eigenen Gerät nach Anmeldung (`components/workforce/checkins.tsx` `EigenerCheckin`). | fehlt | M |
| B14 | Gerät: Pause | Mitarbeiter | Je nach Pausenmodus (B3): erneut Name und Code, dann „Pause beginnen“ bzw. „Zurück aus der Pause“. | – | fehlt | S |
| B15 | Gerät: ausstempeln mit Kommentar und Pausendauer | Mitarbeiter | Name und Code → „Ausstempeln“. Folgeseite: Pausendauer aus einer Liste (je nach Modus) und Kommentar, beide freiwillig. Der Kommentar ist nur für Admins sichtbar und für Abweichungen vom Plan gedacht. | – | fehlt | S |
| B16 | Gerät: ungeplante Schicht anlegen und einstempeln | Mitarbeiter | Name und Code → „Schicht anlegen und einstempeln“ → Position → Standort (nur beim Gesamtlink) → ggf. erwartetes Ende → Zusammenfassung → Einstempeln. Kein aktiver Plan nötig; der Admin genehmigt die Schicht später. | – | fehlt | M |
| B17 | App: GPS-Bereiche verwalten | Admin | Häkchen „Mitarbeitende dürfen per Handy in folgenden Bereichen stempeln“ und „Bereich hinzufügen“. Felder: Name, Adresse (Suche) oder aktueller Standort per Pfeil. Karte mit Zoom; der Kreis lässt sich an Ziehpunkten vergrößern. Beliebig viele Bereiche. | Je Einsatzort Breiten- und Längengrad als Text, Knopf „aktueller Standort“, Radius 10–1000 m (`components/workforce/locations.tsx`, `app/api/branches`). Keine Karte, keine Adresssuche. | teilweise | M |
| B18 | App: welcher Bereich für welche Schicht | Mitarbeiter | Laut Artikel darf einstempeln, wer in irgendeinem Bereich des Kontos ist. Eine Bindung an den Standort der Schicht ist nicht beschrieben. | Nur im Radius des Einsatzorts der eigenen Schicht (`lib/checkin.ts` `evaluatePosition`). | anders gelöst | S |
| B19 | App: Positionsprüfung beim Einstempeln | Mitarbeiter | Die App fragt nur nach GPS, wenn die Funktion aktiv ist, und ortet nur bei geöffneter App. Geprüft wird genau beim Tippen auf „Einstempeln“; früher im Bereich gewesen zu sein reicht nicht. Außerhalb ist kein Einstempeln möglich; eine Ausweichlösung ist nicht beschrieben. | Der Server prüft beim Klick: Entfernung, Genauigkeit höchstens 50 m, Position höchstens 120 s alt. Außerhalb Antwort 422 mit Grund. Zusätzlich: manueller Freigabeantrag mit Begründung (`app/api/checkin/route.ts`, `app/api/checkin/[id]/route.ts`). | vorhanden | – |
| B20 | App: Ausstempeln nur im Bereich | Mitarbeiter | Laut Artikel gilt die Bereichsprüfung für Ein- und Ausstempeln. | „Auschecken“ ohne Positionsprüfung (`app/api/time/watch/route.ts` STOP). | fehlt | S |
| B21 | App: GPS-Position speichern und anzeigen | Admin | Hinweis in den Einstellungen: Die genaue Position beim Stempeln wird gespeichert und in „Stunden und Lohn“ angezeigt. | Bewusst ohne Koordinaten; gespeichert werden nur Entfernung, Genauigkeit und Alter (`Checkin`). Anzeige in „Check-ins heute“ auf der Startseite. | anders gelöst | S |
| B22 | App: Stempeln, Laufzeit, Pause, Ausstempeln | Mitarbeiter | Schicht antippen → Karte mit oranger Bereichsgrenze und eigener Position → „Einstempeln“. Danach steht unter „Ich“ die Laufzeit seit dem Einstempeln. Erneut antippen → „Pause aktivieren“ oder „Ausstempeln“; die Einstempelzeit steht unten. | Startseite „Check-in“ zeigt Schicht, „Jetzt einchecken“, Pünktlichkeit, Laufzeit, Pause/Fortsetzen/Auschecken. Keine Karte; Web-App statt Store-App (`components/workforce/checkins.tsx`). | teilweise | S |
| B23 | App: ungeplante Schicht anlegen und einstempeln | Mitarbeiter | „Ich“ → Stempeluhr-Symbol oben rechts → „Schicht anlegen und einstempeln“: Standort, Position, ggf. erwartetes Ende. Die GPS-Pflicht gilt. Die Schicht erscheint unter „Schichten“ mit Laufzeit; der Admin genehmigt sie in „Stunden und Lohn“. | Stoppuhr ohne Schicht ist möglich, aber ohne GPS, ohne Schicht und ohne Position. Den Standort setzt erst der Stopp per Überschneidungsregel (`app/api/time/watch/route.ts`, `lib/time-service.ts` `branchForTime`). | teilweise | M |
| B24 | Live-Übersicht „Smartplan Time“ | Admin, Superuser | Eigener Hauptmenüpunkt. Kopf mit Erklärung und Knöpfen zu „Stunden und Lohn“ und „Einstellungen“. Abschnitt „Erfassungen der letzten 24 Stunden“ je Standort mit Link „Stempeluhr öffnen“. Zeigt heute begonnene Schichten; je Standort „Schichten von gestern zeigen“. | Abschnitt „Check-ins heute“ auf der Startseite. Er enthält nur GPS- und manuelle Check-ins, keine Stoppuhr ohne Check-in und keine manuellen Buchungen (`components/workforce/checkins.tsx` `CheckinUebersicht`, `app/api/checkin/route.ts` view=team). | teilweise | M |
| B25 | Live-Übersicht: Karte je Erfassung | Admin | Avatar, Name, Position mit Farbpunkt, Planzeit oder „nicht geplant“, Chip mit Einstempelzeit, Chip mit Ausstempelzeit. Kaffeekanne = Pause, Sprechblase = Kommentar. Weiß = läuft noch, lila = ausgestempelt. | Zeile mit Name, Pünktlichkeit, Standort, Schichtzeit, GPS-Zeit, Entfernung, Genauigkeit. Ohne Ausstempelzeit, ohne Hinweis auf Pause oder Kommentar. | teilweise | S |
| B26 | Live-Übersicht: Filter und Aktualisieren | Admin | Häkchen „beendete Schichten zeigen“; ohne Häkchen erscheinen nur Personen, die gerade arbeiten. Dazu ein Knopf „Aktualisieren“. | Lädt alle 30 s neu; kein Filter. | teilweise | S |
| B27 | Live-Übersicht: Zahnrad zum Genehmigen oder Bearbeiten | Admin | Öffnet denselben Bearbeiten-Dialog wie „Stunden und Lohn“ (B36) oder genehmigt direkt. | Nur manuelle Check-in-Anträge lassen sich hier freigeben. Bearbeiten geht nur als Korrekturantrag unter Zeiterfassung. | fehlt | S |
| B28 | Stunden und Lohn: Zeitraum wählen | Admin, Superuser | „Datum wählen“: ganzer Monat per Klick auf den Monatsnamen oder freier Zeitraum Von–Bis. Die Überschrift zeigt den Zeitraum ausgeschrieben. Künftige Zeiträume sind erlaubt (Prognose). | Nur Kalendermonat mit Vor/Zurück (`components/reporting/hours-table.tsx`, `lib/report.ts` `monthlyReport`). | teilweise | M |
| B29 | Stunden und Lohn: Pläne auswählen | Admin | „Stunden aus gewählten Plänen zeigen“ schließt einzelne Dienstpläne aus der Abfrage und dem Lohnexport aus. | Filter auf einen Standort oder alle. | teilweise | S |
| B30 | Stunden und Lohn: Planstunden | Admin | Summe der Schichten aus veröffentlichten Plänen im Zeitraum, Pausen abgezogen. | Veröffentlichte Einteilungen abzüglich Pause, je Schicht oder je volle Stunde (`lib/report.ts`). | vorhanden | – |
| B31 | Stunden und Lohn: Tabelle je Person | Admin | Spalten: Name (aufklappbar), Planstunden, Stunden nach Änderungen (beide mit „Pausen abgezogen“), Saldo (optional), Lohn (optional), Genehmigt. Darunter Link „Wie funktioniert Stunden und Lohn?“. | Auswertung: Name, Ist je Kalenderwoche, Gesamt, Plan, Soll (Monat), Ist − Plan; Suche und Sortierung; nicht aufklappbar. | teilweise | M |
| B32 | Stunden und Lohn: Farben für Abweichungen | Admin | Ist-Wert rot: ungenehmigte Änderung oder Abweichung vom Plan, auch Stempeln ohne Planschicht. Grün: geändert und genehmigt. | – | fehlt | S |
| B33 | Stunden und Lohn: Seitenleiste mit Kennzahlen | Admin | Ist- und Planstunden gesamt; Abweichung in Stunden und Prozent; Lohnkosten des Zeitraums mit Link „Einrichten“; Listen, wer länger blieb und wer früher ging. | Gesamtzeile und Summen je Kalenderwoche. Keine Abweichung in Prozent, keine Kosten, keine Listen. | teilweise | M |
| B34 | Stunden und Lohn: Schichtliste je Person | Admin | Aufgeklappt je Schicht: Datum, Position mit Standort, Planzeit mit Pause, geänderte Anwesenheit (Link) mit Pause und Kommentar-Symbol, Ist-Stunden als Dezimalzahl, Lohn, „Änderungen behandeln“. | Zeiterfassung zeigt Buchungen je Person nach Woche und Tag mit Zeit, Standort, Kategorie und Kommentar. Kein Vergleich mit der Planschicht; die Pause wird nicht angezeigt (`components/time/time-list.tsx`). | teilweise | L |
| B35 | Stunden und Lohn: Ist gleich Plan, solange nichts geändert ist | Admin | Ohne Stempelung oder Korrektur gilt die Planschicht als geleistet. Stempelzeiten fließen direkt in „Stunden nach Änderungen“. Eine ungeplante Stempelschicht zählt erst nach dem Ausstempeln. | Ist entsteht nur aus Zeitbuchungen; ohne Buchung 0 h. Die Buchung ist nicht mit der Schicht verknüpft, außer beim GPS-Check-in über `Checkin.timeRecordId`. | anders gelöst | L |
| B36 | Anwesenheit bearbeiten (Dialog) | Admin, Mitarbeiter | Titel mit Person, Datum und Planzeit; Hinweis „laut Plan ursprünglich von … bis …“. Felder: Beginn und Ende (Auswahl in 15-Minuten-Schritten). „Pausen in der Schicht“ je Pause mit Von–Bis und Dauer, „Pause entfernen“, „+ Pause hinzufügen“. Erklärung („Warum?“). Häkchen „hat die Schicht nicht wahrgenommen“: Schicht bleibt sichtbar, zählt 0 h. Darunter das Aktivitätsprotokoll; Schließen/Speichern. | Formular mit Von/Bis oder Dauer, Pause als Minutensumme, Kategorie, Kommentar und Begründung bei Korrektur (`components/time/time-record-form.tsx`). Kein „nicht erschienen“, keine Pausen mit Uhrzeit. | teilweise | M |
| B37 | Korrektur durch Admin sofort wirksam | Admin | Ändert ein Admin die Anwesenheit, gilt das als genehmigt und wird protokolliert. | Jede Änderung einer Buchung ist ein Korrekturantrag, auch bei Admins. Danach muss jemand separat genehmigen (`app/api/time/[id]/route.ts`, `app/api/time/corrections/route.ts`). | teilweise | S |
| B38 | Korrektur durch Mitarbeitende und Genehmigung | Admin, Mitarbeiter | Korrektur nach Schichtende, wenn erlaubt (B8). Sie zählt sofort in den Ist-Stunden, auch ungenehmigt, und bleibt rot bis „Änderungen akzeptieren“ (je Person oder je Schicht). Unter „Änderungen behandeln“ lässt sich die Genehmigung zurücknehmen („Abbrechen“). Die Person sieht den Status im Profil. Ist die Korrektur falsch, muss der Admin selbst korrigieren. | Korrektur wirkt erst nach Genehmigung; Ablehnen ist möglich; mit Benachrichtigung; Liste unter Anträge (`components/workforce/requests.tsx`). | anders gelöst | S |
| B39 | Stunden genehmigen (Spalte „Genehmigt“) | Admin, Superuser | Leer: keine Änderung. Rotes Kreuz: offene Änderung. Grüner Haken: genehmigt, auch nach Admin-Änderung. Ungenehmigte Änderungen stehen trotzdem im Excel-Export. | Buchungen haben keinen Genehmigungsstatus; keine Abnahme vor dem Export. | fehlt | M |
| B40 | Aktivitätsprotokoll je Schicht | Admin | Unten im Dialog: „Geändert am <Datum>“, wer, Uhrzeit. Je Zeile das Feld mit alt → neu: Ende, Pause, Status (ausstehend → genehmigt), Kommentar, Position. Bei ungeplanter Schicht auch das erwartete Ende. | `TimeCorrection` speichert vorher, vorgeschlagen, Prüfer und Zeitpunkt; dazu der Check-in-Verlauf. Kein Protokoll je Buchung in der Oberfläche. | teilweise | M |
| B41 | Kommentar beim Ausstempeln | Mitarbeiter | Freiwillig; nur für Admins sichtbar; in den Übersichten als Sprechblase. | Die API nimmt beim Stopp einen Kommentar an, die Oberfläche hat kein Feld dafür (`components/time/stopwatch.tsx`, `components/workforce/checkins.tsx`). | teilweise | S |
| B42 | Stunden drucken | Admin | Knopf „Drucken“ oben rechts öffnet den Druckdialog des Browsers, auch als PDF. Alternativ ein Blatt der Excel-Datei drucken. | Kein Drucklayout. `jspdf` ist installiert, wird aber nicht genutzt (`package.json`). | fehlt | S |
| B43 | Zeitumstellung | Admin | Eine Nachtschicht über die Umstellung zählt die echte Dauer (23–11 Uhr: 11 h im März, 13 h im Oktober). Bei Bedarf in „Stunden und Lohn“ anpassen. | Stoppuhr und Check-in rechnen mit echten Zeitstempeln (richtig). Manuelle Von/Bis-Zeiten und Planstunden rechnen nach Wanduhr (`lib/berlin.ts` `rangeMinutes`, `recordMinutes`). | teilweise | S |
| B44 | Stunden pausierter Mitarbeitender | Admin | Frühere Stunden bleiben in „Stunden und Lohn“ sichtbar. | Die Auswertung enthält auch inaktive Mitglieder (`lib/report.ts`). | vorhanden | – |
| B45 | Eigene Stunden („Ich → Stunden“) | Mitarbeiter | Web und App. Zeitraum wählbar, voreingestellt ist der aktuelle Monat. Gearbeitete Stunden; Saldo zum letzten Tag, falls freigeschaltet; Rechnung per Klick. | Startseite „Deine Monatsstunden“ (Ist, Soll, Abweichung zum Plan); Zeiterfassung mit eigenen Buchungen; Auswertung mit der eigenen Zeile (`components/workforce/dashboard.tsx`). Kein Saldo, nur ganze Monate. | teilweise | S |
| B46 | Rechte für Superuser | Admin | „Anwesenheit sehen und genehmigen“: Zugang zu „Stunden und Lohn“, bearbeiten, genehmigen, Excel-Export, Salden und Ausgleich – ohne Lohndaten. „Lohn sehen und exportieren“: Lohndaten, Export, Personalnummern, Lohnarten, Salden und Ausgleich; Anwesenheit nur ansehen. Gilt je Standort. | Standortrechte VIEW_TIME/EDIT_TIME und Personalrecht VIEW_HOURS (`lib/access.ts`, `BranchRight`, `StaffRight`). Kein Recht für Lohndaten. | teilweise | M |
| B47 | Lohn: System oder Dateiformat wählen | Admin | Einstellungen → Lohn (Tarif-Kennzeichen): „System wählen“ mit CSV oder Excel; Knopf „System nicht gefunden?“. | – | fehlt | S |
| B48 | Lohnarten | Admin | Tabelle „Allgemeine Lohnarten im Export“: Aktiv-Häkchen, Titel, Stundenlohn, Lohnart-Code (freiwillig, z. B. Code der Lohnsoftware). „Lohnart hinzufügen“; Zeilen direkt bearbeiten, speichern, löschen. | Fehlt; kein Lohnmodell im Schema. | fehlt | M |
| B49 | Personalnummer | Admin | Je Person „Personalnummer im Export“, mit Suche. Auch im Exportdialog änderbar. | – | fehlt | S |
| B50 | Standard-Lohnart je Person | Admin | Auswahl „Normalstunden“: nach dieser Lohnart werden die Stunden bezahlt. | – | fehlt | S |
| B51 | Lohnart je Position | Admin | „Abweichende Lohnart je Position“: für jede Position (mit Farbpunkt) eine eigene Lohnart. Sie gilt für Schichten mit dieser Position. | Fehlt. Am ehesten entspricht der Position der Arbeitsbereich an der Schicht (`Division` mit Farbe). | fehlt | M |
| B52 | Lohnsatz in „Stunden und Lohn“ ändern | Admin | Klick auf einen Lohnbetrag öffnet ein Fenster mit der Standard-Lohnart der Person. Dort ändern oder mit „+ Satz hinzufügen“ (Titel, Stundenlohn) eine neue Lohnart anlegen. | – | fehlt | S |
| B53 | Monatslohn / Festgehalt | Admin | In den Artikeln nicht beschrieben; zu sehen sind nur Stundenlöhne. | – | fehlt | M |
| B54 | Zuschlag anlegen | Admin | Einstellungen → Lohn → „Zuschläge“ → „Zuschlag hinzufügen“. Felder: Name (z. B. Abend, Feiertag, Wochenende), Lohnart-Code (freiwillig); Speichern/Verwerfen. | – | fehlt | M |
| B55 | Zuschlag: Tage | Admin | Entweder „gewählte Wochentage“ (Mo–So einzeln) oder „Feiertage und Sonderdaten“. | Feiertage je Bundesland werden erzeugt (`lib/holidays.ts`, `Holiday`), aber nur im Abwesenheitskalender genutzt. | fehlt | S |
| B56 | Zuschlag: Personen und Positionen | Admin | „alle Mitarbeitenden“ oder „nur ausgewählte“; „alle Positionen“ oder „ausgewählte“. | – | fehlt | S |
| B57 | Zuschlag: Zeitblock | Admin | Von–Bis (HH:MM); ganzer Tag 00:00–24:00. Den Zuschlag erhalten nur die Stunden der Schicht innerhalb des Blocks. Beispiel: Schicht 15:45–22:00, Abendzuschlag für 6,0 von 6,25 h. | – | fehlt | M |
| B58 | Zuschlag: Satz | Admin | Fester Betrag je Stunde oder Prozent. Der Prozentsatz bezieht sich auf die Lohnart, die in der Schicht gilt (abhängig von der Position). | – | fehlt | S |
| B59 | Abwesenheitsvergütung anlegen | Admin | Bereich „Registrierung von Abwesenheit (optional)“. Felder: Titel, Abwesenheitsart (aus dem Konto, z. B. Krankheit, Urlaub), Code (freiwillig). Häkchen „Zuschläge während der Abwesenheit wie bei normalen Stunden“. | Abwesenheitsarten haben ein Feld „bezahlt“ (`AbsenceCategory.isPaid`), aber ohne Wirkung auf den Lohn. | fehlt | M |
| B60 | Abwesenheitsvergütung: Tage, Personen, Zeitblock, Satz | Admin | Wie beim Zuschlag: Wochentage oder Feiertage und Sonderdaten; alle oder ausgewählte Personen; Zeitblock. Stundensatz fest oder in Prozent der Lohnart der Schicht; Prozent setzt eine zugewiesene Schicht mit Position voraus. | – | fehlt | M |
| B61 | Ablauf bezahlte Abwesenheit (z. B. Krankheit) | Admin, Mitarbeiter | 1. Abwesenheit (von der Person oder vom Admin) nur für die geplanten Arbeitsstunden. 2. Der Admin genehmigt und setzt die Schichten auf 0 h. 3. Ist die Person in der Abwesenheitsvergütung ausgewählt, gibt es statt Lohn die Abwesenheitsvergütung. | Eine genehmigte Abwesenheit sperrt nur neue Einteilungen. Bestehende Schichten und Stunden bleiben unverändert (`app/api/absences/[id]/route.ts`). | fehlt | L |
| B62 | Schichten bei der Genehmigung einer Abwesenheit | Admin | Beim Genehmigen eine Vorgabe für alle Schichten im Zeitraum (z. B. zählen als gearbeitet, 0 h, als offene Schicht freigeben) und „Bearbeiten“ je Schicht. Gleichzeitig ein Ausgleich auf das Zeitkonto. | – | fehlt | M |
| B63 | Lohn je Schicht mit Rechenweg | Admin | Spalte Lohn je Person und je Schicht. Hover oder Klick zeigt „Berechnung des Lohns“: Stunden × Satz, je Zuschlag Stunden × Satz, Summe, „Einstellungen öffnen“. Grundlage sind die Stunden nach Änderungen. | – | fehlt | L |
| B64 | Lohnkosten-Prognose | Admin | Für künftige Zeiträume Lohnkosten aus den Planstunden. | – | fehlt | S |
| B65 | Lohnexport starten | Admin, Superuser (Lohn) | Seitenleiste „Lohn für den Zeitraum exportieren“. Zeigt den letzten Export (Zeitraum, erstellt am) und eine Liste früherer Exporte. | – | fehlt | M |
| B66 | Lohnexport: Übersicht | Admin | Kopf „Lohnexport für <Zeitraum>“, Link zu den Lohneinstellungen. Tabelle: Häkchen je Person (zum Ausschließen), Personalnummer (änderbar), Lohnart im Export (Auswahl), Lohn, Stunden. Aufklappbar je Person: „Normalstunden“, „Normalstunden mit Position X“, je Zuschlag mit Satz oder Prozent, Betrag und Stunden. | – | fehlt | M |
| B67 | Lohnexport: mit oder ohne Sätze, Datei | Admin | Häkchen „Lohnsätze in die Datei aufnehmen“; ohne Häkchen nur Stunden je Lohn- und Zuschlagsart. „Datei herunterladen“ als CSV oder Excel nach Einstellung; Abbrechen. | – | fehlt | S |
| B68 | Schnittstellen zu Lohnsystemen | Admin | Die Tarifliste nennt Lohnschnittstellen; die Artikel zeigen nur CSV und Excel. | Fehlt. Für AKRO ist das Zielformat zu klären (z. B. DATEV). | fehlt | L |
| B69 | Excel-Export starten | Admin, Superuser | Seitenleiste „Export nach Excel“ für den gewählten Zeitraum. Die Datei erscheint darunter als Link „Excel für Zeitraum <Daten>“. Ungenehmigte Änderungen sind enthalten. | CSV je Monat: Nachname, Vorname, Soll, Plan, Ist, Abweichung, Schichten; UTF-8 mit BOM, Semikolon, Dezimalkomma; Standortfilter; kein XLSX (`app/api/reporting/export/route.ts`, `components/reporting/export-modal.tsx`). Negative Abweichungen bekommen vom Formelschutz einen Apostroph und erscheinen in Excel als Text. | teilweise | M |
| B70 | Excel: Einführung und Blatt „Bericht“ | Admin | Das erste Blatt erklärt die Datei. „Bericht“ fasst den Zeitraum zusammen; Spalten nicht beschrieben. | Die CSV-Zeilen je Person decken das teilweise ab. | teilweise | S |
| B71 | Excel: Blatt „Verteilt auf Positionen“ | Admin | Stunden je Position bzw. Rolle. | – | fehlt | S |
| B72 | Excel: Blatt „Tagesübersicht“ | Admin | Stunden je Tag. | – | fehlt | S |
| B73 | Excel: Blatt „Personenübersicht“ | Admin | Gesamtstunden je Person und Liste aller Schichten mit Dauer. | Fehlt; nur Summen. | fehlt | S |
| B74 | Excel: Blatt „Stunden je Person“ | Admin | Stunden je Person nach Tages- und Wochenzeit. Grundlage für Abend- und Wochenendzuschläge. | – | fehlt | S |
| B75 | Excel: Blatt „Abwesenheitsübersicht“ | Admin | Abwesenheiten im Zeitraum. | – | fehlt | S |
| B76 | Excel: Blatt „Überstundensaldo“ | Admin | Zeitkonten der Personen. | – | fehlt | S |
| B77 | Zeitkonten aktivieren | Admin | Einstellungen → Zeitkonten: Erklärung der drei Größen Soll, Ist und Plan; Häkchen „Zeitkonten aktivieren“; „Einstellungen speichern“. | – | fehlt | S |
| B78 | Zeitkonto: Berechnungsart | Admin | Allgemein wählbar: Plan − Soll, Ist − Soll oder Ist − Plan. Enthält eine Abfrage Ist und Plan, werden beide zu einer Schätzung kombiniert. | Je Monat Ist − Plan, Soll daneben angezeigt; kein Saldo, keine Wahl (`lib/report.ts`). | teilweise | M |
| B79 | Zeitkonto: Sichtbarkeit für Mitarbeitende | Admin | Allgemein Ja/Nein. Niemand sieht fremde Salden; Mitarbeitende können keinen Ausgleich anlegen. | – | fehlt | S |
| B80 | Zeitkonto: Einstellungen je Person | Admin | Tabelle je Person: einbeziehen (Häkchen), Berechnungsart (Stern = abweichend), Sichtbarkeit („Saldo zeigen“), Periode Woche/Monat, Soll-Knopf („Einrichten“ bzw. Wert). | – | fehlt | M |
| B81 | Soll mit Startdatum, mehrere Phasen | Admin | Dialog: Startdatum, Sollstunden, Periode Woche oder Monat. Beliebig viele Soll-Einträge; jeder gilt ab seinem Startdatum bis zum nächsten. Jederzeit änderbar; danach wird neu gerechnet. | `targetHoursPerMonth` (eine Zahl ohne Startdatum oder Verlauf) und das ungenutzte `targetHoursPerWeek` (`OrganizationMember`, `components/workforce/personnel.tsx`). | teilweise | M |
| B82 | Saldo ab Startdatum, auch rückwirkend | Admin | Rechnet ab dem Startdatum des ersten Solls, auch über bereits erfasste Vergangenheit. Empfohlen: Montag bzw. Monatserster; andere Starttage werden laut Artikel richtig gerechnet. | – | fehlt | S |
| B83 | Spalte „Saldo“ | Admin | In „Stunden und Lohn“ je Person der Saldo zum letzten Tag der Abfrage (Knopf mit Wert und Listensymbol). „Ausgeschaltet“ bei Personen ohne Zeitkonto. | – | fehlt | S |
| B84 | Saldo im Detail | Admin, Mitarbeiter | Fenster „Zeitausgleich <Name>“: Zeile „Saldo vor dem gewählten Start“; je Woche oder Monat Soll, Plan, Ist und laufender Saldo. Das i-Symbol klappt die Rechnung auf (vorher + Ist − Soll = neu). „Ausgleich anzeigen“, „+ Ausgleich hinzufügen“, Schließen. | – | fehlt | M |
| B85 | Ausgleich buchen | Admin, Superuser | Datum, Beschreibung, Stunden mit Vorzeichen; z. B. −30 für ausbezahlte Überstunden oder + für einen Anfangssaldo. Fließt in den Saldo ein. | – | fehlt | S |
| B86 | Saldo mit künftigen Schichten | Admin | Bei „Ist − Soll“ zählen noch nicht geleistete Schichten mit ihren Planstunden. | – | fehlt | S |
| B87 | Überstundenabbau über Abwesenheit | Admin, Mitarbeiter | Eine Abwesenheitsart wie „Freizeitausgleich“ anlegen. Die Person beantragt selbst; der Admin genehmigt mit „Schichten zählen 0 Stunden“; der Saldo sinkt. | Abwesenheitsarten sind frei anlegbar, wirken aber nicht auf Stunden (`components/settings/absence-settings.tsx`). | fehlt | M |
| B88 | Eigener Saldo für Mitarbeitende | Mitarbeiter | Unter „Ich → Stunden“ (Web und App) der Saldo zum letzten Tag der Abfrage mit Rechnung per Klick. Sichtbar nur für die Person selbst und Admins. | – | fehlt | S |

### Layout und Bedienung

**Gesamtnavigation**
- Smartplan: waagerechtes Hauptmenü oben mit Symbol und Text: Dienstpläne, Smartplan Time, Mitarbeitende, Nachrichten, Abwesenheit, Stunden und Lohn, Ich, Einstellungen. Links die Standortauswahl, rechts die Glocke. Zeiterfassung und Lohn sind ein einziger Bildschirm („Stunden und Lohn“); die Live-Sicht hat einen eigenen Menüpunkt.
- Schichtplaner: Seitenleiste mit Gruppen (Arbeit, Personal, Organisation), auf dem Handy eine Leiste unten (`components/layout/nav-config.ts`). Zeit und Lohn sind auf vier Orte verteilt: „Zeiterfassung“ (Buchungen), „Auswertung“ (Monatsmatrix), „Anträge“ (Korrekturen) und die Startseite (Check-ins).

**Einstellungen „Stempeluhr und Zeiterfassung“, „Lohn“, „Zeitkonten“**
- Untermenü als Liste links mit Tarif-Kennzeichen. Rechts Karten mit Titel, kurzer Erklärung und Info-Symbol.
- Jede Einstellung ist eine Zeile: Frage mit Erklärung links, Auswahl rechts. Ein Speichern-Knopf je Karte.
- Lange Formulare (Zuschlag, Abwesenheitsvergütung) als Blöcke mit Optionsfeldern: „alle / nur ausgewählte“, Wochentage als runde Tasten M–S, Zeitblock mit zwei HH:MM-Feldern, Satz mit Einheitenwahl (Betrag/Stunde oder %).
- Tabellen (Lohnarten, Lohnart je Person, Zeitkonto je Person) lassen sich direkt in der Zeile bearbeiten, Speichern steht in der Zeile.
- Unterschied: Unsere Einstellungsseite „Zeiterfassung“ hat Schalter ohne Wirkung (B1) und keine Bereiche für Lohn oder Zeitkonten.

**Stempeluhr am Gerät**
- Vollbild ohne Menü. Dunkle Kopfleiste: Suche, große Uhrzeit mit Datum, Beenden.
- Zwei Spalten: links Personen als große Karten (heute eingeplant zuerst), rechts das Protokoll des Tages. Jeder Ablauf hat wenige Schritte: Name → PIN → genau eine Hauptaktion.
- Gut bedienbar: große Ziele für Tablets, kein Login je Person, Rückmeldung sofort im Protokoll.
- Unterschied: Bei uns gibt es keinen solchen Bildschirm; jede Person stempelt am eigenen Gerät nach Anmeldung.

**App-Stempeluhr**
- Ausgangspunkt ist die Schicht: Antippen zeigt eine Karte mit Bereichskreis und eigener Position, darunter die Hauptaktion. Die Laufzeit steht unter „Ich“.
- Unterschied: Bei uns steht der Check-in als Karte auf der Startseite (Schicht, Pünktlichkeit, Laufzeit, Pause/Auschecken). Es gibt keine Karte, dafür klare Fehlertexte und einen manuellen Antrag. Das ist für Sicherheitspersonal sinnvoll und kann bleiben.

**Smartplan Time (Live-Sicht)**
- Karten je Erfassung, gruppiert nach Standort. Ein Farbzustand zeigt „läuft“ oder „beendet“. Kleine Symbole für Pause und Kommentar, Zahnrad für die Bearbeitung.
- Filter „beendete zeigen“ beantwortet die Frage „Wer ist gerade im Dienst?“ auf einen Blick.
- Unterschied: Unsere Liste „Check-ins heute“ zeigt Pünktlichkeit und GPS-Daten, aber keine Ausstempelzeit und keinen Filter auf „gerade im Dienst“.

**Stunden und Lohn**
- Kopf: Zeitraum als Überschrift mit Link „Datum wählen“; rechts „Stunden aus gewählten Plänen zeigen“ und „Drucken“.
- Linke Seitenleiste von oben nach unten: Lohnexport (letzter Export), Excel-Export (letzte Datei), Kennzahlen (Ist/Plan, Abweichung, Lohnkosten).
- Hauptbereich: eine Tabelle je Person, aufklappbar zur Schichtliste. Zeitangaben sind Links und öffnen den Bearbeiten-Dialog; Lohn- und Saldowerte öffnen beim Hovern oder Klicken den Rechenweg.
- Gut bedienbar: Prüfen, Korrigieren, Genehmigen und Abrechnen geschieht an einem Ort, ohne Seitenwechsel. Rot und Grün lenken den Blick auf offene Punkte. Der Dialog zeigt immer die Planzeit zum Vergleich. Rechenwege machen Lohn und Saldo nachvollziehbar.
- Unterschied: Unsere „Auswertung“ ist eine Matrix nach Kalenderwochen ohne Aufklappen, ohne Bearbeiten und ohne Lohn; die Einzelbuchungen stehen auf einer anderen Seite. Die Formate wechseln je Seite: „8H30M“ in der Auswertung, „8h 30m“ in der Zeiterfassung, „8,5 h“ auf der Startseite. Smartplan zeigt durchgehend Dezimalstunden mit zwei Stellen (7.50), was für die Lohnabrechnung günstiger ist.

**Anwesenheit bearbeiten (Dialog)**
- Von oben nach unten: Plan als Bezug, Zeitfelder, Pausen als einzelne Zeiträume, Begründung, „nicht erschienen“, Aktivitätsprotokoll als Tabelle alt → neu mit Person und Uhrzeit.
- Unterschied: Unser Formular ändert Buchungen, nicht Schichten. Die Pause ist eine Minutenzahl, und der Verlauf ist nicht im Formular sichtbar.

**Lohnexport (Dialog)**
- Vorschau vor dem Download mit Häkchen je Person, Personalnummer und Lohnart in der Zeile änderbar, Aufschlüsselung je Lohnart. Am Ende eine Grundsatzfrage (Sätze aufnehmen?) und ein Download-Knopf.

**Zeitkonto (Dialog)**
- Tabelle Woche/Monat × Soll/Plan/Ist/Saldo mit Zeile für den Vorsaldo. Die Rechnung lässt sich je Zeile aufklappen; der Ausgleich wird im selben Fenster gebucht.

### Regeln und Berechnungen

**Smartplan (aus den Artikeln erkennbar)**
- Planstunden: Summe der Schichten veröffentlichter Pläne im Zeitraum minus Pausen. Ausgeschlossene Pläne zählen nicht (B29).
- Stunden nach Änderungen je Schicht: Ohne Änderung gilt die Planzeit. Sonst gelten Stempelzeit oder korrigierte Zeit (Beginn–Ende minus alle erfassten Pausen). „Nicht erschienen“ ergibt 0 h. Ungenehmigte Änderungen von Mitarbeitenden zählen mit.
- Ungeplante Stempelschicht: zählt erst nach dem Ausstempeln. Das erwartete Ende wird durch das echte Ausstempeln ersetzt.
- Zeitumstellung: Es zählt die echte Dauer (23–11 Uhr: 11 h bzw. 13 h).
- Abweichung = Ist − Plan, in Stunden und in Prozent des Plans (Beispiel −8,00 h / −1,06 %).
- Lohn je Schicht = Ist-Stunden × Stundenlohn der geltenden Lohnart (Lohnart der Position, sonst die Standard-Lohnart) + Summe der Zuschläge. Je Zuschlag: Stunden der Schicht im Zeitblock an gültigen Tagen × Satz; der Satz ist fest oder ein Prozentsatz der geltenden Lohnart.
  - Prüfbeispiel aus dem Export: 20 h × 130 = 2.600; 22,5 h × 120 (Position) = 2.700; Sonntag 20 % von 130 × 2 h = 52; Nacht 20/h × 4 h = 80; Summe 5.432.
  - Beispiel je Schicht: 6,25 h × 130 = 812,50; Abendzuschlag 6,0 h × 20 = 120; Summe 932,50.
- Abwesenheitsvergütung: ersetzt den Lohn für Abwesenheitsstunden, wenn die Schichten auf 0 h gesetzt wurden. Satz fest oder in Prozent der Lohnart der Schicht; Zuschläge auf Wunsch wie bei normalen Stunden.
- Zeitkonto je Periode (Woche oder Monat), laufend: neuer Saldo = alter Saldo + Basis − Soll + Ausgleich. Die Basis hängt von der Berechnungsart ab (Ist, Plan, oder Ist − Plan ohne Soll).
  - Beispiel: 0,64 + 24,50 − 12,00 = 13,14; Woche danach 13,14 + 20,25 − 12,00 − 5,00 (Ausgleich) = 16,39.
  - Beispiel Monat: Soll 154, Ist 147, Vorsaldo +10 → +3.
  - Bei „Ist − Soll“ zählen künftige, noch nicht geleistete Schichten mit Planstunden.
  - Das Soll wechselt zum Startdatum des nächsten Soll-Eintrags. Für einen Start mitten in der Periode rechnet Smartplan laut Artikel richtig; die Methode ist nicht beschrieben.
- Abwesenheit und Zeitkonto:
  - Schichten mit 0 h senken den Ist-Saldo.
  - Eine zeitbasierte Abwesenheit wird nicht automatisch abgezogen; dafür gibt es einen negativen Ausgleich, eine angepasste Anwesenheitszeit oder 0 h plus positiven Ausgleich.
  - Damit ein Feiertag neutral bleibt: Schicht mit der durchschnittlichen Tagesdauer (Soll / Arbeitstage, z. B. 160/20 = 8 h) anlegen und als anwesend zählen, oder einen Ausgleich in dieser Höhe buchen. Bei „Ist − Plan“ einfach keine Schicht anlegen.
- Anzeige: Dezimalstunden mit zwei Stellen. Zeitauswahl im Dialog in 15-Minuten-Schritten; Stempelzeiten minutengenau. Rundungsregeln beim Stempeln sind nicht beschrieben.

**Schichtplaner heute (Code)**
- Netto-Minuten einer Buchung (`lib/berlin.ts` `recordMinutes`):
  - Stoppuhr/Check-in: echte Zeitstempel (Ende − Beginn) minus Pausensekunden, auf Minuten gerundet.
  - Manuell Von/Bis: Wanduhr; über Mitternacht +24 h; nicht richtig bei Zeitumstellung.
  - Dauer: Stunden × 60 + Minuten minus Pause.
- Planminuten: Schichtdauer minus Pause. Bei `PER_HOUR`: volle Stunden × Minuten; bei `PER_SHIFT`: fester Wert (`lib/report.ts`).
- Monatsauswertung:
  - Ist zählt Buchungen nach ihrem Startdatum, Plan zählt Schichten nach ihrem Datum. Eine Nachtschicht zählt ganz zum Monat ihres Beginns.
  - Plan enthält künftige Schichten, Ist nicht. Mitten im Monat ist Ist − Plan deshalb negativ. Bei Smartplan zählen künftige Schichten auf beiden Seiten gleich.
  - Soll ist ein fester Monatswert ohne Verlauf; Abweichung zum Soll und laufender Saldo fehlen.
- Check-in: Fenster von 30 Min. vor bis Schichtende. Verspätung = volle Minuten nach Beginn (≤ 0 = pünktlich). Echte Zeitpunkte über Wanduhr-Umrechnung mit Regeln für die Zeitumstellung (`lib/checkin.ts`).
- Einstellungen ohne Wirkung: automatischer Stopp der Stoppuhr, Warnung über Höchststunden, „Wer darf erfassen“. Die KI-Anomalieerkennung (Grenzwert 10 h, Abweichung 25 %) läuft nur für Admins mit aktivierter KI (`lib/ai/anomaly-detector.ts`).

**Deutsches Recht – Hinweise für AKRO (keine Aussage über Smartplan; vom Steuerbüro bzw. Arbeitsrecht bestätigen lassen)**
- **§ 3b EStG (steuerfreie Zuschläge):**
  - Nacht 20–6 Uhr 25 %; 0–4 Uhr 40 %, wenn die Arbeit vor 0 Uhr begonnen hat.
  - Sonntag 50 %; gesetzlicher Feiertag und 31.12. ab 14 Uhr 125 %; 24.12. ab 14 Uhr, 25./26.12. und 1.5. 150 %.
  - Sonntags- und Feiertagsarbeit umfasst auch 0–4 Uhr des Folgetags bei Beginn vor 0 Uhr.
  - Steuerfrei nur für tatsächlich geleistete Arbeit und für einen Grundlohn bis 50 €/h; sozialversicherungsfrei nur bis 25 €/h Grundlohn (§ 1 SvEV).
  - Über diese Sätze hinausgehende Teile (z. B. aus dem Tarifvertrag) sind steuerpflichtig.
  - Für die Engine heißt das: Zeitblöcke über Mitternacht, Stichtage mit Uhrzeit (24.12./31.12. ab 14 Uhr), Feiertage am Ort der Arbeit (Bundesland des Einsatzorts), Regeln zum Zusammentreffen (Nacht zusätzlich zu Sonntag/Feiertag; fällt ein Feiertag auf einen Sonntag, nach h. M. nur der Feiertagssatz). Im Export steuerfreie und steuerpflichtige Anteile als getrennte Lohnarten.
- **Lohnfortzahlung:** Krankheit (§ 4 EFZG) und Feiertag (§ 2 EFZG) nach dem Lohnausfallprinzip: Bezahlt wird, was ohne Ausfall verdient worden wäre, einschließlich ausgefallener Zuschläge, die dann aber nicht steuerfrei sind. Überstunden zählen bei Krankheit nicht mit. Urlaubsentgelt (§ 11 BUrlG) nach dem Durchschnitt der letzten 13 Wochen ohne Überstunden. Ein fester Satz oder ein Prozentsatz wie bei Smartplan (B60) reicht dafür nicht.
- **ArbZG:**
  - § 3: 8 h/Werktag, bis 10 h mit Ausgleich auf durchschnittlich 8 h in 6 Monaten/24 Wochen.
  - § 4: Pause 30 Min. ab 6 h, 45 Min. ab 9 h, Abschnitte von mindestens 15 Min.
  - § 5: 11 h Ruhezeit.
  - § 6 Abs. 5: Nachtarbeitnehmer erhalten freie Tage oder einen Zuschlag.
  - § 11: Ersatzruhetag für Sonntags- und Feiertagsarbeit.
  - Tarifliche Abweichungen nach § 7 ArbZG (Bewachung, Bereitschaft) prüfen.
  - Daraus folgen Prüfregeln für Pausen, Höchstzeit und Ruhezeit beim Stempeln und Korrigieren. Heute gibt es dazu nur die KI-Anomalieerkennung.
- **Aufzeichnungspflicht:**
  - § 16 Abs. 2 ArbZG und BAG-Beschluss vom 13.09.2022: Arbeitszeit grundsätzlich vollständig erfassen.
  - Das Wach- und Sicherheitsgewerbe zählt zu den Branchen nach § 2a SchwarzArbG. Damit gilt § 17 MiLoG: Beginn, Ende und Dauer der täglichen Arbeitszeit spätestens bis zum Ablauf des 7. Tages nach dem Arbeitstag aufzeichnen, mindestens 2 Jahre aufbewahren.
  - Lohnkonto bis Ende des 6. Folgejahres (§ 41 EStG).
- **Mindestlohn und Tarif:**
  - Mindestlohn 13,90 €/h seit 01.01.2026 (14,60 € ab 01.01.2027); Minijob-Grenze 2026: 603 €/Monat.
  - Bei Entgelt- und Manteltarifverträgen für Sicherheitsdienstleistungen (je Bundesland, teils allgemeinverbindlich) Zuschlagssätze und Überstundenregeln prüfen.
- **Rundung und Beginn:** Einseitiges Abrunden zulasten der Beschäftigten ist angreifbar. Frühes Einstempeln zählt arbeitsrechtlich, wenn die Arbeit angeordnet oder geduldet ist; das betrifft B4/B5.
- **GPS:** DSGVO-Grundsätze Erforderlichkeit und Transparenz; bei einem Betriebsrat Mitbestimmung nach § 87 Abs. 1 Nr. 6 BetrVG. Unser Ansatz ohne gespeicherte Koordinaten (B21) ist hier vorteilhaft.

### Stundenzettel

**Smartplan:** Laut Artikeln keine eigene Stundenzettel-Funktion: kein Nachweisdokument je Person und Monat, keine Unterschrift, kein PDF-Erzeuger, kein Monatsabschluss. Ersatzweise nutzbar:
- „Stunden und Lohn“ mit aufgeklappter Schichtliste je Person (Datum, Position, Plan, Ist, Pause, Lohn) und „Drucken“ über den Browser, auch als PDF (B42).
- Excel-Blätter „Personenübersicht“ und „Stunden je Person“ (B73, B74).
- „Ich → Stunden“ für Mitarbeitende (B45).
- Aktivitätsprotokoll je Schicht als Änderungsnachweis (B40).
- Die Tarifliste nennt „Timesheet history“; was das ist, bleibt offen.

**Was im Schichtplaner für einen AKRO-Stundenzettel fehlt**
- Ansicht je Person und Monat mit diesen Spalten: Datum, Kunde/Einsatzort, Planzeit, Beginn, Ende, Pausen, Netto, Stunden je Zuschlagsart (Nacht/Sonntag/Feiertag), Abwesenheit, Bemerkung, Check-in-Nachweis (Zeit, Entfernung, manuell freigegeben). Dazu Summen sowie Soll, Ist und Saldo. Voraussetzung: Verknüpfung Buchung ↔ Schicht (B35) und Zuschlagslogik (B54–B58).
- PDF-Erzeugung. `jspdf` und `jspdf-autotable` sind installiert, aber ungenutzt. Druckansicht fehlt (B42).
- Abnahme: Genehmigungsstatus je Buchung oder Monat (B39) und ein Monatsabschluss, der spätere Änderungen sperrt oder nur per Korrektur mit Protokoll zulässt.
- Bestätigung durch die Person und ggf. Objektleitung oder Kunde (Unterschrift oder elektronische Bestätigung mit Zeitstempel).
- Leistungsnachweis je Kunde und Einsatzort (Stunden je Objekt und Monat) als Grundlage der Kundenrechnung. Nicht in Smartplan beschrieben, für einen Sicherheitsdienst aber naheliegend.
- Frist und Aufbewahrung: Erinnerung, wenn Tage nach 7 Tagen noch ohne Erfassung sind (§ 17 MiLoG), und eine Aufbewahrungs- und Löschregel (heute unbegrenzt, kein Löschlauf).
- Sichtbares Änderungsprotokoll je Buchung (B40) und Pause mit Uhrzeit statt nur Minutensumme (B36).

### Offen für die Erfassung im Konto

- Stempeluhr-Einstellungen B4–B6: genaue Optionen und Texte. Werden Stempelzeiten gerundet (Minute, 5, 15)? Was passiert technisch bei „nicht eingestempelt“ (Status, Zeitpunkt, Benachrichtigung)?
- Pausen: Werte der Auswahlliste beim Ausstempeln. Wird eine Plan-Pause bei gestempelten Schichten abgezogen? Gibt es eine gesetzliche Mindestpause?
- Bearbeiten-Dialog: Sind nur 15-Minuten-Schritte möglich oder auch freie Eingabe? Darf eine Person auch Beginn, Position oder Standort ändern? Lassen sich genehmigte Stunden später noch ändern? Gibt es einen Periodenabschluss?
- Genehmigung: Wo genau stehen „Änderungen akzeptieren“ je Person und je Schicht? Gibt es eine Sammelgenehmigung für alle? Wer wird benachrichtigt?
- Terminal: PIN-Zurücksetzen durch Admins, Sperre nach Fehleingaben, automatisches Abmelden, Darstellung auf dem Handy. Welche Personen erscheinen (auch ohne Schicht heute)?
- GPS: Wie wird die gespeicherte Position in „Stunden und Lohn“ angezeigt (Karte, Koordinaten, Bereichsname)? Kleinster und größter Radius. Gilt die Prüfung auch beim Ausstempeln und bei Pausen? Verhalten ohne Netz.
- Smartplan Time: Gilt „letzte 24 h“ oder „heute“ (Artikel widersprechen sich)? Sind auch Schichten ohne Stempelung sichtbar?
- Lohn:
  - Gibt es Monatslohn/Festgehalt, Überstundenvergütung oder Minijob-Behandlung?
  - Welche Systeme bietet „System wählen“ im deutschen Konto (DATEV, Lexware)?
  - Aufbau der Lohndatei: Spalten, Trennzeichen, Kodierung, Dateiname, mit und ohne Sätze.
  - Was ist die Lohnart im Export je Person (B66) gegenüber der Standard-Lohnart?
- Zuschläge:
  - Mehrere Zuschläge gleichzeitig: addieren oder Vorrang?
  - Zeitblock über Mitternacht (z. B. 20:00–06:00)?
  - Werden Pausen im Zeitblock abgezogen?
  - Wo werden „Sonderdaten“ gepflegt (24.12./31.12. ab 14 Uhr)? Welche Feiertagsregion gilt?
- Abwesenheitsvergütung: Welche Stunden zählen ohne Schicht? Wie wirkt der Zeitblock bei ganztägiger Abwesenheit?
- Excel-Export: genaue Spalten jedes Blatts, Zahlen- und Datumsformate, Inhalt des Blatts „Überstundensaldo“; Exportverlauf je Benutzer oder für das ganze Konto.
- Zeitkonten:
  - Teilperiode beim Start: anteiliges Soll?
  - Wie erscheint ein Ausgleich, der beim Genehmigen einer Abwesenheit gebucht wird?
  - Sehen Mitarbeitende den Ausgleich und seine Beschreibung?
  - Woche ab Montag?
  - Tarif: Die Preisliste ordnet Zeitkonten dem Pro-Tarif zu, ein Artikel sagt „kein Plus-Paket nötig“.
- „Ich → Stunden“ für Mitarbeitende: Spalten, Zeitraumwahl in der App, Anzeige von Korrekturstatus und Lohn.
- Superuser-Rechte: genaue Wirkung je Standort in „Stunden und Lohn“ und im Export.
- „Timesheet history“ (Preisliste): wo im Produkt und mit welchem Inhalt.
- Welcher Tarif ist im AKRO-Konto aktiv? Davon hängt ab, was dort überhaupt sichtbar ist (GPS-App und Lohn: Basic; Zeitkonten und Superuser: Pro).
