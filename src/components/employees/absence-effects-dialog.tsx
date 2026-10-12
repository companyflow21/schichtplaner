"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ErrorMessage, json, selectClass } from "@/components/workforce/client";
import { hours } from "@/lib/payroll";

type Handling = "PAID" | "UNPAID" | "RELEASED";
export type EffectsInput = { default?: Handling; shifts?: Record<string, Handling>; compensationHours?: number };
type Preview = {
  defaultHandling: Handling; category: { name: string; isPaid: boolean };
  shifts: { shiftId: string; date: string; from: string; to: string; plannedMinutes: number; title: string | null; branchName: string | null; customerName: string | null; division: { title: string; color: string } | null; published: boolean; current: Handling | null; canRelease: boolean }[];
};

const LABEL: Record<Handling, string> = { PAID: "Schicht zählt Stunden (bezahlt)", UNPAID: "Schicht zählt 0 Stunden", RELEASED: "Schicht offen stellen (Person austragen)" };
const day = (d: string) => new Date(d + "T12:00:00Z").toLocaleDateString("de-DE", { timeZone: "UTC", weekday: "short", day: "2-digit", month: "2-digit", year: "numeric" });

/**
 * Folgen einer Abwesenheit vor dem Genehmigen (wie Smartplan): Vorgabe fuer alle
 * geplanten Schichten im Zeitraum, Abweichung je Schicht, optional Zeitkonto-Ausgleich.
 */
export function AbsenceEffectsDialog({ userId, name, from, to, categoryId, absenceId, confirmLabel, pending, onConfirm, onCancel }: {
  userId: string; name: string; from: string; to: string; categoryId: string; absenceId?: string; confirmLabel: string; pending: boolean;
  onConfirm: (effects: EffectsInput) => void; onCancel: () => void;
}) {
  const query = useQuery({
    queryKey: ["absence-effects", userId, from, to, categoryId, absenceId ?? ""],
    queryFn: () => json<Preview>("/api/absences/effects?userId=" + encodeURIComponent(userId) + "&from=" + from + "&to=" + to + "&categoryId=" + encodeURIComponent(categoryId) + (absenceId ? "&absenceId=" + encodeURIComponent(absenceId) : "")),
  });
  const [chosen, setChosen] = useState<Handling | null>(null);
  const [perShift, setPerShift] = useState<Record<string, Handling>>({});
  const [compensation, setCompensation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const data = query.data;
  const general = chosen ?? data?.defaultHandling ?? "PAID";
  const canReleaseAll = data?.shifts.every((s) => s.canRelease) ?? false;
  function confirm() {
    const value = compensation.trim() ? Number(compensation.replace(",", ".")) : 0;
    if (!Number.isFinite(value)) { setError("Bitte den Ausgleich als Zahl eingeben, z. B. 8 oder -4,5."); return; }
    setError(null);
    onConfirm({ default: general, shifts: perShift, ...(value ? { compensationHours: value } : {}) });
  }
  return (
    <Dialog open onOpenChange={(v) => { if (!v) onCancel(); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Folgen der Abwesenheit</DialogTitle>
          <DialogDescription>{name}: {data?.category.name ?? "Abwesenheit"} vom {day(from)}{to !== from ? " bis " + day(to) : ""}.</DialogDescription>
        </DialogHeader>
        <ErrorMessage error={query.error} />
        {query.isLoading && <div className="flex justify-center py-6"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>}
        {data && (
          <div className="space-y-4 text-sm">
            {data.shifts.length === 0 ? <p className="text-muted-foreground">Keine geplanten Schichten im Zeitraum.</p> : (
              <>
                <label className="block space-y-1">
                  <span className="font-medium">Für alle {data.shifts.length} {data.shifts.length === 1 ? "Schicht" : "Schichten"} im Zeitraum</span>
                  <select className={selectClass} value={general} onChange={(e) => setChosen(e.target.value as Handling)}>
                    {(["PAID", "UNPAID", ...(canReleaseAll ? ["RELEASED"] : [])] as Handling[]).map((h) => <option key={h} value={h}>{LABEL[h]}</option>)}
                  </select>
                </label>
                <ul className="divide-y rounded-[var(--radius)] border">
                  {data.shifts.map((s) => (
                    <li key={s.shiftId} className="grid gap-2 px-3 py-2 sm:grid-cols-[1fr_14rem] sm:items-center">
                      <div>
                        <p className="font-medium">{day(s.date)} · {s.from}–{s.to} · {hours(s.plannedMinutes)} h</p>
                        <p className="text-xs text-muted-foreground">{[s.division?.title, s.branchName, s.customerName, s.title].filter(Boolean).join(" · ")}{s.published ? "" : " · Entwurf"}</p>
                      </div>
                      <select className={selectClass} aria-label={"Folge für " + day(s.date)} value={perShift[s.shiftId] ?? ""} onChange={(e) => setPerShift((prev) => { const next = { ...prev }; if (e.target.value) next[s.shiftId] = e.target.value as Handling; else delete next[s.shiftId]; return next; })}>
                        <option value="">{s.current ? "unverändert: " + LABEL[s.current].split(" (")[0] : "wie oben"}</option>
                        {(["PAID", "UNPAID", ...(s.canRelease ? ["RELEASED"] : [])] as Handling[]).map((h) => <option key={h} value={h}>{LABEL[h]}</option>)}
                      </select>
                    </li>
                  ))}
                </ul>
                {!canReleaseAll && <p className="text-xs text-muted-foreground">Offen stellen geht nur an Standorten, an denen du Schichten bearbeiten darfst.</p>}
              </>
            )}
            <label className="block space-y-1">
              <span className="font-medium">Ausgleich auf dem Zeitkonto (optional)</span>
              <Input inputMode="decimal" value={compensation} onChange={(e) => setCompensation(e.target.value)} placeholder="z. B. 8 für einen Feiertag ohne Schicht" className="sm:max-w-xs" />
              <span className="block text-xs text-muted-foreground">Stunden mit Vorzeichen; wird mit dem ersten Tag der Abwesenheit gebucht.</span>
            </label>
            {error && <p role="alert" className="text-destructive">{error}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={onCancel}>Zurück</Button>
              <Button disabled={pending} onClick={confirm}>{pending && <Loader2 className="size-4 animate-spin" />}{confirmLabel}</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
