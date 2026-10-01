# Rollen, Rechte und Funktionen – Analyse

Stand der Analyse: 01.10.2026, Branch `feat/plan-delete-assign-copy-pdf`, Commit `cb3b1c3`
(GitHub-`master` steht auf `a9f5b9d`; die mit **[Neu]** markierten Funktionen gibt es nur auf dem Branch).
Reine Code-Analyse (Oberfläche, API, Berechtigungslogik, Datenmodell); für diese Analyse wurden keine Tests
ausgeführt. Die volle Testsuite lief zuvor auf demselben Code-Stand grün (2274 Prüfungen).

Kennzeichnung: **UI** = über die Oberfläche nutzbar · **API** = nur serverseitig · **Teilweise** ·
**Nur Doku** = nicht nachweisbar umgesetzt · **Widerspruch** = fehlerhaft/widersprüchlich.

---

## 1. Gesamtübersicht

Die Rechte entstehen aus **drei Stufen**:

1. **Rolle** (organisationsweit): Inhaber und Administration dürfen ohne weitere Einstellungen alles. Disposition und
   Mitarbeiter dürfen von sich aus fast nichts außer eigenen Daten.
2. **Standortfreigaben** (je Einsatzort): bestimmen, *wo* jemand planen, sehen, entscheiden oder Zeiten sehen darf – 8 Einzelrechte.
3. **Personalzuordnungen** (je Person, nur für Disposition): bestimmen, *wessen* Personaldaten, Abwesenheiten oder
   Stunden jemand sehen/bearbeiten darf – 6 Einzelrechte.

Grundregeln (`src/lib/access.ts`, Funktionen `can`, `canStaff`, `timeScope`):
- Standortfreigaben geben **nie** Zugriff auf Personaldaten, Personalzuordnungen **nie** auf Standorte.
- Fremde Stunden sieht nur, wer **beides** hat: Standortrecht für den Ort der Buchung **und** Personalrecht „Stunden einsehen“.
- Rechte werden bei **jeder** Anfrage frisch geladen – Entzug und Deaktivierung wirken sofort.
- Es gibt **keine echte Rangfolge**: Inhaber und Administration sind technisch gleich (`isAdminRole`), die Disposition
  erbt nichts automatisch. Die README-Aussage „Owner > Admin > Manager > Employee“ stimmt so nicht.

---

## 2. Rollen

| | Inhaber | Administration | Disposition | Mitarbeiter |
|---|---|---|---|---|
| Name in Navigation/Benutzermenü | „Inhaber“ | „Administration“ | „Disposition“ | „Mitarbeiter“ |
| Name in Mitarbeiterliste/Profil/Formularen | „Owner“ | „Admin“ | „Manager“ | „Mitarbeiter“ |
| Technisch | `OWNER` | `ADMIN` | `MANAGER` | `EMPLOYEE` |

(Uneinheitlich: `nav-config.ts` `rollenName` gegenüber `employee-list.tsx`/`employee-detail.tsx` `getRoleLabel`.)

### Inhaber (OWNER)
- **Für:** Firmenleitung. Entsteht einmalig bei der Ersteinrichtung (`/register`, nur solange keine Organisation
  existiert oder `ALLOW_REGISTRATION=true`; `src/lib/security.ts` `isRegistrationOpen`).
- **Sieht/Darf automatisch:** exakt dasselbe wie die Administration – es gibt keine Funktion nur für den Inhaber.
- **Nach Freigabe:** nichts; Freigaben lassen sich ihm nicht erteilen (`access/route.ts` PUT).
- **Darf nicht:** eigene Rolle ändern, eigene Schichtanträge entscheiden, Zeitbuchungen löschen (niemand darf das).
- **Vergabe:** niemand kann die Rolle vergeben, entziehen oder übertragen (`OWNER` fehlt in der Rollenauswahl).
- **Schutz:** kann weder deaktiviert noch gelöscht noch in der Rolle geändert werden – auch nicht von Admins.

### Administration (ADMIN)
- **Für:** Büroleitung/Geschäftsführung mit voller Verwaltung.
- **Sieht:** alle Navigationspunkte (Heute, Dienstplan, Mitarbeiter, Abwesenheiten, Zeiterfassung, Einsatzorte,
  Auswertung, Nachrichten, Einstellungen).
- **Automatisch:** alle Kunden/Standorte (auch Altbestand ohne Standort), alle Personen mit allen Personalrechten, alle
  Pläne inkl. Entwürfe, alle Zeiten inkl. ohne Standort, Rollen und Freigaben vergeben, Einstellungen, Kataloge, Kategorien.
- **Darf nicht:** eigene Rolle ändern, sich selbst deaktivieren/löschen, Inhaber ändern, eigene Schichtanträge
  entscheiden, Zeitbuchungen löschen, Zeiten gelöschter Personen ändern.
- **Vergabe:** durch Inhaber/Admin im Personalprofil („Rolle“ bzw. „Aktionen“) oder beim Anlegen.
- **Schutz:** nur das eigene Konto – **ein Admin kann andere Admins herabstufen, deaktivieren oder löschen.**

### Disposition (MANAGER)
- **Für:** Einsatzleitung, Planung, Personalsachbearbeitung – alle, die nur Teilbereiche verwalten.
- **Sieht ohne Freigaben:** Heute (Planungsansicht, leer), Abwesenheiten (eigene), Zeiterfassung (eigene), Auswertung
  (eigene Zeile), Nachrichten. „Dienstplan“ erst mit „Dienstplan ansehen“ irgendwo, „Mitarbeiter“ erst mit mindestens
  einer Personalzuordnung, „Einsatzorte“ erst mit irgendeiner Standortfreigabe.
- **Automatisch:** nur eigene Daten und Ansehen des Qualifikationskatalogs.
- **Nach Freigabe:** alle 8 Standortrechte je Standort, alle 6 Personalrechte je zugeordneter Person; Mitarbeiterkonten
  anlegen, sobald „Schichten erstellen und bearbeiten“ an mindestens einem Standort besteht.
- **Darf nicht:** Einstellungen, Kunden/Standorte anlegen oder ändern, Rollen/Freigaben vergeben, Konten deaktivieren,
  Kontaktdaten anderer ändern, Arbeitsbereiche und Katalog pflegen, Zeiten ohne Standort sehen, Soll anderer in der
  Auswertung sehen, Manager/Admins löschen, Eigenes entscheiden (Abwesenheit, Korrektur, Antrag, Check-in).
- **Vergabe:** nur Inhaber/Admin.

### Mitarbeiter (EMPLOYEE)
- **Sieht:** Heute, Mein Dienstplan, „Standortpläne“ (nur mit Freigabe), Zeiterfassung, Anträge, Nachrichten.
- **Automatisch:** eigene veröffentlichte Schichten, Stoppuhr, Zeiten nachtragen, Korrekturen beantragen, Abwesenheiten
  beantragen, Verfügbarkeit, Check-in zu eigenen Schichten, eigene Schicht anbieten, Nachrichten an sichtbare Personen,
  Themen lesen/schreiben, Dateien ansehen, eigene Monatsstunden.
- **Nach Freigabe** (nur zwei Rechte möglich, `allowedBranchRights`): „Offene Schichten sehen und anfragen“
  (= **Standortzuordnung**) und „Dienstplan ansehen“ (veröffentlichter Plan mit Namen).
- **Darf nicht:** planen, Entwürfe sehen, Personaldaten anderer, etwas entscheiden, Einstellungen, Personalliste.
- **Vergabe:** Admin oder Disposition beim Anlegen.

---

## 3. Rechte

### 3.1 Nur über die Rolle (Inhaber/Administration)
Einstellungen · Kunden und Einsatzorte samt GPS · Arbeitsbereiche · Qualifikationskatalog · Abwesenheits- und
Zeitkategorien, Feiertagsregion · Rollen und Freigaben vergeben · Konten deaktivieren/reaktivieren · Einladungslinks für
jedes Konto · Kontaktdaten anderer ändern · Zeitbuchungen einem Standort zuordnen · Altpläne ohne Standort · Dateiordner
anlegen · Themen löschen · KI.

### 3.2 Standortrechte (je Einsatzort)

Vergeben immer durch die Administration im Profil der Person („Zugriffe“); Ausnahme siehe letzte Zeile.
Quelle: `src/lib/access-shared.ts` `BRANCH_RIGHTS`.

| Recht in der Oberfläche | Bedeutung | Für wen möglich | Was es konkret ermöglicht | Was es nicht ermöglicht |
|---|---|---|---|---|
| **Dienstplan ansehen** | Vollständiger Standortplan | Disposition, Mitarbeiter | Plan mit Namen, Monatsplan, PDF; Disposition sieht auch **Entwürfe** und Bestätigungsstatus; Eingeteilte werden als Nachrichten-Empfänger sichtbar. **Schließt „Offene Schichten anfragen“ automatisch ein.** | Nichts ändern; keine Personaldaten oder Zeiten; Mitarbeiter keine Entwürfe |
| **Schichten erstellen und bearbeiten** | Planen | nur Disposition | Schichten anlegen, ändern, wiederholen, kopieren, löschen (nur künftige), Plätze ändern, besetzen/entfernen/wechseln, Briefing, Live-Modus, Darstellung; Mitarbeiter anlegen und eigenen Standorten zuordnen. Schließt „ansehen“ ein. | Veröffentlichen, Anträge entscheiden; nur Personen aus dem Planungskreis einplanen |
| **Dienstplan veröffentlichen** | Freigabe der Woche | nur Disposition | Wochenplan veröffentlichen/zurückziehen (mit Benachrichtigung). Schließt „ansehen“ ein. | Schichten ändern |
| **Anträge und Schichtübernahmen bearbeiten** | Entscheidungen | nur Disposition | Übernahme, Abgabe, Tausch genehmigen/ablehnen, Filter „Wünsche“, Benachrichtigung über neue Anträge. Schließt „ansehen“ ein. | Eigene Anträge; **Abwesenheiten** (Personalrecht); Zeitkorrekturen |
| **Zeiterfassung und Auswertungen einsehen** | Zeiten sehen | nur Disposition | Zeiten, Auswertung, Check-in-Übersicht für Buchungen **dieses** Standorts – **nur** für Personen mit „Stunden einsehen“ | Allein wirkungslos; kein Soll anderer |
| **Zeiterfassung bearbeiten** | Zeiten pflegen | nur Disposition | Zeiten nachtragen, Korrekturen und manuelle Check-ins entscheiden (mit „Stunden einsehen“). Schließt „einsehen“ ein. | Eigene Korrekturen; Zeiten löschen |
| **Standortmeldungen bearbeiten** | Interne Meldungen | nur Disposition | Meldungen ansehen, anlegen, zuweisen, erledigen | Keine Schichten |
| **Offene Schichten sehen und anfragen** | Standortzuordnung | Mitarbeiter, Disposition | Offene Plätze **ohne Namen**, Übernahme anfragen, angebotene Schichten übernehmen, Tauschpartner sein; Person gehört zum **Planungskreis** des Standorts | Keine Namen, keine Entwürfe. **Vergabe auch durch Disposition** an „Einplanen“-zugeordnete Mitarbeiter an eigenen Planungsstandorten (`src/lib/staff-sites.ts`) |

Voreinstellungen: Disposition „Plan ansehen“, „Planen“ (ansehen, bearbeiten, Anträge), „Standortverantwortung“ (alle
außer „Offene Schichten“); Mitarbeiter „Offene Schichten“, „Standortplan ansehen“.

### 3.3 Personalrechte (je zugeordneter Person, nur Disposition)

Vergeben durch die Administration im Profil der **Disposition** („Zugriffe“ → Mitarbeiter zuordnen). Ausnahme: Wer als
Disposition selbst ein Konto anlegt, bekommt die Person automatisch mit „In Schichten einplanen“ zugeordnet.
Zugeordnet werden können Mitarbeiter und auch andere Manager.

| Recht in der Oberfläche | Was es konkret ermöglicht | Was es nicht ermöglicht |
|---|---|---|
| **In Schichten einplanen** | Person steht beim Besetzen zur Auswahl („Persönlich zugeordnet“) – auch an Standorten ohne ihre Standortzuordnung; Verfügbarkeiten sichtbar; Standortzuordnung an eigenen Planungsstandorten pflegen | Profil/Kontaktdaten |
| **Personalprofil ansehen** | Profilseite: E-Mail, Telefon, Tätigkeit, Qualifikationen; Kontaktdaten in der Liste | Beschäftigungsart, Sollstunden, Notizen; nichts ändern |
| **Stammdaten bearbeiten** | Tätigkeit, Beschäftigungsart, Sollstunden/Monat, Qualifikationen ändern; Notizen lesen/schreiben. Schließt „ansehen“ ein. | **Name, E-Mail, Telefon** ändern (nur Admin oder die Person selbst); Rolle, Status |
| **Abwesenheiten einsehen und entscheiden** | Abwesenheiten der Person sehen, eintragen (auf Wunsch direkt genehmigt), genehmigen/ablehnen | Eigene Abwesenheiten |
| **Stunden einsehen** | Zeiten und Monatswerte der Person – **nur an Standorten mit „Zeiterfassung einsehen“** | Allein wirkungslos; kein Soll |
| **Mitarbeiter löschen** [Neu] | Endgültiges Löschen (nur Rolle Mitarbeiter). Schließt „ansehen“ ein. Nie per Voreinstellung. | Manager/Admins löschen |

Voreinstellungen: „Einplanen“ (einplanen + Profil ansehen), „Personalverantwortung“ (alles außer Löschen).

### 3.4 Eigene Daten (jede Rolle, ohne Freigabe)
Eigene veröffentlichte Schichten, eigene Zeiten ansehen, Stoppuhr mit Pause, Zeiten nachtragen (**sofort wirksam, ohne
Freigabe**), Korrektur beantragen, Abwesenheit beantragen (solange offen ändern/zurückziehen), Verfügbarkeit,
Check-in, eigene Monatsstunden inkl. Soll, Nachrichten, Push, eigene Schicht anbieten oder tauschen, alte unbestätigte
Zuweisung bestätigen. Eigene Kontaktdaten ändern: nur über die Schnittstelle (keine Profilseite).

### 3.5 Abhängigkeiten und Kombinationen
- **Eingeschlossen:** „bearbeiten“, „veröffentlichen“, „Anträge“ → „Dienstplan ansehen“; **„Dienstplan ansehen“ →
  „Offene Schichten anfragen“ (auch bei der Disposition)**; „Zeit bearbeiten“ → „Zeit einsehen“; „Stammdaten“ und
  „Löschen“ → „Profil ansehen“.
- **Mehrere Rechte gleichzeitig:**
  - Fremde Zeiten sehen: „Zeit einsehen“ am Standort der Buchung **+** „Stunden einsehen“.
  - Nachtragen, Korrekturen, manuelle Check-ins entscheiden: „Zeit bearbeiten“ **+** „Stunden einsehen“.
  - Einplanen: „bearbeiten“ am Standort **+** Person im Planungskreis (Standortzuordnung dort; Mitarbeiter anderer
    Standorte **desselben Kunden**, an denen man ebenfalls plant; persönlich mit „Einplanen“ Zugeordnete;
    Admins: alle aktiven Personen) – `planningPool` in `src/lib/planning.ts`.
  - Tausch zwischen zwei Standorten entscheiden: „Anträge“ an **beiden**, sonst nur Administration.
  - Standortzuordnung pflegen (Disposition): „Einplanen“ für die Person **+** „bearbeiten“ am Standort.
- **Standortzuordnung → Mitarbeiterdaten?** Nein. Nur Namen im Plan (mit „ansehen“); in der Besetzungsauswahl kurze
  Gründe wie „Genehmigte Abwesenheit“ (ohne Art) oder „Als nicht verfügbar eingetragen“.
- **Mitarbeiterzuordnung → deren Standorte?** Nein. „Einplanen“ erlaubt aber, die Person an den **eigenen** Standorten
  einzuplanen und ihr dort die Standortzuordnung zu geben.
- **Entzug:** wirkt ab der nächsten Anfrage; Live-Verbindungen werden neu geprüft (`refreshRealtime`). Beim
  Rollenwechsel werden nicht passende Freigaben entfernt.
- **Deaktivierung:** Anmeldung gesperrt, laufende Sitzungen sofort abgemeldet; die Person verschwindet aus Listen,
  Planungskreisen und Empfängern der Disposition; Zeiten bleiben; **künftige Zuweisungen bleiben bestehen** („nicht
  verfügbar“, zählen als offen, Platz erst nach Entfernen/Wechseln neu besetzbar). Reaktivieren nur durch Admin.

---

## 4. Funktionen aus Benutzersicht

Abkürzungen: A = Inhaber/Administration, D = Disposition, M = Mitarbeiter; Rechte gekürzt
(„ansehen“, „bearbeiten“, „veröffentlichen“, „Anträge“, „Zeit einsehen/bearbeiten“, „Standortzuordnung“; Personal:
„Einplanen“, „Profil“, „Stammdaten“, „Abwesenheiten“, „Stunden“, „Löschen“).

### Zugang und Konten

**Anmeldung, Einladung, Aktivierung** – UI
- Wo: `/login`; Einladungslink im Personalprofil bzw. in der Mitarbeiterliste; Aktivierung `/activate`.
- Wer: Admin für alle Konten; D nur für selbst angelegte, noch zugeordnete Mitarbeiter.
- Schritte: Konto anlegen → angezeigten Link (7 Tage gültig) **persönlich weitergeben** → Person vergibt Passwort
  (mindestens 12 Zeichen, Groß-/Kleinbuchstaben, Ziffer).
- Grenzen: **kein E-Mail-Versand**; nach 5 Fehlversuchen 15 Minuten gesperrt; **kein „Passwort vergessen“/„ändern“**,
  neuer Link nur vor der ersten Aktivierung.

**Mitarbeiter anlegen** – UI
- Wo: Mitarbeiter → „Mitarbeiter hinzufügen“ (mehrere auf einmal, Rolle, Standorte, Qualifikationen).
- Wer: Admin (alle Rollen außer Inhaber); D mit „bearbeiten“ an mindestens einem Standort – nur Rolle Mitarbeiter,
  nur eigene Standorte, Person wird automatisch mit „Einplanen“ zugeordnet.
- Grenzen: D kann keine vorhandene E-Mail-Adresse anbinden. **Widerspruch:** Der Menüpunkt „Mitarbeiter“ erscheint für
  D erst, wenn ihr schon jemand zugeordnet ist (`nav-config.ts` `faehigkeiten`) – das erste Konto nur über `/employees`.

**Personalprofil** – UI
- Wo: Mitarbeiter → Person. Inhalt: Kontakt, Tätigkeit, Beschäftigungsart (Vollzeit/Teilzeit/Minijob/Werkstudent/
  Aushilfe), **Sollstunden pro Monat** (leer = nicht festgelegt), Qualifikationen, Notizen.
- Wer: Ansehen A oder „Profil“; Vertragsdaten und Notizen A oder „Stammdaten“; Kontaktdaten ändern A oder die Person selbst.
- Grenzen: **Teilweise** – Kachel „Monatsübersicht/E-Dash“ ist ein Platzhalter, Schaltfläche „Stunden“ dauerhaft
  deaktiviert; Wochen-Sollstunden gibt es in der Oberfläche nicht mehr.

**Rolle ändern** – UI
- Wo: Personalprofil („Rolle“ oder „Aktionen“). Wer: Admin.
- Grenzen: nicht Inhaber, nicht sich selbst; **greift sofort ohne Rückfrage**; unpassende Freigaben werden entfernt.

**Zugriffe vergeben (Rechte-Editor)** – UI
- Wo: Personalprofil einer Disposition oder eines Mitarbeiters, Abschnitt „Zugriffe“. Wer: nur Admin.
- Was: Standortfreigaben je Standort (mit Voreinstellungen); bei D Personen mit Personalrechten zuordnen; Anzeige, welche
  Manager für eine Person zuständig sind.
- Grenzen: jede Person **einzeln**, kein „alle Mitarbeiter“; Admins/Inhaber nicht zuordenbar.

**Standortzuordnung von Mitarbeitern** – UI
- Wo: Mitarbeiterliste → „Standorte“, oder beim Anlegen.
- Wer: Admin alle Standorte; D nur eigene Planungsstandorte und nur für „Einplanen“-Zugeordnete.
- Grenzen: Freigaben über die reine Zuordnung hinaus („Dienstplan ansehen“) ändert nur der Admin.

**Deaktivieren/Reaktivieren** – UI
- Wo: Personalprofil → Aktionen. Wer: Admin (nicht sich selbst, nicht Inhaber). Wirkung siehe 3.5.

**Mitarbeiter endgültig löschen** – UI [Neu]
- Wo: Personalprofil → Aktionen → „Mitarbeiter löschen“.
- Wer: Admin (alle außer sich und Inhaber); D mit „Löschen“ (nur Rolle Mitarbeiter).
- Schritte: Dialog zeigt Name, künftige Zuweisungen, verbleibende Historie und Sperrgründe → Häkchen → „Endgültig löschen“.
- Danach: künftige Zuweisungen entfernt (Schichten wieder offen, Planung informiert), offene Anträge geschlossen und
  Beteiligte informiert, Konto und Sitzungen gelöscht (bei Nutzung in einer weiteren Organisation bleibt es dort);
  Arbeitszeiten, Check-ins und vergangene Einsätze bleiben nur mit Vor- und Nachname (Auswertung „gelöscht“).
- Grenzen: gesperrt bei laufender Zeiterfassung, offenem Check-in-Antrag oder laufendem Einsatz; **Abwesenheiten werden
  mitgelöscht**. In `master` heißt die Aktion „Deaktivieren“ und deaktiviert nur.

### Organisation

**Kunden und Einsatzorte** – UI
- Wo: Einsatzorte (Pfad `/divisions`). Kunden mit Notizen; Standorte mit Adresse, Treffpunkt, Hinweisen, zulässigen
  Tätigkeiten, GPS (Koordinaten, Radius, Pflicht-Check-in), aktiv/inaktiv.
- Wer: Anlegen/ändern/löschen A; D sieht nur freigegebene Standorte (ohne Kundennotizen).
- Grenzen: Löschen nur ohne fachliche Daten.

**Arbeitsbereiche** – UI: Einsatzorte (unten, nur A). Farbige Bereiche mit Mitgliedern; Planer bekommen den Hinweis
„Gehört nicht zum Arbeitsbereich“.

**Standortmeldungen** – UI: Startseite (Kundenkarten) und Wochenplan; A oder „Standortmeldungen bearbeiten“; interne
Meldungen (offen/in Arbeit/erledigt) mit Zuständigem. Mitarbeiter können nichts melden.

**Qualifikationen** – UI: Einstellungen → Qualifikationen; Katalog pflegt nur A, D sieht ihn. Umbenennen wirkt überall;
Löschen nur, wenn bei keiner aktiven Person und keiner künftigen Schicht eingetragen.

### Dienstplan

**Ansichten** – UI
- Woche (Karten), Klassische Tabelle, Mitarbeiter-Ansicht, Monat; je Standort oder zusammengeführt.
- Wer: je Standort „ansehen“; zusammengeführt: eigene veröffentlichte Schichten, freigegebene Standorte, offene Plätze
  mit „Standortzuordnung“. Mitarbeiter sehen keine Entwürfe; Namen anderer nur mit „ansehen“.

**Schicht erstellen und wiederholen** – UI
- Wo: Woche eines Standorts → „Schicht hinzufügen“ bzw. „+ Schicht“.
- Was: Zeiten (Ende vor Beginn = Folgetag), Arbeitsbereich, Tätigkeit, Plätze, Pause/Pausenregel, Wochentage,
  Wiederholung 1–52 Wochen, Qualifikationen, Hinweise; **optional „Mitarbeiter auswählen“** mit Prüfung je Termin [Neu].
- Wer: A oder „bearbeiten“.
- Danach: bei veröffentlichtem Plan „Neue offene Schichten“ an Mitarbeiter mit Standortzuordnung; Eingeteilte erhalten
  „Neue Schicht – fest eingeteilt“.
- Grenzen: nur aktive Standorte mit Kunde; Konflikte mit Person, Datum, Ursache – alles oder nichts [Neu].

**Schicht bearbeiten** – UI: Klick auf die Karte, „+ Platz“ auf der Karte. Wer: „bearbeiten“ (Umzug: an beiden
Standorten). Eingeteilte bekommen nur bei Änderung von Tag, Zeit, Ort, Pause oder Tätigkeit eine Information [Neu]
(in `master`: jede Änderung setzt die Bestätigung zurück). Änderungen, die eine Person neu sperren würden, werden abgelehnt.

**Schicht kopieren** – UI [Neu]: „Kopieren“ auf der Karte oder im Bearbeiten-Fenster; mehrere Zieltage, Zuweisungen
optional, Vorschau mit Konflikten und Doppel-Hinweis; nur derselbe Standort. In `master`: ein Datum, keine Zuweisungen.

**Schicht löschen** – UI [Neu: Schutz]: Bearbeiten-Fenster → „Schicht löschen“; „bearbeiten“, auch Admins nur für
künftige Schichten ohne Check-in und ohne erfasste Zeiten, sonst Grund im Dialog; Zuweisungen und offene Anträge werden
geschlossen, Betroffene informiert. In `master` lassen sich auch vergangene Schichten löschen (Plan- und Ist-Stunden
fallen dann auseinander).

**Besetzen, entfernen, wechseln** – UI
- Wo: Schichtkarte – „Mitarbeiter zuweisen“, X, Wechsel-Symbol ⇆ [Neu].
- Wer: „bearbeiten“; Person im Planungskreis.
- Auswahl in Gruppen: frei am Standort → belegt/abwesend am Standort → frei an anderen Standorten desselben Kunden →
  belegt/abwesend dort → übrige einplanbare Personen. Hinweise (z. B. fehlende Qualifikation) einmal bestätigen; harte
  Sperren (Überschneidung, genehmigte Abwesenheit, „nicht verfügbar“, inaktiv) nicht übergehbar.
- Danach: je eine Nachricht an jede betroffene Person.
- Grenzen: kein Entfernen/Wechseln nach Schichtende oder nach dem Check-in der Person [Neu].

**Veröffentlichen und Bestätigung** – UI
- Wo: Wochenleiste „Veröffentlichen“/„Zurückziehen“; Wer: „veröffentlichen“. Informiert werden Personen mit „ansehen“
  oder Standortzuordnung sowie alle Eingeteilten.
- Zuweisungen durch Planung/Administration gelten **sofort als „fest eingeteilt“** [Neu]; nur ältere Zuweisungen
  unklarer Herkunft zeigen „nicht bestätigt“ mit Knopf. In `master` muss jede Zuweisung bestätigt werden.

**Briefing** – UI: schreiben mit „bearbeiten“; lesen mit „ansehen“, Standortzuordnung bei veröffentlichten Plänen oder
als Eingeteilte.

**Live-Modus** – Teilweise: Start/Stopp mit Protokoll; gebucht wird trotzdem über normale Anträge mit Freigabe. Frist,
Tage, Überbuchung sind in der Datenbank vorgesehen, aber nicht bedienbar und ohne Wirkung (README „deadline controls“
trifft nicht zu).

**Filter „Wünsche“** – UI: hebt Schichten mit offenen Übernahmeanfragen hervor (mit „Anträge“). Einen eigenständigen
Wunschplan gibt es nicht; Einstellungsseite „Wunschpläne“ zeigt nur „Bald verfügbar“.

### Personal und Anträge

**Verfügbarkeit** – UI: Anträge/Abwesenheiten → „Verfügbarkeit“; eigene Zeitfenster „verfügbar/nicht verfügbar“.
Sichtbar für die Person, A und D mit „Einplanen“. „Nicht verfügbar“ sperrt die Einteilung; Schicht außerhalb eines
Fensters erzeugt einen Hinweis.

**Abwesenheiten** – UI
- Wo: Anträge/Abwesenheiten (Liste oder Kalender mit Feiertagen).
- Wer: beantragen jede Person für sich; eintragen/entscheiden A oder „Abwesenheiten“.
- Danach: Nachricht an die Person; genehmigte Abwesenheit sperrt Einteilung, bestehende Zuweisungen erscheinen
  „nicht verfügbar“.
- Grenzen: D nicht für sich selbst; **Admins können eigene genehmigen**; Kategorien und Feiertagsregion pflegt A.

**Übernahme, Abgabe, Tausch** – UI
- Wo: Startseite → „Anträge“; Schichtkarte „Übernahme anfragen“.
- Was: offene Schicht anfragen (Standortzuordnung nötig); eigene künftige Schicht abgeben, ein Kollege mit
  Standortzuordnung meldet sich; Tausch eigener gegen fremde Schicht (nur passende Angebote).
- Ablauf: Antrag → (Tausch: Zustimmung der anderen Person) → Entscheidung durch „Anträge“ an allen beteiligten Standorten,
  sonst Admin. Bis zur Genehmigung bleibt alles unverändert; Tausch ganz oder gar nicht.
- Grenzen: nur veröffentlichte, künftige Schichten; niemand entscheidet eigene Anträge.

### Zeit und Anwesenheit

**Zeiterfassung** – UI
- Wo: Zeiterfassung. Stoppuhr mit Pause; „+“ für Von/Bis- oder Dauererfassung; Monatsliste je Person.
- Wer: eigene alle; fremde sehen „Zeit einsehen“ + „Stunden“; für andere nachtragen „Zeit bearbeiten“ + „Stunden“;
  Standort zuordnen nur A.
- Grenzen: **eigene Nachträge wirken ohne Freigabe**; bestehende Buchungen nur per begründetem Korrekturantrag
  (Entscheidung durch „Zeit bearbeiten“ + „Stunden“, nicht für eigene – **Admins doch**); Löschen für niemanden;
  Buchungen ohne Standort sieht nur A.

**Check-in mit Standortprüfung** – UI
- Wo: Startseite „Jetzt einchecken“ (ab 30 Minuten vor Beginn bis Schichtende, nur HTTPS); bei Problemen manueller Antrag.
- Wer: Eingeteilte; Team-Übersicht mit „Zeit einsehen“ + „Stunden“; manuelle Anträge entscheiden mit
  „Zeit bearbeiten“ + „Stunden“.
- Grenzen: mit „GPS-Check-in erforderlich“ startet die Stoppuhr erst nach Check-in; keine Koordinaten gespeichert;
  Browser-Position fälschbar – kein fälschungssicherer Nachweis.

### Kommunikation, Auswertung, Einstellungen

**Nachrichten und Benachrichtigungen** – UI
- Wo: Nachrichten (Posteingang, Gesendet, Papierkorb). Admins schreiben allen, alle anderen nur „sichtbaren“ Personen
  (`visiblePeople`: sich selbst, Inhaber/Administration, eigene Zuständige und Planung der eigenen Einsatzorte,
  zugeordnete Personen, mit „ansehen“ die Eingeteilten des Standorts).
- Automatische Mitteilungen bei Einteilung, Änderung, Absage, Wechsel, Veröffentlichung, Anträgen, Abwesenheits- und
  Korrekturentscheidungen, Check-in-Entscheidungen. Push-Hinweise ohne Inhalt, wenn der Server Push-Schlüssel hat.
- Grenzen: **keine E-Mails**.

**Dateien** – Teilweise: alle sehen Ordner, nur A legt Ordner an; **Datei-Upload nicht umgesetzt** („kommt bald“),
obwohl die README ihn nennt.

**Themen (Forum)** – UI: jede Person kann Themen und Beiträge anlegen (organisationsweit sichtbar); löschen nur A.

**Auswertung und CSV** – UI
- Wo: Auswertung; „Stunden als CSV“ im Wochenplan. Soll, Plan, Ist, Abweichung je Person und Monat.
- Wer: A alle mit Soll (und gelöschte Personen [Neu]); D eigene Zeile plus Personen mit „Stunden“, gezählt an Standorten
  mit „Zeit einsehen“, **ohne Soll**; M nur sich.
- Grenze: D kann mit „Stammdaten“ das Soll pflegen, sieht es aber in der Auswertung nicht.

**Dienstplan als PDF** – UI [Neu]: „Als PDF exportieren“ in Wochen- und Monatsansicht; Zeitraum bis 62 Tage, Kunde,
Standort, Mitarbeiter; DIN A4 quer, offene Plätze markiert; jeder nur mit dem, was er sehen darf.

**Einstellungen** – Teilweise (nur A)
- Wirksam: Qualifikationen, Abwesenheitskategorien und Feiertage, Firmendaten.
- **Ohne Wirkung:** Namensformat (Schichtplan); alle Zeiterfassungs-Optionen (wer darf erfassen, Auto-Stopp,
  Warnungen, Kategorienpflicht).
- „Wunschpläne“ und „Mitarbeiter“: Platzhalter „Bald verfügbar“. „Account löschen anfragen“ meldet nur „noch nicht eingerichtet“.

**KI-Funktionen** – Nur serverseitig, praktisch aus: Planvorschlag, Auffälligkeiten, KI-Briefing, Prognose, Chat.
Voraussetzung Admin + Server-Variable `AI_ENABLED=true` + Schalter je Organisation. **Diese Schalter lassen sich in der
Oberfläche nicht setzen** (die Einstellungen-Schnittstelle nimmt sie nicht an). `/ai/chat` und `/ai/insights` ohne
Menüpunkt; der Chat-Baustein ist nirgends eingebunden.

**Sonstiges** – UI: Hell-/Dunkelmodus, Abmelden, Live-Aktualisierung der Pläne, Handy-Navigation. **Keine eigene
Profilseite, kein Wechsel zwischen Organisationen** (bei mehreren Mitgliedschaften gilt immer die älteste,
`getCurrentMember`).

---

## 5. Rollen- und Funktionsmatrix

✔ = automatisch · **F:** = nur mit Freigabe · Eigene = nur eigene Daten · ✖ = nicht erlaubt

| Funktion | Inhaber | Admin | Disposition | Mitarbeiter | Zusätzliche Bedingungen |
|---|---|---|---|---|---|
| Einstellungen, Kunden, Standorte, Arbeitsbereiche, Katalog | ✔ | ✔ | ✖ | ✖ | |
| Rollen und Freigaben vergeben | ✔ | ✔ | ✖ | ✖ | nicht Inhaber/sich selbst |
| Konten anlegen | ✔ | ✔ | F: bearbeiten | ✖ | D nur Rolle Mitarbeiter, eigene Standorte |
| Standortzuordnung von Mitarbeitern | ✔ | ✔ | F: Einplanen + bearbeiten | ✖ | nur eigene Planungsstandorte |
| Personalliste/Profil | ✔ | ✔ | F: Profil | ✖ | Liste nur Zugeordnete |
| Vertragsdaten, Soll, Qualifikationen, Notizen | ✔ | ✔ | F: Stammdaten | ✖ | |
| Kontaktdaten ändern | ✔ | ✔ | ✖ | Eigene (nur Schnittstelle) | |
| Deaktivieren/Reaktivieren | ✔ | ✔ | ✖ | ✖ | nicht Inhaber/sich |
| Endgültig löschen [Neu] | ✔ | ✔ | F: Löschen | ✖ | D nur Rolle Mitarbeiter |
| Plan mit Namen sehen | ✔ | ✔ | F: ansehen (inkl. Entwürfe) | F: ansehen (veröffentlicht) | eigene Schichten sieht jeder |
| Offene Plätze sehen/anfragen | – | – | F: ansehen oder Standortzuordnung | F: Standortzuordnung | veröffentlicht, künftig |
| Schichten anlegen/ändern/kopieren/löschen | ✔ | ✔ | F: bearbeiten | ✖ | Löschen nur künftig ohne Zeiten [Neu] |
| Besetzen/wechseln | ✔ | ✔ | F: bearbeiten | ✖ | Person im Planungskreis |
| Veröffentlichen | ✔ | ✔ | F: veröffentlichen | ✖ | |
| Übernahme/Abgabe/Tausch entscheiden | ✔ | ✔ | F: Anträge | ✖ | alle beteiligten Standorte, nie eigene |
| Abwesenheit beantragen | Eigene | Eigene | Eigene | Eigene | |
| Abwesenheiten entscheiden | ✔ (auch eigene) | ✔ (auch eigene) | F: Abwesenheiten | ✖ | D nicht eigene |
| Verfügbarkeit | Eigene; alle sehen | Eigene; alle sehen | Eigene; F: Einplanen zum Sehen | Eigene | |
| Stoppuhr, Nachtrag, Korrekturantrag | Eigene | Eigene | Eigene | Eigene | Nachtrag ohne Freigabe |
| Fremde Zeiten sehen | ✔ | ✔ | F: Zeit einsehen + Stunden | ✖ | ohne Standort nur Admin |
| Fremde Zeiten nachtragen, Korrekturen entscheiden | ✔ (auch eigene) | ✔ (auch eigene) | F: Zeit bearbeiten + Stunden | ✖ | D nicht eigene |
| Check-in | Eigene | Eigene | Eigene; Team: F: Zeit einsehen + Stunden | Eigene | nur eigene Schicht |
| Auswertung/CSV | alle mit Soll | alle mit Soll | Eigene + F: Zeit einsehen + Stunden | Eigene | D ohne Soll anderer |
| PDF-Export [Neu] | alle | alle | sichtbare Pläne | sichtbare Pläne | |
| Nachrichten | alle | alle | sichtbare Personen | sichtbare Personen | keine E-Mails |
| Standortmeldungen | ✔ | ✔ | F: Standortmeldungen | ✖ | |
| Themen anlegen | ✔ (+ löschen) | ✔ (+ löschen) | ✔ | ✔ | organisationsweit sichtbar |
| KI | nur wenn serverseitig freigeschaltet | dto. | ✖ | ✖ | nicht über die Oberfläche einschaltbar |

---

## 6. Beispiele für den Betrieb

1. **Inhaber sieht und verwaltet alles – möglich.** Rolle Inhaber, nichts weiter einzustellen.
2. **Sekretärin pflegt Mitarbeiter und Stunden – nur teilweise möglich.** Rolle Disposition; jede Person einzeln mit
   „Personalverantwortung“ zuordnen (Profil, Stammdaten, Abwesenheiten, Stunden); an allen Standorten „Zeit einsehen“,
   für Nachträge/Korrekturen „Zeit bearbeiten“; keine Planungsrechte. Grenzen: **keine Konten anlegen** (dafür wäre
   „bearbeiten“ nötig), **keine Kontaktdaten ändern**, **kein Soll in der Auswertung**, neue Mitarbeiter muss der Admin
   jeweils zuordnen, keine Zeiten ohne Standort. Alternative Rolle Admin gäbe alles.
3. **Einsatzleiter plant genau zwei Standorte – möglich.** Rolle Disposition; an beiden Standorten Voreinstellung
   „Planen“ (bei Bedarf plus „veröffentlichen“). Einplanbar: Mitarbeiter mit Standortzuordnung dort, Mitarbeiter
   anderer Standorte desselben Kunden nur bei eigenem „bearbeiten“ dort, persönlich Zugeordnete.
4. **Einsatzleiter sieht Mitarbeiter im Plan, aber keine Vertrags-/Privatdaten – möglich.** Wie 3, ohne
   Personalzuordnung oder nur mit „Einplanen“ **ohne** „Profil“ (Achtung: Voreinstellung „Einplanen“ enthält „Profil
   ansehen“ = E-Mail/Telefon). Vertragsdaten nur mit „Stammdaten“. Gründe wie „Genehmigte Abwesenheit“ sieht er trotzdem.
5. **Mitarbeiter sieht eigene Schichten und fragt offene an – möglich.** Rolle Mitarbeiter + Standortzuordnung
   („Offene Schichten“); mit „Standortplan ansehen“ zusätzlich alle Namen im veröffentlichten Plan.
6. **Mitarbeiter an mehreren Standorten/Kunden – möglich.** Mehrere Standortzuordnungen, auch kundenübergreifend
   (durch Admin). Ein Einsatzleiter sieht ihn an jedem eigenen Standort, an dem er zugeordnet ist; kundenübergreifend
   nur bei persönlicher Zuordnung mit „Einplanen“.
7. **Mitarbeiter fällt aus und wird ersetzt – möglich.** Abwesenheit eintragen und genehmigen → Zuweisung erscheint
   „nicht verfügbar“ → auf der Schichtkarte „Mitarbeiter wechseln“ [Neu] (in `master`: entfernen + neu zuweisen).
   Benötigt „bearbeiten“, Ersatz im Planungskreis. Nach dem Check-in der ausgefallenen Person kein Wechsel mehr.
   Alternativ kann der Mitarbeiter die Schicht vorher selbst zur Übernahme anbieten.
8. **Mitarbeiter scheidet aus:**

| | Deaktivieren | Endgültig löschen [Neu] |
|---|---|---|
| Wer | nur Admin | Admin oder Disposition mit „Löschen“ |
| Umkehrbar | ja | nein |
| Zugang | sofort gesperrt | Konto weg (bleibt nur bei Nutzung in einer weiteren Organisation) |
| Künftige Schichten | **bleiben belegt** („nicht verfügbar“), müssen gewechselt werden | werden frei, Planung informiert |
| Bisherige Stunden | bleiben unter dem Konto | bleiben mit Namen („gelöscht“), Plan- und Ist-Stunden unverändert |
| Abwesenheiten, Verfügbarkeiten, Freigaben | bleiben | werden gelöscht |
| Sperre | keine | laufende Zeiterfassung, offener Check-in-Antrag, laufender Einsatz |

In `master` gibt es nur das Deaktivieren.

---

## 7. Widersprüche und offene Fragen

**Oberfläche und Server-Berechtigung weichen ab**
- Disposition mit Planungsrecht, aber ohne zugeordnete Personen: kein Menüpunkt „Mitarbeiter“, obwohl der Server das
  Anlegen erlaubt (`nav-config.ts` `faehigkeiten` gegenüber `staff-sites.ts` `canCreateStaff`).
- Mitarbeiter dürfen laut Server eigene Kontaktdaten ändern, haben aber keine Profilseite (`/profile` hat nur einen
  Seitentitel, keine Seite).
- KI-Schaltfläche für Admins sichtbar, KI aber über die Oberfläche nicht einschaltbar.

**Beschriftung entspricht nicht dem Verhalten**
- Rollennamen wechseln zwischen „Inhaber/Administration/Disposition“ und „Owner/Admin/Manager“.
- Einstellungen „Namensformat“ und alle Zeiterfassungs-Optionen werden gespeichert, wirken aber nicht.
- README: „Live sessions with deadline controls“, „File upload“, „weekly target hours“, „warnings/access control“ in der
  Zeiterfassung, „Owner > Admin > Manager > Employee“ – so nicht umgesetzt.
- `docs/AKRO-ERWEITERUNG.md`: Sollberechnung „Wochenstunden / 5 × Werktage“ – der Code nutzt den Monatswert.
- Profil: Kachel „Monatsübersicht/E-Dash“ und Schaltfläche „Stunden“ sind Platzhalter.

**Unklare oder überraschende Auswirkungen**
- **„Dienstplan ansehen“ schließt bei der Disposition „Offene Schichten anfragen“ ein** – ein Einsatzleiter kann selbst
  Übernahmen anfragen, obwohl die Voreinstellung „Standortverantwortung“ das Recht bewusst ausnimmt.
- Kein Vier-Augen-Prinzip für Admins: **eigene Abwesenheiten und eigene Zeitkorrekturen** können sie selbst genehmigen.
- Mitarbeiter können **Zeiten ohne Freigabe nachtragen**, die sofort in die Auswertung eingehen.
- Admins können andere Admins herabstufen/deaktivieren/löschen; Rollenwechsel **ohne Rückfrage**.
- Deaktivierte Personen blockieren ihre künftigen Plätze.
- Themen (Forum) kann jede Person anlegen, organisationsweit sichtbar.
- Mehrere Organisationen: immer nur die älteste Mitgliedschaft erreichbar.
- Disposition pflegt Sollstunden, sieht sie aber nicht in der Auswertung.

**Tatsächlich fehlende Funktionen**
Passwort vergessen/ändern · E-Mail-Versand (Einladungen, Benachrichtigungen) · Datei-Upload · eigene Profilseite ·
Organisationswechsel · Inhaberübertragung · Sammelzuordnung „alle Mitarbeiter“ · ganze Woche kopieren ·
Wunschplan-Einstellungen · Löschen der Organisation · KI-Freischaltung in der Oberfläche.

---

## 8. Verbesserungsvorschläge (noch nicht umgesetzt)

1. Einheitliche Rollennamen (z. B. Inhaber, Administration, Disposition, Mitarbeiter).
2. Passwort zurücksetzen/ändern; Einladungslinks idealerweise per E-Mail.
3. Eigenes Recht oder eigene Rolle „Personalbüro“: Mitarbeiter anlegen ohne Planungsrecht, Zuordnung „alle
   Mitarbeiter“, Soll in der Auswertung.
4. Vier-Augen-Prinzip auch für Admins bei eigenen Abwesenheiten und Korrekturen; optional Freigabepflicht für
   nachgetragene Zeiten.
5. Wirkungslose Einstellungen umsetzen oder ausblenden; Platzhalter entfernen; README korrigieren.
6. Beim Deaktivieren künftige Zuweisungen optional freigeben.
7. „Dienstplan ansehen“ bei der Disposition von „Offene Schichten anfragen“ entkoppeln.
8. Rückfrage beim Rollenwechsel; Schutz davor, dass sich Admins gegenseitig entfernen.
9. Branch `feat/plan-delete-assign-copy-pdf` nach Abnahme nach `master` übernehmen.
