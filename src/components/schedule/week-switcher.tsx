"use client";

import type { Ref } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Zeitraum blaettern - ein Baustein fuer Wochen- und Monatsplan in allen
 * Ansichten: [<] Zeitraum [>] und daneben "Heute". Die Beschriftung kann
 * die Ueberschrift der Seite sein (as="h1"); nach dem Blaettern setzt die
 * aufrufende Seite den Fokus darauf (labelRef, tabIndex -1), damit die
 * Tastatur nicht auf BODY landet. Kein overflow-hidden, damit der
 * Fokusring der Pfeile sichtbar bleibt (nach innen versetzt). Auf dem
 * Handy sind Pfeile und "Heute" 44 px hoch (Touchflaeche).
 */
export function WeekSwitcher({
  label,
  zusatz,
  onPrev,
  onNext,
  onToday,
  heuteAktiv = false,
  prevLabel = "Vorherige Woche",
  nextLabel = "Nächste Woche",
  as = "p",
  labelRef,
  heuteMobilAusblenden = false,
  className,
}: {
  /** Zeitraum, z. B. "19.10.–25.10.2026" oder "Okt 2026". */
  label: React.ReactNode;
  /** Kleiner Zusatz hinter dem Zeitraum, z. B. "KW 43". */
  zusatz?: React.ReactNode;
  onPrev: () => void;
  onNext: () => void;
  /** Ohne onToday erscheint kein "Heute"-Knopf. */
  onToday?: () => void;
  /** Heutiger Zeitraum ist schon sichtbar: "Heute" ist dann deaktiviert. */
  heuteAktiv?: boolean;
  prevLabel?: string;
  nextLabel?: string;
  as?: "h1" | "h2" | "p";
  labelRef?: Ref<HTMLElement>;
  /** Auf dem Handy den deaktivierten "Heute"-Knopf weglassen (Platz in einer klebenden Zeile). */
  heuteMobilAusblenden?: boolean;
  className?: string;
}) {
  const Tag = as as "p";
  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      <div className="flex min-h-10 max-w-full items-center rounded-lg border bg-card">
        <button
          type="button"
          onClick={onPrev}
          aria-label={prevLabel}
          className="flex size-10 shrink-0 items-center justify-center rounded-l-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-offset-[-3px] max-md:size-11"
        >
          <ChevronLeft className="size-4" aria-hidden="true" />
        </button>
        <Tag ref={labelRef as Ref<HTMLParagraphElement>} tabIndex={-1} className="min-w-0 rounded px-1 text-[14px] leading-5 font-semibold tracking-normal focus-visible:outline-offset-[-3px] sm:px-3">
          <span className="tabular whitespace-nowrap">{label}</span>
          {zusatz && <span className="ml-2 text-xs font-normal text-muted-foreground">{zusatz}</span>}
        </Tag>
        <button
          type="button"
          onClick={onNext}
          aria-label={nextLabel}
          className="flex size-10 shrink-0 items-center justify-center rounded-r-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-offset-[-3px] max-md:size-11"
        >
          <ChevronRight className="size-4" aria-hidden="true" />
        </button>
      </div>
      {onToday && (
        <Button variant="outline" size="sm" disabled={heuteAktiv} onClick={onToday} className={cn("max-md:h-11", heuteAktiv && heuteMobilAusblenden && "max-md:hidden")}>
          Heute
        </Button>
      )}
    </div>
  );
}
