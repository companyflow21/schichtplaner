"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeftRight, Copy, Loader2, Plus, X } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { StatusBadge } from "@/components/ui/status-badge";
import { cn } from "@/lib/utils";
import { EmployeePicker } from "./employee-picker";
import { CopyShiftDialog } from "./copy-shift-dialog";
import { WishRequestButton, WishCountBadge } from "./wish-plan";
import type { ShiftData, ScheduleLayout } from "@/types/schedule";
import type { WishRequest } from "./wish-plan";

interface ShiftCardProps {
  shift: ShiftData;
  onEdit: (shift: ShiftData) => void;
  /** Darf die angemeldete Person diese Schicht bearbeiten und besetzen? (aus shift.can) */
  canEdit: boolean;
  /** Current user's ID - needed for self-booking as employee */
  currentUserId?: string;
  /** If set, highlight shifts containing this user and dim others */
  highlightUserId?: string | null;
  /** Layout variant: LAYOUT_1 = shadow card, LAYOUT_2 = colored left border */
  layout?: ScheduleLayout;
  /** Whether to show shift titles */
  showTitle?: boolean;
  /** Whether to show pause information */
  showPauses?: boolean;
  /** Wish request for this shift by current user (employee view) */
  userWishRequest?: WishRequest | null;
  /** Standort auf der Karte zeigen - im Plan eines Standorts steht er schon im Kopf. */
  zeigeStandort?: boolean;
}

function getInitials(firstName: string, lastName: string): string {
  return `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase();
}

/** Fehler mit bestaetigbaren Hinweisen (409 { confirm: true, warnings }). */
class RequestError extends Error {
  constructor(message: string, public confirm = false, public warnings: string[] = []) { super(message); }
}
async function send(method: string, data: unknown, fallback: string) {
  const res = await fetch("/api/bookings", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
  const result = await res.json().catch(() => ({}));
  if (!res.ok) throw new RequestError(result.error || fallback, result.confirm === true, Array.isArray(result.warnings) ? result.warnings : []);
  return result;
}

export function ShiftCard({
  shift,
  onEdit,
  canEdit,
  currentUserId,
  highlightUserId,
  layout = "LAYOUT_1",
  showTitle = true,
  showPauses = true,
  userWishRequest,
  zeigeStandort = true,
}: ShiftCardProps) {
  const queryClient = useQueryClient();
  const bookedCount = shift.occupiedCount ?? shift.bookings.length;
  const isFull = bookedCount >= shift.maxEmployees;
  const emptySlots = Math.max(0, shift.maxEmployees - bookedCount);
  const divisionColor = shift.division?.color ?? "#94a3b8";

  // Highlight logic: when a filter is active, dim cards that don't contain the user
  const hasHighlightUser = highlightUserId
    ? shift.bookings.some((b) => b.userId === highlightUserId)
    : false;
  const isDimmed = highlightUserId ? !hasHighlightUser : false;

  const hasPause = shift.pauseValue > 0;
  const pauseLabel =
    shift.pauseOption === "PER_HOUR"
      ? `Pause ${shift.pauseValue} Min/Std`
      : `Pause ${shift.pauseValue} Min`;

  // Book mutation
  const bookMutation = useMutation({
    mutationFn: async ({ userId, confirm = false }: { userId: string; confirm?: boolean }) => {
      const res = await fetch(canEdit ? "/api/bookings" : "/api/mod-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shiftId: shift.id, userId, ...(canEdit && confirm ? { confirm: true } : {}) }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Fehler beim Buchen");
      }
      return res.json();
    },
    onSuccess: () => {
      toast.success(canEdit ? "Mitarbeiter zugewiesen" : "Übernahme angefragt");
      queryClient.invalidateQueries({ queryKey: ["schedule"] });
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  // Unbook mutation
  const unbookMutation = useMutation({
    mutationFn: async (userId: string) => {
      const res = await fetch("/api/bookings", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shiftId: shift.id, userId }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Fehler beim Abbuchen");
      }
      return res.json();
    },
    onSuccess: () => {
      toast.success("Mitarbeiter abgebucht");
      queryClient.invalidateQueries({ queryKey: ["schedule"] });
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  // Mitarbeiter wechseln: eine Zuweisung atomar ersetzen (PUT /api/bookings).
  type Replace = { userId: string; replacementUserId: string; confirm?: boolean };
  const [hinweis, setHinweis] = useState<(Replace & { warnings: string[] }) | null>(null);
  const [kopieren, setKopieren] = useState(false);
  const replaceMutation = useMutation({
    mutationFn: (vars: Replace) => send("PUT", { shiftId: shift.id, ...vars, ...(vars.confirm ? { confirm: true } : {}) }, "Wechsel nicht möglich"),
    onSuccess: () => {
      toast.success("Mitarbeiter gewechselt");
      queryClient.invalidateQueries({ queryKey: ["schedule"] });
    },
    onError: (error: Error, vars) => {
      // Hinweis erst beim Speichern erkannt: genau einmal nachfragen.
      if (error instanceof RequestError && error.confirm && !vars.confirm) setHinweis({ ...vars, warnings: error.warnings });
      else toast.error(error.message);
    },
  });

  // Add place mutation
  const addPlaceMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/shifts/${shift.id}/places`, {
        method: "POST",
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Fehler beim Hinzufuegen");
      }
      return res.json();
    },
    onSuccess: () => {
      toast.success("Platz hinzugefuegt");
      queryClient.invalidateQueries({ queryKey: ["schedule"] });
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  function handleBook(userId: string, confirm = false) {
    bookMutation.mutate({ userId, confirm });
  }

  const isPending = bookMutation.isPending || unbookMutation.isPending || replaceMutation.isPending || addPlaceMutation.isPending;
  const bookedUserIds = shift.bookings.flatMap((b) => (b.userId ? [b.userId] : []));

  // Can the current user book themselves into an empty slot?
  const canSelfBook =
    !canEdit &&
    !!shift.can?.request &&
    currentUserId &&
    !bookedUserIds.includes(currentUserId) &&
    !isFull;

  const isLayout1 = layout === "LAYOUT_1";
  // Nur fuer die Planung und nur Altbestand: Einteilungen der Planung sind verbindlich.
  const offeneBestätigungen = canEdit ? shift.bookings.filter((b) => b.userId && !b.confirmedAt).length : 0;

  return (
    <div
      className={cn(
        "group overflow-hidden rounded-[var(--radius)] border bg-card transition-colors",
        // Rangfolge: unbesetzt faellt auf, fehlende Bestätigung bleibt
        // dezent, vollstaendig besetzte Schichten bleiben ruhig.
        !isFull && "border-warn/50",
        isFull && offeneBestätigungen > 0 && "border-dashed",
        canEdit && "hover:border-primary/50",
        isPending && "opacity-70 pointer-events-none",
        isDimmed && "opacity-40",
        highlightUserId && hasHighlightUser && "border-primary"
      )}
      style={
        isLayout1
          ? {}
          : { borderLeftWidth: "3px", borderLeftColor: divisionColor }
      }
    >
      {/* Header - clickable for edit */}
      <button
        type="button"
        className={cn(
          "w-full space-y-1 px-2.5 py-2 text-left",
          canEdit && "cursor-pointer transition-colors hover:bg-[var(--flaeche-kopf)]"
        )}
        onClick={() => canEdit && onEdit(shift)}
        disabled={!canEdit}
      >
        {/* Kopfzeile: Zeit zuerst, dann die Besetzung.
            Besetzte Schichten bleiben ruhig, unbesetzte tragen das Signal -
            im Dienstplan zaehlt die Luecke, nicht die erledigte Zeile. */}
        <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
          <span className="tabular text-[13px] leading-5 font-semibold tracking-[-0.01em] whitespace-nowrap">
            {shift.shiftFrom}
            <span className="text-muted-foreground">–</span>
            {shift.shiftTo}
          </span>
          <StatusBadge
            ton={isFull ? "ok" : "hinweis"}
            klein
            title={`${bookedCount} von ${shift.maxEmployees} ${shift.maxEmployees === 1 ? "Platz" : "Plätzen"} besetzt`}
          >
            {isFull ? "besetzt" : `${emptySlots} offen`}
          </StatusBadge>
        </div>

        {/* Einsatzort und Tätigkeit - Adresse, Treffpunkt und Hinweise
            stehen im Detailbereich, nicht auf jeder Karte. */}
        {zeigeStandort && shift.branch && (
          <div
            className="truncate text-[12.5px] leading-snug font-medium"
            title={shift.branch.name}
          >
            {shift.branch.name}
          </div>
        )}
        {(showTitle && shift.title) || shift.division ? (
          <div className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
            {shift.division && (
              <span
                aria-hidden="true"
                className="size-2 shrink-0 rounded-full"
                style={{ backgroundColor: divisionColor }}
              />
            )}
            <span className="truncate">
              {[showTitle ? shift.title : null, shift.division?.title]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </div>
        ) : null}

        {/* Nur der Hinweis, der eine Handlung ausloest. */}
        {canEdit && isFull && offeneBestätigungen > 0 && (
          <div className="text-[11px] text-muted-foreground">
            {offeneBestätigungen} unbestätigt
          </div>
        )}
        {showPauses && hasPause && (
          <div className="text-[11px] text-muted-foreground">{pauseLabel}</div>
        )}

        {/* Wish plan indicators */}
        <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
          {shift.can?.handle && (
            <WishCountBadge shiftId={shift.id} scheduleId={shift.scheduleId} />
          )}
          {!canEdit && shift.can?.request && currentUserId && !bookedUserIds.includes(currentUserId) && (
            <WishRequestButton
              shiftId={shift.id}
              currentUserId={currentUserId}
              existingRequest={userWishRequest}
            />
          )}
        </div>
      </button>

      {/* Content - employee slots */}
      <div className="space-y-0.5 px-2.5 pb-2">
        {/* Booked employees */}
        {shift.bookings.map((booking) => {
          // Historie geloeschter Personen ist nicht bearbeitbar.
          const canUnbook = canEdit && !!booking.userId;
          return (
            <div
              key={booking.id}
              className={cn(
                "flex items-center gap-2 py-0.5 group/slot rounded-sm px-0.5 -mx-0.5",
                highlightUserId && booking.userId === highlightUserId && "bg-primary/10"
              )}
            >
              <Avatar size="sm">
                <AvatarFallback className="text-[9px]">
                  {getInitials(booking.user.firstName, booking.user.lastName)}
                </AvatarFallback>
              </Avatar>
              <span className="min-w-0 flex-1 truncate text-[12px]">
                {booking.user.firstName} {booking.user.lastName}
                {/* Nur fuer die Planung: zaehlt nicht als wirksame Besetzung. */}
                {booking.unavailable && (
                  <span className="ml-1 text-[11px] font-medium text-warn">· nicht verfügbar</span>
                )}
              </span>
              {canUnbook && (
                <EmployeePicker
                  mode="replace"
                  heading={`${booking.user.firstName} ${booking.user.lastName} ersetzen durch …`}
                  bookedUserIds={bookedUserIds}
                  shiftId={shift.id}
                  onSelect={(replacementUserId, confirm) => booking.userId && replaceMutation.mutate({ userId: booking.userId, replacementUserId, confirm })}
                >
                  <button
                    type="button"
                    className="opacity-0 group-hover/slot:opacity-100 focus-visible:opacity-100 transition-opacity text-muted-foreground hover:text-foreground"
                    title="Mitarbeiter wechseln"
                    aria-label={`${booking.user.firstName} ${booking.user.lastName} durch andere Person ersetzen`}
                  >
                    {replaceMutation.isPending ? (
                      <Loader2 className="size-3 animate-spin" />
                    ) : (
                      <ArrowLeftRight className="size-3" />
                    )}
                  </button>
                </EmployeePicker>
              )}
              {canUnbook && (
                <ConfirmDialog
                  title="Zuweisung aufheben"
                  description={`${booking.user.firstName} ${booking.user.lastName} wird aus dieser Schicht entfernt. Der Platz ist danach wieder offen.`}
                  confirmLabel="Entfernen"
                  onConfirm={() => booking.userId && unbookMutation.mutate(booking.userId)}
                >
                <button
                  type="button"
                  className="opacity-0 group-hover/slot:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
                  title="Abbuchen"
                  aria-label={`${booking.user.firstName} ${booking.user.lastName} aus der Schicht entfernen`}
                >
                  {unbookMutation.isPending ? (
                    <Loader2 className="size-3 animate-spin" />
                  ) : (
                    <X className="size-3" />
                  )}
                </button>
                </ConfirmDialog>
              )}
            </div>
          );
        })}

        {/* Empty slots */}
        {Array.from({ length: emptySlots }).map((_, i) => (
          <div key={`empty-${i}`}>
            {canEdit ? (
              <EmployeePicker
                bookedUserIds={bookedUserIds}
                onSelect={handleBook}
                shiftId={shift.id}
              >
                <button
                  type="button"
                  className="-mx-1 flex w-full cursor-pointer items-center gap-2 rounded-sm px-1 py-0.5 transition-colors hover:bg-muted"
                >
                  <span className="flex size-6 items-center justify-center rounded-full border border-dashed border-border">
                    <Plus className="size-3 text-muted-foreground" />
                  </span>
                  <span className="text-[12px] text-muted-foreground">
                    Mitarbeiter zuweisen
                  </span>
                </button>
              </EmployeePicker>
            ) : canSelfBook && i === 0 ? (
              <button
                type="button"
                className="-mx-1 flex w-full cursor-pointer items-center gap-2 rounded-sm px-1 py-0.5 transition-colors hover:bg-muted"
                onClick={() => currentUserId && handleBook(currentUserId)}
              >
                <span className="flex size-6 items-center justify-center rounded-full border border-dashed border-primary/50">
                  <Plus className="size-3 text-primary" />
                </span>
                <span className="text-[12px] font-medium text-primary">
                  Übernahme anfragen
                </span>
              </button>
            ) : (
              <div className="flex items-center gap-2 py-0.5">
                <span className="flex size-6 items-center justify-center rounded-full border border-dashed border-border">
                  <span className="text-[10px] text-muted-foreground" aria-hidden="true">
                    ?
                  </span>
                </span>
                <span className="text-[12px] text-muted-foreground">Frei</span>
              </div>
            )}
          </div>
        ))}

        {/* + Platz und Kopieren fuer die Planung */}
        {canEdit && (
          <div className="flex items-center justify-between gap-2 pt-1">
            <button
              type="button"
              className="flex items-center gap-1.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
              onClick={() => addPlaceMutation.mutate()}
            >
              <Plus className="size-3" />
              Platz
            </button>
            {shift.branchId && (
              <button
                type="button"
                className="flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
                onClick={() => setKopieren(true)}
                title="Schicht auf weitere Tage kopieren"
                aria-label="Schicht auf weitere Tage kopieren"
              >
                <Copy className="size-3" />
                Kopieren
              </button>
            )}
          </div>
        )}
      </div>

      {canEdit && kopieren && <CopyShiftDialog shift={shift} open={kopieren} onOpenChange={setKopieren} />}

      <ConfirmDialog
        open={hinweis !== null}
        onOpenChange={(value) => {
          if (!value) setHinweis(null);
        }}
        title="Trotz Hinweis wechseln?"
        description={hinweis ? `${hinweis.warnings.join(" ")} Der Wechsel wird trotzdem gespeichert.` : ""}
        confirmLabel="Trotzdem wechseln"
        destructive={false}
        onConfirm={() => {
          if (hinweis) replaceMutation.mutate({ userId: hinweis.userId, replacementUserId: hinweis.replacementUserId, confirm: true });
          setHinweis(null);
        }}
      />
    </div>
  );
}
