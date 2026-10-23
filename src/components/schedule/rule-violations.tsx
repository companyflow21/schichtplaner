"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Check, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ViolationReport } from "@/lib/planning-rules";
import type { ShiftData } from "@/types/schedule";

/**
 * Regelpruefung eines Wochenplans, nur fuer die Planung (sonst antwortet der
 * Server mit 403; dann nichts). Unter "schedule": jede Echtzeit-
 * Aktualisierung des Plans laedt sie neu.
 */
export function useViolations(scheduleId: string, enabled: boolean) {
  return useQuery<ViolationReport | null>({
    queryKey: ["schedule", "violations", scheduleId],
    queryFn: async () => {
      const res = await fetch(`/api/schedules/${encodeURIComponent(scheduleId)}/violations`);
      if (res.status === 403 || res.status === 404) return null;
      if (!res.ok) throw new Error("Regelprüfung konnte nicht geladen werden.");
      return res.json();
    },
    enabled: enabled && !!scheduleId,
  });
}

const WOCHENTAGE = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
/** "Mo 13.10." */
function kurzDatum(date: string): string {
  return WOCHENTAGE[new Date(date + "T12:00:00Z").getUTCDay()] + " " + date.slice(8, 10) + "." + date.slice(5, 7) + ".";
}

/** "1 Regelverstoß", "3 Regelverstöße" */
export function verstößeText(n: number): string {
  return n + (n === 1 ? " Regelverstoß" : " Regelverstöße");
}

/**
 * Regelverstoesse der Woche unter dem Konfliktpanel, in gleicher Optik:
 * Kopfzeile mit Zaehler, aufklappbar die Liste je Person; ein Klick springt
 * zur Karte, wenn eine beteiligte Schicht in diesem Plan steht. Verstoesse
 * sind Hinweise (orange) - Einteilen und Veroeffentlichen bleiben moeglich.
 * Ohne eingeschaltete Regel erscheint nichts; ohne Verstoss eine Zeile (der
 * Wochenplan blendet sie aus, siehe schedule-grid.tsx).
 */
export function RuleViolationPanel({ data, shifts, isAdmin, onSprung }: { data: ViolationReport; shifts: ShiftData[]; isAdmin: boolean; onSprung: (shiftId: string) => void }) {
  if (!data.enabled) return null;
  const zeiten = new Map(shifts.map((s) => [s.id, s.shiftFrom + "–" + s.shiftTo]));
  const regeln = isAdmin && (
    <Link href="/settings?bereich=rules" className="text-[12px] font-medium text-primary underline-offset-4 hover:underline max-md:flex max-md:min-h-11 max-md:items-center">
      Regeln ansehen
    </Link>
  );
  if (data.count === 0) {
    return (
      <section aria-label="Regelverstöße" className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
        <p role="status" aria-live="polite" className="flex items-center gap-1.5 font-semibold text-ok"><Check className="size-4" aria-hidden="true" />Keine Regelverstöße in dieser Woche</p>
        {regeln}
      </section>
    );
  }
  return (
    <section aria-label="Regelverstöße" className="akro-panel mb-3 border-warn/40 text-[13px]">
      <details className="group">
        <summary className="flex min-h-10 cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 rounded-[inherit] px-3 py-2 focus-visible:outline-offset-[-3px] max-md:min-h-11 [&::-webkit-details-marker]:hidden">
          <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90 motion-reduce:transition-none" aria-hidden="true" />
          <span role="status" aria-live="polite" className="flex items-center gap-1.5 text-[14px] font-semibold text-warn"><AlertTriangle className="size-4" aria-hidden="true" />{verstößeText(data.count)}</span>
          <span className="text-muted-foreground">Hinweise – Einteilen und Veröffentlichen bleiben möglich.</span>
        </summary>
        {regeln && <div className="border-t px-3 pt-2">{regeln}</div>}
        <ul className={cn("space-y-2 px-3 py-2", !regeln && "border-t")}>
          {data.people.map((p) => (
            <li key={p.userId}>
              <p className="font-medium">{p.name}</p>
              <ul className="mt-0.5 space-y-0.5">
                {p.violations.map((v, i) => {
                  const ziel = v.shiftIds.find((id) => zeiten.has(id));
                  const inhalt = (
                    <>
                      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                      <span>{kurzDatum(v.date)} – {v.text}</span>
                    </>
                  );
                  return (
                    <li key={i}>
                      {ziel ? (
                        <button
                          type="button"
                          onClick={() => onSprung(ziel)}
                          className="flex min-h-8 items-start gap-1 rounded-md py-1 text-left text-warn underline-offset-4 hover:underline max-md:min-h-11 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                        >
                          {inhalt}
                        </button>
                      ) : (
                        <p className="flex items-start gap-1 py-1 text-warn">{inhalt}</p>
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
