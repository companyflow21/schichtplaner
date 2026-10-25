"use client";

import Link from "next/link";
import { toast } from "sonner";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowRight, Building2, ChevronRight, Clock, EyeOff, Lock, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { InfoHint } from "@/components/ui/info-hint";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/ui/status-badge";
import { cn } from "@/lib/utils";
import { formatName } from "@/lib/names";
import { useNameFormat } from "@/lib/hooks/use-current-member";
import { monthLinkForOpen } from "@/components/schedule/month-grid";
import { BEARBEITUNG_HINWEIS } from "@/components/schedule/employee-grid";
import { dateLabel, ErrorMessage, json, useAction } from "./client";
import { Requests } from "./requests";
import { CheckinUebersicht, EigenerCheckin } from "./checkins";
import { PushSetup } from "./push-setup";

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
  /** Plan in Bearbeitung: Bestaetigen und Antraege ruhen. */
  requestsPaused?: boolean;
  /** Nachtschicht: endet am Folgetag. */
  endsNextDay?: boolean;
  /** Nur Startseite der Planung: Zaehlregel "Bestaetigungen offen" (lib/dashboard-tasks.ts). */
  openConfirmations?: number;
  description: string | null;
  branch: {
    name: string;
    address: string | null;
    meetingPoint: string | null;
    notes: string | null;
    customer: { name: string } | null;
  } | null;
  bookings: {
    /** null: geloeschte Person (Historie). */
    userId: string | null;
    /** Platzhalter eines Subunternehmers: Name bleibt in der Form "Firma · Name". */
    contractorWorkerId?: string | null;
    confirmedAt: string | null;
    /** PLANNER: von der Planung fest eingeteilt, EMPLOYEE: selbst bestätigt, null: Altbestand. */
    confirmation?: "PLANNER" | "EMPLOYEE" | null;
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
    targetStatus?: "hidden" | "unset" | "set";
    deviationMinutes: number;
  }[];
};

type Base = { firstName: string; userId: string; today: string; unread: number; own: Shift[]; reports: Reports };
type ManagerData = Base & {
  manager: true;
  // Offene Aufgaben aus src/lib/dashboard-tasks.ts; null: ohne Zustaendigkeit.
  tasks: { notActivated: number | null; draftWeeks: number | null; draftHref: string | null };
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

/** Wie die Auswertung: Dezimalkomma, höchstens zwei Stellen ("7,5 h"). */
function stunden(minuten: number) {
  return (minuten / 60).toLocaleString("de-DE", { maximumFractionDigits: 2 }) + " h";
}

/** Mit Vorzeichen und echtem Minus ("−7,5 h"). */
function stundenMitVorzeichen(minuten: number) {
  return (minuten > 0 ? "+" : minuten < 0 ? "−" : "") + stunden(Math.abs(minuten));
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
          <h1 className="text-[28px] leading-tight font-semibold tracking-[-0.03em]">Heute</h1>
          <p className="mt-1 text-[14px] text-muted-foreground">Guten Tag, {data.firstName}</p>
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

      {/* Nur eine kurze Zusammenfassung; die Auswertung hat eine eigene Seite. */}
      <section className="akro-panel flex flex-wrap items-center justify-between gap-3 p-4" aria-labelledby="stunden-titel">
        <div className="min-w-0">
          <h2 id="stunden-titel" className="text-[15px] font-semibold tracking-[-0.02em]">{data.manager ? "Stunden im Monat" : "Deine Monatsstunden"}</h2>
          <p className="tabular mt-0.5 text-[13px] text-muted-foreground">
            {data.manager
              ? anzahl(data.reports.employees.length, "Person", "Personen") + " in deiner Auswertung"
              : eigeneMonatszeile
                ? `${stunden(eigeneMonatszeile.totalMinutes)} erfasst${eigeneMonatszeile.targetStatus === "unset" ? " · Soll nicht festgelegt" : eigeneMonatszeile.targetMinutes !== null ? ` · Soll ${stunden(eigeneMonatszeile.targetMinutes)}` : ""}`
                : "Noch keine Zeiten erfasst"}
          </p>
          {!data.manager && eigeneMonatszeile && (
            <p className="tabular mt-0.5 flex items-center gap-1 text-[13px] text-muted-foreground">
              Abweichung zum Plan {stundenMitVorzeichen(eigeneMonatszeile.deviationMinutes)}
              <InfoHint thema="Abweichung zum Plan">
                <p>Erfasste Stunden minus die Stunden der veröffentlichten Schichten dieses Monats, auch der noch kommenden.</p>
                <p>Ein Minus heißt: Es ist mehr eingeplant als bisher erfasst.</p>
              </InfoHint>
            </p>
          )}
        </div>
        <Button asChild variant="outline" size="sm"><Link href="/reporting">Zur Auswertung</Link></Button>
      </section>

      <Requests manager={data.manager} userId={data.userId} />
    </div>
  );
}

/** Disposition: erst was zu tun ist, dann Kunden und Standorte, dann der heutige Plan. */
function ManagerStart({ data }: { data: ManagerData }) {
  const nameFormat = useNameFormat();
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
          { zahl: data.tasks.draftWeeks, label: data.tasks.draftWeeks === 1 ? "Woche im Entwurf" : "Wochen im Entwurf", zusatz: `nächste ${overview.horizon.days} Tage · für Mitarbeitende unsichtbar`, href: data.tasks.draftHref ?? "/schedule/month" },
          { zahl: counts.unconfirmed, label: "Bestätigungen offen", zusatz: "ältere Zuweisungen", href: "/schedule/month" },
          { zahl: anträge, label: "Anträge offen", href: "#antraege" },
          { zahl: counts.pendingAbsences, label: "Abwesenheiten zur Freigabe", href: "/employees/absences" },
          { zahl: counts.openIssues, label: "Standortmeldungen offen", href: "#kunden" },
          { zahl: data.tasks.notActivated, label: data.tasks.notActivated === 1 ? "Person nicht freigeschaltet" : "Mitarbeitende nicht freigeschaltet", zusatz: "jetzt einladen", href: "/employees?status=not_activated" },
          { zahl: data.unread, label: "neue Nachrichten", href: "/portal/inbox" },
        ]}
      />

      {/* Eigener Check-in (nur bei eigener Schicht mit Check-in) und Check-ins des Teams. */}
      <PushSetup />
      <EigenerCheckin />
      <CheckinUebersicht />

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
        <section className={cn("akro-panel overflow-hidden", data.own.length === 0 && "lg:col-span-2")} aria-labelledby="heute-titel">
          <div className="akro-panel-kopf flex items-center justify-between gap-3 border-b px-4 py-2.5">
            <h2 id="heute-titel" className="text-[14px] font-semibold tracking-[-0.02em]">Heute im Dienstplan</h2>
            {data.todayShifts.length > 0 && <span className="akro-kennzahl text-[13px] text-muted-foreground">{data.todayShifts.length}</span>}
          </div>
          {data.todayShifts.length ? (
            <ul className="divide-y divide-[var(--linie-fein)]">
              {[...data.todayShifts].sort((x, y) => x.date.localeCompare(y.date) || x.shiftFrom.localeCompare(y.shiftFrom)).map((s) => (
                <HeuteZeile key={s.id} shift={s} heute={data.today} nameFormat={nameFormat} />
              ))}
            </ul>
          ) : (
            <p className="px-4 py-3 text-[14px] text-muted-foreground">Heute keine Schichten an deinen Standorten.</p>
          )}
        </section>
        {data.own.length > 0 && (
          <Abschnitt titel="Deine nächsten Schichten" leer="" eintraege={data.own.slice(0, 8)} render={(s) => <SchichtZeile key={s.id} shift={s} />} />
        )}
      </div>
    </>
  );
}

/** Mehr als drei Namen: die ersten drei, der Rest als "+N" - alle Namen im Titel. */
const SICHTBARE_NAMEN = 3;

/**
 * Eine Schicht von heute als Zeile: Zeit, Einsatzort, Besetzung, Namen.
 * Nachtschichten tragen "+1" (Ende am Folgetag); eine von gestern beginnende
 * Nachtschicht ist als solche benannt.
 */
function HeuteZeile({ shift, heute, nameFormat }: { shift: Shift; heute: string; nameFormat: string | undefined }) {
  const ort = [shift.branch?.name, shift.title].filter(Boolean).join(" · ") || "Schicht";
  const alle = shift.bookings.map((b) => formatName(b.user, nameFormat, { contractor: !!b.contractorWorkerId }));
  const sichtbar = alle.slice(0, SICHTBARE_NAMEN);
  const rest = alle.slice(SICHTBARE_NAMEN);
  // Bei "Nachname, Vorname" trennt ein Semikolon die Personen eindeutig.
  const trenner = nameFormat === "LASTNAME_FIRSTNAME" ? "; " : ", ";
  const unbestätigt = shift.openConfirmations ?? 0;
  const vonGestern = shift.date < heute;
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3">
      <span className="tabular w-[9.5rem] shrink-0 text-[14px] font-medium">
        {shift.shiftFrom}–{shift.shiftTo}
        {shift.endsNextDay && !vonGestern && (
          <span className="ml-1 text-[12px] font-normal text-muted-foreground" title="Endet am nächsten Tag">
            +1<span className="sr-only"> (endet am nächsten Tag)</span>
          </span>
        )}
        {vonGestern && <span className="ml-1.5 text-[12px] font-normal text-muted-foreground">von gestern</span>}
      </span>
      <span className="order-3 min-w-0 basis-full text-[14px] break-words sm:order-none sm:flex-1 sm:basis-40">{ort}</span>
      <span className="order-2 shrink-0 sm:order-none">
        {shift.missing > 0 ? (
          <StatusBadge ton="hinweis" klein>{shift.missing} offen</StatusBadge>
        ) : !shift.isPublic ? (
          <EntwurfBadge />
        ) : unbestätigt > 0 ? (
          <StatusBadge ton="neutral" klein>{unbestätigt} unbestätigt</StatusBadge>
        ) : (
          <StatusBadge ton="ok" klein>besetzt</StatusBadge>
        )}
      </span>
      {alle.length > 0 && (
        <span className="order-4 min-w-0 basis-full text-[13px] text-muted-foreground sm:order-none sm:flex-[3_1_16rem]">
          {sichtbar.join(trenner)}
          {rest.length > 0 && (
            <>
              {trenner}
              <span className="font-medium text-foreground" title={alle.join(trenner)}>
                +{rest.length}<span className="sr-only"> weitere: {rest.join(trenner)}</span>
              </span>
            </>
          )}
        </span>
      )}
    </li>
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

/**
 * Mitarbeitersicht: die naechste Schicht zuerst. Einteilungen der Planung
 * sind fest; nur Altbestand ohne Herkunft wartet noch auf eine Bestaetigung.
 */
function MitarbeiterStart({ data, action }: { data: EmployeeData; action: ReturnType<typeof useAction> }) {
  const nächste = data.own[0];
  const eigeneBuchung = nächste?.bookings.find((b) => b.userId === data.userId);
  const bestätigt = !!eigeneBuchung?.confirmedAt;
  const status = eigeneBuchung?.confirmation === "PLANNER"
    ? <StatusBadge ton="ok" klein>fest eingeteilt</StatusBadge>
    : bestätigt
      ? <StatusBadge ton="ok" klein>bestätigt</StatusBadge>
      : <StatusBadge ton="hinweis" klein>Bestätigung offen</StatusBadge>;
  const adresse = nächste?.branch?.address?.trim();
  const weitere = data.own.slice(1, 8);
  const offene = data.open.slice(0, 8);

  async function adresseKopieren() {
    if (!adresse) return;
    try {
      await navigator.clipboard.writeText(adresse);
      toast.success("Adresse kopiert.");
    } catch {
      toast.error("Adresse konnte nicht kopiert werden. Bitte markiere und kopiere sie direkt.");
    }
  }

  return (
    <>
      <PushSetup />
      <EigenerCheckin />

      <section className="akro-panel overflow-hidden" aria-labelledby="naechste-titel">
        <div className="akro-panel-kopf flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2.5">
          <h2 id="naechste-titel" className="text-[15px] font-semibold tracking-[-0.02em]">Deine nächste Schicht</h2>
          {nächste && status}
        </div>
        {nächste ? (
          <div className="space-y-3 p-4">
            <div>
              <p className="text-[15px] font-medium">{dateLabel(nächste.date)}</p>
              <p className="akro-kennzahl mt-1 text-[30px] leading-tight">{nächste.shiftFrom}–{nächste.shiftTo}</p>
            </div>
            <div className="text-[14px]">
              <p className="font-medium">{[nächste.branch?.name, nächste.title].filter(Boolean).join(" · ") || "Schicht"}</p>
              {nächste.branch?.customer && <p className="text-muted-foreground">{nächste.branch.customer.name}</p>}
            </div>
            {nächste.branch?.meetingPoint && (
              <p className="flex items-start gap-1.5 text-[14px] text-muted-foreground">
                <MapPin className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                Treffpunkt: {nächste.branch.meetingPoint}
              </p>
            )}
            {adresse && (
              <div className="flex flex-wrap items-center gap-2 text-[14px] text-muted-foreground">
                <p className="flex min-w-0 items-start gap-1.5">
                  <MapPin className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                  <span className="break-words">Adresse: {adresse}</span>
                </p>
                <Button variant="outline" size="sm" onClick={adresseKopieren}>Adresse kopieren</Button>
              </div>
            )}
            {/* Plan in Bearbeitung: Bestaetigen ruht - der Grund statt des Knopfs. */}
            {!bestätigt && nächste.requestsPaused && (
              <p className="flex items-start gap-1.5 text-[13px] leading-5 text-muted-foreground">
                <Lock className="mt-1 size-3.5 shrink-0" aria-hidden="true" />
                <span>{BEARBEITUNG_HINWEIS}</span>
              </p>
            )}
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
              {!bestätigt && !nächste.requestsPaused && (
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
            </div>
            <details className="rounded-[var(--radius)] border px-3">
              <summary className="min-h-11 cursor-pointer py-3 text-[13px] font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">Weitere Schichtaktionen</summary>
              <div className="pb-3">
                <Button variant="outline" disabled={action.isPending} onClick={() => action.mutate({ url: "/api/mod-requests", data: { shiftId: nächste.id, kind: "SWAP" }, message: "Schicht zur Übernahme angeboten" })}>
                  Zur Übernahme anbieten
                </Button>
              </div>
            </details>

          </div>
        ) : (
          <div className="space-y-2 p-4 text-[14px]">
            <p className="text-muted-foreground">Noch keine kommende Schicht veröffentlicht.</p>
            {data.plans.length > 0 && <Link href="/schedule/month" className={textLink}>Standortpläne ansehen</Link>}
          </div>
        )}
      </section>

      {/* Listen nur mit Inhalt: zwei leere Kästen unter der nächsten Schicht sagen nichts, ein Satz genügt. */}
      {weitere.length > 0 || offene.length > 0 ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {weitere.length > 0 && (
            <Abschnitt titel="Weitere eigene Schichten" leer="" eintraege={weitere} className={offene.length === 0 ? "lg:col-span-2" : undefined} render={(s) => <SchichtZeile key={s.id} shift={s} />} />
          )}
          {offene.length > 0 && (
            <Abschnitt
              titel="Offene Schichten für dich"
              leer=""
              eintraege={offene}
              className={weitere.length === 0 ? "lg:col-span-2" : undefined}
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
          )}
        </div>
      ) : nächste ? (
        <p className="-mt-4 text-[13px] text-muted-foreground">Keine weiteren Schichten geplant und keine passenden offenen Schichten.</p>
      ) : null}

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
          {/* Haarlinien statt Zwischenraeume; der Versatz legt die aeusseren Linien unter den Rand.
              Die Felder umbrechen und wachsen: auch die letzte Zeile ist gefuellt, es bleibt keine leere Zelle. */}
          <ul className="-mr-px -mb-px flex flex-wrap">
            {offen.map((e) => {
              const hinweis = e.dringend;
              return (
                <li key={e.label} className="min-w-0 flex-[1_1_16rem] border-r border-b">
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

function Abschnitt({ titel, leer, eintraege, render, className }: { titel: string; leer: string; eintraege: Shift[]; render: (shift: Shift) => React.ReactNode; className?: string }) {
  return (
    <section className={cn("akro-panel overflow-hidden", className)}>
      <div className="akro-panel-kopf flex items-center justify-between gap-3 border-b px-4 py-2.5">
        <h2 className="text-[14px] font-semibold tracking-[-0.02em]">{titel}</h2>
        {eintraege.length > 0 && <span className="akro-kennzahl text-[13px] text-muted-foreground">{eintraege.length}</span>}
      </div>
      {eintraege.length ? <div className="divide-y divide-[var(--linie-fein)]">{eintraege.map(render)}</div> : <p className="px-4 py-3 text-[14px] text-muted-foreground">{leer}</p>}
    </section>
  );
}

/** Eine eigene oder offene Schicht als Zeile: Zeit oben, Ort darunter - auch auf dem Handy vollstaendig. */
function SchichtZeile({ shift, aktion }: { shift: Shift; aktion?: React.ReactNode }) {
  const ort = [shift.branch?.name, shift.title].filter(Boolean).join(" · ") || "Schicht";
  return (
    <article className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-3 transition-colors hover:bg-[var(--flaeche-kopf)]">
      <div className="min-w-0 flex-1 basis-56">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="tabular text-[14px] font-medium">{dateLabel(shift.date)} · {shift.shiftFrom}–{shift.shiftTo}</span>
        </div>
        <p className="mt-0.5 text-[13px] text-muted-foreground">{ort}</p>
      </div>
      {aktion}
    </article>
  );
}

/** Geruest in der Form des spaeteren Inhalts. */
function DashboardSkeleton() {
  return (
    <div className="space-y-8" aria-busy="true" aria-label="Startseite wird geladen">
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
