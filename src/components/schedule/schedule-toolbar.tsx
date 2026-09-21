"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { getISOWeek } from "date-fns";
import {
  CalendarRange,
  ChevronLeft,
  ChevronRight,
  Download,
  MoreHorizontal,
  Plus,
  Table2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { formatDateShort, formatKW, getCurrentKW, getWeekDates } from "@/lib/utils/calendar";
import type { ScheduleData } from "@/types/schedule";
import { AISuggestButton } from "./ai-suggest-button";
import { LiveMode } from "./live-mode";
import {
  BriefingButton,
  DivisionFilter,
  OptionsMenu,
  VisibilityToggle,
} from "./schedule-options";
import { ViewSwitcher } from "./view-switcher";
import { WishFilterToggle } from "./wish-plan";

interface ScheduleToolbarProps {
  weekNumber: number;
  year: number;
  schedule: ScheduleData | null;
  isManager: boolean;
  divisionFilter: string | null;
  onDivisionFilterChange: (divisionId: string | null) => void;
  wishFilterEnabled: boolean;
  onWishFilterChange: (enabled: boolean) => void;
  openWishCount: number;
  onAddShift: () => void;
}

/** Letzte ISO-Woche eines Jahres; der 28.12. liegt immer darin. */
function maxISOWeek(year: number): number {
  return getISOWeek(new Date(year, 11, 28));
}

/**
 * Kopf der Planungsseite: Woche, Status und Werkzeuge in drei schmalen
 * Zeilen. Bleibt beim Scrollen stehen, damit Wochenwechsel und die
 * wichtigsten Aktionen immer erreichbar sind.
 */
export function ScheduleToolbar({
  weekNumber,
  year,
  schedule,
  isManager,
  divisionFilter,
  onDivisionFilterChange,
  wishFilterEnabled,
  onWishFilterChange,
  openWishCount,
  onAddShift,
}: ScheduleToolbarProps) {
  const router = useRouter();
  const current = getCurrentKW();
  const weekDates = getWeekDates(weekNumber, year);
  const istAktuelleWoche =
    weekNumber === current.weekNumber && year === current.year;

  function geheZu(kw: number, kwYear: number) {
    router.push(`/schedule/flexible/${formatKW(kw, kwYear)}`);
  }

  function zurueck() {
    if (weekNumber - 1 < 1) geheZu(maxISOWeek(year - 1), year - 1);
    else geheZu(weekNumber - 1, year);
  }

  function vor() {
    if (weekNumber + 1 > maxISOWeek(year)) geheZu(1, year + 1);
    else geheZu(weekNumber + 1, year);
  }

  const shifts = schedule?.shifts ?? [];
  const offenePlätze = shifts.reduce(
    (summe, shift) =>
      summe + Math.max(0, shift.maxEmployees - (shift.occupiedCount ?? shift.bookings.length)),
    0
  );
  const fehlendeBestätigungen = shifts.reduce(
    (summe, shift) => summe + shift.bookings.filter((b) => !b.confirmedAt).length,
    0
  );

  return (
    <div className="sticky top-0 z-20 -mx-4 mb-4 border-b bg-background px-4 pt-1 pb-2 md:-mx-6 md:px-6 lg:-mx-8 lg:px-8">
      {/* Zeile 1: Woche und Ansicht */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 py-1.5">
        <h1 className="text-[24px] leading-none font-semibold tracking-[-0.02em]">
          Dienstplan
        </h1>

        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon-sm" onClick={zurueck} aria-label="Vorherige Woche">
            <ChevronLeft className="size-4" />
          </Button>
          <span className="tabular min-w-[9.5rem] text-center text-[14px] font-medium">
            KW {String(weekNumber).padStart(2, "0")} ·{" "}
            <span className="text-muted-foreground">
              {formatDateShort(weekDates[0])}–{formatDateShort(weekDates[6])}
            </span>
          </span>
          <Button variant="outline" size="icon-sm" onClick={vor} aria-label="Nächste Woche">
            <ChevronRight className="size-4" />
          </Button>
          <Button
            variant={istAktuelleWoche ? "secondary" : "ghost"}
            size="sm"
            onClick={() => geheZu(current.weekNumber, current.year)}
            className="gap-1.5"
          >
            <CalendarRange className="size-3.5" />
            Heute
          </Button>
        </div>

        <div className="ml-auto">
          <ViewSwitcher kw={formatKW(weekNumber, year)} />
        </div>
      </div>

      {/* Zeile 2: Status der Woche - Farbe nie allein, immer mit Text */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pb-1.5 text-[13px]">
        <span className="flex items-center gap-1.5 font-medium">
          <span
            aria-hidden="true"
            className={cn(
              "size-2 rounded-full",
              schedule?.isPublic ? "bg-[var(--service)]" : "bg-muted-foreground"
            )}
          />
          {schedule?.isPublic ? "Veröffentlicht" : "Entwurf"}
        </span>
        <span className={cn("tabular", offenePlätze > 0 && "font-medium text-destructive")}>
          {offenePlätze} unbesetzte Plätze
        </span>
        {isManager && (
          <span className={cn("tabular", fehlendeBestätigungen > 0 && "text-muted-foreground")}>
            {fehlendeBestätigungen} Bestätigungen offen
          </span>
        )}
        {openWishCount > 0 && (
          <span className="tabular text-muted-foreground">
            {openWishCount} offene Anfragen
          </span>
        )}
        <span className="tabular text-muted-foreground">
          {shifts.length} Schichten
        </span>
      </div>

      {/* Zeile 3: eine Werkzeugleiste */}
      {schedule && (
        <div className="flex flex-wrap items-center gap-2 pb-1.5">
          <DivisionFilter
            scheduleId={schedule.id}
            divisionFilter={divisionFilter}
            onDivisionFilterChange={onDivisionFilterChange}
          />
          {isManager && (
            <WishFilterToggle
              enabled={wishFilterEnabled}
              onToggle={onWishFilterChange}
              wishCount={openWishCount}
            />
          )}

          <div className="ml-auto flex flex-wrap items-center gap-2">
            {isManager && (
              <>
                <Button size="sm" className="gap-1.5" onClick={onAddShift}>
                  <Plus className="size-3.5" />
                  Schicht hinzufügen
                </Button>
                <VisibilityToggle scheduleId={schedule.id} isPublic={schedule.isPublic} />
              </>
            )}

            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="gap-1.5">
                  <MoreHorizontal className="size-3.5" />
                  Weitere Aktionen
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-64 space-y-2 p-3">
                <p className="text-[11px] font-semibold tracking-wide text-muted-foreground">
                  Darstellung
                </p>
                <OptionsMenu
                  scheduleId={schedule.id}
                  settingsLayout={schedule.settingsLayout}
                  showTitle={schedule.showTitle}
                  showPauses={schedule.showPauses}
                />
                {/* Die klassische Tabelle ist eine Darstellungsvariante
                    der Planung, kein eigener Hauptmodus mehr. */}
                <Button variant="outline" size="sm" className="w-full justify-start gap-1.5" asChild>
                  <Link href={`/schedule/classic/${formatKW(weekNumber, year)}`}>
                    <Table2 className="size-3.5" />
                    Klassische Tabelle
                  </Link>
                </Button>
                <p className="pt-1 text-[11px] font-semibold tracking-wide text-muted-foreground">
                  Weitere Werkzeuge
                </p>
                <BriefingButton scheduleId={schedule.id} isManager={isManager} />
                {isManager && (
                  <>
                    <LiveMode scheduleId={schedule.id} isManager={isManager} />
                    <AISuggestButton scheduleId={schedule.id} />
                  </>
                )}
                <Button variant="outline" size="sm" className="w-full justify-start gap-1.5" asChild>
                  <Link href="/api/reporting/export">
                    <Download className="size-3.5" />
                    Stunden als CSV
                  </Link>
                </Button>
              </PopoverContent>
            </Popover>
          </div>
        </div>
      )}
    </div>
  );
}
