"use client";

import { useState, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, ArrowRight } from "lucide-react";
import { getISOWeek } from "date-fns";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  getCurrentKW,
  getWeekDates,
  getMonthKWs,
  formatKW,
  formatDateShort,
  formatDateLong,
  monthNames,
} from "@/lib/utils/calendar";
import { cn } from "@/lib/utils";

interface WeekNavProps {
  weekNumber: number;
  year: number;
  /** Base URL for navigation, defaults to "/schedule/flexible" */
  baseUrl?: string;
  /** Standort, der beim Blaettern erhalten bleibt. */
  standort?: string | null;
}

/**
 * Get the number of ISO weeks in a given year.
 * Dec 28 is always in the last ISO week of the year.
 */
function getMaxISOWeek(y: number): number {
  return getISOWeek(new Date(y, 11, 28));
}

export function WeekNav({ weekNumber, year, baseUrl = "/schedule/flexible", standort }: WeekNavProps) {
  const router = useRouter();
  const currentKW = useMemo(() => getCurrentKW(), []);
  const weekDates = useMemo(
    () => getWeekDates(weekNumber, year),
    [weekNumber, year]
  );

  const [expandedMonth, setExpandedMonth] = useState<{
    month: number;
    year: number;
  } | null>(null);
  const [jumpKW, setJumpKW] = useState("");

  // Determine which months to show (5 months centered around current week)
  const visibleMonths = useMemo(() => {
    const months: { month: number; year: number }[] = [];
    const midDate = weekDates[3]; // Thursday of the week (defines the ISO week's month)
    const midMonth = midDate.getMonth(); // 0-indexed
    const midYear = midDate.getFullYear();

    for (let offset = -2; offset <= 2; offset++) {
      let m = midMonth + offset;
      let y = midYear;
      if (m < 0) {
        m += 12;
        y -= 1;
      } else if (m > 11) {
        m -= 12;
        y += 1;
      }
      months.push({ month: m + 1, year: y }); // 1-indexed for our utils
    }
    return months;
  }, [weekDates]);

  const navigateToKW = useCallback(
    (kw: number, kwYear: number) => {
      router.push(`${baseUrl}/${formatKW(kw, kwYear)}${standort ? "?standort=" + encodeURIComponent(standort) : ""}`);
    },
    [router, baseUrl, standort]
  );

  const navigatePrev = useCallback(() => {
    let newKW = weekNumber - 1;
    let newYear = year;
    if (newKW < 1) {
      newYear -= 1;
      newKW = getMaxISOWeek(newYear);
    }
    navigateToKW(newKW, newYear);
  }, [weekNumber, year, navigateToKW]);

  const navigateNext = useCallback(() => {
    let newKW = weekNumber + 1;
    let newYear = year;
    const maxWeek = getMaxISOWeek(year);
    if (newKW > maxWeek) {
      newKW = 1;
      newYear += 1;
    }
    navigateToKW(newKW, newYear);
  }, [weekNumber, year, navigateToKW]);

  const handleJumpKW = useCallback(() => {
    const num = parseInt(jumpKW, 10);
    if (!isNaN(num) && num >= 1 && num <= 53) {
      navigateToKW(num, year);
      setJumpKW("");
    }
  }, [jumpKW, year, navigateToKW]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        handleJumpKW();
      }
    },
    [handleJumpKW]
  );

  const toggleMonth = useCallback(
    (month: number, monthYear: number) => {
      if (
        expandedMonth &&
        expandedMonth.month === month &&
        expandedMonth.year === monthYear
      ) {
        setExpandedMonth(null);
      } else {
        setExpandedMonth({ month, year: monthYear });
      }
    },
    [expandedMonth]
  );

  const isCurrentWeek =
    weekNumber === currentKW.weekNumber && year === currentKW.year;

  // Week date range display
  const mondayStr = formatDateShort(weekDates[0]);
  const sundayStr = formatDateLong(weekDates[6]);

  return (
    <div className="space-y-3">
      {/* Zuerst die Woche - gross und eindeutig */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="flex items-center overflow-hidden rounded-[var(--radius)] border bg-card">
          <button type="button" onClick={navigatePrev} aria-label="Vorherige Woche" className="flex size-9 items-center justify-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
            <ChevronLeft className="size-4" />
          </button>
          <span className="h-9 w-px bg-border" aria-hidden="true" />
          <button type="button" onClick={navigateNext} aria-label="Nächste Woche" className="flex size-9 items-center justify-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
            <ChevronRight className="size-4" />
          </button>
        </div>
        <h1 className="flex flex-wrap items-baseline gap-x-2">
          <span className="akro-kennzahl text-[22px]">KW {String(weekNumber).padStart(2, "0")}</span>
          <span className="tabular text-[13px] font-normal tracking-normal text-muted-foreground">
            {mondayStr}.–{sundayStr}
          </span>
        </h1>
        {isCurrentWeek && (
          <span className="text-[12px] font-medium text-primary">diese Woche</span>
        )}
      </div>

      {/* Monate und Sprung zu einer KW */}
      <div className="flex flex-wrap items-center gap-1.5">
        {visibleMonths.map(({ month, year: mYear }) => {
          const monthKWs = getMonthKWs(month, mYear);
          const containsCurrentWeek = monthKWs.some(
            (kw) => kw.weekNumber === weekNumber && kw.year === year
          );
          const containsToday = monthKWs.some(
            (kw) =>
              kw.weekNumber === currentKW.weekNumber &&
              kw.year === currentKW.year
          );
          const isExpanded =
            expandedMonth?.month === month && expandedMonth?.year === mYear;

          return (
            <Button
              key={`${month}-${mYear}`}
              variant="outline"
              size="sm"
              aria-expanded={isExpanded}
              aria-current={containsCurrentWeek ? "true" : undefined}
              onClick={() => toggleMonth(month, mYear)}
              className={cn(
                "relative",
                (containsCurrentWeek || isExpanded) &&
                  "border-primary/40 bg-accent text-accent-foreground hover:bg-accent"
              )}
            >
              {monthNames[month - 1]}
              {mYear !== year && (
                <span className="ml-1 text-xs opacity-60">{mYear}</span>
              )}
              {containsToday && (
                <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-primary" aria-hidden="true" />
              )}
            </Button>
          );
        })}

        <div className="flex items-center gap-1.5 sm:ml-auto">
          <label htmlFor="kw-sprung" className="text-xs text-muted-foreground">
            Springe zu
          </label>
          <Input
            id="kw-sprung"
            type="number"
            min={1}
            max={53}
            placeholder="KW"
            value={jumpKW}
            onChange={(e) => setJumpKW(e.target.value)}
            onKeyDown={handleKeyDown}
            className="h-8 w-16 text-center text-sm"
          />
          <Button
            variant="outline"
            size="icon-sm"
            onClick={handleJumpKW}
            disabled={!jumpKW}
            aria-label="Zur Kalenderwoche springen"
          >
            <ArrowRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Wochen des gewaehlten Monats */}
      {expandedMonth && (
        <div className="flex items-center gap-1 flex-wrap akro-panel p-2">
          {getMonthKWs(expandedMonth.month, expandedMonth.year).map((kw) => {
            const isSelected =
              kw.weekNumber === weekNumber && kw.year === year;
            const isCurrent =
              kw.weekNumber === currentKW.weekNumber &&
              kw.year === currentKW.year;
            return (
              <Button
                key={`${kw.weekNumber}-${kw.year}`}
                variant="ghost"
                size="xs"
                aria-current={isSelected ? "true" : undefined}
                onClick={() => {
                  navigateToKW(kw.weekNumber, kw.year);
                  setExpandedMonth(null);
                }}
                className={cn(
                  isSelected && "bg-accent text-accent-foreground hover:bg-accent",
                  isCurrent && !isSelected && "text-primary"
                )}
              >
                KW {kw.weekNumber}
              </Button>
            );
          })}
        </div>
      )}
    </div>
  );
}
