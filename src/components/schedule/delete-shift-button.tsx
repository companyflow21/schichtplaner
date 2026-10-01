"use client";

import { useState } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { json, useAction } from "@/components/workforce/client";

type Deletion = { deletable: boolean; reason: string | null; assignments: number; openRequests: number };

const anzahl = (n: number, einzahl: string, mehrzahl: string) => n + " " + (n === 1 ? einzahl : mehrzahl);

/**
 * "Schicht löschen": Der Server entscheidet, ob die Schicht gelöscht werden darf
 * (nur vor Beginn, ohne Check-in und ohne erfasste Zeiten). Zuerst kommt die
 * Vorschau; ist das Löschen gesperrt, steht der Grund da, sonst folgt die
 * Rückfrage mit den Folgen.
 */
export function DeleteShiftButton({ shiftId, onDeleted }: { shiftId: string; onDeleted?: () => void }) {
  const action = useAction();
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<Deletion | null>(null);
  const [open, setOpen] = useState(false);

  async function start() {
    setLoading(true);
    try {
      setPreview(await json<Deletion>("/api/shifts/" + shiftId + "/deletion"));
      setOpen(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Die Prüfung ist fehlgeschlagen.");
    } finally {
      setLoading(false);
    }
  }

  async function remove() {
    try {
      await action.mutateAsync({ url: "/api/shifts/" + shiftId, method: "DELETE", message: "Schicht gelöscht" });
      onDeleted?.();
    } catch {
      // Die Meldung zeigt useAction bereits als Hinweis.
    }
  }

  const folgen = preview
    ? "Die Schicht wird gelöscht. " + anzahl(preview.assignments, "Zuweisung wird", "Zuweisungen werden") + " entfernt"
      + (preview.openRequests ? " und " + anzahl(preview.openRequests, "offener Antrag wird", "offene Anträge werden") + " geschlossen" : "")
      + ". Betroffene Personen werden benachrichtigt, sobald der Plan veröffentlicht ist. Das lässt sich nicht rückgängig machen."
    : "";

  return (
    <>
      <Button type="button" variant="destructive" disabled={loading || action.isPending} onClick={() => { void start(); }}>
        {loading || action.isPending ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
        Schicht löschen
      </Button>
      {preview && !preview.deletable && (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Schicht kann nicht gelöscht werden</DialogTitle>
              <DialogDescription>{preview.reason}</DialogDescription>
            </DialogHeader>
            <DialogFooter className="sm:justify-end">
              <Button variant="outline" onClick={() => setOpen(false)}>Schließen</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
      {preview?.deletable && (
        <ConfirmDialog open={open} onOpenChange={setOpen} title="Schicht löschen?" description={folgen} confirmLabel="Schicht löschen" onConfirm={() => { void remove(); }} />
      )}
    </>
  );
}
