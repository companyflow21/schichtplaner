"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { getISOWeek } from "date-fns";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  getCurrentKW,
  getWeekDates,
  getMonthKWs,
  formatKW,
  formatDateShort,
  formatDateLong,
  monthNames,
} from "@/lib/utils/calendar";
import { useCurrentMember } from "@/lib/hooks/use-current-member";
import { isPlanner } from "@/components/layout/nav-config";
import { cn } from "@/lib/utils";
import { PdfExportDialog } from "./pdf-export-dialog";
import { ViewSwitcher } from "./view-switcher";
import { WeekSwitcher } from "./week-switcher";

interface WeekNavProps {
  weekNumber: number;
  year: number;
  /** Base URL for navigation, defaults to "/schedule/flexible" */
  baseUrl?: string;
  /** Standort, der beim Blaettern erhalten bleibt. */
  standort?: string | null;
}

/**
 * Get the number of ISO weeks in a given year.
 * Dec 28 is always in the last ISO week of the year.
 */
function getMaxISOWeek(y: number): number {
  return getISOWeek(new Date(y, 11, 28));
}

/**
 * Blaettern baut die Seite neu auf; der geklickte Knopf ist dann weg. Der
 * Fokus wandert auf den Zeitraum statt auf BODY (siehe WeekSwitcher).
 */
const blaettern = { fokus: false };

/** Zeitraum fuers Handy ohne Jahr: "19.–25.10." bzw. "28.9.–4.10.". */
function kurzerZeitraum(von: Date, bis: Date): string {
  return von.getMonth() === bis.getMonth()
    ? `${von.getDate()}.–${bis.getDate()}.${bis.getMonth() + 1}.`
    : `${von.getDate()}.${von.getMonth() + 1}.–${bis.getDate()}.${bis.getMonth() + 1}.`;
}

/** Ueberschrift der Ansicht. Die Planung sieht in derselben Ansicht alle Personen. */
function ansichtsName(baseUrl: string, planer: boolean, standort?: string | null): string {
  if (baseUrl.startsWith("/schedule/classic")) return "Klassische Tabelle";
  if (baseUrl.startsWith("/schedule/employee")) return standort || planer ? "Mitarbeiteransicht" : "Mein Dienstplan";
  return "Dienstplan";
}

/**
 * Kopf der Wochenansichten "Mein Dienstplan" (Mitarbeiter) und "Klassische
 * Tabelle": Name der Ansicht, PDF als Nebenaktion, Ansichtsschalter und die
 * Zeitraumzeile mit WeekSwitcher und "Woche wählen". Gibt zwei Geschwister
 * zurueck, damit die Zeitraumzeile auf dem Handy ueber die ganze Seite klebt.
 */
export function WeekNav({ weekNumber, year, baseUrl = "/schedule/flexible", standort }: WeekNavProps) {
  const router = useRouter();
  const { data: me } = useCurrentMember();
  const currentKW = useMemo(() => getCurrentKW(), []);
  const weekDates = useMemo(() => getWeekDates(weekNumber, year), [weekNumber, year]);
  const labelRef = useRef<HTMLElement>(null);
  const suffix = standort ? "?standort=" + encodeURIComponent(standort) : "";

  useEffect(() => {
    if (!blaettern.fokus) return;
    blaettern.fokus = false;
    const aktiv = document.activeElement;
    if (!aktiv || aktiv === document.body) labelRef.current?.focus({ preventScroll: true });
  }, [weekNumber, year]);

  function geheZu(kw: number, kwYear: number) {
    blaettern.fokus = true;
    router.push(`${baseUrl}/${formatKW(kw, kwYear)}${suffix}`);
  }
  function zurueck() {
    if (weekNumber > 1) geheZu(weekNumber - 1, year);
    else geheZu(getMaxISOWeek(year - 1), year - 1);
  }
  function vor() {
    if (weekNumber < getMaxISOWeek(year)) geheZu(weekNumber + 1, year);
    else geheZu(1, year + 1);
  }

  const isCurrentWeek = weekNumber === currentKW.weekNumber && year === currentKW.year;
  const kurz = kurzerZeitraum(weekDates[0], weekDates[6]);
  const lang = `${formatDateShort(weekDates[0])}.–${formatDateLong(weekDates[6])}`;

  return (
    <>
      {/* Kopf: Name der Ansicht, PDF als Nebenaktion, rechts die Ansicht (Handy: eigene Zeile). */}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-3">
        <h1 className="min-w-0 flex-1 text-[22px] leading-tight font-semibold tracking-[-0.03em]">
          {ansichtsName(baseUrl, isPlanner(me?.role), standort)}
        </h1>
        <PdfExportDialog week={{ year, weekNumber }} branchId={standort ?? null} kompakt />
        <ViewSwitcher kw={formatKW(weekNumber, year)} standort={standort ?? null} />
      </div>

      {/* Zeitraum: auf dem Handy klebt die Zeile unter der Kopfschiene. */}
      <div className="flex items-center gap-2 max-md:sticky max-md:top-(--kopf-hoehe) max-md:z-20 max-md:-mx-4 max-md:-mt-2 max-md:border-b max-md:border-[var(--linie-fein)] max-md:bg-background max-md:px-4 max-md:py-2">
        <WeekSwitcher
          label={
            <>
              <span className="sm:hidden">{kurz}</span>
              <span className="max-sm:hidden">{lang}</span>
            </>
          }
          zusatz={"KW " + String(weekNumber).padStart(2, "0")}
          onPrev={zurueck}
          onNext={vor}
          onToday={() => geheZu(currentKW.weekNumber, currentKW.year)}
          heuteAktiv={isCurrentWeek}
          labelRef={labelRef}
          className="min-w-0"
        />
        <WochenWahl weekNumber={weekNumber} year={year} aktuell={currentKW} onWahl={geheZu} />
      </div>
    </>
  );
}

/**
 * "Woche wählen": Monate eines Jahres mit ihren Kalenderwochen und ein
 * Sprung per KW und Jahr (Enter springt). Ersetzt Monatschips und
 * "Springe zu" der alten Leiste.
 */
function WochenWahl({
  weekNumber,
  year,
  aktuell,
  onWahl,
}: {
  weekNumber: number;
  year: number;
  aktuell: { weekNumber: number; year: number };
  onWahl: (kw: number, kwYear: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [jahr, setJahr] = useState(year);
  const [eingabe, setEingabe] = useState({ kw: "", jahr: String(year) });
  const [fehler, setFehler] = useState<string | null>(null);
  const gewaehltRef = useRef<HTMLButtonElement>(null);
  // Die angezeigte Woche steht im Monat ihres Donnerstags (ISO-Regel).
  const monatDerWoche = useMemo(() => getWeekDates(weekNumber, year)[3].getMonth() + 1, [weekNumber, year]);
  const monate = useMemo(
    () => Array.from({ length: 12 }, (_, i) => ({ monat: i + 1, wochen: getMonthKWs(i + 1, jahr) })),
    [jahr]
  );

  function umschalten(next: boolean) {
    setOpen(next);
    if (next) {
      setJahr(year);
      setEingabe({ kw: "", jahr: String(year) });
      setFehler(null);
    }
  }
  function waehlen(kw: number, kwYear: number) {
    setOpen(false);
    onWahl(kw, kwYear);
  }
  function springen(event: React.FormEvent) {
    event.preventDefault();
    const kw = Number(eingabe.kw);
    const j = Number(eingabe.jahr);
    if (!Number.isInteger(j) || j < 2000 || j > 2100) {
      setFehler("Bitte ein Jahr zwischen 2000 und 2100 angeben.");
      return;
    }
    const max = getMaxISOWeek(j);
    if (!Number.isInteger(kw) || kw < 1 || kw > max) {
      setFehler(`${j} hat die Kalenderwochen 1 bis ${max}.`);
      return;
    }
    waehlen(kw, j);
  }

  return (
    <Popover open={open} onOpenChange={umschalten}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          title="Woche wählen"
          className="shrink-0 gap-1.5 max-md:w-11 max-md:px-0 max-md:has-[>svg]:px-0"
        >
          <CalendarDays className="size-3.5" aria-hidden="true" />
          <span className="max-md:sr-only">Woche wählen</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-[min(22rem,calc(100vw-2rem))] p-0"
        onOpenAutoFocus={(event) => {
          // Kein Fokus ins Zahlenfeld: auf dem Handy oeffnete sonst die Tastatur.
          event.preventDefault();
          gewaehltRef.current?.focus();
        }}
      >
        <form onSubmit={springen} noValidate className="flex items-end gap-2 border-b p-3">
          <label className="grid gap-1 text-[13px] font-medium">
            KW
            <Input
              type="number"
              inputMode="numeric"
              min={1}
              max={53}
              value={eingabe.kw}
              onChange={(e) => { setEingabe({ ...eingabe, kw: e.target.value }); setFehler(null); }}
              aria-invalid={!!fehler}
              className="w-16 text-center"
            />
          </label>
          <label className="grid gap-1 text-[13px] font-medium">
            Jahr
            <Input
              type="number"
              inputMode="numeric"
              min={2000}
              max={2100}
              value={eingabe.jahr}
              onChange={(e) => { setEingabe({ ...eingabe, jahr: e.target.value }); setFehler(null); }}
              aria-invalid={!!fehler}
              className="w-20 text-center"
            />
          </label>
          <Button type="submit" variant="outline" className="ml-auto h-10 gap-1.5" disabled={!eingabe.kw}>
            Springen
            <ArrowRight className="size-3.5" aria-hidden="true" />
          </Button>
        </form>
        {fehler && <p role="alert" className="px-3 pt-2 text-[13px] text-destructive">{fehler}</p>}

        <div className="flex items-center justify-between px-2 pt-2">
          <Button variant="ghost" size="icon-sm" aria-label="Vorheriges Jahr" onClick={() => setJahr(jahr - 1)}>
            <ChevronLeft className="size-4" aria-hidden="true" />
          </Button>
          <p className="tabular text-[14px] font-semibold" aria-live="polite">{jahr}</p>
          <Button variant="ghost" size="icon-sm" aria-label="Nächstes Jahr" onClick={() => setJahr(jahr + 1)}>
            <ChevronRight className="size-4" aria-hidden="true" />
          </Button>
        </div>
        {/* Hoehe so begrenzt, dass die untere Leiste auf dem Handy frei bleibt. */}
        <ul className="max-h-[min(22rem,40dvh)] space-y-0.5 overflow-y-auto px-2 pt-1 pb-2" aria-label={"Kalenderwochen " + jahr}>
          {monate.map(({ monat, wochen }) => (
            <li key={monat} className="flex items-center gap-1">
              <span className="w-9 shrink-0 text-[13px] text-muted-foreground">{monthNames[monat - 1]}</span>
              <div className="flex flex-wrap gap-1">
                {wochen.map((w) => {
                  const gewaehlt = w.weekNumber === weekNumber && w.year === year;
                  const heute = w.weekNumber === aktuell.weekNumber && w.year === aktuell.year;
                  return (
                    <button
                      key={`${w.weekNumber}-${w.year}`}
                      ref={gewaehlt && monat === monatDerWoche && jahr === year ? gewaehltRef : undefined}
                      type="button"
                      onClick={() => waehlen(w.weekNumber, w.year)}
                      aria-current={gewaehlt ? "true" : undefined}
                      aria-label={`KW ${w.weekNumber}/${w.year}${heute ? ", aktuelle Woche" : ""}`}
                      className={cn(
                        "tabular flex size-8 items-center justify-center rounded-[var(--radius)] text-[13px] transition-colors focus-visible:outline-offset-[-3px] max-md:size-11",
                        gewaehlt
                          ? "bg-primary font-semibold text-primary-foreground hover:bg-primary/90"
                          : "hover:bg-muted",
                        !gewaehlt && heute && "font-semibold text-primary ring-1 ring-primary/50 ring-inset"
                      )}
                    >
                      {w.weekNumber}
                    </button>
                  );
                })}
              </div>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
