"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Plus } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TimeInput } from "@/components/ui/time-input";
import { ErrorMessage, json, selectClass, useAction } from "@/components/workforce/client";
import { euro, formatNumber, rateLabel } from "@/lib/payroll";
import { cn } from "@/lib/utils";

type PayType = { id: string; title: string; hourlyRateCents: number; code: string | null; isActive: boolean };
type Surcharge = {
  id: string; name: string; code: string | null; isActive: boolean; weekdays: number[]; holidays: boolean; dates: string[];
  timeFrom: string; timeTo: string; allPeople: boolean; userIds: string[]; allDivisions: boolean; divisionIds: string[];
  rateKind: "PERCENT" | "AMOUNT"; rate: number;
};
type Member = { memberId: string; userId: string; firstName: string; lastName: string; isActive: boolean; personnelNumber: string | null; payTypeId: string | null };
type Division = { id: string; title: string; color: string; payTypeId: string | null };
type Settings = { payTypes: PayType[]; surcharges: Surcharge[]; members: Member[]; divisions: Division[] };

const WEEKDAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

/** "15,50" -> 1550; leer oder ungueltig -> null. */
function hundredths(text: string): number | null {
  const value = Number(text.trim().replace(/\s/g, "").replace(",", "."));
  return text.trim() === "" || !Number.isFinite(value) || value < 0 ? null : Math.round(value * 100);
}
const asText = (h: number) => formatNumber(h / 100);
/** "24.12., 31.12" -> ["12-24", "12-31"]; null bei ungueltiger Angabe. */
function parseDates(text: string): string[] | null {
  const out: string[] = [];
  for (const part of text.split(/[;,\s]+/).filter(Boolean)) {
    const m = part.match(/^(\d{1,2})\.(\d{1,2})\.?$/);
    if (!m || Number(m[1]) < 1 || Number(m[1]) > 31 || Number(m[2]) < 1 || Number(m[2]) > 12) return null;
    out.push(m[2].padStart(2, "0") + "-" + m[1].padStart(2, "0"));
  }
  return out;
}
const datesText = (dates: string[]) => dates.map((d) => d.slice(3) + "." + d.slice(0, 2) + ".").join(", ");
const name = (m: Pick<Member, "firstName" | "lastName">) => m.lastName + ", " + m.firstName;

export function surchargeSummary(s: Surcharge, divisions: Division[]): string {
  const days = [
    ...(s.weekdays.length === 7 ? ["täglich"] : s.weekdays.length ? [s.weekdays.map((d) => WEEKDAYS[d - 1]).join(", ")] : []),
    ...(s.holidays ? ["Feiertage"] : []),
    ...(s.dates.length ? [datesText(s.dates)] : []),
  ].join(" · ");
  const time = s.timeFrom === "00:00" && s.timeTo === "00:00" ? "ganzer Tag" : s.timeTo === "00:00" ? s.timeFrom + "–24:00" : s.timeFrom + "–" + s.timeTo + (s.timeTo <= s.timeFrom ? " (Folgetag)" : "");
  const who = s.allPeople ? "" : " · " + s.userIds.length + " " + (s.userIds.length === 1 ? "Person" : "Personen");
  const where = s.allDivisions ? "" : " · " + s.divisionIds.map((id) => divisions.find((d) => d.id === id)?.title ?? "gelöscht").join(", ");
  return days + " · " + time + " · " + rateLabel(s) + who + where;
}

/** Lohneinstellungen: Lohnarten, Zuschlaege, Personalnummern, Lohnart je Person und Arbeitsbereich. */
export function PayrollSettings() {
  const query = useQuery({ queryKey: ["payroll-settings"], queryFn: () => json<Settings>("/api/payroll/settings") });
  if (query.isLoading) return <div className="flex justify-center py-20"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>;
  if (query.error || !query.data) return <ErrorMessage error={query.error ?? new Error("Lohneinstellungen konnten nicht geladen werden.")} />;
  const data = query.data;
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Lohn</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Grundlage für „Lohn“ und den Lohnexport. Sätze und Zuschläge legt die Administration selbst fest; die steuerliche
          Behandlung (z. B. steuerfreie Zuschläge nach § 3b EStG) bitte mit dem Steuerbüro abstimmen.
        </p>
      </div>
      <PayTypes payTypes={data.payTypes} />
      <Surcharges data={data} />
      <People data={data} />
      <Areas data={data} />
    </div>
  );
}

function PayTypes({ payTypes }: { payTypes: PayType[] }) {
  const action = useAction();
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const save = (url: string, method: string, form: FormData, done: () => void) => {
    const rate = hundredths(String(form.get("rate") ?? ""));
    if (rate === null) { setError("Bitte einen gültigen Stundenlohn eingeben, z. B. 15,50."); return; }
    setError(null);
    action.mutate({ url, method, data: { title: String(form.get("title") ?? "").trim(), hourlyRateCents: rate, code: String(form.get("code") ?? "").trim() || null }, message: "Lohnart gespeichert" }, { onSuccess: done });
  };
  return (
    <Card className="space-y-4 p-5">
      <div>
        <h3 className="font-semibold">Lohnarten</h3>
        <p className="text-sm text-muted-foreground">Stundenlohn und Code der Lohnsoftware. Prozent-Zuschläge beziehen sich auf die Lohnart, die für die Stunden gilt.</p>
      </div>
      {payTypes.length > 0 && (
        <ul className="divide-y rounded-[var(--radius)] border">
          {payTypes.map((p) => (
            <li key={p.id} className="px-3 py-2 text-sm">
              {editing === p.id ? (
                <form className="grid gap-2 sm:grid-cols-[1fr_8rem_7rem_auto]" onSubmit={(e) => { e.preventDefault(); save("/api/payroll/pay-types/" + p.id, "PATCH", new FormData(e.currentTarget), () => setEditing(null)); }}>
                  <Input name="title" aria-label="Titel" defaultValue={p.title} maxLength={100} required autoFocus />
                  <Input name="rate" aria-label="Stundenlohn in Euro" inputMode="decimal" defaultValue={asText(p.hourlyRateCents)} required />
                  <Input name="code" aria-label="Lohnart-Code" defaultValue={p.code ?? ""} maxLength={20} placeholder="Code" />
                  <div className="flex gap-2"><Button size="sm" disabled={action.isPending}>Speichern</Button><Button type="button" size="sm" variant="outline" onClick={() => setEditing(null)}>Abbrechen</Button></div>
                </form>
              ) : (
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <label className="flex flex-1 items-center gap-2">
                    <input type="checkbox" className="size-4 accent-primary" checked={p.isActive} disabled={action.isPending} aria-label={"Lohnart " + p.title + " aktiv"}
                      onChange={(e) => action.mutate({ url: "/api/payroll/pay-types/" + p.id, method: "PATCH", data: { isActive: e.target.checked }, message: e.target.checked ? "Lohnart aktiviert" : "Lohnart deaktiviert" })} />
                    <span className={cn("font-medium", !p.isActive && "text-muted-foreground line-through")}>{p.title}</span>
                  </label>
                  <span className="tabular-nums sm:w-28 sm:text-right">{euro(p.hourlyRateCents)}/h</span>
                  <span className="text-muted-foreground sm:w-24">{p.code ? "Code " + p.code : "ohne Code"}</span>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => setEditing(p.id)}>Bearbeiten</Button>
                    <Button size="sm" variant="outline" disabled={action.isPending} onClick={() => { if (confirm("Lohnart „" + p.title + "“ löschen?")) action.mutate({ url: "/api/payroll/pay-types/" + p.id, method: "DELETE", message: "Lohnart gelöscht" }); }}>Löschen</Button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      <form className="grid gap-2 sm:grid-cols-[1fr_8rem_7rem_auto] sm:items-end" onSubmit={(e) => { e.preventDefault(); const form = e.currentTarget; save("/api/payroll/pay-types", "POST", new FormData(form), () => form.reset()); }}>
        <div className="space-y-1.5"><Label htmlFor="lohnart-titel">Neue Lohnart</Label><Input id="lohnart-titel" name="title" maxLength={100} placeholder="z. B. Normalstunden" required /></div>
        <div className="space-y-1.5"><Label htmlFor="lohnart-satz">€ je Stunde</Label><Input id="lohnart-satz" name="rate" inputMode="decimal" placeholder="15,50" required /></div>
        <div className="space-y-1.5"><Label htmlFor="lohnart-code">Code</Label><Input id="lohnart-code" name="code" maxLength={20} placeholder="optional" /></div>
        <Button disabled={action.isPending}><Plus className="size-4" />Hinzufügen</Button>
      </form>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </Card>
  );
}

function Surcharges({ data }: { data: Settings }) {
  const action = useAction();
  const [editing, setEditing] = useState<string | "new" | null>(null);
  return (
    <Card className="space-y-4 p-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="font-semibold">Zuschläge</h3>
          <p className="text-sm text-muted-foreground">Für Stunden im Zeitblock an den gewählten Tagen. Treffen mehrere Zuschläge zu, werden sie addiert.</p>
        </div>
        {editing !== "new" && <Button size="sm" onClick={() => setEditing("new")}><Plus className="size-4" />Zuschlag hinzufügen</Button>}
      </div>
      {editing === "new" && <SurchargeForm data={data} onDone={() => setEditing(null)} />}
      {data.surcharges.length === 0 && editing !== "new" ? (
        <p className="text-sm text-muted-foreground">Noch keine Zuschläge angelegt.</p>
      ) : (
        <ul className="divide-y rounded-[var(--radius)] border">
          {data.surcharges.map((s) => (
            <li key={s.id} className="px-3 py-2 text-sm">
              {editing === s.id ? <SurchargeForm data={data} surcharge={s} onDone={() => setEditing(null)} /> : (
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <div className="flex-1">
                    <p className={cn("font-medium", !s.isActive && "text-muted-foreground line-through")}>{s.name}{s.code ? <span className="ml-2 font-normal text-muted-foreground">Code {s.code}</span> : null}</p>
                    <p className="text-muted-foreground">{surchargeSummary(s, data.divisions)}</p>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => setEditing(s.id)}>Bearbeiten</Button>
                    <Button size="sm" variant="outline" disabled={action.isPending} onClick={() => { if (confirm("Zuschlag „" + s.name + "“ löschen?")) action.mutate({ url: "/api/payroll/surcharges/" + s.id, method: "DELETE", message: "Zuschlag gelöscht" }); }}>Löschen</Button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function SurchargeForm({ data, surcharge, onDone }: { data: Settings; surcharge?: Surcharge; onDone: () => void }) {
  const action = useAction();
  const [error, setError] = useState<string | null>(null);
  const [allPeople, setAllPeople] = useState(surcharge?.allPeople ?? true);
  const [allDivisions, setAllDivisions] = useState(surcharge?.allDivisions ?? true);
  const prefix = "zuschlag-" + (surcharge?.id ?? "neu");
  const people = data.members.filter((m) => m.isActive || surcharge?.userIds.includes(m.userId));
  const submit = (form: FormData) => {
    const dates = parseDates(String(form.get("dates") ?? ""));
    if (dates === null) { setError("Sonderdaten bitte als Tag.Monat., z. B. 24.12., 31.12."); return; }
    const rate = hundredths(String(form.get("rate") ?? ""));
    if (rate === null) { setError("Bitte einen gültigen Satz eingeben, z. B. 25 oder 2,50."); return; }
    setError(null);
    action.mutate({
      url: surcharge ? "/api/payroll/surcharges/" + surcharge.id : "/api/payroll/surcharges",
      method: surcharge ? "PATCH" : "POST",
      message: "Zuschlag gespeichert",
      data: {
        name: String(form.get("name") ?? "").trim(), code: String(form.get("code") ?? "").trim() || null, isActive: form.get("isActive") === "on",
        weekdays: form.getAll("weekday").map(Number), holidays: form.get("holidays") === "on", dates,
        timeFrom: String(form.get("timeFrom") || "00:00"), timeTo: String(form.get("timeTo") || "00:00"),
        allPeople, userIds: allPeople ? [] : form.getAll("userIds").map(String),
        allDivisions, divisionIds: allDivisions ? [] : form.getAll("divisionIds").map(String),
        rateKind: form.get("rateKind") === "AMOUNT" ? "AMOUNT" : "PERCENT", rate,
      },
    }, { onSuccess: onDone });
  };
  return (
    <form className="space-y-4 rounded-[var(--radius)] border bg-muted/30 p-4" onSubmit={(e) => { e.preventDefault(); submit(new FormData(e.currentTarget)); }}>
      <div className="grid gap-3 sm:grid-cols-[1fr_10rem]">
        <div className="space-y-1.5"><Label htmlFor={prefix + "-name"}>Name</Label><Input id={prefix + "-name"} name="name" defaultValue={surcharge?.name} maxLength={100} placeholder="z. B. Nachtzuschlag" required /></div>
        <div className="space-y-1.5"><Label htmlFor={prefix + "-code"}>Lohnart-Code</Label><Input id={prefix + "-code"} name="code" defaultValue={surcharge?.code ?? ""} maxLength={20} placeholder="optional" /></div>
      </div>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Tage</legend>
        <div className="flex flex-wrap gap-1.5">
          {WEEKDAYS.map((label, i) => (
            <label key={label} className="cursor-pointer">
              <input type="checkbox" name="weekday" value={i + 1} defaultChecked={surcharge?.weekdays.includes(i + 1)} className="peer sr-only" />
              <span className="inline-flex size-9 items-center justify-center rounded-full border text-sm peer-checked:border-primary peer-checked:bg-primary peer-checked:text-primary-foreground peer-focus-visible:ring-2 peer-focus-visible:ring-ring">{label}</span>
            </label>
          ))}
        </div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="holidays" defaultChecked={surcharge?.holidays} className="size-4 accent-primary" />Feiertage (Einstellungen › Abwesenheiten)</label>
        <div className="space-y-1.5 sm:max-w-sm"><Label htmlFor={prefix + "-dates"}>Sonderdaten jedes Jahres</Label><Input id={prefix + "-dates"} name="dates" defaultValue={datesText(surcharge?.dates ?? [])} placeholder="z. B. 24.12., 31.12." /></div>
      </fieldset>
      <fieldset className="space-y-1.5">
        <legend className="text-sm font-medium">Zeitblock</legend>
        <div className="flex items-center gap-2"><TimeInput name="timeFrom" aria-label="Zeitblock von" defaultValue={surcharge?.timeFrom ?? "00:00"} className="w-24" /><span>bis</span><TimeInput name="timeTo" aria-label="Zeitblock bis" defaultValue={surcharge?.timeTo ?? "00:00"} className="w-24" /></div>
        <p className="text-xs text-muted-foreground">Endet der Block vor seinem Beginn, reicht er in den Folgetag (z. B. 20:00 bis 06:00). 00:00 bis 00:00 ist der ganze Tag.</p>
      </fieldset>
      <div className="grid gap-4 sm:grid-cols-2">
        <Choice legend="Personen" all={allPeople} setAll={setAllPeople} name="userIds" options={people.map((m) => ({ id: m.userId, label: name(m) + (m.isActive ? "" : " (inaktiv)") }))} selected={surcharge?.userIds ?? []} />
        <Choice legend="Arbeitsbereiche" all={allDivisions} setAll={setAllDivisions} name="divisionIds" options={data.divisions.map((d) => ({ id: d.id, label: d.title, color: d.color }))} selected={surcharge?.divisionIds ?? []} />
      </div>
      <fieldset className="space-y-1.5">
        <legend className="text-sm font-medium">Satz</legend>
        <div className="flex gap-2 sm:max-w-sm">
          <Input name="rate" aria-label="Satz" inputMode="decimal" defaultValue={surcharge ? asText(surcharge.rate) : ""} placeholder="25" required />
          <select name="rateKind" aria-label="Einheit" className={selectClass} defaultValue={surcharge?.rateKind ?? "PERCENT"}>
            <option value="PERCENT">% der Lohnart</option>
            <option value="AMOUNT">€ je Stunde</option>
          </select>
        </div>
      </fieldset>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="isActive" defaultChecked={surcharge?.isActive ?? true} className="size-4 accent-primary" />Aktiv</label>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="flex gap-2"><Button disabled={action.isPending}>{action.isPending && <Loader2 className="size-4 animate-spin" />}Speichern</Button><Button type="button" variant="outline" onClick={onDone}>Abbrechen</Button></div>
    </form>
  );
}

function Choice({ legend, all, setAll, name: field, options, selected }: { legend: string; all: boolean; setAll: (v: boolean) => void; name: string; options: { id: string; label: string; color?: string }[]; selected: string[] }) {
  return (
    <fieldset className="space-y-1.5">
      <legend className="text-sm font-medium">{legend}</legend>
      <div className="flex gap-4 text-sm">
        <label className="flex items-center gap-2"><input type="radio" checked={all} onChange={() => setAll(true)} className="accent-primary" />alle</label>
        <label className="flex items-center gap-2"><input type="radio" checked={!all} onChange={() => setAll(false)} className="accent-primary" />nur ausgewählte</label>
      </div>
      {!all && (
        <div className="max-h-48 space-y-1 overflow-y-auto rounded-[var(--radius)] border bg-card p-2">
          {options.length === 0 ? <p className="text-sm text-muted-foreground">Keine Einträge.</p> : options.map((o) => (
            <label key={o.id} className="flex items-center gap-2 text-sm">
              <input type="checkbox" name={field} value={o.id} defaultChecked={selected.includes(o.id)} className="size-4 accent-primary" />
              {o.color && <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: o.color }} />}
              {o.label}
            </label>
          ))}
        </div>
      )}
    </fieldset>
  );
}

function People({ data }: { data: Settings }) {
  const [search, setSearch] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const list = data.members.filter((m) => (showInactive || m.isActive) && name(m).toLowerCase().includes(search.trim().toLowerCase()));
  return (
    <Card className="space-y-4 p-5">
      <div>
        <h3 className="font-semibold">Personalnummer und Lohnart je Person</h3>
        <p className="text-sm text-muted-foreground">Nach dieser Lohnart werden die Stunden bezahlt, sofern der Arbeitsbereich der Schicht keine eigene hat.</p>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Person suchen …" aria-label="Person suchen" className="sm:max-w-xs" />
        <label className="flex items-center gap-2 text-sm sm:ml-auto"><input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} className="size-4 accent-primary" />Inaktive zeigen</label>
      </div>
      <ul className="divide-y rounded-[var(--radius)] border">
        {list.map((m) => <PersonRow key={m.memberId + (m.personnelNumber ?? "") + (m.payTypeId ?? "")} member={m} payTypes={data.payTypes} />)}
        {list.length === 0 && <li className="px-3 py-2 text-sm text-muted-foreground">Keine Personen gefunden.</li>}
      </ul>
    </Card>
  );
}

function PersonRow({ member, payTypes }: { member: Member; payTypes: PayType[] }) {
  const action = useAction();
  const [number, setNumber] = useState(member.personnelNumber ?? "");
  const [payTypeId, setPayTypeId] = useState(member.payTypeId ?? "");
  const changed = number.trim() !== (member.personnelNumber ?? "") || payTypeId !== (member.payTypeId ?? "");
  return (
    <li className="grid gap-2 px-3 py-2 text-sm sm:grid-cols-[1fr_9rem_14rem_auto] sm:items-center">
      <span className={cn(!member.isActive && "text-muted-foreground")}>{name(member)}{member.isActive ? "" : " (inaktiv)"}</span>
      <Input value={number} onChange={(e) => setNumber(e.target.value)} maxLength={30} placeholder="Personalnr." aria-label={"Personalnummer " + name(member)} />
      <select className={selectClass} value={payTypeId} onChange={(e) => setPayTypeId(e.target.value)} aria-label={"Lohnart " + name(member)}>
        <option value="">Keine Lohnart</option>
        {payTypes.filter((p) => p.isActive || p.id === member.payTypeId).map((p) => <option key={p.id} value={p.id}>{p.title} ({euro(p.hourlyRateCents)})</option>)}
      </select>
      <Button size="sm" variant={changed ? "default" : "outline"} disabled={!changed || action.isPending}
        onClick={() => action.mutate({ url: "/api/payroll/members/" + member.memberId, method: "PATCH", data: { personnelNumber: number.trim() || null, payTypeId: payTypeId || null }, message: "Gespeichert: " + name(member) })}>
        Speichern
      </Button>
    </li>
  );
}

function Areas({ data }: { data: Settings }) {
  const action = useAction();
  if (!data.divisions.length) return null;
  return (
    <Card className="space-y-4 p-5">
      <div>
        <h3 className="font-semibold">Abweichende Lohnart je Arbeitsbereich</h3>
        <p className="text-sm text-muted-foreground">Gilt für Stunden in Schichten dieses Arbeitsbereichs und geht der Lohnart der Person vor.</p>
      </div>
      <ul className="divide-y rounded-[var(--radius)] border">
        {data.divisions.map((d) => (
          <li key={d.id} className="grid gap-2 px-3 py-2 text-sm sm:grid-cols-[1fr_14rem] sm:items-center">
            <span className="flex items-center gap-2"><span className="size-2.5 rounded-full" style={{ backgroundColor: d.color }} />{d.title}</span>
            <select className={selectClass} value={d.payTypeId ?? ""} disabled={action.isPending} aria-label={"Lohnart für " + d.title}
              onChange={(e) => action.mutate({ url: "/api/payroll/divisions/" + d.id, method: "PATCH", data: { payTypeId: e.target.value || null }, message: "Lohnart für " + d.title + " gespeichert" })}>
              <option value="">Lohnart der Person</option>
              {data.payTypes.filter((p) => p.isActive || p.id === d.payTypeId).map((p) => <option key={p.id} value={p.id}>{p.title} ({euro(p.hourlyRateCents)})</option>)}
            </select>
          </li>
        ))}
      </ul>
    </Card>
  );
}
