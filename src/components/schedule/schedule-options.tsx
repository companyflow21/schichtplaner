"use client";

import { useState, useCallback, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  EyeOff,
  Filter,
  Settings2,
  FileText,
  Layout,
  Type,
  Pause,
  Loader2,
  Trash2,
  Save,
  Send,
  Sparkles,
  Undo2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Textarea } from "@/components/ui/textarea";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
  DropdownMenuCheckboxItem,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import type { ScheduleData, ScheduleLayout, BriefingData, DivisionOption } from "@/types/schedule";

interface ScheduleOptionsProps {
  schedule: ScheduleData;
  isManager: boolean;
  divisionFilter: string | null;
  onDivisionFilterChange: (divisionId: string | null) => void;
}

export function ScheduleOptions({
  schedule,
  isManager,
  divisionFilter,
  onDivisionFilterChange,
}: ScheduleOptionsProps) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      {/* Sichtbarkeit */}
      {isManager && (
        <VisibilityToggle
          scheduleId={schedule.id}
          isPublic={schedule.isPublic}
        />
      )}

      {/* Non-manager visibility badge (read-only) */}
      {!isManager && (
        <Badge variant="secondary" className="gap-1.5">
          {schedule.isPublic ? (
            <>
              <span className="size-1.5 rounded-full bg-ok" />
              Veröffentlicht
            </>
          ) : (
            <>
              <EyeOff className="size-3" />
              Entwurf
            </>
          )}
        </Badge>
      )}

      {/* Bereich filter */}
      <DivisionFilter
        scheduleId={schedule.id}
        divisionFilter={divisionFilter}
        onDivisionFilterChange={onDivisionFilterChange}
      />

      {/* Optionen */}
      {isManager && (
        <OptionsMenu
          scheduleId={schedule.id}
          settingsLayout={schedule.settingsLayout}
          showTitle={schedule.showTitle}
          showPauses={schedule.showPauses}
        />
      )}

      {/* Briefing */}
      <BriefingButton
        scheduleId={schedule.id}
        isManager={isManager}
      />

      {/* KI-Briefing */}
      {isManager && (
        <AiBriefingButton scheduleId={schedule.id} />
      )}
    </div>
  );
}

// ─── Veröffentlichen / Zurückziehen ────────────────────────────────

/**
 * Ein Entwurf wird mit einem Klick veröffentlicht, ein veröffentlichter Plan
 * zurückgezogen. Beides benachrichtigt das Team - deshalb eine kurze
 * Rückfrage. Das Recht prüft der Server.
 */
export function VisibilityToggle({
  scheduleId,
  isPublic,
  wochenLabel = "Dienstplan",
  hauptaktion = true,
  className,
}: {
  scheduleId: string;
  isPublic: boolean;
  /** Zum Beispiel "KW 40" - steht in der Rückfrage. */
  wochenLabel?: string;
  /** Veröffentlichen als blaue Hauptaktion oder als Nebenaktion. */
  hauptaktion?: boolean;
  className?: string;
}) {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async (newValue: boolean) => {
      const res = await fetch(`/api/schedules/${scheduleId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isPublic: newValue }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || (newValue ? "Veröffentlichen fehlgeschlagen" : "Zurückziehen fehlgeschlagen"));
      return data;
    },
    onSuccess: (_data, newValue) => {
      toast.success(newValue ? `${wochenLabel} veröffentlicht` : `${wochenLabel} zurückgezogen`);
      queryClient.invalidateQueries();
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  if (isPublic) {
    return (
      <ConfirmDialog
        title={`${wochenLabel} zurückziehen?`}
        description="Mitarbeitende sehen den Plan danach nicht mehr und werden benachrichtigt."
        confirmLabel="Zurückziehen"
        destructive={false}
        disabled={mutation.isPending}
        onConfirm={() => mutation.mutate(false)}
      >
        <Button variant="outline" size="sm" className={cn("gap-1.5", className)} disabled={mutation.isPending}>
          {mutation.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Undo2 className="size-3.5" />}
          Veröffentlichung zurückziehen
        </Button>
      </ConfirmDialog>
    );
  }

  return (
    <ConfirmDialog
      title={`${wochenLabel} veröffentlichen?`}
      description="Mitarbeitende sehen den Plan danach und werden benachrichtigt."
      confirmLabel="Veröffentlichen"
      destructive={false}
      disabled={mutation.isPending}
      onConfirm={() => mutation.mutate(true)}
    >
      <Button variant={hauptaktion ? "default" : "outline"} size="sm" className={cn("gap-1.5", className)} disabled={mutation.isPending}>
        {mutation.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
        Veröffentlichen
      </Button>
    </ConfirmDialog>
  );
}

// ─── Division Filter ────────────────────────────────────────────────

export function DivisionFilter({
  scheduleId,
  divisionFilter,
  onDivisionFilterChange,
}: {
  scheduleId: string;
  divisionFilter: string | null;
  onDivisionFilterChange: (divisionId: string | null) => void;
}) {
  const { data } = useQuery<{ divisions: DivisionOption[] }>({
    queryKey: ["divisions"],
    queryFn: async () => {
      const res = await fetch("/api/divisions");
      if (!res.ok) throw new Error("Fehler beim Laden der Bereiche");
      return res.json();
    },
  });

  const divisions = data?.divisions ?? [];
  const selectedDivision = divisions.find((d) => d.id === divisionFilter);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <Filter className="size-3.5" />
          {selectedDivision ? (
            <>
              <span
                className="size-2 rounded-full"
                style={{ backgroundColor: selectedDivision.color }}
              />
              {selectedDivision.title}
            </>
          ) : (
            "Bereich"
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuLabel>Bereich filtern</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() => onDivisionFilterChange(null)}
          className={cn(!divisionFilter && "font-semibold")}
        >
          Alle
        </DropdownMenuItem>
        {divisions
          .filter((d) => !("isSystem" in d && d.isSystem))
          .map((division) => (
            <DropdownMenuItem
              key={division.id}
              onClick={() => onDivisionFilterChange(division.id)}
              className={cn(
                "gap-2",
                divisionFilter === division.id && "font-semibold"
              )}
            >
              <span
                className="size-2.5 rounded-full shrink-0"
                style={{ backgroundColor: division.color }}
              />
              {division.title}
            </DropdownMenuItem>
          ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ─── Options Menu ───────────────────────────────────────────────────

export function OptionsMenu({
  scheduleId,
  settingsLayout,
  showTitle,
  showPauses,
}: {
  scheduleId: string;
  settingsLayout: ScheduleLayout;
  showTitle: boolean;
  showPauses: boolean;
}) {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      const res = await fetch(`/api/schedules/${scheduleId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Fehler beim Aktualisieren");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["schedule"] });
    },
    onError: () => {
      toast.error("Fehler beim Speichern");
    },
  });

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <Settings2 className="size-3.5" />
          Optionen
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuLabel>Anzeige</DropdownMenuLabel>
        <DropdownMenuSeparator />

        {/* Layout Toggle */}
        <DropdownMenuCheckboxItem
          checked={settingsLayout === "LAYOUT_1"}
          onCheckedChange={() =>
            mutation.mutate({ settingsLayout: "LAYOUT_1" })
          }
        >
          <Layout className="size-3.5" />
          Schlichte Karten
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem
          checked={settingsLayout === "LAYOUT_2"}
          onCheckedChange={() =>
            mutation.mutate({ settingsLayout: "LAYOUT_2" })
          }
        >
          <Layout className="size-3.5" />
          Farbrand nach Bereich
        </DropdownMenuCheckboxItem>

        <DropdownMenuSeparator />

        {/* Show/hide titles */}
        <DropdownMenuCheckboxItem
          checked={showTitle}
          onCheckedChange={(checked) =>
            mutation.mutate({ showTitle: checked })
          }
        >
          <Type className="size-3.5" />
          Titel anzeigen
        </DropdownMenuCheckboxItem>

        {/* Show/hide pauses */}
        <DropdownMenuCheckboxItem
          checked={showPauses}
          onCheckedChange={(checked) =>
            mutation.mutate({ showPauses: checked })
          }
        >
          <Pause className="size-3.5" />
          Pausen anzeigen
        </DropdownMenuCheckboxItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ─── Briefing Button + Sheet ────────────────────────────────────────

export function BriefingButton({
  scheduleId,
  isManager,
}: {
  scheduleId: string;
  isManager: boolean;
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [initialText, setInitialText] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Fetch briefing
  const { data, isLoading } = useQuery<{ briefing: BriefingData | null }>({
    queryKey: ["briefing", scheduleId],
    queryFn: async () => {
      const res = await fetch(`/api/schedules/${scheduleId}/briefing`);
      if (!res.ok) throw new Error("Fehler beim Laden");
      return res.json();
    },
    enabled: !!scheduleId,
  });

  const briefing = data?.briefing ?? null;
  const hasBriefing = !!briefing;

  function changeBriefingOpen(next: boolean) {
    if (next) {
      const t = briefing?.text ?? "";
      setText(t);
      setInitialText(t);
    }
    setOpen(next);
  }

  // Auto-resize textarea
  const handleTextChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setText(e.target.value);
      // Auto-resize
      const el = e.target;
      el.style.height = "auto";
      el.style.height = el.scrollHeight + "px";
    },
    []
  );

  // Save mutation
  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/schedules/${scheduleId}/briefing`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Fehler beim Speichern");
      }
      return res.json();
    },
    onSuccess: () => {
      toast.success("Briefing gespeichert");
      queryClient.invalidateQueries({ queryKey: ["briefing", scheduleId] });
      setInitialText(text);
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/schedules/${scheduleId}/briefing`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Löschen fehlgeschlagen");
      return res.json();
    },
    onSuccess: () => {
      toast.success("Briefing gelöscht");
      queryClient.invalidateQueries({ queryKey: ["briefing", scheduleId] });
      setText("");
      setInitialText("");
    },
    onError: () => {
      toast.error("Briefing konnte nicht gelöscht werden");
    },
  });

  const hasChanges = text !== initialText;
  const isPending = saveMutation.isPending || deleteMutation.isPending;

  return (
    <Sheet open={open} onOpenChange={changeBriefingOpen}>
      <SheetTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn("gap-1.5", hasBriefing && "border-primary/40 text-primary")}
        >
          <FileText className="size-3.5" />
          Briefing
          {hasBriefing && <span className="sr-only"> (vorhanden)</span>}
          {hasBriefing && (
            <span aria-hidden="true" className="size-1.5 rounded-full bg-primary" />
          )}
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="flex flex-col">
        <SheetHeader>
          <SheetTitle>Wochen-Briefing</SheetTitle>
          <SheetDescription>
            Hinweise für diese Woche. Sichtbar für alle Mitarbeitenden.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 px-4 overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : isManager ? (
            <Textarea
              ref={textareaRef}
              value={text}
              onChange={handleTextChange}
              placeholder="Briefing-Text eingeben …"
              className="min-h-[200px] resize-none"
              disabled={isPending}
            />
          ) : briefing ? (
            <div className="whitespace-pre-wrap text-sm leading-relaxed">
              {briefing.text}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-8">
              Kein Briefing für diese Woche.
            </p>
          )}
        </div>

        {isManager && (
          <SheetFooter className="flex-row gap-2">
            {hasBriefing && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  if (confirm("Briefing wirklich löschen?")) {
                    deleteMutation.mutate();
                  }
                }}
                disabled={isPending}
                className="text-destructive hover:text-destructive"
              >
                {deleteMutation.isPending ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Trash2 className="size-3.5" />
                )}
                Löschen
              </Button>
            )}
            <Button
              size="sm"
              onClick={() => saveMutation.mutate()}
              disabled={isPending || !text.trim() || !hasChanges}
              className="ml-auto"
            >
              {saveMutation.isPending ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Save className="size-3.5" />
              )}
              Speichern
            </Button>
          </SheetFooter>
        )}
      </SheetContent>
    </Sheet>
  );
}

// ─── AI Briefing Button ─────────────────────────────────────────────

export function AiBriefingButton({ scheduleId }: { scheduleId: string }) {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async (): Promise<{ text: string }> => {
      const res = await fetch("/api/ai/briefing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scheduleId }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Fehler beim Generieren");
      }
      return res.json();
    },
    onSuccess: async (data) => {
      // Save the generated text as the briefing
      const res = await fetch(`/api/schedules/${scheduleId}/briefing`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: data.text }),
      });
      if (res.ok) {
        queryClient.invalidateQueries({ queryKey: ["briefing", scheduleId] });
        toast.success("KI-Briefing erstellt und gespeichert");
      } else {
        toast.success("KI-Briefing erstellt (manuell speichern)");
      }
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => mutation.mutate()}
      disabled={mutation.isPending}
      className="gap-1.5 border-primary/30 text-primary hover:bg-accent"
    >
      {mutation.isPending ? (
        <Loader2 className="size-3.5 animate-spin" />
      ) : (
        <Sparkles className="size-3.5" />
      )}
      KI-Briefing
    </Button>
  );
}
