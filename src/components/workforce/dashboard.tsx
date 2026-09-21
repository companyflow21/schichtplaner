"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowRight, Clock, MapPin } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
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
  description: string | null;
  branch: {
    name: string;
    address: string | null;
    meetingPoint: string | null;
    notes: string | null;
  } | null;
  bookings: {
    userId: string;
    confirmedAt: string | null;
    user: { firstName: string; lastName: string };
  }[];
};

type Dashboard = {
  manager: boolean;
  firstName: string;
  userId: string;
  today: string;
  own: Shift[];
  todayShifts: Shift[];
  open: Shift[];
  unconfirmed: number;
  unread: number;
  absences: {
    id: string;
    status: string;
    dateFrom: string;
    dateTo: string;
    user: { firstName: string; lastName: string };
    category: { name: string };
  }[];
  reports: {
    employees: {
      userId: string;
      firstName: string;
      lastName: string;
      totalMinutes: number;
      plannedMinutes: number;
      targetMinutes: number;
      deviationMinutes: number;
    }[];
  };
};

function stunden(minuten: number) {
  return (
    (minuten / 60).toLocaleString("de-DE", { maximumFractionDigits: 1 }) + " h"
  );
}

/** Wie viele Plätze in dieser Schicht noch offen sind. */
function offenePlätze(shift: Shift) {
  return Math.max(0, shift.maxEmployees - shift.occupiedCount);
}

export function Dashboard() {
  const query = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => json<Dashboard>("/api/dashboard"),
    refetchInterval: 30000,
  });
  const action = useAction();
  const data = query.data;

  if (query.error) {
    return (
      <div className="space-y-3">
        <ErrorMessage error={query.error} />
        <Button variant="outline" onClick={() => query.refetch()}>
          Erneut versuchen
        </Button>
      </div>
    );
  }

  if (!data) return <DashboardSkeleton />;

  const eigeneMonatszeile = data.reports.employees.find(
    (e) => e.userId === data.userId
  );

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[13px] text-muted-foreground">
            {dateLabel(data.today)}
          </p>
          <h1 className="text-[26px] leading-tight font-semibold tracking-[-0.03em]">
            Guten Tag, {data.firstName}
          </h1>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href={data.manager ? "/schedule/flexible" : "/schedule/employee"}>
            Dienstplan öffnen
            <ArrowRight className="size-3.5" />
          </Link>
        </Button>
      </header>

      {data.manager ? (
        <ManagerStart data={data} />
      ) : (
        <MitarbeiterStart data={data} action={action} />
      )}

      <Requests manager={data.manager} userId={data.userId} />

      {/* Nur eine kurze Zusammenfassung; die Auswertung hat eine eigene Seite. */}
      <section className="rounded-md border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-[17px] font-semibold tracking-[-0.02em]">
              {data.manager ? "Stunden im laufenden Monat" : "Deine Monatsstunden"}
            </h2>
            <p className="tabular mt-1 text-[13px] text-muted-foreground">
              {data.manager
                ? `${data.reports.employees.length} Mitarbeitende erfasst`
                : eigeneMonatszeile
                  ? `${stunden(eigeneMonatszeile.totalMinutes)} erfasst · Soll ${stunden(eigeneMonatszeile.targetMinutes)} · Abweichung ${stunden(eigeneMonatszeile.deviationMinutes)}`
                  : "Noch keine Zeiten erfasst"}
            </p>
          </div>
          <Button asChild variant="outline" size="sm">
            <Link href="/reporting">Zur Auswertung</Link>
          </Button>
        </div>
      </section>
    </div>
  );
}

/** Disponentensicht: zuerst das, was heute eine Entscheidung braucht. */
function ManagerStart({ data }: { data: Dashboard }) {
  const unbesetzt = data.open.reduce((summe, s) => summe + offenePlätze(s), 0);

  return (
    <>
      <HandlungsLeiste
        eintraege={[
          {
            zahl: unbesetzt,
            label: "unbesetzte Plätze",
            href: "/schedule/flexible",
            dringend: unbesetzt > 0,
          },
          {
            zahl: data.unconfirmed,
            label: "Bestätigungen offen",
            href: "/schedule/flexible",
          },
          {
            zahl: data.absences.filter((a) => a.status === "PENDING").length,
            label: "Abwesenheiten zur Freigabe",
            href: "/employees/absences",
          },
          {
            zahl: data.unread,
            label: "neue Nachrichten",
            href: "/portal/inbox",
          },
        ]}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Abschnitt
          titel="Offene Schichten"
          leer="Alle Schichten sind besetzt."
          eintraege={data.open.slice(0, 8)}
          render={(s) => (
            <SchichtZeile key={s.id} shift={s} warnung={`${offenePlätze(s)} frei`} />
          )}
        />
        <Abschnitt
          titel="Heutige Einsätze"
          leer="Heute sind keine Schichten geplant."
          eintraege={data.todayShifts}
          render={(s) => {
            const offen = s.bookings.filter((b) => !b.confirmedAt).length;
            return (
              <SchichtZeile
                key={s.id}
                shift={s}
                namen={s.bookings
                  .map((b) => `${b.user.firstName} ${b.user.lastName}`)
                  .join(", ")}
                warnung={offen > 0 ? `${offen} unbestätigt` : undefined}
              />
            );
          }}
        />
      </div>
    </>
  );
}

/** Mitarbeitersicht: die nächste Schicht und die Zeiterfassung zuerst. */
function MitarbeiterStart({
  data,
  action,
}: {
  data: Dashboard;
  action: ReturnType<typeof useAction>;
}) {
  const nächste = data.own[0];
  const eigeneBuchung = nächste?.bookings.find((b) => b.userId === data.userId);

  return (
    <>
      <Card className="p-4">
        <h2 className="text-[17px] font-semibold tracking-[-0.02em]">
          Deine nächste Schicht
        </h2>
        {nächste ? (
          <div className="mt-3 space-y-3">
            <p className="tabular text-[15px] font-medium">
              {dateLabel(nächste.date)} · {nächste.shiftFrom}–{nächste.shiftTo}
            </p>
            <p className="text-[14px]">
              {nächste.title || "Schicht"}
              {nächste.branch ? ` · ${nächste.branch.name}` : ""}
            </p>
            {nächste.branch?.meetingPoint && (
              <p className="flex items-start gap-1.5 text-[14px] text-muted-foreground">
                <MapPin className="mt-0.5 size-4 shrink-0" />
                Treffpunkt: {nächste.branch.meetingPoint}
                {nächste.branch.address ? ` · ${nächste.branch.address}` : ""}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant={eigeneBuchung?.confirmedAt ? "outline" : "default"}
                disabled={!!eigeneBuchung?.confirmedAt || action.isPending}
                onClick={() =>
                  action.mutate({
                    url: "/api/bookings",
                    method: "PATCH",
                    data: { shiftId: nächste.id },
                    message: "Schicht bestätigt",
                  })
                }
              >
                {eigeneBuchung?.confirmedAt ? "Bestätigt" : "Schicht bestätigen"}
              </Button>
              <Button size="sm" variant="outline" asChild>
                <Link href="/time">
                  <Clock className="size-3.5" />
                  Zeiterfassung
                </Link>
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={action.isPending}
                onClick={() =>
                  action.mutate({
                    url: "/api/mod-requests",
                    data: { shiftId: nächste.id, kind: "SWAP" },
                    message: "Schicht zum Tausch angeboten",
                  })
                }
              >
                Zum Tausch anbieten
              </Button>
            </div>
          </div>
        ) : (
          <p className="mt-3 text-[14px] text-muted-foreground">
            Für dich ist noch keine kommende Schicht veröffentlicht. Sobald
            die Planung steht, erscheint sie hier.
          </p>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Abschnitt
          titel="Weitere eigene Schichten"
          leer="Keine weiteren Schichten geplant."
          eintraege={data.own.slice(1, 8)}
          render={(s) => <SchichtZeile key={s.id} shift={s} />}
        />
        <Abschnitt
          titel="Offene Schichten für dich"
          leer="Aktuell keine passenden offenen Schichten."
          eintraege={data.open.slice(0, 8)}
          render={(s) => (
            <SchichtZeile
              key={s.id}
              shift={s}
              aktion={
                <Button
                  size="xs"
                  variant="outline"
                  disabled={action.isPending}
                  onClick={() =>
                    action.mutate({
                      url: "/api/mod-requests",
                      data: { shiftId: s.id },
                      message: "Übernahme angefragt",
                    })
                  }
                >
                  Übernahme anfragen
                </Button>
              }
            />
          )}
        />
      </div>
    </>
  );
}

/** Zahlenleiste mit Sprungzielen - die Reihenfolge ist die Dringlichkeit. */
function HandlungsLeiste({
  eintraege,
}: {
  eintraege: { zahl: number; label: string; href: string; dringend?: boolean }[];
}) {
  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md border bg-border lg:grid-cols-4">
      {eintraege.map((e) => (
        <Link
          key={e.label}
          href={e.href}
          className="flex flex-col gap-0.5 bg-card p-4 transition-colors hover:bg-muted"
        >
          <span
            className={cn(
              "tabular text-[24px] leading-none font-semibold",
              e.dringend && e.zahl > 0 ? "text-destructive" : "text-foreground"
            )}
          >
            {e.zahl}
          </span>
          <span className="flex items-center gap-1 text-[13px] text-muted-foreground">
            {e.dringend && e.zahl > 0 && (
              <AlertTriangle className="size-3.5 text-destructive" />
            )}
            {e.label}
          </span>
        </Link>
      ))}
    </div>
  );
}

function Abschnitt({
  titel,
  leer,
  eintraege,
  render,
}: {
  titel: string;
  leer: string;
  eintraege: Shift[];
  render: (shift: Shift) => React.ReactNode;
}) {
  return (
    <section className="rounded-md border bg-card">
      <h2 className="border-b px-4 py-3 text-[15px] font-semibold tracking-[-0.02em]">
        {titel}
      </h2>
      {eintraege.length ? (
        <div className="divide-y">{eintraege.map(render)}</div>
      ) : (
        <p className="px-4 py-6 text-[14px] text-muted-foreground">{leer}</p>
      )}
    </section>
  );
}

function SchichtZeile({
  shift,
  namen,
  warnung,
  aktion,
}: {
  shift: Shift;
  namen?: string;
  warnung?: string;
  aktion?: React.ReactNode;
}) {
  return (
    <article className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3">
      <span className="tabular text-[14px] font-medium">
        {dateLabel(shift.date)} · {shift.shiftFrom}–{shift.shiftTo}
      </span>
      <span className="min-w-0 flex-1 truncate text-[14px] text-muted-foreground">
        {[shift.title, shift.branch?.name].filter(Boolean).join(" · ") ||
          "Schicht"}
        {namen ? ` · ${namen}` : ""}
      </span>
      {warnung && (
        <Badge variant="secondary" className="tabular border-warn/45 bg-warn/10 text-warn">
          {warnung}
        </Badge>
      )}
      {aktion}
    </article>
  );
}

/** Gerüst in der Form des späteren Inhalts. */
function DashboardSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Übersicht wird geladen">
      <Skeleton className="h-9 w-64" />
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md border bg-border lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="space-y-2 bg-card p-4">
            <Skeleton className="h-6 w-10" />
            <Skeleton className="h-4 w-28" />
          </div>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {[0, 1].map((i) => (
          <div key={i} className="rounded-md border bg-card">
            <div className="border-b px-4 py-3">
              <Skeleton className="h-5 w-40" />
            </div>
            <div className="space-y-3 p-4">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
              <Skeleton className="h-4 w-4/6" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
