"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Ban, ChevronRight } from "lucide-react";
import { isoWeek } from "@/lib/berlin";
import { formatKW } from "@/lib/utils/calendar";
import { cn } from "@/lib/utils";
import type { ConflictItem, WeekConflicts } from "@/types/conflicts";
import type { ShiftData } from "@/types/schedule";

/**
 * Konfliktpruefung der Standortwoche, nur fuer die Planung (sonst antwortet
 * der Server mit 403; dann nichts). Unter "schedule": jede Echtzeit-
 * Aktualisierung des Plans (schedule:updated, booking:changed) laedt sie neu.
 */
export function useWeekConflicts(weekNumber: number, year: number, standort: string, planner: boolean) {
  return useQuery<WeekConflicts | null>({
    queryKey: ["schedule", "conflicts", weekNumber, year, standort],
    queryFn: async () => {
      const res = await fetch(`/api/schedules/conflicts?kw=${weekNumber}&year=${year}&standort=${encodeURIComponent(standort)}`);
      if (res.status === 403 || res.status === 404) return null;
      if (!res.ok) throw new Error("Konfliktprüfung konnte nicht geladen werden.");
      return res.json();
    },
    enabled: planner && standort !== "ohne",
  });
}

const WOCHENTAGE = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
/** "Mo 13.10." */
function kurzDatum(date: string): string {
  return WOCHENTAGE[new Date(date + "T12:00:00Z").getUTCDay()] + " " + date.slice(8, 10) + "." + date.slice(5, 7) + ".";
}

/** Ausfuehrlicher Text fuers Panel: bei Ueberschneidung mit Tag, Zeit und Ort der anderen Schicht. */
export function konfliktText(c: ConflictItem): string {
  if (c.kind !== "overlap" || !c.other) return c.text;
  return `Zeitliche Überschneidung mit ${kurzDatum(c.other.date)}, ${c.other.from}–${c.other.to} ${c.other.branchName ? "am Standort " + c.other.branchName : "an einem anderen Standort"}.`;
}

/**
 * Nur bei Befund: Kopfzeile mit Zaehlern, aufklappbar je Person die
 * betroffenen Schichten; ein Klick springt zur Karte. Die Karten selbst
 * tragen den Konflikt ohnehin; ohne Befund steht "Keine Konflikte" in der
 * Kennwertzeile des Kopfes. Ueberschneidungen mit Schichten anderer Wochen
 * oder Standorte verlinken deren Woche, wenn der Plan dort sichtbar ist.
 */
export function ConflictPanel({ data, shifts, standort, onSprung }: { data: WeekConflicts; shifts: ShiftData[]; standort: string; onSprung: (shiftId: string) => void }) {
  const { fehler, hinweis } = data.counts;
  if (fehler + hinweis === 0) return null;
  const zeiten = new Map(shifts.map((s) => [s.id, s.shiftFrom + "–" + s.shiftTo]));
  const personen = new Map<string, { name: string; items: ConflictItem[] }>();
  for (const c of data.items) {
    const p = personen.get(c.personKey) ?? { name: c.name, items: [] };
    p.items.push(c);
    personen.set(c.personKey, p);
  }
  const liste = [...personen.entries()].sort(([, a], [, b]) => a.name.localeCompare(b.name, "de"));
  return (
    <section aria-label="Konfliktprüfung" className={cn("akro-panel mb-2 text-[13px]", fehler > 0 ? "border-destructive/35" : "border-warn/40")}>
      <details className="group">
        <summary className="flex min-h-9 cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 rounded-[inherit] px-3 py-1.5 focus-visible:outline-offset-[-3px] max-md:min-h-11 [&::-webkit-details-marker]:hidden">
          <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90 motion-reduce:transition-none" aria-hidden="true" />
          <span role="status" aria-live="polite" className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[14px] font-semibold">
            <span className={cn("flex items-center gap-1.5", fehler > 0 ? "text-destructive" : "text-muted-foreground")}><Ban className="size-4" aria-hidden="true" />{fehler} {fehler === 1 ? "Konflikt" : "Konflikte"},</span>
            <span className={cn("flex items-center gap-1.5", hinweis > 0 ? "text-warn" : "text-muted-foreground")}><AlertTriangle className="size-4" aria-hidden="true" />{hinweis} {hinweis === 1 ? "Hinweis" : "Hinweise"}</span>
          </span>
          <span className="text-[13px] text-muted-foreground">
            <span className="group-open:hidden">{liste.length === 1 ? "1 Person anzeigen" : liste.length + " Personen anzeigen"}</span>
            <span className="hidden group-open:inline">ausblenden</span>
          </span>
        </summary>
        <ul className="space-y-2 border-t px-3 py-2">
          {liste.map(([key, p]) => (
            <li key={key}>
              <p className="font-medium">{p.name}</p>
              <ul className="mt-0.5 space-y-0.5">
                {p.items.map((c, i) => {
                  const andereWoche = c.other?.branchId && !zeiten.has(c.other.shiftId) ? isoWeek(c.other.date) : null;
                  return (
                    <li key={i} className="flex flex-wrap items-center gap-x-2">
                      <button
                        type="button"
                        onClick={() => onSprung(c.shiftId)}
                        className={cn("flex min-h-8 items-start gap-1 rounded-md py-1 text-left underline-offset-4 hover:underline max-md:min-h-11 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary", c.severity === "fehler" ? "text-destructive" : "text-warn")}
                      >
                        {c.severity === "fehler" ? <Ban className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" /> : <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />}
                        <span>{kurzDatum(c.date)}{zeiten.has(c.shiftId) ? ", " + zeiten.get(c.shiftId) : ""} – {konfliktText(c)}</span>
                      </button>
                      {andereWoche && c.other?.branchId && (
                        <Link
                          href={`/schedule/flexible/${formatKW(andereWoche.weekNumber, andereWoche.year)}?standort=${encodeURIComponent(c.other.branchId)}`}
                          className="text-[12px] font-medium text-primary underline-offset-4 hover:underline max-md:flex max-md:min-h-11 max-md:items-center"
                        >
                          {c.other.branchId === standort ? "Woche öffnen" : "Plan " + c.other.branchName + " öffnen"}
                        </Link>
                      )}
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}
