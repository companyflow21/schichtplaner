"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { isToday } from "date-fns";
import { AlertTriangle, Lock } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { StatusBadge } from "@/components/ui/status-badge";
import { dayNames, formatDateShort } from "@/lib/utils/calendar";
import { cn } from "@/lib/utils";
import type { ScheduleResponse, ShiftData, ShiftBooking, BookingUser } from "@/types/schedule";
import { formatName } from "@/lib/names";
import { useNameFormat } from "@/lib/hooks/use-current-member";
import { useWorkTimeHints, WorkTimeHints } from "./worktime-hints";
import { PlanStatusBanner } from "./plan-status-banner";

interface EmployeeGridProps {
  weekNumber: number;
  year: number;
  weekDates: Date[];
  /** Standort des Plans; ohne Angabe die zusammengefuehrte Sicht. */
  standort?: string | null;
}

/** Eine Schicht mit der Zuweisung der Person dieser Zeile. */
type Einsatz = { shift: ShiftData; booking: ShiftBooking };

type EmployeeRow = {
  key: string;
  user: BookingUser;
  dayShifts: Record<number, Einsatz[]>;
  totalHours: number;
};

/** Hinweis fuer Mitarbeitende, solange ein Plan der Woche in Bearbeitung ist (auch auf der Startseite). */
export const BEARBEITUNG_HINWEIS = "Diese Woche wird gerade überarbeitet: Du siehst den zuletzt veröffentlichten Stand; Anträge, Tausch und Bestätigen sind bis zur Veröffentlichung gesperrt.";

function getInitials(firstName: string, lastName: string): string {
  return `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase();
}

/** Geplante Nettostunden (nach Pause, Zeitumstellung beachtet) - berechnet der Server. */
function shiftDurationHours(shift: ShiftData): number {
  return (shift.plannedMinutes ?? 0) / 60;
}

/** Stunden in deutscher Schreibweise: "7,5 h". */
function stunden(hours: number): string {
  return hours.toLocaleString("de-DE", { maximumFractionDigits: 2 }) + " h";
}

/** Beendet: das echte Schichtende (Server, Berlin-Regel) liegt zurueck - wie bei der Schichtkarte. */
function beendet(shift: ShiftData, now: number): boolean {
  return Date.parse(shift.endsAt ?? "") <= now;
}

/** Zuweisung noch nicht bestaetigt (Altbestand); Planungseinteilungen gelten sofort als fest. */
function bestaetigungOffen(booking: ShiftBooking): boolean {
  return !booking.confirmedAt && !booking.former && !booking.contractorWorkerId;
}

/** Aktuelle Zeit, jede Minute neu - damit Schichten ohne Neuladen als beendet erscheinen. */
function useJetzt(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

/** Nachtschicht: "+1" wie im Monatsplan, ausgeschrieben fuer Screenreader. */
function Folgetag() {
  return (
    <span className="ml-1 font-normal text-muted-foreground" title="endet am Folgetag">
      <span aria-hidden="true">+1</span>
      <span className="sr-only">(endet am Folgetag)</span>
    </span>
  );
}

/**
 * Employee-centric schedule view.
 * Rows = employees, Columns = Mo-So.
 * Each cell shows the employee's shift(s) for that day.
 */
export function EmployeeGrid({ weekNumber, year, weekDates, standort }: EmployeeGridProps) {
  const nameFormat = useNameFormat();
  const now = useJetzt();
  const worktime = useWorkTimeHints(weekNumber, year, standort);
  const hintCount = (key: string) => worktime.data?.hints.filter((h) => h.userId === key).length ?? 0;
  const { data, isLoading } = useQuery<ScheduleResponse>({
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
        // Geloeschte Personen behalten ihre Zeile (Historie), Schluessel aus der Momentaufnahme.
        const key = booking.personKey ?? booking.userId ?? "former:" + booking.id;
        if (!userMap.has(key)) {
          userMap.set(key, {
            key,
            user: booking.user,
            dayShifts: { 1: [], 2: [], 3: [], 4: [], 5: [], 6: [], 7: [] },
            totalHours: 0,
          });
        }
        const row = userMap.get(key)!;
        row.dayShifts[shift.dayOfWeek].push({ shift, booking });
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

  // Statusbalken (Entwurf, in Bearbeitung) nur im Plan eines Standorts.
  const balken = standort ? <PlanStatusBanner schedule={data?.schedule ?? null} access={data?.access} standort={standort} /> : null;
  // Mitarbeitende: eine Schicht der Woche liegt in einem Plan in Bearbeitung - die Planung hat den Statusbalken.
  const pausiert = !data?.access?.planner && shifts.some((s) => s.requestsPaused && !s.can?.edit);
  const hinweis = pausiert ? (
    <p role="status" className="flex items-start gap-1.5 text-[13px] leading-5 text-muted-foreground">
      <Lock className="mt-1 size-3.5 shrink-0" aria-hidden="true" />
      <span>{BEARBEITUNG_HINWEIS}</span>
    </p>
  ) : null;

  if (employees.length === 0) {
    return (
      <>
        {balken}
        {hinweis}
        <div className="akro-panel p-6 text-[14px] text-muted-foreground">
          Keine eingeplanten Mitarbeitenden in dieser Woche.
        </div>
      </>
    );
  }

  const nameOf = (emp: EmployeeRow) => formatName(emp.user, nameFormat, { contractor: emp.key.startsWith("contractor:") });

  return (
    <>
      {balken}
      {hinweis}
      {/* Ab Tablet: Tabelle, Zeilen = Personen, Spalten = Mo-So. relative haelt sr-only-Texte im Rollbereich. */}
      <div className="akro-panel relative hidden overflow-x-auto md:block">
        <table className="w-full border-collapse">
          <thead>
            <tr className="akro-panel-kopf">
              <th className="w-52 border-r px-3 py-2 text-left text-xs font-semibold text-muted-foreground">
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
                    <div className={cn("text-xs font-normal", today ? "text-primary" : "text-muted-foreground")}>
                      {formatDateShort(date)}.
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
            {employees.map((emp) => {
              const name = nameOf(emp);
              const hints = hintCount(emp.key);
              return (
                <tr key={emp.key} className="border-t hover:bg-muted/10 transition-colors">
                  {/* Employee name */}
                  <td className="border-r px-3 py-2 align-middle">
                    <div className="flex items-center gap-2">
                      <Avatar size="sm" className="data-[size=sm]:size-7">
                        <AvatarFallback className="text-xs">
                          {getInitials(emp.user.firstName, emp.user.lastName)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0">
                        <div className="max-w-40 truncate text-[13px] font-medium" title={name}>
                          {name}
                        </div>
                        {hints > 0 && (
                          <a href="#arbeitszeithinweise" className="inline-flex min-h-6 items-center gap-1 text-xs font-medium text-warn underline-offset-4 hover:underline">
                            <AlertTriangle className="size-3 shrink-0" aria-hidden="true" />
                            {hints} {hints === 1 ? "Hinweis" : "Hinweise"}
                          </a>
                        )}
                      </div>
                    </div>
                  </td>

                  {/* Day cells */}
                  {Array.from({ length: 7 }, (_, dayIdx) => {
                    const day = dayIdx + 1;
                    const einsaetze = emp.dayShifts[day] ?? [];
                    const today = isToday(weekDates[dayIdx]);

                    return (
                      <td
                        key={day}
                        className={cn(
                          "border-r px-2 py-1.5 align-middle text-center min-w-[100px]",
                          today && "bg-[var(--flaeche-heute)]"
                        )}
                      >
                        {einsaetze.length === 0 ? (
                          <span className="text-xs text-muted-foreground">
                            <span aria-hidden="true">–</span>
                            <span className="sr-only">frei</span>
                          </span>
                        ) : (
                          <div className="space-y-0.5">
                            {einsaetze.map(({ shift, booking }) => (
                              <SchichtMarke key={shift.id} shift={shift} booking={booking} vorbei={beendet(shift, now)} zeigeStandort={!standort} />
                            ))}
                          </div>
                        )}
                      </td>
                    );
                  })}

                  {/* Total hours */}
                  <td className="px-3 py-2 align-middle text-center">
                    <span className="tabular text-xs font-semibold">{stunden(emp.totalHours)}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Handy: je Person ihre Schichten der Woche - Tag, Zeit, Einsatzort, Status */}
      <div className="space-y-3 md:hidden">
        {employees.map((emp) => {
          const name = nameOf(emp);
          const hints = hintCount(emp.key);
          return (
            <section key={emp.key} className="akro-panel overflow-hidden" aria-label={name}>
              <div className="akro-panel-kopf flex min-h-12 items-center gap-2 border-b px-4 py-2.5">
                <Avatar size="sm" className="data-[size=sm]:size-7">
                  <AvatarFallback className="text-xs">
                    {getInitials(emp.user.firstName, emp.user.lastName)}
                  </AvatarFallback>
                </Avatar>
                <span className="min-w-0 flex-1 truncate text-[14px] font-semibold" title={name}>
                  {name}
                </span>
                {hints > 0 && (
                  // 44 px Tippflaeche, die in den Rand der Kopfzeile ragt.
                  <a href="#arbeitszeithinweise" className="-my-2.5 inline-flex min-h-11 min-w-11 items-center justify-center gap-1 text-[12px] font-medium text-warn">
                    <AlertTriangle className="size-3.5 shrink-0" aria-hidden="true" />
                    {hints}
                    <span className="sr-only">{hints === 1 ? "Arbeitszeithinweis" : "Arbeitszeithinweise"}</span>
                  </a>
                )}
                <span className="tabular text-[13px] text-muted-foreground">{stunden(emp.totalHours)}</span>
              </div>
              <ul className="divide-y divide-[var(--linie-fein)]">
                {weekDates.flatMap((date, dayIdx) =>
                  (emp.dayShifts[dayIdx + 1] ?? []).map(({ shift, booking }) => (
                    <SchichtZeile
                      key={shift.id}
                      date={date}
                      dayIdx={dayIdx}
                      shift={shift}
                      vorbei={beendet(shift, now)}
                      offen={bestaetigungOffen(booking)}
                      ort={[standort ? null : shift.branch?.name, shift.title].filter(Boolean).join(" · ") || "Schicht"}
                    />
                  ))
                )}
              </ul>
            </section>
          );
        })}
      </div>
      {worktime.data && <WorkTimeHints data={worktime.data} people={employees.map((e) => ({ userId: e.key.includes(":") ? null : e.key, firstName: e.user.firstName, lastName: e.user.lastName }))} />}
    </>
  );
}

/** Eine Zeile auf dem Handy: Tag · Zeit · Einsatzort · Status. Beendete Schichten treten zurueck. */
function SchichtZeile({ date, dayIdx, shift, vorbei, offen, ort }: { date: Date; dayIdx: number; shift: ShiftData; vorbei: boolean; offen: boolean; ort: string }) {
  const heute = isToday(date);
  return (
    <li className={cn("flex items-center gap-3 px-4 py-2.5", heute && "bg-[var(--flaeche-heute)]")}>
      <span className={cn("w-14 shrink-0 text-[13px] leading-tight font-medium", vorbei && "text-muted-foreground")}>
        {dayNames[dayIdx]} {formatDateShort(date)}.
        {heute && <span className="block text-xs font-semibold text-primary">heute</span>}
      </span>
      <span className="min-w-0 flex-1">
        <span className={cn("tabular block text-[14px]", vorbei ? "font-medium text-muted-foreground" : "font-semibold")}>
          <span className="whitespace-nowrap">{shift.shiftFrom}–{shift.shiftTo}</span>
          {shift.endsNextDay && <Folgetag />}
        </span>
        <span className="block truncate text-[13px] text-muted-foreground" title={ort}>{ort}</span>
      </span>
      {vorbei ? (
        <StatusBadge ton="neutral" klein>beendet</StatusBadge>
      ) : offen ? (
        <StatusBadge ton="hinweis" klein>Bestätigung offen</StatusBadge>
      ) : null}
    </li>
  );
}

/** Eine Schicht in der Tabelle: lesbare Zeit, Bereichsfarbe als Punkt, Zustand als Text. */
function SchichtMarke({ shift, booking, vorbei, zeigeStandort }: { shift: ShiftData; booking: ShiftBooking; vorbei: boolean; zeigeStandort: boolean }) {
  return (
    <div
      title={[shift.branch?.name, shift.division?.title, shift.title].filter(Boolean).join(" · ") || undefined}
      className={cn(
        "inline-flex max-w-full flex-col items-start rounded-[6px] border px-1.5 py-0.5 text-left text-xs leading-snug",
        vorbei ? "border-dashed bg-transparent" : "bg-card"
      )}
    >
      <span className="flex items-center gap-1.5 whitespace-nowrap">
        {shift.division && (
          <span aria-hidden="true" className="size-2 shrink-0 rounded-full" style={{ backgroundColor: shift.division.color }} />
        )}
        <span className={cn("tabular font-medium", vorbei ? "text-muted-foreground" : "text-foreground")}>
          {shift.shiftFrom}–{shift.shiftTo}
        </span>
        {shift.endsNextDay && <Folgetag />}
      </span>
      {/* In der zusammengefuehrten Sicht steht der Standort dabei. */}
      {zeigeStandort && shift.branch && (
        <span className="block max-w-[110px] truncate text-muted-foreground">{shift.branch.name}</span>
      )}
      {vorbei ? (
        <span className="text-muted-foreground">beendet</span>
      ) : bestaetigungOffen(booking) ? (
        <span className="font-medium text-warn">Bestätigung offen</span>
      ) : null}
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
