"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FileDown, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ErrorMessage, json, selectClass } from "@/components/workforce/client";
import { berlinDate, isoWeek, validDate, weekDate } from "@/lib/berlin";
import { monthNames } from "@/lib/utils/calendar";
import type { ScheduleExport } from "@/types/schedule-export";

const MAX_DAYS = 62;

type ViewBranch = { id: string; name: string; customer: { id: string; name: string } | null };
export type PdfExportProps = {
  /** Angezeigte Kalenderwoche (Wochenansichten). */
  week?: { year: number; weekNumber: number };
  /** Angezeigter Monat (Monatsansicht), month 1-12. */
  month?: { year: number; month: number };
  /** Standort der Ansicht; wird vorbelegt. Ohne Namen genuegt die ID. */
  branch?: ViewBranch | null;
  branchId?: string | null;
  /** Ausgewaehlte Person der Ansicht; wird vorbelegt. */
  userId?: string | null;
};

const pad = (n: number) => String(n).padStart(2, "0");
const monthRange = (year: number, month: number) => ({ from: year + "-" + pad(month) + "-01", to: year + "-" + pad(month) + "-" + pad(new Date(Date.UTC(year, month, 0)).getUTCDate()) });
const weekRange = (year: number, weekNumber: number) => ({ from: weekDate(year, weekNumber), to: weekDate(year, weekNumber, 7) });
const days = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1;

/** Wochen- und Monatsvorgabe zur Ansicht: Wochenansicht -> Woche und deren Monat; Monatsansicht -> Monat und eine Woche darin. */
function presets({ week, month }: Pick<PdfExportProps, "week" | "month">) {
  const today = berlinDate();
  if (month) {
    const m = monthRange(month.year, month.month);
    const w = isoWeek(today >= m.from && today <= m.to ? today : m.from);
    return { week: { ...weekRange(w.year, w.weekNumber), label: "KW " + w.weekNumber }, month: { ...m, label: monthNames[month.month - 1] + " " + month.year }, start: "month" as const };
  }
  const w = week ?? isoWeek(today);
  const thursday = weekDate(w.year, w.weekNumber, 4);
  const y = Number(thursday.slice(0, 4)), mo = Number(thursday.slice(5, 7));
  return { week: { ...weekRange(w.year, w.weekNumber), label: "KW " + w.weekNumber }, month: { ...monthRange(y, mo), label: monthNames[mo - 1] + " " + y }, start: "week" as const };
}

let logoCache: Promise<string | undefined> | undefined;
/** Logo als Data-URL; ohne Logo entsteht das PDF trotzdem. */
function loadLogo(): Promise<string | undefined> {
  logoCache ??= fetch("/akro/img/app-icon-192.png")
    .then(res => (res.ok ? res.blob() : Promise.reject(new Error("Logo fehlt"))))
    .then(blob => new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    }))
    .catch(() => { logoCache = undefined; return undefined; });
  return logoCache;
}

/**
 * Button "Als PDF exportieren" mit Auswahl von Zeitraum, Kunde, Standort und
 * Mitarbeiter. Die Daten kommen vom Server (nur Sichtbares), das PDF entsteht
 * im Browser - es wird nichts hochgeladen. jsPDF wird erst beim Erstellen geladen.
 */
export function PdfExportDialog(props: PdfExportProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setOpen(true)}>
        <FileDown className="size-3.5" />
        Als PDF exportieren
      </Button>
      {open && <PdfExportForm {...props} onClose={() => setOpen(false)} />}
    </>
  );
}

function PdfExportForm({ week, month, branch, branchId: viewBranchId, userId, onClose }: PdfExportProps & { onClose: () => void }) {
  const preset = presets({ week, month });
  const [range, setRange] = useState<{ from: string; to: string }>({ from: preset[preset.start].from, to: preset[preset.start].to });
  const [customerId, setCustomerId] = useState("");
  const initialBranch = branch?.id ?? viewBranchId ?? "";
  const [branchId, setBranchId] = useState(initialBranch === "ohne" ? "" : initialBranch);
  const [person, setPerson] = useState(userId ?? "");
  const [busy, setBusy] = useState(false);

  const { from, to } = range;
  const span = validDate(from) && validDate(to) ? days(from, to) : null;
  const problem = span === null ? "Bitte Beginn und Ende des Zeitraums angeben." : span < 1 ? "Das Ende liegt vor dem Beginn." : span > MAX_DAYS ? "Der Zeitraum darf höchstens " + MAX_DAYS + " Tage umfassen." : null;

  // Auswahl: was im Zeitraum sichtbar ist (ohne Filter), dazu der Standort der Ansicht.
  const options = useQuery({
    queryKey: ["schedule-export-options", from, to],
    queryFn: () => json<ScheduleExport>("/api/schedules/export?from=" + from + "&to=" + to),
    enabled: !problem,
    staleTime: 30_000,
    retry: false,
  });
  const data = options.data;
  const customers = new Map((data?.customers ?? []).map(c => [c.id, c.name]));
  const branches = new Map((data?.branches ?? []).map(b => [b.id, b]));
  if (branch && branch.id !== "ohne") {
    branches.set(branch.id, { id: branch.id, name: branch.name, customerId: branch.customer?.id ?? null });
    if (branch.customer) customers.set(branch.customer.id, branch.customer.name);
  }
  const customerList = [...customers].sort((a, b) => a[1].localeCompare(b[1], "de"));
  const branchList = [...branches.values()].filter(b => !customerId || b.customerId === customerId).sort((a, b) => a.name.localeCompare(b.name, "de"));
  const people = data?.people ?? [];
  const rows = data?.rows ?? [];
  const openPlaces = rows.reduce((sum, r) => sum + r.open, 0);

  async function generate() {
    setBusy(true);
    try {
      const params = new URLSearchParams({ from, to });
      if (customerId) params.set("customerId", customerId);
      if (branchId) params.set("branchId", branchId);
      if (person) params.set("userId", person);
      const result = await json<ScheduleExport>("/api/schedules/export?" + params);
      // jsPDF und die Tabellenbibliothek werden erst jetzt nachgeladen.
      const [{ buildSchedulePdf, schedulePdfFileName }, logoPng] = await Promise.all([import("@/lib/pdf/schedule-pdf"), loadLogo()]);
      buildSchedulePdf(result, { logoPng }).save(schedulePdfFileName(result));
      toast.success(result.rows.length ? "PDF erstellt (" + result.rows.length + (result.rows.length === 1 ? " Schicht)." : " Schichten).") : "PDF erstellt – im Zeitraum gibt es keine Schichten.");
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Das PDF konnte nicht erstellt werden.");
    } finally {
      setBusy(false);
    }
  }

  const quick = (label: string, value: { from: string; to: string }) => (
    <Button type="button" size="sm" variant={range.from === value.from && range.to === value.to ? "default" : "outline"} onClick={() => setRange(value)}>
      {label}
    </Button>
  );

  return (
    <Dialog open onOpenChange={next => { if (!next && !busy) onClose(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Dienstplan als PDF exportieren</DialogTitle>
          <DialogDescription>
            Das PDF enthält nur Schichten und Namen, die du im Dienstplan sehen darfst, und wird in deinem Browser erstellt – es wird nichts hochgeladen.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label>Zeitraum</Label>
            <div className="flex flex-wrap gap-2">
              {quick("Diese Woche (" + preset.week.label + ")", preset.week)}
              {quick("Dieser Monat (" + preset.month.label + ")", preset.month)}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="grid gap-1 text-[13px]">Von<Input type="date" value={from} onChange={e => setRange({ from: e.target.value, to })} aria-invalid={!!problem} /></label>
              <label className="grid gap-1 text-[13px]">Bis<Input type="date" value={to} min={from} onChange={e => setRange({ from, to: e.target.value })} aria-invalid={!!problem} /></label>
            </div>
            {problem && <p role="alert" className="text-[13px] text-destructive">{problem}</p>}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1 text-[13px]">Kunde
              <select className={selectClass} value={customerId} onChange={e => { setCustomerId(e.target.value); if (branchId && e.target.value && branches.get(branchId)?.customerId !== e.target.value) setBranchId(""); }}>
                <option value="">Alle Kunden</option>
                {customerList.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
              </select>
            </label>
            <label className="grid gap-1 text-[13px]">Standort
              <select className={selectClass} value={branchId} onChange={e => setBranchId(e.target.value)}>
                <option value="">Alle Standorte</option>
                {branchList.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                {branchId && !branches.has(branchId) && <option value={branchId}>Standort der Ansicht</option>}
              </select>
            </label>
            {(people.length > 0 || person) && (
              <label className="grid gap-1 text-[13px] sm:col-span-2">Mitarbeiter
                <select className={selectClass} value={person} onChange={e => setPerson(e.target.value)}>
                  <option value="">Alle Mitarbeiter</option>
                  {people.map(p => <option key={p.userId} value={p.userId}>{p.name}</option>)}
                </select>
              </label>
            )}
          </div>

          <div className="min-h-5 text-[13px] text-muted-foreground" aria-live="polite">
            {problem ? null : options.isPending ? "Lädt …" : data ? (
              rows.length ? <>Im Zeitraum: {rows.length} {rows.length === 1 ? "Schicht" : "Schichten"}{openPlaces ? ", " + openPlaces + (openPlaces === 1 ? " Platz offen" : " Plätze offen") : ""} (ohne Filter).</> : "Im Zeitraum gibt es keine Schichten."
            ) : null}
          </div>
          <ErrorMessage error={options.error} />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Abbrechen</Button>
          <Button onClick={generate} disabled={!!problem || busy} className="gap-1.5">
            {busy ? <Loader2 className="size-4 animate-spin" /> : <FileDown className="size-4" />}
            {busy ? "Wird erstellt …" : "PDF erstellen"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
