"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { InfoHint } from "@/components/ui/info-hint";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ErrorMessage, json, selectClass } from "@/components/workforce/client";
import { hours } from "@/lib/payroll";

type Handling = "PAID" | "UNPAID" | "RELEASED";
export type EffectsInput = { default?: Handling; shifts?: Record<string, Handling>; compensationHours?: number };
type Preview = {
  defaultHandling: Handling; category: { name: string; isPaid: boolean };
  shifts: {
    shiftId: string; date: string; from: string; to: string; plannedMinutes: number; title: string | null; branchName: string | null; customerName: string | null;
    division: { title: string; color: string } | null; published: boolean; editing: boolean; ended: boolean; checkedIn: boolean; current: Handling | null; canRelease: boolean;
  }[];
};

const LABEL: Record<Handling, string> = { PAID: "Schicht zählt Stunden (bezahlt)", UNPAID: "Schicht zählt 0 Stunden", RELEASED: "Person austragen (Schicht wird offen)" };
const day = (d: string) => new Date(d + "T12:00:00Z").toLocaleDateString("de-DE", { timeZone: "UTC", weekday: "short", day: "2-digit", month: "2-digit", year: "numeric" });
/** Warum diese Schicht nicht ausgetragen werden kann bzw. was beim Austragen geschieht. */
function note(s: Preview["shifts"][number]): string {
  if (s.ended) return "beendet – Zuweisung bleibt als Nachweis";
  if (s.checkedIn) return "eingecheckt – Zuweisung bleibt als Nachweis";
  if (!s.published) return "Entwurf";
  if (s.editing) return "Plan in Bearbeitung – Mitteilung erst beim Veröffentlichen";
  return "";
}

/**
 * Folgen einer Abwesenheit vor dem Genehmigen (wie Smartplan): Vorgabe fuer alle
 * geplanten Schichten im Zeitraum, Abweichung je Schicht, optional Zeitkonto-Ausgleich.
 * name: Anzeigename nach dem Namensformat der Organisation.
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
  const canReleaseAll = (data?.shifts.length ?? 0) > 0 && (data?.shifts.every((s) => s.canRelease) ?? false);
  function submit() {
    const value = compensation.trim() ? Number(compensation.replace(",", ".")) : 0;
    if (!Number.isFinite(value)) { setError("Bitte den Ausgleich als Zahl eingeben, z. B. 8 oder -4,5."); return; }
    setError(null);
    onConfirm({ default: general, shifts: perShift, ...(value ? { compensationHours: value } : {}) });
  }
  return (
    <Dialog open onOpenChange={(v) => { if (!v) onCancel(); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl [&>*]:min-w-0">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-1">
            Folgen der Abwesenheit
            <InfoHint thema="Folgen der Abwesenheit">
              <p>„zählt Stunden“: Die Person bleibt eingeteilt; die Schicht zählt mit ihren Planstunden in Stunden, Lohn (Lohnart-Code der Abwesenheitsart) und Zeitkonto.</p>
              <p>„0 Stunden“: Die Person bleibt eingeteilt, die Schicht zählt nicht.</p>
              <p>„Person austragen“: wie „Zuweisung aufheben“ – die Schicht wird wieder offen. Nur mit „Schichten bearbeiten“ am Standort und nicht nach Schichtende oder Check-in.</p>
              <p>Bleibt die Person eingeteilt, meldet die Konfliktprüfung die Schicht weiter rot. Wird die Genehmigung zurückgenommen, entfällt die Wirkung; Ausgetragene bleiben offen.</p>
            </InfoHint>
          </DialogTitle>
          <DialogDescription>{name}: {data?.category.name ?? "Abwesenheit"} vom {day(from)}{to !== from ? " bis " + day(to) : ""}.</DialogDescription>
        </DialogHeader>
        <ErrorMessage error={query.error} />
        {query.isLoading && <div className="flex justify-center py-6"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>}
        {data && (
          <div className="space-y-4 text-sm">
            {data.shifts.length === 0 ? <p className="text-muted-foreground">Keine geplanten Schichten im Zeitraum.</p> : (
              <>
                <label className="block space-y-1">
                  <span className="font-medium">{data.shifts.length === 1 ? "Für die Schicht im Zeitraum" : "Für alle " + data.shifts.length + " Schichten im Zeitraum"}</span>
                  <select className={selectClass} value={general} onChange={(e) => setChosen(e.target.value as Handling)}>
                    {(["PAID", "UNPAID", ...(canReleaseAll ? ["RELEASED"] : [])] as Handling[]).map((h) => <option key={h} value={h}>{LABEL[h]}</option>)}
                  </select>
                </label>
                <ul className="divide-y rounded-[var(--radius)] border">
                  {data.shifts.map((s) => {
                    const details = [s.division?.title, s.branchName, s.customerName, s.title, note(s)].filter(Boolean).join(" · ");
                    return (
                      <li key={s.shiftId} className="grid gap-2 px-3 py-2 sm:grid-cols-[1fr_14rem] sm:items-center">
                        <div className="min-w-0">
                          <p className="font-medium">{day(s.date)} · {s.from}–{s.to} · {hours(s.plannedMinutes)} h</p>
                          {details && <p className="break-words text-xs text-muted-foreground">{details}</p>}
                        </div>
                        <select className={selectClass} aria-label={"Folge für " + day(s.date) + " " + s.from} value={perShift[s.shiftId] ?? ""} onChange={(e) => setPerShift((prev) => { const next = { ...prev }; if (e.target.value) next[s.shiftId] = e.target.value as Handling; else delete next[s.shiftId]; return next; })}>
                          <option value="">{s.current ? "unverändert: " + LABEL[s.current] : "wie oben"}</option>
                          {(["PAID", "UNPAID", ...(s.canRelease ? ["RELEASED"] : [])] as Handling[]).map((h) => <option key={h} value={h}>{LABEL[h]}</option>)}
                        </select>
                      </li>
                    );
                  })}
                </ul>
                {!canReleaseAll && <p className="text-xs text-muted-foreground">Austragen geht nur bei künftigen Schichten ohne Check-in an Standorten, an denen du Schichten bearbeiten darfst.</p>}
              </>
            )}
            <label className="block space-y-1">
              <span className="flex items-center gap-1 font-medium">
                Ausgleich auf dem Zeitkonto (optional)
                <InfoHint thema="Ausgleich bei Abwesenheit"><p>Stunden mit Vorzeichen, z. B. 8 für einen Urlaubstag ohne Schicht; wird mit dem ersten Tag der Abwesenheit gebucht und erscheint im Zeitkonto der Person.</p></InfoHint>
              </span>
              <Input inputMode="decimal" value={compensation} onChange={(e) => setCompensation(e.target.value)} placeholder="z. B. 8" className="sm:max-w-xs" />
            </label>
            {error && <p role="alert" className="text-destructive">{error}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={onCancel}>Zurück</Button>
              <Button disabled={pending} onClick={submit}>{pending && <Loader2 className="size-4 animate-spin" />}{confirmLabel}</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
