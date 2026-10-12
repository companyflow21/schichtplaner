"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Loader2, PencilLine, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ErrorMessage, json } from "@/components/workforce/client";
import type { ChangeShift, Changes } from "@/lib/publishing";
import { cn } from "@/lib/utils";
import { ViolationList, type ViolationData } from "./rule-violations";

type Preview = {
  schedule: { id: string; weekNumber: number; year: number; from: string; to: string; branchName: string | null; isPublic: boolean; editing: boolean };
  first: boolean;
  changes: Changes;
  hints: { absent: { shiftId: string; name: string; date: string }[]; openSlots: number };
  violations: ViolationData;
};

const day = (date: string) => new Date(date + "T12:00:00Z").toLocaleDateString("de-DE", { timeZone: "UTC", weekday: "short", day: "2-digit", month: "2-digit" });
const line = (s: ChangeShift) => day(s.date) + " · " + s.from + "–" + s.to + (s.division ? " · " + s.division : "") + (s.title ? " · " + s.title : "");
const people = (s: ChangeShift) => (s.people.length ? s.people.map((p) => p.name).join(", ") : "unbesetzt");

function Section({ title, count, children, limit = 8 }: { title: string; count: number; children: React.ReactNode[]; limit?: number }) {
  const [all, setAll] = useState(false);
  if (!count) return null;
  return (
    <section className="space-y-1.5">
      <h3 className="text-sm font-semibold">{title} ({count})</h3>
      <ul className="divide-y rounded-[var(--radius)] border text-[13px]">{all ? children : children.slice(0, limit)}</ul>
      {count > limit && <Button variant="ghost" size="xs" onClick={() => setAll((v) => !v)}>{all ? "Weniger anzeigen" : "Alle " + count + " anzeigen"}</Button>}
    </section>
  );
}

/**
 * Veroeffentlichen mit Pruefung (Smartplan "Änderungen veröffentlichen?"):
 * Zeitraum, neue, gelöschte und geänderte Schichten seit dem Stand, den
 * Mitarbeitende zuletzt gesehen haben, Hinweise und Regelverstoesse;
 * "Betroffene benachrichtigen" ist abwaehlbar. Verstoesse sperren nicht.
 */
export function PublishDialog({ scheduleId, wochenLabel, editing = false, hauptaktion = true, className }: { scheduleId: string; wochenLabel: string; editing?: boolean; hauptaktion?: boolean; className?: string }) {
  const [open, setOpen] = useState(false);
  const [notify, setNotify] = useState(true);
  const queryClient = useQueryClient();
  const preview = useQuery({ queryKey: ["publish-preview", scheduleId], queryFn: () => json<Preview>(`/api/schedules/${scheduleId}/publish`), enabled: open, staleTime: 0, gcTime: 0 });
  const mutation = useMutation({
    mutationFn: () => json<{ notified: number }>(`/api/schedules/${scheduleId}/publish`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ notify }) }),
    onSuccess: (result) => {
      toast.success(wochenLabel + " veröffentlicht" + (result.notified ? " – " + result.notified + (result.notified === 1 ? " Person benachrichtigt" : " Personen benachrichtigt") : ""));
      setOpen(false);
      queryClient.invalidateQueries();
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const data = preview.data;
  const c = data?.changes;
  const changeCount = c ? c.added.length + c.removed.length + c.changed.length : 0;
  const clean = data && !data.hints.absent.length && !data.violations.count;
  return (
    <>
      <Button variant={hauptaktion ? "default" : "outline"} size="sm" className={cn("gap-1.5", className)} onClick={() => setOpen(true)}>
        <Send className="size-3.5" />
        {editing ? "Änderungen veröffentlichen" : "Veröffentlichen"}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl [&>*]:min-w-0">
          <DialogHeader>
            <DialogTitle>{editing ? "Änderungen veröffentlichen?" : wochenLabel + " veröffentlichen?"}</DialogTitle>
            <DialogDescription>
              {data ? wochenLabel + " · " + day(data.schedule.from) + " – " + day(data.schedule.to) + (data.schedule.branchName ? " · " + data.schedule.branchName : "") : "Änderungen werden geprüft …"}
            </DialogDescription>
          </DialogHeader>
          <ErrorMessage error={preview.error} />
          {preview.isLoading && <div className="flex justify-center py-6"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>}
          {data && c && (
            <div className="space-y-4 text-sm">
              {!data.first && changeCount === 0 && <p className="text-muted-foreground">Keine Änderungen gegenüber dem Stand, den Mitarbeitende zuletzt gesehen haben.</p>}
              {data.first && <p className="text-muted-foreground">Erste Veröffentlichung dieser Woche{data.schedule.branchName ? " an diesem Standort" : ""}.</p>}
              <Section title={data.first ? "Schichten" : "Neue Schichten"} count={c.added.length}>
                {c.added.map((s) => <li key={s.id} className="px-3 py-1.5"><span className="font-medium">{line(s)}</span><span className="block text-muted-foreground">{people(s)}</span></li>)}
              </Section>
              <Section title="Gelöschte Schichten" count={c.removed.length}>
                {c.removed.map((s) => <li key={s.id} className="px-3 py-1.5 text-muted-foreground"><span className="font-medium line-through">{line(s)}</span><span className="block">{people(s)}</span></li>)}
              </Section>
              <Section title="Geänderte Schichten" count={c.changed.length}>
                {c.changed.map((x) => (
                  <li key={x.after.id} className="space-y-0.5 px-3 py-1.5">
                    <span className="block font-medium">{x.fields.includes("Zeit") ? line(x.before) + " → " + x.after.from + "–" + x.after.to + (x.after.date !== x.before.date ? " (" + day(x.after.date) + ")" : "") : line(x.after)}</span>
                    {x.fields.filter((f) => f !== "Zeit").length > 0 && <span className="block text-muted-foreground">Geändert: {x.fields.filter((f) => f !== "Zeit").join(", ")}</span>}
                    {x.joined.length > 0 && <span className="block text-ok">+ {x.joined.map((p) => p.name).join(", ")}</span>}
                    {x.left.length > 0 && <span className="block text-destructive">− {x.left.map((p) => p.name).join(", ")}</span>}
                  </li>
                ))}
              </Section>
              <section className="space-y-1.5">
                <h3 className="text-sm font-semibold">Prüfung</h3>
                {clean && <p className="flex items-center gap-2 rounded-[var(--radius)] border border-ok/30 bg-ok/[0.06] px-3 py-2"><CheckCircle2 className="size-4 text-ok" />Keine Konflikte{data.violations.enabled ? " und keine Regelverstöße" : ""}.</p>}
                {data.hints.absent.length > 0 && (
                  <div className="rounded-[var(--radius)] border border-warn/40 bg-warn/[0.06] px-3 py-2">
                    <p className="font-medium">Eingeteilt, aber abwesend oder nicht mehr aktiv:</p>
                    <ul className="mt-1 list-disc pl-5">{data.hints.absent.map((x, i) => <li key={i}>{x.name}, {day(x.date)}</li>)}</ul>
                  </div>
                )}
                {data.hints.openSlots > 0 && <p className="text-muted-foreground">{data.hints.openSlots} {data.hints.openSlots === 1 ? "Platz ist" : "Plätze sind"} noch unbesetzt.</p>}
                {data.violations.count > 0 && (
                  <div className="rounded-[var(--radius)] border border-warn/40 bg-warn/[0.06] px-3 py-2">
                    <p className="mb-1 font-medium">{data.violations.count} {data.violations.count === 1 ? "Regelverstoß" : "Regelverstöße"} – nur Hinweise, Veröffentlichen bleibt möglich:</p>
                    <ViolationList people={data.violations.people} onJump={() => undefined} />
                  </div>
                )}
              </section>
              <label className="flex items-start gap-2 rounded-[var(--radius)] border px-3 py-2">
                <input type="checkbox" className="mt-0.5 size-4 accent-primary" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
                <span><span className="font-medium">Betroffene benachrichtigen</span><span className="block text-xs text-muted-foreground">{data.schedule.editing ? "Nur Personen, deren Schichten sich geändert haben – mit ihren Änderungen; bei neuen offenen Plätzen alle mit Anfragerecht." : "Alle, die den Plan sehen oder Schichten anfragen dürfen, und alle Eingeteilten."}</span></span>
              </label>
            </div>
          )}
          <DialogFooter className="gap-2 sm:justify-end">
            <Button variant="outline" onClick={() => setOpen(false)}>Abbrechen</Button>
            <Button disabled={!data || mutation.isPending} onClick={() => mutation.mutate()}>{mutation.isPending && <Loader2 className="size-4 animate-spin" />}Veröffentlichen</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Veroeffentlichten Plan zurueck in die Planung nehmen (nur Wochen, die noch nicht begonnen haben). */
export function EditModeButton({ scheduleId, wochenLabel, started, className }: { scheduleId: string; wochenLabel: string; started: boolean; className?: string }) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: () => json(`/api/schedules/${scheduleId}/edit`, { method: "POST" }),
    onSuccess: () => { toast.success(wochenLabel + " wird bearbeitet"); queryClient.invalidateQueries(); },
    onError: (error: Error) => toast.error(error.message),
  });
  if (started) return <p className="text-xs text-muted-foreground">Bearbeitungsmodus nur für kommende Wochen – laufende Wochen direkt ändern.</p>;
  return (
    <ConfirmDialog
      title={wochenLabel + " bearbeiten?"}
      description="Mitarbeitende sehen bis zum erneuten Veröffentlichen den bisherigen Stand. Anfragen, Tausch und Bestätigungen ruhen so lange; Änderungen lösen noch keine Nachrichten aus. Beim Veröffentlichen siehst du alle Änderungen und benachrichtigst die Betroffenen."
      confirmLabel="Plan bearbeiten"
      destructive={false}
      disabled={mutation.isPending}
      onConfirm={() => mutation.mutate()}
    >
      <Button variant="outline" size="sm" className={cn("gap-1.5", className)} disabled={mutation.isPending}>
        {mutation.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <PencilLine className="size-3.5" />}
        Plan bearbeiten
      </Button>
    </ConfirmDialog>
  );
}
