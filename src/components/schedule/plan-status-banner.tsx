"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, EyeOff, Loader2, PencilLine, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { StatusBadge } from "@/components/ui/status-badge";
import { cn } from "@/lib/utils";
import type { ScheduleAccess, ScheduleData, ScheduleStatus } from "@/types/schedule";
import { anzahl, PublishDialog } from "./publish-dialog";

/** Status eines Standortplans; ohne Lebenszyklus-Angabe (nur fuer die Planung geliefert) zaehlt isPublic. */
export function planStatus(schedule: Pick<ScheduleData, "isPublic" | "status">): ScheduleStatus {
  return schedule.status ?? (schedule.isPublic ? "PUBLISHED" : "DRAFT");
}

/** "12.10.2026, 14:35 Uhr" (Europe/Berlin). */
export function zeitpunkt(iso: string): string {
  return new Date(iso).toLocaleString("de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) + " Uhr";
}

/** Status-Badge in der Kopfzeile: "Entwurf", "Veröffentlicht" oder "In Bearbeitung". */
export function PlanStatusBadge({ schedule, klein = false }: { schedule: Pick<ScheduleData, "isPublic" | "status">; klein?: boolean }) {
  const status = planStatus(schedule);
  if (status === "EDITING") return <StatusBadge ton="hinweis" icon={PencilLine} klein={klein}>In Bearbeitung</StatusBadge>;
  return status === "PUBLISHED" ? <StatusBadge ton="ok" klein={klein}>Veröffentlicht</StatusBadge> : <StatusBadge ton="hinweis" icon={EyeOff} klein={klein}>Entwurf</StatusBadge>;
}

/** Folgen der Bearbeitung in einfachen Saetzen, mit Warnzeile fuer eine bereits begonnene Woche. */
export function BearbeitungsFolgen({ wocheBegonnen }: { wocheBegonnen: boolean }) {
  return (
    <div className="space-y-3">
      <ul className="list-disc space-y-1 pl-5">
        <li>Mitarbeitende sehen bis zur Veröffentlichung den bisherigen Stand.</li>
        <li>Anträge und Tausch für diese Woche sind so lange gesperrt.</li>
        <li>Check-ins und Zeiterfassung laufen normal weiter.</li>
        <li>Eingeteilte erhalten erst beim Veröffentlichen eine gesammelte Mitteilung.</li>
        <li>Alle Änderungen lassen sich wieder verwerfen.</li>
      </ul>
      {wocheBegonnen && (
        <p className="flex gap-2 border-l-4 border-warn bg-warn/10 px-3 py-2 font-medium">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warn" aria-hidden="true" />
          Diese Woche hat bereits begonnen: Bereits begonnene Schichten werden beim Verwerfen nicht zurückgesetzt.
        </p>
      )}
    </div>
  );
}

/** Folgen des Verwerfens. */
export function VerwerfenFolgen() {
  return (
    <ul className="list-disc space-y-1 pl-5">
      <li>Bereits begonnene Schichten bleiben unverändert.</li>
      <li>Während der Bearbeitung neu angelegte Schichten verschwinden.</li>
      <li>Mitarbeitende erhalten keine Mitteilung; Anträge und Tausch sind danach wieder möglich.</li>
      <li>Die verworfenen Änderungen lassen sich nicht wiederherstellen.</li>
    </ul>
  );
}

type Verworfen = { restored: number; removed: number; skipped: number };

/** Ergebnis des Verwerfens in Worten. */
export function verworfenText({ restored, removed, skipped }: Verworfen): string {
  const teile = [
    restored ? anzahl(restored, "Schicht", "Schichten") + " wiederhergestellt" : "",
    removed ? anzahl(removed, "neue Schicht", "neue Schichten") + " entfernt" : "",
    skipped ? anzahl(skipped, "Schicht", "Schichten") + " unverändert (bereits begonnen oder mit Check-in)" : "",
  ].filter(Boolean);
  return teile.length ? teile.join(", ") + "." : "Es gab keine Änderungen.";
}

/**
 * Bearbeitung eines veroeffentlichten Plans starten - ein Knopf, eine
 * Rueckfrage mit den Folgen. Recht "Schichten bearbeiten" prueft der Server.
 * Im Kopf des veroeffentlichten Plans ist er die Hauptaktion (variant default).
 */
export function BearbeitungStarten({ scheduleId, wochenLabel, wochenbeginn, variant = "outline", className }: { scheduleId: string; wochenLabel: string; wochenbeginn: Date; variant?: "default" | "outline"; className?: string }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  // Erst beim Oeffnen pruefen, ob die Woche schon begonnen hat (Montag 00:00).
  const [begonnen, setBegonnen] = useState(false);
  function wechsel(value: boolean) {
    if (value) setBegonnen(Date.now() >= wochenbeginn.getTime());
    setOpen(value);
  }
  const mutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/schedules/${scheduleId}/editing`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Die Bearbeitung konnte nicht gestartet werden.");
      return data as { notice?: string | null };
    },
    onSuccess: (data) => toast.success(wochenLabel + ": Bearbeitung gestartet", { description: data.notice ?? "Mitarbeitende sehen bis zur Veröffentlichung den bisherigen Stand." }),
    onError: (error: Error) => toast.error(error.message),
    onSettled: () => queryClient.invalidateQueries(),
  });

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={wechsel}
      title="Bearbeitung starten?"
      description={`${wochenLabel} wird überarbeitet. Änderungen werden erst mit „Änderungen veröffentlichen“ für Mitarbeitende sichtbar.`}
      details={<BearbeitungsFolgen wocheBegonnen={begonnen} />}
      confirmLabel="Bearbeitung starten"
      destructive={false}
      disabled={mutation.isPending}
      onConfirm={() => mutation.mutate()}
    >
      <Button variant={variant} size="sm" className={cn("gap-1.5", className)} disabled={mutation.isPending}>
        {mutation.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <PencilLine className="size-3.5" />}
        Bearbeitung starten
      </Button>
    </ConfirmDialog>
  );
}

/** Verwerfen: veroeffentlichten Stand wiederherstellen (Recht "Dienstplan veroeffentlichen"). */
function VerwerfenKnopf({ scheduleId, wochenLabel, seit }: { scheduleId: string; wochenLabel: string; seit: string | null }) {
  const queryClient = useQueryClient();
  const mutation = useMutation<Verworfen, Error & { conflicts?: string[] }>({
    mutationFn: async () => {
      const res = await fetch(`/api/schedules/${scheduleId}/editing`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw Object.assign(new Error(data.error || "Verwerfen fehlgeschlagen."), { conflicts: Array.isArray(data.conflicts) ? (data.conflicts as string[]) : [] });
      return data as Verworfen;
    },
    onSuccess: (data) => toast.success(wochenLabel + ": Änderungen verworfen", { description: verworfenText(data) }),
    onError: (error) => {
      if (!error.conflicts?.length) return toast.error(error.message);
      // Ueberschneidungen als Liste statt als langer Satz; bleibt laenger stehen.
      toast.error("Verwerfen nicht möglich – die Wiederherstellung ergäbe Überschneidungen:", {
        description: (
          <div className="space-y-1">
            <ul className="list-disc space-y-0.5 pl-4">
              {error.conflicts.map((c, i) => <li key={i}>{c}</li>)}
            </ul>
            <p>Bitte zuerst die andere Schicht der Person ändern und dann erneut verwerfen.</p>
          </div>
        ),
        duration: 20000,
      });
    },
    onSettled: () => queryClient.invalidateQueries(),
  });

  return (
    <ConfirmDialog
      title="Änderungen verwerfen?"
      description={`Der veröffentlichte Stand vom ${seit ? zeitpunkt(seit) : "Beginn der Bearbeitung"} wird wiederhergestellt.`}
      details={<VerwerfenFolgen />}
      confirmLabel="Verwerfen"
      destructive
      disabled={mutation.isPending}
      onConfirm={() => mutation.mutate()}
    >
      <Button variant="outline" className="w-full gap-1.5 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive sm:w-auto" disabled={mutation.isPending}>
        {mutation.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Undo2 className="size-3.5" />}
        Verwerfen
      </Button>
    </ConfirmDialog>
  );
}

/**
 * Statusbalken ueber dem Wochenraster, nur fuer die Planung: Entwurf (mit
 * Schichten) oder in Bearbeitung - mit einem Satz, was Mitarbeitende gerade
 * sehen, und den passenden Aktionen. Veroeffentlicht: kein Balken, nur das
 * Badge in der Kopfzeile.
 */
export function PlanStatusBanner({ schedule, access, standort }: { schedule: ScheduleData | null; access?: ScheduleAccess; standort: string }) {
  if (!schedule?.id || !(access?.planner || access?.edit || access?.publish)) return null;
  const status = planStatus(schedule);
  if (status === "PUBLISHED" || (status === "DRAFT" && schedule.shifts.length === 0)) return null;
  const bearbeitung = status === "EDITING";
  const wochenLabel = "KW " + String(schedule.weekNumber).padStart(2, "0") + "/" + schedule.year;
  const Icon = bearbeitung ? PencilLine : EyeOff;

  return (
    <div role="status" className="mb-4 flex flex-col gap-3 rounded-r-[var(--radius)] border-l-4 border-warn bg-warn/10 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 gap-3">
        <Icon className="mt-0.5 size-5 shrink-0 text-warn" aria-hidden="true" />
        <div className="min-w-0 space-y-1">
          <p className="text-[15px] leading-snug font-semibold">{bearbeitung ? "Dienstplan ist in Bearbeitung" : "Entwurf – für Mitarbeitende unsichtbar"}</p>
          <p className="text-[13px] leading-5">
            {bearbeitung
              ? `Mitarbeitende sehen weiterhin den Stand vom ${schedule.editingSince ? zeitpunkt(schedule.editingSince) : "Beginn der Bearbeitung"}; Anträge und Tausch sind bis zur Veröffentlichung gesperrt.`
              : "Gespeicherte Schichten sind erst nach dem Veröffentlichen sichtbar; jede Woche und jeder Standort wird einzeln veröffentlicht."}
          </p>
          {bearbeitung && schedule.editingBy && <p className="text-[13px] leading-5 text-muted-foreground">Begonnen von {schedule.editingBy.name}</p>}
          {!access?.publish && (
            <p className="text-[13px] leading-5 text-muted-foreground">
              {bearbeitung ? "Veröffentlichen oder Verwerfen" : "Veröffentlichen"} darf nur, wer das Recht „Dienstplan veröffentlichen“ hat.
            </p>
          )}
        </div>
      </div>
      {access?.publish && (
        <div className="flex flex-col-reverse gap-2 sm:shrink-0 sm:flex-row">
          {bearbeitung && <VerwerfenKnopf scheduleId={schedule.id} wochenLabel={wochenLabel} seit={schedule.editingSince ?? null} />}
          <PublishDialog
            scheduleId={schedule.id}
            wochenLabel={wochenLabel}
            status={status}
            woche={{ weekNumber: schedule.weekNumber, year: schedule.year, standort }}
            label={bearbeitung ? "Änderungen veröffentlichen" : "Veröffentlichen"}
            className="w-full sm:w-auto"
          />
        </div>
      )}
    </div>
  );
}
