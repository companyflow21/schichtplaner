"use client";
import { useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, Copy, UserPlus, X } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { TimeInput } from "@/components/ui/time-input";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { json, useAction, selectClass, ErrorMessage } from "@/components/workforce/client";
import { QualifikationAuswahl } from "@/components/workforce/qualification-select";
import { cn } from "@/lib/utils";
import { CopyShiftDialog, PreviewSummary, ShiftPreviewList } from "./copy-shift-dialog";
import type { ShiftData, DivisionOption, PoolData, ShiftPreview } from "@/types/schedule";

type Props = { open: boolean; onOpenChange: (value: boolean) => void; scheduleId: string; branchId: string | null; defaultDayOfWeek?: number; shift?: ShiftData | null };
type BranchOption = { id: string; name: string; isActive: boolean; positions: string[]; customerId: string | null; customer: { name: string } | null };

export function ShiftForm(props: Props) { return props.open ? <Editor key={props.shift?.id || "new"} {...props} /> : null; }

/**
 * Optionale Einteilung beim Anlegen: einplanbare Personen des Standorts
 * (gleicher Kreis wie beim Besetzen), hoechstens so viele wie Plaetze.
 */
function AssigneeSelect({ branchId, value, onChange, limit }: { branchId: string | null; value: string[]; onChange: (value: string[]) => void; limit: number }) {
  const [open, setOpen] = useState(false);
  const pool = useQuery({ queryKey: ["shift-pool", branchId], queryFn: () => json<PoolData>("/api/shifts/pool?branchId=" + branchId), enabled: !!branchId });
  const people = pool.data?.people ?? [];
  const chosen = value.flatMap(id => people.filter(p => p.userId === id));
  const full = value.length >= limit;
  const headings = { site: pool.data?.site ?? "Dieser Standort", customer: pool.data?.customer ? "Weitere Standorte von " + pool.data.customer : "Weitere Standorte desselben Kunden", rest: pool.data?.admin ? "Weitere Mitarbeitende" : "Dir persönlich zugeordnet" };
  return <div className="space-y-2">
    {chosen.length > 0 && <ul className="flex flex-wrap gap-1.5">{chosen.map(p => <li key={p.userId} className="inline-flex items-center gap-1 rounded-full border bg-muted px-2 py-0.5 text-[12.5px]">{p.firstName} {p.lastName}<button type="button" className="text-muted-foreground hover:text-foreground" aria-label={p.firstName + " " + p.lastName + " entfernen"} onClick={() => onChange(value.filter(id => id !== p.userId))}><X className="size-3" /></button></li>)}</ul>}
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild><Button type="button" variant="outline" size="sm" disabled={!branchId}><UserPlus className="size-4" />{value.length ? "Auswahl ändern" : "Mitarbeiter auswählen"}</Button></PopoverTrigger>
      <PopoverContent data-keep-preview className="w-80 p-0" align="start" sideOffset={4}>
        <Command>
          <CommandInput placeholder="Mitarbeiter suchen..." />
          <CommandList className="max-h-[300px]">
            <CommandEmpty>{pool.isLoading ? "Auswahl wird geladen" : pool.error ? pool.error.message : "Keine einplanbaren Mitarbeiter"}</CommandEmpty>
            {(["site", "customer", "rest"] as const).map(group => {
              const list = people.filter(p => p.group === group);
              return list.length ? <CommandGroup key={group} heading={headings[group]}>{list.map(p => {
                const selected = value.includes(p.userId);
                return <CommandItem key={p.userId} value={p.firstName + " " + p.lastName + " " + p.userId} disabled={!selected && full} onSelect={() => onChange(selected ? value.filter(id => id !== p.userId) : [...value, p.userId])}>
                  <Check className={cn("size-4", selected ? "opacity-100" : "opacity-0")} aria-hidden="true" /><span className="min-w-0 flex-1 truncate">{p.firstName} {p.lastName}</span>{group === "customer" && <span className="truncate text-[11px] text-muted-foreground">{p.sites.join(", ")}</span>}
                </CommandItem>;
              })}</CommandGroup> : null;
            })}
          </CommandList>
        </Command>
        {full && <p className="border-t px-3 py-2 text-[12px] text-muted-foreground">Alle {limit} {limit === 1 ? "Platz ist" : "Plätze sind"} ausgewählt.</p>}
      </PopoverContent>
    </Popover>
  </div>;
}

function Editor({ open, onOpenChange, scheduleId, branchId, defaultDayOfWeek = 1, shift }: Props) {
  const action = useAction(), [days, setDays] = useState([shift?.dayOfWeek || defaultDayOfWeek]);
  const [kopieren, setKopieren] = useState(false);
  // Anlegen mit Einteilung: erst Vorschau (nichts gespeichert), dann anlegen.
  const [places, setPlaces] = useState(shift?.maxEmployees || 1);
  const [assignees, setAssignees] = useState<string[]>([]);
  const [preview, setPreview] = useState<ShiftPreview | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const busy = useRef(false);
  const reset = () => { setPreview(null); setConfirmed(false); };
  const check = useMutation({
    mutationFn: (data: Record<string, unknown>) => json<ShiftPreview>("/api/shifts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...data, preview: true }) }),
    onError: (error: Error) => toast.error(error.message),
  });
  const withAssignees = !shift && assignees.length > 0;
  const tooMany = withAssignees && assignees.length > places;
  const blocked = tooMany || (withAssignees && !!preview && (preview.conflicts.length > 0 || (preview.warnings.length > 0 && !confirmed)));
  const submitLabel = !withAssignees ? "Speichern" : !preview ? "Prüfen" : preview.occurrences.length === 1 ? "1 Schicht anlegen" : preview.occurrences.length + " Schichten anlegen";
  // Nur Standorte, an denen die angemeldete Person planen darf.
  const locations = useQuery({ queryKey: ["branches", "EDIT_SHIFTS"], queryFn: () => json<{ branches: BranchOption[] }>("/api/branches?right=EDIT_SHIFTS") });
  const divisions = useQuery({ queryKey: ["divisions"], queryFn: () => json<{ divisions: DivisionOption[] }>("/api/divisions") });
  const current = shift?.branchId ?? branchId;
  const plannable = (locations.data?.branches ?? []).filter((b) => (b.isActive && b.customerId) || b.id === current);
  const currentBranch = locations.data?.branches.find((b) => b.id === current);
  return <Sheet open={open} onOpenChange={onOpenChange}><SheetContent side="right" className="w-full overflow-y-auto p-4 sm:max-w-[30rem]"><SheetHeader className="p-0 pb-4"><SheetTitle>{shift ? "Schicht bearbeiten" : "Schicht erstellen"}</SheetTitle><SheetDescription>Bei einer Endzeit vor der Startzeit endet die Schicht am Folgetag.</SheetDescription></SheetHeader><ErrorMessage error={locations.error || divisions.error} />
    <form className="grid gap-4 sm:grid-cols-2" onChange={e => { if (!(e.target as HTMLElement).closest("[data-keep-preview]")) reset(); }} onSubmit={async e => {
      e.preventDefault(); const f = new FormData(e.currentTarget);
      // Doppelklick: der zweite Aufruf kommt, bevor isPending gerendert ist.
      if (busy.current || blocked) return;
      const common = { divisionId: f.get("divisionId") || null, title: f.get("title") || null, shiftFrom: f.get("shiftFrom"), shiftTo: f.get("shiftTo"), maxEmployees: Number(f.get("maxEmployees")), pauseOption: f.get("pauseOption"), pauseValue: Number(f.get("pauseValue")), description: f.get("description") || null, requiredQualifications: f.getAll("qualifications").map(String) };
      const data = shift
        ? { ...common, dayOfWeek: days[0], ...(f.get("branchId") && f.get("branchId") !== shift.branchId ? { branchId: f.get("branchId") } : {}) }
        : { ...common, scheduleId, dayOfWeek: days[0], repeatDays: days, repeatWeeks: Number(f.get("repeatWeeks") || 1), ...(withAssignees ? { assignees } : {}) };
      busy.current = true;
      try {
        if (withAssignees && !preview) { setPreview(await check.mutateAsync(data).catch(() => null)); return; }
        const confirm = withAssignees && !!preview?.warnings.length ? { confirm: true } : {};
        const message = shift ? "Schicht geändert" : withAssignees ? "Schicht angelegt und besetzt" : "Schicht angelegt";
        // Scheitert das Anlegen (etwa weil sich inzwischen etwas geaendert hat), wird neu geprueft.
        await action.mutateAsync({ url: shift ? "/api/shifts/" + shift.id : "/api/shifts", method: shift ? "PATCH" : "POST", data: { ...data, ...confirm }, message }).then(() => onOpenChange(false)).catch(() => reset());
      } finally { busy.current = false; }
    }}>
      <label>Beginn<TimeInput name="shiftFrom" defaultValue={shift?.shiftFrom || "08:00"} required /></label><label>Ende<TimeInput name="shiftTo" defaultValue={shift?.shiftTo || "17:00"} required /></label>
      {shift ? (
        <label>Einsatzort<select name="branchId" defaultValue={shift.branchId || ""} className={selectClass} required={!shift.branchId}>
          {!shift.branchId && <option value="">Bitte zuordnen</option>}
          {plannable.map(b => <option key={b.id} value={b.id}>{b.name}{b.customer ? " · " + b.customer.name : ""}</option>)}
        </select></label>
      ) : (
        <div className="text-sm"><span className="block">Einsatzort</span><span className="flex h-10 items-center text-muted-foreground">{currentBranch ? currentBranch.name + (currentBranch.customer ? " · " + currentBranch.customer.name : "") : "Standort des Plans"}</span></div>
      )}
      <label>Arbeitsbereich<select name="divisionId" defaultValue={shift?.divisionId || ""} className={selectClass}><option value="">Kein Arbeitsbereich</option>{divisions.data?.divisions.map(d => <option key={d.id} value={d.id}>{d.title}</option>)}</select></label>
      <label>Tätigkeit / Titel<Input name="title" list="shift-positions" defaultValue={shift?.title || ""} maxLength={100} /><datalist id="shift-positions">{[...new Set(currentBranch?.positions ?? [])].map(p => <option key={p} value={p} />)}</datalist></label>
      <label>Benötigte Mitarbeitende<Input name="maxEmployees" type="number" min={1} max={100} defaultValue={shift?.maxEmployees || 1} onChange={e => setPlaces(Math.max(1, Number(e.target.value) || 1))} required /></label>
      <label>Pause in Minuten<Input name="pauseValue" type="number" min={0} max={120} defaultValue={shift?.pauseValue || 0} required /></label><label>Pausenregel<select name="pauseOption" className={selectClass} defaultValue={shift?.pauseOption || "PER_SHIFT"}><option value="PER_SHIFT">Pro Schicht</option><option value="PER_HOUR">Pro Stunde</option></select></label>
      <fieldset className="sm:col-span-2"><legend className="mb-2">{shift ? "Wochentag" : "Wochentage"}</legend><div className="flex flex-wrap gap-2">{["Mo","Di","Mi","Do","Fr","Sa","So"].map((name,i) => <Button type="button" key={name} variant={days.includes(i+1) ? "default" : "outline"} aria-pressed={days.includes(i+1)} onClick={() => { reset(); setDays(old => shift ? [i+1] : old.includes(i+1) ? old.length > 1 ? old.filter(d => d !== i+1) : old : [...old,i+1]); }}>{name}</Button>)}</div></fieldset>
      {!shift && <label>Wöchentlich wiederholen (Wochen)<Input name="repeatWeeks" type="number" min={1} max={52} defaultValue={1} required /></label>}
      <fieldset className="sm:col-span-2"><legend className="mb-1.5">Erforderliche Qualifikationen</legend><QualifikationAuswahl name="qualifications" defaultValue={shift?.requiredQualifications ?? []} idPrefix={"schicht-" + (shift?.id ?? "neu")} /></fieldset>
      <label className="sm:col-span-2">Hinweise<Textarea name="description" defaultValue={shift?.description || ""} maxLength={2000} /></label>
      {!shift && <fieldset className="sm:col-span-2"><legend className="mb-1.5">Mitarbeiter (optional)</legend><AssigneeSelect branchId={branchId} value={assignees} limit={places} onChange={value => { reset(); setAssignees(value); }} /><p className={cn("mt-1.5 text-xs", tooMany ? "text-destructive" : "text-muted-foreground")}>{tooMany ? "Mehr Personen ausgewählt als Plätze vorhanden." : "Ohne Auswahl bleibt die Schicht offen. Eingeteilte Personen sind sofort fest eingeplant."}</p></fieldset>}
      {withAssignees && preview && <div data-keep-preview className="sm:col-span-2 space-y-2" aria-live="polite"><p className="text-sm font-medium">Vorschau – noch nichts gespeichert</p><ShiftPreviewList preview={preview} /><PreviewSummary preview={preview} confirmed={confirmed} onConfirmedChange={setConfirmed} idPrefix="neue-schicht" /></div>}
      <div className="sm:col-span-2 flex flex-wrap justify-end gap-2">{shift && <ConfirmDialog title="Schicht absagen" description="Die Schicht wird gelöscht und alle Zuweisungen werden aufgehoben. Betroffene Mitarbeitende verlieren diesen Einsatz." confirmLabel="Schicht löschen" disabled={action.isPending} onConfirm={() => { action.mutateAsync({ url: "/api/shifts/" + shift.id, method: "DELETE", message: "Schicht abgesagt" }).then(() => onOpenChange(false)).catch(() => {}); }}><Button type="button" variant="destructive" disabled={action.isPending}>Schicht löschen</Button></ConfirmDialog>}<Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Abbrechen</Button><Button disabled={action.isPending || check.isPending || blocked}>{submitLabel}</Button></div>
    </form>
    {shift && shift.branchId && <div className="mt-4 border-t pt-4 flex flex-wrap items-center justify-between gap-3"><p className="text-xs text-muted-foreground">Auf weitere Tage am selben Standort kopieren – auf Wunsch mit den Zuweisungen.</p><Button type="button" variant="outline" onClick={() => setKopieren(true)}><Copy className="size-4" />Kopieren …</Button></div>}
    {shift && kopieren && <CopyShiftDialog shift={shift} open={kopieren} onOpenChange={setKopieren} onDone={() => onOpenChange(false)} />}
  </SheetContent></Sheet>;
}
