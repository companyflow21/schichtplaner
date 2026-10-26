"use client";

import { useState, useMemo, useEffect, useRef, type ReactNode } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Plus, X } from "lucide-react";
import { isToday } from "date-fns";
import { Skeleton } from "@/components/ui/skeleton";
import { dayNames, formatDateShort, formatKW } from "@/lib/utils/calendar";
import { useCurrentMember } from "@/lib/hooks/use-current-member";
import { cn } from "@/lib/utils";
import { json } from "@/components/workforce/client";
import { FOKUS_NACH_BLAETTERN, offenePlätze, ScheduleToolbar } from "./schedule-toolbar";
import { ShiftCard } from "./shift-card";
import { ShiftForm, type ShiftFormVorlage } from "./shift-form";
import { EmployeeNav } from "./employee-nav";
import { LiveBorder } from "./live-mode";
import { ConflictPanel, useWeekConflicts } from "./conflict-panel";
import { PlanStatusBanner, planStatus } from "./plan-status-banner";
import { RuleViolationPanel, useViolations } from "./rule-violations";
import type { WishRequest } from "./wish-plan";
import type { ScheduleResponse, ShiftData } from "@/types/schedule";
import type { ConflictItem } from "@/types/conflicts";

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
  // Vorbelegung fuer neue Schichten: die zuletzt angelegte Schicht der Woche. Die Pause nur
  // bei "Pro Schicht" - "Pro Stunde" wuerde im Dialog als Minuten je Schicht missverstanden.
  const vorlage = useMemo<ShiftFormVorlage | null>(() => {
    const juengste = [...shifts].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    if (!juengste) return null;
    return { shiftFrom: juengste.shiftFrom, shiftTo: juengste.shiftTo, pauseMinutes: juengste.pauseOption === "PER_SHIFT" ? juengste.pauseValue : 0, title: juengste.title, maxEmployees: juengste.maxEmployees, divisionId: juengste.divisionId };
  }, [shifts]);
  const layout = schedule?.settingsLayout ?? "LAYOUT_1";
  const showTitle = schedule?.showTitle ?? true;
  const showPauses = schedule?.showPauses ?? true;
  const canEdit = !!access?.edit;
  const canAdd = canEdit && (standort === "ohne" ? false : !!branch?.plannable);

  // Konfliktpruefung der Woche (nur Planung), je Schicht fuer die Karten.
  const planner = !!access?.planner;
  const conflicts = useWeekConflicts(weekNumber, year, standort, planner);
  const conflictsByShift = useMemo(() => {
    const map = new Map<string, ConflictItem[]>();
    for (const c of conflicts.data?.items ?? []) map.set(c.shiftId, [...(map.get(c.shiftId) ?? []), c]);
    return map;
  }, [conflicts.data]);
  // Regelverstoesse der Woche (Planungsregeln, nur Planung) - Hinweise, keine Sperre.
  const violations = useViolations(scheduleId, planner);

  // Sprung aus dem Konfliktpanel: Filter loesen, zur sichtbaren Karte (Raster oder Handy-Liste) scrollen, kurz hervorheben.
  // Je Klick ein neues Objekt: auch ein zweiter Klick auf dieselbe Schicht springt erneut.
  const [sprung, setSprung] = useState<{ shiftId: string } | null>(null);
  useEffect(() => {
    if (!sprung) return;
    const ziel = [document.getElementById("schicht-" + sprung.shiftId), document.getElementById("schicht-mobil-" + sprung.shiftId)].find((el) => el && el.offsetParent !== null);
    ziel?.scrollIntoView({ block: "center", inline: "nearest" });
    ziel?.focus({ preventScroll: true });
    const timer = setTimeout(() => setSprung(null), 2000);
    return () => clearTimeout(timer);
  }, [sprung]);
  function springeZuSchicht(shiftId: string) {
    setDivisionFilter(null);
    setWishFilterEnabled(false);
    setSprung({ shiftId });
  }

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

  // Nach dem Blaettern: Fokus auf den Zeitraum statt auf BODY. Sonst auf dem
  // Handy beim ersten Laden der aktuellen Woche zum heutigen Tag scrollen.
  const zeitraumRef = useRef<HTMLElement>(null);
  const geladen = !!data;
  useEffect(() => {
    if (!geladen) return;
    let nachBlättern = false;
    try {
      nachBlättern = sessionStorage.getItem(FOKUS_NACH_BLAETTERN) === "1";
      sessionStorage.removeItem(FOKUS_NACH_BLAETTERN);
    } catch {
      // Ohne Speicher kein Fokuswechsel.
    }
    if (nachBlättern) {
      zeitraumRef.current?.focus();
      return;
    }
    if (window.matchMedia("(max-width: 767px)").matches) document.getElementById("tag-heute-mobil")?.scrollIntoView({ block: "start" });
  }, [geladen, weekNumber, year, standort]);

  if (isLoading) return <ScheduleGridSkeleton />;

  if (error || !data) {
    return (
      <div className="akro-panel space-y-2 p-5 text-[14px]">
        <p>Dieser Standortplan ist nicht freigegeben oder existiert nicht.</p>
        <Link href={`/schedule/flexible/${formatKW(weekNumber, year)}?wahl=1`} className="font-medium text-primary underline-offset-4 hover:underline">Standort wählen</Link>
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
        konflikteFrei={planner && !!conflicts.data && conflicts.data.counts.fehler + conflicts.data.counts.hinweis === 0}
        mitarbeiterFilter={shifts.some((s) => s.bookings.length) ? <EmployeeNav shifts={shifts} selectedEmployeeId={selectedEmployeeId} onSelectEmployee={setSelectedEmployeeId} /> : undefined}
        zeitraumRef={zeitraumRef}
      />

      {canEdit && branch && !branch.plannable && (
        <Hinweiszeile aktion={branch.isActive ? <HinweisLink href="/divisions">Jetzt zuordnen</HinweisLink> : undefined}>
          {branch.isActive ? "Standort ohne Kunde: neue Schichten erst nach der Zuordnung." : "Standort inaktiv: keine neuen Schichten möglich."}
        </Hinweiszeile>
      )}
      {branch?.archivedAt && (
        <Hinweiszeile>Einsatzort archiviert: nur Ansicht. Planen nach dem Wiederherstellen unter Einsatzorte → Archiv.</Hinweiszeile>
      )}
      <PlanStatusBanner schedule={schedule} access={access} standort={standort} />
      {canEdit && branch && !branch.holidayState && (
        <Hinweiszeile key={"bundesland-" + branch.id} sitzungsSchluessel={"akro.hinweis.bundesland." + branch.id} aktion={<HinweisLink href="/divisions">Bundesland festlegen</HinweisLink>}>
          Kein Bundesland festgelegt: nur bundesweite Feiertage sichtbar.
        </Hinweiszeile>
      )}
      {standort === "ohne" && (
        <Hinweiszeile>Altbestand ohne Standort – nur für die Administration; beim Bearbeiten einen Standort wählen.</Hinweiszeile>
      )}

      {/* Ohne Befund kein Panel - "Keine Konflikte" steht in der Kennwertzeile. */}
      {planner && conflicts.data && <ConflictPanel data={conflicts.data} shifts={shifts} standort={standort} onSprung={springeZuSchicht} />}
      {planner && conflicts.isError && <p className="mb-3 text-[13px] text-muted-foreground">Konfliktprüfung konnte nicht geladen werden.</p>}
      {planner && violations.data && violations.data.count > 0 && <RuleViolationPanel data={violations.data} shifts={shifts} isAdmin={!!member?.access?.isAdmin} onSprung={springeZuSchicht} />}
      {planner && violations.isError && <p className="mb-3 text-[13px] text-muted-foreground">Regelprüfung konnte nicht geladen werden.</p>}

      {/* Eine Wochentafel mit sieben Tagesspalten (je mindestens 136 px); passt ab etwa 970 px
          Inhaltsbreite ohne inneren Scroll, schmalere Tablets scrollen nur innerhalb der Tafel. */}
      <LiveBorder isActive={isLiveActive}>
        <div className="hidden max-w-full overflow-x-auto pb-2 md:block">
          <div className="akro-panel grid min-w-[952px] grid-cols-7 divide-x overflow-hidden">
            {weekDates.map((date, index) => {
              const dayOfWeek = index + 1; // 1=Mo .. 7=So
              const dayShifts = shiftsByDay[dayOfWeek] ?? [];
              const heute = isToday(date);
              const kopfId = "tag-" + dayOfWeek;
              return (
                <section key={dayOfWeek} aria-labelledby={kopfId} className={cn("flex min-h-[16rem] min-w-0 flex-col", heute && "bg-[var(--flaeche-heute)]")}>
                  <TagesKopf id={kopfId} kuerzel={dayNames[index]} datum={formatDateShort(date)} anzahl={dayShifts.length} offen={offenePlätze(dayShifts)} heute={heute} feiertag={branch?.holidays?.find((h) => h.dayOfWeek === dayOfWeek)?.name} />
                  <div className="flex flex-1 flex-col gap-2 p-2">
                    {dayShifts.length === 0 && <p className="flex flex-1 items-center justify-center py-6 text-center text-[13px] text-muted-foreground">Keine Schichten</p>}
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
                        conflicts={conflictsByShift.get(shift.id)}
                        ankerId={"schicht-" + shift.id}
                        hervorheben={sprung?.shiftId === shift.id}
                      />
                    ))}
                    {canAdd && <SchichtHinzufuegen onClick={() => handleAddShift(dayOfWeek)} label="Schicht" tag={dayNames[index] + " " + formatDateShort(date) + "."} />}
                  </div>
                </section>
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
            const kopfId = "tag-mobil-" + dayOfWeek;
            return (
              // scroll-mt: Kopfschiene (75 px) und klebende Zeitraumzeile bleiben darueber.
              <section key={dayOfWeek} id={heute ? "tag-heute-mobil" : undefined} aria-labelledby={kopfId} className="akro-panel scroll-mt-40 overflow-hidden">
                <TagesKopf id={kopfId} kuerzel={dayNames[index]} datum={formatDateShort(date)} anzahl={dayShifts.length} offen={offenePlätze(dayShifts)} heute={heute} feiertag={branch?.holidays?.find((h) => h.dayOfWeek === dayOfWeek)?.name} breit />
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
                      conflicts={conflictsByShift.get(shift.id)}
                      ankerId={"schicht-mobil-" + shift.id}
                      hervorheben={sprung?.shiftId === shift.id}
                    />
                  ))}
                  {canAdd && <SchichtHinzufuegen onClick={() => handleAddShift(dayOfWeek)} label="Schicht hinzufügen" tag={dayNames[index] + " " + formatDateShort(date) + "."} />}
                </div>
              </section>
            );
          })}
        </div>
      </LiveBorder>

      {/* Shift Form Dialog */}
      {scheduleId && canEdit && (
        <ShiftForm open={formOpen} onOpenChange={setFormOpen} scheduleId={scheduleId} branchId={branch?.id ?? null} defaultDayOfWeek={formDay} shift={editingShift} vorlage={vorlage} planStatus={schedule ? planStatus(schedule) : undefined} />
      )}
    </>
  );
}

/** Ein Hinweis in einer Zeile; mit Schluessel pro Sitzung schliessbar (sessionStorage). */
function Hinweiszeile({ children, aktion, sitzungsSchluessel }: { children: ReactNode; aktion?: ReactNode; sitzungsSchluessel?: string }) {
  const [geschlossen, setGeschlossen] = useState(() => {
    if (!sitzungsSchluessel) return false;
    try {
      return sessionStorage.getItem(sitzungsSchluessel) === "1";
    } catch {
      return false;
    }
  });
  if (geschlossen) return null;
  function schliessen() {
    try {
      if (sitzungsSchluessel) sessionStorage.setItem(sitzungsSchluessel, "1");
    } catch {
      // Ohne Speicher gilt das Ausblenden nur bis zum Neuladen.
    }
    setGeschlossen(true);
  }
  return (
    <p className="mb-2 flex min-h-9 items-start gap-2 rounded-[var(--radius)] border border-warn/40 bg-warn/[0.06] py-1 pr-1 pl-3 text-[13px] leading-5 md:items-center">
      <AlertTriangle className="mt-[7px] size-3.5 shrink-0 text-warn md:mt-0" aria-hidden="true" />
      <span className="min-w-0 flex-1 py-1 md:truncate">
        {children}
        {aktion && <> {aktion}</>}
      </span>
      {sitzungsSchluessel && (
        <button
          type="button"
          onClick={schliessen}
          aria-label="Hinweis ausblenden"
          title="Hinweis ausblenden"
          className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-offset-[-3px] max-md:-my-1 max-md:size-11"
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      )}
    </p>
  );
}

/** Aktion im Hinweis: im Satzfluss; auf dem Handy reicht die Tippflaeche per Innenabstand auf 44 px. */
function HinweisLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="ml-1 font-medium whitespace-nowrap text-primary underline-offset-4 hover:underline max-md:py-3">
      {children}
    </Link>
  );
}

/**
 * Tag und Datum als Ueberschrift der Tagesspalte, darunter Anzahl und offene
 * Plaetze; auf dem Handy ("breit") steht alles in einer Zeile.
 */
function TagesKopf({ id, kuerzel, datum, anzahl, offen, heute, feiertag, breit = false }: { id: string; kuerzel: string; datum: string; anzahl: number; offen: number; heute: boolean; feiertag?: string; breit?: boolean }) {
  const zaehler = (
    <p className={cn("flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground", !breit && "mt-0.5 justify-center")}>
      <span>{anzahl} {anzahl === 1 ? "Schicht" : "Schichten"}</span>
      {offen > 0 && <span className="font-medium text-warn">{offen} offen</span>}
    </p>
  );
  return (
    <div className={cn("border-b px-3 py-2", heute ? "bg-[var(--flaeche-heute)] text-primary" : "bg-card", !breit && "text-center")}>
      <div className={cn("flex flex-wrap items-baseline gap-x-2", breit ? "justify-between" : "justify-center")}>
        <h2 id={id} className="text-[14px] leading-5 font-semibold tracking-normal">
          {kuerzel} <span className={cn("tabular text-[12px] font-normal", !heute && "text-muted-foreground")}>{datum}</span>
          {heute && <span className="ml-1.5 text-xs font-medium">heute</span>}
        </h2>
        {breit && zaehler}
      </div>
      {feiertag && <p className="mt-0.5 text-xs font-medium text-warn">Feiertag: {feiertag}</p>}
      {!breit && zaehler}
    </div>
  );
}

/** Hinzufuegen je Tag; der Name nennt den Tag ("Schicht hinzufügen am Mo 26.10."). */
function SchichtHinzufuegen({ onClick, label, tag }: { onClick: () => void; label: string; tag: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={"Schicht hinzufügen am " + tag}
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
      <div className="grid grid-cols-1 gap-3 md:min-w-[952px] md:grid-cols-7 md:gap-2">
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="min-h-[16rem]">
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
