"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ErrorMessage, json } from "@/components/workforce/client";

type Preview = {
  name: string;
  role: string;
  futureAssignments: number;
  historyKept: { bookings: number; timeRecords: number; checkins: number };
  blockers: string[];
  sharedAccount: boolean;
};

const anzahl = (n: number, einzahl: string, mehrzahl: string) => n + " " + (n === 1 ? einzahl : mehrzahl);

/**
 * Sicherheitsabfrage zum endgültigen Löschen einer Person. Die Vorschau kommt
 * vom Server (gleiche Rechte wie das Löschen): betroffene künftige Einsätze,
 * was als Historie bleibt und was das Löschen gerade blockiert. Gelöscht wird
 * erst nach ausdrücklicher Bestätigung.
 */
export function DeleteEmployeeDialog({ memberId, open, onOpenChange }: { memberId: string; open: boolean; onOpenChange: (value: boolean) => void }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [verstanden, setVerstanden] = useState(false);

  // Beim Öffnen immer frisch laden: Zeiterfassung oder Einsätze können sich geändert haben.
  const { data: preview, error, isLoading } = useQuery<Preview>({
    queryKey: ["employee-deletion", memberId],
    queryFn: () => json<Preview>(`/api/employees/${memberId}/deletion`),
    enabled: open,
    gcTime: 0,
    staleTime: 0,
    refetchOnMount: "always",
  });

  const remove = useMutation({
    mutationFn: () => json<{ deleted: boolean }>(`/api/employees/${memberId}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Mitarbeiter gelöscht");
      onOpenChange(false);
      queryClient.invalidateQueries({ queryKey: ["employees"] });
      router.push("/employees");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function schliessen() {
    if (remove.isPending) return;
    setVerstanden(false);
    onOpenChange(false);
  }

  const blockiert = (preview?.blockers.length ?? 0) > 0;
  const kept = preview ? preview.historyKept.bookings + preview.historyKept.timeRecords + preview.historyKept.checkins : 0;

  return (
    <Dialog open={open} onOpenChange={(value) => { if (!value) schliessen(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Mitarbeiter endgültig löschen?</DialogTitle>
          <DialogDescription>
            {preview ? preview.name : "Die Person"} wird mit Konto und Zugang gelöscht. Das lässt sich nicht rückgängig machen. Zum Pausieren genügt „Deaktivieren“.
          </DialogDescription>
        </DialogHeader>

        {isLoading && <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Auswirkungen werden geprüft…</p>}
        <ErrorMessage error={error as Error | null} />

        {preview && (
          <div className="space-y-3 text-sm">
            <ul className="list-disc space-y-1.5 pl-5">
              <li>
                {preview.futureAssignments > 0
                  ? <><strong>{anzahl(preview.futureAssignments, "künftiger Einsatz wird", "künftige Einsätze werden")}</strong> entfernt; die Schichten bleiben als offene Plätze bestehen.</>
                  : "Es gibt keine künftigen Einsätze."}
              </li>
              <li>Gelöscht werden außerdem Freigaben, Verfügbarkeiten, Abwesenheiten, Anträge und Nachrichten-Eingang.</li>
              <li>
                {kept > 0
                  ? <>Als Nachweis bleiben erhalten, nur mit dem Namen und ohne Konto: {preview.historyKept.bookings} vergangene Einsätze, {preview.historyKept.timeRecords} Zeitbuchungen, {preview.historyKept.checkins} Check-ins.</>
                  : "Es gibt keine Arbeitszeiten, Check-ins oder vergangenen Einsätze, die erhalten bleiben müssten."}
              </li>
              {preview.sharedAccount && <li>Die Person hat auch Zugang zu einer anderen Organisation. Dieses Konto bleibt bestehen; hier endet nur der Zugang.</li>}
            </ul>

            {blockiert && (
              <div role="alert" className="space-y-1 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-destructive">
                <p className="font-medium">Löschen derzeit nicht möglich:</p>
                <ul className="list-disc space-y-1 pl-5">{preview.blockers.map((b) => <li key={b}>{b}</li>)}</ul>
              </div>
            )}

            <label className="flex items-start gap-2">
              <input type="checkbox" className="mt-0.5 size-4 shrink-0 accent-[var(--brand)]" checked={verstanden} disabled={blockiert || remove.isPending} onChange={(e) => setVerstanden(e.target.checked)} />
              <span>Ich habe verstanden, dass {preview.name} endgültig gelöscht wird.</span>
            </label>
          </div>
        )}

        <DialogFooter className="gap-2 sm:justify-end">
          <Button variant="outline" onClick={schliessen} disabled={remove.isPending}>Abbrechen</Button>
          <Button variant="destructive" disabled={!preview || blockiert || !verstanden || remove.isPending} onClick={() => remove.mutate()}>
            {remove.isPending && <Loader2 className="size-4 animate-spin" />}
            Endgültig löschen
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
