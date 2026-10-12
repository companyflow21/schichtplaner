"use client";

import { Fragment, useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, ChevronDown, ChevronLeft, ChevronRight, Download, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ErrorMessage, json, selectClass } from "@/components/workforce/client";
import { addDate, berlinDate } from "@/lib/berlin";
import { euro, formatNumber, hours, type PayLine } from "@/lib/payroll";
import { cn } from "@/lib/utils";

type RecordRow = { id: string; date: string; type: string; timeFrom: string | null; timeTo: string | null; breakMinutes: number; branchName: string | null; divisionTitle: string | null; minutes: number; totalCents: number; lines: PayLine[]; warnings: string[] };
type Person = { userId: string; memberId: string; firstName: string; lastName: string; isActive: boolean; personnelNumber: string | null; payType: { title: string; hourlyRateCents: number } | null; minutes: number; totalCents: number; lines: PayLine[]; warnings: string[]; records: RecordRow[] };
type Report = { from: string; to: string; people: Person[]; totals: { minutes: number; totalCents: number }; setup: { payTypes: number; surcharges: number } };
type BranchOption = { id: string; name: string; customer?: { name: string } | null };

const monthStart = (date: string) => date.slice(0, 8) + "01";
const monthEnd = (date: string) => addDate(addDate(monthStart(date), 32).slice(0, 8) + "01", -1);
const longDate = (date: string) => new Date(date + "T12:00:00Z").toLocaleDateString("de-DE", { timeZone: "UTC", day: "numeric", month: "long", year: "numeric" });
const shortDate = (date: string) => new Date(date + "T12:00:00Z").toLocaleDateString("de-DE", { timeZone: "UTC", weekday: "short", day: "2-digit", month: "2-digit" });
const monthTitle = (date: string) => new Date(date + "T12:00:00Z").toLocaleDateString("de-DE", { timeZone: "UTC", month: "long", year: "numeric" });
const name = (p: Pick<Person, "firstName" | "lastName">) => p.lastName + ", " + p.firstName;

/** Rechenweg einer Zeile: "8,00 h × 15,00 € = 120,00 €" bzw. mit Prozentsatz. */
function lineText(l: PayLine): string {
  const amount = l.rateCents === null ? "ohne Satz" : euro(l.amountCents);
  const rate = l.rateCents === null ? "" : " × " + (l.percent !== null ? formatNumber(l.percent / 100) + " % (" + euro(l.rateCents) + ")" : euro(l.rateCents));
  return hours(l.minutes) + " h" + rate + " = " + amount;
}

/** Stunden und Lohn je Person aus der Zeiterfassung, mit Rechenweg und Lohnexport. Nur Administration. */
export function PayrollView() {
  const today = berlinDate();
  const [from, setFrom] = useState(monthStart(today));
  const [to, setTo] = useState(monthEnd(today));
  const [custom, setCustom] = useState(false);
  const [standort, setStandort] = useState("");
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState(false);
  const wholeMonth = from === monthStart(from) && to === monthEnd(from);
  const params = "from=" + from + "&to=" + to + (standort ? "&standort=" + encodeURIComponent(standort) : "");
  const { data: branchData } = useQuery({ queryKey: ["branches", "VIEW_TIME"], queryFn: () => json<{ branches: BranchOption[] }>("/api/branches?right=VIEW_TIME") });
  const query = useQuery({ queryKey: ["payroll", from, to, standort], queryFn: () => json<Report>("/api/payroll/report?" + params), enabled: from <= to });
  const people = useMemo(() => (query.data?.people ?? []).filter((p) => name(p).toLowerCase().includes(search.trim().toLowerCase()) || (p.personnelNumber ?? "").includes(search.trim())), [query.data, search]);
  const shiftMonth = (delta: -1 | 1) => { const start = delta < 0 ? monthStart(addDate(monthStart(from), -1)) : addDate(monthEnd(from), 1); setFrom(start); setTo(monthEnd(start)); setCustom(false); };
  const toggle = (id: string) => setOpen((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const data = query.data;
  const flagged = data?.people.filter((p) => p.minutes > 0 && p.warnings.length).length ?? 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-[22px] leading-none font-[560] tracking-[-0.03em]">Lohn</h1>
          <p className="text-sm text-muted-foreground">Stunden und Lohn je Person aus der Zeiterfassung, mit Zuschlägen und Rechenweg</p>
        </div>
        <Button size="sm" onClick={() => setExporting(true)} disabled={!data}><Download className="size-4" />Lohnexport</Button>
      </div>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="icon-sm" aria-label="Vorheriger Monat" onClick={() => shiftMonth(-1)}><ChevronLeft className="size-4" /></Button>
          <span className="min-w-[150px] text-center text-lg font-semibold sm:min-w-[220px]">{wholeMonth ? monthTitle(from) : longDate(from) + " – " + longDate(to)}</span>
          <Button variant="outline" size="icon-sm" aria-label="Nächster Monat" onClick={() => shiftMonth(1)}><ChevronRight className="size-4" /></Button>
          <Button variant="ghost" size="sm" onClick={() => setCustom((v) => !v)}>Zeitraum wählen</Button>
        </div>
        {custom && (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Input type="date" aria-label="Von" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} className="w-40" />
            <span>bis</span>
            <Input type="date" aria-label="Bis" value={to} min={from} onChange={(e) => e.target.value && setTo(e.target.value)} className="w-40" />
          </div>
        )}
        {(branchData?.branches.length ?? 0) > 0 && (
          <label className="flex items-center gap-2 text-sm lg:ml-auto">
            <span className="shrink-0 text-muted-foreground">Standort</span>
            <select className={cn(selectClass, "lg:w-64")} value={standort} onChange={(e) => setStandort(e.target.value)}>
              <option value="">Alle Standorte</option>
              {branchData!.branches.map((b) => <option key={b.id} value={b.id}>{b.name}{b.customer ? " · " + b.customer.name : ""}</option>)}
            </select>
          </label>
        )}
      </div>

      {data && data.setup.payTypes === 0 && (
        <Card className="border-warn/40 bg-warn/5 p-4 text-sm">
          Noch keine Lohnart angelegt. Stunden werden angezeigt, Beträge erst mit Lohnart. <Link href="/settings" className="font-medium underline">Einstellungen › Lohn</Link>
        </Card>
      )}

      <ErrorMessage error={query.error} />

      {data && (
        <div className="grid gap-3 sm:grid-cols-3">
          <Card className="p-4"><p className="text-xs text-muted-foreground">Stunden</p><p className="text-xl font-semibold tabular-nums">{hours(data.totals.minutes)} h</p></Card>
          <Card className="p-4"><p className="text-xs text-muted-foreground">Lohnkosten (ohne Arbeitgeberanteile)</p><p className="text-xl font-semibold tabular-nums">{euro(data.totals.totalCents)}</p></Card>
          <Card className="p-4"><p className="text-xs text-muted-foreground">Personen mit Hinweis</p><p className={cn("text-xl font-semibold tabular-nums", flagged > 0 && "text-warn")}>{flagged}</p></Card>
        </div>
      )}

      <div className="relative w-full sm:max-w-xs">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name oder Personalnummer …" aria-label="Person suchen" className="pl-9" />
      </div>

      {query.isLoading ? (
        <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
      ) : data && (
        <Card className="overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Name</th>
                  <th className="hidden px-3 py-2 font-medium sm:table-cell">Personalnr.</th>
                  <th className="hidden px-3 py-2 font-medium md:table-cell">Lohnart</th>
                  <th className="px-3 py-2 text-right font-medium">Stunden</th>
                  <th className="px-3 py-2 text-right font-medium">Lohn</th>
                </tr>
              </thead>
              <tbody>
                {people.map((p) => {
                  const expanded = open.has(p.userId);
                  return (
                    <Fragment key={p.userId}>
                      <tr className="cursor-pointer border-t hover:bg-muted/40" onClick={() => toggle(p.userId)}>
                        <td className="px-3 py-2">
                          <span className="flex items-center gap-2">
                            <ChevronDown className={cn("size-4 shrink-0 text-muted-foreground transition-transform", !expanded && "-rotate-90")} />
                            <span className={cn("font-medium", !p.isActive && "text-muted-foreground")}>{name(p)}</span>
                            {p.minutes > 0 && p.warnings.length > 0 && <AlertTriangle className="size-4 text-warn" aria-label={p.warnings.join(" ")} />}
                          </span>
                        </td>
                        <td className="hidden px-3 py-2 tabular-nums sm:table-cell">{p.personnelNumber ?? <span className="text-muted-foreground">–</span>}</td>
                        <td className="hidden px-3 py-2 md:table-cell">{p.payType ? p.payType.title + " (" + euro(p.payType.hourlyRateCents) + ")" : <span className="text-muted-foreground">keine</span>}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{hours(p.minutes)}</td>
                        <td className="px-3 py-2 text-right font-medium tabular-nums">{euro(p.totalCents)}</td>
                      </tr>
                      {expanded && (
                        <tr className="border-t bg-muted/20">
                          <td colSpan={5} className="px-3 py-3">
                            <PersonDetail person={p} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
                {people.length === 0 && <tr><td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">Keine Personen gefunden.</td></tr>}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      {exporting && data && <ExportDialog report={data} standort={standort} onClose={() => setExporting(false)} />}
    </div>
  );
}

function PersonDetail({ person }: { person: Person }) {
  return (
    <div className="space-y-3">
      <p className="text-sm sm:hidden">Personalnr. {person.personnelNumber ?? "–"} · {person.payType ? person.payType.title : "keine Lohnart"}</p>
      {person.warnings.length > 0 && (
        <ul className="space-y-1 text-sm text-warn">{person.warnings.map((w) => <li key={w} className="flex items-center gap-2"><AlertTriangle className="size-4 shrink-0" />{w}</li>)}</ul>
      )}
      {person.lines.length > 0 && (
        <div>
          <p className="mb-1 text-xs font-medium text-muted-foreground">Summen</p>
          <ul className="space-y-0.5 text-sm">
            {person.lines.map((l) => <li key={l.kind + (l.refId ?? "") + (l.rateCents ?? "")} className="flex justify-between gap-4"><span>{l.title}{l.code ? <span className="text-muted-foreground"> · {l.code}</span> : null}</span><span className="tabular-nums">{lineText(l)}</span></li>)}
          </ul>
        </div>
      )}
      {person.records.length === 0 ? <p className="text-sm text-muted-foreground">Keine Zeitbuchungen im Zeitraum.</p> : (
        <div>
          <p className="mb-1 text-xs font-medium text-muted-foreground">Buchungen</p>
          <ul className="divide-y rounded-[var(--radius)] border bg-card">
            {person.records.map((r) => (
              <li key={r.id} className="space-y-1 px-3 py-2 text-sm">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-medium">{shortDate(r.date)} · {r.timeFrom && r.timeTo ? r.timeFrom + "–" + r.timeTo : "nur Dauer"}{r.breakMinutes ? " · Pause " + r.breakMinutes + " Min." : ""}</span>
                  <span className="tabular-nums">{hours(r.minutes)} h · {euro(r.totalCents)}</span>
                </div>
                <p className="text-xs text-muted-foreground">{[r.branchName, r.divisionTitle].filter(Boolean).join(" · ") || "ohne Standort"}</p>
                <ul className="text-xs text-muted-foreground">{r.lines.map((l, i) => <li key={i}>{l.title}: {lineText(l)}</li>)}</ul>
                {r.warnings.map((w) => <p key={w} className="text-xs text-warn">{w}</p>)}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function ExportDialog({ report, standort, onClose }: { report: Report; standort: string; onClose: () => void }) {
  const candidates = report.people.filter((p) => p.minutes > 0);
  const [skip, setSkip] = useState<Set<string>>(new Set());
  const [withRates, setWithRates] = useState(true);
  const [pending, setPending] = useState(false);
  const chosen = candidates.filter((p) => !skip.has(p.userId));
  async function download() {
    setPending(true);
    try {
      const url = "/api/payroll/export?from=" + report.from + "&to=" + report.to + (standort ? "&standort=" + encodeURIComponent(standort) : "") + "&saetze=" + (withRates ? "1" : "0") + (skip.size ? "&ohne=" + [...skip].join(",") : "");
      const res = await fetch(url);
      if (!res.ok) throw new Error((await res.json()).error || "Export fehlgeschlagen.");
      const href = URL.createObjectURL(await res.blob()), link = document.createElement("a");
      link.href = href; link.download = "AKRO-Lohn-" + report.from + "_" + report.to + ".csv"; link.click();
      setTimeout(() => URL.revokeObjectURL(href), 1000);
      toast.success("Lohnexport heruntergeladen.");
      onClose();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Export fehlgeschlagen."); }
    finally { setPending(false); }
  }
  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Lohnexport {longDate(report.from)} – {longDate(report.to)}</DialogTitle>
          <DialogDescription>CSV für die Lohnsoftware: eine Zeile je Person und Lohnart bzw. Zuschlag, mit Personalnummer und Code.</DialogDescription>
        </DialogHeader>
        {candidates.length === 0 ? <p className="text-sm text-muted-foreground">Keine Stunden im Zeitraum.</p> : (
          <ul className="max-h-72 divide-y overflow-y-auto rounded-[var(--radius)] border">
            {candidates.map((p) => (
              <li key={p.userId} className="flex items-center gap-2 px-3 py-2 text-sm">
                <input type="checkbox" className="size-4 accent-primary" checked={!skip.has(p.userId)} aria-label={name(p) + " exportieren"}
                  onChange={(e) => setSkip((prev) => { const next = new Set(prev); if (e.target.checked) next.delete(p.userId); else next.add(p.userId); return next; })} />
                <span className="flex-1">{name(p)}</span>
                <span className={cn("tabular-nums", !p.personnelNumber && "text-warn")}>{p.personnelNumber ?? "ohne Personalnr."}</span>
                <span className="w-20 text-right tabular-nums">{hours(p.minutes)} h</span>
              </li>
            ))}
          </ul>
        )}
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-primary" checked={withRates} onChange={(e) => setWithRates(e.target.checked)} />Sätze und Beträge aufnehmen (sonst nur Stunden)</label>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Abbrechen</Button>
          <Button disabled={pending || chosen.length === 0} onClick={download}><Download className="size-4" />{pending ? "Wird erstellt …" : "CSV herunterladen (" + chosen.length + ")"}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
