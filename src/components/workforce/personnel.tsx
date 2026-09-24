"use client";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { useCurrentMember } from "@/lib/hooks/use-current-member";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { json, useAction, selectClass, ErrorMessage } from "./client";
import { QualifikationAuswahl } from "./qualification-select";
// Beschaeftigungsart und Sollstunden liefert der Server nur mit "Stammdaten bearbeiten" (sonst null).
// targetHoursPerMonth: null = nicht festgelegt; der fruehere Wochenwert bleibt unberuehrt.
type Person = { id: string; position: string | null; employmentType: string | null; targetHoursPerMonth: number | null; canSeeContract: boolean; qualifications: string[]; isActive: boolean; isActivated: boolean; permissions: { editPersonnel: boolean; admin: boolean } };
export function Personnel({ id }: { id: string }) {
  const query = useQuery({ queryKey: ["personnel", id], queryFn: () => json<Person>("/api/employees/" + id) }), action = useAction();
  const { data: me } = useCurrentMember(), admin = !!me?.access.isAdmin;
  const [invite, setInvite] = useState("");
  const p = query.data;
  if (!p) return <ErrorMessage error={query.error} />;
  const edit = p.permissions.editPersonnel, contract = p.canSeeContract;
  return <Card className="p-5"><h2 className="text-[16px] font-semibold tracking-[-0.02em]">Beschäftigung und Qualifikationen</h2><form key={JSON.stringify(p)} className="grid gap-4 sm:grid-cols-2" onSubmit={async e => { e.preventDefault(); const f = new FormData(e.currentTarget); await action.mutateAsync({ url: "/api/employees/" + id, method: "PATCH", data: { position: f.get("position"), employmentType: f.get("employmentType"), targetHoursPerMonth: String(f.get("monthHours") ?? "").trim() === "" ? null : Number(f.get("monthHours")), qualifications: f.getAll("qualifications").map(String), ...(p.permissions.admin ? { isActive: f.get("active") === "true" } : {}) }, message: "Stammdaten gespeichert" }).catch(() => {}); }}>
    <label>Tätigkeit / Position<Input name="position" defaultValue={p.position || ""} disabled={!edit} maxLength={100} /></label>{contract && <><label>Beschäftigungsart<select name="employmentType" className={selectClass} defaultValue={p.employmentType ?? undefined} disabled={!edit}>{["Vollzeit", "Teilzeit", "Minijob", "Werkstudent", "Aushilfe"].map(t => <option key={t}>{t}</option>)}</select></label><label>Sollstunden pro Monat<Input name="monthHours" type="number" min={0} max={400} step={0.25} defaultValue={p.targetHoursPerMonth ?? ""} disabled={!edit} placeholder="Nicht festgelegt" /><span className="mt-1 block text-xs text-muted-foreground">Leer lassen = nicht festgelegt. 0 ist ein eingetragener Wert.</span></label></>}<label>Status<select name="active" className={selectClass} defaultValue={String(p.isActive)} disabled={!p.permissions.admin}><option value="true">Aktiv</option><option value="false">Inaktiv</option></select></label><fieldset className="sm:col-span-2"><legend className="mb-1.5 text-sm">Qualifikationen</legend><QualifikationAuswahl name="qualifications" defaultValue={p.qualifications} disabled={!edit} idPrefix={"stamm-" + id} /></fieldset>{edit && contract && <Button disabled={action.isPending}>Stammdaten speichern</Button>}</form>
    {admin && !p.isActivated && <div className="mt-4 space-y-2"><Button variant="outline" disabled={action.isPending} onClick={async () => { try { const data = await json<{url: string}>("/api/employees/" + id + "/invite", { method: "POST" }); setInvite(data.url); } catch (error) { toast.error(error instanceof Error ? error.message : "Einladung fehlgeschlagen."); } }}>Einladungslink erstellen</Button>{invite && <label className="block text-sm">Sieben Tage gültig. Diesen Link persönlich weitergeben.<Input value={invite} readOnly onFocus={e => e.target.select()} /></label>}</div>}
  </Card>;
}
