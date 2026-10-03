"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getISOWeek } from "date-fns";
import { ChevronLeft, ChevronRight, Clock3, Download, EyeOff, FileText, MoreHorizontal, Plus, Table2, Users, type LucideIcon } from "lucide-react";
import { ExportModal } from "@/components/reporting/export-modal";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatDateShort, formatKW, getCurrentKW, getWeekDates } from "@/lib/utils/calendar";
import type { ScheduleAccess, ScheduleData, ScheduleResponse } from "@/types/schedule";
import { AISuggestButton } from "./ai-suggest-button";
import { LiveMode } from "./live-mode";
import { PdfExportDialog } from "./pdf-export-dialog";
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
  /** In der Ansicht ausgewaehlte Person - Vorgabe fuer den PDF-Export. */
  selectedEmployeeId?: string | null;
}

/** Letzte ISO-Woche eines Jahres; der 28.12. liegt immer darin. */
function maxISOWeek(year: number): number {
  return getISOWeek(new Date(year, 11, 28));
}

/** Echte Zahlen aus dem geladenen Wochenplan, ohne zusätzliche Abfragen. */
function Kennwert({ zahl, label, icon: Icon, hinweis = false }: { zahl: number; label: string; icon: LucideIcon; hinweis?: boolean }) {
  return (
    <div className="flex min-w-0 items-center gap-3 px-4 py-3 sm:px-5">
      <Icon className={hinweis && zahl > 0 ? "size-5 shrink-0 text-warn" : "size-5 shrink-0 text-primary"} aria-hidden="true" />
      <span className="akro-kennzahl text-[24px] text-foreground">{zahl}</span>
      <span className="text-[12px] leading-4 text-muted-foreground">{label}</span>
    </div>
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
  selectedEmployeeId = null,
}: ScheduleToolbarProps) {
  const router = useRouter();
  const [exportOpen, setExportOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
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
  const fehlendeBestätigungen = shifts.reduce((summe, shift) => summe + shift.bookings.filter((b) => !b.confirmedAt && !b.former).length, 0);
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
    <div className="mb-4 space-y-3">
      <ExportModal open={exportOpen} onOpenChange={setExportOpen} defaultMonth={weekDates[0].getMonth() + 1} defaultYear={weekDates[0].getFullYear()} standort={standort} />
      {/* Zeile 1: Kunde und Standort, rechts die Ansicht */}
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
        <div className="w-full min-w-0 sm:w-auto sm:flex-1">
          <p className="akro-label truncate">{standort === "ohne" ? "Altbestand" : branch?.customer?.name ?? "Ohne Kunde"}</p>
          <p className="truncate text-[21px] leading-tight font-semibold tracking-[-0.02em]">
            {standort === "ohne" ? "Ohne Standort" : branch?.name}
          </p>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          <PdfExportDialog week={{ year, weekNumber }} branch={branch} userId={selectedEmployeeId} />
          <ViewSwitcher kw={formatKW(weekNumber, year)} standort={standort} />
        </div>
      </div>

      <div className={`akro-panel grid grid-cols-1 divide-y sm:divide-x sm:divide-y-0 ${access?.handleRequests ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
        <Kennwert zahl={offenePlätze} label="offene Plätze" icon={Users} />
        {access?.planner ? (
          <Kennwert zahl={fehlendeBestätigungen} label="Bestätigungen offen" icon={Clock3} hinweis />
        ) : (
          <Kennwert zahl={shifts.length} label={shifts.length === 1 ? "Schicht" : "Schichten"} icon={Clock3} />
        )}
        {access?.handleRequests && <Kennwert zahl={openWishCount} label="Anfragen offen" icon={FileText} hinweis />}
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-3">
        <div className="flex min-h-10 max-w-full items-center overflow-hidden rounded-lg border bg-card">
          <button type="button" onClick={zurueck} aria-label="Vorherige Woche" className="flex size-10 shrink-0 items-center justify-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"><ChevronLeft className="size-4" /></button>
          <h1 className="min-w-0 px-1 text-[14px] leading-5 font-semibold tracking-normal sm:px-3">
            <span className="tabular whitespace-nowrap">{formatDateShort(weekDates[0])}.–{formatDateShort(weekDates[6])}.{year}</span>
            <span className="ml-2 text-[11px] font-normal text-muted-foreground">{wochenLabel}</span>
          </h1>
          <button type="button" onClick={vor} aria-label="Nächste Woche" className="flex size-10 shrink-0 items-center justify-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"><ChevronRight className="size-4" /></button>
        </div>
        {!istAktuelleWoche && <Button variant="outline" size="sm" onClick={() => geheZu(current.weekNumber, current.year)}>Diese Woche</Button>}
        <Button variant="outline" size="sm" asChild><Link href="/schedule/month">Standort wechseln</Link></Button>
        {schedule && (schedule.isPublic ? <StatusBadge ton="ok">Veröffentlicht</StatusBadge> : <StatusBadge ton="hinweis" icon={EyeOff}>Entwurf</StatusBadge>)}

        {schedule?.id && (
          <div className="flex w-full flex-wrap items-center gap-2 sm:ml-auto sm:w-auto">
            {/* Filter ab Tablet sichtbar, auf dem Handy im Menue */}
            <div className="hidden items-center gap-2 md:flex">{filter}</div>
            {access?.viewTime && standort !== "ohne" && (
              <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setExportOpen(true)}>
                <Download className="size-3.5" aria-hidden="true" />Stunden als CSV
              </Button>
            )}
            {onAddShift && (
              <Button size="sm" variant={veröffentlichenZuerst ? "outline" : "default"} className="gap-1.5" onClick={onAddShift}>
                <Plus className="size-3.5" />
                Schicht hinzufügen
              </Button>
            )}
            {darfVeröffentlichen && !schedule.isPublic && (
              <VisibilityToggle scheduleId={schedule.id} isPublic={false} wochenLabel={wochenLabel} hauptaktion={veröffentlichenZuerst || !onAddShift} />
            )}

            <Popover open={moreOpen} onOpenChange={setMoreOpen}>
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
