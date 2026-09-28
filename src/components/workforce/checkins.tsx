"use client";

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { MapPin } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { StatusBadge } from "@/components/ui/status-badge";
import { dateLabel, ErrorMessage, json, useAction } from "./client";

type Failure = "DENIED" | "UNAVAILABLE" | "INACCURATE" | "STALE" | "OUTSIDE" | "NO_COORDINATES";
type Status = "CONFIRMED" | "PENDING" | "APPROVED" | "DECLINED";
type Running = { startedAt: string; pauseStartedAt: string | null; breakSeconds: number; timeFrom: string };
type OwnShift = {
  id: string;
  date: string;
  shiftFrom: string;
  shiftTo: string;
  title: string | null;
  branch: { name: string; gpsCheckinRequired: boolean; hasCoordinates: boolean; checkinRadiusM: number };
  window: { open: boolean; state: "BEFORE" | "OPEN" | "AFTER"; opensAt: string };
  checkin: { status: Status; method: string; time: string; lateMinutes: number; decisionNote: string | null } | null;
};
type TeamRow = {
  id: string;
  status: Status;
  method: string;
  time: string;
  lateMinutes: number;
  distanceM: number | null;
  accuracyM: number | null;
  failureLabel: string | null;
  reason: string | null;
  decisionNote: string | null;
  canDecide: boolean;
  user: { firstName: string; lastName: string };
  branch: { name: string };
  shift: { date: string; shiftFrom: string; shiftTo: string; title: string | null };
};

const gueltig = (s?: Status) => s === "CONFIRMED" || s === "APPROVED";

/** Verspaetung als Text: bis Schichtbeginn puenktlich, danach Minuten nach Beginn. */
function Puenktlichkeit({ minuten }: { minuten: number }) {
  return minuten <= 0 ? <StatusBadge ton="ok" klein>pünktlich</StatusBadge> : <StatusBadge ton="hinweis" klein>{minuten} Min. nach Beginn</StatusBadge>;
}

function laufzeit(r: Running, now: number) {
  const s = Math.max(0, Math.floor(((r.pauseStartedAt ? Date.parse(r.pauseStartedAt) : now) - Date.parse(r.startedAt)) / 1000) - r.breakSeconds);
  return [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60].map((v) => String(v).padStart(2, "0")).join(":");
}

const browserFehler: Record<"DENIED" | "UNAVAILABLE", string> = {
  DENIED: "Du hast den Zugriff auf deinen Standort abgelehnt. Erlaube ihn in den Einstellungen deines Browsers und versuche es erneut, oder beantrage eine manuelle Freigabe.",
  UNAVAILABLE: "Dein Standort konnte nicht ermittelt werden. Prüfe, ob die Ortung eingeschaltet ist, und versuche es erneut, oder beantrage eine manuelle Freigabe.",
};

/**
 * Check-in fuer die laufende oder heutige eigene Schicht. Der Standort wird
 * nur beim Klick einmalig abgefragt; der Server prueft Entfernung,
 * Genauigkeit und Alter der Position und setzt die Zeit. Der Zustand kommt
 * vollstaendig aus der API und uebersteht so ein Neuladen.
 */
export function EigenerCheckin() {
  const q = useQuery({ queryKey: ["checkin"], queryFn: () => json<{ running: Running | null; shifts: OwnShift[] }>("/api/checkin"), refetchInterval: 30000 });
  const client = useQueryClient();
  const action = useAction();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<{ text: string; failure: Failure | null } | null>(null);
  const [grund, setGrund] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const running = q.data?.running ?? null;
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running]);

  const shifts = (q.data?.shifts ?? []).filter((s) => (s.branch.gpsCheckinRequired || s.branch.hasCoordinates) && (s.window.state !== "AFTER" || s.checkin));
  const s = shifts.find((x) => x.window.open) ?? shifts.find((x) => x.window.state === "BEFORE") ?? shifts[0];
  if (q.error) return <ErrorMessage error={q.error} />;
  if (!s) return null;
  const c = s.checkin;

  async function senden(payload: object) {
    try {
      const res = await fetch("/api/checkin", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ shiftId: s.id, ...payload }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setProblem({ text: data.error || "Der Check-in ist fehlgeschlagen.", failure: data.failure ?? null });
        return false;
      }
      setProblem(null);
      setGrund("");
      await client.invalidateQueries();
      return true;
    } catch {
      setProblem({ text: "Keine Verbindung zum Server. Bitte erneut versuchen.", failure: null });
      return false;
    }
  }

  function einchecken() {
    setProblem(null);
    if (!window.isSecureContext) return setProblem({ text: "Die Standortabfrage funktioniert nur über eine sichere Verbindung (HTTPS). Öffne die App über https:// oder beantrage eine manuelle Freigabe.", failure: "UNAVAILABLE" });
    if (!("geolocation" in navigator)) return setProblem({ text: "Dieser Browser kann keinen Standort ermitteln. Beantrage eine manuelle Freigabe.", failure: "UNAVAILABLE" });
    setBusy(true);
    navigator.geolocation.getCurrentPosition(
      async (p) => {
        const ok = await senden({ position: { latitude: p.coords.latitude, longitude: p.coords.longitude, accuracy: p.coords.accuracy, timestamp: p.timestamp } });
        setBusy(false);
        if (ok) toast.success("Eingecheckt");
      },
      (e) => {
        setBusy(false);
        const failure = e.code === e.PERMISSION_DENIED ? "DENIED" : "UNAVAILABLE";
        setProblem({ text: browserFehler[failure], failure });
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  }

  async function beantragen(failure: Failure) {
    setBusy(true);
    const ok = await senden({ manual: { failure, reason: grund.trim() } });
    setBusy(false);
    if (ok) toast.success("Manuelle Freigabe beantragt");
  }

  const kannEinchecken = s.window.open && !gueltig(c?.status) && c?.status !== "PENDING";
  const manuellGrund: Failure | null = !s.branch.hasCoordinates ? "NO_COORDINATES" : problem?.failure ?? null;

  return (
    <section className="akro-panel overflow-hidden" aria-labelledby="checkin-titel">
      <div className="akro-panel-kopf flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2.5">
        <h2 id="checkin-titel" className="text-[14px] font-semibold tracking-[-0.02em]">Check-in</h2>
        {c && (gueltig(c.status) ? <StatusBadge ton="ok" klein>eingecheckt</StatusBadge> : c.status === "PENDING" ? <StatusBadge ton="hinweis" klein>Freigabe beantragt</StatusBadge> : <StatusBadge ton="fehler" klein>abgelehnt</StatusBadge>)}
      </div>
      <div className="space-y-3 p-4">
        <p className="tabular text-[14px]">
          <span className="font-medium">{[s.branch.name, s.title].filter(Boolean).join(" · ")}</span>
          <span className="text-muted-foreground"> · {dateLabel(s.date)} · {s.shiftFrom}–{s.shiftTo}</span>
        </p>

        {c && gueltig(c.status) && (
          <>
            <p className="tabular flex flex-wrap items-center gap-2 text-[14px]">
              {c.status === "APPROVED" ? `Manuell freigegeben · Beginn ${c.time} Uhr (Serverzeit)` : `Eingecheckt um ${c.time} Uhr (Serverzeit)`}
              <Puenktlichkeit minuten={c.lateMinutes} />
            </p>
            {running ? (
              <div className="space-y-2">
                <p className="akro-kennzahl text-[28px] text-primary">{laufzeit(running, now)}</p>
                <p className="text-[13px] text-muted-foreground">{running.pauseStartedAt ? "Pause läuft · Arbeitszeit angehalten" : `Zeiterfassung läuft seit ${running.timeFrom} Uhr`}</p>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" disabled={action.isPending} onClick={() => action.mutate({ url: "/api/time/watch", data: { action: running.pauseStartedAt ? "RESUME" : "PAUSE" }, message: running.pauseStartedAt ? "Arbeit fortgesetzt" : "Pause begonnen" })}>
                    {running.pauseStartedAt ? "Fortsetzen" : "Pause"}
                  </Button>
                  <Button disabled={action.isPending} onClick={() => action.mutate({ url: "/api/time/watch", data: { action: "STOP" }, message: "Ausgecheckt" })}>Auschecken</Button>
                </div>
              </div>
            ) : (
              <p className="text-[13px] text-muted-foreground">Keine laufende Zeiterfassung. Erfasste Zeiten findest du unter Zeiterfassung.</p>
            )}
          </>
        )}

        {c?.status === "PENDING" && (
          <p className="tabular text-[14px] text-muted-foreground">Manuelle Freigabe beantragt um {c.time} Uhr (Serverzeit). Die Zeiterfassung startet mit der Freigabe ab diesem Zeitpunkt.</p>
        )}
        {c?.status === "DECLINED" && (
          <p className="text-[14px] text-muted-foreground">Die manuelle Freigabe wurde abgelehnt{c.decisionNote ? `: ${c.decisionNote}` : "."} Du kannst erneut einchecken.</p>
        )}

        {!c && s.window.state === "BEFORE" && <p className="tabular text-[14px] text-muted-foreground">Der Check-in ist ab {s.window.opensAt} Uhr möglich.</p>}

        {kannEinchecken && (
          <>
            <p className="flex items-start gap-1.5 text-[13px] text-muted-foreground">
              <MapPin className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              Für den Check-in fragt dein Browser einmalig nach deinem Standort. Er wird nur jetzt abgefragt, nicht dauerhaft verfolgt; gespeichert werden nur Entfernung und Genauigkeit.
            </p>
            {s.branch.hasCoordinates ? (
              <Button disabled={busy} onClick={einchecken}>{busy ? "Standort wird ermittelt …" : "Jetzt einchecken"}</Button>
            ) : (
              <p className="text-[14px]">Für diesen Einsatzort ist keine Position hinterlegt. Beantrage bitte eine manuelle Freigabe.</p>
            )}
            {problem && <p role="alert" className="rounded-[var(--radius)] border border-destructive/30 bg-destructive/5 p-3 text-[13px] text-destructive">{problem.text}</p>}
            {manuellGrund && (
              <div className="space-y-2 border-t pt-3">
                <Label htmlFor="checkin-grund">Manuelle Freigabe beantragen</Label>
                <Textarea id="checkin-grund" value={grund} maxLength={500} onChange={(e) => setGrund(e.target.value)} placeholder="Warum klappt der Check-in nicht? (mindestens 10 Zeichen)" />
                <Button variant="outline" disabled={busy || grund.trim().length < 10} onClick={() => beantragen(manuellGrund)}>Manuelle Freigabe beantragen</Button>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}

/**
 * Check-ins fuer Planung und Zeitverantwortliche: offene manuelle Antraege
 * mit Entscheidung und die Check-ins des Tages mit Puenktlichkeit. Ohne
 * Eintraege (oder ohne Recht) entfaellt der Abschnitt.
 */
export function CheckinUebersicht() {
  const q = useQuery({ queryKey: ["checkin", "team"], queryFn: () => json<{ date: string; checkins: TeamRow[] }>("/api/checkin?view=team"), refetchInterval: 30000 });
  const rows = q.data?.checkins ?? [];
  if (!rows.length) return null;
  const offen = rows.filter((r) => r.status === "PENDING"), heute = rows.filter((r) => r.status !== "PENDING");

  return (
    <section className="akro-panel overflow-hidden" aria-labelledby="checkins-titel">
      <div className="akro-panel-kopf flex items-center justify-between gap-3 border-b px-4 py-2.5">
        <h2 id="checkins-titel" className="text-[14px] font-semibold tracking-[-0.02em]">Check-ins heute</h2>
        {offen.length > 0 && <StatusBadge ton="hinweis" klein>{offen.length} zur Freigabe</StatusBadge>}
      </div>
      <ul className="divide-y divide-[var(--linie-fein)]">
        {offen.map((r) => <Antrag key={r.id} row={r} />)}
        {heute.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-3">
            <div className="min-w-0 flex-1 basis-56">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="text-[14px] font-medium">{r.user.firstName} {r.user.lastName}</span>
                <Puenktlichkeit minuten={r.lateMinutes} />
                {r.status === "DECLINED" && <StatusBadge ton="fehler" klein>abgelehnt</StatusBadge>}
                {r.status === "APPROVED" && <StatusBadge ton="neutral" klein>manuell freigegeben</StatusBadge>}
              </div>
              <p className="tabular mt-0.5 text-[13px] text-muted-foreground">
                {r.branch.name} · {dateLabel(r.shift.date)} {r.shift.shiftFrom}–{r.shift.shiftTo} · {r.method === "GPS" ? `GPS ${r.time} Uhr · ${r.distanceM} m entfernt · ± ${r.accuracyM} m` : `Antrag ${r.time} Uhr`}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Antrag({ row }: { row: TeamRow }) {
  const action = useAction();
  const [notiz, setNotiz] = useState("");
  const entscheiden = (status: "APPROVED" | "DECLINED") =>
    action.mutate({ url: "/api/checkin/" + row.id, method: "PATCH", data: { status, note: notiz.trim() || undefined }, message: status === "APPROVED" ? "Check-in freigegeben" : "Check-in abgelehnt" });
  return (
    <li className="space-y-2 px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-[14px] font-medium">{row.user.firstName} {row.user.lastName}</span>
        <StatusBadge ton="hinweis" klein>Freigabe beantragt</StatusBadge>
        <Puenktlichkeit minuten={row.lateMinutes} />
      </div>
      <p className="tabular text-[13px] text-muted-foreground">
        {row.branch.name} · {dateLabel(row.shift.date)} {row.shift.shiftFrom}–{row.shift.shiftTo} · Antrag {row.time} Uhr (Serverzeit){row.failureLabel ? ` · ${row.failureLabel}` : ""}
      </p>
      {row.reason && <p className="text-[14px]">„{row.reason}“</p>}
      {row.canDecide ? (
        <div className="flex flex-wrap items-center gap-2">
          <Input className="min-w-0 flex-1 basis-48" value={notiz} maxLength={500} onChange={(e) => setNotiz(e.target.value)} placeholder="Notiz (optional)" aria-label={`Notiz zum Antrag von ${row.user.firstName} ${row.user.lastName}`} />
          <Button size="sm" disabled={action.isPending} onClick={() => entscheiden("APPROVED")}>Genehmigen</Button>
          <Button size="sm" variant="outline" disabled={action.isPending} onClick={() => entscheiden("DECLINED")}>Ablehnen</Button>
        </div>
      ) : (
        <p className="text-[13px] text-muted-foreground">Die Entscheidung trifft die Zeitverantwortung.</p>
      )}
    </li>
  );
}
