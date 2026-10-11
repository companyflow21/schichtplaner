"use client";

import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeftRight, Copy, Loader2, Pencil, Plus, X } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { StatusBadge } from "@/components/ui/status-badge";
import { cn } from "@/lib/utils";
import { EmployeePicker } from "./employee-picker";
import { CopyShiftDialog } from "./copy-shift-dialog";
import { WishRequestButton, WishCountBadge } from "./wish-plan";
import type { ShiftData, ScheduleLayout } from "@/types/schedule";
import type { WishRequest } from "./wish-plan";
import { formatName } from "@/lib/names";
import { useNameFormat } from "@/lib/hooks/use-current-member";

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
  const nameFormat = useNameFormat();
  const endsAt = Date.parse(shift.endsAt ?? "");
  const [now, setNow] = useState(() => Date.now());
  const ended = endsAt <= now;
  // Eine offen gelassene Karte verliert die Aktionen auch ohne Neuladen am Schichtende.
  useEffect(() => {
    if (!(endsAt > now)) return;
    const timer = setTimeout(() => setNow(Date.now()), Math.min(endsAt - now + 1, 2_147_483_647));
    return () => clearTimeout(timer);
  }, [endsAt, now]);
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
        throw new Error(data.error || "Fehler beim Hinzufügen");
      }
      return res.json();
    },
    onSuccess: () => {
      toast.success("Platz hinzugefügt");
      queryClient.invalidateQueries({ queryKey: ["schedule"] });
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const contractorMutation = useMutation({
    mutationFn: async ({ method, contractorWorkerId, confirm = false }: { method: "POST" | "DELETE"; contractorWorkerId: string; confirm?: boolean }) => {
      const res = await fetch("/api/contractor-bookings", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shiftId: shift.id, contractorWorkerId, ...(confirm ? { confirm: true } : {}) }),
      });
      const result = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(result.error || "Subunternehmer-Zuweisung konnte nicht gespeichert werden.");
      return result;
    },
    onSuccess: (_result, variables) => {
      toast.success(variables.method === "POST" ? "Subunternehmer zugewiesen" : "Subunternehmer-Zuweisung aufgehoben");
      queryClient.invalidateQueries({ queryKey: ["schedule"] });
      queryClient.invalidateQueries({ queryKey: ["branch-month"] });
      queryClient.invalidateQueries({ queryKey: ["subcontractor-assignments"] });
      queryClient.invalidateQueries({ queryKey: ["employees", "candidates"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  function handleBook(userId: string, confirm = false) {
    bookMutation.mutate({ userId, confirm });
  }

  const isPending = bookMutation.isPending || unbookMutation.isPending || replaceMutation.isPending || addPlaceMutation.isPending || contractorMutation.isPending;
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

  function renderBooking(booking: ShiftData["bookings"][number]) {
    // Historie geloeschter Personen ist nicht bearbeitbar.
    const canUnbook = canEdit && !ended && !!booking.userId;
    const canUnbookContractor = !!shift.can?.manageContractors && !ended && !!booking.contractorWorkerId;
    const name = formatName(booking.user, nameFormat, { contractor: !!booking.contractorWorkerId });
    return (
      <div key={booking.id} className={cn("-mx-1 flex min-h-9 flex-wrap items-center gap-x-1.5 rounded-md px-1", highlightUserId && booking.userId === highlightUserId && "bg-primary/10")}>
        <Avatar size="sm" className="shrink-0">
          <AvatarFallback className="bg-primary/10 text-[10px] text-primary">{getInitials(booking.user.firstName, booking.user.lastName)}</AvatarFallback>
        </Avatar>
        {/* Schmale Tagesspalten: die Aktionen rutschen unter den Namen statt ihn zu quetschen. */}
        <span className="min-w-20 flex-1 text-[12px] leading-4">
          {name}
          {booking.unavailable && <span className="block text-[11px] font-medium text-warn">Nicht verfügbar</span>}
        </span>
        {(canUnbook || canUnbookContractor) && (
          <div className="ml-auto flex shrink-0 items-center">
            {canUnbook && (
              <EmployeePicker
                mode="replace"
                heading={`${name} ersetzen durch …`}
                bookedUserIds={bookedUserIds}
                shiftId={shift.id}
                onSelect={(replacementUserId, confirm) => booking.userId && replaceMutation.mutate({ userId: booking.userId, replacementUserId, confirm })}
              >
                <button
                  type="button"
                  disabled={isPending}
                  className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground max-md:size-11 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary transition-colors hover:bg-muted hover:text-foreground"
                  title="Mitarbeiter wechseln"
                  aria-label={`${name} durch andere Person ersetzen`}
                >
                  {replaceMutation.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <ArrowLeftRight className="size-3.5" />}
                </button>
              </EmployeePicker>
            )}
            {canUnbook && (
              <ConfirmDialog
                title="Zuweisung aufheben"
                description={`${name} wird aus dieser Schicht entfernt. Der Platz ist danach wieder offen.`}
                confirmLabel="Entfernen"
                onConfirm={() => booking.userId && unbookMutation.mutate(booking.userId)}
                disabled={isPending}
              >
                <button
                  type="button"
                  disabled={isPending}
                  className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground max-md:size-11 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary transition-colors hover:bg-destructive/10 hover:text-destructive"
                  title="Zuweisung aufheben"
                  aria-label={`${name} aus der Schicht entfernen`}
                >
                  {unbookMutation.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <X className="size-3.5" />}
                </button>
              </ConfirmDialog>
            )}
            {canUnbookContractor && (
              <ConfirmDialog
                title="Subunternehmer-Zuweisung aufheben"
                description={`${name} wird aus dieser Schicht entfernt. Der Platz ist danach wieder offen.`}
                confirmLabel="Entfernen"
                onConfirm={() => booking.contractorWorkerId && contractorMutation.mutate({ method: "DELETE", contractorWorkerId: booking.contractorWorkerId })}
                disabled={isPending}
              >
                <button
                  type="button"
                  disabled={isPending}
                  className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground max-md:size-11 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary transition-colors hover:bg-destructive/10 hover:text-destructive"
                  title="Zuweisung aufheben"
                  aria-label={`${name} aus der Schicht entfernen`}
                >
                  <X className="size-3.5" />
                </button>
              </ConfirmDialog>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <article
      aria-label={`Schicht ${shift.shiftFrom} bis ${shift.shiftTo}`}
      aria-busy={isPending}
      className={cn(
        "overflow-hidden rounded-lg border bg-card transition-colors",
        !isFull && "border-warn/40",
        canEdit && "hover:border-primary/60",
        isPending && "pointer-events-none opacity-70",
        isDimmed && "opacity-40",
        highlightUserId && hasHighlightUser && "border-primary ring-1 ring-primary/20"
      )}
      style={isLayout1 ? {} : { borderLeftWidth: "3px", borderLeftColor: divisionColor }}
    >
      <button
        type="button"
        className={cn("w-full space-y-1 px-3 pt-3 pb-2 text-left max-md:min-h-11 focus-visible:-outline-offset-2 focus-visible:outline-2 focus-visible:outline-primary", canEdit && "hover:bg-muted/40")}
        onClick={() => canEdit && onEdit(shift)}
        disabled={!canEdit}
        aria-label={canEdit ? `Schicht ${shift.shiftFrom}–${shift.shiftTo} bearbeiten` : undefined}
      >
        <div className="flex items-start justify-between gap-1">
          <span className="tabular whitespace-nowrap text-[14px] leading-5 font-semibold tracking-tight">
            {shift.shiftFrom}–{shift.shiftTo}
          </span>
          {canEdit && <Pencil className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />}
        </div>
        {shift.endsNextDay && <p className="text-[11px] text-muted-foreground">Endet am nächsten Tag</p>}
        {zeigeStandort && shift.branch && <p className="text-[12px] leading-snug font-medium">{shift.branch.name}</p>}
        {showTitle && shift.title && <p className="text-[12px] leading-snug font-semibold">{shift.title}</p>}
        {shift.division && (
          <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span aria-hidden="true" className="size-2 shrink-0 rounded-full" style={{ backgroundColor: divisionColor }} />
            <span>{shift.division.title}</span>
          </p>
        )}
        {showPauses && hasPause && <p className="text-[11px] text-muted-foreground">{pauseLabel}</p>}
      </button>

      <div className="space-y-1 px-3 pb-3">
        {shift.bookings.slice(0, 4).map(renderBooking)}
        {shift.bookings.length > 4 && (
          <details className="rounded-md">
            <summary className="cursor-pointer rounded-md py-2 text-[12px] font-medium text-primary max-md:min-h-11 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary">
              Weitere {shift.bookings.length - 4} Personen
            </summary>
            <div className="max-h-72 space-y-1 overflow-y-auto px-1 pb-1">
              {shift.bookings.slice(4).map(renderBooking)}
            </div>
          </details>
        )}
        {emptySlots > 0 && (
          canEdit ? (
            <EmployeePicker
              bookedUserIds={bookedUserIds}
              onSelect={handleBook}
              onSelectContractor={shift.can?.manageContractors ? (contractorWorkerId, confirm) => contractorMutation.mutate({ method: "POST", contractorWorkerId, confirm }) : undefined}
              shiftId={shift.id}
            >
              <button type="button" className="mt-2 flex min-h-10 w-full items-center max-md:min-h-11 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary gap-1.5 rounded-md border border-dashed border-warn/50 bg-warn/5 px-2 py-2 text-left text-[11px] font-medium text-warn">
                <Plus className="size-3.5 shrink-0" aria-hidden="true" />
                <span>Mitarbeiter zuweisen</span>
              </button>
            </EmployeePicker>
          ) : canSelfBook && !userWishRequest ? (
            <button type="button" onClick={() => currentUserId && handleBook(currentUserId)} className="mt-2 flex min-h-10 w-full items-center max-md:min-h-11 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary gap-1.5 rounded-md border border-dashed border-primary/50 bg-primary/5 px-2 py-2 text-left text-[12px] font-medium text-primary">
              <Plus className="size-3.5 shrink-0" aria-hidden="true" />Übernahme anfragen
            </button>
          ) : null
        )}

        <div className="space-y-1 pt-2">
          <StatusBadge ton={isFull ? "ok" : "hinweis"} klein className="max-w-full rounded-md">
            {isFull ? "Voll besetzt" : `${emptySlots} ${emptySlots === 1 ? "Platz" : "Plätze"} offen`}
          </StatusBadge>
          <p className="tabular text-[11px] text-muted-foreground">{bookedCount} von {shift.maxEmployees} besetzt</p>
          {ended && canEdit && <p className="text-[11px] text-muted-foreground">Schicht beendet · Zuweisungen bleiben erhalten.</p>}
          {canEdit && offeneBestätigungen > 0 && <p className="text-[11px] text-warn">{offeneBestätigungen} {offeneBestätigungen === 1 ? "Bestätigung offen" : "Bestätigungen offen"}</p>}
        </div>

        {(shift.can?.handle || (!canEdit && shift.can?.request && currentUserId && !bookedUserIds.includes(currentUserId))) && (
          <div className="flex flex-wrap items-center gap-1.5 pt-1">
            {shift.can?.handle && <WishCountBadge shiftId={shift.id} scheduleId={shift.scheduleId} />}
            {!canEdit && shift.can?.request && currentUserId && !bookedUserIds.includes(currentUserId) && (
              <WishRequestButton shiftId={shift.id} currentUserId={currentUserId} existingRequest={userWishRequest} />
            )}
          </div>
        )}
        {/* Kapazität und Kopieren fuer die Planung */}
        {canEdit && (
          <div className="mt-1 flex flex-wrap items-center justify-between gap-x-2 border-t pt-2">
            <button type="button" className="flex min-h-8 items-center max-md:min-h-11 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary gap-1.5 text-left text-[11px] text-muted-foreground transition-colors hover:text-primary" onClick={() => addPlaceMutation.mutate()}>
              <Plus className="size-3 shrink-0" aria-hidden="true" />Kapazität erhöhen
            </button>
            {shift.branchId && (
              <button
                type="button"
                className="flex min-h-8 items-center max-md:min-h-11 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary gap-1 text-left text-[11px] text-muted-foreground transition-colors hover:text-primary"
                onClick={() => setKopieren(true)}
                title="Schicht auf weitere Tage kopieren"
                aria-label="Schicht auf weitere Tage kopieren"
              >
                <Copy className="size-3 shrink-0" aria-hidden="true" />
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
    </article>
  );
}
