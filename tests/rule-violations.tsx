/*
 * Regelverstoesse im Wochenplan (Panel unter der Konfliktpruefung) und im
 * Veroeffentlichen-Dialog, statisch gerendert ohne Browser oder Datenbank:
 *   npx tsx tests/rule-violations.tsx
 */
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RuleViolationPanel } from "../src/components/schedule/rule-violations";
import { PublishSummary, type DiffResponse } from "../src/components/schedule/publish-dialog";
import type { ViolationReport } from "../src/lib/planning-rules";
import type { ShiftData } from "../src/types/schedule";

let checks = 0;
function check(value: unknown, label: string) { assert.ok(value, label); checks++; console.log("PASS: " + label); }
const queryClient = new QueryClient();
const render = (node: React.ReactNode) => renderToStaticMarkup(<QueryClientProvider client={queryClient}>{node}</QueryClientProvider>);

const shifts = [{ id: "s1", shiftFrom: "14:00", shiftTo: "22:00" }, { id: "s2", shiftFrom: "08:00", shiftTo: "20:00" }] as ShiftData[];
const report: ViolationReport = {
  enabled: true, count: 3,
  people: [
    { userId: "ria", name: "Ria Regel", violations: [
      { rule: "rest", date: "2028-05-16", text: "Ruhezeit 8 h vor einer Schicht an einem anderen Standort am 16.05. (mindestens 11 h)", shiftIds: ["s1"], elsewhere: true },
      { rule: "dailyHours", date: "2028-05-17", text: "12 h am 17.05. (höchstens 10 h am Tag)", shiftIds: ["s2"] },
    ] },
    { userId: "tom", name: "Tom Zwei", violations: [{ rule: "hours", date: "2028-05-15", text: "30 h in KW 20 (mindestens 38 h)", shiftIds: [] }] },
  ],
};
const panel = (data: ViolationReport, isAdmin = true) => render(<RuleViolationPanel data={data} shifts={shifts} isAdmin={isAdmin} onSprung={() => {}} />);

const full = panel(report);
check(full.includes('aria-label="Regelverstöße"') && full.includes("akro-panel") && full.includes("border-warn/40"), "Panel: eigener Abschnitt in der Optik des Konfliktpanels, Rahmen in Warnfarbe");
check(full.includes('role="status"') && full.includes("3 Regelverstöße") && full.includes("Hinweise – Einteilen und Veröffentlichen bleiben möglich."), "Panel: Kopfzeile zählt die Verstöße als Status und sagt, dass nichts gesperrt ist");
check(full.indexOf("Ria Regel") < full.indexOf("Di 16.05. – Ruhezeit 8 h vor einer Schicht an einem anderen Standort") && full.includes("Mi 17.05. – 12 h am 17.05. (höchstens 10 h am Tag)"), "Panel: Liste je Person mit Tag und Text");
check((full.match(/<button/g) ?? []).length === 2 && full.includes("Mo 15.05. – 30 h in KW 20 (mindestens 38 h)</span></p>"), "Panel: Sprung nur, wenn eine beteiligte Schicht in diesem Plan steht");
check(full.includes("text-warn") && !full.includes("text-destructive") && !/text-\[(?:10|11)px\]/.test(full), "Panel: Hinweise in Orange, nie rot, keine Schrift unter 12 px");
check(full.includes('href="/settings?bereich=rules"') && !panel(report, false).includes("/settings?bereich=rules"), "Panel: 'Regeln ansehen' nur für die Administration");
const leer = panel({ enabled: true, count: 0, people: [] });
check(leer.includes("Keine Regelverstöße in dieser Woche") && !leer.includes("<ul") && !leer.includes("border-warn/40"), "Panel: Leerzustand");
check(panel({ enabled: false, count: 0, people: [] }) === "", "Panel: ohne eingeschaltete Regel nichts");

const diff: DiffResponse = { status: "DRAFT", diff: { added: [], removed: [], changed: [], affectedUserIds: [], affected: [], openPlacesAdded: false } };
const dialog = (extra: Partial<Parameters<typeof PublishSummary>[0]> = {}) => render(<PublishSummary data={diff} notify onNotifyChange={() => {}} {...extra} />);
const mit = dialog({ regeln: { enabled: true, count: 3 }, konflikteHref: "/schedule/flexible/20-2028?standort=eins" });
check(mit.includes("3 Regelverstöße – Veröffentlichen trotzdem möglich") && mit.includes('href="/schedule/flexible/20-2028?standort=eins"') && mit.includes("Ansehen"), "Dialog: Regelverstöße als eigener Block mit Sprung");
check(dialog({ regeln: { enabled: true, count: 1 } }).includes("1 Regelverstoß – Veröffentlichen trotzdem möglich"), "Dialog: Einzahl");
check(dialog({ regeln: { enabled: true, count: 0 } }).includes("Keine Regelverstöße in dieser Woche"), "Dialog: keine Verstöße");
check(!dialog({ regeln: { enabled: false, count: 0 } }).includes("Regelverst") && !dialog().includes("Regelverst"), "Dialog: ohne eingeschaltete Regel oder ohne Prüfung kein Block");

queryClient.clear();
console.log("SUCCESS: " + checks + " Regelverstoß-Prüfungen bestanden.");
