"use client";
import { useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, Copy, UserPlus, X } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TimeInput } from "@/components/ui/time-input";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { json, useAction, selectClass, ErrorMessage } from "@/components/workforce/client";
import { QualifikationAuswahl } from "@/components/workforce/qualification-select";
import { cn } from "@/lib/utils";
import { CopyShiftDialog, PreviewSummary, ShiftPreviewList } from "./copy-shift-dialog";
import { DeleteShiftButton } from "./delete-shift-button";
import type { ShiftData, DivisionOption, PoolData, ShiftPreview } from "@/types/schedule";
import { formatName } from "@/lib/names";
import { useNameFormat } from "@/lib/hooks/use-current-member";

type Props = { open: boolean; onOpenChange: (value: boolean) => void; scheduleId: string; branchId: string | null; defaultDayOfWeek?: number; shift?: ShiftData | null };
type BranchOption = { id: string; name: string; isActive: boolean; positions: string[]; customerId: string | null; customer: { name: string } | null };

/** Beschriftung ueber dem Feld, 13 px: im Dialog ist nichts kleiner als 12 px. */
const feld = "grid content-start gap-1.5 text-[13px] font-medium";
/** Neue Vorschau in den sichtbaren Bereich holen; der Fuss mit "Anlegen" steht direkt darunter. */
const insBild = (el: HTMLElement | null) => { el?.scrollIntoView({ block: "nearest" }); };

export function ShiftForm(props: Props) { return props.open ? <Editor key={props.shift?.id || "new"} {...props} /> : null; }

/**
 * Optionale Einteilung beim Anlegen: einplanbare Personen des Standorts
 * (gleicher Kreis wie beim Besetzen), hoechstens so viele wie Plaetze.
 * Sind alle Plaetze vergeben, schliesst sich die Auswahl von selbst.
 */
function AssigneeSelect({ branchId, value, onChange, limit }: { branchId: string | null; value: string[]; onChange: (value: string[]) => void; limit: number }) {
  const [open, setOpen] = useState(false);
  const nameFormat = useNameFormat();
  const pool = useQuery({ queryKey: ["shift-pool", branchId], queryFn: () => json<PoolData>("/api/shifts/pool?branchId=" + branchId), enabled: !!branchId });
  const people = pool.data?.people ?? [];
  const chosen = value.flatMap(id => people.filter(p => p.userId === id));
  const full = value.length >= limit;
  const headings = { site: pool.data?.site ?? "Dieser Standort", customer: pool.data?.customer ? "Weitere Standorte von " + pool.data.customer : "Weitere Standorte desselben Kunden", rest: pool.data?.admin ? "Weitere Mitarbeitende" : "Dir persönlich zugeordnet" };
  const toggle = (userId: string) => {
    const selected = value.includes(userId);
    const next = selected ? value.filter(id => id !== userId) : [...value, userId];
    onChange(next);
    if (!selected && next.length >= limit) setOpen(false);
  };
  return <div className="space-y-2">
    {chosen.length > 0 && <ul aria-label="Ausgewählte Mitarbeiter" className="flex flex-wrap gap-1.5">{chosen.map(p => <li key={p.userId} className="inline-flex items-center rounded-full border bg-muted pl-3 text-[13px] font-normal">{formatName(p, nameFormat)}<button type="button" className="inline-flex size-8 items-center justify-center rounded-full text-muted-foreground hover:text-foreground max-md:size-11" aria-label={formatName(p, nameFormat) + " entfernen"} onClick={() => onChange(value.filter(id => id !== p.userId))}><X className="size-3.5" /></button></li>)}</ul>}
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild><Button type="button" variant="outline" size="sm" disabled={!branchId}><UserPlus className="size-4" />{value.length ? "Auswahl ändern" : "Mitarbeiter auswählen"}</Button></PopoverTrigger>
      <PopoverContent data-keep-preview className="w-80 p-0" align="start" sideOffset={4}>
        <Command className="max-md:**:data-[slot=command-input-wrapper]:h-11">
          <CommandInput placeholder="Mitarbeiter suchen..." />
          <CommandList className="max-h-[300px]">
            <CommandEmpty>{pool.isLoading ? "Auswahl wird geladen" : pool.error ? pool.error.message : "Keine einplanbaren Mitarbeiter"}</CommandEmpty>
            {(["site", "customer", "rest"] as const).map(group => {
              const list = people.filter(p => p.group === group);
              return list.length ? <CommandGroup key={group} heading={headings[group]}>{list.map(p => {
                const selected = value.includes(p.userId);
                return <CommandItem key={p.userId} value={p.firstName + " " + p.lastName + " " + p.userId} disabled={!selected && full} className="max-md:min-h-11" onSelect={() => toggle(p.userId)}>
                  <Check className={cn("size-4", selected ? "opacity-100" : "opacity-0")} aria-hidden="true" /><span className="min-w-0 flex-1 truncate">{formatName(p, nameFormat)}</span>{group === "customer" && <span className="truncate text-[12px] text-muted-foreground">{p.sites.join(", ")}</span>}
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
  // Fest gehalten: Die Auswahllisten laden oft erst nach dem Oeffnen. Ein nur
  // anfaenglich gesetzter Wert fiel dann auf den ersten Eintrag zurueck.
  const [ort, setOrt] = useState(shift?.branchId || ""), [bereich, setBereich] = useState(shift?.divisionId || "");
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
  const free = places - assignees.length;
  const staffingHint = tooMany ? "Mehr Personen ausgewählt als Plätze vorhanden."
    : !assignees.length ? "Ohne Auswahl entsteht eine freie Schicht. Eingeteilte Personen sind sofort fest eingeplant."
    : (free > 0 ? (free === 1 ? "1 Platz bleibt frei. " : free + " Plätze bleiben frei. ") : "") + "Eingeteilte Personen sind sofort fest eingeplant.";
  // "Weitere Optionen" startet offen, wenn dort schon etwas von der Vorgabe abweicht.
  const moreOpen = !!shift && (shift.pauseOption === "PER_HOUR" || !!shift.requiredQualifications?.length);
  // Nur Standorte, an denen die angemeldete Person planen darf.
  const locations = useQuery({ queryKey: ["branches", "EDIT_SHIFTS"], queryFn: () => json<{ branches: BranchOption[] }>("/api/branches?right=EDIT_SHIFTS") });
  const divisions = useQuery({ queryKey: ["divisions"], queryFn: () => json<{ divisions: DivisionOption[] }>("/api/divisions") });
  const current = shift?.branchId ?? branchId;
  const plannable = (locations.data?.branches ?? []).filter((b) => (b.isActive && b.customerId) || b.id === current);
  const currentBranch = locations.data?.branches.find((b) => b.id === current);
  // Eigenes Schliessen statt des kleinen Standard-X: 44 px Touchflaeche auf dem Handy.
  // Fokus beim Oeffnen auf "Beginn" wie bisher, nicht auf die Einsatzort-Auswahl oben
  // (Pfeiltasten wuerden dort den Ort verstellen).
  return <Sheet open={open} onOpenChange={onOpenChange}><SheetContent side="right" showCloseButton={false} className="w-full gap-0 p-0 sm:max-w-[30rem]" onOpenAutoFocus={e => { e.preventDefault(); (e.currentTarget as HTMLElement).querySelector<HTMLElement>("[name=shiftFrom]")?.focus(); }}>
    <form className="flex min-h-0 flex-1 flex-col" onChange={e => { if (!(e.target as HTMLElement).closest("[data-keep-preview]")) reset(); }} onInvalidCapture={e => {
      // Ungueltiges Feld in den eingeklappten Optionen: aufklappen, damit die Meldung sichtbar wird.
      const more = (e.target as HTMLElement).closest("details");
      if (more) more.open = true;
    }} onSubmit={async e => {
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
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        <SheetHeader className="p-0 pr-10"><SheetTitle>{shift ? "Schicht bearbeiten" : "Schicht erstellen"}</SheetTitle><SheetDescription>Bei einer Endzeit vor der Startzeit endet die Schicht am Folgetag.</SheetDescription></SheetHeader>
        <ErrorMessage error={locations.error || divisions.error} />
        {shift ? (
          <label className={feld}>Einsatzort<select name="branchId" value={ort} onChange={e => setOrt(e.target.value)} className={selectClass} required={!shift.branchId}>
            {!shift.branchId && <option value="">Bitte zuordnen</option>}
            {shift.branchId && !plannable.some(b => b.id === shift.branchId) && <option value={shift.branchId}>{locations.isPending ? "Wird geladen …" : "Bisheriger Einsatzort"}</option>}
            {plannable.map(b => <option key={b.id} value={b.id}>{b.name}{b.customer ? " · " + b.customer.name : ""}</option>)}
          </select></label>
        ) : (
          <p className="text-[13px] text-muted-foreground">Einsatzort: <span className="font-medium text-foreground">{currentBranch ? currentBranch.name + (currentBranch.customer ? " · " + currentBranch.customer.name : "") : "Standort des Plans"}</span></p>
        )}
        <div className="grid grid-cols-3 items-end gap-3">
          <label className={feld}>Beginn<TimeInput name="shiftFrom" defaultValue={shift?.shiftFrom || "08:00"} required /></label>
          <label className={feld}>Ende<TimeInput name="shiftTo" defaultValue={shift?.shiftTo || "17:00"} required /></label>
          <label className={feld}>Pause in Minuten<Input name="pauseValue" type="number" min={0} max={120} defaultValue={shift?.pauseValue || 0} required /></label>
        </div>
        <fieldset><legend className="mb-1.5 text-[13px] font-medium">{shift ? "Wochentag" : "Wochentage"}</legend><div className="grid grid-cols-7 gap-1 sm:gap-2">{["Mo","Di","Mi","Do","Fr","Sa","So"].map((name,i) => <Button type="button" key={name} className="px-0" variant={days.includes(i+1) ? "default" : "outline"} aria-pressed={days.includes(i+1)} onClick={() => { reset(); setDays(old => shift ? [i+1] : old.includes(i+1) ? old.length > 1 ? old.filter(d => d !== i+1) : old : [...old,i+1]); }}>{name}</Button>)}</div></fieldset>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className={feld}>Tätigkeit / Titel<Input name="title" list="shift-positions" defaultValue={shift?.title || ""} maxLength={100} /><datalist id="shift-positions">{[...new Set(currentBranch?.positions ?? [])].map(p => <option key={p} value={p} />)}</datalist></label>
          <label className={feld}>Arbeitsbereich<select name="divisionId" value={bereich} onChange={e => setBereich(e.target.value)} className={selectClass}><option value="">Kein Arbeitsbereich</option>{shift?.divisionId && !divisions.data?.divisions.some(d => d.id === shift.divisionId) && <option value={shift.divisionId}>{divisions.isPending ? "Wird geladen …" : "Bisheriger Arbeitsbereich"}</option>}{divisions.data?.divisions.map(d => <option key={d.id} value={d.id}>{d.title}</option>)}</select></label>
        </div>
        <fieldset className="space-y-3 rounded-[var(--radius)] border px-3 pt-1 pb-3">
          <legend className="px-1 text-[13px] font-medium">Besetzung</legend>
          <label className="flex items-center justify-between gap-3 text-[13px] font-medium">Benötigte Mitarbeitende<Input name="maxEmployees" type="number" min={1} max={100} defaultValue={shift?.maxEmployees || 1} onChange={e => setPlaces(Math.max(1, Number(e.target.value) || 1))} className="w-24" required /></label>
          {!shift && <>
            <AssigneeSelect branchId={branchId} value={assignees} limit={places} onChange={value => { reset(); setAssignees(value); }} />
            <p className={cn("text-[13px]", tooMany ? "text-destructive" : "text-muted-foreground")}>{staffingHint}</p>
          </>}
        </fieldset>
        <label className={feld}>Hinweise<Textarea name="description" defaultValue={shift?.description || ""} maxLength={2000} className="min-h-16" /></label>
        <details open={moreOpen} className="rounded-[var(--radius)] border px-3">
          <summary className="min-h-11 cursor-pointer py-3 text-[13px] font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">Weitere Optionen <span className="font-normal text-muted-foreground">· {shift ? "Pausenregel, Qualifikationen" : "Pausenregel, Wiederholen, Qualifikationen"}</span></summary>
          <div className="grid gap-4 pb-3 sm:grid-cols-2">
            <label className={feld}>Pausenregel<select name="pauseOption" className={selectClass} defaultValue={shift?.pauseOption || "PER_SHIFT"}><option value="PER_SHIFT">Pro Schicht</option><option value="PER_HOUR">Pro Stunde</option></select></label>
            {!shift && <label className={feld}>Wöchentlich wiederholen (Wochen)<Input name="repeatWeeks" type="number" min={1} max={52} defaultValue={1} required /></label>}
            <fieldset className="sm:col-span-2 max-md:[&_label]:min-h-11"><legend className="mb-1.5 text-[13px] font-medium">Erforderliche Qualifikationen</legend><QualifikationAuswahl name="qualifications" defaultValue={shift?.requiredQualifications ?? []} idPrefix={"schicht-" + (shift?.id ?? "neu")} /></fieldset>
          </div>
        </details>
        {withAssignees && preview && <div ref={insBild} data-keep-preview className="space-y-2" aria-live="polite"><p className="text-sm font-medium">Vorschau – noch nichts gespeichert</p><ShiftPreviewList preview={preview} /><PreviewSummary preview={preview} confirmed={confirmed} onConfirmedChange={setConfirmed} idPrefix="neue-schicht" /></div>}
        {shift && shift.branchId && <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4"><p className="text-[13px] text-muted-foreground">Auf weitere Tage am selben Standort kopieren – auf Wunsch mit den Zuweisungen.</p><Button type="button" variant="outline" onClick={() => setKopieren(true)}><Copy className="size-4" />Kopieren …</Button></div>}
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t bg-background px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        {shift && <DeleteShiftButton shiftId={shift.id} onDeleted={() => onOpenChange(false)} />}
        <div className="ml-auto flex gap-2"><Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Abbrechen</Button><Button disabled={action.isPending || check.isPending || blocked}>{submitLabel}</Button></div>
      </div>
    </form>
    {/* Wie das Standard-X nach dem Inhalt: zuletzt in der Tab-Reihenfolge, bleibt beim Scrollen sichtbar. */}
    <Button type="button" variant="ghost" size="icon" className="absolute top-2 right-2 bg-background" aria-label="Schließen" onClick={() => onOpenChange(false)}><X className="size-4" /></Button>
    {shift && kopieren && <CopyShiftDialog shift={shift} open={kopieren} onOpenChange={setKopieren} onDone={() => onOpenChange(false)} />}
  </SheetContent></Sheet>;
}
