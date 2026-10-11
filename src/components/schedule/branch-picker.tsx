"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Building2, ChevronRight } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/ui/status-badge";
import { ErrorMessage, json } from "@/components/workforce/client";
import { monthLinkForOpen } from "./month-grid";

type BranchOption = { id: string; name: string; isActive: boolean; customer: { id: string; name: string } | null };
type BranchStatus = { id: string; shifts: number | null; openSlots: number | null; openDays: string[]; draftWeeks: number | null };
const datum = (d: string) => new Date(d + "T12:00:00Z").toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", timeZone: "UTC" });

/** Planungsstand fuer die Planung (Entwurfswochen sichtbar); fuer andere keine Statusangabe. */
function PlanStatus({ status }: { status?: BranchStatus }) {
  if (!status || status.draftWeeks === null || status.shifts === null || status.openSlots === null) return null;
  return (
    <span className="flex flex-wrap items-center justify-end gap-1.5">
      {status.shifts === 0 ? <StatusBadge ton="neutral" klein>keine Schichten</StatusBadge>
        : status.openSlots > 0 ? <StatusBadge ton="fehler" klein>{status.openSlots} offen / Konflikt</StatusBadge>
        : <StatusBadge ton="ok" klein>besetzt</StatusBadge>}
      {status.shifts > 0 && (status.draftWeeks > 0 ? <StatusBadge ton="hinweis" klein>{status.draftWeeks === 1 ? "1 Woche Entwurf" : status.draftWeeks + " Wochen Entwurf"}</StatusBadge> : <StatusBadge ton="neutral" klein>veröffentlicht</StatusBadge>)}
    </span>
  );
}

/**
 * Auswahl der Standorte, deren Plan die angemeldete Person sehen darf -
 * gruppiert nach Kunde. Ziel ist der Monatsplan oder der Wochenplan;
 * "title" nennt die Planart ueber der Ueberschrift.
 */
export function BranchPicker({ href, title = "Dienstplan" }: { href: (branchId: string) => string; title?: string }) {
  const query = useQuery({
    queryKey: ["branches", "VIEW_SCHEDULE"],
    queryFn: () => json<{ branches: BranchOption[] }>("/api/branches?right=VIEW_SCHEDULE"),
  });
  const status = useQuery({
    queryKey: ["branches", "status"],
    queryFn: () => json<{ horizon: { from: string; to: string }; branches: BranchStatus[] }>("/api/branches/status"),
  });
  if (query.error) return <ErrorMessage error={query.error} />;
  if (!query.data) {
    return (
      <div className="akro-panel space-y-3 p-4" aria-busy="true">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }
  const branches = query.data.branches;
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
          <p className="mt-1 text-[12.5px] text-muted-foreground">
            Planungsstand {datum(status.data.horizon.from)}–{datum(status.data.horizon.to)}: „besetzt“ heißt alle Plätze mit wirksamer Einteilung, ohne erkannte Konflikte wie Abwesenheit oder inaktive Person – keine Aussage zu Arbeitszeitregeln. Entwürfe sind für Mitarbeitende unsichtbar, bis die Woche veröffentlicht ist.
          </p>
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
                    <Link href={href(b.id)} className="flex items-center gap-3 px-4 py-3 text-[14px] transition-colors hover:bg-[var(--flaeche-kopf)]">
                      <Building2 className="size-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate font-medium">{b.name}</span>
                      {!b.isActive && <StatusBadge ton="neutral" klein>inaktiv</StatusBadge>}
                      <PlanStatus status={statusById.get(b.id)} />
                      <ChevronRight className="size-4 text-muted-foreground" />
                    </Link>
                    {(statusById.get(b.id)?.openSlots ?? 0) > 0 && statusById.get(b.id)?.draftWeeks !== null && (
                      <Link href={monthLinkForOpen(b.id, statusById.get(b.id)!.openDays)} className="block px-4 pb-2.5 pl-11 text-[12px] font-medium text-primary hover:underline">Offene Tage im Monatsplan zeigen</Link>
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
