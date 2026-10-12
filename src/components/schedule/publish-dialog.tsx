"use client";

import { useId, useRef, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, Ban, Check, Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { json } from "@/components/workforce/client";
import { formatKW } from "@/lib/utils/calendar";
import { cn } from "@/lib/utils";
import { useWeekConflicts } from "./conflict-panel";
import type { ScheduleDiffData, ScheduleDiffShift, ScheduleStatus } from "@/types/schedule";
import type { WeekConflicts } from "@/types/conflicts";

export type DiffResponse = { status: ScheduleStatus; diff: ScheduleDiffData };

/** "1 Person", "3 Personen" */
export function anzahl(n: number, eins: string, mehr: string): string {
  return n === 1 ? "1 " + eins : n + " " + mehr;
}

/** Erfolgsmeldung nach dem Veroeffentlichen. */
export function veröffentlichtText(wochenLabel: string, benachrichtigt: boolean, notified: number): string {
  if (!benachrichtigt) return wochenLabel + " veröffentlicht – ohne Benachrichtigung";
  return wochenLabel + " veröffentlicht – " + (notified ? anzahl(notified, "Person", "Personen") : "keine Person") + " benachrichtigt";
}

/**
 * Niemand bekaeme eine Mitteilung: in Bearbeitung ohne betroffene Person und
 * ohne neue offene Plaetze (oder bereits veroeffentlicht). Ein Entwurf
 * benachrichtigt dagegen alle, die den Plan sehen duerfen.
 */
export function keineMitteilung(data: DiffResponse): boolean {
  return data.status !== "DRAFT" && data.diff.affected.length === 0 && !data.diff.openPlacesAdded;
}

const SICHTBAR = 8;
const PANEL = 'section[aria-label="Konfliktprüfung"]';

function namen(s: ScheduleDiffShift): string {
  return s.people.map((p) => p.name).join(", ");
}

/** "Kai Konflikt, Lea Ruhig · 1 Platz offen" */
function besetzung(s: ScheduleDiffShift): string {
  const offen = s.openPlaces > 0 ? anzahl(s.openPlaces, "Platz offen", "Plätze offen") : "";
  return [namen(s) || "Niemand eingeteilt", offen].filter(Boolean).join(" · ");
}

function Kopf({ s }: { s: ScheduleDiffShift }) {
  return (
    <p className="font-medium">
      {s.label}
      {s.title && <span className="font-normal text-muted-foreground"> · {s.title}</span>}
    </p>
  );
}

/** Gruppe des Diffs mit Eintraegen oder "keine"; lange Listen aufklappbar. */
function Gruppe({ titel, eintraege }: { titel: string; eintraege: React.ReactNode[] }) {
  return (
    <section aria-label={titel}>
      <h3 className="text-[14px] font-semibold">
        {titel}
        {eintraege.length > 0 && <span className="font-normal text-muted-foreground"> ({eintraege.length})</span>}
      </h3>
      {eintraege.length === 0 ? (
        <p className="text-muted-foreground">keine</p>
      ) : (
        <>
          <ul className="divide-y">{eintraege.slice(0, SICHTBAR)}</ul>
          {eintraege.length > SICHTBAR && (
            <details>
              <summary className="cursor-pointer py-2 font-medium text-primary">{eintraege.length - SICHTBAR} weitere anzeigen</summary>
              <ul className="divide-y">{eintraege.slice(SICHTBAR)}</ul>
            </details>
          )}
        </>
      )}
    </section>
  );
}

/**
 * Inhalt des Veroeffentlichen-Dialogs: Neu / Geaendert / Entfallen,
 * Betroffene, Hinweise und die Benachrichtigungs-Checkbox. Ohne Abfragen,
 * damit er sich auch statisch pruefen laesst.
 */
export function PublishSummary({
  data,
  notify,
  onNotifyChange,
  konflikte,
  konflikteHref,
  onKonflikte,
}: {
  data: DiffResponse;
  notify: boolean;
  onNotifyChange: (value: boolean) => void;
  /** Zaehler der Konfliktpruefung dieser Woche, falls geladen. */
  konflikte?: WeekConflicts["counts"] | null;
  konflikteHref?: string;
  onKonflikte?: (event: React.MouseEvent<HTMLAnchorElement>) => void;
}) {
  const id = useId();
  const { status, diff } = data;
  const niemand = keineMitteilung(data);
  const senden = notify && !niemand;
  const betroffene = diff.affected.map((p) => p.name).sort((a, b) => a.localeCompare(b, "de"));
  const n = diff.added.length;
  const fehler = konflikte?.fehler ?? 0;
  const hinweis = konflikte?.hinweis ?? 0;

  const neu = diff.added.map((s) => (
    <li key={s.id} className="py-1.5">
      <Kopf s={s} />
      <p className="text-muted-foreground">{besetzung(s)}</p>
    </li>
  ));
  const geändert = diff.changed.map((c) => (
    <li key={c.shift.id} className="space-y-0.5 py-1.5">
      <Kopf s={c.after} />
      <p className="flex flex-wrap gap-1">
        {c.changes.map((t) => <StatusBadge key={t} ton="neutral">{t}</StatusBadge>)}
      </p>
      {c.before.label !== c.after.label && <p className="text-muted-foreground">vorher: {c.before.label}</p>}
      <p className="text-muted-foreground">
        {besetzung(c.after)}
        {c.changes.includes("Besetzung") && " (vorher: " + (namen(c.before) || "niemand") + ")"}
      </p>
    </li>
  ));
  const entfallen = diff.removed.map((s) => (
    <li key={s.id} className="py-1.5">
      <Kopf s={s} />
      <p className="text-muted-foreground">{besetzung(s)}</p>
      {s.movedTo && <p className="text-muted-foreground">Verlegt: jetzt {s.movedTo.label}</p>}
    </li>
  ));

  return (
    <div className="space-y-4 text-[13px] leading-5">
      {status === "DRAFT" && (
        <p className="text-[14px] font-semibold">
          {n === 0 ? "Erstveröffentlichung: Der Plan enthält noch keine Schichten." : n === 1 ? "Erstveröffentlichung: 1 Schicht ist neu" : `Erstveröffentlichung: alle ${n} Schichten sind neu`}
        </p>
      )}
      {status === "PUBLISHED" && <p className="font-medium">Der Plan ist bereits veröffentlicht – es gibt keine offenen Änderungen.</p>}

      <Gruppe titel="Neue Schichten" eintraege={neu} />
      <Gruppe titel="Geänderte Schichten" eintraege={geändert} />
      <Gruppe titel="Entfallene Schichten" eintraege={entfallen} />

      <p>
        <span className="font-semibold">Betroffene Personen: {betroffene.length}</span>
        {betroffene.length > 0 && " – " + betroffene.slice(0, 10).join(", ") + (betroffene.length > 10 ? ` + ${betroffene.length - 10} weitere` : "")}
      </p>

      {konflikte && (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {fehler + hinweis === 0 ? (
            <span className="flex items-center gap-1.5 font-medium text-ok"><Check className="size-4" aria-hidden="true" />Keine Konflikte in dieser Woche</span>
          ) : (
            <>
              <span className={cn("flex items-center gap-1.5 font-medium", fehler > 0 ? "text-destructive" : "text-warn")}>
                {fehler > 0 ? <Ban className="size-4" aria-hidden="true" /> : <AlertTriangle className="size-4" aria-hidden="true" />}
                {[fehler > 0 ? anzahl(fehler, "Konflikt", "Konflikte") : "", hinweis > 0 ? anzahl(hinweis, "Hinweis", "Hinweise") : ""].filter(Boolean).join(", ")} in dieser Woche
              </span>
              {konflikteHref && (
                <Link href={konflikteHref} onClick={onKonflikte} className="font-medium text-primary underline-offset-4 hover:underline max-md:inline-flex max-md:min-h-11 max-md:items-center">
                  Ansehen
                </Link>
              )}
            </>
          )}
        </p>
      )}

      <div className="space-y-1.5 rounded-[var(--radius)] border p-3">
        <label htmlFor={id} className="flex items-center gap-2 text-[14px] font-medium max-md:min-h-11">
          <Checkbox id={id} checked={senden} disabled={niemand} aria-describedby={id + "-hinweis"} onCheckedChange={(value) => onNotifyChange(value === true)} />
          Betroffene benachrichtigen
        </label>
        <p id={id + "-hinweis"} className="text-muted-foreground">
          {niemand
            ? "Niemand ist von den Änderungen betroffen – es wird keine Mitteilung verschickt."
            : !notify
              ? "Ohne Benachrichtigung: Der neue Stand ist sichtbar, aber niemand erhält eine Mitteilung."
              : status === "DRAFT"
                ? "Die Mitteilung geht an alle Eingeteilten und an alle, die diesen Standortplan sehen dürfen."
                : "Jede betroffene Person erhält eine Mitteilung mit ihren geänderten Schichten."}
        </p>
        {senden && diff.openPlacesAdded && <p className="text-muted-foreground">Offene Plätze: Standortfreigaben mit Anfragerecht werden informiert.</p>}
      </div>
    </div>
  );
}

interface PublishDialogProps {
  scheduleId: string;
  /** Zum Beispiel "KW 42/2026" - steht im Titel und in der Erfolgsmeldung. */
  wochenLabel?: string;
  /** Bekannter Status fuer den Titel, bevor der Diff geladen ist. */
  status?: ScheduleStatus;
  /** Woche und Standort fuer den Konfliktzaehler und den Sprung dorthin. */
  woche?: { weekNumber: number; year: number; standort: string };
  /** Beschriftung des Ausloesers, etwa "Änderungen veröffentlichen". */
  label?: string;
  /** Blaue Hauptaktion oder Nebenaktion. */
  hauptaktion?: boolean;
  size?: "sm" | "default";
  className?: string;
}

/**
 * Veroeffentlichen mit Aenderungsuebersicht (Entwurf oder Bearbeitung): Der
 * Dialog laedt beim Oeffnen den Diff gegen den veroeffentlichten Stand und
 * zeigt, wer betroffen ist; die Benachrichtigung laesst sich abwaehlen.
 * Konflikte der Woche werden nur angezeigt, nicht gesperrt. Rechte und
 * Statuswechsel prueft der Server; seine Fehlermeldungen erscheinen woertlich.
 */
export function PublishDialog({
  scheduleId,
  wochenLabel = "Dienstplan",
  status,
  woche,
  label = "Veröffentlichen",
  hauptaktion = true,
  size = "default",
  className,
}: PublishDialogProps) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [notify, setNotify] = useState(true);
  const busy = useRef(false);
  const sprung = useRef(false);

  // Unter "schedule": Echtzeit-Aenderungen am Plan laden den Diff neu, solange der Dialog offen ist.
  const diff = useQuery<DiffResponse>({
    queryKey: ["schedule", "diff", scheduleId],
    queryFn: () => json<DiffResponse>(`/api/schedules/${scheduleId}/diff`),
    enabled: open,
    staleTime: 0,
    retry: false,
  });
  const konflikte = useWeekConflicts(woche?.weekNumber ?? 0, woche?.year ?? 0, woche?.standort ?? "ohne", open && !!woche);

  const mutation = useMutation({
    mutationFn: async (send: boolean) => {
      const res = await fetch(`/api/schedules/${scheduleId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isPublic: true, notify: send }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Veröffentlichen fehlgeschlagen.");
      return data as { notified?: number };
    },
    onSuccess: (data, send) => {
      toast.success(veröffentlichtText(wochenLabel, send, data.notified ?? 0));
      setOpen(false);
    },
    onError: (error: Error) => toast.error(error.message),
    onSettled: () => {
      busy.current = false;
      // Wie bisher alles neu laden (Wochenplan samt Diff und Konflikten, Monat, Startseite) - auch nach 409.
      queryClient.invalidateQueries();
    },
  });

  const data = diff.data;
  const aktuell = data?.status ?? status;
  const bearbeitung = aktuell === "EDITING";
  const konflikteHref = woche ? `/schedule/flexible/${formatKW(woche.weekNumber, woche.year)}?standort=${encodeURIComponent(woche.standort)}` : undefined;

  function wechsel(value: boolean) {
    if (value) {
      setNotify(true);
      sprung.current = false;
    }
    setOpen(value);
  }

  function veröffentlichen() {
    // Doppelklick: der zweite Aufruf kommt, bevor isPending gerendert ist.
    if (busy.current || !data) return;
    busy.current = true;
    mutation.mutate(notify && !keineMitteilung(data));
  }

  /** Konfliktpanel auf dieser Seite: Dialog schliessen und dorthin springen; sonst fuehrt der Link in die Wochenansicht. */
  function zuKonflikten(event: React.MouseEvent<HTMLAnchorElement>) {
    if (!document.querySelector(PANEL)) return;
    event.preventDefault();
    sprung.current = true;
    setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={wechsel}>
      <DialogTrigger asChild>
        <Button variant={hauptaktion ? "default" : "outline"} size={size} className={cn("gap-1.5", className)} disabled={mutation.isPending}>
          {mutation.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
          {label}
        </Button>
      </DialogTrigger>
      <DialogContent
        className="sm:max-w-lg"
        onCloseAutoFocus={(event) => {
          if (!sprung.current) return;
          sprung.current = false;
          event.preventDefault();
          const panel = document.querySelector<HTMLElement>(PANEL);
          panel?.scrollIntoView({ block: "start" });
          panel?.querySelector<HTMLElement>("button")?.focus({ preventScroll: true });
        }}
      >
        <DialogHeader>
          <DialogTitle>{bearbeitung ? `Änderungen an ${wochenLabel} veröffentlichen?` : `${wochenLabel} veröffentlichen?`}</DialogTitle>
          <DialogDescription>
            {bearbeitung
              ? "Danach sehen Mitarbeitende den neuen Stand; Anträge und Tausch sind wieder möglich."
              : "Danach sehen Mitarbeitende diesen Plan."}
          </DialogDescription>
        </DialogHeader>

        {data ? (
          <PublishSummary
            data={data}
            notify={notify}
            onNotifyChange={setNotify}
            konflikte={konflikte.data?.counts ?? null}
            konflikteHref={konflikteHref}
            onKonflikte={zuKonflikten}
          />
        ) : diff.isError ? (
          <div role="alert" className="space-y-2 rounded-[var(--radius)] border border-destructive/30 bg-destructive/5 p-3 text-[13px] text-destructive">
            <p>Die Änderungen konnten nicht geladen werden: {diff.error.message}</p>
            <Button variant="outline" size="sm" onClick={() => diff.refetch()}>Erneut laden</Button>
          </div>
        ) : (
          <p role="status" className="flex items-center gap-2 text-[13px] text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            Änderungen werden geladen …
          </p>
        )}

        <DialogFooter className="gap-2 sm:justify-end">
          <Button variant="outline" onClick={() => setOpen(false)}>Abbrechen</Button>
          <Button onClick={veröffentlichen} disabled={!data || diff.isFetching || mutation.isPending || data.status === "PUBLISHED"}>
            {mutation.isPending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Send className="size-4" aria-hidden="true" />}
            Veröffentlichen
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
