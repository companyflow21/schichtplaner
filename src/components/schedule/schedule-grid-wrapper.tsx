"use client";

import { useCallback, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { formatKW } from "@/lib/utils/calendar";
import { BranchPicker, useStandortMerken } from "./branch-picker";
import { ScheduleGrid } from "./schedule-grid";

interface ScheduleGridWrapperProps {
  weekNumber: number;
  year: number;
  /** ISO date strings for each day Mon-Sun */
  weekDateStrings: string[];
  /** Standort des Wochenplans; ohne Standort wird einer gewaehlt. */
  standort: string | null;
}

/**
 * Wandelt die Datumswerte fuer das Raster um. Ohne ?standort fuehrt die
 * Auswahl weiter (ein Einsatzort oder der zuletzt angesehene); ?wahl=1
 * zeigt sie immer ("Standort wechseln").
 */
export function ScheduleGridWrapper({ weekNumber, year, weekDateStrings, standort }: ScheduleGridWrapperProps) {
  const weekDates = useMemo(() => weekDateStrings.map((s) => new Date(s)), [weekDateStrings]);
  const wahl = useSearchParams().get("wahl") === "1";
  const kw = formatKW(weekNumber, year);
  const href = useCallback((id: string) => `/schedule/flexible/${kw}?standort=${id}`, [kw]);
  useStandortMerken(standort);
  if (!standort) {
    return <BranchPicker title="Wochenplan" href={href} automatisch={!wahl} />;
  }
  return <ScheduleGrid weekNumber={weekNumber} year={year} weekDates={weekDates} standort={standort} />;
}
