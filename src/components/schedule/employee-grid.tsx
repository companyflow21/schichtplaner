"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { isToday } from "date-fns";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { dayNames, formatDateShort } from "@/lib/utils/calendar";
import { cn } from "@/lib/utils";
import type { ScheduleData, ShiftData, BookingUser } from "@/types/schedule";

interface EmployeeGridProps {
  weekNumber: number;
  year: number;
  weekDates: Date[];
  /** Standort des Plans; ohne Angabe die zusammengefuehrte Sicht. */
  standort?: string | null;
}

type EmployeeRow = {
  user: BookingUser;
  dayShifts: Record<number, ShiftData[]>;
  totalHours: number;
};

function getInitials(firstName: string, lastName: string): string {
  return `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase();
}

/**
 * Parse a time string "HH:mm" to minutes since midnight.
 */
function timeToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

/**
 * Calculate shift duration in hours.
 */
function shiftDurationHours(shift: ShiftData): number {
  const from = timeToMinutes(shift.shiftFrom);
  let to = timeToMinutes(shift.shiftTo);
  if (to <= from) to += 24 * 60; // overnight
  return (to - from) / 60;
}

/**
 * Employee-centric schedule view.
 * Rows = employees, Columns = Mo-So.
 * Each cell shows the employee's shift(s) for that day.
 */
export function EmployeeGrid({ weekNumber, year, weekDates, standort }: EmployeeGridProps) {
  const { data, isLoading } = useQuery<{ schedule: ScheduleData }>({
    queryKey: ["schedule", weekNumber, year, standort ?? "alle"],
    queryFn: async () => {
      const res = await fetch(`/api/schedules?kw=${weekNumber}&year=${year}${standort ? "&standort=" + encodeURIComponent(standort) : ""}`);
      if (!res.ok) throw new Error("Fehler beim Laden der Schichten");
      return res.json();
    },
  });

  const shifts = data?.schedule?.shifts ?? [];

  // Build employee rows
  const employees = useMemo(() => {
    const userMap = new Map<string, EmployeeRow>();

    for (const shift of shifts) {
      for (const booking of shift.bookings) {
        if (!userMap.has(booking.userId)) {
          userMap.set(booking.userId, {
            user: booking.user,
            dayShifts: { 1: [], 2: [], 3: [], 4: [], 5: [], 6: [], 7: [] },
            totalHours: 0,
          });
        }
        const row = userMap.get(booking.userId)!;
        row.dayShifts[shift.dayOfWeek].push(shift);
        row.totalHours += shiftDurationHours(shift);
      }
    }

    // Sort by last name
    return Array.from(userMap.values()).sort((a, b) =>
      a.user.lastName.localeCompare(b.user.lastName)
    );
  }, [shifts]);

  if (isLoading) {
    return <EmployeeGridSkeleton />;
  }

  if (employees.length === 0) {
    return (
      <div className="akro-panel p-6 text-[14px] text-muted-foreground">
        Keine eingeplanten Mitarbeitenden in dieser Woche.
      </div>
    );
  }

  return (
    <>
      {/* Ab Tablet: Tabelle, Zeilen = Personen, Spalten = Mo-So */}
      <div className="akro-panel hidden overflow-x-auto md:block">
        <table className="w-full border-collapse">
          <thead>
            <tr className="akro-panel-kopf">
              <th className="border-r px-3 py-2 text-left text-xs font-semibold text-muted-foreground w-44">
                Mitarbeiter
              </th>
              {weekDates.map((date, idx) => {
                const today = isToday(date);
                return (
                  <th
                    key={idx}
                    className={cn(
                      "border-r px-3 py-2 text-center text-xs font-semibold min-w-[100px]",
                      today && "bg-[var(--flaeche-heute)] text-primary"
                    )}
                  >
                    <div>{dayNames[idx]}</div>
                    <div className="text-[10px] text-muted-foreground font-normal">
                      {formatDateShort(date)}
                    </div>
                  </th>
                );
              })}
              <th className="px-3 py-2 text-center text-xs font-semibold text-muted-foreground w-20">
                Stunden
              </th>
            </tr>
          </thead>
          <tbody>
            {employees.map((emp) => (
              <tr key={emp.user.id} className="border-t hover:bg-muted/10 transition-colors">
                {/* Employee name */}
                <td className="border-r px-3 py-2 align-middle">
                  <div className="flex items-center gap-2">
                    <Avatar size="sm">
                      <AvatarFallback className="text-[9px]">
                        {getInitials(emp.user.firstName, emp.user.lastName)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="text-xs font-medium truncate max-w-[120px]">
                      {emp.user.firstName} {emp.user.lastName}
                    </div>
                  </div>
                </td>

                {/* Day cells */}
                {Array.from({ length: 7 }, (_, dayIdx) => {
                  const day = dayIdx + 1;
                  const dayShifts = emp.dayShifts[day] ?? [];
                  const today = isToday(weekDates[dayIdx]);

                  return (
                    <td
                      key={day}
                      className={cn(
                        "border-r px-2 py-1.5 align-middle text-center min-w-[100px]",
                        today && "bg-[var(--flaeche-heute)]"
                      )}
                    >
                      {dayShifts.length === 0 ? (
                        <span className="text-[10px] text-muted-foreground/50" aria-label="frei">–</span>
                      ) : (
                        <div className="space-y-0.5">
                          {dayShifts.map((shift) => (
                            <SchichtMarke key={shift.id} shift={shift} zeigeStandort={!standort} />
                          ))}
                        </div>
                      )}
                    </td>
                  );
                })}

                {/* Total hours */}
                <td className="px-3 py-2 align-middle text-center">
                  <span className="tabular text-xs font-semibold">
                    {emp.totalHours.toFixed(1)} h
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Handy: je Person eine Karte mit ihren Schichten der Woche */}
      <div className="space-y-3 md:hidden">
        {employees.map((emp) => (
          <section key={emp.user.id} className="akro-panel overflow-hidden" aria-label={`${emp.user.firstName} ${emp.user.lastName}`}>
            <div className="akro-panel-kopf flex items-center gap-2 border-b px-4 py-2.5">
              <Avatar size="sm">
                <AvatarFallback className="text-[9px]">
                  {getInitials(emp.user.firstName, emp.user.lastName)}
                </AvatarFallback>
              </Avatar>
              <span className="min-w-0 flex-1 truncate text-[14px] font-semibold">
                {emp.user.firstName} {emp.user.lastName}
              </span>
              <span className="tabular text-[13px] text-muted-foreground">{emp.totalHours.toFixed(1)} h</span>
            </div>
            <ul className="divide-y divide-[var(--linie-fein)]">
              {weekDates.flatMap((date, dayIdx) =>
                (emp.dayShifts[dayIdx + 1] ?? []).map((shift) => (
                  <li key={shift.id} className={cn("flex items-baseline gap-3 px-4 py-2.5", isToday(date) && "bg-[var(--flaeche-heute)]")}>
                    <span className="w-16 shrink-0 text-[13px] font-medium">
                      {dayNames[dayIdx]} {formatDateShort(date)}
                      {isToday(date) && <span className="block text-[11px] font-medium text-primary">heute</span>}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="tabular block text-[14px] font-semibold">{shift.shiftFrom}–{shift.shiftTo}</span>
                      <span className="block truncate text-[13px] text-muted-foreground">
                        {[standort ? null : shift.branch?.name, shift.title].filter(Boolean).join(" · ") || "Schicht"}
                      </span>
                    </span>
                  </li>
                ))
              )}
            </ul>
          </section>
        ))}
      </div>
    </>
  );
}

/** Eine Schicht in der Tabelle: lesbare Zeit, Bereichsfarbe nur als Kante. */
function SchichtMarke({ shift, zeigeStandort }: { shift: ShiftData; zeigeStandort: boolean }) {
  return (
    <div
      title={shift.branch?.name}
      className="inline-block rounded-[6px] border border-l-[3px] bg-card px-1.5 py-0.5 text-left text-[11px] leading-snug"
      style={{ borderLeftColor: shift.division?.color ?? "var(--line)" }}
    >
      <span className="tabular font-medium text-foreground">{shift.shiftFrom}–{shift.shiftTo}</span>
      {/* In der zusammengefuehrten Sicht steht der Standort dabei. */}
      {zeigeStandort && shift.branch && (
        <span className="block max-w-[110px] truncate text-[10px] text-muted-foreground">{shift.branch.name}</span>
      )}
    </div>
  );
}

function EmployeeGridSkeleton() {
  return (
    <div className="akro-panel overflow-hidden">
      <div className="akro-panel-kopf px-3 py-2 flex gap-4">
        <Skeleton className="h-4 w-32" />
        {Array.from({ length: 7 }).map((_, i) => (
          <Skeleton key={i} className="h-4 w-16" />
        ))}
        <Skeleton className="h-4 w-12" />
      </div>
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="border-t px-3 py-2 flex gap-4">
          <Skeleton className="h-6 w-32" />
          {Array.from({ length: 7 }).map((_, j) => (
            <Skeleton key={j} className="h-5 w-16" />
          ))}
          <Skeleton className="h-4 w-12" />
        </div>
      ))}
    </div>
  );
}
