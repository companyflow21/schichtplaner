"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useCurrentMember } from "@/lib/hooks/use-current-member";
import { json, useAction, ErrorMessage, selectClass } from "./client";
import { DE_STATES } from "@/lib/holidays";
type Location = { id: string; holidayState?: string | null; name: string; address: string | null; meetingPoint: string | null; notes: string | null; positions: string[]; isActive: boolean; customerId: string | null; customer: { id: string; name: string } | null; latitude: number | null; longitude: number | null; checkinRadiusM: number; gpsCheckinRequired: boolean };
type Customer = { id: string; name: string; isActive: boolean; notes?: string | null };
/** Kunden und ihre Standorte. Anlegen, Aendern und Archivieren nur fuer Admins - die Pruefung liegt auf dem Server. */
export function Locations() {
  const query = useQuery({ queryKey: ["branches"], queryFn: () => json<{ branches: Location[] }>("/api/branches") }), action = useAction();
  const customers = useQuery({ queryKey: ["customers"], queryFn: () => json<{ customers: Customer[] }>("/api/customers") });
  const { data: me } = useCurrentMember(), admin = !!me?.access.isAdmin;
  const archive = useQuery({ queryKey: ["branches", "archive"], queryFn: () => json<ArchiveData>("/api/branches/archive"), enabled: admin });
  // Fehlertexte des Servers (etwa 409 mit Anzahl der Schichten) erscheinen woertlich als Hinweis.
  const archivieren: ArchivHandler = (url, name) => { action.mutateAsync({ url: url + "/archive", method: "POST", message: "„" + name + "“ archiviert" }).catch(() => {}); };
  const wiederherstellen: ArchivHandler = (url, name) => { action.mutateAsync({ url: url + "/archive", method: "DELETE", message: "„" + name + "“ wiederhergestellt" }).catch(() => {}); };
  const endgueltigLoeschen: ArchivHandler = (url, name) => { action.mutateAsync({ url, method: "DELETE", message: "„" + name + "“ endgültig gelöscht" }).catch(() => {}); };
  const [edit, setEdit] = useState<Location | null | undefined>();
  const [editCustomer, setEditCustomer] = useState<Customer | null | undefined>();
  const branches = query.data?.branches ?? [], customerList = customers.data?.customers ?? [];
  const groups = [...customerList.map(c => ({ key: c.id, customer: c as Customer | null, branches: branches.filter(b => b.customerId === c.id) })), { key: "ohne", customer: null, branches: branches.filter(b => !b.customerId) }].filter(g => g.customer || g.branches.length);
  const activeCustomers = customerList.filter(c => c.isActive || c.id === edit?.customerId);
  return <section className="space-y-4"><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-[16px] font-semibold tracking-[-0.02em]">Kunden und Einsatzorte</h2>{admin && <div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => { setEdit(undefined); setEditCustomer(null); }}>Kunde anlegen</Button><Button disabled={!activeCustomers.length} title={!activeCustomers.length ? "Zuerst einen Kunden anlegen" : undefined} onClick={() => { setEditCustomer(undefined); setEdit(null); }}>Einsatzort anlegen</Button></div>}</div><ErrorMessage error={query.error || customers.error || archive.error} />
    {admin && editCustomer !== undefined && <Card className="p-4"><form key={editCustomer?.id || "neu"} className="grid gap-4 sm:grid-cols-2" onSubmit={async e => { e.preventDefault(); const d = new FormData(e.currentTarget); await action.mutateAsync({ url: editCustomer ? "/api/customers/" + editCustomer.id : "/api/customers", method: editCustomer ? "PATCH" : "POST", data: { name: d.get("name"), notes: d.get("notes") || null, isActive: d.get("isActive") === "on" }, message: editCustomer ? "Kunde gespeichert" : "Kunde angelegt" }).then(() => setEditCustomer(undefined)).catch(() => {}); }}>
      <label>Kundenname<Input name="name" defaultValue={editCustomer?.name} maxLength={120} required /></label><label className="flex items-center gap-2 sm:pt-6"><input name="isActive" type="checkbox" defaultChecked={editCustomer?.isActive ?? true} />Aktiver Kunde</label><label className="sm:col-span-2">Interne Notiz<Textarea name="notes" defaultValue={editCustomer?.notes || ""} maxLength={2000} /></label><div className="flex flex-wrap gap-2"><Button disabled={action.isPending}>Speichern</Button><Button type="button" variant="outline" onClick={() => setEditCustomer(undefined)}>Abbrechen</Button>{editCustomer && <ConfirmDialog title="Kunde löschen?" description={"Der Kunde „" + editCustomer.name + "“ wird endgültig gelöscht. Das geht nur, solange er keine Einsatzorte hat; alternativ lässt er sich archivieren."} confirmLabel="Kunde löschen" disabled={action.isPending} onConfirm={() => { action.mutateAsync({ url: "/api/customers/" + editCustomer.id, method: "DELETE", message: "Kunde gelöscht" }).then(() => setEditCustomer(undefined)).catch(() => {}); }}><Button type="button" variant="ghost" className="ml-auto text-destructive" disabled={action.isPending}>Kunde löschen</Button></ConfirmDialog>}</div></form></Card>}
    {admin && edit !== undefined && <Card className="p-4"><form key={edit?.id || "new"} className="grid gap-4 sm:grid-cols-2" onSubmit={async e => { e.preventDefault(); const d = new FormData(e.currentTarget); const lat = d.get("latitude") ? parseFloat(String(d.get("latitude")).replace(",", ".")) : null; const lon = d.get("longitude") ? parseFloat(String(d.get("longitude")).replace(",", ".")) : null; await action.mutateAsync({ url: "/api/branches", method: edit ? "PATCH" : "POST", data: { ...(edit ? { id: edit.id } : {}), customerId: d.get("customerId"), name: d.get("name"), address: d.get("address"), meetingPoint: d.get("meetingPoint"), notes: d.get("notes"), positions: String(d.get("positions")).split(",").map(s => s.trim()).filter(Boolean), isActive: d.get("isActive") === "on", latitude: lat, longitude: lon, checkinRadiusM: d.get("checkinRadiusM") ? parseInt(String(d.get("checkinRadiusM"))) : 50, gpsCheckinRequired: d.get("gpsCheckinRequired") === "on", holidayState: d.get("holidayState") || null }, message: edit ? "Einsatzort gespeichert" : "Einsatzort angelegt" }).then(() => setEdit(undefined)).catch(() => {}); }}>
      <label>Kunde<select name="customerId" defaultValue={edit?.customerId || ""} className={selectClass} required>{!edit?.customerId && <option value="">Bitte wählen</option>}{activeCustomers.map(c => <option key={c.id} value={c.id}>{c.name}{!c.isActive ? " (inaktiv)" : ""}</option>)}</select></label>
      <label>Bundesland (Feiertage)<select name="holidayState" defaultValue={edit?.holidayState || ""} className={selectClass}><option value="">Nicht festgelegt</option>{DE_STATES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}</select><span className="mt-1 block text-xs text-muted-foreground">Bestimmt die gesetzlichen Feiertage im Dienstplan dieses Einsatzorts.</span></label>
      <label>Name<Input name="name" defaultValue={edit?.name} maxLength={100} required /></label><label>Adresse<Input name="address" defaultValue={edit?.address || ""} maxLength={500} /></label><label>Treffpunkt<Input name="meetingPoint" defaultValue={edit?.meetingPoint || ""} maxLength={500} /></label><label>Tätigkeiten (durch Komma getrennt)<Input name="positions" defaultValue={edit?.positions.join(", ")} /></label><label className="flex gap-2 items-center sm:pt-6"><input name="isActive" type="checkbox" defaultChecked={edit?.isActive ?? true} />Aktiver Einsatzort</label><label className="sm:col-span-2">Hinweise<Textarea name="notes" defaultValue={edit?.notes || ""} maxLength={2000} /></label>
      <fieldset className="sm:col-span-2 border border-gray-300 rounded-lg p-4"><legend className="text-[14px] font-semibold tracking-[-0.02em] px-2">GPS-Check-in</legend><div className="grid gap-4 sm:grid-cols-2"><label>Breitengrad<Input name="latitude" type="text" placeholder="z.B. 50,7374" defaultValue={edit?.latitude ? String(edit.latitude).replace(".", ",") : ""} /></label><label>Längengrad<Input name="longitude" type="text" placeholder="z.B. 6,6389" defaultValue={edit?.longitude ? String(edit.longitude).replace(".", ",") : ""} /></label><label>Check-in-Radius (m)<Input name="checkinRadiusM" type="number" min="10" max="1000" defaultValue={edit?.checkinRadiusM ?? 50} required /></label><label className="flex gap-2 items-center sm:col-span-2"><input name="gpsCheckinRequired" type="checkbox" defaultChecked={edit?.gpsCheckinRequired ?? false} />GPS-Check-in erforderlich</label><LocationButton /></div><p className="text-sm text-muted-foreground mt-2">Mittelpunkt des Dienstorts. Mitarbeitende können sich nur innerhalb des Radius einchecken. Die Position wird nur beim Einchecken abgefragt.</p></fieldset><div className="flex flex-wrap gap-2"><Button disabled={action.isPending}>Speichern</Button><Button type="button" variant="outline" onClick={() => setEdit(undefined)}>Abbrechen</Button>{edit && <ConfirmDialog title="Einsatzort löschen?" description={"Der Einsatzort „" + edit.name + "“ wird endgültig gelöscht, samt leeren Wochenplänen und Freigaben. Das geht nur, solange es dort keine Schichten, Zeiten oder Meldungen gibt; alternativ lässt er sich archivieren."} confirmLabel="Einsatzort löschen" disabled={action.isPending} onConfirm={() => { action.mutateAsync({ url: "/api/branches/" + edit.id, method: "DELETE", message: "Einsatzort gelöscht" }).then(() => setEdit(undefined)).catch(() => {}); }}><Button type="button" variant="ghost" className="ml-auto text-destructive" disabled={action.isPending}>Einsatzort löschen</Button></ConfirmDialog>}</div></form></Card>}
    {groups.map(g => <div key={g.key} className="space-y-3"><div className="flex flex-wrap items-center justify-between gap-3 border-b pb-2"><div className="min-w-0"><h3 className="text-[15px] font-semibold tracking-[-0.02em]">{g.customer ? g.customer.name : "Ohne Kunde"}{g.customer && !g.customer.isActive ? " (inaktiv)" : ""}</h3>{!g.customer && <p className="text-sm text-muted-foreground">Diese Einsatzorte sind noch keinem Kunden zugeordnet. Neue Schichten sind dort erst nach der Zuordnung möglich.</p>}{admin && g.customer?.notes && <p className="whitespace-pre-wrap text-sm text-muted-foreground">{g.customer.notes}</p>}</div>{admin && g.customer && <div className="flex flex-wrap gap-2"><Button size="sm" variant="ghost" onClick={() => { setEdit(undefined); setEditCustomer(g.customer); }}>Kunde bearbeiten</Button><ArchivierenKnopf url={"/api/customers/" + g.customer.id} name={g.customer.name} einsatzorte={g.branches.length} pending={action.isPending} onArchive={archivieren} /></div>}</div>
      {g.branches.length ? <div className="grid gap-4 md:grid-cols-2">{g.branches.map(b => <Card className="p-4" key={b.id}><div className="flex flex-wrap items-start justify-between gap-2"><h4 className="min-w-0 break-words text-[14px] font-semibold tracking-[-0.02em]">{b.name}{!b.isActive ? " (inaktiv)" : ""}</h4>{admin && <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => { setEditCustomer(undefined); setEdit(b); }}>{b.customerId ? "Bearbeiten" : "Kunden zuordnen"}</Button><ArchivierenKnopf url={"/api/branches/" + b.id} name={b.name} pending={action.isPending} onArchive={archivieren} /></div>}</div><p>{b.address}</p><p className="text-sm">Treffpunkt: {b.meetingPoint || "Nicht hinterlegt"}</p><p className="text-sm">Bundesland: {DE_STATES.find(s => s.value === b.holidayState)?.label ?? <span className="text-warn">nicht festgelegt – Feiertage unbekannt</span>}</p><p className="text-sm text-muted-foreground">{b.positions.join(", ")}</p><p className="whitespace-pre-wrap text-sm">{b.notes}</p>{admin && <p className="text-sm text-muted-foreground">GPS-Check-in: {b.gpsCheckinRequired ? "erforderlich, Radius " + b.checkinRadiusM + " m" : b.latitude !== null ? "eingerichtet, nicht erforderlich" : "aus"}</p>}</Card>)}</div> : <p className="text-sm text-muted-foreground">Noch keine Einsatzorte für diesen Kunden.</p>}
    </div>)}
    {query.isSuccess && customers.isSuccess && !groups.length && <p className="text-muted-foreground">{admin ? "Noch keine Kunden angelegt. Lege zuerst einen Kunden an, danach seine Einsatzorte." : "Dir ist noch kein Einsatzort freigegeben."}</p>}
    {admin && archive.data && <Archiv data={archive.data} pending={action.isPending} onRestore={wiederherstellen} onDelete={endgueltigLoeschen} />}
  </section>;
}

type ArchivedCustomer = { id: string; name: string; archivedAt: string; deletable: boolean };
type ArchivedBranch = { id: string; name: string; archivedAt: string; deletable: boolean; customer: { id: string; name: string; archivedAt: string | null } | null };
export type ArchiveData = { customers: ArchivedCustomer[]; branches: ArchivedBranch[] };
/** url: "/api/customers/ID" oder "/api/branches/ID". */
type ArchivHandler = (url: string, name: string) => void;

const archivDatum = (iso: string) => new Date(iso).toLocaleDateString("de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", year: "numeric" });

/** Was archiviert wird; einsatzorte nur beim Kunden (seine nicht archivierten Einsatzorte). */
export function archivierenText(name: string, einsatzorte?: number) {
  if (einsatzorte === undefined) return "Der Einsatzort „" + name + "“ wird archiviert. Das geht nur, wenn dort keine laufenden oder zukünftigen Schichten mehr geplant sind.";
  return "Der Kunde „" + name + "“ wird inklusive " + einsatzorte + (einsatzorte === 1 ? " Einsatzort" : " Einsatzorte") + " archiviert. Das geht nur, wenn an keinem davon laufende oder zukünftige Schichten geplant sind.";
}

/** Folgen des Archivierens in einfachen Saetzen. */
export function ArchivierenFolgen() {
  return <ul className="list-disc space-y-1 pl-5">
    <li>Verschwindet aus Dienstplan, Auswahllisten und Startseite.</li>
    <li>Dort sind keine neuen Schichten, Einteilungen oder Freigaben mehr möglich.</li>
    <li>Vergangene Schichten, Zeiten und Stunden bleiben erhalten und in der Auswertung sichtbar.</li>
    <li>Wiederherstellen ist jederzeit unten im Archiv möglich.</li>
  </ul>;
}

/** Knopf "Archivieren" mit Rueckfrage und Folgen. */
export function ArchivierenKnopf({ url, name, einsatzorte, pending, onArchive }: { url: string; name: string; einsatzorte?: number; pending: boolean; onArchive: ArchivHandler }) {
  return <ConfirmDialog title={einsatzorte === undefined ? "Einsatzort archivieren?" : "Kunde archivieren?"} description={archivierenText(name, einsatzorte)} details={<ArchivierenFolgen />} confirmLabel="Archivieren" destructive={false} disabled={pending} onConfirm={() => onArchive(url, name)}>
    <Button type="button" size="sm" variant="ghost" disabled={pending}>Archivieren</Button>
  </ConfirmDialog>;
}

/** Eingeklappter Bereich am Seitenende: archivierte Kunden und Einsatzorte mit Datum; endgueltig loeschen nur ohne Historie. */
export function Archiv({ data, pending, onRestore, onDelete }: { data: ArchiveData; pending: boolean; onRestore: ArchivHandler; onDelete: ArchivHandler }) {
  const anzahl = data.customers.length + data.branches.length;
  const zeile = { pending, onRestore, onDelete };
  return <details className="rounded-[var(--radius)] border bg-card">
    <summary className="cursor-pointer px-4 py-3 text-[15px] font-semibold tracking-[-0.02em]">Archiv ({anzahl})</summary>
    <div className="space-y-4 border-t px-4 py-3">
      <p className="text-[13px] text-muted-foreground">Archivierte Kunden und Einsatzorte sind aus Planung und Listen ausgeblendet; ihre vergangenen Schichten, Zeiten und Stunden bleiben erhalten. Endgültig löschen lässt sich nur, was noch keine Historie hat.</p>
      {!anzahl && <p className="text-sm text-muted-foreground">Nichts archiviert.</p>}
      {data.customers.length > 0 && <div><h3 className="akro-label">Kunden</h3><ul className="divide-y">{data.customers.map(c => <ArchivZeile key={c.id} {...zeile} url={"/api/customers/" + c.id} name={c.name} info={"archiviert am " + archivDatum(c.archivedAt)} deletable={c.deletable} />)}</ul></div>}
      {data.branches.length > 0 && <div><h3 className="akro-label">Einsatzorte</h3><ul className="divide-y">{data.branches.map(b => <ArchivZeile key={b.id} {...zeile} url={"/api/branches/" + b.id} name={b.name} info={[b.customer?.name ?? "Ohne Kunde", "archiviert am " + archivDatum(b.archivedAt), ...(b.deletable ? [] : ["mit Historie"])].join(" · ")} hinweis={b.customer?.archivedAt ? "Kunde archiviert – zuerst den Kunden wiederherstellen." : undefined} deletable={b.deletable} />)}</ul></div>}
    </div>
  </details>;
}

function ArchivZeile({ url, name, info, hinweis, deletable, pending, onRestore, onDelete }: { url: string; name: string; info: string; hinweis?: string; deletable: boolean; pending: boolean; onRestore: ArchivHandler; onDelete: ArchivHandler }) {
  return <li className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2.5">
    <div className="min-w-0 flex-1 basis-48"><p className="break-words text-[14px] font-medium">{name}</p><p className="text-[12px] text-muted-foreground">{info}</p>{hinweis && <p className="text-[12px] text-warn">{hinweis}</p>}</div>
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => onRestore(url, name)}>Wiederherstellen</Button>
      {deletable && <span className="border-l pl-2"><ConfirmDialog title="Endgültig löschen?" description={"„" + name + "“ wird endgültig gelöscht. Das lässt sich nicht rückgängig machen."} confirmLabel="Endgültig löschen" disabled={pending} onConfirm={() => onDelete(url, name)}><Button type="button" size="sm" variant="ghost" className="text-destructive" disabled={pending}>Endgültig löschen</Button></ConfirmDialog></span>}
    </div>
  </li>;
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
