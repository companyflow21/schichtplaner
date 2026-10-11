"use client";

import { useQuery } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { formatName } from "@/lib/names";
import { useNameFormat } from "@/lib/hooks/use-current-member";

export type WorkHint = { userId: string; date: string; rule: string; text: string };
type Person = { userId: string | null; firstName: string; lastName: string };

/** Arbeitszeithinweise der Standortwoche; fuer Nicht-Planende antwortet der Server mit 404 (dann nichts). */
export function useWorkTimeHints(weekNumber: number, year: number, standort?: string | null) {
  return useQuery<{ hints: WorkHint[]; allBranches: boolean } | null>({
    // Unter "schedule": Echtzeit-Aktualisierungen des Plans laden die Hinweise mit neu.
    queryKey: ["schedule", "worktime", weekNumber, year, standort],
    queryFn: async () => {
      const res = await fetch(`/api/schedules/worktime?kw=${weekNumber}&year=${year}&standort=${encodeURIComponent(standort!)}`);
      if (res.status === 404) return null;
      if (!res.ok) throw new Error("Arbeitszeithinweise konnten nicht geladen werden.");
      return res.json();
    },
    enabled: !!standort && standort !== "ohne",
  });
}

/** Hinweise je Person mit Ursache und Fundstelle; ohne Hinweise keine Aussage "rechtskonform". */
export function WorkTimeHints({ data, people }: { data: { hints: WorkHint[]; allBranches: boolean }; people: Person[] }) {
  const nameFormat = useNameFormat();
  const byPerson = people.filter(p => p.userId && data.hints.some(h => h.userId === p.userId));
  return (
    <section id="arbeitszeithinweise" className="akro-panel mt-4 p-4 text-[13px]" aria-label="Arbeitszeithinweise">
      <h3 className="flex items-center gap-2 text-[14px] font-semibold">
        <AlertTriangle className="size-4 text-warn" aria-hidden="true" />
        Arbeitszeithinweise {data.hints.length ? `(${data.hints.length})` : ""}
      </h3>
      {byPerson.length === 0 ? (
        <p className="mt-2 text-muted-foreground">Keine Hinweise nach den unten genannten Grundregeln.</p>
      ) : (
        <ul className="mt-2 space-y-3">
          {byPerson.map(p => (
            <li key={p.userId}>
              <p className="font-medium">{formatName(p, nameFormat)}</p>
              <ul className="mt-1 list-disc space-y-1 pl-5">
                {data.hints.filter(h => h.userId === p.userId).map((h, i) => <li key={i}>{h.text}</li>)}
              </ul>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 border-t pt-2 text-[12px] text-muted-foreground">
        Geprüft werden geplante Schichten (Entwurf und veröffentlicht) nach den Grundregeln des Arbeitszeitgesetzes: Tageshöchstzeit (§ 3), Pausen (§ 4), Ruhezeit (§ 5), Sonn- und Feiertagsarbeit (§§ 9–11) sowie die betriebliche Vorgabe aus den Einstellungen.
        {data.allBranches ? "" : " Berücksichtigt sind nur Standorte, deren Plan du einsehen darfst."}{" "}
        Nicht geprüft: Tarifverträge und Betriebsvereinbarungen (§ 7), Ausgleichszeiträume, Nachtarbeitnehmer (§ 6), Ausnahmen und tatsächlich erfasste Zeiten. Keine Hinweise bedeuten deshalb nicht, dass der Plan rechtlich unbedenklich ist. Die Hinweise sperren keine Einteilung.
      </p>
    </section>
  );
}
