"use client";

import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { de } from "react-day-picker/locale";
import { toast } from "sonner";
import { AlertTriangle, Ban, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { StatusBadge } from "@/components/ui/status-badge";
import { json, dateLabel, ErrorMessage } from "@/components/workforce/client";
import type { ShiftData, ShiftPreview } from "@/types/schedule";

const post = (url: string, data: unknown) =>
  json<ShiftPreview & { shifts?: unknown[] }>(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });

/** Kurzliste einer Vorschau: Tag, Zeit, Folgetag, gleiche Schicht, Konflikte und Hinweise je Person. */
export function ShiftPreviewList({ preview }: { preview: ShiftPreview }) {
  return (
    <ul className="max-h-60 divide-y overflow-y-auto rounded-[var(--radius)] border text-[13px]">
      {preview.occurrences.map((o) => {
        const conflicts = preview.conflicts.filter((c) => c.date === o.date);
        const warnings = preview.warnings.filter((w) => w.date === o.date);
        return (
          <li key={o.date} className="space-y-1 px-3 py-2">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="tabular font-medium">{dateLabel(o.date)}</span>
              <span className="tabular text-muted-foreground">
                {o.shiftFrom}–{o.shiftTo}
              </span>
              {o.endsNextDay && <span className="text-[12px] text-muted-foreground">endet am Folgetag</span>}
              {o.duplicate && <StatusBadge ton="hinweis" klein>gleiche Schicht vorhanden</StatusBadge>}
            </div>
            {conflicts.map((c) => (
              <p key={"c" + c.userId} className="flex items-start gap-1 text-[12.5px] text-destructive">
                <Ban className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
                <span>
                  <span className="font-medium">{c.name}:</span> {c.reasons.join(" ")}
                </span>
              </p>
            ))}
            {warnings.map((w) => (
              <p key={"w" + w.userId} className="flex items-start gap-1 text-[12.5px] text-warn">
                <AlertTriangle className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
                <span>
                  <span className="font-medium">{w.name}:</span> {w.reasons.join(" ")}
                </span>
              </p>
            ))}
          </li>
        );
      })}
    </ul>
  );
}

/** Abschluss einer Vorschau: Konflikte sperren, Hinweise verlangen genau eine Bestätigung. */
export function PreviewSummary({
  preview,
  confirmed,
  onConfirmedChange,
  idPrefix,
}: {
  preview: ShiftPreview;
  confirmed: boolean;
  onConfirmedChange: (value: boolean) => void;
  idPrefix: string;
}) {
  if (preview.conflicts.length) {
    return (
      <p role="alert" className="text-[13px] text-destructive">
        {preview.conflicts.length === 1 ? "Ein Konflikt" : preview.conflicts.length + " Konflikte"} – so wird nichts angelegt. Tage
        oder Personen ändern.
      </p>
    );
  }
  if (!preview.warnings.length) return null;
  return (
    <label htmlFor={idPrefix + "-hinweise"} className="flex items-start gap-2 text-[13px]">
      <Checkbox id={idPrefix + "-hinweise"} checked={confirmed} onCheckedChange={(v) => onConfirmedChange(v === true)} className="mt-0.5" />
      <span>Hinweise gelesen – trotzdem einteilen</span>
    </label>
  );
}

interface CopyShiftDialogProps {
  shift: ShiftData;
  open: boolean;
  onOpenChange: (value: boolean) => void;
  /** Nach dem Anlegen, etwa um ein umgebendes Formular zu schliessen. */
  onDone?: () => void;
}

/**
 * Schicht auf mehrere Tage kopieren (gleicher Standort): Zeiten, Pause,
 * Plätze, Tätigkeit, Hinweise, Qualifikationen und Arbeitsbereich; auf
 * Wunsch auch die Einteilungen. Vor dem Anlegen zeigt eine Vorschau jeden
 * Tag mit Konflikten; gespeichert wird alles oder nichts.
 */
export function CopyShiftDialog({ shift, open, onOpenChange, onDone }: CopyShiftDialogProps) {
  const queryClient = useQueryClient();
  const [days, setDays] = useState<Date[]>([]);
  const [withAssignments, setWithAssignments] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const busy = useRef(false);
  const dates = days.map((d) => format(d, "yyyy-MM-dd")).sort();
  const assigned = shift.bookings.filter((b) => b.userId).length;
  const url = "/api/shifts/" + shift.id + "/copy";

  const preview = useQuery({
    queryKey: ["shift-copy-preview", shift.id, dates.join(","), withAssignments],
    queryFn: () => post(url, { dates, withAssignments, preview: true }),
    enabled: open && dates.length > 0,
    retry: false,
  });

  const create = useMutation({
    mutationFn: () => post(url, { dates, withAssignments, ...(confirmed ? { confirm: true } : {}) }),
    onSuccess: (result) => {
      const n = result.shifts?.length ?? dates.length;
      toast.success(n === 1 ? "1 Schicht angelegt" : n + " Schichten angelegt");
      queryClient.invalidateQueries();
      close(false);
      onDone?.();
    },
    onError: (error: Error) => {
      toast.error(error.message);
      preview.refetch();
    },
    onSettled: () => {
      busy.current = false;
    },
  });

  function close(value: boolean) {
    if (!value) {
      setDays([]);
      setWithAssignments(false);
      setConfirmed(false);
    }
    onOpenChange(value);
  }

  const data = dates.length ? preview.data : undefined;
  const blocked = !data || data.conflicts.length > 0 || (data.warnings.length > 0 && !confirmed);
  const disabled = !dates.length || preview.isFetching || create.isPending || blocked;

  function submit() {
    // Doppelklick: der zweite Aufruf kommt, bevor isPending gerendert ist.
    if (busy.current || disabled) return;
    busy.current = true;
    create.mutate();
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Schicht kopieren</DialogTitle>
          <DialogDescription>
            {shift.shiftFrom}–{shift.shiftTo}
            {shift.title ? " · " + shift.title : ""}
            {shift.branch ? " · " + shift.branch.name : ""}. Gleicher Standort; Zeiten, Pause, Plätze, Tätigkeit und Hinweise
            werden übernommen.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <p className="mb-1 text-[13px] font-medium">Zieltage{dates.length ? ` (${dates.length})` : ""}</p>
            <Calendar
              mode="multiple"
              selected={days}
              onSelect={(value) => {
                setDays(value ?? []);
                setConfirmed(false);
              }}
              max={62}
              locale={de}
              weekStartsOn={1}
              defaultMonth={shift.date ? new Date(shift.date + "T12:00:00") : undefined}
              className="rounded-[var(--radius)] border"
            />
          </div>

          <label className="flex items-center justify-between gap-3 text-[13px]">
            <span>
              Mitarbeiterzuweisungen übernehmen
              <span className="block text-[12px] text-muted-foreground">
                {assigned ? `${assigned} ${assigned === 1 ? "Person" : "Personen"} mit allen Prüfungen erneut einteilen` : "Die Schicht hat keine Zuweisungen."}
              </span>
            </span>
            <Switch
              checked={withAssignments}
              disabled={!assigned}
              onCheckedChange={(value) => {
                setWithAssignments(value);
                setConfirmed(false);
              }}
            />
          </label>

          {dates.length > 0 && (
            <div className="space-y-2" aria-live="polite">
              <p className="flex items-center gap-1.5 text-[13px] font-medium">
                Vorschau
                {preview.isFetching && <Loader2 className="size-3 animate-spin" aria-label="Vorschau wird geladen" />}
              </p>
              <ErrorMessage error={preview.error} />
              {data && (
                <>
                  <ShiftPreviewList preview={data} />
                  <PreviewSummary preview={data} confirmed={confirmed} onConfirmedChange={setConfirmed} idPrefix={"kopie-" + shift.id} />
                </>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:justify-end">
          <Button variant="outline" onClick={() => close(false)}>
            Abbrechen
          </Button>
          <Button onClick={submit} disabled={disabled}>
            {create.isPending && <Loader2 className="size-4 animate-spin" />}
            {dates.length === 1 ? "1 Schicht anlegen" : `${dates.length} Schichten anlegen`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
