"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Building2, ChevronRight } from "lucide-react";
import { InfoHint } from "@/components/ui/info-hint";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/ui/status-badge";
import { ErrorMessage, json } from "@/components/workforce/client";
import { monthLinkForOpen } from "./month-grid";

type BranchOption = { id: string; name: string; isActive: boolean; customer: { id: string; name: string } | null };
type BranchStatus = { id: string; shifts: number | null; openSlots: number | null; openDays: string[]; draftWeeks: number | null };
const datum = (d: string) => new Date(d + "T12:00:00Z").toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", timeZone: "UTC" });

/** Zuletzt angesehener Standortplan (nur dieser Browser); Ziel fuer Aufrufe ohne ?standort. */
const STANDORT_SCHLUESSEL = "akro.standort";

function gemerkterStandort(): string | null {
  try {
    return localStorage.getItem(STANDORT_SCHLUESSEL);
  } catch {
    return null;
  }
}

/** Jede Plananzeige merkt sich ihren Standort (Altbestand "ohne" nicht). */
export function useStandortMerken(standort: string | null) {
  useEffect(() => {
    if (!standort || standort === "ohne") return;
    try {
      localStorage.setItem(STANDORT_SCHLUESSEL, standort);
    } catch {
      // Ohne Speicher erscheint beim naechsten Mal die Auswahl.
    }
  }, [standort]);
}

/**
 * Planungsstand fuer die Planung (Entwurfswochen sichtbar); fuer andere keine
 * Statusangabe. Die Statusabfrage zaehlt unwirksame Einteilungen (Abwesenheit,
 * inaktive Person) als offen und liefert Konflikte nicht getrennt - daher
 * "offen oder Konflikt" im Hinweiston, nicht rot.
 */
function PlanStatus({ status }: { status?: BranchStatus }) {
  if (!status || status.draftWeeks === null || status.shifts === null || status.openSlots === null) return null;
  return (
    <span className="flex flex-wrap items-center gap-1.5 sm:justify-end">
      {status.shifts === 0 ? <StatusBadge ton="neutral" klein>keine Schichten</StatusBadge>
        : status.openSlots > 0 ? <StatusBadge ton="hinweis" klein>{status.openSlots} offen oder Konflikt</StatusBadge>
        : <StatusBadge ton="ok" klein>besetzt</StatusBadge>}
      {status.shifts > 0 && (status.draftWeeks > 0 ? <StatusBadge ton="hinweis" klein>{status.draftWeeks === 1 ? "1 Woche Entwurf" : status.draftWeeks + " Wochen Entwurf"}</StatusBadge> : <StatusBadge ton="neutral" klein>veröffentlicht</StatusBadge>)}
    </span>
  );
}

function Lädt() {
  return (
    <div className="akro-panel space-y-3 p-4" aria-busy="true" aria-label="Standorte werden geladen">
      <Skeleton className="h-4 w-40" />
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-10 w-full" />
    </div>
  );
}

/**
 * Auswahl der Standorte, deren Plan die angemeldete Person sehen darf -
 * gruppiert nach Kunde. Ziel ist der Monatsplan oder der Wochenplan;
 * "title" nennt die Planart ueber der Ueberschrift. Mit "automatisch" fuehrt
 * sie ohne Auswahl weiter: bei genau einem Einsatzort dorthin, sonst zum
 * zuletzt angesehenen, wenn er noch freigegeben ist ("Standort wechseln"
 * oeffnet die Auswahl mit ?wahl=1 ohne diese Weiterleitung).
 */
export function BranchPicker({ href, title = "Dienstplan", automatisch = false }: { href: (branchId: string) => string; title?: string; automatisch?: boolean }) {
  const router = useRouter();
  const query = useQuery({
    queryKey: ["branches", "VIEW_SCHEDULE"],
    queryFn: () => json<{ branches: BranchOption[] }>("/api/branches?right=VIEW_SCHEDULE"),
  });
  const status = useQuery({
    queryKey: ["branches", "status"],
    queryFn: () => json<{ horizon: { from: string; to: string }; branches: BranchStatus[] }>("/api/branches/status"),
  });

  const liste = query.data?.branches;
  let ziel: string | null = null;
  if (automatisch && liste?.length) {
    const gemerkt = liste.length === 1 ? liste[0].id : gemerkterStandort();
    ziel = gemerkt && liste.some((b) => b.id === gemerkt) ? gemerkt : null;
  }
  const weitergeleitet = useRef<string | null>(null);
  useEffect(() => {
    if (!ziel || weitergeleitet.current === ziel) return;
    weitergeleitet.current = ziel;
    router.replace(href(ziel));
  }, [ziel, href, router]);

  if (query.error) return <ErrorMessage error={query.error} />;
  if (!liste || ziel) return <Lädt />;
  const branches = liste;
  const statusById = new Map((status.data?.branches ?? []).map((b) => [b.id, b]));
  const planning = (status.data?.branches ?? []).some((b) => b.draftWeeks !== null);
  const groups = new Map<string, { name: string; branches: BranchOption[] }>();
  for (const b of branches) {
    const key = b.customer?.id ?? "";
    if (!groups.has(key)) groups.set(key, { name: b.customer?.name ?? "Ohne Kunde", branches: [] });
    groups.get(key)!.branches.push(b);
  }
  const sorted = [...groups.entries()].sort(([a, x], [b, y]) => (a === "" ? 1 : b === "" ? -1 : x.name.localeCompare(y.name, "de")));

  return (
    <section className="space-y-4">
      <div>
        <p className="akro-label">{title}</p>
        <h1 className="text-[22px] leading-tight font-semibold tracking-[-0.03em]">Standort wählen</h1>
        {planning && status.data && (
          <div className="mt-1 flex items-center gap-1 text-[13px] text-muted-foreground">
            Planungsstand {datum(status.data.horizon.from)}–{datum(status.data.horizon.to)} je Standort.
            <InfoHint thema="Planungsstand">
              <p>„besetzt“ heißt: alle Plätze mit wirksamer Einteilung, ohne erkannte Konflikte wie Abwesenheit oder inaktive Person – keine Aussage zu Arbeitszeitregeln.</p>
              <p>„offen oder Konflikt“ zählt freie Plätze und Einteilungen, die nicht wirken.</p>
              <p>Entwürfe sind für Mitarbeitende unsichtbar, bis die Woche veröffentlicht ist.</p>
            </InfoHint>
          </div>
        )}
      </div>
      {!branches.length ? (
        <div className="akro-panel p-5 text-[14px] text-muted-foreground">
          Noch kein Standortplan freigegeben – bitte an die Administration wenden.
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {sorted.map(([key, group]) => (
            <div key={key || "ohne"} className="akro-panel overflow-hidden">
              <div className="akro-panel-kopf border-b px-4 py-2.5">
                <p className="akro-label">Kunde</p>
                <h2 className="text-[15px] font-semibold tracking-[-0.02em]">{group.name}</h2>
              </div>
              <ul className="divide-y divide-[var(--linie-fein)]">
                {group.branches.map((b) => (
                  <li key={b.id}>
                    <Link href={href(b.id)} className="flex min-h-11 items-center gap-3 px-4 py-3 text-[14px] transition-colors hover:bg-[var(--flaeche-kopf)]">
                      <Building2 className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                      {/* Auf dem Handy stehen die Badges unter dem Namen, damit er lesbar bleibt. */}
                      <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
                        <span className="max-w-full min-w-0 truncate font-medium max-sm:basis-full sm:flex-1">{b.name}</span>
                        {!b.isActive && <StatusBadge ton="neutral" klein>inaktiv</StatusBadge>}
                        <PlanStatus status={statusById.get(b.id)} />
                      </span>
                      <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                    </Link>
                    {(statusById.get(b.id)?.openSlots ?? 0) > 0 && statusById.get(b.id)?.draftWeeks !== null && (
                      <Link href={monthLinkForOpen(b.id, statusById.get(b.id)!.openDays)} className="block px-4 pb-2.5 pl-11 text-[12px] font-medium text-primary hover:underline max-md:flex max-md:min-h-11 max-md:items-center max-md:pb-0">Offene Tage im Monatsplan zeigen</Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
