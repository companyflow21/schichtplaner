"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { CalendarDays, Plus } from "lucide-react";
import { isToday } from "date-fns";
import { Skeleton } from "@/components/ui/skeleton";
import { dayNames, formatDateShort } from "@/lib/utils/calendar";
import { useCurrentMember } from "@/lib/hooks/use-current-member";
import { cn } from "@/lib/utils";
import { json } from "@/components/workforce/client";
import { ScheduleToolbar } from "./schedule-toolbar";
import { ShiftCard } from "./shift-card";
import { ShiftForm } from "./shift-form";
import { EmployeeNav } from "./employee-nav";
import { LiveBorder } from "./live-mode";
import type { WishRequest } from "./wish-plan";
import type { ScheduleResponse, ShiftData } from "@/types/schedule";

interface ScheduleGridProps {
  weekNumber: number;
  year: number;
  weekDates: Date[];
  /** Standort-ID oder "ohne" (Altbestand, nur Admins) */
  standort: string;
}

export function ScheduleGrid({ weekNumber, year, weekDates, standort }: ScheduleGridProps) {
  const { data: member } = useCurrentMember();

  // Employee filter state
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(null);

  // Division filter state
  const [divisionFilter, setDivisionFilter] = useState<string | null>(null);

  // Wochenplan dieses Standorts - mit den Rechten der angemeldeten Person
  const { data, isLoading, error } = useQuery<ScheduleResponse>({
    queryKey: ["schedule", weekNumber, year, standort],
    queryFn: () => json<ScheduleResponse>(`/api/schedules?kw=${weekNumber}&year=${year}&standort=${encodeURIComponent(standort)}`),
    retry: false,
  });

  const schedule = data?.schedule ?? null;
  const access = data?.access;
  const branch = data?.branch ?? null;
  const scheduleId = schedule?.id ?? "";
  const shifts = useMemo(() => schedule?.shifts ?? [], [schedule]);
  const layout = schedule?.settingsLayout ?? "LAYOUT_1";
  const showTitle = schedule?.showTitle ?? true;
  const showPauses = schedule?.showPauses ?? true;
  const canEdit = !!access?.edit;
  const canAdd = canEdit && (standort === "ohne" ? false : !!branch?.plannable);

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

  // Antraege zu diesem Plan (die API liefert nur, was sichtbar ist)
  const { data: wishData } = useQuery<{ requests: WishRequest[] }>({
    queryKey: ["mod-requests", scheduleId],
    queryFn: async () => {
      const res = await fetch(`/api/mod-requests?scheduleId=${scheduleId}`);
      if (!res.ok) return { requests: [] };
      return res.json();
    },
    enabled: !!scheduleId,
  });

  const wishRequests = useMemo(() => wishData?.requests ?? [], [wishData]);
  const openWishCount = wishRequests.filter((r) => r.state === "OPEN" && r.can?.decide).length;

  const wishByShift = useMemo(() => {
    const map = new Map<string, WishRequest[]>();
    for (const req of wishRequests) {
      const existing = map.get(req.shiftId) ?? [];
      existing.push(req);
      map.set(req.shiftId, existing);
    }
    return map;
  }, [wishRequests]);

  // Eigene Antraege der angemeldeten Person
  const userWishMap = useMemo(() => {
    const map = new Map<string, WishRequest>();
    const userId = member?.user?.id;
    if (!userId) return map;
    for (const req of wishRequests) {
      if (req.userId === userId) map.set(req.shiftId, req);
    }
    return map;
  }, [wishRequests, member?.user?.id]);

  // Group shifts by dayOfWeek, applying division filter and wish filter
  const shiftsByDay = useMemo(() => {
    let filtered = divisionFilter ? shifts.filter((s) => s.divisionId === divisionFilter) : shifts;
    if (wishFilterEnabled) {
      filtered = filtered.filter((s) => (wishByShift.get(s.id) ?? []).some((r) => r.state === "OPEN"));
    }
    const grouped: Record<number, ShiftData[]> = {};
    for (let d = 1; d <= 7; d++) grouped[d] = [];
    for (const shift of filtered) grouped[shift.dayOfWeek]?.push(shift);
    for (const day of Object.keys(grouped)) grouped[Number(day)].sort((a, b) => a.shiftFrom.localeCompare(b.shiftFrom));
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

  if (isLoading) return <ScheduleGridSkeleton />;

  if (error || !data) {
    return (
      <div className="akro-panel space-y-2 p-5 text-[14px]">
        <p>Dieser Standortplan ist nicht freigegeben oder existiert nicht.</p>
        <Link href="/schedule/month" className="font-medium text-primary underline-offset-4 hover:underline">Standort wählen</Link>
      </div>
    );
  }

  return (
    <>
      <ScheduleToolbar
        weekNumber={weekNumber}
        year={year}
        standort={standort}
        schedule={schedule}
        branch={branch}
        access={access}
        isAdmin={!!member?.access?.isAdmin}
        divisionFilter={divisionFilter}
        onDivisionFilterChange={setDivisionFilter}
        wishFilterEnabled={wishFilterEnabled}
        onWishFilterChange={setWishFilterEnabled}
        openWishCount={openWishCount}
        onAddShift={canAdd ? () => handleAddShift(ersterTagDerWoche) : undefined}
        selectedEmployeeId={selectedEmployeeId}
      />

      {canEdit && branch && !branch.plannable && (
        <p className="mb-4 rounded-[var(--radius)] border border-warn/40 bg-warn/[0.06] px-3 py-2 text-[13px]">
          {branch.isActive ? "Standort ohne Kunde: neue Schichten erst nach der Zuordnung unter Einsatzorte." : "Standort inaktiv: keine neuen Schichten möglich."}
        </p>
      )}
      {canEdit && schedule && schedule.id && !schedule.isPublic && shifts.length > 0 && (
        <p className="mb-4 rounded-[var(--radius)] border border-warn/40 bg-warn/[0.06] px-3 py-2 text-[13px]" role="status">
          <strong>Entwurf:</strong> Diese Woche ist gespeichert, aber für Mitarbeitende unsichtbar – auch wenn die App online erreichbar ist. Erst „Veröffentlichen“ gibt sie frei und benachrichtigt die Eingeteilten. Jede Woche und jeder Standort wird einzeln veröffentlicht.
        </p>
      )}
      {canEdit && branch && !branch.holidayState && (
        <p className="mb-4 rounded-[var(--radius)] border border-warn/40 bg-warn/[0.06] px-3 py-2 text-[13px]">
          Für diesen Einsatzort ist kein Bundesland festgelegt. Angezeigt werden nur bundesweite Feiertage; landesrechtliche (z. B. Reformationstag in Thüringen, Allerheiligen in NRW) fehlen. Festlegen unter Einsatzorte → Bearbeiten.
        </p>
      )}
      {standort === "ohne" && (
        <p className="mb-4 rounded-[var(--radius)] border border-warn/40 bg-warn/[0.06] px-3 py-2 text-[13px]">
          Altbestand ohne Standort – nur für die Administration sichtbar. Beim Bearbeiten einen Standort wählen.
        </p>
      )}

      {/* Employee filter bar */}
      {shifts.some((s) => s.bookings.length) && (
        <div className="mb-4">
          <EmployeeNav shifts={shifts} selectedEmployeeId={selectedEmployeeId} onSelectEmployee={setSelectedEmployeeId} />
        </div>
      )}

      {/* Sieben Tageskarten; schmale Bildschirme scrollen nur innerhalb des Boards. */}
      <LiveBorder isActive={isLiveActive}>
        <div className="hidden max-w-full overflow-x-auto pb-3 md:block">
          <div className="grid min-w-[1120px] grid-cols-7 items-start gap-2">
            {weekDates.map((date, index) => {
              const dayOfWeek = index + 1; // 1=Mo .. 7=So
              const dayShifts = shiftsByDay[dayOfWeek] ?? [];
              const heute = isToday(date);
              return (
                <div key={dayOfWeek} className={cn("akro-panel flex min-h-[28rem] min-w-0 flex-col overflow-hidden", heute && "border-primary/40")}>
                  <TagesKopf kuerzel={dayNames[index]} datum={formatDateShort(date)} anzahl={dayShifts.length} offen={offeneMenge(dayShifts)} heute={heute} feiertag={branch?.holidays?.find((h) => h.dayOfWeek === dayOfWeek)?.name} />
                  <div className={cn("flex flex-1 flex-col gap-2 p-2", heute && "bg-[var(--flaeche-heute)]")}>
                    {dayShifts.length === 0 && <LeererTag />}
                    {dayShifts.map((shift) => (
                      <ShiftCard
                        key={shift.id}
                        shift={shift}
                        onEdit={handleEditShift}
                        canEdit={!!shift.can?.edit}
                        currentUserId={member?.user?.id}
                        highlightUserId={selectedEmployeeId}
                        layout={layout}
                        showTitle={showTitle}
                        showPauses={showPauses}
                        userWishRequest={userWishMap.get(shift.id) ?? null}
                        zeigeStandort={false}
                      />
                    ))}
                    {canAdd && <SchichtHinzufuegen onClick={() => handleAddShift(dayOfWeek)} label="Schicht" />}
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
                <TagesKopf kuerzel={dayNames[index]} datum={formatDateShort(date)} anzahl={dayShifts.length} offen={offeneMenge(dayShifts)} heute={heute} feiertag={branch?.holidays?.find((h) => h.dayOfWeek === dayOfWeek)?.name} breit />
                <div className={cn("space-y-3 p-3", heute && "bg-[var(--flaeche-heute)]")}>
                  {dayShifts.length === 0 && <p className="py-2 text-center text-[12px] text-muted-foreground">Keine Schichten</p>}
                  {dayShifts.map((shift) => (
                    <ShiftCard
                      key={shift.id}
                      shift={shift}
                      onEdit={handleEditShift}
                      canEdit={!!shift.can?.edit}
                      currentUserId={member?.user?.id}
                      highlightUserId={selectedEmployeeId}
                      layout={layout}
                      showTitle={showTitle}
                      showPauses={showPauses}
                      userWishRequest={userWishMap.get(shift.id) ?? null}
                      zeigeStandort={false}
                    />
                  ))}
                  {canAdd && <SchichtHinzufuegen onClick={() => handleAddShift(dayOfWeek)} label="Schicht hinzufügen" />}
                </div>
              </div>
            );
          })}
        </div>
      </LiveBorder>

      {/* Shift Form Dialog */}
      {scheduleId && canEdit && (
        <ShiftForm open={formOpen} onOpenChange={setFormOpen} scheduleId={scheduleId} branchId={branch?.id ?? null} defaultDayOfWeek={formDay} shift={editingShift} />
      )}
    </>
  );
}

/** Wie viele Plaetze an diesem Tag noch offen sind (wirksame Zuweisungen). */
function offeneMenge(shifts: ShiftData[]): number {
  return shifts.reduce((summe, shift) => summe + (shift.missing ?? Math.max(0, shift.maxEmployees - (shift.occupiedCount ?? shift.bookings.length))), 0);
}

/** Tag und Datum bilden die ruhige Orientierung oberhalb der Schichten. */
function TagesKopf({ kuerzel, datum, anzahl, offen, heute, feiertag, breit = false }: { kuerzel: string; datum: string; anzahl: number; offen: number; heute: boolean; feiertag?: string; breit?: boolean }) {
  return (
    <div className={cn("border-b px-3 py-3", heute ? "bg-[var(--flaeche-heute)] text-primary" : "bg-card", !breit && "text-center")}>
      <div className={cn("flex gap-2", breit ? "items-center justify-between" : "flex-col items-center gap-0.5")}>
        <span className="text-[14px] font-semibold">{kuerzel}{heute && <span className="ml-1.5 text-[11px] font-medium">heute</span>}</span>
        <span className={cn("tabular text-[12px]", !heute && "text-muted-foreground")}>{datum}</span>
      </div>
      {feiertag && <p className="mt-1 text-[11px] font-medium text-warn">Feiertag: {feiertag}</p>}
      <div className={cn("mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground", !breit && "justify-center")}>
        <span>{anzahl} {anzahl === 1 ? "Schicht" : "Schichten"}</span>
        {offen > 0 && <span className="font-medium text-warn">{offen} offen</span>}
      </div>
    </div>
  );
}

function LeererTag() {
  return (
    <div className="flex min-h-48 flex-1 flex-col items-center justify-center gap-2 rounded-lg bg-muted/40 px-3 py-6 text-center text-muted-foreground">
      <CalendarDays className="size-6 opacity-60" aria-hidden="true" />
      <p className="text-[13px] font-medium">Keine Schichten</p>
      <p className="text-[12px] leading-5">Für diesen Tag ist noch keine Schicht geplant.</p>
    </div>
  );
}

function SchichtHinzufuegen({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mt-auto flex min-h-10 w-full items-center max-md:min-h-11 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary justify-center gap-1.5 rounded-lg border border-dashed border-primary/30 bg-primary/[0.03] px-2 py-2 text-[12px] font-medium text-primary transition-colors hover:border-primary hover:bg-primary/10"
    >
      <Plus className="size-3.5" aria-hidden="true" />
      {label}
    </button>
  );
}

/** Geruest in der Form des Boards. */
function ScheduleGridSkeleton() {
  return (
    <div className="max-w-full overflow-hidden" aria-busy="true" aria-label="Dienstplan wird geladen">
      <div className="grid grid-cols-1 gap-3 md:min-w-[1120px] md:grid-cols-7 md:gap-2">
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
