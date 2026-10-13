"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { InfoHint } from "@/components/ui/info-hint";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ErrorMessage, json, useAction } from "@/components/workforce/client";
import { useNameFormat } from "@/lib/hooks/use-current-member";
import { formatName } from "@/lib/names";
import type { VacationYear } from "@/lib/vacation";
import { cn } from "@/lib/utils";

type View = {
  memberId: string; enabled: boolean; active: boolean; canEdit: boolean; categoryId: string | null; categoryName: string | null;
  years: VacationYear[]; current: VacationYear | null; adjustments: { id: string; date: string; days: number; comment: string }[]; cost: number | null;
};
type Overview = { enabled: boolean; people: { userId: string; memberId: string; firstName: string; lastName: string; deviates: boolean; daysPerYear: number; current: VacationYear }[] };

export const days = (n: number) => n.toLocaleString("de-DE", { maximumFractionDigits: 2 });
const date = (d: string) => new Date(d + "T12:00:00Z").toLocaleDateString("de-DE", { timeZone: "UTC", day: "2-digit", month: "2-digit", year: "numeric" });
const signed = (n: number) => (n > 0 ? "+" : n < 0 ? "−" : "") + days(Math.abs(n));
const usedText = (y: VacationYear) => days(y.taken + y.planned) + " von " + days(y.entitlement + y.carried + y.adjustments);

/** Eigenes Urlaubskonto (nur wenn eingeschaltet und fuer Mitarbeitende sichtbar). */
export function OwnVacation() {
  const query = useQuery({ queryKey: ["vacation", "self"], queryFn: () => json<View>("/api/vacation"), retry: false });
  const [open, setOpen] = useState(false);
  const y = query.data?.current;
  if (!query.data?.active || !y) return null;
  return (
    <Card className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="text-xs text-muted-foreground">Urlaub {date(y.from)} – {date(y.to)}</p>
        <p className="text-lg font-semibold">Genommen und geplant: {usedText(y)} Tagen · verfügbar {days(y.available)}</p>
        {y.pending > 0 && <p className="text-sm text-warn">{days(y.pending)} Tage beantragt, noch nicht genehmigt</p>}
      </div>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>Kontoauszug</Button>
      {open && <VacationDialog onClose={() => setOpen(false)} />}
    </Card>
  );
}

/** Urlaubskonten aller Personen, deren Abwesenheiten man entscheidet. */
export function VacationOverview() {
  const query = useQuery({ queryKey: ["vacation-overview"], queryFn: () => json<Overview>("/api/vacation/overview") });
  const nameFormat = useNameFormat();
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState<Overview["people"][number] | null>(null);
  if (query.isLoading) return <div className="flex justify-center py-10"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>;
  if (query.error) return <ErrorMessage error={query.error} />;
  if (!query.data?.enabled) return <Card className="p-6 text-sm text-muted-foreground">Das Urlaubskonto ist ausgeschaltet (Einstellungen › Urlaubskonto).</Card>;
  const people = query.data.people.filter((p) => formatName(p, nameFormat).toLowerCase().includes(search.trim().toLowerCase()));
  return (
    <Card className="space-y-3 p-4">
      <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Person suchen …" aria-label="Person suchen" className="sm:max-w-xs" />
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted-foreground">
            <tr><th className="py-2 pr-3 font-medium">Name</th><th className="py-2 pr-3 text-right font-medium">Anspruch</th><th className="hidden py-2 pr-3 text-right font-medium sm:table-cell">Übertrag</th><th className="py-2 pr-3 text-right font-medium">Genommen</th><th className="hidden py-2 pr-3 text-right font-medium sm:table-cell">Geplant</th><th className="py-2 text-right font-medium">Verfügbar</th></tr>
          </thead>
          <tbody>
            {people.map((p) => (
              <tr key={p.userId} className="cursor-pointer border-t hover:bg-muted/40" onClick={() => setOpen(p)}>
                <td className="py-2 pr-3"><span className="font-medium">{formatName(p, nameFormat)}</span>{p.deviates && <span className="ml-2 text-xs text-muted-foreground">eigene Regeln</span>}{p.current.pending > 0 && <span className="ml-2 rounded-full bg-warn/10 px-2 py-0.5 text-xs text-warn">{days(p.current.pending)} beantragt</span>}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{days(p.current.entitlement)}</td>
                <td className="hidden py-2 pr-3 text-right tabular-nums sm:table-cell">{days(p.current.carried)}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{days(p.current.taken)}</td>
                <td className="hidden py-2 pr-3 text-right tabular-nums sm:table-cell">{days(p.current.planned)}</td>
                <td className={cn("py-2 text-right font-medium tabular-nums", p.current.available < 0 && "text-destructive")}>{days(p.current.available)}</td>
              </tr>
            ))}
            {people.length === 0 && <tr><td colSpan={6} className="py-4 text-center text-muted-foreground">Keine Personen gefunden.</td></tr>}
          </tbody>
        </table>
      </div>
      {open && <VacationDialog userId={open.userId} name={formatName(open, nameFormat)} onClose={() => setOpen(null)} />}
    </Card>
  );
}

/** Kontoauszug je Urlaubsjahr mit Korrektur (nur Administration); ohne name das eigene Konto. */
export function VacationDialog({ userId, name, onClose }: { userId?: string; name?: string; onClose: () => void }) {
  const query = useQuery({ queryKey: ["vacation", userId ?? "self", "statement"], queryFn: () => json<View>("/api/vacation" + (userId ? "?userId=" + encodeURIComponent(userId) : "")) });
  const action = useAction();
  const [index, setIndex] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const data = query.data;
  const years = data?.years ?? [];
  const i = index ?? years.length - 1;
  const year = years[i];
  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl [&>*]:min-w-0">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-1">
            {name ? "Urlaubskonto " + name : "Mein Urlaubskonto"}
            <InfoHint thema="Urlaubskonto" titel="So wird gerechnet">
              <p>Anspruch je Urlaubsjahr (ganz zu Beginn oder monatlich), Übertrag aus dem Vorjahr, Korrekturen der Administration.</p>
              <p>Abgezogen wird genehmigter Urlaub ohne freie Wochentage und – je nach Einstellung – ohne Feiertage (Bundesland des Einsatzorts der Schicht an diesem Tag, sonst Feiertage der Organisation). Beantragter Urlaub wird angezeigt, aber nicht abgezogen.</p>
            </InfoHint>
          </DialogTitle>
          <DialogDescription>{data?.categoryName ? "Abgezogen wird „" + data.categoryName + "“." : "Wird geladen …"}</DialogDescription>
        </DialogHeader>
        <ErrorMessage error={query.error} />
        {data && !data.active && <p className="text-sm text-muted-foreground">Kein Urlaubskonto für diese Person.</p>}
        {year && (
          <div className="space-y-3 text-sm">
            <div className="flex items-center justify-between">
              <Button size="icon-sm" variant="outline" aria-label="Voriges Urlaubsjahr" disabled={i <= 0} onClick={() => setIndex(i - 1)}><ChevronLeft className="size-4" /></Button>
              <span className="font-medium">{date(year.from)} – {date(year.to)}</span>
              <Button size="icon-sm" variant="outline" aria-label="Nächstes Urlaubsjahr" disabled={i >= years.length - 1} onClick={() => setIndex(i + 1)}><ChevronRight className="size-4" /></Button>
            </div>
            <p>Genommen und geplant: <strong>{usedText(year)}</strong> Tagen · verfügbar <strong>{days(year.available)}</strong>{year.pending ? " · " + days(year.pending) + " beantragt" : ""}</p>
            <ul className="divide-y rounded-[var(--radius)] border">
              {year.entries.map((e, n) => (
                <li key={n} className="grid grid-cols-[5.5rem_minmax(0,1fr)_auto_auto] gap-2 px-2 py-1.5 sm:grid-cols-[6.5rem_1fr_4rem_4rem]">
                  <span className="tabular-nums">{date(e.date)}</span><span className="break-words">{e.label}</span>
                  <span className={cn("text-right tabular-nums", e.days < 0 && "text-destructive")}>{signed(e.days)}</span>
                  <span className="text-right font-medium tabular-nums">{days(e.balance)}</span>
                </li>
              ))}
              {year.entries.length === 0 && <li className="px-2 py-1.5 text-muted-foreground">Keine Buchungen.</li>}
            </ul>
          </div>
        )}
        {data?.active && data.canEdit && (
          <div className="space-y-2">
            <h3 className="flex items-center gap-1 text-sm font-semibold">
              Saldo anpassen
              <InfoHint thema="Saldo anpassen"><p>Korrektur in ganzen oder halben Tagen mit Vorzeichen, z. B. Resturlaub bei Einführung (+4,5) oder bereits genommener Urlaub (−3). Zählt am eingetragenen Datum. Nur die Administration.</p></InfoHint>
            </h3>
            {data.adjustments.length > 0 && (
              <ul className="divide-y rounded-[var(--radius)] border text-sm">
                {data.adjustments.map((x) => (
                  <li key={x.id} className="flex items-center gap-2 px-2 py-1.5">
                    <span className="w-24 shrink-0 tabular-nums">{date(x.date)}</span><span className="min-w-0 flex-1 break-words">{x.comment}</span><span className="tabular-nums">{signed(x.days)}</span>
                    <ConfirmDialog title="Korrektur löschen?" description={"„" + x.comment + "“ (" + signed(x.days) + " Tage) wird entfernt; der Stand des Urlaubskontos wird neu gerechnet."} confirmLabel="Löschen" disabled={action.isPending}
                      onConfirm={() => action.mutate({ url: "/api/vacation/adjustments/" + x.id, method: "DELETE", message: "Korrektur gelöscht" })}>
                      <Button size="icon-sm" variant="ghost" aria-label="Korrektur löschen" disabled={action.isPending}><Trash2 className="size-4 text-destructive" /></Button>
                    </ConfirmDialog>
                  </li>
                ))}
              </ul>
            )}
            <form className="grid gap-2 sm:grid-cols-[9rem_6rem_1fr_auto]" onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget), form = e.currentTarget;
              const value = Number(String(f.get("days") ?? "").replace(",", "."));
              if (!Number.isFinite(value) || value === 0 || Math.round(value * 2) !== value * 2) { setError("Bitte ganze oder halbe Tage mit Vorzeichen eingeben, z. B. -3 oder 2,5."); return; }
              setError(null);
              action.mutate({ url: "/api/vacation/members/" + data.memberId + "/adjustments", method: "POST", data: { date: f.get("date"), days: value, comment: String(f.get("comment") ?? "").trim() }, message: "Urlaubskonto angepasst" }, { onSuccess: () => form.reset() });
            }}>
              <Input type="date" name="date" aria-label="Datum" defaultValue={year?.from} required />
              <Input name="days" aria-label="Tage" inputMode="decimal" placeholder="−3" required />
              <Input name="comment" aria-label="Kommentar" placeholder="z. B. bereits genommener Urlaub vor Einführung" minLength={3} maxLength={500} required />
              <Button disabled={action.isPending}>Buchen</Button>
            </form>
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Hinweis im Antrag: Stand des Urlaubskontos und Tage, die der Zeitraum abzieht. */
export function VacationHint({ userId, categoryId, from, to }: { userId: string; categoryId: string; from: string; to: string }) {
  const query = useQuery({
    queryKey: ["vacation", userId, "hint", from, to],
    queryFn: () => json<View>("/api/vacation?userId=" + encodeURIComponent(userId) + "&from=" + from + "&to=" + to + "&date=" + from),
    retry: false, enabled: !!userId && !!from && !!to && from <= to,
  });
  const v = query.data;
  if (!v?.active || !v.current || v.categoryId !== categoryId) return null;
  const after = v.current.available - (v.cost ?? 0);
  return (
    <p className={cn("rounded-md bg-muted/60 px-3 py-2 text-sm", after < 0 && "text-destructive")}>
      Urlaubskonto: verfügbar {days(v.current.available)} Tage · dieser Zeitraum {days(v.cost ?? 0)} · danach {days(after)}
    </p>
  );
}
