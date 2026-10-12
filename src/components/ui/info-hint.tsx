"use client";

import { Info } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/**
 * Kurze Erklaerung direkt am Element (ⓘ). Oeffnet per Klick oder Tipp -
 * kein Tooltip, weil Hover auf dem Handy unzuverlaessig ist. Die negative
 * Hoehe haelt die 32-px-Tippflaeche aus der Zeilenhoehe heraus.
 */
export function InfoHint({ thema, titel, children }: { thema: string; titel?: string; children: React.ReactNode }) {
  return (
    <Popover>
      <PopoverTrigger
        aria-label={`Erklärung zu ${thema}`}
        className="-my-1.5 inline-flex size-8 shrink-0 items-center justify-center rounded-full align-middle text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        <Info className="size-4" aria-hidden="true" />
      </PopoverTrigger>
      {/* duration-0: keine Ein-/Ausblendanimation. */}
      <PopoverContent align="start" className="w-auto max-w-[min(20rem,calc(100vw-2rem))] space-y-1.5 p-3 text-[14px] leading-snug font-normal whitespace-normal duration-0">
        {titel && <p className="font-semibold">{titel}</p>}
        <div className="space-y-1.5 text-left">{children}</div>
      </PopoverContent>
    </Popover>
  );
}
