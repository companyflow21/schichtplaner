"use client";

import { useState } from "react";
import { CalendarDays, List, Palmtree } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AbsenceList } from "@/components/employees/absence-list";
import { AbsenceCalendar } from "@/components/employees/absence-calendar";
import { Availability } from "@/components/workforce/availability";
import { OwnVacation, VacationOverview } from "@/components/employees/vacation";
import { useCurrentMember } from "@/lib/hooks/use-current-member";

type ViewMode = "list" | "calendar" | "vacation";

export default function AbsencesPage() {
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const { data: me } = useCurrentMember();
  // Urlaubskonten anderer: Administration und Manager mit "Abwesenheiten entscheiden".
  const decides = me?.role === "OWNER" || me?.role === "ADMIN" || Object.values(me?.access.staff ?? {}).some((rights) => rights.includes("MANAGE_ABSENCES"));

  return (
    <div className="space-y-4">
      {/* View toggle */}
      <div className="flex justify-end">
        <div className="flex gap-1 rounded-md border p-0.5">
          <Button
            variant={viewMode === "list" ? "default" : "ghost"}
            size="xs"
            onClick={() => setViewMode("list")}
          >
            <List className="size-3.5" />
            <span className="hidden sm:inline">Liste</span>
          </Button>
          <Button
            variant={viewMode === "calendar" ? "default" : "ghost"}
            size="xs"
            onClick={() => setViewMode("calendar")}
          >
            <CalendarDays className="size-3.5" />
            <span className="hidden sm:inline">Kalender</span>
          </Button>
          {decides && (
            <Button
              variant={viewMode === "vacation" ? "default" : "ghost"}
              size="xs"
              onClick={() => setViewMode("vacation")}
            >
              <Palmtree className="size-3.5" />
              <span className="hidden sm:inline">Urlaubskonten</span>
            </Button>
          )}
        </div>
      </div>

      <OwnVacation />
      {viewMode === "list" ? <AbsenceList /> : viewMode === "calendar" ? <AbsenceCalendar /> : <VacationOverview />}
      <Availability />
    </div>
  );
}
