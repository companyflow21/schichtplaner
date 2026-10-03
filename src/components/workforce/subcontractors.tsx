"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { berlinDate } from "@/lib/berlin";
import { dateLabel, ErrorMessage, json, selectClass, useAction } from "./client";

type Worker = { id: string; name: string; isActive: boolean };
type Subcontractor = { id: string; name: string; isActive: boolean; workers: Worker[] };
type Assignment = {
  id: string;
  contractorWorkerId: string;
  workerName: string;
  shiftId: string;
  date: string;
  shiftFrom: string;
  shiftTo: string;
  title: string | null;
  branchName: string | null;
  isPublic: boolean;
};

/** Interne Unternehmen und Platzhalter: keine Benutzerkonten oder Einladungen. */
export function Subcontractors() {
  const query = useQuery({ queryKey: ["subcontractors"], queryFn: () => json<{ subcontractors: Subcontractor[] }>("/api/subcontractors") });
  const action = useAction();
  const [edit, setEdit] = useState<Subcontractor | null | undefined>();
  const [editWorker, setEditWorker] = useState<{ subcontractor: Subcontractor; worker: Worker | null } | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [month, setMonth] = useState(() => berlinDate().slice(0, 7));
  const companies = query.data?.subcontractors ?? [];
  const selected = companies.find((company) => company.id === selectedId) ?? companies[0];
  const assignments = useQuery({
    queryKey: ["subcontractor-assignments", selected?.id, month],
    queryFn: () => json<{ assignments: Assignment[]; month: string }>(`/api/subcontractors/${selected!.id}/assignments?month=${month}`),
    enabled: !!selected && /^\d{4}-\d{2}$/.test(month),
  });

  return <div className="space-y-5">
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div className="space-y-1">
        <h1 className="text-[22px] leading-none font-[560] tracking-[-0.03em]">Subunternehmer</h1>
        <p className="text-sm text-muted-foreground">Unternehmen und Platzhalter ohne Zugang verwalten und im Dienstplan einsetzen.</p>
      </div>
      <Button onClick={() => { setEdit(null); setEditWorker(null); }}>Unternehmen anlegen</Button>
    </header>
    <ErrorMessage error={query.error} />
    {edit !== undefined && <Card className="p-4">
      <form key={edit?.id ?? "neu"} className="grid gap-4 sm:grid-cols-2" onSubmit={async (event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        await action.mutateAsync({
          url: edit ? `/api/subcontractors/${edit.id}` : "/api/subcontractors",
          method: edit ? "PATCH" : "POST",
          data: { name: String(data.get("name")).trim(), ...(edit ? { isActive: data.get("isActive") === "on" } : {}) },
          message: edit ? "Unternehmen gespeichert" : "Unternehmen angelegt",
        }).then(() => setEdit(undefined)).catch(() => {});
      }}>
        <label className="space-y-1 text-sm">Unternehmensname<Input name="name" defaultValue={edit?.name} required maxLength={100} /></label>
        {edit && <label className="flex items-center gap-2 text-sm"><input name="isActive" type="checkbox" defaultChecked={edit.isActive} />Aktives Unternehmen</label>}
        <div className="flex flex-wrap gap-2 sm:col-span-2"><Button disabled={action.isPending}>Speichern</Button><Button type="button" variant="outline" onClick={() => setEdit(undefined)}>Abbrechen</Button></div>
      </form>
    </Card>}
    {editWorker && <Card className="p-4">
      <h2 className="mb-3 text-[15px] font-semibold">{editWorker.subcontractor.name} · {editWorker.worker ? "Platzhalter bearbeiten" : "Platzhalter anlegen"}</h2>
      <form key={editWorker.worker?.id ?? editWorker.subcontractor.id} className="grid gap-4 sm:grid-cols-2" onSubmit={async (event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        const { subcontractor, worker } = editWorker;
        await action.mutateAsync({
          url: `/api/subcontractors/${subcontractor.id}/workers${worker ? "/" + worker.id : ""}`,
          method: worker ? "PATCH" : "POST",
          data: { name: String(data.get("name")).trim(), ...(worker ? { isActive: data.get("isActive") === "on" } : {}) },
          message: worker ? "Platzhalter gespeichert" : "Platzhalter angelegt",
        }).then(() => setEditWorker(null)).catch(() => {});
      }}>
        <label className="space-y-1 text-sm">Bezeichnung<Input name="name" defaultValue={editWorker.worker?.name ?? nextWorkerName(editWorker.subcontractor.workers)} required maxLength={100} /></label>
        {editWorker.worker && <label className="flex items-center gap-2 text-sm"><input name="isActive" type="checkbox" defaultChecked={editWorker.worker.isActive} />Aktiver Platzhalter</label>}
        <div className="flex flex-wrap gap-2 sm:col-span-2"><Button disabled={action.isPending}>Speichern</Button><Button type="button" variant="outline" onClick={() => setEditWorker(null)}>Abbrechen</Button></div>
      </form>
    </Card>}
    {query.isLoading && <p className="text-sm text-muted-foreground">Unternehmen werden geladen …</p>}
    {query.isSuccess && !companies.length && <Card className="p-5 text-sm text-muted-foreground">Noch keine Subunternehmer. Lege ein Unternehmen an und darunter beispielsweise MA 1, MA 2 und MA 3.</Card>}
    <div className="grid gap-4 lg:grid-cols-2">
      {companies.map((company) => <Card key={company.id} className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="min-w-0 break-words text-[16px] font-semibold">{company.name}{!company.isActive && <span className="ml-2 text-sm font-normal text-muted-foreground">inaktiv</span>}</h2>
          <Button size="sm" variant="outline" onClick={() => { setEdit(company); setEditWorker(null); }}>Unternehmen bearbeiten</Button>
        </div>
        <ul className="my-3 divide-y">
          {company.workers.map((worker) => <li key={worker.id} className="flex items-center justify-between gap-2 py-2 text-sm">
            <span className="min-w-0 break-words">{worker.name}{!worker.isActive && <span className="ml-2 text-muted-foreground">inaktiv</span>}</span>
            <Button size="sm" variant="ghost" onClick={() => { setEdit(undefined); setEditWorker({ subcontractor: company, worker }); }}>Bearbeiten</Button>
          </li>)}
        </ul>
        {!company.workers.length && <p className="mb-3 text-sm text-muted-foreground">Noch keine Platzhalter angelegt.</p>}
        <Button size="sm" variant="outline" disabled={!company.isActive} onClick={() => { setEdit(undefined); setEditWorker({ subcontractor: company, worker: null }); }}>Platzhalter anlegen</Button>
      </Card>)}
    </div>
    {companies.length > 0 && <section className="space-y-3 border-t pt-5">
      <h2 className="text-[16px] font-semibold">Belegte Schichten</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1 text-sm">Unternehmen<select value={selected?.id ?? ""} onChange={(event) => setSelectedId(event.target.value)} className={selectClass}>{companies.map((company) => <option key={company.id} value={company.id}>{company.name}{!company.isActive ? " (inaktiv)" : ""}</option>)}</select></label>
        <label className="space-y-1 text-sm">Monat<Input type="month" value={month} onChange={(event) => { if (event.target.value) setMonth(event.target.value); }} /></label>
      </div>
      <ErrorMessage error={assignments.error} />
      {assignments.isLoading && <p className="text-sm text-muted-foreground">Einsätze werden geladen …</p>}
      {assignments.isSuccess && <>
        <p className="text-sm text-muted-foreground">{assignments.data.assignments.length} {assignments.data.assignments.length === 1 ? "belegter Platz" : "belegte Plätze"} bei {selected?.name} im gewählten Monat. Entwürfe sind gekennzeichnet.</p>
        {!assignments.data.assignments.length && <p className="text-sm text-muted-foreground">Keine belegten Schichten in diesem Monat.</p>}
        {selected?.workers.map((worker) => {
          const entries = assignments.data.assignments.filter((entry) => entry.contractorWorkerId === worker.id);
          return <Card key={worker.id} className="p-4">
            <h3 className="mb-2 text-sm font-semibold">{worker.name} · {entries.length} {entries.length === 1 ? "Einsatz" : "Einsätze"}</h3>
            {!!entries.length && <ul className="divide-y">{entries.map((entry) => <li key={entry.id} className="flex flex-col gap-1 py-2 text-sm sm:flex-row sm:justify-between">
              <span>{dateLabel(entry.date)} · {entry.shiftFrom}–{entry.shiftTo}{entry.shiftTo <= entry.shiftFrom ? " (+1 Tag)" : ""}</span>
              <span className="text-muted-foreground">{[entry.branchName, entry.title, !entry.isPublic ? "Entwurf" : null].filter(Boolean).join(" · ")}</span>
            </li>)}</ul>}
          </Card>;
        })}
      </>}
    </section>}
    <p className="text-xs text-muted-foreground">Inaktive Unternehmen und Platzhalter stehen für neue Einteilungen nicht zur Auswahl. Bereits belegte Schichten bleiben nachvollziehbar.</p>
  </div>;
}

function nextWorkerName(workers: Worker[]) {
  const used = new Set(workers.map((worker) => worker.name));
  let number = 1;
  while (used.has(`MA ${number}`)) number++;
  return `MA ${number}`;
}
