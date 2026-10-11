"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Ban, CalendarCheck, Loader2 } from "lucide-react";
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
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { cn } from "@/lib/utils";
import { formatName } from "@/lib/names";
import { useNameFormat } from "@/lib/hooks/use-current-member";

/** Reihenfolge, Gruppen und Gründe kommen vom Server (src/lib/planning.ts, shiftCandidates). */
type Candidate = {
  userId: string;
  firstName: string;
  lastName: string;
  group: 1 | 2 | 3 | 4 | 5;
  selectable: boolean;
  /** Hinweis vorhanden: vor der Zuweisung genau eine Bestätigung. */
  confirm: boolean;
  reasons: string[];
  hints: string[];
};
type ContractorCandidate = {
  id: string;
  name: string;
  subcontractor: { id: string; name: string };
  selectable: boolean;
  confirm: boolean;
  reasons: string[];
  hints: string[];
};
type CandidateData = { site: string | null; customer: string | null; admin: boolean; candidates: Candidate[]; contractorWorkers?: ContractorCandidate[] };

interface EmployeePickerProps {
  /** IDs of users already booked in this shift */
  bookedUserIds: string[];
  /** Auswahl; confirm ist gesetzt, wenn ein Hinweis bestätigt wurde. */
  onSelect: (userId: string, confirm: boolean) => void;
  onSelectContractor?: (contractorWorkerId: string, confirm: boolean) => void;
  shiftId: string;
  children: React.ReactNode;
  /** replace: Auswahl ersetzt eine bestehende Zuweisung ("Mitarbeiter wechseln"). */
  mode?: "assign" | "replace";
  /** Kopfzeile der Auswahl, etwa wer ersetzt wird. */
  heading?: string;
}

function headings(data: CandidateData): Record<Candidate["group"], string> {
  const site = data.site ?? "Dieser Standort";
  const customer = data.customer ? "Weitere Standorte von " + data.customer : "Weitere Standorte desselben Kunden";
  return {
    1: site + " – frei",
    2: site + " – belegt oder abwesend",
    3: customer + " – frei",
    4: customer + " – belegt oder abwesend",
    5: data.admin ? "Weitere Mitarbeitende" : "Dir persönlich zugeordnet",
  };
}

function getInitials(firstName: string, lastName: string): string {
  return `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase();
}

/**
 * Auswahl beim Besetzen: zuerst der Standort der Schicht, dann andere
 * verwaltete Standorte desselben Kunden, dann persönlich zugeordnete
 * Personen. Belegte und abwesende Personen stehen mit Grund in ihrer Gruppe,
 * sind aber nicht wählbar. Hinweise wie eine fehlende Qualifikation ändern
 * die Reihenfolge nicht und verlangen genau eine Bestätigung.
 */
export function EmployeePicker({
  bookedUserIds,
  onSelect,
  onSelectContractor,
  shiftId,
  children,
  mode = "assign",
  heading,
}: EmployeePickerProps) {
  const replace = mode === "replace";
  const [open, setOpen] = useState(false);
  const nameFormat = useNameFormat();
  const [pending, setPending] = useState<Candidate | null>(null);
  const [pendingContractor, setPendingContractor] = useState<ContractorCandidate | null>(null);

  const { data, isLoading, error } = useQuery<CandidateData>({
    queryKey: ["employees", "candidates", shiftId],
    queryFn: async () => {
      const res = await fetch("/api/shifts/" + shiftId + "/candidates");
      if (!res.ok) throw new Error("Fehler beim Laden der Mitarbeiter");
      return res.json();
    },
    enabled: open,
  });

  const candidates = data?.candidates ?? [];
  const bookedSet = new Set(bookedUserIds);
  const titles = data ? headings(data) : null;

  function handleSelect(candidate: Candidate) {
    if (!candidate.selectable || bookedSet.has(candidate.userId)) return;
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
            {heading && (
              <div className="border-b px-3 py-2 text-[12.5px] font-medium">{heading}</div>
            )}
            <CommandInput placeholder={replace ? "Ersatz suchen..." : "Mitarbeiter suchen..."} />
            <CommandList className="max-h-[360px]">
              {isLoading ? (
                <div className="flex items-center justify-center gap-2 py-4 text-xs text-muted-foreground">
                  <Loader2 className="size-3 animate-spin" />
                  Auswahl wird geladen
                </div>
              ) : (
                <CommandEmpty>Keine einplanbaren Mitarbeiter</CommandEmpty>
              )}
              {titles && ([1, 2, 3, 4, 5] as const).map((group) => {
                const list = candidates.filter((c) => c.group === group);
                if (!list.length) return null;
                return (
                  <CommandGroup key={group} heading={titles[group]}>
                    {list.map((c) => (
                      <CommandItem
                        key={c.userId}
                        value={`${c.firstName} ${c.lastName} ${c.userId}`}
                        onSelect={() => handleSelect(c)}
                        disabled={!c.selectable}
                        className={cn("items-start", !c.selectable && "opacity-70")}
                      >
                        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                          <div className="flex items-center gap-2">
                            <Avatar size="sm">
                              <AvatarFallback className="text-[9px]">
                                {getInitials(c.firstName, c.lastName)}
                              </AvatarFallback>
                            </Avatar>
                            <span className="truncate text-sm">
                              {formatName(c, nameFormat)}
                            </span>
                          </div>
                          <span className="flex items-start gap-1 pl-8 text-[11.5px] leading-snug text-muted-foreground">
                            {!c.selectable ? (
                              <Ban className="mt-px size-3 shrink-0" aria-hidden="true" />
                            ) : c.reasons.includes("Verfügbar eingetragen.") ? (
                              <CalendarCheck className="mt-px size-3 shrink-0" aria-hidden="true" />
                            ) : null}
                            {c.reasons.join(" ")}
                          </span>
                          {c.hints.length > 0 && (
                            <span className="flex items-start gap-1 pl-8 text-[11.5px] leading-snug text-warn">
                              <AlertTriangle className="mt-px size-3 shrink-0" aria-hidden="true" />
                              {c.hints.join(" ")}
                            </span>
                          )}
                        </div>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                );
              })}
              {error && <p role="alert" className="px-3 py-2 text-xs text-destructive">{error.message}</p>}
              {onSelectContractor && data?.admin && !!data.contractorWorkers?.length && (
                <CommandGroup heading="Subunternehmer · Platzhalter">
                  {data.contractorWorkers.map((worker) => (
                    <CommandItem
                      key={worker.id}
                      value={`${worker.subcontractor.name} ${worker.name} ${worker.id}`}
                      disabled={!worker.selectable}
                      className="items-start"
                      onSelect={() => {
                        if (!worker.selectable) return;
                        setOpen(false);
                        if (worker.confirm) setPendingContractor(worker);
                        else onSelectContractor(worker.id, false);
                      }}
                    >
                      <div className="flex min-w-0 flex-col gap-0.5">
                        <span className="text-sm">{worker.subcontractor.name} · {worker.name}</span>
                        <span className="text-[11.5px] text-muted-foreground">{worker.reasons.join(" ")}</span>
                        {worker.hints.length > 0 && <span className="text-[11.5px] text-warn">{worker.hints.join(" ")}</span>}
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
        open={pendingContractor !== null}
        onOpenChange={(value) => { if (!value) setPendingContractor(null); }}
        title="Subunternehmer trotz Hinweis einteilen?"
        description={pendingContractor ? `${pendingContractor.subcontractor.name} · ${pendingContractor.name}: ${pendingContractor.hints.join(" ")}` : ""}
        confirmLabel="Trotzdem einteilen"
        destructive={false}
        onConfirm={() => {
          if (pendingContractor) onSelectContractor?.(pendingContractor.id, true);
          setPendingContractor(null);
        }}
      />
      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(value) => {
          if (!value) setPending(null);
        }}
        title={replace ? "Trotz Hinweis wechseln?" : "Trotz Hinweis einteilen?"}
        description={
          pending
            ? `${formatName(pending, nameFormat)}: ${pending.hints.join(" ")} ${replace ? "Der Wechsel" : "Die Einteilung"} wird trotzdem gespeichert.`
            : ""
        }
        confirmLabel={replace ? "Trotzdem wechseln" : "Trotzdem einteilen"}
        destructive={false}
        onConfirm={() => {
          if (pending) onSelect(pending.userId, true);
          setPending(null);
        }}
      />
    </>
  );
}
