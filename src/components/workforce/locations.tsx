"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useCurrentMember } from "@/lib/hooks/use-current-member";
import { json, useAction, ErrorMessage } from "./client";
type Location = { id: string; name: string; address: string | null; meetingPoint: string | null; notes: string | null; positions: string[]; isActive: boolean };
export function Locations() {
  const query = useQuery({ queryKey: ["branches"], queryFn: () => json<{ branches: Location[] }>("/api/branches") }), action = useAction();
  const { data: me } = useCurrentMember(), manager = me && me.role !== "EMPLOYEE";
  const [edit, setEdit] = useState<Location | null | undefined>();
  return <section className="space-y-4"><div className="flex items-center justify-between gap-3"><h2>Einsatzorte</h2>{manager && <Button onClick={() => setEdit(null)}>Einsatzort anlegen</Button>}</div><ErrorMessage error={query.error} />{edit !== undefined && <Card className="p-4"><form key={edit?.id || "new"} className="grid gap-4 sm:grid-cols-2" onSubmit={async e => { e.preventDefault(); const d = new FormData(e.currentTarget); await action.mutateAsync({ url: "/api/branches", method: edit ? "PATCH" : "POST", data: { ...(edit ? { id: edit.id } : {}), name: d.get("name"), address: d.get("address"), meetingPoint: d.get("meetingPoint"), notes: d.get("notes"), positions: String(d.get("positions")).split(",").map(s => s.trim()).filter(Boolean), isActive: d.get("isActive") === "on" } }).then(() => setEdit(undefined)).catch(() => {}); }}>
    <label>Name<Input name="name" defaultValue={edit?.name} maxLength={100} required /></label><label>Adresse<Input name="address" defaultValue={edit?.address || ""} maxLength={500} /></label><label>Treffpunkt<Input name="meetingPoint" defaultValue={edit?.meetingPoint || ""} maxLength={500} /></label><label>Tätigkeiten (durch Komma getrennt)<Input name="positions" defaultValue={edit?.positions.join(", ")} /></label><label className="sm:col-span-2">Hinweise<Textarea name="notes" defaultValue={edit?.notes || ""} maxLength={2000} /></label><label className="flex gap-2 items-center"><input name="isActive" type="checkbox" defaultChecked={edit?.isActive ?? true} />Aktiver Einsatzort</label><div className="flex gap-2"><Button disabled={action.isPending}>Speichern</Button><Button type="button" variant="outline" onClick={() => setEdit(undefined)}>Abbrechen</Button></div></form></Card>}
    <div className="grid gap-4 md:grid-cols-2">{query.data?.branches.map(b => <Card className="p-4" key={b.id}><div className="flex justify-between gap-3"><h3>{b.name}{!b.isActive ? " (inaktiv)" : ""}</h3>{manager && <Button size="sm" variant="outline" onClick={() => setEdit(b)}>Bearbeiten</Button>}</div><p>{b.address}</p><p className="text-sm">Treffpunkt: {b.meetingPoint || "Nicht hinterlegt"}</p><p className="text-sm text-muted-foreground">{b.positions.join(", ")}</p><p className="whitespace-pre-wrap text-sm">{b.notes}</p></Card>)}</div>{query.data?.branches.length === 0 && <p className="text-muted-foreground">Noch keine Einsatzorte angelegt.</p>}
  </section>;
}
