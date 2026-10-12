"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { json } from "@/components/workforce/client";
import type { Violation } from "@/lib/planning-rules";
import { cn } from "@/lib/utils";

export type ViolationData = { enabled: boolean; count: number; people: { userId: string; firstName: string; lastName: string; violations: Violation[] }[] };

const day = (date: string) => new Date(date + "T12:00:00Z").toLocaleDateString("de-DE", { timeZone: "UTC", weekday: "short", day: "2-digit", month: "2-digit" });

/** Springt zur (sichtbaren) Schichtkarte und hebt sie kurz hervor. */
function jumpTo(shiftIds: string[]) {
  for (const id of shiftIds) {
    const card = [...document.querySelectorAll<HTMLElement>(`[data-shift-id="${CSS.escape(id)}"]`)].find((el) => el.offsetParent !== null);
    if (!card) continue;
    card.scrollIntoView({ behavior: "smooth", block: "center" });
    card.classList.add("ring-2", "ring-warn", "ring-offset-2");
    setTimeout(() => card.classList.remove("ring-2", "ring-warn", "ring-offset-2"), 2500);
    return;
  }
}

export function useViolations(scheduleId: string, enabled: boolean) {
  // Schluessel unter "schedule": aendert sich der Plan, wird auch die Pruefung neu geladen.
  return useQuery({ queryKey: ["schedule", "violations", scheduleId], queryFn: () => json<ViolationData>(`/api/schedules/${scheduleId}/violations`), enabled: enabled && !!scheduleId, retry: false });
}

/** Liste der Verstoesse je Person; ein Klick springt zur Schicht im Plan. */
export function ViolationList({ people, onJump = jumpTo }: { people: ViolationData["people"]; onJump?: (shiftIds: string[]) => void }) {
  return (
    <ul className="space-y-3">
      {people.map((p) => (
        <li key={p.userId}>
          <p className="text-[13px] font-semibold">{p.lastName}, {p.firstName}</p>
          <ul className="mt-1 space-y-0.5">
            {p.violations.map((v, i) => (
              <li key={i}>
                <button type="button" onClick={() => onJump(v.shiftIds)} className="flex w-full gap-2 rounded px-1.5 py-1 text-left text-[13px] hover:bg-muted">
                  <span className="w-20 shrink-0 tabular-nums text-muted-foreground">{day(v.date)}</span>
                  <span>{v.text}</span>
                </button>
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}

/**
 * Kasten "Regelverstoesse" im Wochenplan: Anzahl, Aktualisieren, Liste je
 * Person. Verstoesse sind Hinweise - Einteilen und Veroeffentlichen bleiben moeglich.
 */
export function RuleViolations({ scheduleId, isAdmin }: { scheduleId: string; isAdmin: boolean }) {
  const query = useViolations(scheduleId, true);
  const [open, setOpen] = useState(false);
  const data = query.data;
  if (!data?.enabled) return null;
  const found = data.count > 0;
  return (
    <div className={cn("mb-4 rounded-[var(--radius)] border px-3 py-2 text-[13px]", found ? "border-warn/40 bg-warn/[0.06]" : "border-ok/30 bg-ok/[0.05]")}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {found ? <AlertTriangle className="size-4 text-warn" /> : <CheckCircle2 className="size-4 text-ok" />}
        <span className="font-medium">{found ? data.count + (data.count === 1 ? " Regelverstoß" : " Regelverstöße") : "Keine Regelverstöße in dieser Woche"}</span>
        <div className="ml-auto flex flex-wrap items-center gap-1">
          {found && <Button size="xs" variant="ghost" onClick={() => setOpen((v) => !v)} aria-expanded={open}>{open ? "Ausblenden" : "Anzeigen"}</Button>}
          <Button size="xs" variant="ghost" onClick={() => query.refetch()} disabled={query.isFetching} aria-label="Regelverstöße aktualisieren" className="gap-1">
            {query.isFetching ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}<span className="hidden sm:inline">Aktualisieren</span>
          </Button>
          {isAdmin && <Button size="xs" variant="ghost" asChild><Link href="/settings?bereich=rules">Regeln ansehen</Link></Button>}
        </div>
      </div>
      {open && found && <div className="mt-2 border-t pt-2"><ViolationList people={data.people} /></div>}
    </div>
  );
}
