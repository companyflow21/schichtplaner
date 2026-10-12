# Übergabe: Design-Stufe 1 (Smartplan-Muster)

Stand 12.10.2026, Branch `feat/design-stufe-1` (setzt auf `feat/plan-lifecycle-diff-conflicts`
`58e2ef1` auf). Vorgabe: `docs/smartplan-design-2026-10-12.md`. Grundlage war ein
Soll-Ist-Abgleich der Oberfläche; vieles aus Stufe 1 war bereits vorhanden (Seitenleiste
mit Icons und aktivem Zustand, Wochenraster mit Heute-Fläche, „Keine Schichten“ an leeren
Tagen, Statusbadge, Bestätigungsdialoge mit Folgen, „Offene Aufgaben“ mit Links).

## Umgesetzt

### Navigation und Kopfschiene
- Mobile Tab-Leiste markiert „Plan“ auf allen Planseiten (`/schedule/flexible|classic|employee|month`)
  und „Mehr“, wenn das aktive Ziel im Menü liegt. Gemeinsame Logik `isNavItemActive()` in
  `layout/nav-config.ts`, genutzt von `app-sidebar.tsx` und `mobile-nav.tsx`.
- Glocke in `layout/top-nav.tsx`: Link auf `/portal/inbox`, Ungelesen-Zähler (ab 100 „99+“),
  `aria-label` „Posteingang, N ungelesen“, Touchfläche 44 px. Benachrichtigungen sind in
  dieser App Postfachnachrichten; eine eigene Liste gibt es nicht.
- „Heute“-Knopf in `schedule/week-nav.tsx` (Klassisch- und Mitarbeiteransicht), in der
  aktuellen Woche deaktiviert.

### Schicht-Dialog (`schedule/shift-form.tsx`)
- Reihenfolge: Einsatzort · Beginn | Ende | Pause · Wochentage · Tätigkeit | Arbeitsbereich ·
  **Besetzung** (benötigte Plätze, beim Anlegen Personen als Chips mit Hinweis „Ohne
  Auswahl entsteht eine freie Schicht …“) · Hinweise · „Weitere Optionen“ (eingeklappt:
  Pausenregel, Wiederholung, Qualifikationen; öffnet sich automatisch, wenn dort ein
  abweichender Wert steht oder ein Feld ungültig ist) · Vorschau.
- Fuß mit Abbrechen/Speichern fest am unteren Rand, Löschen links abgesetzt.
- Personenauswahl schließt sich, sobald alle Plätze vergeben sind. Klicks für „Schicht mit
  einer Person anlegen“: 6 → 5; ohne Person weiterhin 2.
- Beschriftungen 13 px, mobil alle Bedienelemente ≥ 44 px. API-Body und Speicherlogik
  unverändert; die Einsatzort-Logik aus `87834b0` ist unberührt.
- Wochentage und Arbeitsbereich bleiben sichtbar, weil `tests/ui-shift-location.mjs` und
  `tests/ui-design.mjs` sie direkt ansprechen.

### Bestätigungsdialoge und Löschen
- Alle sechs `window.confirm` sind `ConfirmDialog`s mit belegten Folgetexten: Kunde und
  Einsatzort (`workforce/locations.tsx`), Qualifikation, Abwesenheitskategorie, Live-Modus
  stoppen, Wunsch stornieren. Quellen je Text stehen in der Commit-Beschreibung `5b2e074`.
- Portal: endgültiges Löschen von Nachricht, Thema, Ordner und Datei fragt nach
  (`98c68e0`). Hinweis: Beim Löschen eines Ordners bleiben enthaltene Dateien erhalten und
  liegen danach im Stammordner – so verhält sich der Server (`ON DELETE SET NULL`); der
  Dialog sagt das jetzt. Ob das gewollt ist, wäre eine eigene Entscheidung.
- „Deaktivieren“ erklärt die Folgen (kein Zugriff; bestehende Einteilungen bleiben und
  erscheinen als „Nicht verfügbar“; Rückgängig über „Reaktivieren“) und ist nicht mehr rot.
- „Mitarbeiter löschen“ steht als letzter Menüeintrag nach einem Trenner.
- `LOESCH_HINWEIS` der Abwesenheiten ergänzt (endgültig, keine Benachrichtigung).
- Der funktionslose Knopf „Datei hochladen“ ist entfernt (es gibt keinen Upload);
  `docs/ROLLEN-UND-RECHTE.md` angepasst.

### ⓘ-Erklärtexte (`ui/info-hint.tsx`)
- Neuer Baustein: Icon-Knopf (16 px Icon, 32 px Tippfläche, `aria-label` „Erklärung zu …“),
  öffnet ein Popover mit 14-px-Text – bewusst kein Radix-Tooltip (auf dem Handy unzuverlässig).
- Eingesetzt bei: Rechten (`employees/access-editor.tsx`, Texte direkt aus
  `lib/access-shared.ts`, keine Doppelpflege), Sub-Platzhaltern (`workforce/subcontractors.tsx`),
  Stoppuhr (`time/stopwatch.tsx`), Check-in (`workforce/checkins.tsx`), Sollstunden
  (`workforce/personnel.tsx`, Spaltenkopf in `reporting/hours-table.tsx`).
- **Alle Texte sind aus `ANLEITUNG.md`, `docs/ROLLEN-UND-RECHTE.md` und
  `docs/AKRO-ERWEITERUNG.md` belegt und von AKRO zu bestätigen.** Quellen je Satz stehen in
  der Commit-Beschreibung `f8e0430`. Doku-Widerspruch zu den Sollstunden
  (AKRO-ERWEITERUNG.md:56 „Wochenstunden / 5 × Mo–Fr“ gegenüber Code und
  ROLLEN-UND-RECHTE.md:458 „Monatswert“): Texte folgen dem Code.

### Handlungsorientierte Warnungen (Startseite)
- `GET /api/dashboard` liefert im Planungszweig `tasks: { notActivated, draftWeeks, draftHref }`
  (Logik in `lib/dashboard-tasks.ts`). `notActivated` zählt mit demselben Rechteumfang wie die
  Mitarbeiterliste (Admin: Organisation; Manager: nur zugeordnete aktive Personen, sonst `null`;
  Mitarbeitende: kein Feld). `draftWeeks` ist die Summe der Entwurfswochen der nächsten 28 Tage
  (nur Planer), `draftHref` führt in die früheste Entwurfswoche.
- „Offene Aufgaben“ zeigt „N Wochen im Entwurf“ und „N Mitarbeitende nicht freigeschaltet –
  jetzt einladen“ (Link `/employees?status=not_activated`; die Liste wählt den Reiter vor).

## Nicht geändert (Entscheidungen, Ist-Zustand beibehalten)
- Navigation bleibt als Seitenleiste links (Vorgabe nennt „oben“; die Seitenleiste erfüllt
  „fest, immer sichtbar, Icon + Beschriftung, aktiv farbig“).
- Heute-Markierung bleibt Blau (Rot ist in der App die Fehlerfarbe; neue Farbtöne sind laut
  `globals.css` nicht erlaubt).
- Offene Plätze bleiben Orange (Grün heißt in der App „voll besetzt“).
- Rollenname MANAGER: im Menü „Disposition“, in Listen/Formularen „Manager“ – Vereinheitlichung
  erst nach Entscheidung.
- Schicht-Dialog als Popover an der Tageszelle: zurückgestellt (großer Umbau von
  `schedule-grid.tsx`); „ein Dialog“ ist mit der neuen Reihenfolge erfüllt.
- Bereichsfarben durchgängig, Wochen-Vorlagen, Live-Zähler, Filterleiste: Stufe 2/3, nicht
  beauftragt. `Division.color` existiert bereits im Datenmodell.

## Nachzügler (nach dem Merge der Lebenszyklus-Oberfläche, weil dieselben Dateien)
- `schedule-toolbar.tsx:~150`: „Heute“ statt „Diese Woche“, immer sichtbar.
- `schedule-grid.tsx:~174/~184`: Links in den Warnungen „Standort ohne Kunde“ und „kein
  Bundesland“ auf die Einsatzorte.
- `shift-card.tsx:~258/~277`: Dialog „Zuweisung aufheben“ um die belegte Folge ergänzen
  (Benachrichtigung bei veröffentlichtem Plan, offene Anträge werden abgelehnt).
- Schrift ≤ 12 px: `shift-card.tsx` (11 Stellen), `schedule-grid.tsx` (3), `schedule-toolbar.tsx`
  (1) sowie die zentralen Bausteine `ui/status-badge.tsx` („klein“ = 11 px), `ui/badge.tsx`,
  `ui/table.tsx` (Spaltenköpfe), `ui/button.tsx` (`xs`), `.akro-label` (12 px) – Mindestgröße
  ist eine Entscheidung (Vorschlag: nichts unter 12 px, Inhalte 13–14 px).
- `schedule-options.tsx:~515`: `confirm()` beim Briefing-Löschen → `ConfirmDialog`.

## Prüfnachweise (Branch `feat/design-stufe-1`, 12.10.2026)
- Typprüfung 0 Fehler; Lint 0 Fehler / 25 bestehende Warnungen.
- `tests/schedule-actions.tsx` 45/45, `tests/info-hint.tsx` 6/6, `tests/conflict-card.tsx` 17/17.
- `TEST_ONLY=dashboard-tasks,permissions,staff-sites,assignment,plan-lifecycle,conflicts`:
  FINAL SUCCESS 1371 (PGlite, Ports 3412/55546).
- Schicht-Dialog zusätzlich im Browser geprüft (Chrome, 1280 px und 375×812): Auswahl
  schließt bei voller Besetzung, „Prüfen“ → „1 Schicht anlegen“ mit 3 Zuweisungen, Bearbeiten
  behält Einsatzort, kein waagerechter Überlauf.
- Nicht ausgeführt: `npm run build`, `tests/ui-*.mjs` (Playwright ist auf diesem Rechner nicht
  installiert; `tests/ui-quality.mjs:141` wurde um den neuen Bestätigungsklick ergänzt).

## Agentenarbeit
Audit (lesend) und drei Umsetzungsagenten in eigenen Worktrees mit disjunkten Dateien;
Integration und gemeinsame Prüfung durch den Hauptagenten. Zwei Agenten wurden durch
Nutzungslimits unterbrochen und fortgesetzt; ein Agent arbeitete nach dem Abbruch im
Worktree der Konfliktprüfung – seine Commits wurden per Cherry-pick übernommen.
Kostenmessung liegt nicht vor.
