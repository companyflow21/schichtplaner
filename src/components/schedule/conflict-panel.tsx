"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Ban, Check } from "lucide-react";
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
 * Kopfzeile mit Zaehlern und je Person die betroffenen Schichten; ein Klick
 * springt zur Karte. Ueberschneidungen mit Schichten anderer Wochen oder
 * Standorte verlinken deren Woche, wenn der Plan dort sichtbar ist.
 */
export function ConflictPanel({ data, shifts, standort, onSprung }: { data: WeekConflicts; shifts: ShiftData[]; standort: string; onSprung: (shiftId: string) => void }) {
  const { fehler, hinweis } = data.counts;
  const zeiten = new Map(shifts.map((s) => [s.id, s.shiftFrom + "–" + s.shiftTo]));
  const personen = new Map<string, { name: string; items: ConflictItem[] }>();
  for (const c of data.items) {
    const p = personen.get(c.personKey) ?? { name: c.name, items: [] };
    p.items.push(c);
    personen.set(c.personKey, p);
  }
  const liste = [...personen.entries()].sort(([, a], [, b]) => a.name.localeCompare(b.name, "de"));
  return (
    <section aria-label="Konfliktprüfung" className={cn("akro-panel mb-4 p-3 text-[13px]", fehler > 0 ? "border-destructive/35" : hinweis > 0 && "border-warn/40")}>
      <p role="status" aria-live="polite" className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[14px] font-semibold">
        {fehler + hinweis === 0 ? (
          <span className="flex items-center gap-1.5 text-ok"><Check className="size-4" aria-hidden="true" />Keine Konflikte in dieser Woche</span>
        ) : (
          <>
            <span className={cn("flex items-center gap-1.5", fehler > 0 ? "text-destructive" : "text-muted-foreground")}><Ban className="size-4" aria-hidden="true" />{fehler} {fehler === 1 ? "Konflikt" : "Konflikte"},</span>
            <span className={cn("flex items-center gap-1.5", hinweis > 0 ? "text-warn" : "text-muted-foreground")}><AlertTriangle className="size-4" aria-hidden="true" />{hinweis} {hinweis === 1 ? "Hinweis" : "Hinweise"}</span>
          </>
        )}
      </p>
      {liste.length > 0 && (
        <ul className="mt-2 space-y-2">
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
      )}
    </section>
  );
}
