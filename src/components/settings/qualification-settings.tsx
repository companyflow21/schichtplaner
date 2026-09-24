"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Plus } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { json } from "@/components/workforce/client";

/** Qualifikationskatalog: Admins legen Eintraege an; Loeschen ist nicht vorgesehen. */
export function QualificationSettings() {
  const [name, setName] = useState("");
  const client = useQueryClient();
  const query = useQuery({ queryKey: ["qualifications"], queryFn: () => json<{ qualifications: { id: string; name: string }[] }>("/api/qualifications") });
  const create = useMutation({
    mutationFn: (value: string) => json("/api/qualifications", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: value }) }),
    onSuccess: () => { toast.success("Qualifikation angelegt"); setName(""); client.invalidateQueries({ queryKey: ["qualifications"] }); },
    onError: (error: Error) => toast.error(error.message),
  });
  const list = query.data?.qualifications ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Qualifikationen</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Katalog für Mitarbeitende und Schichten. Manager wählen daraus aus; neue Einträge legt die Administration an.
        </p>
      </div>
      <Card className="space-y-4 p-5">
        <form
          className="flex flex-col gap-2 sm:flex-row sm:items-end"
          onSubmit={(e) => { e.preventDefault(); if (name.trim()) create.mutate(name.trim()); }}
        >
          <div className="flex-1 space-y-1.5">
            <Label htmlFor="neue-qualifikation">Neue Qualifikation</Label>
            <Input id="neue-qualifikation" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} placeholder="z. B. Sachkunde §34a" />
          </div>
          <Button type="submit" disabled={create.isPending || !name.trim()}>
            {create.isPending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
            Anlegen
          </Button>
        </form>
        {query.error ? (
          <p className="text-sm text-destructive">Katalog konnte nicht geladen werden.</p>
        ) : list.length === 0 ? (
          <p className="text-sm text-muted-foreground">{query.isLoading ? "Wird geladen …" : "Noch keine Qualifikationen angelegt."}</p>
        ) : (
          <ul className="divide-y rounded-[var(--radius)] border">
            {list.map((q) => <li key={q.id} className="px-3 py-2 text-sm">{q.name}</li>)}
          </ul>
        )}
      </Card>
    </div>
  );
}
