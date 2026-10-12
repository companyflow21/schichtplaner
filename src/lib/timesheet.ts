import { db } from "./db";
import { ApiError } from "./errors";
import type { Access } from "./access";
import { hoursReport, type HoursStatus } from "./hours";
import { payrollData } from "./payroll-service";

export type TimesheetRow = {
  date: string; site: string | null; planFrom: string | null; planTo: string | null; timeFrom: string | null; timeTo: string | null;
  breakMinutes: number; minutes: number; surcharges: { name: string; minutes: number }[]; status: string; proof: string | null; comment: string | null;
};
export type Timesheet = {
  organization: string; person: { name: string; personnelNumber: string | null; position: string | null }; from: string; to: string;
  rows: TimesheetRow[]; sums: { plannedMinutes: number; istMinutes: number; targetMinutes: number | null; surcharges: { name: string; minutes: number }[] };
  openCount: number; generatedAt: string;
};
export type SiteReport = {
  organization: string; customer: string | null; site: string; from: string; to: string; generatedAt: string;
  rows: { date: string; person: string; activity: string | null; timeFrom: string | null; timeTo: string | null; breakMinutes: number; minutes: number; status: string }[];
  perPerson: { name: string; minutes: number }[]; totalMinutes: number; openCount: number;
};

const STATUS_TEXT: Record<HoursStatus, string> = { APPROVED: "genehmigt", OPEN: "offen", MISSING: "nicht erfasst", PLANNED: "geplant", RUNNING: "läuft" };
const proofText = (r: { type: string; checkin: { method: string } | null }) =>
  r.checkin ? (r.checkin.method === "GPS" ? "GPS-Check-in" : "Check-in freigegeben") : r.type === "WATCH" ? "Stoppuhr" : r.type === "MANUAL_DURATION" ? "Dauer" : "manuell";
const recordStatus = (r: { running: boolean; approved: boolean }) => (r.running ? "läuft" : r.approved ? "genehmigt" : "offen");
const wholeMonth = (from: string, to: string) => from.endsWith("-01") && to === new Date(Date.UTC(Number(from.slice(0, 4)), Number(from.slice(5, 7)), 0)).toISOString().slice(0, 10);

/**
 * Stundenzettel einer Person: dieselben Zeilen und Rechte wie "Stunden und
 * Lohn" (eigene immer, fremde mit Freigaben), dazu Stunden je Zuschlag ohne
 * Betraege. Personalnummer und Soll nur fuer die Person selbst und die Administration.
 */
export async function timesheet(a: Access, userId: string, from: string, to: string): Promise<Timesheet> {
  const report = await hoursReport(a, from, to, null, { userId });
  const person = report.people.find((p) => p.userId === userId);
  if (!person) throw new ApiError("Nicht gefunden.", 404);
  const [org, member, pay] = await Promise.all([
    db.organization.findUnique({ where: { id: a.orgId }, select: { name: true } }),
    db.organizationMember.findFirst({ where: { organizationId: a.orgId, userId }, select: { position: true, personnelNumber: true, targetHoursPerMonth: true } }),
    payrollData(a.orgId, from, to, null),
  ]);
  const surchargesOf = new Map<string, { name: string; minutes: number }[]>();
  for (const p of pay.people) if (p.userId === userId) for (const r of p.records) surchargesOf.set(r.id, r.lines.filter((l) => l.kind === "SURCHARGE" && l.minutes > 0).map((l) => ({ name: l.title, minutes: l.minutes })));
  const privileged = a.isAdmin || userId === a.userId;
  const rows: TimesheetRow[] = person.rows.flatMap((row): TimesheetRow[] => {
    const site = row.shift ? [row.shift.branchName, row.shift.customerName].filter(Boolean).join(" · ") || null : null;
    const plan = { planFrom: row.shift?.from ?? null, planTo: row.shift?.to ?? null };
    if (!row.records.length) return [{ date: row.date, site, ...plan, timeFrom: null, timeTo: null, breakMinutes: 0, minutes: 0, surcharges: [], status: STATUS_TEXT[row.status], proof: null, comment: null }];
    return row.records.map((r, i) => ({
      date: r.date, site: site ?? r.branchName, ...(i === 0 ? plan : { planFrom: null, planTo: null }), timeFrom: r.timeFrom, timeTo: r.timeTo,
      breakMinutes: Math.round(r.breakSeconds / 60), minutes: r.minutes, surcharges: surchargesOf.get(r.id) ?? [], status: recordStatus(r), proof: proofText(r), comment: r.comment,
    }));
  });
  const surchargeSums = new Map<string, number>();
  for (const r of rows) for (const s of r.surcharges) surchargeSums.set(s.name, (surchargeSums.get(s.name) ?? 0) + s.minutes);
  return {
    organization: org?.name ?? "", from, to, rows, openCount: person.openCount, generatedAt: new Date().toISOString(),
    person: { name: person.firstName + " " + person.lastName, personnelNumber: privileged ? member?.personnelNumber ?? null : null, position: member?.position ?? null },
    sums: {
      plannedMinutes: person.plannedMinutes, istMinutes: person.istMinutes,
      targetMinutes: privileged && wholeMonth(from, to) && member?.targetHoursPerMonth != null ? Math.round(member.targetHoursPerMonth * 60) : null,
      surcharges: [...surchargeSums].map(([name, minutes]) => ({ name, minutes })).sort((x, y) => x.name.localeCompare(y.name, "de")),
    },
  };
}

/** Leistungsnachweis je Einsatzort: alle sichtbaren Buchungen am Standort mit Summe je Person. */
export async function siteReport(a: Access, branchId: string, from: string, to: string): Promise<SiteReport> {
  const report = await hoursReport(a, from, to, branchId);
  const [org, branch] = await Promise.all([
    db.organization.findUnique({ where: { id: a.orgId }, select: { name: true } }),
    db.branch.findFirst({ where: { id: branchId, organizationId: a.orgId }, select: { name: true, customer: { select: { name: true } } } }),
  ]);
  if (!branch) throw new ApiError("Nicht gefunden.", 404);
  const records = report.people.flatMap((p) => p.rows.flatMap((row) => row.records.filter((r) => !r.running).map((r) => ({ p, row, r }))));
  const rows = records.map(({ p, row, r }) => ({
    date: r.date, person: p.firstName + " " + p.lastName, activity: row.shift?.title ?? row.shift?.division?.title ?? null,
    timeFrom: r.timeFrom, timeTo: r.timeTo, breakMinutes: Math.round(r.breakSeconds / 60), minutes: r.minutes, status: recordStatus(r),
  })).sort((x, y) => x.date.localeCompare(y.date) || (x.timeFrom ?? "").localeCompare(y.timeFrom ?? "") || x.person.localeCompare(y.person, "de"));
  const perPerson = new Map<string, number>();
  for (const r of rows) perPerson.set(r.person, (perPerson.get(r.person) ?? 0) + r.minutes);
  return {
    organization: org?.name ?? "", customer: branch.customer?.name ?? null, site: branch.name, from, to, generatedAt: new Date().toISOString(),
    rows, perPerson: [...perPerson].map(([name, minutes]) => ({ name, minutes })),
    totalMinutes: rows.reduce((s, r) => s + r.minutes, 0), openCount: records.filter(({ r }) => !r.approved).length,
  };
}
