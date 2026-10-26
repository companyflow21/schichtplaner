"use client";

import { Fragment, useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, Check, ChevronDown, ChevronLeft, ChevronRight, Download, MapPin, Pencil, Plus, Printer, Search, Undo2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { InfoHint } from "@/components/ui/info-hint";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ErrorMessage, json, selectClass } from "@/components/workforce/client";
import { TimeRecordForm } from "@/components/time/time-record-form";
import { SiteReportButton, TimesheetButton } from "./timesheet-button";
import { TimeAccountDialog, signedHours } from "./time-account-dialog";
import { addDate, berlinDate } from "@/lib/berlin";
import { useNameFormat } from "@/lib/hooks/use-current-member";
import { formatName } from "@/lib/names";
import { euro, formatNumber, hours, type PayLine } from "@/lib/payroll";
import { cn } from "@/lib/utils";

type Status = "APPROVED" | "OPEN" | "MISSING" | "PLANNED" | "RUNNING" | "ABSENT";
/** OPEN, REVIEWED (von Pruefenden) oder AUTO (ohne Pruefer: Altbestand bei Einfuehrung oder automatische Genehmigung). */
type Approval = "OPEN" | "REVIEWED" | "AUTO";
type RecordView = {
  id: string; userId: string | null; category: { id: string; name: string } | null; type: "MANUAL" | "WATCH" | "MANUAL_DURATION"; date: string; timeFrom: string | null; timeTo: string | null; durationHours: number | null; durationMinutes: number | null;
  breakSeconds: number; categoryId: string | null; comment: string | null; branchName: string | null; minutes: number; running: boolean; approved: boolean; approval: Approval;
  pendingCorrection: boolean; checkin: { method: string; status: string; lateMinutes: number; distanceM: number | null } | null; canEdit: boolean; canApprove: boolean;
  pay: { totalCents: number; lines: PayLine[]; warnings: string[] } | null;
};
type Row = {
  key: string; date: string; status: Status; canEnter: boolean; plannedMinutes: number;
  /** category nur fuer die Person selbst, die Administration und wer ihre Abwesenheiten entscheidet. */
  absence: { category: string | null; handling: "PAID" | "UNPAID" | "RELEASED" | null; pay: { totalCents: number; lines: PayLine[]; warnings: string[] } | null } | null; istMinutes: number; deviationMinutes: number | null;
  shift: { id: string; from: string; to: string; title: string | null; branchName: string | null; customerName: string | null; division: { title: string; color: string } | null; pauseMinutes: number } | null;
  records: RecordView[];
};
/** key: userId, bei geloeschten Personen "former:" + Id (userId null). pay nur fuer die Administration. */
type Person = {
  key: string; userId: string | null; former: boolean; firstName: string; lastName: string; isActive: boolean; personnelNumber: string | null;
  plannedMinutes: number; istMinutes: number; openCount: number; missingCount: number; approvable: string[]; totalCents: number | null; balanceMinutes: number | null;
  pay: { payType: { title: string; hourlyRateCents: number } | null; lines: PayLine[]; warnings: string[] } | null; rows: Row[];
};
type Report = {
  from: string; to: string; showPay: boolean; showBalance: boolean; people: Person[]; notices: string[]; setup: { payTypes: number; surcharges: number } | null;
  totals: { plannedMinutes: number; istMinutes: number; openCount: number; totalCents: number | null };
};
type BranchOption = { id: string; name: string; archivedAt?: string | null; customer?: { name: string } | null };

const monthStart = (date: string) => date.slice(0, 8) + "01";
const monthEnd = (date: string) => addDate(addDate(monthStart(date), 32).slice(0, 8) + "01", -1);
const longDate = (date: string) => new Date(date + "T12:00:00Z").toLocaleDateString("de-DE", { timeZone: "UTC", day: "numeric", month: "long", year: "numeric" });
const shortDate = (date: string) => new Date(date + "T12:00:00Z").toLocaleDateString("de-DE", { timeZone: "UTC", weekday: "short", day: "2-digit", month: "2-digit" });
const monthTitle = (date: string) => new Date(date + "T12:00:00Z").toLocaleDateString("de-DE", { timeZone: "UTC", month: "long", year: "numeric" });
const signed = (minutes: number) => (minutes > 0 ? "+" : minutes < 0 ? "−" : "") + hours(Math.abs(minutes));
const formerBadge = <Badge variant="outline" className="text-xs font-normal text-muted-foreground">gelöscht</Badge>;

const STATUS: Record<Status, { label: string; className: string; bar: string }> = {
  APPROVED: { label: "genehmigt", className: "bg-ok/10 text-ok", bar: "bg-ok" },
  OPEN: { label: "offen", className: "bg-warn/10 text-warn", bar: "bg-warn" },
  MISSING: { label: "nicht erfasst", className: "bg-destructive/10 text-destructive", bar: "bg-destructive" },
  PLANNED: { label: "geplant", className: "bg-muted text-muted-foreground", bar: "bg-muted-foreground/30" },
  RUNNING: { label: "läuft", className: "bg-primary/10 text-primary", bar: "bg-primary" },
  ABSENT: { label: "abwesend", className: "bg-accent text-accent-foreground", bar: "bg-accent-foreground/40" },
};
const AUTO_TITLE = "Ohne Prüfer genehmigt: Altbestand, bei Einführung der Stundenprüfung automatisch übernommen, oder Einstellung „Selbst erfasste Zeiten automatisch genehmigen“.";

/** Rechenweg einer Zeile: "8,00 h × 15,00 € = 120,00 €" bzw. mit Prozentsatz. */
function lineText(l: PayLine): string {
  const amount = l.rateCents === null ? "ohne Satz" : euro(l.amountCents);
  const rate = l.rateCents === null ? "" : " × " + (l.percent !== null ? formatNumber(l.percent / 100) + " % (" + euro(l.rateCents) + ")" : euro(l.rateCents));
  return hours(l.minutes) + " h" + rate + " = " + amount;
}
function recordTime(r: RecordView): string {
  if (r.running) return "seit " + (r.timeFrom ?? "–");
  return r.timeFrom && r.timeTo ? r.timeFrom + "–" + r.timeTo : "nur Dauer";
}

/**
 * Stunden pruefen, genehmigen und abrechnen. Die fruehere Lohnseite (/payroll)
 * ist hier aufgegangen: Lohn, Lohnart, Hinweise und Lohnexport sieht nur die
 * Administration (der Server liefert sie nur ihr).
 */
export function HoursView() {
  const today = berlinDate();
  const client = useQueryClient();
  const nameFormat = useNameFormat();
  const name = (p: Pick<Person, "firstName" | "lastName">) => formatName(p, nameFormat);
  const [from, setFrom] = useState(monthStart(today));
  const [to, setTo] = useState(monthEnd(today));
  const [custom, setCustom] = useState(false);
  const [standort, setStandort] = useState("");
  const [search, setSearch] = useState("");
  const [onlyOpen, setOnlyOpen] = useState(false);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState(false);
  const [editing, setEditing] = useState<RecordView | null>(null);
  const [account, setAccount] = useState<Person | null>(null);
  const [entering, setEntering] = useState<{ userId: string; date: string; timeFrom: string; timeTo: string; breakMinutes: number } | null>(null);
  const wholeMonth = from === monthStart(from) && to === monthEnd(from);
  const params = "from=" + from + "&to=" + to + (standort ? "&standort=" + encodeURIComponent(standort) : "");
  // Archivierte Einsatzorte bleiben auswertbar (vergangene Stunden).
  const { data: branchData } = useQuery({ queryKey: ["branches", "VIEW_TIME", "archived"], queryFn: () => json<{ branches: BranchOption[] }>("/api/branches?right=VIEW_TIME&archived=include") });
  const query = useQuery({ queryKey: ["hours", from, to, standort], queryFn: () => json<Report>("/api/hours?" + params), enabled: from <= to });
  const approve = useMutation({
    mutationFn: (v: { ids: string[]; approved: boolean }) => json<{ updated: number }>("/api/time/approve", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(v) }),
    onSuccess: (r, v) => { toast.success(v.approved ? r.updated + (r.updated === 1 ? " Buchung genehmigt" : " Buchungen genehmigt") : "Genehmigung zurückgenommen"); client.invalidateQueries({ queryKey: ["hours"] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  const data = query.data;
  const people = useMemo(() => (data?.people ?? []).filter((p) => (!onlyOpen || p.openCount > 0 || p.missingCount > 0) && (formatName(p, nameFormat).toLowerCase().includes(search.trim().toLowerCase()) || (p.personnelNumber ?? "").includes(search.trim()))), [data, search, onlyOpen, nameFormat]);
  const shiftMonth = (delta: -1 | 1) => { const start = delta < 0 ? monthStart(addDate(monthStart(from), -1)) : addDate(monthEnd(from), 1); setFrom(start); setTo(monthEnd(start)); setCustom(false); };
  const toggle = (id: string) => setOpen((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const cols = 6 + (data?.showPay ? 1 : 0) + (data?.showBalance ? 1 : 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="flex items-center gap-1 text-[22px] leading-none font-[560] tracking-[-0.03em]">
            Stunden und Lohn
            <InfoHint thema="Stunden und Lohn" titel="So wird geprüft">
              <p>Je Schicht stehen Plan und Ist nebeneinander. „nicht erfasst“: Schicht vorbei, keine Zeit – sie zählt nicht als gearbeitet; „Zeit wie geplant nachtragen“ erfasst sie.</p>
              <p>Genehmigen: Administration, oder Disposition mit „Zeiterfassung bearbeiten“ am Standort und „Stunden einsehen“ für die Person. Eigene Stunden genehmigt nur die Administration.</p>
              <p>„abwesend“: genehmigte Abwesenheit ohne erfasste Zeit – bezahlt mit Planstunden oder 0 Stunden, wie beim Genehmigen gewählt.</p>
              <p>„Saldo“ (wenn Zeitkonten eingeschaltet sind): Stand des Zeitkontos am Ende des gewählten Zeitraums; Tage nach heute zählen mit Planstunden.</p>
              <p>Vorläufig (AKRO entscheidet): Die Genehmigung ändert Lohn, Lohnexport und Zeitkonto nicht – offene Stunden sind enthalten.</p>
            </InfoHint>
          </h1>
          <p className="text-sm text-muted-foreground">Plan und Ist je Schicht prüfen, korrigieren und genehmigen{data?.showPay ? " – mit Lohn und Lohnexport" : ""}</p>
        </div>
        <div className="flex flex-wrap gap-2 print:hidden">
          {standort && <SiteReportButton branchId={standort} from={from} to={to} />}
          <Button size="sm" variant="outline" onClick={() => window.print()}><Printer className="size-4" />Drucken</Button>
          {data?.showPay && <Button size="sm" onClick={() => setExporting(true)}><Download className="size-4" />Lohnexport</Button>}
        </div>
      </div>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center print:hidden">
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
              {branchData!.branches.map((b) => <option key={b.id} value={b.id}>{b.name}{b.customer ? " · " + b.customer.name : ""}{b.archivedAt ? " (archiviert)" : ""}</option>)}
            </select>
          </label>
        )}
      </div>
      <p className="hidden text-sm print:block">Zeitraum: {longDate(from)} – {longDate(to)}</p>

      {data?.showPay && data.setup?.payTypes === 0 && (
        <Card className="border-warn/40 bg-warn/5 p-4 text-sm print:hidden">
          Noch keine Lohnart angelegt. Stunden werden angezeigt, Beträge erst mit Lohnart. <Link href="/settings?bereich=payroll" className="font-medium underline">Einstellungen › Lohnarten/Zuschläge</Link>
        </Card>
      )}

      {data && data.notices.length > 0 && (
        <div className="space-y-1 rounded-[var(--radius)] border border-warn/40 bg-warn/[0.06] px-3 py-2 text-[13px] print:hidden">
          {data.notices.map((n) => <p key={n} className="flex items-start gap-2"><AlertTriangle className="mt-0.5 size-4 shrink-0 text-warn" />{n}</p>)}
          <p className="flex flex-wrap gap-x-4">
            {data.notices.some((n) => n.startsWith("Für Einsatzort")) && <Link href="/divisions" className="font-medium text-primary underline-offset-4 hover:underline">Bundesland festlegen</Link>}
            {data.notices.some((n) => n.startsWith("Für Zeiten ohne Einsatzort")) && <Link href="/settings?bereich=absences" className="font-medium text-primary underline-offset-4 hover:underline">Feiertage der Organisation</Link>}
          </p>
        </div>
      )}

      <ErrorMessage error={query.error} />

      {data && (
        <div className={cn("grid gap-3 sm:grid-cols-2", data.showPay ? "lg:grid-cols-4" : "lg:grid-cols-3")}>
          <Card className="p-4"><p className="text-xs text-muted-foreground">Ist / Plan</p><p className="text-xl font-semibold tabular-nums">{hours(data.totals.istMinutes)} / {hours(data.totals.plannedMinutes)} h</p></Card>
          <Card className="p-4"><p className="text-xs text-muted-foreground">Abweichung</p><p className="text-xl font-semibold tabular-nums">{signed(data.totals.istMinutes - data.totals.plannedMinutes)} h</p></Card>
          <Card className="p-4"><p className="text-xs text-muted-foreground">Offene Buchungen</p><p className={cn("text-xl font-semibold tabular-nums", data.totals.openCount > 0 && "text-warn")}>{data.totals.openCount}</p></Card>
          {data.showPay && <Card className="p-4"><p className="text-xs text-muted-foreground">Lohnkosten (ohne Arbeitgeberanteile)</p><p className="text-xl font-semibold tabular-nums">{euro(data.totals.totalCents ?? 0)}</p></Card>}
        </div>
      )}

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center print:hidden">
        <div className="relative w-full sm:max-w-xs">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={data?.showPay ? "Name oder Personalnummer …" : "Name …"} aria-label="Person suchen" className="pl-9" />
        </div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-primary" checked={onlyOpen} onChange={(e) => setOnlyOpen(e.target.checked)} />Nur mit offenen oder fehlenden Zeiten</label>
        {data?.showPay && (
          <span className="flex flex-wrap gap-x-4 text-sm sm:ml-auto">
            <Link href="/settings?bereich=time" className="text-muted-foreground underline">Automatisch genehmigen</Link>
            <Link href="/settings?bereich=payroll" className="text-muted-foreground underline">Lohneinstellungen</Link>
          </span>
        )}
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
                  {data.showPay && <th className="hidden px-3 py-2 font-medium md:table-cell">Personalnr.</th>}
                  <th className="hidden px-3 py-2 text-right font-medium sm:table-cell">Plan</th>
                  <th className="px-3 py-2 text-right font-medium">Ist</th>
                  <th className="hidden px-3 py-2 text-right font-medium sm:table-cell">Abw.</th>
                  {data.showBalance && <th className="hidden px-3 py-2 text-right font-medium sm:table-cell">Saldo</th>}
                  {data.showPay && <th className="px-3 py-2 text-right font-medium">Lohn</th>}
                  <th className="px-3 py-2 text-right font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {people.map((p) => {
                  const expanded = open.has(p.key);
                  const warned = !!p.pay && p.istMinutes > 0 && p.pay.warnings.length > 0;
                  return (
                    <Fragment key={p.key}>
                      <tr className="cursor-pointer border-t hover:bg-muted/40" onClick={() => toggle(p.key)}>
                        <td className="px-3 py-2">
                          <span className="flex items-center gap-2">
                            <ChevronDown className={cn("size-4 shrink-0 text-muted-foreground transition-transform print:hidden", !expanded && "-rotate-90")} />
                            <span className={cn("font-medium", !p.isActive && "text-muted-foreground")}>{name(p)}</span>
                            {p.former && formerBadge}
                            {warned && <AlertTriangle className="size-4 text-warn" aria-label={p.pay!.warnings.join(" ")} />}
                          </span>
                        </td>
                        {data.showPay && <td className="hidden px-3 py-2 tabular-nums md:table-cell">{p.personnelNumber ?? <span className="text-muted-foreground">–</span>}</td>}
                        <td className="hidden px-3 py-2 text-right tabular-nums sm:table-cell">{hours(p.plannedMinutes)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{hours(p.istMinutes)}</td>
                        <td className="hidden px-3 py-2 text-right tabular-nums sm:table-cell">{signed(p.istMinutes - p.plannedMinutes)}</td>
                        {data.showBalance && (
                          <td className="hidden px-3 py-2 text-right sm:table-cell">
                            {p.balanceMinutes === null ? <span className="text-xs text-muted-foreground">–</span>
                              : <button type="button" className={cn("rounded-md px-2 py-0.5 tabular-nums hover:bg-muted", p.balanceMinutes < 0 && "text-destructive")} onClick={(e) => { e.stopPropagation(); setAccount(p); }}>{signedHours(p.balanceMinutes)}</button>}
                          </td>
                        )}
                        {data.showPay && <td className="whitespace-nowrap px-3 py-2 text-right font-medium tabular-nums">{euro(p.totalCents ?? 0)}</td>}
                        <td className="whitespace-nowrap px-3 py-2 text-right">
                          {p.openCount > 0 ? <span className="rounded-full bg-warn/10 px-2 py-0.5 text-xs text-warn">{p.openCount} offen</span>
                            : p.missingCount > 0 ? <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-xs text-destructive">{p.missingCount} fehlt</span>
                            : p.rows.length ? <Check className="ml-auto size-4 text-ok" aria-label="alles genehmigt" /> : null}
                        </td>
                      </tr>
                      {expanded && (
                        <tr className="border-t bg-muted/20">
                          <td colSpan={cols} className="px-3 py-3">
                            <div className="space-y-2">
                              <div className="flex flex-wrap justify-end gap-2 print:hidden">
                                {p.userId && <TimesheetButton userId={p.userId} from={from} to={to} />}
                                {p.userId && p.balanceMinutes !== null && <Button size="sm" variant="outline" onClick={() => setAccount(p)}>Zeitkonto {signedHours(p.balanceMinutes)} h</Button>}
                                {p.approvable.length > 0 && <Button size="sm" disabled={approve.isPending} onClick={() => approve.mutate({ ids: p.approvable, approved: true })}><Check className="size-4" />Alle offenen genehmigen ({p.approvable.length})</Button>}
                              </div>
                              {p.former && <p className="text-xs text-muted-foreground">Gelöschte Person: Die Zeiten bleiben als Historie unverändert und lassen sich nur genehmigen; nachgetragen wird nichts.</p>}
                              {p.pay && <PayDetail person={p} />}
                              {p.rows.length === 0 ? <p className="text-sm text-muted-foreground">Keine Schichten und keine Buchungen im Zeitraum.</p> : (
                                <ul className="divide-y overflow-hidden rounded-[var(--radius)] border bg-card">
                                  {p.rows.map((row) => <RowItem key={row.key} row={row} showPay={data.showPay} userId={p.userId} busy={approve.isPending}
                                    onApprove={(ids, approved) => approve.mutate({ ids, approved })} onEdit={setEditing} onEnter={setEntering} />)}
                                </ul>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
                {people.length === 0 && <tr><td colSpan={cols} className="px-3 py-6 text-center text-muted-foreground">Keine Personen gefunden.</td></tr>}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      {account?.userId && <TimeAccountDialog userId={account.userId} name={name(account)} from={from} to={to} onClose={() => setAccount(null)} />}
      {exporting && data && <ExportDialog report={data} standort={standort} onClose={() => setExporting(false)} />}
      {/* record: bearbeitbar sind nur Buchungen mit Konto (canEdit), userId ist dort gesetzt. */}
      <TimeRecordForm open={!!editing} onOpenChange={(v) => { if (!v) setEditing(null); }} record={editing ? { ...editing, userId: editing.userId ?? "" } : null} direct />
      <TimeRecordForm open={!!entering} onOpenChange={(v) => { if (!v) setEntering(null); }} defaults={entering ?? undefined} />
    </div>
  );
}

/** Lohnart, Summen je Lohnart und Zuschlag sowie Hinweise einer Person - nur Administration. */
function PayDetail({ person }: { person: Person }) {
  const pay = person.pay!;
  return (
    <div className="space-y-2 rounded-[var(--radius)] border bg-card px-3 py-2">
      <p className="text-sm"><span className="md:hidden">Personalnr. {person.personnelNumber ?? "–"} · </span>Lohnart: {pay.payType ? pay.payType.title + " (" + euro(pay.payType.hourlyRateCents) + ")" : "keine"}</p>
      {pay.warnings.length > 0 && (
        <ul className="space-y-1 text-sm text-warn">{pay.warnings.map((w) => <li key={w} className="flex items-center gap-2"><AlertTriangle className="size-4 shrink-0" />{w}</li>)}</ul>
      )}
      {pay.lines.length > 0 && (
        <div>
          <p className="mb-1 text-xs font-medium text-muted-foreground">Summen</p>
          <ul className="space-y-0.5 text-sm">
            {pay.lines.map((l) => <li key={l.kind + (l.refId ?? "") + (l.rateCents ?? "")} className="flex flex-wrap justify-between gap-x-4"><span>{l.title}{l.code ? <span className="text-muted-foreground"> · {l.code}</span> : null}</span><span className="tabular-nums">{lineText(l)}</span></li>)}
          </ul>
        </div>
      )}
    </div>
  );
}

function RowItem({ row, showPay, userId, busy, onApprove, onEdit, onEnter }: {
  row: Row; showPay: boolean; userId: string | null; busy: boolean;
  onApprove: (ids: string[], approved: boolean) => void; onEdit: (r: RecordView) => void;
  onEnter: (v: { userId: string; date: string; timeFrom: string; timeTo: string; breakMinutes: number }) => void;
}) {
  const s = STATUS[row.status];
  const rowPay = row.records.reduce((sum, r) => sum + (r.pay?.totalCents ?? 0), 0) + (row.absence?.pay?.totalCents ?? 0);
  return (
    <li className="flex">
      <span className={cn("w-1 shrink-0", s.bar)} aria-hidden />
      <div className="flex-1 space-y-1.5 px-3 py-2 text-sm">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <span className="font-medium">{shortDate(row.date)}{row.shift ? " · Plan " + row.shift.from + "–" + row.shift.to + (row.shift.pauseMinutes ? " (Pause " + row.shift.pauseMinutes + " Min.)" : "") : " · ohne geplante Schicht"}</span>
          <span className="flex items-center gap-2">
            <span className="tabular-nums">{row.records.length || row.absence ? hours(row.istMinutes) + " h" : row.shift ? hours(row.plannedMinutes) + " h geplant" : ""}</span>
            {row.deviationMinutes !== null && row.deviationMinutes !== 0 && <span className={cn("tabular-nums text-xs", Math.abs(row.deviationMinutes) >= 15 ? "text-warn" : "text-muted-foreground")}>{signed(row.deviationMinutes)}</span>}
            {showPay && (row.records.length > 0 || row.absence) && <span className="whitespace-nowrap tabular-nums">{euro(rowPay)}</span>}
            <span className={cn("rounded-full px-2 py-0.5 text-xs", s.className)}>{s.label}</span>
          </span>
        </div>
        {row.shift && (
          <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
            {row.shift.division && <span className="inline-flex items-center gap-1"><span className="size-2 rounded-full" style={{ backgroundColor: row.shift.division.color }} />{row.shift.division.title}</span>}
            <span>{[row.shift.branchName, row.shift.customerName].filter(Boolean).join(" · ")}</span>
            {row.shift.title && <span>· {row.shift.title}</span>}
          </p>
        )}
        {row.absence && (
          <div className="space-y-1 rounded-md bg-muted/40 px-2 py-1.5">
            <p>{row.absence.category ? "Abwesenheit: " + row.absence.category : "Genehmigte Abwesenheit"} · {row.absence.handling === "PAID" ? "bezahlt mit Planstunden" : row.absence.handling === "UNPAID" ? "zählt 0 Stunden" : row.absence.handling === "RELEASED" ? "aus der Schicht ausgetragen" : "ohne Festlegung (0 Stunden)"}</p>
            {showPay && row.absence.pay && <ul className="text-xs text-muted-foreground">{row.absence.pay.lines.map((l, i) => <li key={i}>{lineText(l)}</li>)}</ul>}
          </div>
        )}
        {row.records.map((r) => (
          <div key={r.id} className="space-y-1 rounded-md bg-muted/40 px-2 py-1.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="flex flex-wrap items-center gap-x-2">
                <span className="tabular-nums">Ist {recordTime(r)}{r.breakSeconds ? " · Pause " + Math.round(r.breakSeconds / 60) + " Min." : ""}{r.running ? "" : " · " + hours(r.minutes) + " h"}</span>
                {r.checkin && <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><MapPin className="size-3" />{r.checkin.method === "GPS" ? "GPS-Check-in" : "Check-in freigegeben"}{r.checkin.lateMinutes > 0 ? ", " + r.checkin.lateMinutes + " Min. später" : ""}</span>}
                {!row.shift && r.branchName && <span className="text-xs text-muted-foreground">{r.branchName}</span>}
                {r.pendingCorrection && <span className="rounded-full bg-warn/10 px-2 py-0.5 text-xs text-warn">Korrektur beantragt</span>}
                {!r.running && (r.approval === "AUTO"
                  ? <span className="text-xs text-ok" title={AUTO_TITLE}>automatisch übernommen</span>
                  : <span className={cn("text-xs", r.approved ? "text-ok" : "text-warn")}>{r.approved ? "genehmigt" : "nicht genehmigt"}</span>)}
              </span>
              <span className="flex gap-1.5 print:hidden">
                {r.canEdit && <Button size="sm" variant="outline" onClick={() => onEdit(r)}><Pencil className="size-3.5" />Bearbeiten</Button>}
                {r.canApprove && !r.approved && <Button size="sm" disabled={busy} onClick={() => onApprove([r.id], true)}><Check className="size-3.5" />Genehmigen</Button>}
                {r.canApprove && r.approved && <Button size="sm" variant="ghost" disabled={busy} onClick={() => onApprove([r.id], false)} aria-label="Genehmigung zurücknehmen"><Undo2 className="size-3.5" /></Button>}
              </span>
            </div>
            {r.comment && <p className="text-xs text-muted-foreground">„{r.comment}“</p>}
            {showPay && r.pay && (
              <ul className="text-xs text-muted-foreground">
                {r.pay.lines.map((l, i) => <li key={i}>{l.title}: {lineText(l)}</li>)}
                {r.pay.warnings.map((w) => <li key={w} className="flex items-center gap-1 text-warn"><AlertTriangle className="size-3" />{w}</li>)}
              </ul>
            )}
          </div>
        ))}
        {row.status === "MISSING" && row.canEnter && row.shift && userId && (
          <div className="print:hidden">
            <Button size="sm" variant="outline" onClick={() => onEnter({ userId, date: row.date, timeFrom: row.shift!.from, timeTo: row.shift!.to, breakMinutes: row.shift!.pauseMinutes })}><Plus className="size-3.5" />Zeit wie geplant nachtragen</Button>
          </div>
        )}
      </div>
    </li>
  );
}

function ExportDialog({ report, standort, onClose }: { report: Report; standort: string; onClose: () => void }) {
  const candidates = report.people.filter((p) => p.istMinutes > 0);
  const openCount = candidates.reduce((s, p) => s + p.openCount, 0);
  const [skip, setSkip] = useState<Set<string>>(new Set());
  const [withRates, setWithRates] = useState(true);
  const [pending, setPending] = useState(false);
  const nameFormat = useNameFormat();
  const chosen = candidates.filter((p) => !skip.has(p.key));
  async function download() {
    setPending(true);
    try {
      const url = "/api/payroll/export?from=" + report.from + "&to=" + report.to + (standort ? "&standort=" + encodeURIComponent(standort) : "") + "&saetze=" + (withRates ? "1" : "0") + (skip.size ? "&ohne=" + encodeURIComponent([...skip].join(",")) : "");
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
        {openCount > 0 && <p className="flex items-center gap-2 rounded-md bg-warn/10 p-2 text-sm text-warn"><AlertTriangle className="size-4 shrink-0" />{openCount} {openCount === 1 ? "Buchung ist" : "Buchungen sind"} noch nicht genehmigt und trotzdem enthalten.</p>}
        {candidates.length === 0 ? <p className="text-sm text-muted-foreground">Keine Stunden im Zeitraum.</p> : (
          <ul className="max-h-72 divide-y overflow-y-auto rounded-[var(--radius)] border">
            {candidates.map((p) => (
              <li key={p.key} className="flex items-center gap-2 px-3 py-2 text-sm">
                <input type="checkbox" className="size-4 accent-primary" checked={!skip.has(p.key)} aria-label={formatName(p, nameFormat) + " exportieren"}
                  onChange={(e) => setSkip((prev) => { const next = new Set(prev); if (e.target.checked) next.delete(p.key); else next.add(p.key); return next; })} />
                <span className="flex flex-1 items-center gap-2">{formatName(p, nameFormat)}{p.former && formerBadge}</span>
                <span className={cn("tabular-nums", !p.personnelNumber && "text-warn")}>{p.personnelNumber ?? "ohne Personalnr."}</span>
                <span className="w-20 text-right tabular-nums">{hours(p.istMinutes)} h</span>
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
