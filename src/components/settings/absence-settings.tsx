"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// ---------- Types ----------

type AbsenceCategory = {
  id: string;
  name: string;
  color: string;
  isPaid: boolean;
};

// German states by country
const STATES: Record<string, { value: string; label: string }[]> = {
  DE: [
    { value: "BW", label: "Baden-Württemberg" },
    { value: "BY", label: "Bayern" },
    { value: "BE", label: "Berlin" },
    { value: "BB", label: "Brandenburg" },
    { value: "HB", label: "Bremen" },
    { value: "HH", label: "Hamburg" },
    { value: "HE", label: "Hessen" },
    { value: "MV", label: "Mecklenburg-Vorpommern" },
    { value: "NI", label: "Niedersachsen" },
    { value: "NW", label: "Nordrhein-Westfalen" },
    { value: "RP", label: "Rheinland-Pfalz" },
    { value: "SL", label: "Saarland" },
    { value: "SN", label: "Sachsen" },
    { value: "ST", label: "Sachsen-Anhalt" },
    { value: "SH", label: "Schleswig-Holstein" },
    { value: "TH", label: "Thüringen" },
  ],
  AT: [
    { value: "B", label: "Burgenland" },
    { value: "K", label: "Kärnten" },
    { value: "NO", label: "Niederösterreich" },
    { value: "OO", label: "Oberösterreich" },
    { value: "S", label: "Salzburg" },
    { value: "ST", label: "Steiermark" },
    { value: "T", label: "Tirol" },
    { value: "V", label: "Vorarlberg" },
    { value: "W", label: "Wien" },
  ],
  CH: [
    { value: "ZH", label: "Zürich" },
    { value: "BE", label: "Bern" },
    { value: "LU", label: "Luzern" },
    { value: "SG", label: "St. Gallen" },
    { value: "AG", label: "Aargau" },
    { value: "BS", label: "Basel-Stadt" },
    { value: "BL", label: "Basel-Landschaft" },
    { value: "GR", label: "Graubünden" },
    { value: "TI", label: "Tessin" },
    { value: "VS", label: "Wallis" },
  ],
};

const COLORS = [
  "#ef4444",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#06b6d4",
  "#3b82f6",
  "#8b5cf6",
  "#ec4899",
  "#6b7280",
];

// ---------- Component ----------

interface AbsenceSettingsProps {
  categories: AbsenceCategory[];
  holidayCountry: string;
  holidayState: string;
  onUpdateSettings: (data: Record<string, unknown>) => void;
  isSaving: boolean;
}

export function AbsenceSettings({
  categories,
  holidayCountry,
  holidayState,
  onUpdateSettings,
  isSaving,
}: AbsenceSettingsProps) {
  const queryClient = useQueryClient();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editColor, setEditColor] = useState("#ef4444");
  const [editIsPaid, setEditIsPaid] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState("#3b82f6");
  const [newIsPaid, setNewIsPaid] = useState(true);
  const [country, setCountry] = useState(holidayCountry || "DE");
  const [state, setState] = useState(holidayState || "");

  const states = STATES[country] ?? [];

  // Create category
  const createMutation = useMutation({
    mutationFn: async (data: {
      name: string;
      color: string;
      isPaid: boolean;
    }) => {
      const res = await fetch("/api/absences/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || "Fehler beim Erstellen");
      }
      return res.json();
    },
    onSuccess: () => {
      toast.success("Kategorie erstellt");
      queryClient.invalidateQueries({ queryKey: ["settings"] });
      setIsCreating(false);
      setNewName("");
      setNewColor("#3b82f6");
      setNewIsPaid(true);
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });

  // Update category
  const updateMutation = useMutation({
    mutationFn: async (data: {
      id: string;
      name: string;
      color: string;
      isPaid: boolean;
    }) => {
      const res = await fetch("/api/absences/categories", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || "Fehler beim Aktualisieren");
      }
      return res.json();
    },
    onSuccess: () => {
      toast.success("Kategorie aktualisiert");
      queryClient.invalidateQueries({ queryKey: ["settings"] });
      setEditingId(null);
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });

  // Delete category
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/absences/categories?id=${id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || "Fehler beim Löschen");
      }
      return res.json();
    },
    onSuccess: () => {
      toast.success("Kategorie gelöscht");
      queryClient.invalidateQueries({ queryKey: ["settings"] });
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });

  function startEdit(cat: AbsenceCategory) {
    setEditingId(cat.id);
    setEditName(cat.name);
    setEditColor(cat.color);
    setEditIsPaid(cat.isPaid);
  }

  function handleSaveEdit() {
    if (!editingId || !editName.trim()) return;
    updateMutation.mutate({
      id: editingId,
      name: editName.trim(),
      color: editColor,
      isPaid: editIsPaid,
    });
  }

  function handleCreate() {
    if (!newName.trim()) return;
    createMutation.mutate({
      name: newName.trim(),
      color: newColor,
      isPaid: newIsPaid,
    });
  }

  function handleDelete(id: string) {
    if (confirm("Kategorie wirklich löschen?")) {
      deleteMutation.mutate(id);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Abwesenheiten</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Abwesenheitskategorien und Feiertage verwalten
        </p>
      </div>

      {/* Categories */}
      <Card className="p-6 space-y-4">
        <div className="flex items-center justify-between">
          <Label className="text-base font-semibold">
            Abwesenheitskategorien
          </Label>
          {!isCreating && (
            <Button
              size="xs"
              variant="outline"
              onClick={() => setIsCreating(true)}
            >
              <Plus className="size-3" />
              Neu
            </Button>
          )}
        </div>

        {/* Existing categories */}
        <div className="space-y-2">
          {categories.map((cat) =>
            editingId === cat.id ? (
              // Editing mode
              <div
                key={cat.id}
                className="flex items-center gap-3 rounded-lg border p-3"
              >
                <Input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="flex-1 h-8"
                  placeholder="Name"
                />
                <div className="flex items-center gap-2">
                  {COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setEditColor(c)}
                      className={`size-5 rounded-full border-2 transition-all ${
                        editColor === c
                          ? "border-foreground scale-110"
                          : "border-transparent"
                      }`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
                <div className="flex items-center gap-1.5">
                  <Label className="text-xs">Bezahlt</Label>
                  <Switch
                    checked={editIsPaid}
                    onCheckedChange={setEditIsPaid}
                    size="sm"
                  />
                </div>
                <Button
                  size="xs"
                  onClick={handleSaveEdit}
                  disabled={updateMutation.isPending}
                >
                  {updateMutation.isPending ? (
                    <Loader2 className="size-3 animate-spin" />
                  ) : (
                    "Speichern"
                  )}
                </Button>
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() => setEditingId(null)}
                >
                  Abbrechen
                </Button>
              </div>
            ) : (
              // Display mode
              <div
                key={cat.id}
                className="flex items-center gap-3 rounded-lg border p-3 group"
              >
                <div
                  className="size-4 rounded-full shrink-0"
                  style={{ backgroundColor: cat.color }}
                />
                <span className="flex-1 text-sm font-medium">{cat.name}</span>
                <span className="text-xs text-muted-foreground">
                  {cat.isPaid ? "Bezahlt" : "Unbezahlt"}
                </span>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    onClick={() => startEdit(cat)}
                  >
                    <Pencil className="size-3" />
                  </Button>
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    onClick={() => handleDelete(cat.id)}
                    disabled={deleteMutation.isPending}
                  >
                    <Trash2 className="size-3 text-destructive" />
                  </Button>
                </div>
              </div>
            )
          )}

          {categories.length === 0 && !isCreating && (
            <p className="text-sm text-muted-foreground text-center py-4">
              Noch keine Abwesenheitsarten. Lege die Arten an, die Mitarbeitende beantragen können sollen, zum Beispiel Urlaub und Krank. Ob eine Art bezahlt ist, legst du je Art fest. Ohne Arten kann niemand eine Abwesenheit beantragen.
            </p>
          )}
        </div>

        {/* Create new */}
        {isCreating && (
          <div className="flex items-center gap-3 rounded-lg border border-dashed p-3">
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="flex-1 h-8"
              placeholder="Kategoriename"
              autoFocus
            />
            <div className="flex items-center gap-2">
              {COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setNewColor(c)}
                  className={`size-5 rounded-full border-2 transition-all ${
                    newColor === c
                      ? "border-foreground scale-110"
                      : "border-transparent"
                  }`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
            <div className="flex items-center gap-1.5">
              <Label className="text-xs">Bezahlt</Label>
              <Switch
                checked={newIsPaid}
                onCheckedChange={setNewIsPaid}
                size="sm"
              />
            </div>
            <Button
              size="xs"
              onClick={handleCreate}
              disabled={createMutation.isPending || !newName.trim()}
            >
              {createMutation.isPending ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                "Erstellen"
              )}
            </Button>
            <Button
              size="xs"
              variant="ghost"
              onClick={() => setIsCreating(false)}
            >
              Abbrechen
            </Button>
          </div>
        )}
      </Card>

      {/* Holiday location */}
      <Card className="p-6 space-y-4">
        <Label className="text-base font-semibold">Feiertage</Label>
        <p className="text-xs text-muted-foreground -mt-2">
          Land und Bundesland für die automatische Feiertagserkennung
        </p>

        <div className="grid grid-cols-2 gap-4 max-w-md">
          <div className="space-y-2">
            <Label>Land</Label>
            <Select
              value={country}
              onValueChange={(v) => {
                setCountry(v);
                setState("");
                onUpdateSettings({ holidayCountry: v, holidayState: "" });
              }}
              disabled={isSaving}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="DE">Deutschland</SelectItem>
                <SelectItem value="AT">Österreich</SelectItem>
                <SelectItem value="CH">Schweiz</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Bundesland</Label>
            <Select
              value={state}
              onValueChange={(v) => {
                setState(v);
                onUpdateSettings({ holidayState: v });
              }}
              disabled={isSaving || states.length === 0}
            >
              <SelectTrigger>
                <SelectValue placeholder="Wählen..." />
              </SelectTrigger>
              <SelectContent>
                {states.map((s) => (
                  <SelectItem key={s.value} value={s.value}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </Card>
    </div>
  );
}
