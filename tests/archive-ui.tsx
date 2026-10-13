/*
 * Archiv der Einsatzort-Verwaltung und die Aktion "Archivieren", statisch
 * gerendert ohne Browser oder Datenbank:
 *   npx tsx tests/archive-ui.tsx
 * Klicks, Dialog-Oeffnen (Portal) und Abfragen prueft dieser Test nicht;
 * die Serverregeln prueft tests/archive.ts.
 */
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Archiv, ArchivierenFolgen, ArchivierenKnopf, archivierenText, type ArchiveData } from "../src/components/workforce/locations";

let checks = 0;
function check(value: unknown, label: string) { assert.ok(value, label); checks++; console.log("PASS: " + label); }
const queryClient = new QueryClient();
const render = (node: React.ReactNode) => renderToStaticMarkup(<QueryClientProvider client={queryClient}>{node}</QueryClientProvider>);
const count = (html: string, part: string) => html.split(part).length - 1;
const nichts = () => {};
/** Keine Schrift unter 12 px (auch nicht text-[10px]/text-[11px]) und keine festen Breiten, die bei 375 px ueberstehen koennten. */
const mobil = (html: string) => !/text-\[(\d|1[01])(\.\d+)?px\]/.test(html) && !/\b(min-)?w-\[\d{3,}px\]/.test(html) && !/\bw-(9[6-9]|[1-9]\d{2,})\b/.test(html);

// --- Archivbereich ---------------------------------------------------------------
const tag = "2026-10-13T08:00:00.000Z";
const data: ArchiveData = {
  customers: [
    { id: "k1", name: "Kunde Alt", archivedAt: tag, deletable: false },
    { id: "k2", name: "Kunde Leer", archivedAt: tag, deletable: true },
  ],
  branches: [
    { id: "b1", name: "Objekt Historie", archivedAt: tag, deletable: false, customer: { id: "k1", name: "Kunde Alt", archivedAt: tag } },
    { id: "b2", name: "Objekt Leer", archivedAt: "2026-10-12T22:30:00.000Z", deletable: true, customer: { id: "k3", name: "Kunde Aktiv", archivedAt: null } },
    { id: "b3", name: "Altbestand", archivedAt: tag, deletable: false, customer: null },
  ],
};
const archiv = render(<Archiv data={data} pending={false} onRestore={nichts} onDelete={nichts} />);
check(archiv.startsWith("<details") && !/<details[^>]*\sopen/.test(archiv) && archiv.includes("<summary") && archiv.includes("Archiv (5)</summary>"), "Archiv: eingeklappter Bereich mit Anzahl");
check(archiv.includes("Archivierte Kunden und Einsatzorte sind aus Planung und Listen ausgeblendet; ihre vergangenen Schichten, Zeiten und Stunden bleiben erhalten.") && archiv.includes("Endgültig löschen lässt sich nur, was noch keine Historie hat."), "Archiv: Erklärung in einfachen Sätzen");
check(archiv.indexOf(">Kunden</h3>") < archiv.indexOf("Kunde Leer") && archiv.indexOf(">Einsatzorte</h3>") < archiv.indexOf("Objekt Historie"), "Archiv: Kunden und Einsatzorte getrennt");
check(count(archiv, "archiviert am 13.10.2026") === 5 && !archiv.includes("12.10.2026"), "Archiv: Datum je Eintrag in Europe/Berlin (22:30 UTC am 12.10. ist dort schon der 13.10.)");
check(count(archiv, "Wiederherstellen</button>") === 5, "Archiv: jeder Eintrag lässt sich wiederherstellen");
check(count(archiv, "Endgültig löschen</button>") === 2 && archiv.indexOf("Kunde Leer") < archiv.indexOf("Endgültig löschen</button>"), "Archiv: endgültig löschen nur ohne Historie (Kunde ohne Einsatzorte, Einsatzort ohne Historie)");
check(count(archiv, "text-destructive") === 2 && count(archiv, 'class="border-l pl-2"') === 2, "Archiv: Löschen rot und abgesetzt");
check(archiv.includes("Kunde Alt · archiviert am 13.10.2026 · mit Historie") && archiv.includes("Ohne Kunde · archiviert am 13.10.2026 · mit Historie") && archiv.includes("Kunde Aktiv · archiviert am"), "Archiv: Kunde, Datum und Historie je Einsatzort");
check(count(archiv, "Kunde archiviert – zuerst den Kunden wiederherstellen.") === 1, "Archiv: Hinweis nur, wenn der Kunde selbst archiviert ist");
check(mobil(archiv) && count(archiv, "flex flex-wrap") >= 5 && archiv.includes("min-w-0 flex-1"), "Archiv: mobil umbrechend, Schrift mindestens 12 px");
check(render(<Archiv data={data} pending onRestore={nichts} onDelete={nichts} />).split("disabled").length - 1 >= 7, "Archiv: während einer Aktion gesperrt");
const leer = render(<Archiv data={{ customers: [], branches: [] }} pending={false} onRestore={nichts} onDelete={nichts} />);
check(leer.includes("Archiv (0)</summary>") && leer.includes("Nichts archiviert.") && !leer.includes("</button>"), "Archiv: leer ohne Aktionen");

// --- Aktion "Archivieren" ------------------------------------------------------------
check(archivierenText("Nord") === "Der Einsatzort „Nord“ wird archiviert. Das geht nur, wenn dort keine laufenden oder zukünftigen Schichten mehr geplant sind.", "Archivieren: Einsatzort mit Voraussetzung");
check(archivierenText("Kunde A", 1).startsWith("Der Kunde „Kunde A“ wird inklusive 1 Einsatzort archiviert.") && archivierenText("Kunde B", 3).startsWith("Der Kunde „Kunde B“ wird inklusive 3 Einsatzorte archiviert.") && archivierenText("Kunde C", 0).includes("inklusive 0 Einsatzorte"), "Archivieren: Kunde inklusive N Einsatzorte");
const folgen = render(<ArchivierenFolgen />);
check(["Verschwindet aus Dienstplan, Auswahllisten und Startseite.", "Dort sind keine neuen Schichten, Einteilungen oder Freigaben mehr möglich.", "Vergangene Schichten, Zeiten und Stunden bleiben erhalten und in der Auswertung sichtbar.", "Wiederherstellen ist jederzeit unten im Archiv möglich."].every((s) => folgen.includes(s)) && mobil(folgen), "Archivieren: Folgen in einfachen Sätzen");
const knopf = render(<ArchivierenKnopf url="/api/branches/b1" name="Nord" pending={false} onArchive={nichts} />);
check(knopf.includes("Archivieren</button>") && !knopf.includes("text-destructive") && mobil(knopf), "Archivieren: Knopf ohne Rot (nichts geht verloren)");
check(render(<ArchivierenKnopf url="/api/customers/k1" name="Kunde" einsatzorte={2} pending onArchive={nichts} />).includes("disabled"), "Archivieren: während einer Aktion gesperrt");

console.log("SUCCESS: " + checks + " archive UI checks passed.");
