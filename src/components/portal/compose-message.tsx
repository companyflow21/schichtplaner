"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Send, X, Check } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
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
import { cn } from "@/lib/utils";
import { toast } from "sonner";

/** Moegliche Empfaenger - der Server liefert nur Personen, die man sehen darf, bereits gruppiert. */
interface Recipient {
  id: string;
  firstName: string;
  lastName: string;
  profileImage: string | null;
  role: string;
  group: "zustaendig" | "administration" | "weitere";
}

interface ReferenceShift {
  id: string;
  date: string;
  shiftFrom: string;
  shiftTo: string;
  title: string | null;
  branchName: string | null;
}
interface ReferenceBranch {
  id: string;
  name: string;
}

const rollen: Record<string, string> = { OWNER: "Inhaber", ADMIN: "Administration", MANAGER: "Manager" };
const gruppen: Record<Recipient["group"], string> = { zustaendig: "Zustaendig", administration: "Administration", weitere: "Weitere" };
const GRUPPEN_REIHENFOLGE: Recipient["group"][] = ["zustaendig", "administration", "weitere"];
// getUTCDay(): 0=So..6=Sa - auf Mo..So gedreht.
const WOCHENTAGE = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];

interface Props {
  shiftId?: string;
  branchId?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultRecipientIds?: string[];
  defaultSubject?: string;
}

export function ComposeMessage({ open, onOpenChange, defaultRecipientIds, defaultSubject, shiftId, branchId }: Props) {
  const queryClient = useQueryClient();
  const [recipientIds, setRecipientIds] = useState<string[]>(defaultRecipientIds ?? []);
  const [subject, setSubject] = useState(defaultSubject ?? "");
  const [body, setBody] = useState("");
  const [recipientPickerOpen, setRecipientPickerOpen] = useState(false);
  const [reference, setReference] = useState<string>(shiftId ? `shift:${shiftId}` : branchId ? `branch:${branchId}` : "none");
  const [showResponsibleHint, setShowResponsibleHint] = useState(false);

  const { data: recipientData } = useQuery<{ recipients: Recipient[]; noResponsible: boolean }>({
    queryKey: ["message-recipients"],
    queryFn: async () => {
      const res = await fetch("/api/messages/recipients");
      if (!res.ok) throw new Error("Empfänger konnten nicht geladen werden.");
      return res.json();
    },
    enabled: open,
  });

  const { data: referenceData } = useQuery<{ branches: ReferenceBranch[]; shifts: ReferenceShift[] }>({
    queryKey: ["message-references"],
    queryFn: async () => {
      const res = await fetch("/api/messages/references");
      if (!res.ok) throw new Error("Bezuege konnten nicht geladen werden.");
      return res.json();
    },
    enabled: open,
  });

  const employees = recipientData?.recipients ?? [];
  const noResponsible = recipientData?.noResponsible ?? false;
  const zustaendig = employees.filter((e) => e.group === "zustaendig");
  const administration = employees.filter((e) => e.group === "administration");
  const groupedEmployees = GRUPPEN_REIHENFOLGE.map((group) => ({ group, items: employees.filter((e) => e.group === group) })).filter((g) => g.items.length > 0);

  const referenceBranches = referenceData?.branches ?? [];
  const referenceShifts = referenceData?.shifts ?? [];

  const sendMutation = useMutation({
    mutationFn: async () => {
      const isShift = reference.startsWith("shift:");
      const isBranch = reference.startsWith("branch:");
      const res = await fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject,
          body,
          recipientIds,
          shiftId: isShift ? reference.slice("shift:".length) : undefined,
          branchId: isBranch ? reference.slice("branch:".length) : undefined,
        }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Fehler beim Senden");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["messages"] });
      toast.success("Nachricht gesendet");
      resetForm();
      onOpenChange(false);
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  function resetForm() {
    setRecipientIds([]);
    setSubject("");
    setBody("");
    setReference(shiftId ? `shift:${shiftId}` : branchId ? `branch:${branchId}` : "none");
    setShowResponsibleHint(false);
  }

  function selectResponsible() {
    if (zustaendig.length > 0) {
      setRecipientIds(zustaendig.map((e) => e.id));
      setShowResponsibleHint(false);
    } else if (noResponsible) {
      setRecipientIds(administration.map((e) => e.id));
      setShowResponsibleHint(true);
    }
  }

  function toggleRecipient(userId: string) {
    setRecipientIds((prev) =>
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]
    );
  }

  function removeRecipient(userId: string) {
    setRecipientIds((prev) => prev.filter((id) => id !== userId));
  }

  const selectedEmployees = employees.filter((e) => recipientIds.includes(e.id));

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) resetForm(); onOpenChange(o); }}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Neue Nachricht</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Recipients */}
          <div>
            <Label>Empfaenger</Label>
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
              {(zustaendig.length > 0 || noResponsible) && (
                <Button type="button" size="sm" variant="ghost" onClick={selectResponsible}>An Zustaendige</Button>
              )}
              {employees.length > 1 && <Button type="button" size="sm" variant="ghost" onClick={() => setRecipientIds(employees.map(e => e.id))}>Alle {employees.length} auswählen</Button>}
            </div>
            {showResponsibleHint && (
              <p className="mt-1 text-xs text-muted-foreground">Kein zustaendiger Manager hinterlegt – die Administration ist dein Ansprechpartner.</p>
            )}
            <div className="mt-1.5">
              <Popover open={recipientPickerOpen} onOpenChange={setRecipientPickerOpen}>
                <PopoverTrigger asChild>
                  <div className="flex min-h-10 flex-wrap items-center gap-1.5 rounded-md border px-3 py-2 cursor-pointer hover:border-primary/40">
                    {selectedEmployees.length === 0 ? (
                      <span className="text-sm text-muted-foreground">Empfaenger auswaehlen...</span>
                    ) : (
                      selectedEmployees.map((emp) => (
                        <Badge key={emp.id} variant="secondary" className="gap-1">
                          {emp.firstName} {emp.lastName}
                          <button
                            aria-label={`${emp.firstName} ${emp.lastName} entfernen`}
                            onClick={(e) => {
                              e.stopPropagation();
                              removeRecipient(emp.id);
                            }}
                            className="ml-0.5 hover:text-destructive"
                          >
                            <X className="size-3" />
                          </button>
                        </Badge>
                      ))
                    )}
                  </div>
                </PopoverTrigger>
                <PopoverContent className="w-80 p-0" align="start">
                  <Command>
                    <CommandInput placeholder="Mitarbeiter suchen..." />
                    <CommandList>
                      <CommandEmpty>Keine passende Person.</CommandEmpty>
                      {groupedEmployees.map(({ group, items }) => (
                        <CommandGroup key={group} heading={gruppen[group]}>
                          {items.map((emp) => (
                            <CommandItem
                              key={emp.id}
                              value={`${emp.firstName} ${emp.lastName} ${emp.id}`}
                              onSelect={() => toggleRecipient(emp.id)}
                            >
                              <Check
                                className={cn(
                                  "mr-2 size-4",
                                  recipientIds.includes(emp.id) ? "opacity-100" : "opacity-0"
                                )}
                              />
                              <div>
                                <div className="text-sm font-medium">
                                  {emp.firstName} {emp.lastName}
                                </div>
                                {rollen[emp.role] && <div className="text-xs text-muted-foreground">{rollen[emp.role]}</div>}
                              </div>
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      ))}
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>
          </div>

          {/* Subject */}
          <div>
            <Label>Betreff</Label>
            <Input
              className="mt-1.5"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Betreff eingeben..."
            />
          </div>

          {/* Body */}
          <div>
            <Label>Nachricht</Label>
            <Textarea
              className="mt-1.5 min-h-[160px]"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Nachricht schreiben..."
            />
          </div>

          {/* Bezug */}
          {(referenceBranches.length > 0 || referenceShifts.length > 0) && (
            <div>
              <Label htmlFor="compose-bezug">Bezug</Label>
              <select
                id="compose-bezug"
                className="mt-1.5 flex h-10 w-full rounded-md border bg-transparent px-3 py-2 text-sm"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
              >
                <option value="none">Kein Bezug</option>
                {referenceBranches.length > 0 && (
                  <optgroup label="Standort">
                    {referenceBranches.map((b) => (
                      <option key={b.id} value={`branch:${b.id}`}>{b.name}</option>
                    ))}
                  </optgroup>
                )}
                {referenceShifts.length > 0 && (
                  <optgroup label="Schicht">
                    {referenceShifts.map((s) => (
                      <option key={s.id} value={`shift:${s.id}`}>
                        {WOCHENTAGE[new Date(s.date + "T12:00:00Z").getUTCDay()]} {s.date.slice(8, 10)}.{s.date.slice(5, 7)}. {s.shiftFrom}–{s.shiftTo}{s.branchName ? ` · ${s.branchName}` : ""}{s.title ? ` (${s.title})` : ""}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => { resetForm(); onOpenChange(false); }}>
              Abbrechen
            </Button>
            <Button
              onClick={() => sendMutation.mutate()}
              disabled={!subject.trim() || !body.trim() || recipientIds.length === 0 || sendMutation.isPending}
              className="gap-2"
            >
              <Send className="size-4" />
              {sendMutation.isPending ? "Sende..." : "Senden"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
