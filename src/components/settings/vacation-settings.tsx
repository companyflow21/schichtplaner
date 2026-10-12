"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ErrorMessage, json, selectClass, useAction } from "@/components/workforce/client";
import { cn } from "@/lib/utils";

type Settings = {
  enabled: boolean; categoryId: string | null; yearStart: string; startDate: string | null; daysPerYear: number; allocation: "YEARLY" | "MONTHLY";
  carryOver: boolean; carryOverMax: number | null; excludedWeekdays: number[]; countHolidays: boolean; visible: boolean;
};
type Member = { memberId: string; userId: string; firstName: string; lastName: string; included: boolean; daysPerYear: number | null; startDate: string | null; carryOver: boolean | null };
type Data = { settings: Settings | null; categories: { id: string; name: string }[]; members: Member[] };

const WEEKDAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
const DEFAULTS: Settings = { enabled: false, categoryId: null, yearStart: "01-01", startDate: null, daysPerYear: 30, allocation: "YEARLY", carryOver: true, carryOverMax: null, excludedWeekdays: [6, 7], countHolidays: false, visible: true };
const num = (text: string) => { const v = Number(text.trim().replace(",", ".")); return text.trim() === "" || !Number.isFinite(v) ? null : v; };
const toDayMonth = (mmdd: string) => mmdd.slice(3) + "." + mmdd.slice(0, 2) + ".";

/** Urlaubskonto: Regeln der Organisation und Abweichungen je Person. */
export function VacationSettings() {
  const query = useQuery({ queryKey: ["vacation-settings"], queryFn: () => json<Data>("/api/vacation/settings") });
  const action = useAction();
  const [error, setError] = useState<string | null>(null);
  if (query.isLoading) return <div className="flex justify-center py-20"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>;
  if (query.error || !query.data) return <ErrorMessage error={query.error ?? new Error("Urlaubskonto konnte nicht geladen werden.")} />;
  const s = query.data.settings ?? DEFAULTS;
  const save = (data: Partial<Settings>, message = "Urlaubskonto gespeichert") => action.mutate({ url: "/api/vacation/settings", method: "PATCH", data, message });
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Urlaubskonto</h2>
        <p className="mt-1 text-sm text-muted-foreground">Anspruch, Übertrag und genommene Tage je Person. Genehmigter Urlaub wird sofort abgezogen; Stand im Antrag, in „Abwesenheiten“ und für Mitarbeitende.</p>
      </div>
      <Card className="space-y-5 p-5">
        <div className="flex items-center justify-between gap-4">
          <div><Label>Urlaubskonto aktivieren</Label><p className="text-xs text-muted-foreground">Beim ersten Einschalten beginnt das Konto mit dem aktuellen Urlaubsjahr; Resturlaub per „Saldo anpassen“ nachtragen.</p></div>
          <Switch checked={s.enabled} disabled={action.isPending} aria-label="Urlaubskonto aktivieren" onCheckedChange={(v) => save({ enabled: v }, v ? "Urlaubskonto aktiviert" : "Urlaubskonto ausgeschaltet")} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="space-y-1.5"><span className="block text-sm font-medium">Abgezogene Abwesenheitsart</span>
            <select className={selectClass} value={s.categoryId ?? ""} disabled={action.isPending} onChange={(e) => save({ categoryId: e.target.value || null })}>
              <option value="">Bitte wählen</option>
              {query.data.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <label className="space-y-1.5"><span className="block text-sm font-medium">Zuteilung</span>
            <select className={selectClass} value={s.allocation} disabled={action.isPending} onChange={(e) => save({ allocation: e.target.value as Settings["allocation"] })}>
              <option value="YEARLY">ganzer Anspruch zu Beginn des Urlaubsjahres</option>
              <option value="MONTHLY">monatlich ein Zwölftel</option>
            </select>
          </label>
        </div>
        <form className="grid gap-4 sm:grid-cols-4 sm:items-end" onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          const perYear = num(String(f.get("daysPerYear") ?? "")), max = num(String(f.get("carryOverMax") ?? ""));
          const m = String(f.get("yearStart") ?? "").trim().match(/^(\d{1,2})\.(\d{1,2})\.?$/);
          if (perYear === null || perYear < 0 || !m) { setError("Bitte Urlaubstage je Jahr und den Beginn des Urlaubsjahres (TT.MM.) angeben."); return; }
          setError(null);
          save({ daysPerYear: perYear, carryOverMax: max, yearStart: m[2].padStart(2, "0") + "-" + m[1].padStart(2, "0"), startDate: String(f.get("startDate") || "") || null });
        }}>
          <label className="space-y-1.5"><span className="block text-sm font-medium">Urlaubstage je Jahr</span><Input name="daysPerYear" inputMode="decimal" defaultValue={String(s.daysPerYear).replace(".", ",")} /></label>
          <label className="space-y-1.5"><span className="block text-sm font-medium">Urlaubsjahr beginnt am</span><Input name="yearStart" defaultValue={toDayMonth(s.yearStart)} placeholder="01.01." /></label>
          <label className="space-y-1.5"><span className="block text-sm font-medium">Konto beginnt am</span><Input type="date" name="startDate" defaultValue={s.startDate ?? ""} /></label>
          <label className="space-y-1.5"><span className="block text-sm font-medium">Übertrag höchstens (Tage)</span><Input name="carryOverMax" inputMode="decimal" defaultValue={s.carryOverMax === null ? "" : String(s.carryOverMax).replace(".", ",")} placeholder="ohne Grenze" /></label>
          <Button className="sm:col-span-4 sm:justify-self-start" disabled={action.isPending}>Werte speichern</Button>
        </form>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <div className="space-y-2">
          <span className="block text-sm font-medium">Wochentage ohne Abzug</span>
          <div className="flex flex-wrap gap-1.5">
            {WEEKDAYS.map((label, i) => {
              const on = s.excludedWeekdays.includes(i + 1);
              return <button key={label} type="button" aria-pressed={on} disabled={action.isPending} onClick={() => save({ excludedWeekdays: on ? s.excludedWeekdays.filter((d) => d !== i + 1) : [...s.excludedWeekdays, i + 1] })} className={cn("inline-flex size-9 items-center justify-center rounded-full border text-sm", on && "border-primary bg-primary text-primary-foreground")}>{label}</button>;
            })}
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="flex items-center justify-between gap-3 text-sm">Übertrag ins nächste Jahr<Switch checked={s.carryOver} disabled={action.isPending} onCheckedChange={(v) => save({ carryOver: v })} /></label>
          <label className="flex items-center justify-between gap-3 text-sm">Urlaub an Feiertagen zählt<Switch checked={s.countHolidays} disabled={action.isPending} onCheckedChange={(v) => save({ countHolidays: v })} /></label>
          <label className="flex items-center justify-between gap-3 text-sm">Mitarbeitende sehen ihr Konto<Switch checked={s.visible} disabled={action.isPending} onCheckedChange={(v) => save({ visible: v })} /></label>
        </div>
      </Card>
      <Card className="space-y-3 p-5">
        <div><h3 className="font-semibold">Abweichende Regeln je Person</h3><p className="text-sm text-muted-foreground">Leer lassen = allgemeine Regel. Beginn z. B. Eintrittsdatum; bei späterem Beginn gilt der Anspruch anteilig.</p></div>
        <ul className="divide-y rounded-[var(--radius)] border">{query.data.members.map((m) => <PersonRule key={m.memberId + (m.daysPerYear ?? "") + (m.startDate ?? "") + String(m.carryOver) + String(m.included)} member={m} />)}</ul>
      </Card>
    </div>
  );
}

function PersonRule({ member: m }: { member: Member }) {
  const action = useAction();
  const [perYear, setPerYear] = useState(m.daysPerYear === null ? "" : String(m.daysPerYear).replace(".", ","));
  const [start, setStart] = useState(m.startDate ?? "");
  const [carry, setCarry] = useState(m.carryOver === null ? "" : String(m.carryOver));
  const [included, setIncluded] = useState(m.included);
  const changed = perYear !== (m.daysPerYear === null ? "" : String(m.daysPerYear).replace(".", ",")) || start !== (m.startDate ?? "") || carry !== (m.carryOver === null ? "" : String(m.carryOver)) || included !== m.included;
  return (
    <li className="grid gap-2 px-3 py-2 text-sm sm:grid-cols-[1fr_6rem_9rem_9rem_7rem_auto] sm:items-center">
      <span className="font-medium">{m.lastName}, {m.firstName}</span>
      <Input value={perYear} onChange={(e) => setPerYear(e.target.value)} inputMode="decimal" placeholder="Tage" aria-label={"Urlaubstage " + m.firstName + " " + m.lastName} />
      <Input type="date" value={start} onChange={(e) => setStart(e.target.value)} aria-label={"Beginn " + m.firstName + " " + m.lastName} />
      <select className={selectClass} value={carry} onChange={(e) => setCarry(e.target.value)} aria-label={"Übertrag " + m.firstName + " " + m.lastName}><option value="">Übertrag allgemein</option><option value="true">mit Übertrag</option><option value="false">ohne Übertrag</option></select>
      <label className="flex items-center gap-2"><input type="checkbox" className="size-4 accent-primary" checked={included} onChange={(e) => setIncluded(e.target.checked)} />mit Konto</label>
      <Button size="sm" variant={changed ? "default" : "outline"} disabled={!changed || action.isPending}
        onClick={() => action.mutate({ url: "/api/vacation/members/" + m.memberId, method: "PUT", data: { included, daysPerYear: num(perYear), startDate: start || null, carryOver: carry === "" ? null : carry === "true" }, message: "Gespeichert: " + m.firstName + " " + m.lastName })}>Speichern</Button>
    </li>
  );
}
