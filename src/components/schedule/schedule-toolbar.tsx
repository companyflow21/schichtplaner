"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { getISOWeek } from "date-fns";
import { ChevronLeft, ChevronRight, Download, EyeOff, MoreHorizontal, Plus, Table2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatDateShort, formatKW, getCurrentKW, getWeekDates } from "@/lib/utils/calendar";
import type { ScheduleAccess, ScheduleData, ScheduleResponse } from "@/types/schedule";
import { AISuggestButton } from "./ai-suggest-button";
import { LiveMode } from "./live-mode";
import { BriefingButton, DivisionFilter, OptionsMenu, VisibilityToggle } from "./schedule-options";
import { ViewSwitcher } from "./view-switcher";
import { WishFilterToggle } from "./wish-plan";

interface ScheduleToolbarProps {
  weekNumber: number;
  year: number;
  standort: string;
  schedule: ScheduleData | null;
  branch: ScheduleResponse["branch"];
  access?: ScheduleAccess;
  isAdmin: boolean;
  divisionFilter: string | null;
  onDivisionFilterChange: (divisionId: string | null) => void;
  wishFilterEnabled: boolean;
  onWishFilterChange: (enabled: boolean) => void;
  openWishCount: number;
  /** Nur gesetzt, wenn neue Schichten an diesem Standort erlaubt sind. */
  onAddShift?: () => void;
}

/** Letzte ISO-Woche eines Jahres; der 28.12. liegt immer darin. */
function maxISOWeek(year: number): number {
  return getISOWeek(new Date(year, 11, 28));
}

/** Eine neutrale Kennzahl der Woche - Zahl und Beschriftung. */
function Kennwert({ zahl, label }: { zahl: number; label: string }) {
  return (
    <span className="flex items-baseline gap-1 text-[13px]">
      <span className="akro-kennzahl text-[15px] text-foreground">{zahl}</span>
      <span className="text-muted-foreground">{label}</span>
    </span>
  );
}

/**
 * Kopf des Wochenplans eines Standorts in drei ruhigen Zeilen:
 * wo (Kunde, Standort), wann (Woche) und wie es steht (Status, Aktionen).
 * Die jeweils wichtigste Aktion ist blau: bei einem Entwurf mit Schichten
 * "Veröffentlichen", sonst "Schicht hinzufügen". Werkzeuge erscheinen nur
 * mit dem passenden Recht - geprueft wird trotzdem auf dem Server.
 */
export function ScheduleToolbar({
  weekNumber,
  year,
  standort,
  schedule,
  branch,
  access,
  isAdmin,
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
  const istAktuelleWoche = weekNumber === current.weekNumber && year === current.year;
  const suffix = "?standort=" + encodeURIComponent(standort);
  const wochenLabel = "KW " + String(weekNumber).padStart(2, "0");

  function geheZu(kw: number, kwYear: number) {
    router.push(`/schedule/flexible/${formatKW(kw, kwYear)}${suffix}`);
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
  const offenePlätze = shifts.reduce((summe, shift) => summe + (shift.missing ?? Math.max(0, shift.maxEmployees - (shift.occupiedCount ?? shift.bookings.length))), 0);
  const fehlendeBestätigungen = shifts.reduce((summe, shift) => summe + shift.bookings.filter((b) => !b.confirmedAt).length, 0);
  const darfVeröffentlichen = !!access?.publish && !!schedule?.id;
  // Ein Entwurf mit Schichten wartet aufs Veroeffentlichen - das ist dann die Hauptaktion.
  const veröffentlichenZuerst = darfVeröffentlichen && !schedule?.isPublic && shifts.length > 0;

  const filter = schedule?.id ? (
    <>
      <DivisionFilter scheduleId={schedule.id} divisionFilter={divisionFilter} onDivisionFilterChange={onDivisionFilterChange} />
      {access?.handleRequests && <WishFilterToggle enabled={wishFilterEnabled} onToggle={onWishFilterChange} wishCount={openWishCount} />}
    </>
  ) : null;

  return (
    <div className="-mx-4 mb-4 border-b bg-background px-4 md:sticky md:top-[var(--kopf-hoehe)] md:z-20 md:-mx-6 md:px-6 lg:-mx-8 lg:px-8">
      {/* Zeile 1: Kunde und Standort, rechts die Ansicht */}
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3 pt-3">
        <div className="w-full min-w-0 sm:w-auto sm:flex-1">
          <p className="akro-label truncate">{standort === "ohne" ? "Altbestand" : branch?.customer?.name ?? "Ohne Kunde"}</p>
          <p className="truncate text-[17px] leading-tight font-semibold tracking-[-0.02em]">
            {standort === "ohne" ? "Ohne Standort" : branch?.name}
          </p>
        </div>
        <ViewSwitcher kw={formatKW(weekNumber, year)} standort={standort} />
      </div>

      {/* Zeile 2: die Woche */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 pt-3">
        <div className="flex items-center overflow-hidden rounded-[var(--radius)] border bg-card">
          <button type="button" onClick={zurueck} aria-label="Vorherige Woche" className="flex size-9 items-center justify-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
            <ChevronLeft className="size-4" />
          </button>
          <span className="h-9 w-px bg-border" aria-hidden="true" />
          <button type="button" onClick={vor} aria-label="Nächste Woche" className="flex size-9 items-center justify-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
            <ChevronRight className="size-4" />
          </button>
        </div>
        <h1 className="flex flex-wrap items-baseline gap-x-2">
          <span className="akro-kennzahl text-[22px]">{wochenLabel}</span>
          <span className="tabular text-[13px] font-normal tracking-normal text-muted-foreground">
            {formatDateShort(weekDates[0])}.–{formatDateShort(weekDates[6])}.{year}
          </span>
        </h1>
        {istAktuelleWoche ? (
          <span className="text-[12px] font-medium text-primary">diese Woche</span>
        ) : (
          <Button variant="outline" size="sm" onClick={() => geheZu(current.weekNumber, current.year)}>Diese Woche</Button>
        )}
      </div>

      {/* Zeile 3: Stand der Woche links, Aktionen rechts */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3 py-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          {schedule &&
            (schedule.isPublic ? (
              <StatusBadge ton="ok">Veröffentlicht</StatusBadge>
            ) : (
              <StatusBadge ton="hinweis" icon={EyeOff}>Entwurf</StatusBadge>
            ))}
          <Kennwert zahl={shifts.length} label={shifts.length === 1 ? "Schicht" : "Schichten"} />
          {offenePlätze > 0 ? (
            <StatusBadge ton="hinweis">{offenePlätze} offen</StatusBadge>
          ) : shifts.length > 0 ? (
            <StatusBadge ton="ok">voll besetzt</StatusBadge>
          ) : null}
          {access?.planner && fehlendeBestätigungen > 0 && <Kennwert zahl={fehlendeBestätigungen} label="unbestätigt" />}
          {openWishCount > 0 && <Kennwert zahl={openWishCount} label={openWishCount === 1 ? "Anfrage" : "Anfragen"} />}
        </div>

        {schedule?.id && (
          <div className="flex w-full flex-wrap items-center gap-2 sm:ml-auto sm:w-auto">
            {/* Filter ab Tablet sichtbar, auf dem Handy im Menue */}
            <div className="hidden items-center gap-2 md:flex">{filter}</div>
            {onAddShift && (
              <Button size="sm" variant={veröffentlichenZuerst ? "outline" : "default"} className="gap-1.5" onClick={onAddShift}>
                <Plus className="size-3.5" />
                Schicht hinzufügen
              </Button>
            )}
            {darfVeröffentlichen && !schedule.isPublic && (
              <VisibilityToggle scheduleId={schedule.id} isPublic={false} wochenLabel={wochenLabel} hauptaktion={veröffentlichenZuerst || !onAddShift} />
            )}

            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="icon-sm" aria-label="Weitere Aktionen" title="Weitere Aktionen">
                  <MoreHorizontal className="size-4" />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-64 space-y-2 p-3 [&_button]:w-full [&_button]:justify-start">
                {/* Einheitliche Liste: alle Werkzeuge volle Breite, linksbuendig. */}
                <div className="space-y-2 md:hidden">
                  <p className="akro-label">Filter</p>
                  <div className="flex flex-wrap gap-2">{filter}</div>
                </div>
                {access?.edit && (
                  <>
                    <p className="akro-label">Darstellung</p>
                    <OptionsMenu scheduleId={schedule.id} settingsLayout={schedule.settingsLayout} showTitle={schedule.showTitle} showPauses={schedule.showPauses} />
                  </>
                )}
                {/* Die klassische Tabelle ist eine Darstellungsvariante der Planung. */}
                <Button variant="outline" size="sm" className="w-full justify-start gap-1.5" asChild>
                  <Link href={`/schedule/classic/${formatKW(weekNumber, year)}${suffix}`}>
                    <Table2 className="size-3.5" />
                    Klassische Tabelle
                  </Link>
                </Button>
                <p className="akro-label pt-1">Weitere Werkzeuge</p>
                <BriefingButton scheduleId={schedule.id} isManager={!!access?.edit} />
                {access?.edit && <LiveMode scheduleId={schedule.id} isManager />}
                {isAdmin && <AISuggestButton scheduleId={schedule.id} />}
                {access?.viewTime && standort !== "ohne" && (
                  <Button variant="outline" size="sm" className="w-full justify-start gap-1.5" asChild>
                    <Link href={`/api/reporting/export?standort=${encodeURIComponent(standort)}`}>
                      <Download className="size-3.5" />
                      Stunden als CSV
                    </Link>
                  </Button>
                )}
                {darfVeröffentlichen && schedule.isPublic && (
                  <VisibilityToggle scheduleId={schedule.id} isPublic wochenLabel={wochenLabel} className="w-full justify-start" />
                )}
              </PopoverContent>
            </Popover>
          </div>
        )}
      </div>
    </div>
  );
}
