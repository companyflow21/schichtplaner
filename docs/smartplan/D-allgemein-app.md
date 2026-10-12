## Allgemeines, Kommunikation und Mitarbeiter-App

Quellen: Smartplan-Hilfe, Kategorien 166, 167, 176, 177, 178, 180, 181 (alle 44 Artikel gelesen), 16 Screenshots angesehen
(Nummern D01–D17 im Text; Bilder nicht im Repo). Abgleich am Code im Stand `88c21eb`. Pfade relativ zu `src/`, wenn nicht anders angegeben.
Aufwand „–“ = nichts zu tun. Themen, die andere Kataloge vertiefen (Planung, Stempeluhr, Abwesenheit), stehen hier nur aus Sicht der Mitarbeitenden.

### Funktionen

| Nr | Funktion in Smartplan | Rolle | Details und Regeln (Felder, Optionen, Abläufe, Meldungen – in eigenen Worten, kein Copy-Paste) | Schichtplaner heute (Datei-Verweis) | Status | Aufwand |
|---|---|---|---|---|---|---|
| D1 | Kontoinhaber übertragen | Inhaber | Nur an eine Person, die schon Admin ist. Einstellungen › Konto › Administratoren › bei eigenem Namen „Inhaberschaft übertragen“. Dialog zählt die Inhaberrechte auf (Zahlungsdaten, Abo, Konto löschen); Person wählen, eigenes Passwort, Sicherheits-Häkchen, „Übergeben“. Neuer Inhaber bekommt eine E-Mail, der alte bleibt Admin. | Rolle `OWNER` fest; `app/api/employees/[id]/role/route.ts` verbietet jede Änderung am Inhaber | fehlt | S |
| D2 | Zahlungsarten | Inhaber | Karte (monatlich oder jährlich, Abbuchung erst nach Testphase) oder Jahresrechnung über den Support (Firmenname, Anschrift, Empfänger, Rechnungs-E-Mail, USt-ID; 8 Tage Zahlungsziel; Rechnung unter Einstellungen › Zahlung). | Eigenbetrieb, keine Abrechnung | anders gelöst | – |
| D3 | Tarife mit Funktionsgrenzen | – | Drei Tarife mit 10 Personen im Grundpreis, Aufpreis je weitere Person, 30 Tage Test, 5 % Rabatt jährlich. Höhere Tarife schalten u. a. GPS-Stempeln, Lohn, Abwesenheitskalender, Admin-Freigabe beim Tausch, Zusatzadmins, Superuser-Rollen, Urlaubs-/Überstundenkonten, erweiterte Benachrichtigungen, API frei. | Alle Funktionen ohne Tarifgrenze | anders gelöst | – |
| D4 | Konto pausieren oder löschen | Inhaber | Pause kostenlos bis 1 Jahr (Daten bleiben, kein Zugang). Löschen: Einstellungen › Zahlung › „Kündigen und Konto löschen“, Grund angeben, Passwort, Bestätigung; Löschung zum Ende der bezahlten Periode bzw. 14 Tage nach Testende; sofortiges Löschen danach möglich. | Eigenbetrieb; `Organization.deletedAt` im Schema, keine Oberfläche | anders gelöst | – |
| D5 | Zeitumstellung bei Nachtschichten | Admin | Arbeitszeit wird real gezählt: 23–11 Uhr ergibt im März 11 h, im Oktober 13 h. Abweichung von Hand in Stunden & Lohn über die Spalte für Änderungen an der Anwesenheit. | Stoppuhr und Check-in mit echten Zeitstempeln (`lib/berlin.ts`, `lib/time-service.ts`); manuelle Von/Bis-Buchung rechnet Ortszeit (Hinweis in `docs/AKRO-ERWEITERUNG.md`, Abschnitt Zeit) | teilweise | S |
| D6 | Geführter Einstieg „erste Woche planen“ | Admin | Folge: Plan anlegen → Zeitraum wählen (frei, z. B. ein Monat; leerer Plan nach Wochen) → Mitarbeiter anlegen → Schichten → veröffentlichen. | Wochenpläne je Standort und KW (`app/api/schedules`), kein Assistent, kein Leerzustand mit Anleitung | anders gelöst | M |
| D7 | Mitarbeiter direkt aus dem Plan anlegen | Admin | Knopf im Planungswerkzeug. Pflicht nur Vorname und Position(en); E-Mail optional – mit E-Mail geht die Einladung sofort raus, sonst später. | Nur in der Mitarbeiterliste (`components/employees/employee-form.tsx`); Pflicht Vorname, Nachname, E-Mail | teilweise | S |
| D8 | Zusatzangaben Lohnnummer und Lohnart | Admin | Aufklappbarer Bereich „Zusatzinfos“ beim Anlegen; Nummer aus dem Lohnsystem. | Kein Feld in `OrganizationMember` (`prisma/schema.prisma`) | fehlt | S |
| D9 | Eigene Zusatzfelder je Person | Admin, MA | Einstellungen › Mitarbeiterinfos › Feld hinzufügen: Name, Typ (Text/Datum), Sichtbarkeit (nur Admins / alle unter Mitarbeiter), Bearbeitung (nur Admins / auch die Person selbst unter „Ich“). Beispiel Shirtgröße, Geburtsdatum. | fehlt | fehlt | M |
| D10 | Einladung erneut senden, Link kopieren | Admin | In der Mitarbeiterliste je Person; Dialog mit „erneut senden“ und kopierbarem Aktivierungslink (gleicher Link wie in der Mail). | Neuer Einladungslink, 7 Tage gültig, alter wird ungültig (`app/api/employees/[id]/invite/route.ts`); kein E-Mail-Versand im Projekt | teilweise | M |
| D11 | Schichten im Zeitfenster anlegen | Admin | Zeitfenster mit Beginn, Ende, unbezahlter Pause, Kennzeichen Schlussdienst; mehrere Schichten je Fenster; Position je Schicht; Person optional. | Schichtformular mit Beginn/Ende (über Mitternacht), Pause + Pausenregel, Plätze, Hinweise (`components/schedule/shift-form.tsx`); kein Schlussdienst | teilweise | S |
| D12 | Zeitfenster auf andere Tage kopieren | Admin | Kopiersymbol am Zeitfenster, dann Zieltage anklicken. | Wiederholung für Wochentage 1–52 Wochen, Kopie auf Datum (`app/api/shifts/[id]/copy/route.ts`) | teilweise | S |
| D13 | Offene Schicht später besetzen | Admin | Schicht anklicken, Person wählen, speichern. | `components/schedule/employee-picker.tsx`, `app/api/bookings/route.ts` | vorhanden | – |
| D14 | Plan veröffentlichen, danach weiter bearbeiten | Admin | Großer Knopf, Bestätigungsdialog; danach sehen und tauschen Mitarbeitende. „Plan bearbeiten“ oben im veröffentlichten Plan. | `app/api/schedules/[id]/route.ts` (isPublic, Mitteilung „Dienstplan veröffentlicht“) | vorhanden | – |
| D15 | Gleiche Mitarbeiterfunktionen in App und Browser | MA | Schichten sehen, schreiben, tauschen, Stunden sehen, Abwesenheit beantragen. | Eine Web-App für alle Geräte | vorhanden | – |
| D16 | Nachrichtenzentrale zweispaltig | alle | Links Liste (angeheftete zuerst, Datum, Vorschau, roter Punkt = ungelesen, Etikett „Tagesnachricht“), rechts gewählte Nachricht: Typ-Etikett (öffentlich/Gruppe/privat), Sichtbarkeitshinweis, Absender mit Zeitstempel, Kommentare, Eingabefeld unten. | Liste und Detail auf getrennten Seiten (`components/portal/message-list.tsx`, `message-detail.tsx`) | teilweise | M |
| D17 | Nachricht schreiben | alle | Titel, Empfänger, Text, „Senden“. | `components/portal/compose-message.tsx`, `POST app/api/messages/route.ts` | vorhanden | – |
| D18 | Öffentliche Nachricht an das ganze Konto | alle | Empfänger „alle Nutzer“; bei Standorttrennung nur eigene Standorte wählbar. Ein Verlauf für alle. | „Alle N auswählen“ legt Einzel-Empfänger an; organisationsweite „Themen“ (`app/api/topics`) | teilweise | M |
| D19 | Empfänger nach Standort und Position wählen | alle | „Empfänger wählen“: ganzer Standort oder „alle auswählen“ je Position, danach Einzelne abwählen (z. B. Kranke). | Gruppen Zuständig/Administration/Weitere, „An Zuständige“, „Alle auswählen“, Einzelwahl (`compose-message.tsx`); keine Auswahl nach Standort oder Qualifikation | teilweise | S |
| D20 | Empfängerkreis durch Standorttrennung begrenzt | alle | Wer andere Standorte nicht sehen darf, kann dorthin nicht schreiben. | `visiblePeople` in `lib/access.ts`, Prüfung in `POST /api/messages` | vorhanden | – |
| D21 | Textformatierung | alle | Werkzeugleiste: fett, kursiv, durchgestrichen, Link, große Schrift, Zitat, Code, Aufzählung, Nummerierung, Einzug, Rückgängig/Wiederholen. | Einfaches Textfeld | fehlt | M |
| D22 | Dateianhang | alle | Büroklammer in der Werkzeugleiste. | fehlt; Datei-Upload im Portal „kommt bald“ (`components/portal/file-browser.tsx`) | fehlt | M |
| D23 | Zusätzlich als SMS senden | alle | Optionales Häkchen; Nachricht geht ohnehin als Push oder E-Mail raus. | Nur Schalter `smsEnabled` in `OrgSettings`, kein Versand | fehlt | M |
| D24 | Nachricht anheften | Admin | Häkchen beim Schreiben; bleibt oben in allen Postfächern (Nadel); Lösen über „…“. | fehlt | fehlt | S |
| D25 | Empfänger nachträglich ergänzen | Absender | „Bearbeiten“ neben der Empfängerliste. | fehlt | fehlt | S |
| D26 | Gruppenverlauf | alle | Alle Empfänger sehen alle Antworten; wer einzeln schreiben will, schickt getrennte Nachrichten. | Antworten sind eigene Nachrichten; Verlauf zeigt nur Antworten, an denen die Person beteiligt ist (`app/api/messages/[id]/route.ts`, `[id]/reply/route.ts`) | anders gelöst | M |
| D27 | Menü „…“ an der Nachricht | alle | Als ungelesen markieren, archivieren; Admins: lösen. | API kann gelesen/ungelesen und Papierkorb (`PATCH /api/messages/[id]`); Oberfläche bietet nur „Gelesen“ und „Löschen“ (`message-list.tsx`) | teilweise | S |
| D28 | Archiv | alle | Archivierte Nachricht zurückholen oder löschen; Löschen entfernt sie für alle. | Papierkorb mit Wiederherstellen und endgültig Löschen; löscht der Absender, ist sie für alle weg (`DELETE /api/messages/[id]`) | anders gelöst | – |
| D29 | Filter im Postfach | alle | Alle, ungelesen, öffentlich, Gruppe, Tagesnachrichten, archiviert. | Ordner Posteingang/Gesendet/Papierkorb (`components/portal/portal-sidebar.tsx`) | teilweise | S |
| D30 | Ungelesen-Zähler | alle | Zahl am Menüpunkt Nachrichten, roter Punkt je Nachricht. | `lib/hooks/use-unread-count`, Zähler in Seitenleiste und „Mehr“ (`components/layout/mobile-nav.tsx`) | vorhanden | – |
| D31 | Antworten als Kommentar | alle | Text unter der Nachricht, „Kommentar hinzufügen“. | `app/api/messages/[id]/reply/route.ts`, `message-detail.tsx` | vorhanden | – |
| D32 | Eigenen Kommentar löschen | alle | Löschen entfernt ihn für alle Beteiligten. | API löscht eigene Nachricht/Antwort für alle; Oberfläche verschiebt nur die ganze Nachricht in den Papierkorb | teilweise | S |
| D33 | Nachrichten in der App | alle | Eigener unterer Reiter; Papierflieger oben rechts zum Schreiben; gleiche Funktionen wie im Web. | Gleiche Seiten mobil; Nachrichten nur über „Mehr“ erreichbar (`components/layout/nav-config.ts`) | teilweise | S |
| D34 | Nachrichten mit einer bestimmten Person finden | alle | Filter „Nachrichten von …“ mit Namenssuche; zeigt nur Verläufe, in denen die Person selbst geschrieben hat. Auch in der App über „…“. | fehlt | fehlt | S |
| D35 | Tagesnachricht im veröffentlichten Plan | alle | Jeder Tag (auch vergangene) hat eine Tagesansicht: links Zeitfenster mit Eingeteilten, rechts Nachrichten des Tages. „Nachricht schreiben“; benachrichtigt werden standardmäßig alle mit Schicht an dem Tag, über „Hinzufügen/Entfernen“ änderbar. Sichtbar für alle, Antworten im selben Tag. App: Plan → Tag → unten „Nachricht schreiben“. | fehlt; Bezug nur auf Schicht oder Standort (`lib/messages.ts`) | fehlt | L |
| D36 | Tagesnachrichten im Postfach | alle | Mit Etikett gekennzeichnet; Sprung „im Plan ansehen und antworten“. | fehlt | fehlt | S |
| D37 | Schichtnotizen | Admin, MA | Notiz an der einzelnen Schicht. | Feld „Hinweise“ (`Shift.description`, `shift-form.tsx`), Anzeige auf der Startseite | vorhanden | – |
| D38 | Kontakt-Kurzwahl im Kollegenprofil | alle | Profil (App) mit Leiste Anrufen / SMS / E-Mail; abhängig von der Datenschutz-Einstellung D80. | Keine `tel:`/`mailto:`-Links; Mitarbeitende sehen keine Kollegenprofile | fehlt | S |
| D39 | Eigene Schichten als Kalender-Abo | MA | Web: Ich › Deine Schichten › „Schichten in Kalender“. App: Zahnrad › gleicher Punkt. Änderungen kommen automatisch nach. | Kein iCal/ICS-Feed (Suche nach ical/ics/webcal ohne Treffer) | fehlt | M |
| D40 | Standortplan als Kalender-Abo | Admin, Planer | Planübersicht › „Abonnieren“ neben dem Standort; ganzer Plan mit allen Eingeteilten. | fehlt | fehlt | S |
| D41 | Abwesenheitskalender als Abo | Admin | Abwesenheit › „Abonnieren“ oben links; Feed muss erst eingeschaltet werden. | fehlt | fehlt | S |
| D42 | Abo-Dialog | alle | Hinweis: Link ohne Passwort, wer ihn hat, sieht die Daten. Knöpfe „zu iPhone/Mac“ und „zu Google Kalender“, kopierbarer Link für Outlook. | fehlt | fehlt | S |
| D43 | Hilfe zu Kalendern | alle | Anleitungen iPhone, Apple-Kalender (Name, Farbe, Auto-Aktualisierung), Outlook („aus dem Web abonnieren“), Google inkl. Android-Sync; Entfernen je Kalender; übliche Abrufintervalle Outlook ~3 h, Google ~24 h, iPhone ~15 min. | fehlt | fehlt | S |
| D44 | Anmeldung mit E-Mail und Passwort | alle | Web-Anmeldeseite oder App; Zugang aus der Aktivierung. | `app/(auth)/login/page.tsx`, `lib/auth.ts` (zusätzlich Sperre nach 5 Fehlversuchen, `lib/login-throttle.ts`) | vorhanden | – |
| D45 | Aktivierung per Link oder Einladungscode | MA | Link aus der Einladungs-Mail oder Code; Passwort selbst wählen. | Aktivierungslink (`app/(auth)/activate/page.tsx`, `app/api/auth/activate/route.ts`); kein Code, keine Mail | teilweise | S |
| D46 | Passwort vergessen | alle | Link auf der Anmeldeseite → E-Mail eingeben → Mail mit Link → neues Passwort → Bestätigung. Hilfe, wenn keine Mail kommt: Konto nicht aktiviert, falsche Adresse, Spam. | fehlt; kein E-Mail-Versand im Projekt | fehlt | M |
| D47 | Passwort ändern | alle | Link auf der Ich-Seite neben „Profil bearbeiten“. | fehlt | fehlt | S |
| D48 | Mehrere Konten, Kontowechsel | alle | Gleiche E-Mail und gleiches Passwort für mehrere Firmen; Wechsel oben links (Web) bzw. Zahnrad › „Konto wechseln“ (App). | Schema erlaubt mehrere Mitgliedschaften, `lib/auth-helpers.ts` nimmt immer die älteste; kein Wechsel | fehlt | M |
| D49 | Abmelden | alle | App: Zahnrad-Menü, roter Eintrag. | Benutzermenü „Abmelden“ (`components/layout/user-menu.tsx`) | vorhanden | – |
| D50 | Schicht an bestimmte Person übergeben | MA | Schicht im Plan oder unter „Ich“ antippen → „Schicht übergeben“ → Person wählen. Wirksam erst nach Zustimmung der Person und ggf. Admin; bis dahin bleibt die Schicht beim Abgebenden. | Abgabe an alle (SWAP ohne Ziel) und Tausch zweier Schichten mit Zustimmung (EXCHANGE) (`lib/shift-requests.ts`, `app/api/mod-requests`); keine gerichtete einseitige Übergabe | teilweise | S |
| D51 | Status eines Tauschs | MA | In Tagesansicht und unter „Ich“: wartet auf wen (Kollege, Admin). | Statustexte in `components/workforce/requests.tsx` | vorhanden | – |
| D52 | Eingehende und ausgehende Schichten unter „Ich“ | MA | Eingehend: Schicht, Anfragender, „Tausch annehmen/ablehnen“, Status. Ausgehend: eigene Anfragen mit Status. | Abschnitt „Anträge“ auf der Startseite mit Zustimmen/Ablehnen/Zurückziehen (`requests.tsx`) | teilweise | S |
| D53 | Zähler an „Ich“ bei neuen Anfragen | MA | Rote Zahl am Menüpunkt. | Zähler nur für ungelesene Nachrichten | fehlt | S |
| D54 | Übernahme einer zugeteilten Kollegenschicht anfragen | MA | Fremde Schicht im Plan antippen → „Übernahme anfragen“; danach gleicher Ablauf wie D50. | Nur offene Plätze (TAKEOVER) und Tausch (EXCHANGE) (`app/api/mod-requests/route.ts`) | fehlt | S |
| D55 | Schicht allgemein freigeben | MA | „Schicht verfügbar machen“ mit Rückfrage; blaues Symbol im Wochenplan; Kollegen mit passender Position nehmen sie. | „Zur Übernahme anbieten“, Kollegen „Übernahme anbieten“, Freigabe durch Planung (`components/workforce/dashboard.tsx`, `requests.tsx`); Kennzeichnung nur in der Planer-Liste (`schedule/wish-plan.tsx`) | teilweise | S |
| D56 | Tausch ohne Admin-Freigabe (Kontoeinstellung) | Admin | Wahlweise wirkt der Tausch schon mit Zustimmung des Kollegen. | Freigabe immer nötig (bewusst, `docs/AKRO-ERWEITERUNG.md`) | anders gelöst | – |
| D57 | Tausch überschneidender Schichten | MA | Bei Auswahl eines Kollegen mit Schicht im selben Zeitraum: Warnung, dann nur Tausch möglich (Häkchen „stattdessen tauschen“). Nur der Abgebende kann so einen Tausch starten. | Tauschoptionen (`app/api/mod-requests/exchange-options`), Konfliktprüfung serverseitig; keine Warnliste „Personen mit Überschneidung“ | teilweise | S |
| D58 | Freie Schicht direkt nehmen | MA | Plan → Tag oder Schicht → „Schicht nehmen“; App: Tage seitlich, Wochen senkrecht wischen. | Bewusst Antrag mit Freigabe („Übernahme anfragen“, `components/schedule/shift-card.tsx`) | anders gelöst | – |
| D59 | Planansicht in der App | MA | Spalten je Tag, seitlich wischen; Wochenetikett; Schichtkarten mit Aktion; unten je Tag „Nachricht schreiben“. | Wochenansicht mit Vor/Zurück (`app/(dashboard)/schedule/employee/[kw]`), kein Wischen | teilweise | M |
| D60 | Wünsche für neuen Plan abgeben | MA | Mitteilung „Plan offen für Wünsche“; „Wünsche abgeben“ am Plan; alle Zeitfenster; antippen = rot (kann nicht), sonst grün; auch Teilzeiten; „Wünsche abgeben“ unten; später „Wünsche bearbeiten“. | Verfügbarkeit je Datum (`app/api/availability`); Einstellungsbereich „Wunschpläne“ zeigt „Bald verfügbar“ (`app/(dashboard)/settings/page.tsx`) | teilweise | M |
| D61 | Abwesenheit beantragen | MA | Ich › Abwesenheit › hinzufügen: Zeitraum, Typ, „zur Genehmigung einreichen“; Listen beantragt/genehmigt. Immer Admin-Freigabe. | `app/(dashboard)/employees/absences`, `app/api/absences/route.ts` | vorhanden | – |
| D62 | Stundenweise Abwesenheit | MA | Bei einem einzelnen Tag Häkchen „ganztägig“ entfernen, Uhrzeiten wählen. | `Absence` kennt nur Datum von/bis | fehlt | S |
| D63 | Urlaubskonto im Antrag | MA | Zeigt genommene + geplante Tage des Typs im Jahr gegen das Limit, rechnet den gewählten Zeitraum mit. | fehlt | fehlt | M |
| D64 | Abwesenheitskalender für Mitarbeitende | MA | Nur wenn freigeschaltet (D79). Eigene und – je Datenschutz – fremde genehmigte Abwesenheiten; Antrag per Klick auf einen Tag; offen = Glocke, genehmigt = persönliche Farbe. | Kalender zeigt Mitarbeitenden nur eigene (`components/employees/absence-calendar.tsx`, `app/api/absences/route.ts`) | teilweise | S |
| D65 | Stempeln in der App mit GPS | MA | Nur wenn Admin es einschaltet; dann GPS-Erlaubnis, Ortung nur bei offener App. Schicht antippen → Bereich als orangener Kreis auf Karte → einstempeln im Bereich; Laufzeit unter „Ich“; Pause starten, ausstempeln. | GPS-Check-in 50 m, Stoppuhr mit Pause (`lib/checkin.ts`, `components/workforce/checkins.tsx`, `components/time/stopwatch.tsx`); keine Karte | teilweise | S |
| D66 | Spontane Schicht anlegen und einstempeln | MA | Stempel-Symbol oben rechts unter „Ich“ → Standort, Position, erwartetes Ende → einstempeln; danach wie geplante Schicht. | Stoppuhr ohne Schichtbezug (`app/api/time/watch`); keine Schicht entsteht, kein erwartetes Ende | teilweise | M |
| D67 | Stempel-Terminal im Browser | MA, Admin | Gerät am Arbeitsort; Admin öffnet mit 6-stelligem Code; links Personenliste (heute Eingeteilte oben, Suche), rechts Tagesprotokoll; Person tippt Namen + 4-stellige PIN (im Profil sichtbar, per Mail anforderbar), wählt Schicht, stempelt ein/aus; standortbezogene Links möglich. | fehlt | fehlt | L |
| D68 | Pausenmodi | Admin | Pause vorab abgezogen / beim Ausstempeln Dauer aus Liste / Pause ein- und ausstempeln. | Pausenwert an der Schicht (`shift-form.tsx`), Pause per Stoppuhr | teilweise | M |
| D69 | Kommentar beim Ausstempeln | MA | Optional; nur Admins sehen ihn. | Freies Kommentarfeld an Zeitbuchungen (`app/api/time/route.ts`); keine Abfrage beim Beenden, Sichtbarkeit nicht begrenzt | teilweise | S |
| D70 | Stunden korrigieren | MA | Nur vergangene Schichten; Ich › Stunden › Schicht → Beginn/Ende, Grund → speichern; Status „wartet auf Freigabe“ → „genehmigt“. | Zeitkorrektur mit Begründung und Freigabe (`app/api/time/corrections/route.ts`, `components/time/time-list.tsx`) | vorhanden | – |
| D71 | Stundenübersicht für gewählten Zeitraum | MA | Ich › Stunden › Zeitraum wählen → erfasste und künftige Stunden. | Monatsweise (`components/time/time-list.tsx`, `/reporting`) | teilweise | S |
| D72 | Seite Benachrichtigungseinstellungen | alle | Web: Einstellungen › Benachrichtigungen oder Reiter neben Profil; App: Zahnrad › Benachrichtigungen; in App und Web gleich. | fehlt; nur Push-Leiste auf der Startseite (`components/workforce/push-setup.tsx`) | fehlt | M |
| D73 | Ereignisse für Mitarbeitende wählen | MA | Je Häkchen: Tauschaktivität, Änderung eigener Schicht, Abwesenheitsaktivität am eigenen Profil, neue verfügbare Schicht, von Admin geänderte Anwesenheit (Standard aus). | Alle Ereignisse immer als Postfach-Mitteilung (`notify` in `lib/planning.ts`) | fehlt | M |
| D74 | Ereignisse für Admins wählen, nach Positionen filtern | Admin | Schicht wechselt Besitzer, Tausch wartet auf Freigabe, jemand will Schicht loswerden, Abwesenheitsantrag; Auswahl „alle Rollen“ oder einzelne Positionen. | Mitteilungen an Zuständige je Standortrecht (`branchHolders` in `lib/access.ts`); nicht abschaltbar, kein Filter | teilweise | M |
| D75 | Kanal wählen (Push/E-Mail) | alle | Drei Optionen: Push und E-Mail-Ersatz nach 30 min ohne Zustellung / alles zusätzlich per E-Mail / keine E-Mail. Neues Push-Gerät schaltet E-Mail automatisch ab. Plan-Ereignisse kommen immer per E-Mail. | Nur Push; kein E-Mail-Versand | fehlt | M |
| D76 | Push-Geräteliste | alle | Jedes Gerät mit App-Anmeldung erscheint; je Gerät aktivieren/deaktivieren. | Ein/Aus nur für das aktuelle Gerät, höchstens 10 Geräte (`app/api/push/route.ts`); keine Liste | teilweise | S |
| D77 | Hinweis auf Handy-Systemeinstellungen | alle | Link in der App zu den Mitteilungs-Einstellungen des Telefons. | Hinweis bei blockierten Benachrichtigungen und iPhone-Installationshinweis (`push-setup.tsx`) | vorhanden | – |
| D78 | Startbildschirm-Widget | MA | iOS und Android, Größe wählbar: nächste Schicht (Datum, Zeit, Position), Zahl der Tauschanfragen bzw. verfügbaren Schichten, im größten Format Kollegen im selben Zeitraum. | fehlt; mit PWA nicht möglich | fehlt | L |
| D79 | Datenschutz: Abwesenheiten anderer und Abwesenheitskalender | Admin | Nur im Web: Einstellungen › Daten und Datenschutz. Schalter „Abwesenheiten anderer sichtbar“ mit Stufe alle / ohne Krankheit / ohne Typangabe; aus = nur Admins sehen fremde. Zweiter Schalter: Mitarbeitende sehen den Abwesenheitskalender (Web und App). | Fest: Mitarbeitende sehen nur eigene, Manager mit Personalrecht (`app/api/absences/route.ts`) | anders gelöst | S |
| D80 | Datenschutz: Kontaktdaten der Kollegen | Admin | Schalter: Telefon und E-Mail im Kollegenprofil sichtbar. | Kontaktdaten nur für Admins und Personalrecht „Profil ansehen“ (`app/api/employees/[id]/route.ts`) | anders gelöst | S |
| D81 | Schichtsichtbarkeit in vier Stufen | Admin | Aus (alles sichtbar, Standard) / Namen verbergen / Namen und Position verbergen (graue Blöcke) / alles verbergen, nur „n weitere Schichten“. Immer sichtbar: eigene, verfügbare, Anzahl. Admins und Superuser sehen alles. Jeder Admin darf ändern; wirkt sofort in Web und App. | Freigaben je Standort: „Dienstplan ansehen“ (mit Namen) oder „Offene Schichten“ (ohne Namen) (`lib/access.ts`, Hinweis in `components/settings/schedule-settings.tsx`); keine Anzahl fremder Schichten | anders gelöst | M |
| D82 | Gelöschte Mitarbeitende anonymisieren | Admin | Häkchen mit Frist 1–10 Jahre, Lauf nachts; „jetzt anonymisieren“ je Person. Name und Abwesenheitsbeschreibung weg, Zeiten und Abwesenheiten bleiben; Anzeige „anonyme Person Nr.“ in Stunden & Lohn. | Löschen = Deaktivieren (`DELETE app/api/employees/[id]/route.ts`); keine Anonymisierung, keine Löschfristen | fehlt | M |
| D83 | AV-Vertrag und Datenschutzerklärung im Konto | Admin | AV-Vertrag als PDF im Konto. | Kein AV-Bedarf (Eigenbetrieb); Datenschutzhinweis für Beschäftigte fehlt in der App | fehlt | S |
| D84 | E-Mail-Dienstleister außerhalb der EU | – | US-Dienst mit EU-Standardvertragsklauseln; Mails 45 Tage gespeichert; wer E-Mails abschaltet, sendet keine Daten dorthin. | Kein E-Mail-Versand; Push ohne Inhalt über Google/Apple/Mozilla/Microsoft (`lib/push.ts`) | anders gelöst | – |
| D85 | Dateien und DSGVO | Admin | Dateien verschlüsselt bei Übertragung und Speicherung; keine besonderen Kategorien oder Strafdaten laut AV-Vertrag. | Datei-Upload nicht umgesetzt (`file-browser.tsx`); Ordner nur für Admins | fehlt | M |
| D86 | Untere App-Leiste | MA | Fünf Reiter: Ich, Pläne, Aktivität, Nachrichten (Zähler), Mitarbeiter. | Heute, Plan, Zeit, Anträge, Mehr (`components/layout/mobile-nav.tsx`, `nav-config.ts`) | anders gelöst | S |
| D87 | Ich-Seite mit Reitern | MA | Kopf mit Zahnrad, Name, Stempel-Symbol; Reiter Schichten / Abwesenheit / Stunden; „nächste Schicht“ hervorgehoben; verfügbare und kommende Schichten; persönliche Stempel-PIN. | Startseite „Heute“ mit nächster Schicht, Bestätigung, weiteren und offenen Schichten (`components/workforce/dashboard.tsx`); Abwesenheit und Zeit auf eigenen Seiten | teilweise | M |
| D88 | Zahnrad-Menü | alle | Schichten in Kalender, Profil bearbeiten, Benachrichtigungen, Sprache, Abmelden. | Benutzermenü nur Hell/Dunkel und Abmelden (`user-menu.tsx`) | teilweise | S |
| D89 | Eigenes Profil bearbeiten | MA | Kontaktdaten, eigene Zusatzfelder (D9). | API erlaubt eigene Kontaktdaten (`PATCH app/api/employees/[id]/route.ts`), aber kein Weg dorthin in der Oberfläche; `/profile` hat keine Seite | teilweise | S |
| D90 | Sprache wählen | alle | Sprachauswahl im Zahnrad-Menü. | Texte fest deutsch; `messages/de.json` und `en.json` ohne Verwendung (kein `useTranslations`) | fehlt | M |
| D91 | Aktivitätsliste | alle | Eigener Reiter (App) bzw. Glocke mit Zähler (Web). | Systemmitteilungen landen im Postfach | anders gelöst | S |
| D92 | Mitarbeiterliste für Mitarbeitende | MA | Reiter mit Kollegen, deren Profil und Schichten. | Mitarbeitende ohne Personalrecht sehen keine Liste (`nav-config.ts`) | anders gelöst | – |

### Layout und Bedienung

**Hauptnavigation Web (Smartplan)**
- Waagerechte Kopfleiste: links Logo und Kontowahl (Aufklappliste), rechts Symbole mit Beschriftung: Pläne, Mitarbeiter, Nachrichten (Zähler), Abwesenheit, Stunden & Lohn, Ich (Zähler für Anfragen), Einstellungen (Aufklappliste), Glocke mit Zähler. Unten rechts Hilfe-Chat.
- Keine Seitenleiste; Inhalt mittig in breiten Karten.

**Startseite Web (Planübersicht)**
- Je Standort ein Abschnitt mit „Abonnieren“ (Kalender) rechts.
- Je Plan eine Karte: Zeitraum groß, farbiger Kopf mit Status (in Bearbeitung / in Aufbau – offen für Wünsche), Aktionen als Fußleiste (zur Einrichtung, Wünsche bearbeiten, löschen); letzte Karte „Neuen Plan anlegen“.

**Ich-Seite Web**
- Kopf: Name, „Profil bearbeiten“, „Passwort ändern“, Stempelcode; Reiter rechts: Deine Schichten / Abwesenheit / Stunden.
- Fünf Karten der nächsten Schichten (Datum, Wochentag groß, Zeit, Position mit Farbpunkt, Standort), „alle kommenden zeigen“, oben rechts „Schichten in Kalender“.
- Darunter „Eingehende Schichten“ als Zeilen: Datum, Position/Standort, Text der Anfrage, „Wartet auf …“, grüne/rote Knöpfe annehmen/ablehnen; dann „Ausgehende Schichten“.

**Nachrichten Web**
- Zwei Spalten: links „Nachricht schreiben“, „Nachrichten von …“, aufklappbarer Filter, Liste; rechts Karte mit Typ-Etikett, Sichtbarkeitshinweis, Text, Kommentare, Editor mit Werkzeugleiste, „Kommentar hinzufügen“.
- Tagesansicht im Plan: Wochentage oben (heute markiert, Sprung zur Woche), links Zeitfenster mit Personen (Initialen, Name, Position), rechts Tagesnachrichten mit Eingabe unten.

**Benachrichtigungseinstellungen**
- Eine Seite, oben Umschalter Profil | Benachrichtigungen. Abschnitte: Was (Häkchen mit Erklärzeile), für Admins zusätzlich Positionsfilter, Wo (drei Optionsfelder), „Speichern“, darunter Geräte als Kacheln mit Aktivieren/Deaktivieren.

**Mitarbeiter-App (Smartplan)**
- Untere Leiste: Ich, Pläne, Aktivität, Nachrichten, Mitarbeiter.
- Ich: farbiger Kopf (Zahnrad links, Name, Stempel-Symbol rechts), Segment-Reiter Schichten/Abwesenheit/Stunden, Karte „nächste Schicht“ mit Etikett, Listen „verfügbare Schichten“ (mit „alle zeigen“) und „kommende Schichten“ (Wochentag/Datum links, Position, Zeit, Standort), unten Stempel-PIN.
- Zahnrad: Klappmenü über der Seite mit Kalender, Profil, Benachrichtigungen, Sprache, Abmelden (rot).
- Pläne: Liste je Standort; Plan als Tagesspalten zum Wischen, Wochenetikett, Zeitfenster-Überschrift, Karten „verfügbare Schicht“ mit „Schicht nehmen“, je Tag unten „Nachricht schreiben“.
- Nachrichten: Liste mit Titel, Datum, Vorschau, Etikett „Tagesnachricht“; Kopf links „…“ (Filter), rechts Papierflieger.
- Kollegenprofil: Reiter Schichten/Abwesenheit/Stunden, Leiste Anrufen/SMS/E-Mail, kommende Schichten.
- Abläufe: Tausch = Schicht antippen → übergeben oder verfügbar machen → Person → bestätigen. Abwesenheit = Ich › Abwesenheit › hinzufügen → Zeitraum, Typ → einreichen. Stempeln = Schicht antippen → im Kreis einstempeln → Pause/ausstempeln. Korrektur = Ich › Stunden › Schicht → Zeiten, Grund → speichern.

**Was es benutzerfreundlich macht**
- „Ich“ bündelt alles Persönliche; Zähler am Menüpunkt zeigen, wo etwas wartet.
- Aktionen direkt an der Schicht (antippen → tauschen, stempeln, nehmen, Nachricht), kaum eigene Formulare.
- Web und App mit gleichen Abläufen; Status („wartet auf …“) überall sichtbar.
- Wenig Pflichtfelder (Person anlegen: Vorname + Position).
- Kommunikation am Ort (Tagesnachricht, Schichtnotiz) und trotzdem zentral im Postfach.
- Schichten ohne App sichtbar: Kalender-Abo, Widget.

**Unterschiede zu unserem Layout**
- Desktop: dunkle linke Seitenleiste mit Gruppen Arbeit / Personal / Organisation, Kopf mit Seitentitel, Datum/Uhrzeit, Verbindungsstatus (`components/layout/app-sidebar.tsx`, `top-nav.tsx`) statt Kopfleiste mit Symbolen.
- Mobil: Heute / Plan / Zeit / Anträge / Mehr; Nachrichten nur unter „Mehr“ (Zähler dort); keine Aktivität, keine Kollegen.
- Keine Ich-Seite: Persönliches verteilt auf Heute, Zeiterfassung, Anträge; kein Profil, kein Passwort ändern, keine Einstellungen für Mitarbeitende.
- Postfach als Ordner (Posteingang/Gesendet/Papierkorb) plus Portal (Dateien, Themen); Detail auf eigener Seite.
- Push-Schalter als Leiste auf der Startseite statt Einstellungsseite.
- Bei uns zusätzlich: Schichtbestätigung als Hauptaktion, Check-in-Karte, Startseite der Disposition mit Aufgaben-Kacheln.
- Vorschlag: mobile Leiste Ich / Plan / Zeit / Nachrichten / Mehr; Ich-Seite mit Reitern Schichten / Abwesenheit / Stunden und Zahnrad-Menü (Profil, Passwort, Benachrichtigungen, Kalender, Abmelden).

**PWA statt Store-App?**
- Mit unserer PWA abgedeckt: Installation auf dem Startbildschirm (`public/manifest.webmanifest`, `display: standalone`, Apple-Metadaten in `app/layout.tsx`), Web-Push (Android; iPhone ab iOS 16.4 nur aus der installierten App, Hinweis in `push-setup.tsx`), GPS nur bei offener Seite – Smartplan ortet laut Hilfe ebenfalls nur bei offener App –, Kalender-Abo per Link (sobald D39 gebaut ist).
- Nicht abgedeckt: Widget (D78); Push auf dem iPhone ohne Installationsschritt; Zähler am App-Symbol nur eingeschränkt; Auffindbarkeit im Store.
- Noch offen: Push-Gerätetest Android/iPhone (`docs/FERTIGSTELLUNG.md`); kein E-Mail-Ersatz, wenn ein Push nicht ankommt.
- Bewertung: Die PWA kann die Handy-App für AKRO ersetzen, wenn der Gerätetest besteht, ein E-Mail-Ersatz für Push eingerichtet ist und auf das Widget verzichtet wird. Eine Store-App (Hülle um die Web-App) lohnt erst, wenn Widget oder Push ohne Installationsschritt verlangt werden; Aufwand L plus Store-Konten und Pflege.

### Regeln

**Benachrichtigungen (Smartplan)**
- Mitarbeitende, je abschaltbar: Tauschaktivität (Kollege lehnt ab, bietet an, nimmt an), Änderung einer eigenen Schicht, Abwesenheit am eigenen Profil (angelegt, geändert, genehmigt, abgelehnt), neue für mich verfügbare Schicht, Anwesenheit von Admin geändert.
- Admins zusätzlich: Schicht wechselt Besitzer, Tausch wartet auf Freigabe, jemand will eine Schicht loswerden, Abwesenheitsantrag; einschränkbar auf Positionen.
- Nachrichten: Empfänger werden immer per Push oder E-Mail benachrichtigt, SMS optional; bei Tagesnachrichten nur die ausgewählten Personen.
- Kanäle: Push je Gerät (Telefon muss Mitteilungen erlauben), E-Mail. Standard nach erstem Push-Gerät: Push mit E-Mail-Ersatz nach 30 min. Alternativen: alles auch per E-Mail; keine E-Mail (Push bleibt aktiv).
- Immer per E-Mail, unabhängig von der Einstellung: neuer Plan mit Schichten, Plan geändert, Plan gelöscht, Plan offen für Wünsche.
- Zähler: ungelesene Nachrichten am Menüpunkt Nachrichten, neue Anfragen am Menüpunkt Ich.
- Schichtplaner heute: alle Ereignisse als Postfach-Mitteilung (Plan veröffentlicht/zurückgezogen, neue Schicht, Schicht geändert, abgesagt, Zuweisung aufgehoben, neue offene Schichten, Tausch- und Übernahmeanträge und Entscheidungen, Abwesenheits- und Zeitkorrektur-Anträge und Entscheidungen, Check-in-Freigaben, Standortmeldungen); dazu ein inhaltsleerer Sammel-Push je Person, nur für ungelesene Mitteilungen bis 1 h alt (`lib/push.ts`). Keine Auswahl, keine E-Mail, kein SMS.

**Anmeldung**
- Smartplan: Konto entsteht durch Aktivierung (Link aus Einladung oder Code), Passwort wählt die Person. Anmeldung mit E-Mail und Passwort in Web oder App. Passwort-Rücksetzung per Mail-Link. Gleiche Zugangsdaten für mehrere Firmen, Wechsel ohne neue Anmeldung.
- Schichtplaner: Aktivierungslink einmalig, 7 Tage gültig, neuer Link entwertet den alten; Weitergabe durch Admin, keine Mail. Sitzung 30 Tage (`lib/auth.ts`). 5 Fehlversuche je E-Mail in 15 min sperren 15 min (`lib/login-throttle.ts`). Nur aktive, aktivierte Mitgliedschaften dürfen sich anmelden.

**Datenschutz und Löschfristen**
- Sichtbarkeit wird zentral eingestellt (Abwesenheiten, Abwesenheitskalender, Kontaktdaten, Schichtsichtbarkeit); Admins sehen immer alles; Änderungen wirken sofort.
- Gelöschte Mitarbeitende: Arbeitszeiten und Abwesenheiten bleiben; Name und Abwesenheitsbeschreibung werden nach 1–10 Jahren (Lauf nachts) oder sofort entfernt.
- Konto löschen: zum Ende der bezahlten Periode, in der Testphase nach 14 Tagen; Pause bis 1 Jahr mit Datenerhalt.
- E-Mail-Dienstleister löscht nach 45 Tagen. Kalender-Feeds haben keinen Passwortschutz.
- Dateien: keine besonderen Kategorien (z. B. Gesundheit) und keine Strafdaten laut AV-Vertrag; verschlüsselt gespeichert. Für AKRO wichtig: Führungszeugnisse und Bewacherregister-Unterlagen nur mit klarer Rechtsgrundlage und eigener Zugriffsregel ablegen.
- Schichtplaner heute: keine Löschfristen; Zeitbuchungen werden nie gelöscht; Check-in speichert Entfernung, Genauigkeit, Alter, keine Koordinaten, Aufbewahrung unbegrenzt (offene Entscheidung in `docs/FERTIGSTELLUNG.md`); Push ohne Inhalt.

### Offen für die Erfassung im Konto

- Reiter „Aktivität“ (App) und Glocke (Web): Inhalt, welche Ereignisse, Sprungziele, Gelesen-Logik.
- Reiter „Mitarbeiter“ für normale Mitarbeitende: was ist sichtbar (Liste, Schichten, Stunden, Kontakt) bei Standardeinstellung.
- Reiter „Stunden“ unter Ich: Spalten (geplant, erfasst, Pausen, Zuschläge), Zeitraumwahl, Summen.
- Aktuelle Benachrichtigungsliste (Artikel und Bilder von 2023; „erweiterte Benachrichtigungen“ im Pro-Tarif): weitere Ereignisse, Erinnerungen vor Schichtbeginn, Push-Inhalt (mit oder ohne Details).
- Nachrichtentypen: wann öffentlich/Gruppe/privat; sehen später hinzukommende Mitarbeitende öffentliche Nachrichten; Anhang-Größe und -Typen; SMS-Kosten und Länder; ob SMS noch angeboten wird.
- Tagesnachricht: Standard-Empfänger, Sichtbarkeit bei Standorttrennung, Anzeige im Plan (Symbol am Tag?).
- Kalender-Feed: Inhalt der Termine (Titel, Ort, Position, Kollegen, Notizen), Zeitraum vor/zurück, Zeitzone, Nachtschichten, Link zurücksetzen oder abschalten, Feed für Mitarbeitende ohne Admin-Recht.
- Anmeldung: „angemeldet bleiben“ (Kästchen `remember_me` laut `docs/SMARTPLAN-ABGLEICH.md`), Sitzungsdauer, Passwortregeln, Sperre nach Fehlversuchen, Zwei-Faktor, Einladungscode-Ablauf.
- Stempel-PIN/-Code: wo genutzt (Terminal), Änderung, Anzeige in App und Web.
- Daten und Datenschutz: vollständige Liste der Schalter auf der Seite, Standardwerte, Ort des AV-Vertrags.
- Anonymisierung: welche Felder genau (Nachrichten, Kommentare, Dateien, Stempeldaten), Auswahl der Jahre.
- Kennzeichnung freigegebener Schichten im Wochenplan (blaues Symbol) und Tausch-Status in der Tagesansicht.
- Planstatus und Farben auf der Planübersicht; Ablauf „Plan offen für Wünsche“ aus Sicht der Mitarbeitenden (Frist, Erinnerung).
- Widget-Größen und Inhalt je Größe.
- Sprachen der App.
- Ersteinrichtung eines neuen Kontos (Assistent, Anlage der Positionen).
- Zeitumstellung: Anzeige der Stunden im Plan und in Stunden & Lohn bei 23–11-Schichten.
