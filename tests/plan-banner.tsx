/*
 * Statusbalken, Status-Badge und Inhalt des Veroeffentlichen-Dialogs,
 * statisch gerendert ohne Browser oder Datenbank:
 *   npx tsx tests/plan-banner.tsx
 * Klicks, Dialog-Oeffnen (Portal) und Abfragen prueft dieser Test nicht;
 * dafuer gibt es die Browserpruefung.
 */
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BearbeitungsFolgen, BearbeitungStarten, PlanStatusBadge, PlanStatusBanner, VerwerfenFolgen, verworfenText, zeitpunkt } from "../src/components/schedule/plan-status-banner";
import { keineMitteilung, PublishDialog, PublishSummary, veröffentlichtText, type DiffResponse } from "../src/components/schedule/publish-dialog";
import type { ScheduleAccess, ScheduleData, ScheduleDiffData, ScheduleDiffShift, ShiftData } from "../src/types/schedule";

let checks = 0;
function check(value: unknown, label: string) { assert.ok(value, label); checks++; console.log("PASS: " + label); }
const queryClient = new QueryClient();
function render(node: React.ReactNode) {
  return renderToStaticMarkup(<QueryClientProvider client={queryClient}>{node}</QueryClientProvider>);
}
const count = (html: string, part: string) => html.split(part).length - 1;

// --- Statusbalken ---------------------------------------------------------
const planer: ScheduleAccess = { view: true, planner: true, edit: true, publish: true, handleRequests: true, request: false };
const nurBearbeiten: ScheduleAccess = { ...planer, publish: false };
const mitarbeiter: ScheduleAccess = { view: true, planner: false, edit: false, publish: false, handleRequests: false, request: true };
const plan: ScheduleData = {
  id: "plan", organizationId: "org", branchId: "nord", weekNumber: 42, year: 2026, isPublic: false, status: "DRAFT",
  settingsLayout: "LAYOUT_1", showTitle: true, showPauses: true, shifts: [{ id: "s1" } as ShiftData],
};
const inBearbeitung: ScheduleData = { ...plan, isPublic: true, status: "EDITING", editingSince: "2026-10-12T12:35:00.000Z", editingBy: { name: "Max Planer" } };
const balken = (schedule: ScheduleData | null, access?: ScheduleAccess) => render(<PlanStatusBanner schedule={schedule} access={access} standort="nord" />);

const entwurf = balken(plan, planer);
check(entwurf.includes('role="status"') && entwurf.includes("border-l-4 border-warn bg-warn/10"), "Entwurf: echter Balken mit role=status und Warnfarbe");
check(entwurf.includes("Entwurf – für Mitarbeitende unsichtbar") && entwurf.includes("Gespeicherte Schichten sind erst nach dem Veröffentlichen sichtbar; jede Woche und jeder Standort wird einzeln veröffentlicht."), "Entwurf: Titel und genau der Satz zur Mitarbeitersicht");
check(count(entwurf, "Veröffentlichen</button>") === 1 && !entwurf.includes("Verwerfen") && !entwurf.includes("Änderungen veröffentlichen"), "Entwurf: genau ein Knopf 'Veröffentlichen', kein Verwerfen");
check(entwurf.includes('aria-haspopup="dialog"'), "Entwurf: 'Veröffentlichen' öffnet einen Dialog");
check(balken({ ...plan, shifts: [] }, planer) === "", "Entwurf ohne Schichten: kein Balken");

const bearbeitung = balken(inBearbeitung, planer);
check(zeitpunkt("2026-10-12T12:35:00.000Z") === "12.10.2026, 14:35 Uhr", "Zeitpunkt in Europe/Berlin");
check(bearbeitung.includes("Dienstplan ist in Bearbeitung") && bearbeitung.includes("Mitarbeitende sehen weiterhin den Stand vom 12.10.2026, 14:35 Uhr; Anträge und Tausch sind bis zur Veröffentlichung gesperrt."), "Bearbeitung: Titel und Satz mit dem eingefrorenen Stand");
check(bearbeitung.includes("Begonnen von Max Planer"), "Bearbeitung: wer begonnen hat");
check(bearbeitung.includes("Änderungen veröffentlichen</button>") && bearbeitung.includes("Verwerfen</button>") && bearbeitung.includes("text-destructive"), "Bearbeitung: 'Änderungen veröffentlichen' und rotes 'Verwerfen'");
check(bearbeitung.indexOf("Verwerfen</button>") < bearbeitung.indexOf("Änderungen veröffentlichen</button>") && bearbeitung.includes("flex-col-reverse"), "Bearbeitung: Hauptaktion mobil oben, am Desktop rechts");
check(!balken({ ...inBearbeitung, editingBy: null }, planer).includes("Begonnen von"), "Bearbeitung ohne Namen: keine leere Zeile");

const ohneRecht = balken(inBearbeitung, nurBearbeiten);
check(ohneRecht.includes("Dienstplan ist in Bearbeitung") && !ohneRecht.includes("</button>") && ohneRecht.includes("Veröffentlichen oder Verwerfen darf nur, wer das Recht „Dienstplan veröffentlichen“ hat."), "Ohne Veröffentlichen-Recht: Balken ohne Aktionen, mit Erklärung");
check(balken({ ...plan, isPublic: true, status: "PUBLISHED" }, planer) === "", "Veröffentlicht: kein Balken");
check(balken({ ...plan, isPublic: true, status: undefined }, mitarbeiter) === "" && balken(plan, mitarbeiter) === "" && balken(inBearbeitung, undefined) === "", "Mitarbeitende: kein Balken");
check(balken(null, planer) === "" && balken({ ...plan, id: "" }, planer) === "", "Ohne Plan: kein Balken");

// --- Badge und Einstieg in die Bearbeitung ------------------------------------
const badge = (schedule: Pick<ScheduleData, "isPublic" | "status">) => render(<PlanStatusBadge schedule={schedule} />);
check(badge(plan).includes("Entwurf</span>") && badge(plan).includes("text-warn"), "Badge: Entwurf");
check(badge({ isPublic: true, status: "PUBLISHED" }).includes("Veröffentlicht</span>") && badge({ isPublic: true, status: "PUBLISHED" }).includes("text-ok"), "Badge: Veröffentlicht");
check(badge(inBearbeitung).includes("In Bearbeitung</span>") && badge(inBearbeitung).includes("text-warn") && !badge(inBearbeitung).includes("Veröffentlicht"), "Badge: In Bearbeitung (Ton hinweis)");
check(badge({ isPublic: true }).includes("Veröffentlicht</span>") && badge({ isPublic: false }).includes("Entwurf</span>"), "Badge ohne Lebenszyklus (Mitarbeitende): nach isPublic");

check(render(<BearbeitungStarten scheduleId="plan" wochenLabel="KW 42/2026" wochenbeginn={new Date()} />).includes("Bearbeitung starten</button>"), "Toolbar: Knopf 'Bearbeitung starten'");
const folgen = render(<BearbeitungsFolgen wocheBegonnen={false} />);
check(["Mitarbeitende sehen bis zur Veröffentlichung den bisherigen Stand.", "Anträge und Tausch für diese Woche sind so lange gesperrt.", "Check-ins und Zeiterfassung laufen normal weiter.", "Alle Änderungen lassen sich wieder verwerfen."].every((s) => folgen.includes(s)) && !folgen.includes("bereits begonnen"), "Bearbeitung starten: Folgen in einfachen Sätzen");
check(render(<BearbeitungsFolgen wocheBegonnen />).includes("Diese Woche hat bereits begonnen: Bereits begonnene Schichten werden beim Verwerfen nicht zurückgesetzt."), "Bearbeitung starten: Warnzeile bei begonnener Woche");
const verwerfen = render(<VerwerfenFolgen />);
check(verwerfen.includes("Bereits begonnene Schichten bleiben unverändert.") && verwerfen.includes("Während der Bearbeitung neu angelegte Schichten verschwinden."), "Verwerfen: Folgen genannt");
check(verworfenText({ restored: 2, removed: 1, skipped: 1 }) === "2 Schichten wiederhergestellt, 1 neue Schicht entfernt, 1 Schicht unverändert (bereits begonnen oder mit Check-in)." && verworfenText({ restored: 0, removed: 0, skipped: 0 }) === "Es gab keine Änderungen.", "Verwerfen: Ergebnis in Worten");

// --- Veroeffentlichen-Dialog ---------------------------------------------------
function eintrag(id: string, label: string, extra: Partial<ScheduleDiffShift> = {}): ScheduleDiffShift {
  return { id, label, date: "2026-10-13", dayOfWeek: 2, shiftFrom: "08:00", shiftTo: "16:00", title: null, pauseOption: "PER_SHIFT", pauseValue: 0, maxEmployees: 1, openPlaces: 0, requiredQualifications: [], division: null, people: [], ...extra };
}
const neu = eintrag("n1", "Di, 13.10.2026, 08:00–16:00, Nord", { title: "Empfang", people: [{ key: "kai", name: "Kai Konflikt" }] });
const vorher = eintrag("c1", "Mi, 14.10.2026, 06:00–14:00, Nord", { people: [{ key: "lea", name: "Lea Ruhig" }] });
const nachher = eintrag("c1", "Mi, 14.10.2026, 08:00–16:00, Nord", { maxEmployees: 2, openPlaces: 1, people: [{ key: "tom", name: "Tom Neu" }] });
const weg = eintrag("r1", "Fr, 16.10.2026, 22:00–06:00, Nord", { people: [{ key: "ida", name: "Ida Nacht" }] });
const leer: ScheduleDiffData = { added: [], removed: [], changed: [], affectedUserIds: [], affected: [], openPlacesAdded: false };
const geändert: DiffResponse = {
  status: "EDITING",
  diff: {
    added: [neu],
    removed: [{ ...weg, movedTo: null }],
    changed: [{ shift: { id: "c1", label: nachher.label }, before: vorher, after: nachher, changes: ["Zeit", "Plätze", "Besetzung"] }],
    affectedUserIds: ["tom", "kai", "lea", "ida"],
    affected: [{ userId: "tom", name: "Tom Neu" }, { userId: "kai", name: "Kai Konflikt" }, { userId: "lea", name: "Lea Ruhig" }, { userId: "ida", name: "Ida Nacht" }],
    openPlacesAdded: true,
  },
};
const inhalt = (data: DiffResponse, extra: Partial<Parameters<typeof PublishSummary>[0]> = {}) => render(<PublishSummary data={data} notify onNotifyChange={() => {}} {...extra} />);

const voll = inhalt(geändert);
const pos = ["Neue Schichten", neu.label, "Geänderte Schichten", nachher.label, "Entfallene Schichten", weg.label].map((s) => voll.indexOf(s));
check(pos.every((p, i) => p >= 0 && (i === 0 || p > pos[i - 1])), "Dialog: 1 neu, 1 geändert, 1 entfallen – korrekt gruppiert");
check(voll.includes("Empfang") && voll.includes("Kai Konflikt") && voll.includes("Ida Nacht"), "Dialog: Einträge mit Tätigkeit und Personen");
check(["Zeit</span>", "Plätze</span>", "Besetzung</span>"].every((t) => voll.includes(t)), "Dialog: Änderungs-Tags an der geänderten Schicht");
check(voll.includes("vorher: Mi, 14.10.2026, 06:00–14:00, Nord") && voll.includes("Tom Neu · 1 Platz offen (vorher: Lea Ruhig)"), "Dialog: vorheriger Stand und Besetzung");
check(!voll.includes(">keine<") && !voll.includes("Erstveröffentlichung"), "Dialog: keine Leergruppen, keine Erstveröffentlichung");
check(voll.includes("Betroffene Personen: 4") && voll.includes("Ida Nacht, Kai Konflikt, Lea Ruhig, Tom Neu"), "Dialog: betroffene Personen gezählt und genannt");
check(voll.includes('role="checkbox"') && voll.includes('aria-checked="true"') && voll.includes("Betroffene benachrichtigen") && !voll.includes('disabled=""'), "Dialog: Checkbox 'Betroffene benachrichtigen' standardmäßig angehakt");
check(voll.includes("Jede betroffene Person erhält eine Mitteilung mit ihren geänderten Schichten."), "Dialog: Hinweis zur Sammelmitteilung");
check(voll.includes("Offene Plätze: Standortfreigaben mit Anfragerecht werden informiert."), "Dialog: Hinweis bei neuen offenen Plätzen");

const ohne = inhalt(geändert, { notify: false });
check(ohne.includes('aria-checked="false"') && ohne.includes("Ohne Benachrichtigung") && !ohne.includes("Offene Plätze:"), "Dialog: abgewählte Benachrichtigung");

const nichts = inhalt({ status: "EDITING", diff: leer });
check(count(nichts, ">keine<") === 3, "Dialog: leerer Diff zeigt dreimal 'keine'");
check(nichts.includes("Betroffene Personen: 0") && nichts.includes('disabled=""') && nichts.includes('aria-checked="false"') && nichts.includes("Niemand ist von den Änderungen betroffen"), "Dialog: 0 Betroffene – Checkbox deaktiviert mit Hinweis");
check(keineMitteilung({ status: "EDITING", diff: leer }) && !keineMitteilung({ status: "EDITING", diff: { ...leer, openPlacesAdded: true } }) && !keineMitteilung({ status: "DRAFT", diff: leer }), "Mitteilung entfällt nur, wenn niemand betroffen ist");

const zweite = eintrag("n2", "Do, 15.10.2026, 08:00–16:00, Nord");
const erst = inhalt({ status: "DRAFT", diff: { ...leer, added: [neu, zweite], affectedUserIds: ["kai"], affected: [{ userId: "kai", name: "Kai Konflikt" }] } });
check(erst.includes("Erstveröffentlichung: alle 2 Schichten sind neu") && count(erst, ">keine<") === 2, "Dialog: Entwurf als Erstveröffentlichung");
check(erst.includes('aria-checked="true"') && !erst.includes('disabled=""') && erst.includes("Die Mitteilung geht an alle Eingeteilten und an alle, die diesen Standortplan sehen dürfen.") && erst.includes("Niemand eingeteilt"), "Dialog: Entwurf benachrichtigt den Standort");

const viele = Array.from({ length: 11 }, (_, i) => eintrag("v" + i, `Mo, 12.10.2026, ${String(i + 6).padStart(2, "0")}:00–14:00, Nord`, { people: [{ key: "p" + i, name: "Person " + String(i).padStart(2, "0") }] }));
const lang = inhalt({ status: "EDITING", diff: { ...leer, added: viele, affected: viele.map((s, i) => ({ userId: "p" + i, name: s.people[0].name })) } });
check(lang.includes("3 weitere anzeigen") && lang.includes("<details>") && lang.includes("Person 10"), "Dialog: lange Listen aufklappbar");
check(lang.includes("Betroffene Personen: 11") && lang.includes("+ 1 weitere") && !lang.includes("Person 00, Person 01, Person 02, Person 03, Person 04, Person 05, Person 06, Person 07, Person 08, Person 09, Person 10"), "Dialog: bis zu 10 Namen, dann '+ weitere'");

const konflikte = inhalt(geändert, { konflikte: { fehler: 2, hinweis: 1 }, konflikteHref: "/schedule/flexible/42-2026?standort=nord" });
check(konflikte.includes("2 Konflikte, 1 Hinweis in dieser Woche") && konflikte.includes('href="/schedule/flexible/42-2026?standort=nord"') && konflikte.includes("Ansehen"), "Dialog: Konfliktzähler mit Sprung");
check(inhalt(geändert, { konflikte: { fehler: 0, hinweis: 0 } }).includes("Keine Konflikte in dieser Woche") && !voll.includes("Konflikt in dieser Woche") && !voll.includes("Keine Konflikte"), "Dialog: Konfliktzeile nur mit geladener Prüfung");

check(veröffentlichtText("KW 42/2026", true, 3) === "KW 42/2026 veröffentlicht – 3 Personen benachrichtigt" && veröffentlichtText("KW 42/2026", true, 1) === "KW 42/2026 veröffentlicht – 1 Person benachrichtigt" && veröffentlichtText("KW 42/2026", false, 0) === "KW 42/2026 veröffentlicht – ohne Benachrichtigung", "Erfolgsmeldung mit Anzahl oder ohne Benachrichtigung");
check(render(<PublishDialog scheduleId="plan" wochenLabel="KW 42/2026" />).includes("Veröffentlichen</button>"), "Dialog-Auslöser: Standardbeschriftung 'Veröffentlichen'");

queryClient.clear();
console.log("SUCCESS: " + checks + " Statusbalken- und Veröffentlichen-Prüfungen bestanden.");
