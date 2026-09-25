"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowRight, Building2, ChevronRight, Clock, EyeOff, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/ui/status-badge";
import { cn } from "@/lib/utils";
import { monthLinkForOpen } from "@/components/schedule/month-grid";
import { dateLabel, ErrorMessage, json, useAction } from "./client";
import { Requests } from "./requests";

type Shift = {
  id: string;
  date: string;
  title: string | null;
  shiftFrom: string;
  shiftTo: string;
  occupiedCount: number;
  maxEmployees: number;
  missing: number;
  isPublic: boolean;
  description: string | null;
  branch: {
    name: string;
    address: string | null;
    meetingPoint: string | null;
    notes: string | null;
    customer: { name: string } | null;
  } | null;
  bookings: {
    userId: string;
    confirmedAt: string | null;
    user: { firstName: string; lastName: string };
  }[];
};

type BranchCard = {
  id: string;
  name: string;
  isActive: boolean;
  rights: string[];
  shifts: number | null;
  openSlots: number | null;
  openDays: string[];
  draftWeeks: number | null;
  issuesOpen: number | null;
};

type Reports = {
  employees: {
    userId: string;
    firstName: string;
    lastName: string;
    totalMinutes: number;
    plannedMinutes: number;
    targetMinutes: number | null;
    deviationMinutes: number;
  }[];
};

type Base = { firstName: string; userId: string; today: string; unread: number; own: Shift[]; reports: Reports };
type ManagerData = Base & {
  manager: true;
  overview: {
    horizon: { from: string; to: string; days: number };
    customers: { id: string; name: string; isActive: boolean; branches: BranchCard[] }[];
    unassigned: BranchCard[];
    legacyShifts: number | null;
  };
  todayShifts: Shift[];
  // null: fuer diesen Bereich besteht kein Recht - der Zaehler entfaellt.
  counts: { openSlots: number | null; unconfirmed: number | null; pendingRequests: number | null; pendingAbsences: number | null; pendingCorrections: number | null; openIssues: number | null };
};
type EmployeeData = Base & { manager: false; open: Shift[]; plans: { id: string; name: string; customer: { name: string } | null }[] };
type Dashboard = ManagerData | EmployeeData;

/** Einheitliche Abschnittsueberschrift: kurz, ohne Farbe. */
const abschnittTitel = "text-[17px] font-semibold tracking-[-0.02em]";
const textLink = "font-medium text-primary underline-offset-4 hover:underline";

function stunden(minuten: number) {
  return (minuten / 60).toLocaleString("de-DE", { maximumFractionDigits: 1 }) + " h";
}

function anzahl(zahl: number, eins: string, mehr: string) {
  return `${zahl} ${zahl === 1 ? eins : mehr}`;
}

export function Dashboard() {
  const query = useQuery({ queryKey: ["dashboard"], queryFn: () => json<Dashboard>("/api/dashboard"), refetchInterval: 30000 });
  const action = useAction();
  const data = query.data;

  if (query.error) {
    return (
      <div className="space-y-3">
        <ErrorMessage error={query.error} />
        <Button variant="outline" onClick={() => query.refetch()}>Erneut versuchen</Button>
      </div>
    );
  }
  if (!data) return <DashboardSkeleton />;

  const eigeneMonatszeile = data.reports.employees.find((e) => e.userId === data.userId);
  const nächste = data.manager ? undefined : data.own[0];
  const offeneBestätigung = !!nächste && !nächste.bookings.find((b) => b.userId === data.userId)?.confirmedAt;

  return (
    <div className="space-y-8">
      {/* Kopf: Begruessung und die eine Hauptaktion. Datum und Uhrzeit
          stehen ab Tablet bereits in der Kopfschiene. */}
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="akro-label md:hidden">{dateLabel(data.today)}</p>
          <h1 className="text-[24px] leading-tight font-semibold tracking-[-0.03em]">Guten Tag, {data.firstName}</h1>
        </div>
        {/* Wartet eine Bestaetigung, ist sie die Hauptaktion - dann tritt der Plan zurueck. */}
        <Button asChild variant={offeneBestätigung ? "outline" : "default"}>
          <Link href={data.manager ? "/schedule/month" : "/schedule/employee"}>
            {data.manager ? "Dienstplan öffnen" : "Mein Dienstplan"}
            <ArrowRight className="size-4" />
          </Link>
        </Button>
      </header>

      {data.manager ? <ManagerStart data={data} /> : <MitarbeiterStart data={data} action={action} />}

      <Requests manager={data.manager} userId={data.userId} />

      {/* Nur eine kurze Zusammenfassung; die Auswertung hat eine eigene Seite. */}
      <section className="akro-panel flex flex-wrap items-center justify-between gap-3 p-4" aria-labelledby="stunden-titel">
        <div className="min-w-0">
          <h2 id="stunden-titel" className="text-[15px] font-semibold tracking-[-0.02em]">{data.manager ? "Stunden im Monat" : "Deine Monatsstunden"}</h2>
          <p className="tabular mt-0.5 text-[13px] text-muted-foreground">
            {data.manager
              ? anzahl(data.reports.employees.length, "Person", "Personen") + " in deiner Auswertung"
              : eigeneMonatszeile
                ? `${stunden(eigeneMonatszeile.totalMinutes)} erfasst${eigeneMonatszeile.targetMinutes !== null ? ` · Soll ${stunden(eigeneMonatszeile.targetMinutes)}` : ""} · Abweichung zum Plan ${stunden(eigeneMonatszeile.deviationMinutes)}`
                : "Noch keine Zeiten erfasst"}
          </p>
        </div>
        <Button asChild variant="outline" size="sm"><Link href="/reporting">Zur Auswertung</Link></Button>
      </section>
    </div>
  );
}

/** Disposition: erst was zu tun ist, dann Kunden und Standorte, dann der heutige Plan. */
function ManagerStart({ data }: { data: ManagerData }) {
  const { overview, counts } = data;
  const cards = [...overview.customers.flatMap((c) => c.branches), ...overview.unassigned];
  const leer = !overview.customers.length && !overview.unassigned.length;
  const admin = overview.legacyShifts !== null;
  const anträge = counts.pendingRequests === null && counts.pendingCorrections === null ? null : (counts.pendingRequests ?? 0) + (counts.pendingCorrections ?? 0);

  return (
    <>
      <OffeneAufgaben
        eintraege={[
          { zahl: counts.openSlots, label: "offene Plätze", zusatz: `nächste ${overview.horizon.days} Tage`, href: "#kunden", dringend: true },
          { zahl: counts.unconfirmed, label: "Bestätigungen offen", href: "/schedule/month" },
          { zahl: anträge, label: "Anträge offen", href: "#antraege" },
          { zahl: counts.pendingAbsences, label: "Abwesenheiten zur Freigabe", href: "/employees/absences" },
          { zahl: counts.openIssues, label: "Standortmeldungen offen", href: "#kunden" },
          { zahl: data.unread, label: "neue Nachrichten", href: "/portal/inbox" },
        ]}
      />

      <section id="kunden" className="scroll-mt-20 space-y-3" aria-labelledby="kunden-titel">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="kunden-titel" className={abschnittTitel}>Kunden und Standorte</h2>
          <span className="tabular text-[12.5px] text-muted-foreground">
            {dateLabel(overview.horizon.from)} – {dateLabel(overview.horizon.to)}
          </span>
        </div>

        {overview.legacyShifts ? (
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-[var(--radius)] border border-warn/40 bg-warn/[0.06] px-3 py-2 text-[13px]">
            <AlertTriangle className="size-3.5 shrink-0 text-warn" aria-hidden="true" />
            {anzahl(overview.legacyShifts, "Schicht", "Schichten")} ohne Standort
            <Link href="/schedule/flexible?standort=ohne" className={textLink}>Zuordnen</Link>
          </p>
        ) : null}

        {leer ? (
          <div className="akro-panel p-5 text-[14px] text-muted-foreground">
            {admin ? (
              <>Noch keine Kunden. <Link href="/divisions" className={textLink}>Einsatzorte öffnen</Link></>
            ) : (
              "Dir ist noch kein Standort freigegeben."
            )}
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {overview.customers.map((c) => (
              <KundenKarte key={c.id} name={c.name} inaktiv={!c.isActive} branches={c.branches} admin={admin} />
            ))}
            {overview.unassigned.length > 0 && (
              <KundenKarte name="Ohne Kunde" ohneKunde branches={overview.unassigned} admin={admin} />
            )}
          </div>
        )}
        {cards.length > 0 && cards.every((b) => b.openSlots === null) && (
          <p className="text-[13px] text-muted-foreground">Besetzung ausgeblendet: „Dienstplan ansehen“ ist nicht freigegeben.</p>
        )}
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Abschnitt
          titel="Heute im Dienstplan"
          leer="Heute keine Schichten an deinen Standorten."
          eintraege={data.todayShifts}
          render={(s) => {
            const unbestätigt = s.bookings.filter((b) => !b.confirmedAt).length;
            return (
              <SchichtZeile
                key={s.id}
                shift={s}
                namen={s.bookings.map((b) => `${b.user.firstName} ${b.user.lastName}`).join(", ")}
                status={
                  s.missing > 0 ? (
                    <StatusBadge ton="hinweis" klein>{s.missing} offen</StatusBadge>
                  ) : !s.isPublic ? (
                    <EntwurfBadge />
                  ) : unbestätigt > 0 ? (
                    <StatusBadge ton="neutral" klein>{unbestätigt} unbestätigt</StatusBadge>
                  ) : (
                    <StatusBadge ton="ok" klein>besetzt</StatusBadge>
                  )
                }
              />
            );
          }}
        />
        {data.own.length > 0 && (
          <Abschnitt titel="Deine nächsten Schichten" leer="" eintraege={data.own.slice(0, 8)} render={(s) => <SchichtZeile key={s.id} shift={s} />} />
        )}
      </div>
    </>
  );
}

/** Entwurf: fuer Mitarbeitende noch unsichtbar - ein Hinweis, kein Fehler. */
function EntwurfBadge({ zusatz }: { zusatz?: string }) {
  return (
    <StatusBadge ton="hinweis" klein icon={EyeOff}>
      {zusatz ? `${zusatz} Entwurf` : "Entwurf"}
    </StatusBadge>
  );
}

/** Kunde als Flaeche, seine Standorte als Zeilen darin. */
function KundenKarte({ name, branches, inaktiv = false, ohneKunde = false, admin }: { name: string; branches: BranchCard[]; inaktiv?: boolean; ohneKunde?: boolean; admin: boolean }) {
  return (
    <article className="akro-panel flex flex-col overflow-hidden">
      <header className="akro-panel-kopf border-b px-4 py-2.5">
        <p className="akro-label">Kunde</p>
        <h3 className="flex flex-wrap items-center gap-2 text-[15px] font-semibold tracking-[-0.02em]">
          {name}
          {inaktiv && <StatusBadge ton="neutral" klein>inaktiv</StatusBadge>}
        </h3>
        {ohneKunde && admin && (
          <Link href="/divisions" className={cn(textLink, "text-[12.5px]")}>Kunden zuordnen</Link>
        )}
      </header>
      {branches.length === 0 ? (
        <p className="px-4 py-5 text-[14px] text-muted-foreground">
          Noch keine Standorte.{admin && <> <Link href="/divisions" className={textLink}>Standort anlegen</Link></>}
        </p>
      ) : (
        <ul className="divide-y divide-[var(--linie-fein)]" aria-label={`Standorte von ${name}`}>
          {branches.map((b) => <StandortZeile key={b.id} branch={b} />)}
        </ul>
      )}
    </article>
  );
}

function StandortZeile({ branch }: { branch: BranchCard }) {
  const planbar = branch.openSlots !== null;
  const schichten = branch.shifts ?? 0;
  const offen = branch.openSlots ?? 0;
  return (
    <li className="flex items-start gap-3 px-4 py-3">
      <Building2 className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        {planbar ? (
          <Link href={monthLinkForOpen(branch.id, [])} className="block truncate text-[14px] font-medium hover:text-primary hover:underline">{branch.name}</Link>
        ) : (
          <span className="block truncate text-[14px] font-medium">{branch.name}</span>
        )}
        <div className="tabular mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-[12.5px] text-muted-foreground">
          {planbar && (
            <>
              {offen > 0 ? (
                <Link href={monthLinkForOpen(branch.id, branch.openDays)} className="rounded-full hover:opacity-80" title="Tage mit offenen Plätzen zeigen">
                  <StatusBadge ton="hinweis" klein>{offen} offen</StatusBadge>
                </Link>
              ) : schichten > 0 ? (
                <StatusBadge ton="ok" klein>besetzt</StatusBadge>
              ) : null}
              <span>{schichten > 0 ? anzahl(schichten, "Schicht", "Schichten") : "keine Schichten"}</span>
              {branch.draftWeeks ? <EntwurfBadge zusatz={anzahl(branch.draftWeeks, "Woche", "Wochen")} /> : null}
            </>
          )}
          {branch.issuesOpen ? (
            <StatusBadge ton="hinweis" klein>{anzahl(branch.issuesOpen, "Meldung", "Meldungen")}</StatusBadge>
          ) : null}
          {!planbar && !branch.issuesOpen && <span>{branch.issuesOpen === null ? "keine Planansicht" : "keine offenen Meldungen"}</span>}
        </div>
      </div>
      {planbar && <ChevronRight className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
    </li>
  );
}

/** Mitarbeitersicht: die naechste Schicht zuerst - ihre Bestaetigung ist die Hauptaktion. */
function MitarbeiterStart({ data, action }: { data: EmployeeData; action: ReturnType<typeof useAction> }) {
  const nächste = data.own[0];
  const eigeneBuchung = nächste?.bookings.find((b) => b.userId === data.userId);
  const bestätigt = !!eigeneBuchung?.confirmedAt;

  return (
    <>
      <section className="akro-panel overflow-hidden" aria-labelledby="naechste-titel">
        <div className="akro-panel-kopf flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2.5">
          <h2 id="naechste-titel" className="text-[14px] font-semibold tracking-[-0.02em]">Deine nächste Schicht</h2>
          {nächste && (bestätigt ? <StatusBadge ton="ok" klein>bestätigt</StatusBadge> : <StatusBadge ton="hinweis" klein>nicht bestätigt</StatusBadge>)}
        </div>
        {nächste ? (
          <div className="space-y-3 p-4">
            <p className="akro-kennzahl text-[20px]">
              {dateLabel(nächste.date)}
              <span className="px-2 text-border" aria-hidden="true">|</span>
              {nächste.shiftFrom}–{nächste.shiftTo}
            </p>
            <div className="text-[14px]">
              <p className="font-medium">{[nächste.branch?.name, nächste.title].filter(Boolean).join(" · ") || "Schicht"}</p>
              {nächste.branch?.customer && <p className="text-muted-foreground">{nächste.branch.customer.name}</p>}
            </div>
            {nächste.branch?.meetingPoint && (
              <p className="flex items-start gap-1.5 text-[14px] text-muted-foreground">
                <MapPin className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                Treffpunkt: {nächste.branch.meetingPoint}
                {nächste.branch.address ? ` · ${nächste.branch.address}` : ""}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              {!bestätigt && (
                <Button
                  disabled={action.isPending}
                  onClick={() => action.mutate({ url: "/api/bookings", method: "PATCH", data: { shiftId: nächste.id }, message: "Schicht bestätigt" })}
                >
                  Schicht bestätigen
                </Button>
              )}
              <Button variant="outline" asChild>
                <Link href="/time"><Clock className="size-4" />Zeiterfassung</Link>
              </Button>
              <Button variant="ghost" disabled={action.isPending} onClick={() => action.mutate({ url: "/api/mod-requests", data: { shiftId: nächste.id, kind: "SWAP" }, message: "Schicht zum Tausch angeboten" })}>
                Zum Tausch anbieten
              </Button>
            </div>
          </div>
        ) : (
          <p className="p-4 text-[14px] text-muted-foreground">Noch keine kommende Schicht veröffentlicht.</p>
        )}
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Abschnitt titel="Weitere eigene Schichten" leer="Keine weiteren Schichten geplant." eintraege={data.own.slice(1, 8)} render={(s) => <SchichtZeile key={s.id} shift={s} />} />
        <Abschnitt
          titel="Offene Schichten für dich"
          leer="Keine passenden offenen Schichten."
          eintraege={data.open.slice(0, 8)}
          render={(s) => (
            <SchichtZeile
              key={s.id}
              shift={s}
              aktion={
                <Button size="sm" variant="outline" disabled={action.isPending} onClick={() => action.mutate({ url: "/api/mod-requests", data: { shiftId: s.id }, message: "Übernahme angefragt" })}>
                  Übernahme anfragen
                </Button>
              }
            />
          )}
        />
      </div>

      {data.plans.length > 0 && (
        <section className="akro-panel overflow-hidden" aria-labelledby="plaene-titel">
          <h2 id="plaene-titel" className="akro-panel-kopf border-b px-4 py-2.5 text-[14px] font-semibold tracking-[-0.02em]">Standortpläne</h2>
          <ul className="divide-y divide-[var(--linie-fein)]">
            {data.plans.map((p) => (
              <li key={p.id}>
                <Link href={`/schedule/month?standort=${p.id}`} className="flex items-center gap-3 px-4 py-3 text-[14px] hover:bg-[var(--flaeche-kopf)]">
                  <Building2 className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{p.name}</span>
                    {p.customer && <span className="block truncate text-[12.5px] text-muted-foreground">{p.customer.name}</span>}
                  </span>
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

type Aufgabe = { zahl: number | null; label: string; zusatz?: string; href: string; dringend?: boolean };

/**
 * Offene Aufgaben mit Sprungzielen - die Reihenfolge ist die Dringlichkeit.
 * Felder ohne Recht (null) und erledigte (0) entfallen; bleibt nichts
 * uebrig, steht dort genau das.
 */
function OffeneAufgaben({ eintraege }: { eintraege: Aufgabe[] }) {
  const mitRecht = eintraege.filter((e): e is Aufgabe & { zahl: number } => e.zahl !== null);
  const offen = mitRecht.filter((e) => e.zahl > 0);
  if (!mitRecht.length) return null;

  return (
    <section className="space-y-3" aria-labelledby="aufgaben-titel">
      <h2 id="aufgaben-titel" className={abschnittTitel}>Offene Aufgaben</h2>
      {offen.length === 0 ? (
        <div className="akro-panel flex items-center gap-3 p-4 text-[14px]">
          <StatusBadge ton="ok">erledigt</StatusBadge>
          <span className="text-muted-foreground">Nichts offen.</span>
        </div>
      ) : (
        <div className="akro-panel overflow-hidden">
          {/* Haarlinien statt Zwischenraeume; der Versatz legt die aeusseren Linien unter den Rand. */}
          <ul className="-mr-px -mb-px grid sm:grid-cols-2 xl:grid-cols-3">
            {offen.map((e) => {
              const hinweis = e.dringend;
              return (
                <li key={e.label} className="border-r border-b">
                  <Link href={e.href} className="flex h-full items-center gap-3 px-4 py-3 transition-colors hover:bg-[var(--flaeche-kopf)]">
                    <span className={cn("akro-kennzahl min-w-9 text-[24px]", hinweis ? "text-warn" : "text-foreground")}>{e.zahl}</span>
                    <span className="min-w-0 flex-1 text-[14px] leading-snug">
                      <span className="flex items-center gap-1.5">
                        {hinweis && <AlertTriangle className="size-3.5 shrink-0 text-warn" aria-hidden="true" />}
                        {e.label}
                      </span>
                      {e.zusatz && <span className="block text-[12px] text-muted-foreground">{e.zusatz}</span>}
                    </span>
                    <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}

function Abschnitt({ titel, leer, eintraege, render }: { titel: string; leer: string; eintraege: Shift[]; render: (shift: Shift) => React.ReactNode }) {
  return (
    <section className="akro-panel overflow-hidden">
      <div className="akro-panel-kopf flex items-center justify-between gap-3 border-b px-4 py-2.5">
        <h2 className="text-[14px] font-semibold tracking-[-0.02em]">{titel}</h2>
        {eintraege.length > 0 && <span className="akro-kennzahl text-[13px] text-muted-foreground">{eintraege.length}</span>}
      </div>
      {eintraege.length ? <div className="divide-y divide-[var(--linie-fein)]">{eintraege.map(render)}</div> : <p className="px-4 py-6 text-[14px] text-muted-foreground">{leer}</p>}
    </section>
  );
}

/** Eine Schicht als Zeile: Zeit und Status oben, Ort und Namen darunter - auch auf dem Handy vollstaendig. */
function SchichtZeile({ shift, namen, status, aktion }: { shift: Shift; namen?: string; status?: React.ReactNode; aktion?: React.ReactNode }) {
  const ort = [shift.branch?.name, shift.title].filter(Boolean).join(" · ") || "Schicht";
  return (
    <article className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-3 transition-colors hover:bg-[var(--flaeche-kopf)]">
      <div className="min-w-0 flex-1 basis-56">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="tabular text-[14px] font-medium">{dateLabel(shift.date)} · {shift.shiftFrom}–{shift.shiftTo}</span>
          {status}
        </div>
        <p className="mt-0.5 text-[13px] text-muted-foreground">
          {ort}
          {namen ? ` · ${namen}` : ""}
        </p>
      </div>
      {aktion}
    </article>
  );
}

/** Geruest in der Form des spaeteren Inhalts. */
function DashboardSkeleton() {
  return (
    <div className="space-y-8" aria-busy="true" aria-label="Übersicht wird geladen">
      <div className="flex items-end justify-between gap-3">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-9 w-40" />
      </div>
      <div className="space-y-3">
        <Skeleton className="h-5 w-36" />
        <div className="akro-panel overflow-hidden">
          <div className="-mt-px -ml-px grid sm:grid-cols-2 xl:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex items-center gap-3 border-t border-l px-4 py-3">
                <Skeleton className="h-7 w-9" />
                <Skeleton className="h-4 w-36" />
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="akro-panel overflow-hidden">
            <div className="akro-panel-kopf space-y-1.5 border-b px-4 py-2.5">
              <Skeleton className="h-3 w-12" />
              <Skeleton className="h-4 w-40" />
            </div>
            <div className="space-y-3 p-4">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
