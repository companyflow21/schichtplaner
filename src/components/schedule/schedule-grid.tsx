"use client";

import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { isToday } from "date-fns";
import { Skeleton } from "@/components/ui/skeleton";
import { dayNames, formatDateShort } from "@/lib/utils/calendar";
import { useCurrentMember } from "@/lib/hooks/use-current-member";
import { cn } from "@/lib/utils";
import { ScheduleToolbar } from "./schedule-toolbar";
import { ShiftCard } from "./shift-card";
import { ShiftForm } from "./shift-form";
import { EmployeeNav } from "./employee-nav";
import { LiveBorder } from "./live-mode";
import type { WishRequest } from "./wish-plan";
import type { ScheduleData, ShiftData } from "@/types/schedule";

interface ScheduleGridProps {
  weekNumber: number;
  year: number;
  weekDates: Date[];
}

export function ScheduleGrid({ weekNumber, year, weekDates }: ScheduleGridProps) {
  const { data: member } = useCurrentMember();
  const isManager =
    member?.role === "OWNER" ||
    member?.role === "ADMIN" ||
    member?.role === "MANAGER";

  // Employee filter state
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(null);

  // Division filter state
  const [divisionFilter, setDivisionFilter] = useState<string | null>(null);

  // Fetch schedule with shifts via the schedule endpoint
  const { data, isLoading } = useQuery<{ schedule: ScheduleData }>({
    queryKey: ["schedule", weekNumber, year],
    queryFn: async () => {
      const res = await fetch(`/api/schedules?kw=${weekNumber}&year=${year}`);
      if (!res.ok) throw new Error("Fehler beim Laden der Schichten");
      return res.json();
    },
  });

  const schedule = data?.schedule ?? null;
  const scheduleId = schedule?.id ?? "";
  const shifts = schedule?.shifts ?? [];
  const layout = schedule?.settingsLayout ?? "LAYOUT_1";
  const showTitle = schedule?.showTitle ?? true;
  const showPauses = schedule?.showPauses ?? true;

  // Live-Sitzung: markiert das Board waehrend der gemeinsamen Planung
  const { data: liveData } = useQuery<{ session: { isActive: boolean } | null }>({
    queryKey: ["live-session", scheduleId],
    queryFn: async () => {
      const res = await fetch(`/api/live?scheduleId=${scheduleId}`);
      if (!res.ok) return { session: null };
      return res.json();
    },
    enabled: !!scheduleId,
  });
  const isLiveActive = liveData?.session?.isActive ?? false;

  // Wish filter state
  const [wishFilterEnabled, setWishFilterEnabled] = useState(false);

  // Query wish requests for this schedule
  const { data: wishData } = useQuery<{ requests: WishRequest[] }>({
    queryKey: ["mod-requests", scheduleId],
    queryFn: async () => {
      const res = await fetch(`/api/mod-requests?scheduleId=${scheduleId}`);
      if (!res.ok) return { requests: [] };
      return res.json();
    },
    enabled: !!scheduleId,
  });

  const wishRequests = wishData?.requests ?? [];
  const openWishCount = wishRequests.filter((r) => r.state === "OPEN").length;

  // Map wish requests by shiftId for quick lookup
  const wishByShift = useMemo(() => {
    const map = new Map<string, WishRequest[]>();
    for (const req of wishRequests) {
      const existing = map.get(req.shiftId) ?? [];
      existing.push(req);
      map.set(req.shiftId, existing);
    }
    return map;
  }, [wishRequests]);

  // Get the current user's wish requests
  const userWishMap = useMemo(() => {
    const map = new Map<string, WishRequest>();
    const userId = member?.user?.id;
    if (!userId) return map;
    for (const req of wishRequests) {
      if (req.userId === userId) {
        map.set(req.shiftId, req);
      }
    }
    return map;
  }, [wishRequests, member?.user?.id]);

  // Group shifts by dayOfWeek, applying division filter and wish filter
  const shiftsByDay = useMemo(() => {
    let filtered = divisionFilter
      ? shifts.filter((s) => s.divisionId === divisionFilter)
      : shifts;

    // Wish filter: only show shifts that have open wish requests
    if (wishFilterEnabled) {
      filtered = filtered.filter((s) => {
        const reqs = wishByShift.get(s.id);
        return reqs && reqs.some((r) => r.state === "OPEN");
      });
    }

    const grouped: Record<number, ShiftData[]> = {};
    for (let d = 1; d <= 7; d++) {
      grouped[d] = [];
    }
    for (const shift of filtered) {
      if (grouped[shift.dayOfWeek]) {
        grouped[shift.dayOfWeek].push(shift);
      }
    }
    // Sort each day's shifts by shiftFrom
    for (const day of Object.keys(grouped)) {
      grouped[Number(day)].sort((a, b) => a.shiftFrom.localeCompare(b.shiftFrom));
    }
    return grouped;
  }, [shifts, divisionFilter, wishFilterEnabled, wishByShift]);

  // Neue Schichten landen auf dem heutigen Wochentag, sonst auf Montag.
  const ersterTagDerWoche = useMemo(() => {
    const heute = weekDates.findIndex((d) => isToday(d));
    return heute >= 0 ? heute + 1 : 1;
  }, [weekDates]);

  // Dialog state
  const [formOpen, setFormOpen] = useState(false);
  const [formDay, setFormDay] = useState(1);
  const [editingShift, setEditingShift] = useState<ShiftData | null>(null);

  function handleAddShift(dayOfWeek: number) {
    setEditingShift(null);
    setFormDay(dayOfWeek);
    setFormOpen(true);
  }

  function handleEditShift(shift: ShiftData) {
    setEditingShift(shift);
    setFormDay(shift.dayOfWeek);
    setFormOpen(true);
  }

  if (isLoading) {
    return <ScheduleGridSkeleton />;
  }

  return (
    <>
      <ScheduleToolbar
        weekNumber={weekNumber}
        year={year}
        schedule={schedule}
        isManager={isManager}
        divisionFilter={divisionFilter}
        onDivisionFilterChange={setDivisionFilter}
        wishFilterEnabled={wishFilterEnabled}
        onWishFilterChange={setWishFilterEnabled}
        openWishCount={openWishCount}
        onAddShift={() => handleAddShift(ersterTagDerWoche)}
      />

      {/* Employee filter bar */}
      {shifts.length > 0 && (
        <div className="mb-4">
          <EmployeeNav
            shifts={shifts}
            selectedEmployeeId={selectedEmployeeId}
            onSelectEmployee={setSelectedEmployeeId}
          />
        </div>
      )}

      {/* Planungsflaeche: ein Board, sieben Spalten, Haarlinien dazwischen */}
      <LiveBorder isActive={isLiveActive}>
        <div className="akro-panel hidden overflow-hidden md:block">
          <div className="grid grid-cols-7 divide-x divide-[var(--linie-fein)]">
            {weekDates.map((date, index) => {
              const dayOfWeek = index + 1; // 1=Mo .. 7=So
              const dayShifts = shiftsByDay[dayOfWeek] ?? [];
              const heute = isToday(date);
              const offen = offeneMenge(dayShifts);

              return (
                <div key={dayOfWeek} className="flex min-h-[19rem] flex-col">
                  <TagesKopf
                    kuerzel={dayNames[index]}
                    datum={formatDateShort(date)}
                    anzahl={dayShifts.length}
                    offen={offen}
                    heute={heute}
                  />

                  <div
                    className={cn(
                      "flex-1 space-y-2 p-2",
                      heute ? "bg-[var(--flaeche-heute)]" : "akro-vertieft"
                    )}
                  >
                    {dayShifts.length === 0 && (
                      <p className="py-6 text-center text-[12px] text-muted-foreground">
                        Keine Schichten
                      </p>
                    )}

                    {dayShifts.map((shift) => (
                      <ShiftCard
                        key={shift.id}
                        shift={shift}
                        onEdit={handleEditShift}
                        isManager={isManager}
                        currentUserId={member?.user?.id}
                        highlightUserId={selectedEmployeeId}
                        layout={layout}
                        showTitle={showTitle}
                        showPauses={showPauses}
                        userWishRequest={userWishMap.get(shift.id) ?? null}
                      />
                    ))}

                    {isManager && (
                      <SchichtHinzufuegen
                        onClick={() => handleAddShift(dayOfWeek)}
                        label="Schicht"
                      />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </LiveBorder>

      {/* Handy: ein Tag nach dem anderen, gleiche Kopfzeile */}
      <LiveBorder isActive={isLiveActive}>
        <div className="space-y-3 md:hidden">
          {weekDates.map((date, index) => {
            const dayOfWeek = index + 1;
            const dayShifts = shiftsByDay[dayOfWeek] ?? [];
            const heute = isToday(date);

            return (
              <div key={dayOfWeek} className="akro-panel overflow-hidden">
                <TagesKopf
                  kuerzel={dayNames[index]}
                  datum={formatDateShort(date)}
                  anzahl={dayShifts.length}
                  offen={offeneMenge(dayShifts)}
                  heute={heute}
                  breit
                />

                <div
                  className={cn(
                    "space-y-2 p-3",
                    heute ? "bg-[var(--flaeche-heute)]" : "akro-vertieft"
                  )}
                >
                  {dayShifts.length === 0 && (
                    <p className="py-2 text-center text-[12px] text-muted-foreground">
                      Keine Schichten
                    </p>
                  )}

                  {dayShifts.map((shift) => (
                    <ShiftCard
                      key={shift.id}
                      shift={shift}
                      onEdit={handleEditShift}
                      isManager={isManager}
                      currentUserId={member?.user?.id}
                      highlightUserId={selectedEmployeeId}
                      layout={layout}
                      showTitle={showTitle}
                      showPauses={showPauses}
                      userWishRequest={userWishMap.get(shift.id) ?? null}
                    />
                  ))}

                  {isManager && (
                    <SchichtHinzufuegen
                      onClick={() => handleAddShift(dayOfWeek)}
                      label="Schicht hinzufügen"
                    />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </LiveBorder>

      {/* Shift Form Dialog */}
      {scheduleId && (
        <ShiftForm
          open={formOpen}
          onOpenChange={setFormOpen}
          scheduleId={scheduleId}
          defaultDayOfWeek={formDay}
          shift={editingShift}
        />
      )}
    </>
  );
}

/** Wie viele Plaetze an diesem Tag noch offen sind. */
function offeneMenge(shifts: ShiftData[]): number {
  return shifts.reduce(
    (summe, shift) =>
      summe +
      Math.max(0, shift.maxEmployees - (shift.occupiedCount ?? shift.bookings.length)),
    0
  );
}

/**
 * Spaltenkopf des Boards: Tag, Datum und die Lage in einer Zeile.
 * Der heutige Tag traegt die Markenkante - keine zweite Auszeichnung.
 */
function TagesKopf({
  kuerzel,
  datum,
  anzahl,
  offen,
  heute,
  breit = false,
}: {
  kuerzel: string;
  datum: string;
  anzahl: number;
  offen: number;
  heute: boolean;
  breit?: boolean;
}) {
  return (
    <div
      className={cn(
        "relative border-b",
        breit ? "px-4 py-2.5" : "px-3 py-2",
        heute ? "bg-[var(--flaeche-heute)]" : "akro-panel-kopf"
      )}
    >
      {heute && (
        <span
          aria-hidden="true"
          className="akro-markenlinie absolute inset-x-0 top-0 h-[2px]"
        />
      )}
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[13px] font-semibold tracking-[-0.01em]">
          {kuerzel}
          {heute && (
            <span className="ml-1.5 text-[11px] font-medium text-primary">
              heute
            </span>
          )}
        </span>
        <span className="tabular text-[12px] text-muted-foreground">{datum}</span>
      </div>
      <p className="tabular mt-0.5 text-[11px] text-muted-foreground">
        {anzahl} {anzahl === 1 ? "Schicht" : "Schichten"}
        {offen > 0 && (
          <span className="font-medium text-destructive">
            {" · "}
            {offen} offen
          </span>
        )}
      </p>
    </div>
  );
}

/** Ruhiger Platzhalter am Spaltenende statt einer weiteren Schaltflaeche. */
function SchichtHinzufuegen({
  onClick,
  label,
}: {
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center justify-center gap-1.5 rounded-[var(--radius)] border border-dashed border-border py-1.5 text-[12px] text-muted-foreground transition-colors hover:border-primary/60 hover:bg-card hover:text-foreground"
    >
      <Plus className="size-3.5" />
      {label}
    </button>
  );
}

/** Geruest in der Form des Boards. */
function ScheduleGridSkeleton() {
  return (
    <div className="akro-panel hidden overflow-hidden md:block" aria-busy="true">
      <div className="grid grid-cols-7 divide-x divide-[var(--linie-fein)]">
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="min-h-[19rem]">
            <div className="akro-panel-kopf space-y-1.5 border-b px-3 py-2">
              <Skeleton className="h-3.5 w-10" />
              <Skeleton className="h-3 w-16" />
            </div>
            <div className="space-y-2 p-2">
              <Skeleton className="h-24 w-full rounded-[var(--radius)]" />
              <Skeleton className="h-16 w-full rounded-[var(--radius)]" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
