"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Ban, CalendarCheck, Loader2, Star } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

type Person = {
  id: string;
  firstName: string;
  lastName: string;
  nickname: string | null;
  profileImage: string | null;
};

/** Reihenfolge und Gruende kommen vom Server (src/lib/planning.ts, shiftCandidates). */
type Group = "available" | "open" | "warning" | "other";
type Candidate = {
  memberId: string;
  userId: string;
  role: string;
  user: Person;
  group: Group;
  reasons: string[];
  /** Qualifikationshinweis: vor der Zuweisung genau eine Bestätigung. */
  confirm: boolean;
};
type Blocked = { memberId: string; userId: string; role: string; user: Person; reasons: string[] };

type ScoreBreakdown = {
  hours: number;
  availability: number;
  division: number;
  history: number;
};

type EmployeeScoreData = {
  employeeId: string;
  firstName: string;
  lastName: string;
  score: number;
  breakdown: ScoreBreakdown;
};

interface EmployeePickerProps {
  /** IDs of users already booked in this shift */
  bookedUserIds: string[];
  /** Auswahl; confirm ist gesetzt, wenn ein Qualifikationshinweis bestätigt wurde. */
  onSelect: (userId: string, confirm: boolean) => void;
  shiftId: string;
  children: React.ReactNode;
}

const GROUPS: { key: Group; heading: string }[] = [
  { key: "available", heading: "Verfügbarkeit eingetragen" },
  { key: "open", heading: "Ohne Verfügbarkeitseintrag" },
  { key: "warning", heading: "Mit Hinweis – Bestätigung nötig" },
  { key: "other", heading: "Diesem Standort nicht zugeordnet" },
];

function getInitials(firstName: string, lastName: string): string {
  return `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase();
}

/** Get the CSS classes for a score badge based on value. */
function getScoreColor(score: number): string {
  if (score >= 80) return "bg-ok/10 text-ok dark:bg-ok/20 dark:text-ok";
  if (score >= 50) return "bg-warn/10 text-warn dark:bg-warn/20 dark:text-warn";
  return "bg-destructive/10 text-destructive dark:bg-destructive/20 dark:text-destructive";
}

/** Format score breakdown for tooltip display. */
function formatBreakdown(breakdown: ScoreBreakdown): string {
  const lines: string[] = [];
  lines.push(`Stunden: ${breakdown.hours}/40`);
  lines.push(`Verfuegbarkeit: ${breakdown.availability}/30`);
  lines.push(`Bereich: ${breakdown.division}/20`);
  lines.push(`Historie: ${breakdown.history}/10`);
  return lines.join("\n");
}

function Name({ user }: { user: Person }) {
  return (
    <>
      <Avatar size="sm">
        <AvatarFallback className="text-[9px]">
          {getInitials(user.firstName, user.lastName)}
        </AvatarFallback>
      </Avatar>
      <span className="truncate text-sm">
        {user.firstName} {user.lastName}
      </span>
    </>
  );
}

/**
 * Auswahl beim Besetzen. Der Server liefert nur Personen, die die
 * angemeldete Person einplanen darf, bereits sortiert: zuerst dem Standort
 * zugeordnet mit eingetragener Verfügbarkeit, dann ohne Eintrag, dann mit
 * Qualifikationshinweis. Gesperrte Personen stehen am Ende mit Grund und
 * sind nicht wählbar.
 */
export function EmployeePicker({
  bookedUserIds,
  onSelect,
  shiftId,
  children,
}: EmployeePickerProps) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<Candidate | null>(null);

  const { data, isLoading } = useQuery<{ members: Candidate[]; blocked: Blocked[] }>({
    queryKey: ["employees", "candidates", shiftId],
    queryFn: async () => {
      const res = await fetch("/api/shifts/" + shiftId + "/candidates");
      if (!res.ok) throw new Error("Fehler beim Laden der Mitarbeiter");
      return res.json();
    },
    enabled: open,
  });

  // Fetch AI recommendation scores (lazy: only when picker opens)
  const { data: scoresData, isLoading: scoresLoading } = useQuery<{
    scores: EmployeeScoreData[];
  }>({
    queryKey: ["ai-recommend", shiftId],
    queryFn: async () => {
      const res = await fetch(`/api/ai/recommend?shiftId=${shiftId}`);
      if (!res.ok) return { scores: [] };
      return res.json();
    },
    enabled: open,
  });

  const candidates = data?.members ?? [];
  const blocked = data?.blocked ?? [];
  const bookedSet = new Set(bookedUserIds);
  const scoreMap = new Map((scoresData?.scores ?? []).map((s) => [s.employeeId, s]));

  function handleSelect(candidate: Candidate) {
    if (bookedSet.has(candidate.userId)) return;
    setOpen(false);
    if (candidate.confirm) setPending(candidate);
    else onSelect(candidate.userId, false);
  }

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>{children}</PopoverTrigger>
        <PopoverContent className="w-80 p-0" align="start" sideOffset={4}>
          <Command>
            <CommandInput placeholder="Mitarbeiter suchen..." />
            <CommandList className="max-h-[360px]">
              {isLoading ? (
                <div className="flex items-center justify-center gap-2 py-4 text-xs text-muted-foreground">
                  <Loader2 className="size-3 animate-spin" />
                  Auswahl wird geladen
                </div>
              ) : (
                <CommandEmpty>Keine einplanbaren Mitarbeiter</CommandEmpty>
              )}
              {scoresLoading && candidates.length > 0 && (
                <div className="flex items-center justify-center gap-2 py-2 text-xs text-muted-foreground">
                  <Loader2 className="size-3 animate-spin" />
                  Bewertungen laden...
                </div>
              )}
              {GROUPS.map(({ key, heading }) => {
                const list = candidates.filter((c) => c.group === key);
                if (!list.length) return null;
                return (
                  <CommandGroup key={key} heading={heading}>
                    {list.map((c) => {
                      const scoreData = scoreMap.get(c.userId);
                      const hinweis = c.confirm;
                      return (
                        <CommandItem
                          key={c.memberId}
                          value={`${c.user.firstName} ${c.user.lastName} ${c.user.nickname ?? ""} ${c.memberId}`}
                          onSelect={() => handleSelect(c)}
                          className="items-start"
                        >
                          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                            <div className="flex items-center gap-2">
                              <Name user={c.user} />
                            </div>
                            <span
                              className={cn(
                                "flex items-start gap-1 pl-8 text-[11.5px] leading-snug",
                                hinweis ? "text-warn" : "text-muted-foreground"
                              )}
                            >
                              {hinweis ? (
                                <AlertTriangle className="mt-px size-3 shrink-0" aria-hidden="true" />
                              ) : key === "available" ? (
                                <CalendarCheck className="mt-px size-3 shrink-0" aria-hidden="true" />
                              ) : null}
                              {c.reasons.join(" ")}
                            </span>
                          </div>
                          {scoreData && (
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Badge
                                    variant="secondary"
                                    className={cn(
                                      "text-[9px] px-1.5 py-0 gap-0.5 cursor-help",
                                      getScoreColor(scoreData.score)
                                    )}
                                  >
                                    <Star className="size-2.5" />
                                    {scoreData.score}
                                  </Badge>
                                </TooltipTrigger>
                                <TooltipContent
                                  side="left"
                                  className="whitespace-pre text-[11px] leading-relaxed"
                                >
                                  {formatBreakdown(scoreData.breakdown)}
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          )}
                        </CommandItem>
                      );
                    })}
                  </CommandGroup>
                );
              })}
              {blocked.length > 0 && (
                <CommandGroup heading="Gesperrt">
                  {blocked.map((b) => (
                    <CommandItem
                      key={b.memberId}
                      value={`${b.user.firstName} ${b.user.lastName} ${b.user.nickname ?? ""} ${b.memberId}`}
                      disabled
                      className="items-start opacity-70"
                    >
                      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <div className="flex items-center gap-2">
                          <Name user={b.user} />
                        </div>
                        <span className="flex items-start gap-1 pl-8 text-[11.5px] leading-snug text-muted-foreground">
                          <Ban className="mt-px size-3 shrink-0" aria-hidden="true" />
                          {b.reasons.join(" ")}
                        </span>
                      </div>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(value) => {
          if (!value) setPending(null);
        }}
        title="Trotz Hinweis einteilen?"
        description={
          pending
            ? `${pending.user.firstName} ${pending.user.lastName}: ${pending.reasons.join(" ")} Die Einteilung wird trotzdem gespeichert.`
            : ""
        }
        confirmLabel="Trotzdem einteilen"
        destructive={false}
        onConfirm={() => {
          if (pending) onSelect(pending.userId, true);
          setPending(null);
        }}
      />
    </>
  );
}
