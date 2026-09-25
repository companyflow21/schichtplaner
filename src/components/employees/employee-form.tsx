"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Trash2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { LinkFeld, StandortAuswahl, type SiteOption } from "./staff-sites";

type EmployeeRow = {
  firstName: string;
  lastName: string;
  email: string;
  role: "ADMIN" | "MANAGER" | "EMPLOYEE";
  branchIds: string[];
};

type Created = { id: string; user: { firstName: string; lastName: string }; activationUrl: string };

const emptyRow: EmployeeRow = {
  firstName: "",
  lastName: "",
  email: "",
  role: "EMPLOYEE",
  branchIds: [],
};

/**
 * Konten anlegen. Admins wählen jede Rolle und jeden Standort; Manager legen
 * nur Mitarbeitende an und nur für Standorte, an denen sie planen dürfen -
 * der Server prüft beides. Danach zeigt der Dialog die Aktivierungslinks.
 */
export function EmployeeForm({ admin }: { admin: boolean }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<EmployeeRow[]>([{ ...emptyRow }]);
  const [created, setCreated] = useState<Created[] | null>(null);
  const queryClient = useQueryClient();

  // Nur Standorte, an denen die angemeldete Person Schichten bearbeiten darf (Admins: alle).
  const { data: siteData } = useQuery<{ branches: SiteOption[] }>({
    queryKey: ["branches", "EDIT_SHIFTS"],
    queryFn: async () => {
      const res = await fetch("/api/branches?right=EDIT_SHIFTS");
      if (!res.ok) throw new Error("Standorte konnten nicht geladen werden");
      return res.json();
    },
    enabled: open,
  });
  const sites = (siteData?.branches ?? []).filter((b) => b.isActive);

  const createMutation = useMutation({
    mutationFn: async (employees: EmployeeRow[]) => {
      const res = await fetch("/api/employees", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employees: employees.map((e) => ({ ...e, branchIds: e.role === "EMPLOYEE" ? e.branchIds : [] })),
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Fehler beim Anlegen");
      }
      return res.json() as Promise<{ members: Created[] }>;
    },
    onSuccess: (data) => {
      const count = data.members?.length ?? 0;
      toast.success(
        count === 1
          ? "Mitarbeiter wurde angelegt"
          : `${count} Mitarbeiter wurden angelegt`
      );
      queryClient.invalidateQueries({ queryKey: ["employees"] });
      setCreated(data.members);
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  function reset() {
    setRows([{ ...emptyRow }]);
    setCreated(null);
  }

  function updateRow<K extends keyof EmployeeRow>(index: number, field: K, value: EmployeeRow[K]) {
    setRows((prev) =>
      prev.map((row, i) =>
        i === index ? { ...row, [field]: value } : row
      )
    );
  }

  function addRow() {
    setRows((prev) => [...prev, { ...emptyRow }]);
  }

  function removeRow(index: number) {
    if (rows.length === 1) return;
    setRows((prev) => prev.filter((_, i) => i !== index));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const valid = rows.every(
      (r) => r.firstName.trim() && r.lastName.trim() && r.email.trim()
    );
    if (!valid) {
      toast.error("Bitte alle Pflichtfelder ausfuellen");
      return;
    }
    // Standortpflicht, sobald es Standorte zur Auswahl gibt; für Manager immer.
    if ((!admin || sites.length > 0) && rows.some((r) => r.role === "EMPLOYEE" && r.branchIds.length === 0)) {
      toast.error("Bitte für jede Person mindestens einen Standort wählen");
      return;
    }

    createMutation.mutate(rows);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        setOpen(value);
        if (!value) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button>
          <Plus className="size-4" />
          Neue Mitarbeiter anlegen
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        {created ? (
          <>
            <DialogHeader>
              <DialogTitle>Konten angelegt</DialogTitle>
              <DialogDescription>
                Jede Person aktiviert ihr Konto über den eigenen Link und legt dabei ihr Passwort fest. Die Links sind sieben Tage gültig und werden persönlich weitergegeben. Einen neuen Link gibt es später in der Mitarbeiterliste.
              </DialogDescription>
            </DialogHeader>
            <div className="mt-4 max-h-[50vh] space-y-3 overflow-y-auto">
              {created.map((m) => (
                <LinkFeld key={m.id} url={m.activationUrl} label={m.user.firstName + " " + m.user.lastName} />
              ))}
            </div>
            <DialogFooter className="mt-6">
              <Button type="button" onClick={() => { setOpen(false); reset(); }}>
                Fertig
              </Button>
            </DialogFooter>
          </>
        ) : (
          <form onSubmit={handleSubmit}>
            <DialogHeader>
              <DialogTitle>Neue Mitarbeiter anlegen</DialogTitle>
              <DialogDescription>
                {admin
                  ? "Lege einen oder mehrere Mitarbeiter gleichzeitig an und ordne sie ihren Standorten zu."
                  : "Du legst Mitarbeitende für Standorte an, an denen du planst. Sie erscheinen danach in deiner Auswahl beim Besetzen."}
              </DialogDescription>
            </DialogHeader>

            <div className="mt-4 space-y-4 max-h-[55vh] overflow-y-auto">
              {rows.map((row, index) => (
                <div key={index} className="space-y-3 rounded-md border p-3">
                  <div className="grid grid-cols-1 items-end gap-2 sm:grid-cols-[1fr_1fr_1fr_auto_auto]">
                    <div className="space-y-1.5">
                      <Label htmlFor={`vorname-${index}`}>Vorname *</Label>
                      <Input
                        id={`vorname-${index}`}
                        value={row.firstName}
                        onChange={(e) => updateRow(index, "firstName", e.target.value)}
                        placeholder="Max"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor={`nachname-${index}`}>Nachname *</Label>
                      <Input
                        id={`nachname-${index}`}
                        value={row.lastName}
                        onChange={(e) => updateRow(index, "lastName", e.target.value)}
                        placeholder="Mustermann"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor={`email-${index}`}>E-Mail *</Label>
                      <Input
                        id={`email-${index}`}
                        type="email"
                        value={row.email}
                        onChange={(e) => updateRow(index, "email", e.target.value)}
                        placeholder="max@beispiel.de"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Rolle</Label>
                      {admin ? (
                        <Select
                          value={row.role}
                          onValueChange={(v) => updateRow(index, "role", v as EmployeeRow["role"])}
                        >
                          <SelectTrigger className="w-full sm:w-[130px]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="EMPLOYEE">Mitarbeiter</SelectItem>
                            <SelectItem value="MANAGER">Manager</SelectItem>
                            <SelectItem value="ADMIN">Admin</SelectItem>
                          </SelectContent>
                        </Select>
                      ) : (
                        <div className="flex h-10 items-center text-sm text-muted-foreground sm:w-[130px]">Mitarbeiter</div>
                      )}
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => removeRow(index)}
                      disabled={rows.length === 1}
                      className="text-muted-foreground hover:text-destructive"
                      aria-label="Zeile entfernen"
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                  {row.role === "EMPLOYEE" ? (
                    <div className="space-y-1.5">
                      <span className="text-sm font-medium">
                        Standorte{admin && sites.length === 0 ? "" : " *"}
                      </span>
                      {sites.length > 0 ? (
                        <StandortAuswahl
                          sites={sites}
                          value={row.branchIds}
                          onChange={(v) => updateRow(index, "branchIds", v)}
                          idPrefix={`neu-${index}`}
                        />
                      ) : (
                        <p className="text-sm text-muted-foreground">
                          {admin
                            ? "Noch keine aktiven Standorte. Die Zuordnung ist später in der Mitarbeiterliste möglich."
                            : "Du hast keinen Standort, an dem du Schichten bearbeiten darfst."}
                        </p>
                      )}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      {row.role === "MANAGER"
                        ? "Standorte und Rechte erhalten Manager nach dem Anlegen im Profil unter „Freigaben“."
                        : "Admins arbeiten an allen Standorten; eine Zuordnung ist nicht nötig."}
                    </p>
                  )}
                </div>
              ))}
            </div>

            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={addRow}
            >
              <Plus className="size-4" />
              Weiteren hinzufuegen
            </Button>

            <DialogFooter className="mt-6">
              <Button
                type="button"
                variant="outline"
                onClick={() => { setOpen(false); reset(); }}
              >
                Abbrechen
              </Button>
              <Button type="submit" disabled={createMutation.isPending}>
                {createMutation.isPending && (
                  <Loader2 className="size-4 animate-spin" />
                )}
                {rows.length === 1
                  ? "Mitarbeiter anlegen"
                  : `${rows.length} Mitarbeiter anlegen`}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
