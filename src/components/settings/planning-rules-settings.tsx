"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InfoHint } from "@/components/ui/info-hint";
import { ErrorMessage, json, selectClass, useAction } from "@/components/workforce/client";
import { RULE_LABEL, type PartialRules, type RuleKey, type Rules } from "@/lib/planning-rules";
import { cn } from "@/lib/utils";

type Member = { memberId: string; userId: string; name: string; own: PartialRules };
type Data = { general: Rules; members: Member[] };

const GROUPS: { title: string; keys: RuleKey[] }[] = [
  { title: "Zeitverteilung", keys: ["hours", "dailyHours", "rest"] },
  { title: "Arbeitstage", keys: ["consecutiveDays", "daysPerWeek", "workdayBlocks", "consecutiveWeekends", "freeDayAfterWeekend", "freeDayBlocks"] },
];
/** Erklaerung je Regel (ⓘ) - beschreibt, wie src/lib/planning-rules.ts zaehlt. */
const RULE_HELP: Record<RuleKey, string> = {
  hours: "Summe der Planstunden (Dauer minus Pause) je Kalenderwoche (Mo–So) oder Kalendermonat. Eine Schicht zählt zu dem Tag, an dem sie beginnt. Vorbelegt: höchstens 48 h je Woche nach dem Arbeitszeitgesetz.",
  dailyHours: "Summe der Planstunden aller Schichten, die an einem Tag beginnen. Vorbelegt: 10 h nach dem Arbeitszeitgesetz.",
  rest: "Zeit vom Ende einer Schicht bis zum Beginn der nächsten. Schichten mit höchstens 15 Minuten Abstand gelten als ein Block. Vorbelegt: 11 h nach dem Arbeitszeitgesetz.",
  consecutiveDays: "Tage mit mindestens einer Schicht ohne freien Tag dazwischen. Gemeldet werden die Tage über der Grenze.",
  daysPerWeek: "Tage mit mindestens einer Schicht in einer Kalenderwoche (Mo–So).",
  workdayBlocks: "Meldet einen Arbeitstag ohne Arbeitstag davor und danach.",
  consecutiveWeekends: "Ein Wochenende zählt, wenn am Samstag oder Sonntag eine Schicht beginnt.",
  freeDayAfterWeekend: "Für jeden Samstag oder Sonntag mit Schicht ein freier Werktag (Mo–Fr) in der Woche danach.",
  freeDayBlocks: "Meldet einen einzelnen freien Tag zwischen zwei Arbeitstagen.",
};
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
  const people = members.filter((m) => m.name.toLowerCase().includes(search.trim().toLowerCase()));
  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-1">
          <h2 className="text-xl font-semibold">Planungsregeln</h2>
          <InfoHint thema="Planungsregeln">
            <p>Verstöße erscheinen im Wochenplan unter der Konfliktprüfung und beim Veröffentlichen, sperren aber nichts.</p>
            <p>Gezählt werden alle Schichten einer Person an allen Standorten, auch in Entwürfen, ohne Tage mit genehmigter Abwesenheit. Subunternehmer-Platzhalter zählen nicht.</p>
          </InfoHint>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">Hinweise für die Planung; alle Regeln sind zunächst ausgeschaltet.</p>
      </div>
      <div className="grid gap-4 md:grid-cols-[15rem_1fr]">
        <Card className="space-y-2 p-3">
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Person suchen …" aria-label="Person suchen" />
          <select className={cn(selectClass, "md:hidden")} value={selected ?? ""} onChange={(e) => setSelected(e.target.value || null)} aria-label="Regeln für">
            <option value="">Allgemeine Regeln</option>
            {people.map((m) => <option key={m.memberId} value={m.memberId}>{m.name}{Object.keys(m.own).length ? " (weicht ab)" : ""}</option>)}
          </select>
          <ul className="hidden max-h-[28rem] space-y-0.5 overflow-y-auto md:block">
            <li><PersonButton active={!selected} onClick={() => setSelected(null)} label="Allgemeine Regeln" /></li>
            {people.map((m) => (
              <li key={m.memberId}><PersonButton active={selected === m.memberId} onClick={() => setSelected(m.memberId)} label={m.name} deviates={Object.keys(m.own).length > 0} /></li>
            ))}
          </ul>
        </Card>
        <Card className="space-y-5 p-4">
          <div>
            <h3 className="font-semibold">{person ? person.name : "Allgemeine Regeln"}</h3>
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
      {deviates && <span className="shrink-0 rounded-full bg-warn/10 px-2 py-0.5 text-xs text-warn">weicht ab</span>}
    </button>
  );
}

function RuleList({ general, member }: { general: Rules; member: Member | null }) {
  const action = useAction();
  const [showDisabled, setShowDisabled] = useState(false);
  const url = member ? "/api/planning-rules/members/" + member.memberId : "/api/planning-rules";
  const effective = (key: RuleKey) => (member?.own[key] ?? general[key]) as Rules[RuleKey];
  const save = <K extends RuleKey>(key: K, rule: Rules[K], onError?: () => void) => action.mutate({ url, method: "PUT", data: { rules: { [key]: rule } }, message: RULE_LABEL[key] + " gespeichert" }, { onError });
  const reset = (key: RuleKey) => action.mutate({ url, method: "PUT", data: { reset: [key] }, message: RULE_LABEL[key] + ": wieder allgemein" });
  // Ausgeschaltete Regeln eingeklappt - ausser eigenen Regeln der Person (sonst waere die Abweichung unsichtbar).
  const shown = (k: RuleKey) => effective(k).enabled || !!member?.own[k];
  const disabled = GROUPS.flatMap((g) => g.keys).filter((k) => !shown(k));
  return (
    <div className="space-y-5">
      {GROUPS.map((group) => {
        const keys = group.keys.filter((k) => showDisabled || shown(k));
        if (!keys.length) return null;
        return (
          <section key={group.title} className="space-y-2">
            <h4 className="akro-label">{group.title}</h4>
            <ul className="divide-y rounded-[var(--radius)] border">
              {keys.map((key) => (
                <RuleRow key={key + JSON.stringify(effective(key))} ruleKey={key} rule={effective(key)} own={!!member?.own[key]} person={!!member} pending={action.isPending}
                  onSave={(rule, onError) => save(key, rule, onError)} onReset={() => reset(key)} />
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
  onSave: (rule: Rules[RuleKey], onError?: () => void) => void; onReset: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  // Sofort umschalten; die Zeile wird mit dem gespeicherten Stand neu aufgebaut (key).
  const [enabled, setEnabled] = useState(rule.enabled);
  const toggle = (value: boolean) => { setEnabled(value); onSave({ ...rule, enabled: value } as Rules[RuleKey], () => setEnabled(rule.enabled)); };
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
        <span className="flex items-center gap-1">
          <label className="flex items-center gap-2 font-medium max-md:min-h-11">
            <input type="checkbox" className="size-4 accent-primary" checked={enabled} disabled={pending} onChange={(e) => toggle(e.target.checked)} />
            {RULE_LABEL[ruleKey]}
          </label>
          <InfoHint thema={RULE_LABEL[ruleKey]}><p>{RULE_HELP[ruleKey]}</p></InfoHint>
        </span>
        {person && (own
          ? <span className="flex items-center gap-2"><span className="rounded-full bg-warn/10 px-2 py-0.5 text-xs text-warn">eigene Regel</span><Button size="xs" variant="ghost" className="max-md:h-11" disabled={pending} onClick={onReset}>allgemein</Button></span>
          : <span className="text-xs text-muted-foreground">allgemein</span>)}
      </div>
      {enabled && detail && <div className="pl-6">{detail}</div>}
      {error && <p role="alert" className="pl-6 text-xs text-destructive">{error}</p>}
    </li>
  );
}
