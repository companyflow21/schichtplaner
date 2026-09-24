"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Copy, Link2, Loader2, Lock, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { json, ErrorMessage } from "@/components/workforce/client";

export type SiteOption = {
  id: string;
  name: string;
  isActive: boolean;
  customer: { id: string; name: string } | null;
  /** Nur im Dialog: Freigabe mit mehr als der Zuordnung - aendert nur die Administration. */
  locked?: boolean;
};

/** Standorte nach Kunde gruppiert; Standorte ohne Kunde am Ende. */
function nachKunde(sites: SiteOption[]) {
  const groups = new Map<string, { name: string; sites: SiteOption[] }>();
  for (const site of sites) {
    const key = site.customer?.id ?? "";
    const group = groups.get(key) ?? { name: site.customer?.name ?? "Ohne Kunde", sites: [] };
    group.sites.push(site);
    groups.set(key, group);
  }
  return [...groups.entries()].sort(([a, x], [b, y]) => (a === "" ? 1 : b === "" ? -1 : x.name.localeCompare(y.name, "de"))).map(([, g]) => g);
}

/**
 * Auswahl einzelner Standorte, auch über Kunden hinweg. Die Liste enthält
 * nur Standorte, die die angemeldete Person vergeben darf.
 */
export function StandortAuswahl({
  sites,
  value,
  onChange,
  idPrefix,
}: {
  sites: SiteOption[];
  value: string[];
  onChange: (value: string[]) => void;
  idPrefix: string;
}) {
  const selected = new Set(value);
  function toggle(id: string, on: boolean) {
    const next = new Set(selected);
    if (on) next.add(id);
    else next.delete(id);
    onChange([...next]);
  }
  return (
    <div className="max-h-56 space-y-3 overflow-y-auto rounded-[var(--radius)] border p-3">
      {nachKunde(sites).map((group) => (
        <fieldset key={group.name} className="space-y-1.5">
          <legend className="text-[11.5px] font-medium tracking-[0.02em] text-muted-foreground uppercase">{group.name}</legend>
          {group.sites.map((site) => {
            const id = idPrefix + "-" + site.id;
            return (
              <label key={site.id} htmlFor={id} className="flex items-center gap-2 text-sm">
                <Checkbox
                  id={id}
                  checked={selected.has(site.id)}
                  disabled={site.locked}
                  onCheckedChange={(on) => toggle(site.id, on === true)}
                />
                <span className="min-w-0 flex-1 truncate">{site.name}</span>
                {!site.isActive && <span className="text-[11.5px] text-muted-foreground">inaktiv</span>}
                {site.locked && (
                  <span className="inline-flex items-center gap-1 text-[11.5px] text-muted-foreground" title="Diese Freigabe umfasst mehr als die Zuordnung. Ändern kann sie nur die Administration.">
                    <Lock className="size-3" aria-hidden="true" />
                    Administration
                  </span>
                )}
              </label>
            );
          })}
        </fieldset>
      ))}
    </div>
  );
}

/** Link zum Kopieren; nur persönlich weitergeben. */
export function LinkFeld({ url, label }: { url: string; label: string }) {
  return (
    <div className="space-y-1">
      <span className="text-sm">{label}</span>
      <div className="flex gap-2">
        <Input value={url} readOnly onFocus={(e) => e.target.select()} aria-label={"Aktivierungslink " + label} />
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label="Link kopieren"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(url);
              toast.success("Link kopiert");
            } catch {
              toast.error("Kopieren nicht möglich. Bitte den Link markieren und kopieren.");
            }
          }}
        >
          <Copy className="size-4" />
        </Button>
      </div>
    </div>
  );
}

/** Standortzuordnung einer Person ändern - im Bereich der angemeldeten Person. */
export function StandorteDialog({ memberId, name, open, onOpenChange }: { memberId: string; name: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["employee-sites", memberId],
    queryFn: () => json<{ sites: (SiteOption & { assigned: boolean; locked: boolean })[] }>("/api/employees/" + memberId + "/sites"),
    enabled: open,
  });
  const [auswahl, setAuswahl] = useState<string[] | null>(null);
  const [saving, setSaving] = useState(false);
  const sites = query.data?.sites ?? [];
  const value = auswahl ?? sites.filter((s) => s.assigned).map((s) => s.id);

  async function speichern() {
    setSaving(true);
    try {
      await json("/api/employees/" + memberId + "/sites", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ branchIds: value }) });
      toast.success("Standorte gespeichert");
      queryClient.invalidateQueries({ queryKey: ["employees"] });
      queryClient.invalidateQueries({ queryKey: ["employee-sites", memberId] });
      queryClient.invalidateQueries({ queryKey: ["access", memberId] });
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Speichern fehlgeschlagen.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!value) setAuswahl(null);
        onOpenChange(value);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Standorte von {name}</DialogTitle>
          <DialogDescription>
            An diesen Standorten sieht die Person offene Schichten und kann die Übernahme anfragen. Den vollständigen Plan und die Namen anderer sieht sie dadurch nicht.
          </DialogDescription>
        </DialogHeader>
        <ErrorMessage error={query.error} />
        {query.isLoading ? (
          <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Standorte werden geladen
          </div>
        ) : sites.length === 0 ? (
          <p className="text-sm text-muted-foreground">Keine Standorte in deinem Bereich.</p>
        ) : (
          <StandortAuswahl sites={sites} value={value} onChange={setAuswahl} idPrefix={"sites-" + memberId} />
        )}
        <DialogFooter className="gap-2 sm:justify-end">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Abbrechen
          </Button>
          <Button onClick={speichern} disabled={saving || query.isLoading || !!query.error}>
            {saving && <Loader2 className="size-4 animate-spin" />}
            Speichern
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Aktivierungslink neu erzeugen und anzeigen. Der vorige Link wird dabei ungültig. */
export function EinladungDialog({ memberId, name, open, onOpenChange }: { memberId: string; name: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);

  async function erzeugen() {
    setLoading(true);
    try {
      setUrl((await json<{ url: string }>("/api/employees/" + memberId + "/invite", { method: "POST" })).url);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Einladung fehlgeschlagen.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!value) setUrl("");
        onOpenChange(value);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Einladungslink für {name}</DialogTitle>
          <DialogDescription>
            Ein neuer Link ersetzt den bisherigen. Er ist sieben Tage gültig und wird persönlich weitergegeben.
          </DialogDescription>
        </DialogHeader>
        {url ? (
          <LinkFeld url={url} label={name} />
        ) : (
          <Button onClick={erzeugen} disabled={loading} className="w-fit">
            {loading ? <Loader2 className="size-4 animate-spin" /> : <Link2 className="size-4" />}
            Link erstellen
          </Button>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Schließen
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Kurzliste der Standorte in einer Tabellenzeile. */
export function StandortListe({ sites }: { sites: { id: string; name: string }[] | null }) {
  if (sites === null) return <span className="text-muted-foreground">–</span>;
  if (!sites.length) return <span className="text-muted-foreground">Kein Standort</span>;
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <MapPin className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="truncate" title={sites.map((s) => s.name).join(", ")}>
        {sites.map((s) => s.name).join(", ")}
      </span>
    </span>
  );
}
