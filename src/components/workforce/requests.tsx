"use client";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusBadge, type StatusTon } from "@/components/ui/status-badge";
import { json, useAction, ErrorMessage, dateLabel, selectClass } from "./client";
// Namen, Notizen und Aktionen liefert der Server nur, soweit sie freigegeben sind.
type ShiftInfo = { id: string; date: string; title: string | null; shiftFrom: string; shiftTo: string; branch: { name: string; customer?: { name: string } | null } | null };
type Name = { firstName: string; lastName: string } | null;
type RequestRow = { id: string; kind: string; state: string; userId: string | null; targetUserId: string | null; note: string | null; user: Name; targetUser: Name; shift: ShiftInfo; targetShift: ShiftInfo | null; consentAt: string | null; decision: { at: string; note: string | null } | null; can: { decide: boolean; consent: boolean; volunteer: boolean; withdraw: boolean } };
type Correction = { id: string; status: string; reason: string; before: Record<string, unknown>; proposed: Record<string, unknown>; canDecide: boolean; record: { date: string; user: { firstName: string; lastName: string }; branch: { name: string } | null } };
type Option = { shiftId: string; userId: string; date: string; shiftFrom: string; shiftTo: string; title: string | null; branch: { name: string } | null; user: Name };
const labels: Record<string,string> = { OPEN: "Offen", ACCEPTED: "Genehmigt", DECLINED: "Abgelehnt", PENDING: "Zur Freigabe", APPROVED: "Genehmigt" };
// Offen = Hinweis, genehmigt = erledigt, abgelehnt = reine Angabe.
const tones: Record<string,StatusTon> = { OPEN: "hinweis", PENDING: "hinweis", ACCEPTED: "ok", APPROVED: "ok", DECLINED: "neutral" };
// TAKEOVER: offene Schicht anfragen, SWAP: eigene Schicht abgeben, EXCHANGE: zwei Schichten tauschen.
const kinds: Record<string,string> = { TAKEOVER: "Offene Schicht angefragt", SWAP: "Abgabe", EXCHANGE: "Tausch" };
const fieldLabels: Record<string,string> = { date: "Datum", timeFrom: "Beginn", timeTo: "Ende", durationHours: "Stunden", durationMinutes: "Minuten", breakMinutes: "Pause (Min.)", comment: "Kommentar", categoryId: "Kategorie" };
const person = (n: Name) => n ? `${n.firstName} ${n.lastName}` : "";
const shiftText = (s: ShiftInfo) => `${dateLabel(s.date)} · ${s.shiftFrom}–${s.shiftTo} · ${s.title || "Schicht"}${s.branch ? " · " + s.branch.name : ""}`;

export function Requests({ manager, userId }: { manager: boolean; userId: string }) {
  const requests = useQuery({ queryKey: ["requests"], queryFn: () => json<{ requests: RequestRow[] }>("/api/mod-requests") });
  const corrections = useQuery({ queryKey: ["corrections"], queryFn: () => json<{ corrections: Correction[] }>("/api/time/corrections") });
  const action = useAction();
  const client = useQueryClient();
  const [notes, setNotes] = useState<Record<string,string>>({});
  // Hinweise, die die Planung vor der Genehmigung einmal bestaetigt.
  const [hinweis, setHinweis] = useState<{ id: string; warnings: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  async function decide(r: RequestRow, state: "ACCEPTED" | "DECLINED", confirm = false) {
    setBusy(true);
    try {
      const res = await fetch("/api/mod-requests/" + r.id, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ state, note: notes[r.id]?.trim() || undefined, confirm }) });
      const data = await res.json();
      if (res.status === 409 && data.confirm) { setHinweis({ id: r.id, warnings: data.warnings ?? [] }); return; }
      if (!res.ok) { toast.error(data.error || "Die Anfrage ist fehlgeschlagen."); return; }
      setHinweis(null);
      toast.success(state === "ACCEPTED" ? "Antrag genehmigt" : "Antrag abgelehnt");
      client.invalidateQueries();
    } finally { setBusy(false); }
  }
  const pending = action.isPending || busy;
  return <section id="antraege" className="scroll-mt-20 space-y-3" aria-label={manager ? "Anträge bearbeiten" : "Anträge und Schichttausch"}><h2 className="text-[17px] font-semibold tracking-[-0.02em]">Anträge</h2><ErrorMessage error={requests.error || corrections.error} />
    <div className="grid items-start gap-4 lg:grid-cols-2"><Card className="p-4"><h3 className="text-[14px] font-semibold tracking-[-0.02em]">Übernahmen, Abgaben und Tausch</h3>{requests.isPending ? <p>Lädt …</p> : !requests.data?.requests.length ? <p className="text-sm text-muted-foreground">Keine Anträge vorhanden.</p> : requests.data.requests.map(r => <div key={r.id} className="space-y-2 border-t py-3">
      <p className="flex flex-wrap items-center gap-2 font-medium">{kinds[r.kind] ?? r.kind}<StatusBadge ton={tones[r.state] ?? "neutral"} klein>{labels[r.state]}</StatusBadge></p>
      {r.kind === "EXCHANGE" && r.targetShift ? <div className="tabular space-y-0.5 text-sm">
        <p><span className="text-muted-foreground">{r.user ? person(r.user) + " gibt ab: " : "Abgabe: "}</span>{shiftText(r.shift)}</p>
        <p><span className="text-muted-foreground">{r.targetUser ? person(r.targetUser) + " gibt ab: " : "Dafür: "}</span>{shiftText(r.targetShift)}</p>
      </div> : <p className="tabular text-sm">{r.user ? `${person(r.user)} · ` : ""}{shiftText(r.shift)}</p>}
      {r.note && <p className="text-sm">{r.note}</p>}
      {r.kind === "EXCHANGE" && r.state === "OPEN" && <p className="text-sm text-muted-foreground">{r.consentAt ? "Beide sind einverstanden – wartet auf die Freigabe der Planung." : r.targetUserId === userId ? "Du wurdest um einen Tausch gebeten. Bis zur Genehmigung bleibt alles, wie es ist." : "Wartet auf die Zustimmung der anderen Person."}</p>}
      {r.decision?.note && <p className="text-sm"><span className="text-muted-foreground">Begründung: </span>{r.decision.note}</p>}
      {r.state === "OPEN" && (r.can.decide || r.can.consent) && <Input aria-label="Begründung (optional)" placeholder="Begründung (optional)" maxLength={1000} value={notes[r.id] ?? ""} onChange={e => setNotes({ ...notes, [r.id]: e.target.value })} />}
      {hinweis?.id === r.id && <div role="alert" className="space-y-2 rounded-md border border-[var(--hinweis,currentColor)]/30 p-3 text-sm"><p className="font-medium">Trotz Hinweis genehmigen?</p><ul className="list-disc pl-5">{hinweis.warnings.map(w => <li key={w}>{w}</li>)}</ul><div className="flex flex-wrap gap-2"><Button size="sm" disabled={pending} onClick={() => decide(r, "ACCEPTED", true)}>Trotzdem genehmigen</Button><Button size="sm" variant="outline" disabled={pending} onClick={() => setHinweis(null)}>Abbrechen</Button></div></div>}
      {r.state === "OPEN" && <div className="flex flex-wrap gap-2">
        {r.can.consent && <><Button size="sm" disabled={pending} onClick={() => action.mutate({ url: "/api/mod-requests/" + r.id, method: "PATCH", data: { consent: true, note: notes[r.id]?.trim() || undefined }, message: "Tausch zugestimmt" })}>Zustimmen</Button><Button size="sm" variant="outline" disabled={pending} onClick={() => action.mutate({ url: "/api/mod-requests/" + r.id, method: "PATCH", data: { consent: false, note: notes[r.id]?.trim() || undefined }, message: "Tausch abgelehnt" })}>Ablehnen</Button></>}
        {r.can.decide && <><Button size="sm" disabled={pending || (r.kind === "SWAP" && !r.targetUserId)} onClick={() => decide(r, "ACCEPTED")}>Genehmigen</Button><Button size="sm" variant="outline" disabled={pending} onClick={() => decide(r, "DECLINED")}>Ablehnen</Button></>}
        {r.can.volunteer && <Button size="sm" disabled={pending} onClick={() => action.mutate({ url: "/api/mod-requests/" + r.id, method: "PATCH", data: { volunteer: true }, message: "Übernahme angeboten" })}>Übernahme anbieten</Button>}
        {r.kind === "SWAP" && r.targetUserId === userId && <p className="text-sm">Deine Übernahme wartet auf Freigabe.</p>}
        {r.can.withdraw && <Button size="sm" variant="outline" disabled={pending} onClick={() => action.mutate({ url: "/api/mod-requests/" + r.id, method: "DELETE", message: "Antrag zurückgezogen" })}>Zurückziehen</Button>}
      </div>}
      {r.kind === "SWAP" && !r.targetUserId && r.state === "OPEN" && <p className="text-sm text-muted-foreground">Wartet auf eine passende Übernahme.</p>}
    </div>)}</Card>
    <div className="space-y-4"><TauschAnfragen />
    <Card className="p-4"><h3 className="text-[14px] font-semibold tracking-[-0.02em]">Zeitkorrekturen</h3>{corrections.isPending ? <p>Lädt …</p> : !corrections.data?.corrections.length ? <p className="text-sm text-muted-foreground">Keine Zeitkorrekturen vorhanden.</p> : corrections.data.corrections.map(c => <div key={c.id} className="space-y-2 border-t py-3"><p className="font-medium">{c.record.user.firstName} {c.record.user.lastName} · {dateLabel(c.record.date)}{c.record.branch ? " · " + c.record.branch.name : ""}</p><p className="flex flex-wrap items-center gap-2 text-sm">{c.reason}<StatusBadge ton={tones[c.status] ?? "neutral"} klein>{labels[c.status]}</StatusBadge></p><dl className="text-sm">{Object.entries(c.proposed).map(([key,value]) => <div key={key}><dt className="inline text-muted-foreground">{fieldLabels[key] || key}: </dt><dd className="inline">{String(c.before[key] ?? "–")} → {String(value ?? "–")}</dd></div>)}</dl>{c.canDecide && <div className="flex gap-2"><Button size="sm" disabled={pending} onClick={() => action.mutate({ url: "/api/time/corrections", method: "PATCH", data: { id: c.id, status: "APPROVED" }, message: "Zeitkorrektur bestätigt" })}>Bestätigen</Button><Button size="sm" variant="outline" disabled={pending} onClick={() => action.mutate({ url: "/api/time/corrections", method: "PATCH", data: { id: c.id, status: "DECLINED" }, message: "Zeitkorrektur abgelehnt" })}>Ablehnen</Button></div>}</div>)}</Card></div></div>
  </section>;
}

/**
 * Eigene kuenftige Schicht gegen die Schicht einer anderen Person tauschen.
 * Angeboten werden nur Tausche, fuer die beide geeignet und dem Standort der
 * jeweils anderen Schicht zugeordnet sind; der Server prueft erneut.
 */
function TauschAnfragen() {
  const own = useQuery({ queryKey: ["exchange-own"], queryFn: () => json<{ own: ShiftInfo[] }>("/api/mod-requests/exchange-options") });
  const [shiftId, setShiftId] = useState("");
  const [choice, setChoice] = useState("");
  const [note, setNote] = useState("");
  const options = useQuery({ queryKey: ["exchange-options", shiftId], enabled: !!shiftId, queryFn: () => json<{ options: Option[]; limited: boolean }>("/api/mod-requests/exchange-options?shiftId=" + encodeURIComponent(shiftId)) });
  const action = useAction();
  if (!own.data?.own.length) return null;
  const selected = options.data?.options.find(o => o.shiftId + ":" + o.userId === choice);
  return <Card className="space-y-3 p-4"><h3 className="text-[14px] font-semibold tracking-[-0.02em]">Tausch anfragen</h3>
    <p className="text-sm text-muted-foreground">Deine Schicht gegen die Schicht einer anderen Person. Die andere Person stimmt zu, danach entscheidet die Planung. Bis dahin bleibt die Besetzung unverändert.</p>
    <label className="block space-y-1 text-sm"><span>Deine Schicht</span><select className={selectClass} value={shiftId} onChange={e => { setShiftId(e.target.value); setChoice(""); }}><option value="">Bitte wählen</option>{own.data.own.map(s => <option key={s.id} value={s.id}>{shiftText(s)}</option>)}</select></label>
    {shiftId && (options.isPending ? <p className="text-sm">Lädt …</p> : options.error ? <ErrorMessage error={options.error} /> : !options.data?.options.length ? <p className="text-sm text-muted-foreground">Keine passende Schicht zum Tausch gefunden.</p> : <>
      <label className="block space-y-1 text-sm"><span>Tauschen gegen</span><select className={selectClass} value={choice} onChange={e => setChoice(e.target.value)}><option value="">Bitte wählen</option>{options.data.options.map(o => <option key={o.shiftId + ":" + o.userId} value={o.shiftId + ":" + o.userId}>{shiftText({ id: o.shiftId, date: o.date, shiftFrom: o.shiftFrom, shiftTo: o.shiftTo, title: o.title, branch: o.branch })}{o.user ? " · " + person(o.user) : ""}</option>)}</select></label>
      {options.data.limited && <p className="text-xs text-muted-foreground">Es werden nur die nächsten passenden Schichten angezeigt.</p>}
      <Input aria-label="Nachricht (optional)" placeholder="Nachricht (optional)" maxLength={1000} value={note} onChange={e => setNote(e.target.value)} />
      <Button disabled={!selected || action.isPending} onClick={() => selected && action.mutate({ url: "/api/mod-requests", data: { shiftId, kind: "EXCHANGE", targetShiftId: selected.shiftId, targetUserId: selected.userId, note: note.trim() || undefined }, message: "Tausch angefragt" }, { onSuccess: () => { setChoice(""); setNote(""); } })}>Tausch anfragen</Button>
    </>)}
  </Card>;
}
