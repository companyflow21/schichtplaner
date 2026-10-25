"use client";

import { useState, useSyncExternalStore, type ReactNode, type Ref } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getISOWeek } from "date-fns";
import { ArrowLeftRight, Check, Clock3, Download, FileText, MoreHorizontal, Plus, Table2, Users, type LucideIcon } from "lucide-react";
import { ExportModal } from "@/components/reporting/export-modal";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { formatDateShort, formatKW, getCurrentKW, getWeekDates } from "@/lib/utils/calendar";
import type { ScheduleAccess, ScheduleData, ScheduleResponse, ShiftData } from "@/types/schedule";
import { AISuggestButton } from "./ai-suggest-button";
import { LiveMode } from "./live-mode";
import { PdfExportDialog } from "./pdf-export-dialog";
import { BearbeitungStarten, PlanStatusBadge, planStatus } from "./plan-status-banner";
import { BriefingButton, DivisionFilter, OptionsMenu, VisibilityToggle } from "./schedule-options";
import { ViewSwitcher } from "./view-switcher";
import { WeekSwitcher } from "./week-switcher";
import { WishFilterToggle } from "./wish-plan";

/** Nach dem Blaettern setzt der Wochenplan den Fokus auf den Zeitraum (siehe schedule-grid.tsx). */
export const FOKUS_NACH_BLAETTERN = "akro.plan.fokus";

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
  /** Konfliktpruefung geladen und ohne Befund: "Keine Konflikte" in der Kennwertzeile. */
  konflikteFrei?: boolean;
  /** Personenfilter des Plans; ab Tablet in der Filtergruppe, auf dem Handy im Menue. */
  mitarbeiterFilter?: ReactNode;
  /** Ziel des Fokus nach dem Blaettern. */
  zeitraumRef?: Ref<HTMLElement>;
}

/** Handybreite wie Tailwinds max-md - dort steht "Weitere Aktionen" neben dem Objektnamen. */
const HANDY = "(max-width: 767px)";
function abonniereHandy(melden: () => void) {
  const abfrage = window.matchMedia(HANDY);
  abfrage.addEventListener("change", melden);
  return () => abfrage.removeEventListener("change", melden);
}

/** Letzte ISO-Woche eines Jahres; der 28.12. liegt immer darin. */
function maxISOWeek(year: number): number {
  return getISOWeek(new Date(year, 11, 28));
}

/**
 * "Bestätigungen offen" - dieselbe Regel wie auf der Startseite: Zuweisungen
 * mit Benutzerkonto, die noch nicht bestätigt sind, ohne historische
 * Zuweisungen geloeschter Personen, ohne feste Einteilungen der Planung
 * (confirmation PLANNER) und nur an Schichten, die noch nicht beendet sind.
 * "Beendet" ist endsAt aus der API - dieselbe Berlin-Regel wie shiftEnded()
 * in lib/planning.ts.
 */
export function offeneBestätigungen(shifts: ShiftData[], jetzt: number): number {
  return shifts.reduce((summe, shift) => {
    if (shift.endsAt && Date.parse(shift.endsAt) <= jetzt) return summe;
    return summe + shift.bookings.filter((b) => b.userId && !b.confirmedAt && !b.former && b.confirmation !== "PLANNER").length;
  }, 0);
}

/** Wie viele Plaetze offen sind (wirksame Zuweisungen; fuer die Planung zaehlen unwirksame als offen). */
export function offenePlätze(shifts: ShiftData[]): number {
  return shifts.reduce((summe, shift) => summe + (shift.missing ?? Math.max(0, shift.maxEmployees - (shift.occupiedCount ?? shift.bookings.length))), 0);
}

/** Ein Kennwert als Text mit kleinem Symbol; Werte ueber 0 im Hinweiston, wenn sie Handlungsbedarf bedeuten. */
function Kennwert({ icon: Icon, zahl, text, hinweis = false }: { icon: LucideIcon; zahl: number; text: string; hinweis?: boolean }) {
  return (
    <li className={cn("inline-flex items-center gap-1 whitespace-nowrap", hinweis && zahl > 0 ? "text-warn" : zahl > 0 ? "text-foreground" : "text-muted-foreground")}>
      <Icon className="size-3.5 shrink-0" aria-hidden="true" />
      <span className="tabular">{text}</span>
    </li>
  );
}

/**
 * Kopf des Wochenplans eines Standorts in zwei ruhigen Zeilen: wo (Kunde,
 * Objekt, Ansicht) und wann/wie (Zeitraum, Status, Kennwerte, Aktionen).
 * Die Hauptaktion folgt dem Lebenszyklus: leerer Entwurf "Schicht
 * hinzufuegen"; Entwurf mit Schichten oder in Bearbeitung das
 * Veroeffentlichen im Statusbalken; veroeffentlicht "Bearbeitung starten".
 * Seltenes steht im Menue "Weitere Aktionen". Werkzeuge erscheinen nur mit
 * dem passenden Recht - geprueft wird trotzdem auf dem Server.
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
  konflikteFrei = false,
  mitarbeiterFilter,
  zeitraumRef,
}: ScheduleToolbarProps) {
  const router = useRouter();
  const [exportOpen, setExportOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  // Zeitpunkt des Ladens - fuer "Schicht beendet" in der Zaehlregel.
  const [geladenUm] = useState(() => Date.now());
  const handy = useSyncExternalStore(abonniereHandy, () => window.matchMedia(HANDY).matches, () => false);
  const current = getCurrentKW();
  const weekDates = getWeekDates(weekNumber, year);
  const istAktuelleWoche = weekNumber === current.weekNumber && year === current.year;
  const suffix = "?standort=" + encodeURIComponent(standort);
  const wochenLabel = "KW " + String(weekNumber).padStart(2, "0");

  function geheZu(kw: number, kwYear: number) {
    try {
      sessionStorage.setItem(FOKUS_NACH_BLAETTERN, "1");
    } catch {
      // Ohne Speicher bleibt der Fokus beim Browser.
    }
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
  const offen = offenePlätze(shifts);
  const bestätigungen = offeneBestätigungen(shifts, geladenUm);
  const darfVeröffentlichen = !!access?.publish && !!schedule?.id;
  const status = schedule ? planStatus(schedule) : null;
  // Ein Entwurf mit Schichten oder eine Bearbeitung wartet aufs Veroeffentlichen (Statusbalken).
  const veröffentlichenZuerst = darfVeröffentlichen && ((status === "DRAFT" && shifts.length > 0) || status === "EDITING");
  // Veroeffentlicht: Einstieg in die Bearbeitung ist die Hauptaktion; direkte Aenderungen bleiben erlaubt.
  const bearbeitungStarten = !!access?.edit && status === "PUBLISHED" && !!schedule?.id;
  const schichtAlsHauptaktion = !veröffentlichenZuerst && !bearbeitungStarten;
  const csv = !!access?.viewTime && standort !== "ohne";

  const filter = schedule?.id ? (
    <>
      <DivisionFilter scheduleId={schedule.id} divisionFilter={divisionFilter} onDivisionFilterChange={onDivisionFilterChange} />
      {access?.handleRequests && <WishFilterToggle enabled={wishFilterEnabled} onToggle={onWishFilterChange} wishCount={openWishCount} />}
      {mitarbeiterFilter}
    </>
  ) : null;

  const csvKnopf = (className?: string) => (
    <Button variant="outline" size="sm" className={cn("gap-1.5", className)} onClick={() => setExportOpen(true)}>
      <Download className="size-3.5" aria-hidden="true" />Stunden als CSV
    </Button>
  );

  // Seltenes und Werkzeuge; am Desktop am Ende der Aktionen, auf dem Handy neben dem Objektnamen.
  const menü = (
    <Popover open={moreOpen} onOpenChange={setMoreOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="icon-sm" aria-label="Weitere Aktionen" title="Weitere Aktionen" className="shrink-0 max-md:size-11">
          <MoreHorizontal className="size-4" aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="max-h-[var(--radix-popover-content-available-height)] w-64 space-y-3 overflow-y-auto p-3 max-md:[&_a]:h-11 max-md:[&_button]:h-11">
        {filter && (
          <div className="space-y-2 md:hidden">
            <p className="akro-label">Filter</p>
            <div className="flex flex-wrap gap-2">{filter}</div>
          </div>
        )}
        {/* Einheitliche Liste: alle Werkzeuge volle Breite, linksbuendig. */}
        <div className="space-y-2 [&_button]:w-full [&_button]:justify-start">
          <p className="akro-label">Export und Ansicht</p>
          <PdfExportDialog week={{ year, weekNumber }} branch={branch} userId={selectedEmployeeId} />
          {schedule?.id && csv && csvKnopf("md:hidden")}
          {/* Die klassische Tabelle ist eine Darstellungsvariante der Planung. */}
          <Button variant="outline" size="sm" className="w-full justify-start gap-1.5" asChild>
            <Link href={`/schedule/classic/${formatKW(weekNumber, year)}${suffix}`}>
              <Table2 className="size-3.5" aria-hidden="true" />
              Klassische Tabelle
            </Link>
          </Button>
          <Button variant="outline" size="sm" className="w-full justify-start gap-1.5" asChild>
            <Link href={`/schedule/flexible/${formatKW(weekNumber, year)}?wahl=1`}>
              <ArrowLeftRight className="size-3.5" aria-hidden="true" />
              Standort wechseln
            </Link>
          </Button>
          {schedule?.id && access?.edit && (
            <>
              <p className="akro-label pt-1">Darstellung</p>
              <OptionsMenu scheduleId={schedule.id} settingsLayout={schedule.settingsLayout} showTitle={schedule.showTitle} showPauses={schedule.showPauses} />
            </>
          )}
          {schedule?.id && (
            <>
              <p className="akro-label pt-1">Werkzeuge</p>
              <BriefingButton scheduleId={schedule.id} isManager={!!access?.edit} />
              {access?.edit && <LiveMode scheduleId={schedule.id} isManager />}
              {isAdmin && <AISuggestButton scheduleId={schedule.id} />}
            </>
          )}
          {/* Gefaehrliche Aktion abgesetzt am Ende; waehrend der Bearbeitung gesperrt. */}
          {darfVeröffentlichen && schedule?.isPublic && (
            <>
              <Separator className="my-1" />
              <VisibilityToggle scheduleId={schedule.id} isPublic wochenLabel={wochenLabel} disabled={status === "EDITING"} className="w-full justify-start text-destructive hover:text-destructive" />
              {status === "EDITING" && (
                <p className="text-[13px] leading-5 text-muted-foreground">Während der Bearbeitung nicht möglich – zuerst die Änderungen veröffentlichen oder verwerfen.</p>
              )}
            </>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );

  return (
    <>
      <ExportModal open={exportOpen} onOpenChange={setExportOpen} defaultMonth={weekDates[0].getMonth() + 1} defaultYear={weekDates[0].getFullYear()} standort={standort} />

      {/* Zeile 1: wo - Kunde und Objekt, rechts die Ansicht */}
      <div className="mb-3 flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
        <div className="flex min-w-0 flex-1 basis-56 items-end gap-3">
          <div className="min-w-0 flex-1">
            <p className="akro-label truncate">{standort === "ohne" ? "Altbestand" : branch?.customer?.name ?? "Ohne Kunde"}</p>
            <h1 className="truncate text-[21px] leading-tight font-semibold tracking-[-0.02em]">
              {standort === "ohne" ? "Ohne Standort" : branch?.name}
            </h1>
          </div>
          {handy && menü}
        </div>
        <ViewSwitcher kw={formatKW(weekNumber, year)} standort={standort} />
      </div>

      {/* Zeile 2: wann und wie es steht. Auf dem Handy klebt der Zeitraum unter der Kopfschiene (75 px). */}
      <div className="mb-3 max-md:contents md:flex md:flex-wrap md:items-center md:gap-x-4 md:gap-y-2">
        <div className="flex flex-wrap items-center gap-2 max-md:sticky max-md:top-[75px] max-md:z-20 max-md:-mx-4 max-md:mb-3 max-md:border-b max-md:bg-background max-md:px-4 max-md:py-2">
          <WeekSwitcher
            label={<>{formatDateShort(weekDates[0])}.–{formatDateShort(weekDates[6])}.<span className="max-sm:hidden">{year}</span></>}
            zusatz={wochenLabel}
            onPrev={zurueck}
            onNext={vor}
            onToday={() => geheZu(current.weekNumber, current.year)}
            heuteAktiv={istAktuelleWoche}
            heuteMobilAusblenden
            labelRef={zeitraumRef}
          />
          {schedule && <PlanStatusBadge schedule={schedule} klein />}
        </div>

        <ul aria-label="Stand der Woche" data-kennwerte className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] font-medium max-md:mb-3">
          <Kennwert icon={Users} zahl={offen} text={offen === 1 ? "1 offener Platz" : offen + " offene Plätze"} hinweis />
          {access?.planner ? (
            <Kennwert icon={Clock3} zahl={bestätigungen} text={bestätigungen === 1 ? "1 Bestätigung offen" : bestätigungen + " Bestätigungen offen"} hinweis />
          ) : (
            <Kennwert icon={Clock3} zahl={shifts.length} text={shifts.length === 1 ? "1 Schicht" : shifts.length + " Schichten"} />
          )}
          {access?.handleRequests && <Kennwert icon={FileText} zahl={openWishCount} text={openWishCount === 1 ? "1 Anfrage" : openWishCount + " Anfragen"} hinweis />}
          {konflikteFrei && (
            <li className="inline-flex items-center gap-1 whitespace-nowrap text-ok">
              <Check className="size-3.5 shrink-0" aria-hidden="true" />
              Keine Konflikte
            </li>
          )}
        </ul>

        <div className="flex flex-wrap items-center gap-2 max-md:mb-3 md:ml-auto">
          {/* Filter ab Tablet sichtbar, auf dem Handy im Menue */}
          {filter && <div className="hidden items-center gap-2 md:flex">{filter}</div>}
          {schedule?.id && csv && csvKnopf("max-md:hidden")}
          {schedule?.id && onAddShift && (
            <Button size="sm" variant={schichtAlsHauptaktion ? "default" : "outline"} className="gap-1.5 max-md:h-11" onClick={onAddShift}>
              <Plus className="size-3.5" aria-hidden="true" />
              Schicht hinzufügen
            </Button>
          )}
          {/* Veroeffentlichen und Verwerfen stehen im Statusbalken; hier nur der Einstieg in die Bearbeitung. */}
          {bearbeitungStarten && schedule && (
            <BearbeitungStarten scheduleId={schedule.id} wochenLabel={wochenLabel + "/" + year} wochenbeginn={weekDates[0]} variant="default" className="max-md:h-11" />
          )}

          {!handy && menü}
        </div>
      </div>
    </>
  );
}
