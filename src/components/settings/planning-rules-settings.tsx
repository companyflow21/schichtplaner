"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ErrorMessage, json, selectClass, useAction } from "@/components/workforce/client";
import { RULE_LABEL, type PartialRules, type RuleKey, type Rules } from "@/lib/planning-rules";
import { cn } from "@/lib/utils";

type Member = { memberId: string; userId: string; firstName: string; lastName: string; own: PartialRules };
type Data = { general: Rules; members: Member[] };

const GROUPS: { title: string; keys: RuleKey[] }[] = [
  { title: "Zeitverteilung", keys: ["hours", "dailyHours", "rest"] },
  { title: "Arbeitstage", keys: ["consecutiveDays", "daysPerWeek", "workdayBlocks", "consecutiveWeekends", "freeDayAfterWeekend", "freeDayBlocks"] },
];
const num = (text: string) => { const v = Number(text.trim().replace(",", ".")); return text.trim() === "" || !Number.isFinite(v) ? null : v; };
const show = (value: number | null) => (value === null ? "" : String(value).replace(".", ","));

/**
 * Planungsregeln: links allgemeine Regeln und Personen (mit Kennzeichen bei
 * Abweichung), rechts die Regeln. Jede Aenderung wird sofort gespeichert.
 */
export function PlanningRulesSettings() {
  const query = useQuery({ queryKey: ["planning-rules"], queryFn: () => json<Data>("/api/planning-rules") });
  const [selected, setSelected] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  if (query.isLoading) return <div className="flex justify-center py-20"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>;
  if (query.error || !query.data) return <ErrorMessage error={query.error ?? new Error("Planungsregeln konnten nicht geladen werden.")} />;
  const { general, members } = query.data;
  const person = members.find((m) => m.memberId === selected) ?? null;
  const people = members.filter((m) => (m.lastName + ", " + m.firstName).toLowerCase().includes(search.trim().toLowerCase()));
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Planungsregeln</h2>
        <p className="mt-1 text-sm text-muted-foreground">Hinweise für die Planung: Verstöße erscheinen im Wochenplan und beim Veröffentlichen, sperren aber nichts. Gezählt werden alle Schichten einer Person an allen Standorten, ohne Tage mit genehmigter Abwesenheit.</p>
      </div>
      <div className="grid gap-4 md:grid-cols-[15rem_1fr]">
        <Card className="space-y-2 p-3">
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Person suchen …" aria-label="Person suchen" />
          <select className={cn(selectClass, "md:hidden")} value={selected ?? ""} onChange={(e) => setSelected(e.target.value || null)} aria-label="Regeln für">
            <option value="">Allgemeine Regeln</option>
            {people.map((m) => <option key={m.memberId} value={m.memberId}>{m.lastName}, {m.firstName}{Object.keys(m.own).length ? " (weicht ab)" : ""}</option>)}
          </select>
          <ul className="hidden max-h-[28rem] space-y-0.5 overflow-y-auto md:block">
            <li><PersonButton active={!selected} onClick={() => setSelected(null)} label="Allgemeine Regeln" /></li>
            {people.map((m) => (
              <li key={m.memberId}><PersonButton active={selected === m.memberId} onClick={() => setSelected(m.memberId)} label={m.lastName + ", " + m.firstName} deviates={Object.keys(m.own).length > 0} /></li>
            ))}
          </ul>
        </Card>
        <Card className="space-y-5 p-4">
          <div>
            <h3 className="font-semibold">{person ? person.firstName + " " + person.lastName : "Allgemeine Regeln"}</h3>
            <p className="text-sm text-muted-foreground">{person ? "Abweichungen gelten nur für diese Person; „allgemein“ übernimmt wieder die allgemeine Regel." : "Gelten für alle, soweit für eine Person nichts anderes eingestellt ist."}</p>
          </div>
          <RuleList key={selected ?? "general"} general={general} member={person} />
        </Card>
      </div>
    </div>
  );
}

function PersonButton({ active, onClick, label, deviates = false }: { active: boolean; onClick: () => void; label: string; deviates?: boolean }) {
  return (
    <button type="button" onClick={onClick} aria-current={active} className={cn("flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-left text-sm", active ? "bg-accent font-medium text-accent-foreground" : "hover:bg-muted")}>
      <span className="truncate">{label}</span>
      {deviates && <span className="shrink-0 rounded-full bg-warn/10 px-2 py-0.5 text-[11px] text-warn">weicht ab</span>}
    </button>
  );
}

function RuleList({ general, member }: { general: Rules; member: Member | null }) {
  const action = useAction();
  const [showDisabled, setShowDisabled] = useState(false);
  const url = member ? "/api/planning-rules/members/" + member.memberId : "/api/planning-rules";
  const effective = (key: RuleKey) => (member?.own[key] ?? general[key]) as Rules[RuleKey];
  const save = <K extends RuleKey>(key: K, rule: Rules[K]) => action.mutate({ url, method: "PUT", data: { rules: { [key]: rule } }, message: RULE_LABEL[key] + " gespeichert" });
  const reset = (key: RuleKey) => action.mutate({ url, method: "PUT", data: { reset: [key] }, message: RULE_LABEL[key] + ": wieder allgemein" });
  const disabled = GROUPS.flatMap((g) => g.keys).filter((k) => !effective(k).enabled);
  return (
    <div className="space-y-5">
      {GROUPS.map((group) => {
        const keys = group.keys.filter((k) => showDisabled || effective(k).enabled);
        if (!keys.length) return null;
        return (
          <section key={group.title} className="space-y-2">
            <h4 className="akro-label">{group.title}</h4>
            <ul className="divide-y rounded-[var(--radius)] border">
              {keys.map((key) => (
                <RuleRow key={key + JSON.stringify(effective(key))} ruleKey={key} rule={effective(key)} own={!!member?.own[key]} person={!!member} pending={action.isPending}
                  onSave={(rule) => save(key, rule)} onReset={() => reset(key)} />
              ))}
            </ul>
          </section>
        );
      })}
      {disabled.length > 0 && (
        <Button variant="ghost" size="sm" onClick={() => setShowDisabled((v) => !v)}>
          {showDisabled ? "Deaktivierte Regeln ausblenden" : disabled.length + (disabled.length === 1 ? " deaktivierte Regel" : " deaktivierte Regeln") + " anzeigen"}
        </Button>
      )}
    </div>
  );
}

function RuleRow({ ruleKey, rule, own, person, pending, onSave, onReset }: {
  ruleKey: RuleKey; rule: Rules[RuleKey]; own: boolean; person: boolean; pending: boolean;
  onSave: (rule: Rules[RuleKey]) => void; onReset: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const toggle = (enabled: boolean) => onSave({ ...rule, enabled } as Rules[RuleKey]);
  // Zahl speichern, sobald das Feld verlassen wird und sich der Wert geaendert hat.
  const field = (name: string, value: number | null, options: { integer?: boolean; optional?: boolean; min: number; max: number; suffix: string; label: string }) => (
    <label className="inline-flex items-center gap-1.5">
      <Input className="h-8 w-20" inputMode="decimal" defaultValue={show(value)} aria-label={options.label} disabled={pending}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
        onBlur={(e) => {
          const v = num(e.target.value);
          if (v === value) return;
          if ((v === null && !options.optional) || (v !== null && (v < options.min || v > options.max || (options.integer && !Number.isInteger(v))))) { setError(options.label + ": bitte " + (options.integer ? "eine ganze Zahl" : "eine Zahl") + " von " + options.min + " bis " + options.max + "."); return; }
          setError(null);
          onSave({ ...rule, [name]: v } as Rules[RuleKey]);
        }} />
      <span className="text-muted-foreground">{options.suffix}</span>
    </label>
  );
  let detail: React.ReactNode = null;
  if (ruleKey === "hours") {
    const r = rule as Rules["hours"];
    detail = (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <select className={cn(selectClass, "h-8 w-auto")} value={r.period} disabled={pending} aria-label="Zeitraum" onChange={(e) => onSave({ ...r, period: e.target.value as "WEEK" | "MONTH" })}>
          <option value="WEEK">je Woche</option><option value="MONTH">je Monat</option>
        </select>
        <span className="text-muted-foreground">mindestens</span>{field("min", r.min, { optional: true, min: 0, max: 744, suffix: "h", label: "Mindeststunden" })}
        <span className="text-muted-foreground">höchstens</span>{field("max", r.max, { optional: true, min: 0, max: 744, suffix: "h", label: "Höchststunden" })}
      </div>
    );
  } else if (ruleKey === "dailyHours") detail = field("max", (rule as Rules["dailyHours"]).max, { min: 1, max: 24, suffix: "h am Tag", label: "Höchststunden am Tag" });
  else if (ruleKey === "rest") detail = field("hours", (rule as Rules["rest"]).hours, { min: 1, max: 24, suffix: "h zwischen Ende und nächstem Beginn", label: "Ruhezeit in Stunden" });
  else if (ruleKey === "consecutiveDays") detail = field("max", (rule as Rules["consecutiveDays"]).max, { integer: true, min: 1, max: 31, suffix: "Tage am Stück", label: "Arbeitstage am Stück" });
  else if (ruleKey === "daysPerWeek") detail = field("max", (rule as Rules["daysPerWeek"]).max, { integer: true, min: 1, max: 7, suffix: "Tage je Woche", label: "Arbeitstage je Woche" });
  else if (ruleKey === "consecutiveWeekends") detail = field("max", (rule as Rules["consecutiveWeekends"]).max, { integer: true, min: 1, max: 52, suffix: "Wochenenden in Folge", label: "Wochenenden in Folge" });
  return (
    <li className="space-y-2 px-3 py-2.5 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="flex items-center gap-2 font-medium">
          <input type="checkbox" className="size-4 accent-primary" checked={rule.enabled} disabled={pending} onChange={(e) => toggle(e.target.checked)} />
          {RULE_LABEL[ruleKey]}
        </label>
        {person && (own
          ? <span className="flex items-center gap-2"><span className="rounded-full bg-warn/10 px-2 py-0.5 text-[11px] text-warn">eigene Regel</span><Button size="xs" variant="ghost" disabled={pending} onClick={onReset}>allgemein</Button></span>
          : <span className="text-[11px] text-muted-foreground">allgemein</span>)}
      </div>
      {rule.enabled && detail && <div className="pl-6">{detail}</div>}
      {error && <p role="alert" className="pl-6 text-xs text-destructive">{error}</p>}
    </li>
  );
}
