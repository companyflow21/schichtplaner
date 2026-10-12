"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ErrorMessage, json, useAction } from "@/components/workforce/client";
import { hours } from "@/lib/payroll";
import { balanceBefore, type AccountMethod, type AccountResult } from "@/lib/time-account";
import { cn } from "@/lib/utils";

type AccountView = {
  memberId: string; enabled: boolean; active: boolean; method: AccountMethod; visible: boolean; canEdit: boolean; result: AccountResult;
  compensations: { id: string; date: string; minutes: number; description: string }[];
};

export const METHOD_LABEL: Record<AccountMethod, string> = { ACTUAL_MINUS_TARGET: "Ist − Soll", PLAN_MINUS_TARGET: "Plan − Soll", ACTUAL_MINUS_PLAN: "Ist − Plan" };
export const signedHours = (minutes: number) => (minutes > 0 ? "+" : minutes < 0 ? "−" : "") + hours(Math.abs(minutes));
const date = (d: string) => new Date(d + "T12:00:00Z").toLocaleDateString("de-DE", { timeZone: "UTC", day: "2-digit", month: "2-digit", year: "numeric" });
const short = (d: string) => d.slice(8, 10) + "." + d.slice(5, 7) + ".";

/** Zeitkonto einer Person: Perioden mit Soll, Plan, Ist, Ausgleich und laufendem Saldo; Ausgleich buchen (Admins). */
export function TimeAccountDialog({ userId, name, from, to, onClose }: { userId?: string; name: string; from: string; to: string; onClose: () => void }) {
  const query = useQuery({ queryKey: ["time-account", userId ?? "self", to], queryFn: () => json<AccountView>("/api/time-accounts?to=" + to + (userId ? "&userId=" + encodeURIComponent(userId) : "")) });
  const action = useAction();
  const [error, setError] = useState<string | null>(null);
  const data = query.data;
  const shown = data?.result?.periods.filter((p) => p.to >= from) ?? [];
  const before = balanceBefore(data?.result ?? null, shown[0]?.from ?? from);
  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl [&>*]:min-w-0">
        <DialogHeader>
          <DialogTitle>Zeitkonto {name}</DialogTitle>
          <DialogDescription>{data ? METHOD_LABEL[data.method] + " · Saldo zum " + date(to) : "Wird geladen …"}</DialogDescription>
        </DialogHeader>
        <ErrorMessage error={query.error} />
        {query.isLoading && <div className="flex justify-center py-6"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>}
        {data && !data.active && <p className="text-sm text-muted-foreground">{!data.enabled ? "Zeitkonten sind ausgeschaltet (Einstellungen › Zeitkonten)." : "Für diese Person ist kein Soll hinterlegt oder das Zeitkonto ist ausgeschaltet."}</p>}
        {data?.result && (
          <>
            <p className="text-2xl font-semibold tabular-nums">{signedHours(data.result.balanceMinutes)} h</p>
            <div className="overflow-x-auto rounded-[var(--radius)] border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-xs text-muted-foreground">
                  <tr><th className="px-2 py-1.5 text-left font-medium">Zeitraum</th><th className="px-2 py-1.5 text-right font-medium">Soll</th><th className="hidden px-2 py-1.5 text-right font-medium sm:table-cell">Plan</th><th className="px-2 py-1.5 text-right font-medium">Ist</th><th className="hidden px-2 py-1.5 text-right font-medium sm:table-cell">Ausgleich</th><th className="px-2 py-1.5 text-right font-medium">Saldo</th></tr>
                </thead>
                <tbody>
                  <tr className="border-t text-muted-foreground"><td className="px-2 py-1.5 sm:hidden" colSpan={3}>Saldo vor {date(shown[0]?.from ?? from)}</td><td className="hidden px-2 py-1.5 sm:table-cell" colSpan={5}>Saldo vor {date(shown[0]?.from ?? from)}</td><td className="px-2 py-1.5 text-right tabular-nums">{signedHours(before)}</td></tr>
                  {shown.map((p) => (
                    <tr key={p.from} className="border-t" title={signedHours(p.balanceMinutes - p.deltaMinutes) + " + " + signedHours(p.deltaMinutes) + " = " + signedHours(p.balanceMinutes)}>
                      <td className="px-2 py-1.5 whitespace-nowrap"><span className="sm:hidden">{short(p.from)}–{short(p.to)}</span><span className="hidden sm:inline">{date(p.from)} – {date(p.to)}</span></td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{hours(p.targetMinutes)}</td>
                      <td className="hidden px-2 py-1.5 text-right tabular-nums sm:table-cell">{hours(p.plannedMinutes)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{hours(p.actualMinutes)}</td>
                      <td className="hidden px-2 py-1.5 text-right tabular-nums sm:table-cell">{p.compensationMinutes ? signedHours(p.compensationMinutes) : ""}</td>
                      <td className={cn("px-2 py-1.5 text-right font-medium tabular-nums", p.balanceMinutes < 0 && "text-destructive")}>{signedHours(p.balanceMinutes)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-muted-foreground">Tage nach heute zählen mit ihren Planstunden. Beginnt ein Soll mitten in einer Periode, zählt es anteilig nach Werktagen.</p>
          </>
        )}
        {data && (data.compensations.length > 0 || data.canEdit) && (
          <div className="space-y-2">
            <h3 className="text-sm font-semibold">Ausgleich</h3>
            {data.compensations.length > 0 && (
              <ul className="divide-y rounded-[var(--radius)] border text-sm">
                {data.compensations.map((c) => (
                  <li key={c.id} className="flex items-center gap-2 px-2 py-1.5">
                    <span className="w-24 tabular-nums">{date(c.date)}</span>
                    <span className="flex-1">{c.description}</span>
                    <span className="tabular-nums">{signedHours(c.minutes)} h</span>
                    {data.canEdit && <Button size="icon-sm" variant="ghost" aria-label="Ausgleich löschen" disabled={action.isPending} onClick={() => { if (confirm("Ausgleich löschen?")) action.mutate({ url: "/api/time-accounts/compensations/" + c.id, method: "DELETE", message: "Ausgleich gelöscht" }); }}><Trash2 className="size-4" /></Button>}
                  </li>
                ))}
              </ul>
            )}
            {data.canEdit && (
              <form className="grid gap-2 sm:grid-cols-[9rem_6rem_1fr_auto]" onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget), form = e.currentTarget;
                const value = Number(String(f.get("hours") ?? "").replace(",", "."));
                if (!Number.isFinite(value) || value === 0) { setError("Bitte Stunden mit Vorzeichen eingeben, z. B. -30 oder 12,5."); return; }
                setError(null);
                action.mutate({ url: "/api/time-accounts/members/" + data.memberId + "/compensations", method: "POST", data: { date: f.get("date"), hours: value, description: String(f.get("description") ?? "").trim() }, message: "Ausgleich gebucht" }, { onSuccess: () => form.reset() });
              }}>
                <Input type="date" name="date" aria-label="Datum" defaultValue={to} required />
                <Input name="hours" aria-label="Stunden" inputMode="decimal" placeholder="−30" required />
                <Input name="description" aria-label="Beschreibung" placeholder="z. B. Überstunden ausbezahlt" minLength={3} maxLength={500} required />
                <Button disabled={action.isPending}>Buchen</Button>
              </form>
            )}
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Eigener Saldo als Knopf (nur wenn sichtbar und aktiv); oeffnet die Perioden. */
export function OwnAccountButton({ from, to }: { from: string; to: string }) {
  const [open, setOpen] = useState(false);
  const query = useQuery({ queryKey: ["time-account", "self", to], queryFn: () => json<AccountView>("/api/time-accounts?to=" + to), retry: false });
  if (!query.data?.active || !query.data.result) return null;
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>Zeitkonto {signedHours(query.data.result.balanceMinutes)} h</Button>
      {open && <TimeAccountDialog name="(eigenes)" from={from} to={to} onClose={() => setOpen(false)} />}
    </>
  );
}
