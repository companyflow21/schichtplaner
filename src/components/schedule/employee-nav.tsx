"use client";

import { useState, useMemo } from "react";
import { ChevronDown, Search, Users, X } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { ShiftData } from "@/types/schedule";
import { formatName } from "@/lib/names";
import { useNameFormat } from "@/lib/hooks/use-current-member";

type OrgEmployee = {
  id: string;
  role: string;
  user: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    profileImage: string | null;
  };
};

interface EmployeeNavProps {
  shifts: ShiftData[];
  selectedEmployeeId: string | null;
  onSelectEmployee: (userId: string | null) => void;
}

function getInitials(firstName: string, lastName: string): string {
  return `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase();
}

/** Geplante Nettostunden einer Schicht (nach Pause, Zeitumstellung beachtet) - berechnet der Server. */
function calcShiftHours(shift: ShiftData): number {
  return (shift.plannedMinutes ?? 0) / 60;
}

export function EmployeeNav({
  shifts,
  selectedEmployeeId,
  onSelectEmployee,
}: EmployeeNavProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const nameFormat = useNameFormat();

  // Nur Personen, die im Plan ohnehin sichtbar sind - keine Personalliste.
  const employees = useMemo(() => {
    const byUser = new Map<string, OrgEmployee>();
    for (const shift of shifts) {
      for (const booking of shift.bookings) {
        // Geloeschte Personen sind nicht auswaehlbar (kein Konto mehr).
        if (!booking.userId || !booking.user.id) continue;
        if (!byUser.has(booking.userId)) byUser.set(booking.userId, { id: booking.userId, role: "", user: { ...booking.user, id: booking.user.id, email: "" } });
      }
    }
    return [...byUser.values()];
  }, [shifts]);

  // Calculate hours per employee from shifts data
  const employeeHours = useMemo(() => {
    const hours: Record<string, number> = {};
    for (const shift of shifts) {
      const shiftDuration = calcShiftHours(shift);
      for (const booking of shift.bookings) {
        if (!booking.userId) continue;
        hours[booking.userId] = (hours[booking.userId] ?? 0) + shiftDuration;
      }
    }
    return hours;
  }, [shifts]);

  // Total hours across all employees
  const totalHours = useMemo(() => {
    return Object.values(employeeHours).reduce((sum, h) => sum + h, 0);
  }, [employeeHours]);

  // Filter employees by search
  const filteredEmployees = useMemo(() => {
    if (!search) return employees;
    const q = search.toLowerCase();
    return employees.filter(
      (e) =>
        e.user.firstName.toLowerCase().includes(q) ||
        e.user.lastName.toLowerCase().includes(q)
    );
  }, [employees, search]);

  // Sort by hours (most hours first), then alphabetically
  const sortedEmployees = useMemo(() => {
    return [...filteredEmployees].sort((a, b) => {
      const ha = employeeHours[a.user.id] ?? 0;
      const hb = employeeHours[b.user.id] ?? 0;
      if (hb !== ha) return hb - ha;
      return a.user.lastName.localeCompare(b.user.lastName);
    });
  }, [filteredEmployees, employeeHours]);

  const selectedEmployee = employees.find(
    (e) => e.user.id === selectedEmployeeId
  );

  return (
    <div className="flex items-center gap-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant={selectedEmployeeId ? "default" : "outline"}
            size="sm"
            className="gap-1.5"
          >
            <Users className="size-3.5" aria-hidden="true" />
            {selectedEmployee ? (
              <>
                {formatName(selectedEmployee.user, nameFormat)}
                <Badge variant="secondary" className="tabular ml-1 px-1.5 py-0 text-xs">
                  {(employeeHours[selectedEmployee.user.id] ?? 0).toFixed(1)} h
                </Badge>
              </>
            ) : (
              <>
                Alle Mitarbeiter
                <Badge variant="secondary" className="tabular ml-1 px-1.5 py-0 text-xs">
                  {totalHours.toFixed(1)} h
                </Badge>
              </>
            )}
            <ChevronDown className="size-3 ml-0.5" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-72 p-0" align="start">
          {/* Suche: normales Eingabefeld mit eigenem Fokusring. */}
          <div className="relative border-b p-2">
            <Search className="pointer-events-none absolute top-1/2 left-4 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Mitarbeiter suchen..."
              aria-label="Mitarbeiter suchen"
              className="h-9 pl-8 text-sm max-md:h-11"
            />
          </div>

          {/* Employee list */}
          <div className="max-h-64 overflow-y-auto p-1">
            {/* "All" option */}
            <button
              type="button"
              className={cn(
                "flex items-center gap-2 w-full rounded-sm px-2 py-1.5 text-sm transition-colors max-md:min-h-11",
                !selectedEmployeeId
                  ? "bg-accent text-accent-foreground"
                  : "hover:bg-accent/50"
              )}
              onClick={() => {
                onSelectEmployee(null);
                setOpen(false);
              }}
            >
              <div className="size-7 rounded-full bg-muted flex items-center justify-center">
                <Users className="size-3" />
              </div>
              <span className="flex-1 text-left">Alle Mitarbeiter</span>
              <Badge variant="secondary" className="tabular px-1.5 py-0 text-xs">
                {totalHours.toFixed(1)} h
              </Badge>
            </button>

            {/* Employee items */}
            {sortedEmployees.map((emp) => {
              const hours = employeeHours[emp.user.id] ?? 0;
              const isSelected = selectedEmployeeId === emp.user.id;

              return (
                <button
                  key={emp.id}
                  type="button"
                  className={cn(
                    "flex items-center gap-2 w-full rounded-sm px-2 py-1.5 text-sm transition-colors max-md:min-h-11",
                    isSelected
                      ? "bg-accent text-accent-foreground"
                      : "hover:bg-accent/50"
                  )}
                  onClick={() => {
                    onSelectEmployee(isSelected ? null : emp.user.id);
                    setOpen(false);
                  }}
                >
                  <Avatar size="sm" className="data-[size=sm]:size-7">
                    <AvatarFallback className="text-xs">
                      {getInitials(emp.user.firstName, emp.user.lastName)}
                    </AvatarFallback>
                  </Avatar>
                  <span className="flex-1 text-left truncate">
                    {formatName(emp.user, nameFormat)}
                  </span>
                  {hours > 0 && (
                    <Badge
                      variant="secondary"
                      className="tabular px-1.5 py-0 text-xs"
                    >
                      {hours.toFixed(1)} h
                    </Badge>
                  )}
                </button>
              );
            })}
          </div>
        </PopoverContent>
      </Popover>

      {/* Clear filter button */}
      {selectedEmployeeId && (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Personenfilter aufheben"
          title="Personenfilter aufheben"
          className="max-md:size-11"
          onClick={() => onSelectEmployee(null)}
        >
          <X className="size-3.5" aria-hidden="true" />
        </Button>
      )}
    </div>
  );
}
