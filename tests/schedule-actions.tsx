/* Beobachtbare Schichtkarten mit echten API-Ansichten, ohne Datenbank oder Betriebskonten. */
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ShiftCard } from "../src/components/schedule/shift-card";
import { isoWeek } from "../src/lib/berlin";
import { shiftEnded, shiftView, type ShiftWithRelations } from "../src/lib/planning";
import type { Access } from "../src/lib/access";
import type { ShiftData } from "../src/types/schedule";

let checks = 0;
function check(value: unknown, label: string) { assert.ok(value, label); checks++; console.log("PASS: " + label); }
const admin = { isAdmin: true, role: "ADMIN", userId: "admin", branches: new Map(), staff: new Map() } as Access;
const queryClient = new QueryClient();
const realNow = Date.now;
function fixture(date: string, from: string, to: string): ShiftWithRelations {
  const week = isoWeek(date);
  return {
    id: "shift", scheduleId: "plan", dayOfWeek: ((new Date(date + "T12:00:00Z").getUTCDay() + 6) % 7) + 1,
    shiftFrom: from, shiftTo: to, maxEmployees: 2, pauseOption: "PER_SHIFT", pauseValue: 0,
    title: "Testschicht", description: null, requiredQualifications: [], createdAt: new Date(), deletedAt: null,
    divisionId: null, division: null,
    schedule: { year: week.year, weekNumber: week.weekNumber, branchId: "site", isPublic: true, branch: null },
    bookings: [
      { id: "employee", userId: "employee", contractorWorkerId: null, user: { id: "employee", firstName: "Test", lastName: "Person", profileImage: null } },
      { id: "contractor", userId: null, contractorWorkerId: "worker", user: null, contractorWorker: { id: "worker", name: "MA 1", subcontractor: { id: "sub", name: "Sub A" } } },
    ],
  } as unknown as ShiftWithRelations;
}
function examine(date: string, from: string, to: string, expectedEnd: string, instant: string, ended: boolean, label: string) {
  const shift = fixture(date, from, to), view = shiftView(shift, admin);
  check(view.endsAt === expectedEnd, label + ": API liefert das erwartete echte Schichtende");
  check(shiftEnded(shift, new Date(instant)) === ended, label + ": Serversperre stimmt");
  Date.now = () => Date.parse(instant);
  try {
    const clientView = JSON.parse(JSON.stringify(view)) as ShiftData;
    const html = renderToStaticMarkup(<QueryClientProvider client={queryClient}><ShiftCard shift={clientView} canEdit onEdit={() => {}} /></QueryClientProvider>);
    check(html.includes("durch andere Person ersetzen") === !ended, label + ": Wechselaktion nur vor Schichtende");
    check((html.match(/aus der Schicht entfernen/g) ?? []).length === (ended ? 0 : 2), label + ": Mitarbeiter- und Sub-Entfernen nur vor Schichtende");
    check(html.includes("Schicht beendet") === ended && html.includes("Kopieren"), label + ": Historienhinweis korrekt, Kopieren bleibt möglich");
  } finally { Date.now = realNow; }
}

examine("2026-10-01", "08:00", "16:00", "2026-10-01T14:00:00.000Z", "2026-10-01T05:00:00Z", false, "Zukünftige Tagschicht");
examine("2026-10-01", "08:00", "16:00", "2026-10-01T14:00:00.000Z", "2026-10-01T13:59:59Z", false, "Laufende Tagschicht");
examine("2026-10-01", "08:00", "16:00", "2026-10-01T14:00:00.000Z", "2026-10-01T14:00:00Z", true, "Exakte Endgrenze");
examine("2026-10-01", "22:00", "06:00", "2026-10-02T04:00:00.000Z", "2026-10-02T00:30:00Z", false, "Laufende Nachtschicht nach Mitternacht");
examine("2026-10-01", "22:00", "06:00", "2026-10-02T04:00:00.000Z", "2026-10-02T04:00:00Z", true, "Beendete Nachtschicht");
examine("2026-12-31", "22:00", "06:00", "2027-01-01T05:00:00.000Z", "2027-01-01T04:59:59Z", false, "Jahreswechsel");
examine("2026-03-28", "22:00", "06:00", "2026-03-29T04:00:00.000Z", "2026-03-29T04:00:00Z", true, "Umstellung auf Sommerzeit");
examine("2026-10-24", "22:00", "06:00", "2026-10-25T05:00:00.000Z", "2026-10-25T04:59:59Z", false, "Umstellung auf Winterzeit");
examine("2026-10-25", "01:00", "02:30", "2026-10-25T00:30:00.000Z", "2026-10-25T01:15:00Z", true, "Beendete Schicht öffnet in wiederholter Stunde nicht erneut");
queryClient.clear();
console.log("SUCCESS: " + checks + " Schichtkarten-Prüfungen bestanden.");
