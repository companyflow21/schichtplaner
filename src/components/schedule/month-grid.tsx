"use client";

import { useState, useMemo, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  startOfMonth,
  endOfMonth,
  startOfISOWeek,
  endOfISOWeek,
  addDays,
  isSameMonth,
  isToday,
  getISOWeek,
  getISOWeekYear,
  format,
} from "date-fns";
import { ChevronLeft, ChevronRight, Users, Calendar } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { dayNames, formatKW, monthNames } from "@/lib/utils/calendar";
import { cn } from "@/lib/utils";
import type { ScheduleData } from "@/types/schedule";

interface MonthGridProps {
  month: number; // 1-12
  year: number;
}

type MonthScheduleResult = {
  schedules: ScheduleData[];
};

/**
 * Full calendar month layout.
 * Shows a grid of 7 columns (Mo-So) x 4-6 rows (weeks).
 * Each cell shows shift count / booking count for that day.
 * Click a day to navigate to the KW view.
 */
export function MonthGrid({ month, year }: MonthGridProps) {
  const router = useRouter();

  // Calculate all the KWs this month spans and all calendar days
  const { weeks, calendarDays } = useMemo(() => {
    const start = startOfMonth(new Date(year, month - 1, 1));
    const end = endOfMonth(new Date(year, month - 1, 1));
    const calStart = startOfISOWeek(start);
    const calEnd = endOfISOWeek(end);

    const days: Date[] = [];
    let current = calStart;
    while (current <= calEnd) {
      days.push(new Date(current));
      current = addDays(current, 1);
    }

    // Calculate unique weeks
    const kwSet = new Set<string>();
    const kwList: { weekNumber: number; year: number }[] = [];
    for (const d of days) {
      if (isSameMonth(d, start)) {
        const kw = getISOWeek(d);
        const kwYear = getISOWeekYear(d);
        const key = `${kw}-${kwYear}`;
        if (!kwSet.has(key)) {
          kwSet.add(key);
          kwList.push({ weekNumber: kw, year: kwYear });
        }
      }
    }

    return { weeks: kwList, calendarDays: days };
  }, [month, year]);

  // Fetch all KW schedules in one aggregated query
  const queryKey = useMemo(
    () => ["month-schedules", month, year],
    [month, year]
  );

  const { data, isLoading } = useQuery<MonthScheduleResult>({
    queryKey,
    queryFn: async () => {
      const results = await Promise.all(
        weeks.map(async (wk) => {
          const res = await fetch(
            `/api/schedules?kw=${wk.weekNumber}&year=${wk.year}`
          );
          if (!res.ok) return null;
          const json = await res.json();
          return json.schedule as ScheduleData;
        })
      );
      return { schedules: results.filter(Boolean) as ScheduleData[] };
    },
  });

  const schedules = data?.schedules ?? [];

  // Aggregate shifts by date
  const shiftsByDate = useMemo(() => {
    const map = new Map<string, { shiftCount: number; bookingCount: number }>();

    for (const sched of schedules) {
      if (!sched.shifts) continue;
      const kw = sched.weekNumber;
      const kwYear = sched.year;

      // Get the Monday of this KW
      const jan4 = new Date(kwYear, 0, 4);
      const weekStart = startOfISOWeek(jan4);
      const monday = addDays(weekStart, (kw - 1) * 7);

      for (const shift of sched.shifts) {
        const date = addDays(monday, shift.dayOfWeek - 1);
        const key = format(date, "yyyy-MM-dd");
        const existing = map.get(key) ?? { shiftCount: 0, bookingCount: 0 };
        existing.shiftCount += 1;
        existing.bookingCount += shift.bookings.length;
        map.set(key, existing);
      }
    }

    return map;
  }, [schedules]);

  // Month navigation
  const navigateMonth = useCallback(
    (offset: number) => {
      let newMonth = month + offset;
      let newYear = year;
      if (newMonth < 1) {
        newMonth = 12;
        newYear -= 1;
      } else if (newMonth > 12) {
        newMonth = 1;
        newYear += 1;
      }
      router.push(
        `/schedule/month/${String(newMonth).padStart(2, "0")}-${newYear}`
      );
    },
    [month, year, router]
  );

  const handleDayClick = useCallback(
    (date: Date) => {
      const kw = getISOWeek(date);
      const kwYear = getISOWeekYear(date);
      router.push(`/schedule/flexible/${formatKW(kw, kwYear)}`);
    },
    [router]
  );

  // Split calendar days into rows of 7
  const rows = useMemo(() => {
    const result: Date[][] = [];
    for (let i = 0; i < calendarDays.length; i += 7) {
      result.push(calendarDays.slice(i, i + 7));
    }
    return result;
  }, [calendarDays]);

  const monthStart = new Date(year, month - 1, 1);

  if (isLoading) {
    return <MonthGridSkeleton />;
  }

  return (
    <div className="space-y-4">
      {/* Month Navigation */}
      <div className="flex items-center justify-between">
        <Button variant="outline" size="icon-sm" onClick={() => navigateMonth(-1)}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <div className="flex items-center gap-2">
          <Calendar className="h-4 w-4 text-muted-foreground" />
          <span className="text-lg font-semibold">
            {monthNames[month - 1]} {year}
          </span>
        </div>
        <Button variant="outline" size="icon-sm" onClick={() => navigateMonth(1)}>
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      {/* Calendar Grid */}
      <div className="akro-panel overflow-hidden">
        {/* Header */}
        <div className="grid grid-cols-7 akro-panel-kopf">
          {dayNames.map((name) => (
            <div
              key={name}
              className="border-r last:border-r-0 px-2 py-2 text-center text-xs font-semibold text-muted-foreground"
            >
              {name}
            </div>
          ))}
        </div>

        {/* Rows */}
        {rows.map((row, rowIdx) => (
          <div key={rowIdx} className="grid grid-cols-7 border-t">
            {row.map((date, colIdx) => {
              const inMonth = isSameMonth(date, monthStart);
              const today = isToday(date);
              const key = format(date, "yyyy-MM-dd");
              const stats = shiftsByDate.get(key);

              return (
                <button
                  key={colIdx}
                  type="button"
                  className={cn(
                    "border-r last:border-r-0 px-2 py-2 min-h-[80px] text-left transition-colors hover:bg-muted/20",
                    !inMonth && "opacity-30 bg-muted/10",
                    today && "bg-primary/[0.05] ring-1 ring-inset ring-primary/30"
                  )}
                  onClick={() => handleDayClick(date)}
                >
                  <div
                    className={cn(
                      "text-sm font-medium mb-1",
                      today && "text-primary",
                      !inMonth && "text-muted-foreground"
                    )}
                  >
                    {date.getDate()}
                  </div>
                  {stats && stats.shiftCount > 0 && (
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                        <span className="font-medium text-foreground">
                          {stats.shiftCount}
                        </span>
                        {stats.shiftCount === 1 ? "Schicht" : "Schichten"}
                      </div>
                      <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                        <Users className="size-2.5" />
                        <span className="font-medium text-foreground">
                          {stats.bookingCount}
                        </span>
                        gebucht
                      </div>
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

function MonthGridSkeleton() {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Skeleton className="h-8 w-8" />
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-8 w-8" />
      </div>
      <div className="akro-panel overflow-hidden">
        <div className="grid grid-cols-7 akro-panel-kopf">
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="px-2 py-2 flex justify-center">
              <Skeleton className="h-4 w-6" />
            </div>
          ))}
        </div>
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="grid grid-cols-7 border-t">
            {Array.from({ length: 7 }).map((_, j) => (
              <div key={j} className="border-r last:border-r-0 px-2 py-2 min-h-[80px]">
                <Skeleton className="h-4 w-4 mb-1" />
                <Skeleton className="h-3 w-12" />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
