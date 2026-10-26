"use client";

import { useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { BranchPicker, useStandortMerken } from "./branch-picker";
import { MonthGrid } from "./month-grid";

interface MonthGridWrapperProps {
  month: number;
  year: number;
  standort: string | null;
  offen?: boolean;
}

/** Ohne ?standort fuehrt die Auswahl weiter (siehe BranchPicker); ?wahl=1 zeigt sie immer. */
export function MonthGridWrapper({ month, year, standort, offen }: MonthGridWrapperProps) {
  const wahl = useSearchParams().get("wahl") === "1";
  const monat = String(month).padStart(2, "0") + "-" + year;
  const href = useCallback((id: string) => `/schedule/month/${monat}?standort=${id}`, [monat]);
  useStandortMerken(standort);
  if (!standort) {
    return <BranchPicker title="Monatsplan" href={href} automatisch={!wahl} />;
  }
  return <MonthGrid month={month} year={year} standort={standort} offen={offen} />;
}
