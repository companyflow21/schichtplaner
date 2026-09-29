"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useCurrentMember } from "@/lib/hooks/use-current-member";
import { json, useAction, ErrorMessage, selectClass } from "./client";
type Location = { id: string; name: string; address: string | null; meetingPoint: string | null; notes: string | null; positions: string[]; isActive: boolean; customerId: string | null; customer: { id: string; name: string } | null; latitude: number | null; longitude: number | null; checkinRadiusM: number; gpsCheckinRequired: boolean };
type Customer = { id: string; name: string; isActive: boolean; notes?: string | null };
/** Kunden und ihre Standorte. Anlegen und Aendern nur fuer Admins - die Pruefung liegt auf dem Server. */
export function Locations() {
  const query = useQuery({ queryKey: ["branches"], queryFn: () => json<{ branches: Location[] }>("/api/branches") }), action = useAction();
  const customers = useQuery({ queryKey: ["customers"], queryFn: () => json<{ customers: Customer[] }>("/api/customers") });
  const { data: me } = useCurrentMember(), admin = !!me?.access.isAdmin;
  const [edit, setEdit] = useState<Location | null | undefined>();
  const [editCustomer, setEditCustomer] = useState<Customer | null | undefined>();
  const branches = query.data?.branches ?? [], customerList = customers.data?.customers ?? [];
  const groups = [...customerList.map(c => ({ key: c.id, customer: c as Customer | null, branches: branches.filter(b => b.customerId === c.id) })), { key: "ohne", customer: null, branches: branches.filter(b => !b.customerId) }].filter(g => g.customer || g.branches.length);
  const activeCustomers = customerList.filter(c => c.isActive || c.id === edit?.customerId);
  return <section className="space-y-4"><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-[16px] font-semibold tracking-[-0.02em]">Kunden und Einsatzorte</h2>{admin && <div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => { setEdit(undefined); setEditCustomer(null); }}>Kunde anlegen</Button><Button disabled={!activeCustomers.length} title={!activeCustomers.length ? "Zuerst einen Kunden anlegen" : undefined} onClick={() => { setEditCustomer(undefined); setEdit(null); }}>Einsatzort anlegen</Button></div>}</div><ErrorMessage error={query.error || customers.error} />
    {admin && editCustomer !== undefined && <Card className="p-4"><form key={editCustomer?.id || "neu"} className="grid gap-4 sm:grid-cols-2" onSubmit={async e => { e.preventDefault(); const d = new FormData(e.currentTarget); await action.mutateAsync({ url: editCustomer ? "/api/customers/" + editCustomer.id : "/api/customers", method: editCustomer ? "PATCH" : "POST", data: { name: d.get("name"), notes: d.get("notes") || null, isActive: d.get("isActive") === "on" }, message: editCustomer ? "Kunde gespeichert" : "Kunde angelegt" }).then(() => setEditCustomer(undefined)).catch(() => {}); }}>
      <label>Kundenname<Input name="name" defaultValue={editCustomer?.name} maxLength={120} required /></label><label className="flex items-center gap-2 sm:pt-6"><input name="isActive" type="checkbox" defaultChecked={editCustomer?.isActive ?? true} />Aktiver Kunde</label><label className="sm:col-span-2">Interne Notiz<Textarea name="notes" defaultValue={editCustomer?.notes || ""} maxLength={2000} /></label><div className="flex flex-wrap gap-2"><Button disabled={action.isPending}>Speichern</Button><Button type="button" variant="outline" onClick={() => setEditCustomer(undefined)}>Abbrechen</Button>{editCustomer && <Button type="button" variant="ghost" className="text-destructive" disabled={action.isPending} onClick={() => { if (confirm("Kunde „" + editCustomer.name + "“ endgültig löschen? Das geht nur, solange er keine Einsatzorte hat.")) action.mutateAsync({ url: "/api/customers/" + editCustomer.id, method: "DELETE", message: "Kunde gelöscht" }).then(() => setEditCustomer(undefined)).catch(() => {}); }}>Kunde löschen</Button>}</div></form></Card>}
    {admin && edit !== undefined && <Card className="p-4"><form key={edit?.id || "new"} className="grid gap-4 sm:grid-cols-2" onSubmit={async e => { e.preventDefault(); const d = new FormData(e.currentTarget); const lat = d.get("latitude") ? parseFloat(String(d.get("latitude")).replace(",", ".")) : null; const lon = d.get("longitude") ? parseFloat(String(d.get("longitude")).replace(",", ".")) : null; await action.mutateAsync({ url: "/api/branches", method: edit ? "PATCH" : "POST", data: { ...(edit ? { id: edit.id } : {}), customerId: d.get("customerId"), name: d.get("name"), address: d.get("address"), meetingPoint: d.get("meetingPoint"), notes: d.get("notes"), positions: String(d.get("positions")).split(",").map(s => s.trim()).filter(Boolean), isActive: d.get("isActive") === "on", latitude: lat, longitude: lon, checkinRadiusM: d.get("checkinRadiusM") ? parseInt(String(d.get("checkinRadiusM"))) : 50, gpsCheckinRequired: d.get("gpsCheckinRequired") === "on" }, message: edit ? "Einsatzort gespeichert" : "Einsatzort angelegt" }).then(() => setEdit(undefined)).catch(() => {}); }}>
      <label>Kunde<select name="customerId" defaultValue={edit?.customerId || ""} className={selectClass} required>{!edit?.customerId && <option value="">Bitte wählen</option>}{activeCustomers.map(c => <option key={c.id} value={c.id}>{c.name}{!c.isActive ? " (inaktiv)" : ""}</option>)}</select></label>
      <label>Name<Input name="name" defaultValue={edit?.name} maxLength={100} required /></label><label>Adresse<Input name="address" defaultValue={edit?.address || ""} maxLength={500} /></label><label>Treffpunkt<Input name="meetingPoint" defaultValue={edit?.meetingPoint || ""} maxLength={500} /></label><label>Tätigkeiten (durch Komma getrennt)<Input name="positions" defaultValue={edit?.positions.join(", ")} /></label><label className="flex gap-2 items-center sm:pt-6"><input name="isActive" type="checkbox" defaultChecked={edit?.isActive ?? true} />Aktiver Einsatzort</label><label className="sm:col-span-2">Hinweise<Textarea name="notes" defaultValue={edit?.notes || ""} maxLength={2000} /></label>
      <fieldset className="sm:col-span-2 border border-gray-300 rounded-lg p-4"><legend className="text-[14px] font-semibold tracking-[-0.02em] px-2">GPS-Check-in</legend><div className="grid gap-4 sm:grid-cols-2"><label>Breitengrad<Input name="latitude" type="text" placeholder="z.B. 50,7374" defaultValue={edit?.latitude ? String(edit.latitude).replace(".", ",") : ""} /></label><label>Längengrad<Input name="longitude" type="text" placeholder="z.B. 6,6389" defaultValue={edit?.longitude ? String(edit.longitude).replace(".", ",") : ""} /></label><label>Check-in-Radius (m)<Input name="checkinRadiusM" type="number" min="10" max="1000" defaultValue={edit?.checkinRadiusM ?? 50} required /></label><label className="flex gap-2 items-center sm:col-span-2"><input name="gpsCheckinRequired" type="checkbox" defaultChecked={edit?.gpsCheckinRequired ?? false} />GPS-Check-in erforderlich</label><LocationButton /></div><p className="text-sm text-muted-foreground mt-2">Mittelpunkt des Dienstorts. Mitarbeitende können sich nur innerhalb des Radius einchecken. Die Position wird nur beim Einchecken abgefragt.</p></fieldset><div className="flex flex-wrap gap-2"><Button disabled={action.isPending}>Speichern</Button><Button type="button" variant="outline" onClick={() => setEdit(undefined)}>Abbrechen</Button>{edit && <Button type="button" variant="ghost" className="text-destructive" disabled={action.isPending} onClick={() => { if (confirm("Einsatzort „" + edit.name + "“ endgültig löschen? Das geht nur, solange es dort keine Schichten, Zeiten oder Meldungen gibt.")) action.mutateAsync({ url: "/api/branches/" + edit.id, method: "DELETE", message: "Einsatzort gelöscht" }).then(() => setEdit(undefined)).catch(() => {}); }}>Einsatzort löschen</Button>}</div></form></Card>}
    {groups.map(g => <div key={g.key} className="space-y-3"><div className="flex flex-wrap items-center justify-between gap-3 border-b pb-2"><div className="min-w-0"><h3 className="text-[15px] font-semibold tracking-[-0.02em]">{g.customer ? g.customer.name : "Ohne Kunde"}{g.customer && !g.customer.isActive ? " (inaktiv)" : ""}</h3>{!g.customer && <p className="text-sm text-muted-foreground">Diese Einsatzorte sind noch keinem Kunden zugeordnet. Neue Schichten sind dort erst nach der Zuordnung möglich.</p>}{admin && g.customer?.notes && <p className="whitespace-pre-wrap text-sm text-muted-foreground">{g.customer.notes}</p>}</div>{admin && g.customer && <Button size="sm" variant="ghost" onClick={() => { setEdit(undefined); setEditCustomer(g.customer); }}>Kunde bearbeiten</Button>}</div>
      {g.branches.length ? <div className="grid gap-4 md:grid-cols-2">{g.branches.map(b => <Card className="p-4" key={b.id}><div className="flex justify-between gap-3"><h4 className="text-[14px] font-semibold tracking-[-0.02em]">{b.name}{!b.isActive ? " (inaktiv)" : ""}</h4>{admin && <Button size="sm" variant="outline" onClick={() => { setEditCustomer(undefined); setEdit(b); }}>{b.customerId ? "Bearbeiten" : "Kunden zuordnen"}</Button>}</div><p>{b.address}</p><p className="text-sm">Treffpunkt: {b.meetingPoint || "Nicht hinterlegt"}</p><p className="text-sm text-muted-foreground">{b.positions.join(", ")}</p><p className="whitespace-pre-wrap text-sm">{b.notes}</p>{admin && <p className="text-sm text-muted-foreground">GPS-Check-in: {b.gpsCheckinRequired ? "erforderlich, Radius " + b.checkinRadiusM + " m" : b.latitude !== null ? "eingerichtet, nicht erforderlich" : "aus"}</p>}</Card>)}</div> : <p className="text-sm text-muted-foreground">Noch keine Einsatzorte für diesen Kunden.</p>}
    </div>)}
    {query.isSuccess && customers.isSuccess && !groups.length && <p className="text-muted-foreground">{admin ? "Noch keine Kunden angelegt. Lege zuerst einen Kunden an, danach seine Einsatzorte." : "Dir ist noch kein Einsatzort freigegeben."}</p>}
  </section>;
}

function LocationButton() {
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleGetLocation = () => {
    setError(null);
    setAccuracy(null);

    if (!navigator.geolocation) {
      setError("Geolocation wird von Ihrem Browser nicht unterstützt.");
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const lat = position.coords.latitude;
        const lon = position.coords.longitude;
        const acc = Math.round(position.coords.accuracy);
        setAccuracy(acc);

        // Fill the form fields
        const form = (document.querySelector('input[name="latitude"]') as HTMLInputElement | null);
        const lonInput = (document.querySelector('input[name="longitude"]') as HTMLInputElement | null);
        if (form) form.value = String(lat).replace(".", ",");
        if (lonInput) lonInput.value = String(lon).replace(".", ",");
      },
      (err) => {
        const messages: Record<number, string> = {
          1: "Sie haben die Standortfreigabe verweigert. Bitte aktivieren Sie sie in den Browsereinstellungen.",
          2: "Standort konnte nicht ermittelt werden. Überprüfen Sie Ihre Internetverbindung.",
          3: "Die Anfrage hat das Zeitlimit überschritten.",
        };
        setError(messages[err.code] || "Fehler beim Abrufen des Standorts.");
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  };

  return (
    <div className="sm:col-span-2 space-y-2">
      <Button type="button" variant="outline" onClick={handleGetLocation}>
        Aktuellen Standort übernehmen
      </Button>
      {accuracy !== null && <p className="text-sm text-green-600">Genauigkeit: ±{accuracy} m</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}
      <p className="text-xs text-muted-foreground">Der Browser fragt um Standorterlaubnis. Dies funktioniert nur über HTTPS.</p>
    </div>
  );
}
