"use client";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useCurrentMember } from "@/lib/hooks/use-current-member";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { json, useAction, selectClass, ErrorMessage } from "./client";
type Person = { id: string; position: string | null; employmentType: string; targetHoursPerWeek: number; qualifications: string[]; isActive: boolean; isActivated: boolean };
export function Personnel({ id }: { id: string }) {
  const query = useQuery({ queryKey: ["personnel", id], queryFn: () => json<Person>("/api/employees/" + id) }), action = useAction();
  const { data: me } = useCurrentMember(), admin = me?.role === "OWNER" || me?.role === "ADMIN";
  const [invite, setInvite] = useState("");
  const p = query.data;
  if (!p) return <ErrorMessage error={query.error} />;
  return <Card className="p-5"><h2>Beschäftigung und Qualifikationen</h2><form key={JSON.stringify(p)} className="grid gap-4 sm:grid-cols-2" onSubmit={async e => { e.preventDefault(); const f = new FormData(e.currentTarget); await action.mutateAsync({ url: "/api/employees/" + id, method: "PATCH", data: { position: f.get("position"), employmentType: f.get("employmentType"), targetHoursPerWeek: Number(f.get("hours")), qualifications: String(f.get("qualifications")).split(",").map(s => s.trim()).filter(Boolean), isActive: f.get("active") === "true" } }).catch(() => {}); }}>
    <label>Tätigkeit / Position<Input name="position" defaultValue={p.position || ""} disabled={!admin} maxLength={100} /></label><label>Beschäftigungsart<select name="employmentType" className={selectClass} defaultValue={p.employmentType} disabled={!admin}>{["Vollzeit", "Teilzeit", "Minijob", "Werkstudent", "Aushilfe"].map(t => <option key={t}>{t}</option>)}</select></label><label>Sollstunden pro Woche<Input name="hours" type="number" min={0} max={80} step={0.25} defaultValue={p.targetHoursPerWeek} disabled={!admin} required /></label><label>Status<select name="active" className={selectClass} defaultValue={String(p.isActive)} disabled={!admin}><option value="true">Aktiv</option><option value="false">Inaktiv</option></select></label><label className="sm:col-span-2">Qualifikationen (durch Komma getrennt)<Input name="qualifications" defaultValue={p.qualifications.join(", ")} disabled={!admin} /></label>{admin && <Button disabled={action.isPending}>Stammdaten speichern</Button>}</form>
    {admin && !p.isActivated && <div className="mt-4 space-y-2"><Button variant="outline" disabled={action.isPending} onClick={async () => { try { const data = await json<{url: string}>("/api/employees/" + id + "/invite", { method: "POST" }); setInvite(data.url); } catch (error) { alert(error instanceof Error ? error.message : "Einladung fehlgeschlagen."); } }}>Einladungslink erstellen</Button>{invite && <label className="block text-sm">Sieben Tage gültig. Diesen Link persönlich weitergeben.<Input value={invite} readOnly onFocus={e => e.target.select()} /></label>}</div>}
  </Card>;
}
