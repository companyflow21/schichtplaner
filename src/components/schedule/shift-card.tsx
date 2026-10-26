"use client";

import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, ArrowLeftRight, Ban, Check, ChevronRight, Clock3, Copy, History, Loader2, Lock, Pencil, Plus, X } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { StatusBadge, type StatusTon } from "@/components/ui/status-badge";
import { cn } from "@/lib/utils";
import { EmployeePicker, initialen } from "./employee-picker";
import { CopyShiftDialog } from "./copy-shift-dialog";
import { WishRequestButton, WishCountBadge } from "./wish-plan";
import type { ShiftData, ScheduleLayout } from "@/types/schedule";
import type { ConflictItem } from "@/types/conflicts";
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
  /** LAYOUT_1 = schlichte Karte, LAYOUT_2 = Kopfzeile in der Farbe des Arbeitsbereichs */
  layout?: ScheduleLayout;
  /** Whether to show shift titles */
  showTitle?: boolean;
  /** Whether to show pause information */
  showPauses?: boolean;
  /** Wish request for this shift by current user (employee view) */
  userWishRequest?: WishRequest | null;
  /** Standort auf der Karte zeigen - im Plan eines Standorts steht er schon im Kopf. */
  zeigeStandort?: boolean;
  /** Nur Planung: Konflikte und Hinweise der Zuweisungen dieser Schicht (GET /api/schedules/conflicts). */
  conflicts?: ConflictItem[];
  /** Element-ID der Karte als Sprungziel (Konfliktpanel). */
  ankerId?: string;
  /** Kurz hervorheben, etwa nach dem Sprung aus dem Konfliktpanel. */
  hervorheben?: boolean;
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

/**
 * Aktionen einer Personenzeile. Desktop mit Maus: erscheinen bei Hover oder
 * Tastaturfokus ueber dem Namensende (unsichtbar, aber fokussierbar).
 * Touch-Geraete und schmale Bildschirme: immer sichtbar, Flaechen 44 px.
 */
const ZEILEN_AKTIONEN =
  "ml-auto flex shrink-0 items-center gap-1 [@media(hover:hover)_and_(min-width:48rem)]:absolute [@media(hover:hover)_and_(min-width:48rem)]:top-0.5 [@media(hover:hover)_and_(min-width:48rem)]:right-0.5 [@media(hover:hover)_and_(min-width:48rem)]:opacity-0 [@media(hover:hover)_and_(min-width:48rem)]:transition-opacity [@media(hover:hover)_and_(min-width:48rem)]:group-hover/zeile:opacity-100 [@media(hover:hover)_and_(min-width:48rem)]:group-focus-within/zeile:opacity-100";
/** Touch: ruhige Icon-Flaechen; Maus: kleine Knoepfe mit deckender Flaeche ueber dem Namen. */
const ZEILEN_KNOPF =
  "text-muted-foreground dark:hover:bg-muted [@media(hover:hover)_and_(min-width:48rem)]:size-7 [@media(hover:hover)_and_(min-width:48rem)]:border [@media(hover:hover)_and_(min-width:48rem)]:bg-card [@media(hover:none)]:size-11";

/** Werkzeugleiste einer Personenzeile: ein Tabstopp, Pfeiltasten wechseln die Aktion. */
function pfeiltasten(event: React.KeyboardEvent<HTMLDivElement>) {
  const knöpfe = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
  const jetzt = knöpfe.indexOf(document.activeElement as HTMLButtonElement);
  const ziel = ({ ArrowRight: jetzt + 1, ArrowLeft: jetzt - 1, Home: 0, End: knöpfe.length - 1 } as Record<string, number>)[event.key];
  if (jetzt < 0 || ziel === undefined) return;
  event.preventDefault();
  const i = (ziel + knöpfe.length) % knöpfe.length;
  knöpfe.forEach((knopf, j) => { knopf.tabIndex = j === i ? 0 : -1; });
  knöpfe[i].focus();
}

const anzahl = (n: number, eins: string, mehr: string) => `${n} ${n === 1 ? eins : mehr}`;

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
  conflicts = [],
  ankerId,
  hervorheben = false,
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

  // Highlight logic: when a filter is active, dim cards that don't contain the user
  const hasHighlightUser = highlightUserId
    ? shift.bookings.some((b) => b.userId === highlightUserId)
    : false;
  const isDimmed = highlightUserId ? !hasHighlightUser : false;
  // Mindestens ein Konflikt: rot; nur Hinweise: wie eine offene Schicht orange.
  const fehler = conflicts.filter((c) => c.severity === "fehler").length;
  const hinweise = conflicts.length - fehler;
  const konflikt = fehler > 0;
  const nurHinweise = !konflikt && hinweise > 0;

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

  // Plaetze: POST erhoeht um eins, DELETE nimmt genau diesen Schritt zurueck
  // (dieselbe Schnittstelle; der Server lehnt ab, wenn der Platz inzwischen besetzt ist).
  const placesMutation = useMutation({
    mutationFn: async (method: "POST" | "DELETE") => {
      const res = await fetch(`/api/shifts/${shift.id}/places`, { method });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || (method === "POST" ? "Fehler beim Hinzufügen" : "Platz konnte nicht entfernt werden"));
      return data;
    },
    onSuccess: (_data, method) => {
      if (method === "POST") {
        toast.success("Platz hinzugefügt", { duration: 8000, action: { label: "Rückgängig", onClick: () => placesMutation.mutate("DELETE") } });
      } else {
        toast.success("Platz wieder entfernt");
      }
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

  const isPending = bookMutation.isPending || unbookMutation.isPending || replaceMutation.isPending || placesMutation.isPending || contractorMutation.isPending;
  const bookedUserIds = shift.bookings.flatMap((b) => (b.userId ? [b.userId] : []));

  // Can the current user book themselves into an empty slot?
  const canSelfBook =
    !canEdit &&
    !!shift.can?.request &&
    currentUserId &&
    !bookedUserIds.includes(currentUserId) &&
    !isFull;

  // Nur fuer die Planung und nur Altbestand: Einteilungen der Planung sind verbindlich.
  const offeneBestätigungen = canEdit ? shift.bookings.filter((b) => b.userId && !b.confirmedAt).length : 0;

  // Ein Belegungsstatus statt Rand, Badge, Satz und Knopf nebeneinander:
  // Konflikt vor offenen Plaetzen vor Hinweis vor voll besetzt.
  const status: { ton: StatusTon; text: string; titel: string } = konflikt
    ? { ton: "fehler", text: "Konflikt", titel: anzahl(fehler, "Konflikt", "Konflikte") + (hinweise ? ", " + anzahl(hinweise, "Hinweis", "Hinweise") : "") + " – Einzelheiten bei den Personen" }
    : emptySlots > 0
      ? { ton: "hinweis", text: `${emptySlots} offen`, titel: anzahl(emptySlots, "Platz", "Plätze") + " offen" + (hinweise ? ", " + anzahl(hinweise, "Hinweis", "Hinweise") : "") }
      : nurHinweise
        ? { ton: "hinweis", text: "Hinweis", titel: anzahl(hinweise, "Hinweis", "Hinweise") + " – Einzelheiten bei den Personen" }
        : { ton: "ok", text: "Voll besetzt", titel: "Alle Plätze besetzt" };

  // Zeile 2: Taetigkeit, Arbeitsbereich und Pause in einer gedaempften Zeile.
  const angaben: { key: string; inhalt: React.ReactNode; text: string }[] = [];
  if (zeigeStandort && shift.branch) angaben.push({ key: "ort", text: shift.branch.name, inhalt: <span className="font-medium text-foreground">{shift.branch.name}</span> });
  if (showTitle && shift.title) angaben.push({ key: "titel", text: shift.title, inhalt: <span className="font-medium text-foreground">{shift.title}</span> });
  if (shift.division) {
    angaben.push({
      key: "bereich",
      text: shift.division.title,
      // Punkt und Bereichsname bleiben zusammen; ein sehr langer Name wird gekuerzt.
      inhalt: (
        <span className="inline-block max-w-full truncate align-bottom">
          <span aria-hidden="true" className="mr-1 inline-block size-2 rounded-full" style={{ backgroundColor: shift.division.color }} />
          {shift.division.title}
        </span>
      ),
    });
  }
  if (showPauses && hasPause) angaben.push({ key: "pause", text: pauseLabel, inhalt: <span className="whitespace-nowrap">{pauseLabel}</span> });

  // LAYOUT_2: getoente Kopfzeile statt eines farbigen Seitenstreifens.
  const tönung = layout === "LAYOUT_2";
  const kopfFarbe = tönung
    ? ({ "--kopf": shift.division ? `color-mix(in oklab, ${shift.division.color} 14%, var(--card))` : "var(--flaeche-kopf)" } as React.CSSProperties)
    : undefined;

  const kopf = (
    <>
      <span className="flex items-center justify-between gap-1">
        <span className="tabular text-[14px] leading-5 font-semibold tracking-tight whitespace-nowrap">
          {shift.shiftFrom}–{shift.shiftTo}
          {shift.endsNextDay && (
            <span className="ml-1 text-xs font-medium text-muted-foreground" title="endet am Folgetag">
              <span aria-hidden="true">+1</span>
              <span className="sr-only">, endet am Folgetag</span>
            </span>
          )}
        </span>
        {canEdit && <Pencil className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />}
      </span>
      {angaben.length > 0 && (
        <span className="mt-0.5 line-clamp-3 text-xs leading-4 text-muted-foreground" title={angaben.map((a) => a.text).join(" · ")}>
          {angaben.map((a, i) => (
            <span key={a.key}>
              {/* Geschuetztes Leerzeichen vor dem Punkt: eine neue Zeile beginnt nie mit "·". */}
              {i > 0 && <span aria-hidden="true">&nbsp;· </span>}
              {a.inhalt}
            </span>
          ))}
        </span>
      )}
    </>
  );
  const kopfKlasse = cn("block w-full px-2 pt-2 pb-1.5 text-left max-md:px-3", tönung && "bg-[var(--kopf)] pb-2");

  function zustand(booking: ShiftData["bookings"][number]) {
    // Andere Personen sehen Bestaetigungen fremder Zuweisungen nicht (der Server liefert sie leer).
    if (!booking.userId || !(canEdit || booking.userId === currentUserId)) return null;
    const text = booking.confirmation === "PLANNER" ? "fest eingeteilt" : booking.confirmedAt ? "bestätigt" : "Bestätigung offen";
    if (!booking.confirmedAt) {
      return (
        <span className="inline-flex shrink-0 text-warn" title={text}>
          <Clock3 className="size-3" aria-hidden="true" />
          <span className="sr-only">{text}</span>
        </span>
      );
    }
    // Fest eingeteilt ist fuer die Planung der Normalfall: kein Haken an jeder Zeile
    // (er kostet in 136-px-Spalten den Namen), nur fuer Screenreader. Die eigene
    // Zuweisung zeigt Mitarbeitenden den Haken.
    if (canEdit) return <span className="sr-only">, {text}</span>;
    return (
      <span className="inline-flex shrink-0 text-ok" title={text}>
        <Check className="size-3" aria-hidden="true" />
        <span className="sr-only">{text}</span>
      </span>
    );
  }

  function renderBooking(booking: ShiftData["bookings"][number]) {
    // Historie geloeschter Personen ist nicht bearbeitbar.
    const canUnbook = canEdit && !ended && !!booking.userId;
    const canUnbookContractor = !!shift.can?.manageContractors && !ended && !!booking.contractorWorkerId;
    const name = formatName(booking.user, nameFormat, { contractor: !!booking.contractorWorkerId });
    const eigene = conflicts.filter((c) => c.bookingId === booking.id);
    const aktionen = canUnbook || canUnbookContractor;
    return (
      <li
        key={booking.id}
        className={cn(
          "group/zeile relative flex min-h-7 flex-wrap items-start gap-x-1.5 rounded-md px-1 py-0.5 max-md:min-h-11 max-md:py-0",
          aktionen && "hover:bg-muted/50",
          highlightUserId && booking.userId === highlightUserId && "bg-primary/10"
        )}
      >
        {/* Mobil: Avatar und Name mittig zur ersten 44-px-Zeile, Konfliktzeilen darunter. */}
        <Avatar size="sm" className="shrink-0 max-md:mt-2.5">
          <AvatarFallback className="bg-secondary text-xs font-medium tracking-tight text-secondary-foreground">{initialen(booking.user.firstName, booking.user.lastName)}</AvatarFallback>
        </Avatar>
        {/* Schmale Tagesspalten auf Touch-Geraeten: die Aktionen rutschen unter den Namen. */}
        <div className="min-w-[4.5rem] flex-1 max-md:py-2.5">
          <p className="flex min-w-0 items-center gap-1">
            <span className="truncate text-[13px] leading-6" title={name}>{name}</span>
            {zustand(booking)}
          </p>
          {/* Konto inaktiv und genehmigte Abwesenheit nennt die Konfliktpruefung genauer. */}
          {booking.unavailable && !eigene.some((c) => c.kind === "inactive" || c.kind === "absence") && <span className="block text-xs leading-4 font-medium text-warn">Nicht verfügbar</span>}
          {eigene.map((c) => (
            <span key={c.kind + (c.other?.shiftId ?? "")} className={cn("mt-0.5 flex items-start gap-1 text-xs leading-4 font-medium", c.severity === "fehler" ? "text-destructive" : "text-warn")} title={c.text}>
              {c.severity === "fehler" ? <Ban className="mt-0.5 size-3 shrink-0" aria-hidden="true" /> : <AlertTriangle className="mt-0.5 size-3 shrink-0" aria-hidden="true" />}
              <span className="line-clamp-2 hyphens-auto">{c.text}</span>
            </span>
          ))}
        </div>
        {aktionen && (
          <div role="toolbar" aria-label={`Aktionen für ${name}`} onKeyDown={pfeiltasten} className={ZEILEN_AKTIONEN}>
            {canUnbook && (
              <EmployeePicker
                mode="replace"
                heading={`${name} ersetzen durch …`}
                bookedUserIds={bookedUserIds}
                shiftId={shift.id}
                onSelect={(replacementUserId, confirm) => booking.userId && replaceMutation.mutate({ userId: booking.userId, replacementUserId, confirm })}
              >
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  disabled={isPending}
                  tabIndex={0}
                  className={ZEILEN_KNOPF}
                  title="Mitarbeiter wechseln"
                  aria-label={`${name} durch andere Person ersetzen`}
                >
                  {replaceMutation.isPending ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <ArrowLeftRight className="size-3.5" aria-hidden="true" />}
                </Button>
              </EmployeePicker>
            )}
            {canUnbook && (
              <ConfirmDialog
                title="Zuweisung aufheben"
                description={`${name} wird aus dieser Schicht entfernt. Der Platz ist danach wieder offen.`}
                details={
                  <ul className="list-disc space-y-1 pl-5">
                    <li>Offene Anträge der Person zu dieser Schicht (Übernahme, Tausch) werden abgelehnt.</li>
                    <li>Die Person wird nur bei veröffentlichtem Plan benachrichtigt, nicht im Entwurf und nicht während der Bearbeitung.</li>
                  </ul>
                }
                confirmLabel="Entfernen"
                onConfirm={() => booking.userId && unbookMutation.mutate(booking.userId)}
                disabled={isPending}
              >
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  disabled={isPending}
                  tabIndex={-1}
                  className={cn(ZEILEN_KNOPF, "hover:text-destructive")}
                  title="Zuweisung aufheben"
                  aria-label={`${name} aus der Schicht entfernen`}
                >
                  {unbookMutation.isPending ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <X className="size-3.5" aria-hidden="true" />}
                </Button>
              </ConfirmDialog>
            )}
            {canUnbookContractor && (
              <ConfirmDialog
                title="Subunternehmer-Zuweisung aufheben"
                description={`${name} wird aus dieser Schicht entfernt. Der Platz ist danach wieder offen.`}
                details={<p>Der Platzhalter hat kein Benutzerkonto; es wird keine Mitteilung versendet.</p>}
                confirmLabel="Entfernen"
                onConfirm={() => booking.contractorWorkerId && contractorMutation.mutate({ method: "DELETE", contractorWorkerId: booking.contractorWorkerId })}
                disabled={isPending}
              >
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  disabled={isPending}
                  tabIndex={0}
                  className={cn(ZEILEN_KNOPF, "hover:text-destructive")}
                  title="Zuweisung aufheben"
                  aria-label={`${name} aus der Schicht entfernen`}
                >
                  <X className="size-3.5" aria-hidden="true" />
                </Button>
              </ConfirmDialog>
            )}
          </div>
        )}
      </li>
    );
  }

  return (
    <article
      id={ankerId}
      tabIndex={ankerId ? -1 : undefined}
      aria-label={`Schicht ${shift.shiftFrom} bis ${shift.shiftTo}${shift.endsNextDay ? " (endet am Folgetag)" : ""}`}
      aria-busy={isPending}
      className={cn(
        "@container scroll-mt-24 overflow-hidden rounded-lg border bg-card transition-[opacity,border-color]",
        konflikt ? "border-destructive/35" : (!isFull || nurHinweise) && "border-warn/40",
        isPending && "pointer-events-none opacity-70",
        isDimmed && "opacity-40",
        (hervorheben || (highlightUserId && hasHighlightUser)) && "border-primary ring-1 ring-primary/20"
      )}
      style={kopfFarbe}
    >
      {/* Zeilen 1-2: Zeit (mit +1 bei Nachtschicht) und Angaben; fuer die Planung der Bearbeiten-Knopf. */}
      {canEdit ? (
        <button
          type="button"
          className={cn(kopfKlasse, "transition-colors hover:bg-muted/40 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary max-md:min-h-11")}
          onClick={() => onEdit(shift)}
          aria-label={`Schicht ${shift.shiftFrom}–${shift.shiftTo} bearbeiten`}
        >
          {kopf}
        </button>
      ) : (
        <div className={kopfKlasse}>{kopf}</div>
      )}

      <div className={cn("space-y-1.5 px-2 pb-2 max-md:px-3", tönung && "pt-1.5")}>
        {/* Zeile 3: genau ein Belegungsstatus, daneben besetzt/benoetigt. */}
        <div className="flex flex-wrap items-center gap-x-1 gap-y-1">
          <StatusBadge ton={status.ton} klein title={status.titel}>{status.text}</StatusBadge>
          {/* "Voll besetzt" sagt bei voller Besetzung schon alles: in schmalen Tagesspalten
              (unter 9,5 rem) entfaellt dort der Bruch, statt eine eigene Zeile zu belegen. */}
          <span
            aria-hidden="true"
            className={cn("tabular text-xs text-muted-foreground", status.ton === "ok" && "hidden @[9.5rem]:inline")}
            title={`${bookedCount} von ${shift.maxEmployees} Plätzen besetzt`}
          >
            {bookedCount}/{shift.maxEmployees}
          </span>
          <span className="sr-only">{bookedCount} von {shift.maxEmployees} Plätzen besetzt</span>
          {offeneBestätigungen > 0 && (
            <span className="tabular inline-flex items-center gap-0.5 text-xs text-warn" title={anzahl(offeneBestätigungen, "Bestätigung", "Bestätigungen") + " offen"}>
              <Clock3 className="size-3" aria-hidden="true" />
              <span aria-hidden="true">{offeneBestätigungen}</span>
              <span className="sr-only">{offeneBestätigungen === 1 ? "1 Bestätigung offen" : offeneBestätigungen + " Bestätigungen offen"}</span>
            </span>
          )}
          {shift.can?.handle && <WishCountBadge shiftId={shift.id} scheduleId={shift.scheduleId} />}
        </div>

        {shift.bookings.length > 0 && (
          <div className="-mx-1">
            <ul>{shift.bookings.slice(0, 4).map(renderBooking)}</ul>
            {shift.bookings.length > 4 && (
              <details className="group/mehr">
                <summary className="flex min-h-7 cursor-pointer items-center gap-0.5 rounded-md px-0.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary max-md:min-h-11 max-md:px-1 [&::-webkit-details-marker]:hidden">
                  <ChevronRight className="size-3 shrink-0 transition-transform group-open/mehr:rotate-90" aria-hidden="true" />
                  Weitere {shift.bookings.length - 4} Personen
                </summary>
                {/* Desktop: lange Listen scrollen in der Karte; mobil scrollt die Seite (keine verschachtelte Rolle). */}
                <ul className="md:max-h-72 md:overflow-y-auto">{shift.bookings.slice(4).map(renderBooking)}</ul>
              </details>
            )}
          </div>
        )}

        {emptySlots > 0 && (
          canEdit ? (
            <EmployeePicker
              bookedUserIds={bookedUserIds}
              onSelect={handleBook}
              onSelectContractor={shift.can?.manageContractors ? (contractorWorkerId, confirm) => contractorMutation.mutate({ method: "POST", contractorWorkerId, confirm }) : undefined}
              shiftId={shift.id}
            >
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-auto min-h-8 w-full justify-start gap-1.5 border-dashed border-warn/50 bg-transparent px-2 py-1 text-left text-xs leading-4 whitespace-normal text-warn shadow-none hover:bg-warn/10 hover:text-warn dark:border-warn/50 dark:bg-transparent dark:hover:bg-warn/10"
              >
                <Plus className="size-3.5" aria-hidden="true" />
                <span className="min-w-0 text-left">Mitarbeiter zuweisen</span>
              </Button>
            </EmployeePicker>
          ) : canSelfBook && !userWishRequest ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => currentUserId && handleBook(currentUserId)}
              className="h-auto min-h-8 w-full justify-start gap-1.5 px-2 py-1 text-left text-xs leading-4 whitespace-normal"
            >
              <Plus className="size-3.5" aria-hidden="true" />
              <span className="min-w-0 text-left">Übernahme anfragen</span>
            </Button>
          ) : null
        )}

        {!canEdit && shift.can?.request && currentUserId && !bookedUserIds.includes(currentUserId) && (
          <div className="flex flex-wrap items-center gap-1.5">
            <WishRequestButton shiftId={shift.id} currentUserId={currentUserId} existingRequest={userWishRequest} />
          </div>
        )}
        {/* Plan in Bearbeitung: statt der ausgeblendeten Antrags- und Wunschknoepfe der Grund (nicht fuer die Planung). */}
        {!canEdit && shift.requestsPaused && (
          <p className="flex items-start gap-1.5 text-[12px] leading-snug text-muted-foreground">
            <Lock className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
            <span>Anträge und Tausch sind bis zur Veröffentlichung dieser Woche gesperrt.</span>
          </p>
        )}
        {ended && canEdit && (
          <p className="flex items-center gap-1 text-xs text-muted-foreground" title="Zuweisungen bleiben als Nachweis erhalten.">
            <History className="size-3 shrink-0" aria-hidden="true" />
            Schicht beendet<span className="sr-only">. Zuweisungen bleiben als Nachweis erhalten.</span>
          </p>
        )}
        {/* Planung: Platz hinzufuegen (mit Rueckgaengig) und Kopieren. */}
        {canEdit && (
          <div className="flex items-center justify-between gap-1 border-t pt-1.5">
            <Button
              type="button"
              variant="ghost"
              size="xs"
              className="-ml-1 text-muted-foreground"
              onClick={() => placesMutation.mutate("POST")}
              title="Kapazität um einen Platz erhöhen"
              aria-label="Platz hinzufügen"
            >
              <Plus aria-hidden="true" />
              Platz
            </Button>
            {shift.branchId && (
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                className="-mr-1 text-muted-foreground"
                onClick={() => setKopieren(true)}
                title="Schicht auf weitere Tage kopieren"
                aria-label="Schicht auf weitere Tage kopieren"
              >
                <Copy aria-hidden="true" />
              </Button>
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
