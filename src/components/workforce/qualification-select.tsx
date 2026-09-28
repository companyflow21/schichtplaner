"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { json } from "./client";

type Entry = { id: string; name: string };
const key = (name: string) => name.trim().toLowerCase();

/**
 * Mehrfachauswahl aus dem Qualifikationskatalog der Organisation.
 * - Im Formular (name gesetzt) liefert FormData.getAll(name) die Auswahl.
 * - Gesteuert ueber value/onChange, etwa in der Mitarbeiteranlage.
 * Zuordnungen, deren Schreibweise vom Katalog abweicht, erscheinen unter dem
 * Katalognamen; ohne Bearbeitungsrecht (disabled) nur als Liste.
 */
export function QualifikationAuswahl({
  name,
  defaultValue,
  value,
  onChange,
  disabled,
  idPrefix,
}: {
  name?: string;
  defaultValue?: string[];
  value?: string[];
  onChange?: (value: string[]) => void;
  disabled?: boolean;
  idPrefix: string;
}) {
  const [eigene, setEigene] = useState<string[]>(defaultValue ?? []);
  const selected = value ?? eigene;
  const query = useQuery({
    queryKey: ["qualifications"],
    queryFn: () => json<{ qualifications: Entry[] }>("/api/qualifications"),
    enabled: !disabled,
  });

  if (disabled) {
    return <p className="text-sm text-muted-foreground">{selected.length ? selected.join(", ") : "Keine"}</p>;
  }

  const catalog = query.data?.qualifications ?? [];
  const known = new Set(catalog.map((q) => key(q.name)));
  const options = [...catalog.map((q) => q.name), ...selected.filter((s) => !known.has(key(s)))];
  const chosen = new Set(selected.map(key));

  function toggle(option: string, on: boolean) {
    const rest = selected.filter((s) => key(s) !== key(option));
    const next = on ? [...rest, option] : rest;
    if (value === undefined) setEigene(next);
    onChange?.(next);
  }

  return (
    <div className="space-y-2">
      {name && selected.map((s) => <input key={s} type="hidden" name={name} value={s} />)}
      {query.error ? (
        <p className="text-sm text-destructive">Qualifikationen konnten nicht geladen werden.</p>
      ) : query.isLoading ? (
        <p className="text-sm text-muted-foreground">Qualifikationen werden geladen …</p>
      ) : options.length === 0 ? (
        <p className="text-sm text-muted-foreground">Noch keine Qualifikationen im Katalog. Admins legen sie unter Einstellungen → Qualifikationen an.</p>
      ) : (
        <div className="grid max-h-48 gap-1.5 overflow-y-auto rounded-[var(--radius)] border p-3 sm:grid-cols-2">
          {options.map((option, index) => {
            // Laufende Nummer statt Name: "Sachkunde 34a" und "Sachkunde §34a"
            // ergaeben sonst dieselbe id, und die Beschriftung schaltete das
            // falsche Kaestchen.
            const id = idPrefix + "-" + index;
            return (
              <label key={option} htmlFor={id} className="flex items-center gap-2 text-sm">
                <input
                  id={id}
                  type="checkbox"
                  className="size-4 accent-[var(--primary)]"
                  checked={chosen.has(key(option))}
                  onChange={(e) => toggle(option, e.target.checked)}
                />
                <span className="min-w-0 truncate">{option}</span>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}
