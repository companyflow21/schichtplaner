"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, Loader2, Trash2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { InfoHint } from "@/components/ui/info-hint";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ErrorMessage, json, selectClass, useAction } from "@/components/workforce/client";
import { METHOD_LABEL } from "@/components/reporting/time-account-dialog";
import { useNameFormat } from "@/lib/hooks/use-current-member";
import { formatName } from "@/lib/names";
import { hours } from "@/lib/payroll";
import type { AccountMethod } from "@/lib/time-account";
import { cn } from "@/lib/utils";

type Member = {
  memberId: string; userId: string; firstName: string; lastName: string; isActive: boolean; targetHoursPerMonth: number | null;
  included: boolean; method: AccountMethod | null; visible: boolean | null;
  targets: { id: string; startDate: string; minutes: number; period: "WEEK" | "MONTH" }[];
};
type Data = { settings: { accountsEnabled: boolean; accountMethod: AccountMethod; accountVisible: boolean }; members: Member[] };

const date = (d: string) => new Date(d + "T12:00:00Z").toLocaleDateString("de-DE", { timeZone: "UTC", day: "2-digit", month: "2-digit", year: "numeric" });
const METHODS: AccountMethod[] = ["ACTUAL_MINUS_TARGET", "PLAN_MINUS_TARGET", "ACTUAL_MINUS_PLAN"];

/** Zeitkonten: allgemeine Einstellungen und je Person einbeziehen, Abweichungen, Soll mit Startdatum. Nur Administration. */
export function TimeAccountSettings() {
  const query = useQuery({ queryKey: ["time-account-settings"], queryFn: () => json<Data>("/api/time-accounts/settings") });
  const action = useAction();
  const nameFormat = useNameFormat();
  const [search, setSearch] = useState("");
  if (query.isLoading) return <div className="flex justify-center py-20"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>;
  if (query.error || !query.data) return <ErrorMessage error={query.error ?? new Error("Zeitkonten konnten nicht geladen werden.")} />;
  const { settings, members } = query.data;
  const save = (data: Record<string, unknown>, message: string) => action.mutate({ url: "/api/settings", method: "PATCH", data: { timeSettings: data }, message });
  const list = members.filter((m) => formatName(m, nameFormat).toLowerCase().includes(search.trim().toLowerCase()));
  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-1">
          <h2 className="text-xl font-semibold">Zeitkonten</h2>
          <InfoHint thema="Zeitkonten">
            <p>Überstundensaldo je Person aus Ist (erfasste Zeiten, bezahlte Abwesenheit), Plan (veröffentlichte Schichten) und Soll. Der Saldo erscheint als Spalte in „Stunden und Lohn“ und – wenn freigegeben – für die Person unter „Zeiterfassung“.</p>
            <p>Vorläufig (AKRO entscheidet): Saldo zum Ende des gewählten Zeitraums, Tage nach heute mit Planstunden; die Genehmigung der Stunden ändert den Saldo nicht.</p>
          </InfoHint>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">Soll je Person, Berechnungsart und Sichtbarkeit; zunächst ausgeschaltet.</p>
      </div>
      <Card className="space-y-5 p-5">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-1">
            <Label>Zeitkonten aktivieren</Label>
            <InfoHint thema="Zeitkonten aktivieren"><p>Gerechnet wird ab dem ersten Soll-Eintrag einer Person, auch rückwirkend.</p></InfoHint>
          </div>
          <Switch checked={settings.accountsEnabled} disabled={action.isPending} aria-label="Zeitkonten aktivieren" onCheckedChange={(v) => save({ accountsEnabled: v }, v ? "Zeitkonten aktiviert" : "Zeitkonten ausgeschaltet")} />
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-1">
            <Label htmlFor="konto-art">Berechnungsart</Label>
            <InfoHint thema="Berechnungsart">
              <p>Ist − Soll: Tage nach heute zählen mit ihren Planstunden.</p>
              <p>Plan − Soll: nur eingeteilte Stunden.</p>
              <p>Ist − Plan: ohne Soll, nur die Abweichung vom Plan.</p>
            </InfoHint>
          </div>
          <select id="konto-art" className={cn(selectClass, "sm:w-56")} value={settings.accountMethod} disabled={action.isPending} onChange={(e) => save({ accountMethod: e.target.value }, "Berechnungsart gespeichert")}>
            {METHODS.map((m) => <option key={m} value={m}>{METHOD_LABEL[m]}</option>)}
          </select>
        </div>
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-1">
            <Label>Mitarbeitende sehen ihren eigenen Saldo</Label>
            <InfoHint thema="Sichtbarkeit des Saldos"><p>Niemand sieht fremde Salden außer der Administration und der Disposition mit „Stunden einsehen“ für die Person. Ausgleich bucht nur die Administration.</p></InfoHint>
          </div>
          <Switch checked={settings.accountVisible} disabled={action.isPending} aria-label="Mitarbeitende sehen ihren Saldo" onCheckedChange={(v) => save({ accountVisible: v }, "Sichtbarkeit gespeichert")} />
        </div>
      </Card>
      <Card className="space-y-4 p-5">
        <div className="flex items-center gap-1">
          <h3 className="font-semibold">Personen</h3>
          <InfoHint thema="Soll je Person"><p>Soll je Woche oder Monat ab einem Startdatum; jeder Eintrag gilt bis zum nächsten. Am besten an einem Montag bzw. Monatsersten beginnen. „*“ kennzeichnet eigene Berechnungsart oder Sichtbarkeit.</p></InfoHint>
        </div>
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Person suchen …" aria-label="Person suchen" className="sm:max-w-xs" />
        <ul className="divide-y rounded-[var(--radius)] border">
          {list.map((m) => <PersonRow key={m.memberId} member={m} name={formatName(m, nameFormat)} general={settings} />)}
          {list.length === 0 && <li className="px-3 py-2 text-sm text-muted-foreground">Keine Personen gefunden.</li>}
        </ul>
      </Card>
    </div>
  );
}

function PersonRow({ member: m, name, general }: { member: Member; name: string; general: Data["settings"] }) {
  const action = useAction();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const put = (data: Record<string, unknown>) => action.mutate({ url: "/api/time-accounts/members/" + m.memberId, method: "PUT", data, message: "Zeitkonto gespeichert: " + name });
  const current = m.targets[m.targets.length - 1];
  const summary = !m.included ? "nicht einbezogen" : current ? hours(current.minutes) + " h je " + (current.period === "WEEK" ? "Woche" : "Monat") + " ab " + date(current.startDate) : "kein Soll";
  return (
    <li className="px-3 py-2 text-sm">
      <button type="button" className="flex w-full items-center gap-2 text-left" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <ChevronDown className={cn("size-4 shrink-0 text-muted-foreground transition-transform", !open && "-rotate-90")} />
        <span className={cn("min-w-0 flex-1 font-medium", !m.isActive && "text-muted-foreground")}>{name}{m.isActive ? "" : " (inaktiv)"}</span>
        <span className="shrink-0 text-right text-muted-foreground">{summary}{m.method || m.visible !== null ? " *" : ""}</span>
      </button>
      {open && (
        <div className="mt-3 space-y-3 sm:pl-6">
          <div className="grid gap-2 sm:grid-cols-3">
            <label className="flex items-center gap-2"><input type="checkbox" className="size-4 accent-primary" checked={m.included} disabled={action.isPending} onChange={(e) => put({ included: e.target.checked })} />Einbeziehen</label>
            <label className="space-y-1"><span className="block text-xs text-muted-foreground">Berechnungsart</span>
              <select className={selectClass} value={m.method ?? ""} disabled={action.isPending} onChange={(e) => put({ method: e.target.value || null })}>
                <option value="">Allgemein ({METHOD_LABEL[general.accountMethod]})</option>
                {METHODS.map((x) => <option key={x} value={x}>{METHOD_LABEL[x]}</option>)}
              </select>
            </label>
            <label className="space-y-1"><span className="block text-xs text-muted-foreground">Saldo für die Person sichtbar</span>
              <select className={selectClass} value={m.visible === null ? "" : String(m.visible)} disabled={action.isPending} onChange={(e) => put({ visible: e.target.value === "" ? null : e.target.value === "true" })}>
                <option value="">Allgemein ({general.accountVisible ? "ja" : "nein"})</option>
                <option value="true">ja</option>
                <option value="false">nein</option>
              </select>
            </label>
          </div>
          {m.targets.length > 0 && (
            <ul className="space-y-1">
              {m.targets.map((t) => (
                <li key={t.id} className="flex items-center gap-2">
                  <span className="min-w-0 flex-1">ab {date(t.startDate)}: {hours(t.minutes)} h je {t.period === "WEEK" ? "Woche" : "Monat"}</span>
                  <ConfirmDialog title="Soll-Eintrag löschen?" description={"Das Soll ab " + date(t.startDate) + " (" + hours(t.minutes) + " h je " + (t.period === "WEEK" ? "Woche" : "Monat") + ") wird entfernt; der Saldo wird neu gerechnet."} confirmLabel="Löschen" disabled={action.isPending}
                    onConfirm={() => action.mutate({ url: "/api/time-accounts/targets/" + t.id, method: "DELETE", message: "Soll-Eintrag gelöscht" })}>
                    <Button size="icon-sm" variant="ghost" aria-label="Soll-Eintrag löschen" disabled={action.isPending}><Trash2 className="size-4 text-destructive" /></Button>
                  </ConfirmDialog>
                </li>
              ))}
            </ul>
          )}
          <form className="grid gap-2 sm:grid-cols-[10rem_7rem_8rem_auto] sm:items-end" onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget), form = e.currentTarget;
            const value = Number(String(f.get("hours") ?? "").replace(",", "."));
            if (!Number.isFinite(value) || value < 0) { setError("Bitte gültige Sollstunden eingeben, z. B. 40 oder 162,5."); return; }
            setError(null);
            action.mutate({ url: "/api/time-accounts/members/" + m.memberId + "/targets", method: "POST", data: { startDate: f.get("startDate"), hours: value, period: f.get("period") }, message: "Soll gespeichert" }, { onSuccess: () => form.reset() });
          }}>
            <label className="space-y-1"><span className="block text-xs text-muted-foreground">Ab</span><Input type="date" name="startDate" required /></label>
            <label className="space-y-1"><span className="block text-xs text-muted-foreground">Sollstunden</span><Input name="hours" inputMode="decimal" defaultValue={m.targetHoursPerMonth !== null && !m.targets.length ? String(m.targetHoursPerMonth).replace(".", ",") : ""} placeholder="40" required /></label>
            <label className="space-y-1"><span className="block text-xs text-muted-foreground">je</span>
              <select name="period" className={selectClass} defaultValue={m.targetHoursPerMonth !== null && !m.targets.length ? "MONTH" : "WEEK"}><option value="WEEK">Woche</option><option value="MONTH">Monat</option></select>
            </label>
            <Button disabled={action.isPending}>Soll hinzufügen</Button>
          </form>
          {error && <p role="alert" className="text-destructive">{error}</p>}
        </div>
      )}
    </li>
  );
}
