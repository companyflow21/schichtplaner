import type { Prisma } from "@prisma/client";
import { z } from "zod";
import type { Access } from "./access";
import { ApiError } from "./errors";
import { addDate, isoWeek, shiftRange, validDate } from "./berlin";
import { shiftInclude, shiftView } from "./planning";
import { ineffectiveFor, mergedScope, visibleFor } from "./schedule-visibility";
import type { ScheduleExport, ScheduleExportRow } from "@/types/schedule-export";

type Tx = Prisma.TransactionClient;

export const EXPORT_MAX_DAYS = 62;
export const EXPORT_MAX_SHIFTS = 5000;
const WEEKDAYS = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"];

const id = z.string().min(1).max(64).optional();
const querySchema = z.object({
  from: z.string().refine(validDate, "Bitte den Beginn des Zeitraums als JJJJ-MM-TT angeben."),
  to: z.string().refine(validDate, "Bitte das Ende des Zeitraums als JJJJ-MM-TT angeben."),
  customerId: id,
  branchId: id,
  userId: id,
});
export type ExportQuery = z.output<typeof querySchema>;

/** Query-Parameter pruefen: gueltige Daten, from <= to, hoechstens EXPORT_MAX_DAYS Tage. */
export function parseExportQuery(params: URLSearchParams): ExportQuery {
  const read = (key: string) => params.get(key) || undefined;
  const q = querySchema.parse({ from: read("from"), to: read("to"), customerId: read("customerId"), branchId: read("branchId"), userId: read("userId") });
  if (q.to < q.from) throw new ApiError("Das Ende des Zeitraums liegt vor dem Beginn.");
  const days = Math.round((Date.parse(q.to) - Date.parse(q.from)) / 86400000) + 1;
  if (days > EXPORT_MAX_DAYS) throw new ApiError("Der Zeitraum darf höchstens " + EXPORT_MAX_DAYS + " Tage umfassen.");
  return q;
}

const fullName = (u: { firstName: string; lastName: string }) => (u.firstName + " " + u.lastName).trim();
const byName = (x: { firstName: string; lastName: string }, y: { firstName: string; lastName: string }) =>
  x.lastName.localeCompare(y.lastName, "de") || x.firstName.localeCompare(y.firstName, "de");

/** Je Kalenderwoche des Zeitraums die betroffenen Wochentage (1 = Montag), damit die Datenbank nur Treffer liefert. */
function weekWindows(from: string, to: string) {
  const windows = new Map<string, { year: number; weekNumber: number; first: number; last: number }>();
  for (let date = from; date <= to; date = addDate(date, 1)) {
    const { year, weekNumber } = isoWeek(date);
    const dow = ((new Date(date + "T12:00:00Z").getUTCDay() + 6) % 7) + 1;
    const w = windows.get(year + "-" + weekNumber) ?? { year, weekNumber, first: dow, last: dow };
    w.last = dow;
    windows.set(year + "-" + weekNumber, w);
  }
  return [...windows.values()];
}

/**
 * Dienstplan-Auszug fuer das PDF. Sichtbar ist genau das, was GET
 * /api/schedules der Person zeigt (mergedScope, visibleFor, shiftView): keine
 * Namen anderer ohne "Dienstplan ansehen", Entwuerfe nur fuer die Planung.
 * Filter auf nicht sichtbare Kunden, Standorte oder Personen liefern 404.
 */
export async function scheduleExport(tx: Tx, a: Access, q: ExportQuery): Promise<ScheduleExport> {
  const notFound = () => new ApiError("Nicht gefunden.", 404);
  const branch = q.branchId ? await tx.branch.findFirst({ where: { id: q.branchId, organizationId: a.orgId }, select: { id: true, name: true } }) : null;
  if (q.branchId && !branch) throw notFound();
  const customer = q.customerId ? await tx.customer.findFirst({ where: { id: q.customerId, organizationId: a.orgId }, select: { id: true, name: true, branches: { select: { id: true } } } }) : null;
  if (q.customerId && !customer) throw notFound();
  const member = q.userId && a.isAdmin ? await tx.organizationMember.findFirst({ where: { userId: q.userId, organizationId: a.orgId }, select: { user: { select: { firstName: true, lastName: true } } } }) : null;
  if (q.userId && a.isAdmin && !member) throw notFound();

  const where: Prisma.ShiftWhereInput = {
    deletedAt: null,
    schedule: { organizationId: a.orgId, deletedAt: null, ...(q.branchId ? { branchId: q.branchId } : {}), ...(q.customerId ? { branch: { customerId: q.customerId } } : {}) },
    AND: [
      { OR: weekWindows(q.from, q.to).map(w => ({ dayOfWeek: { gte: w.first, lte: w.last }, schedule: { year: w.year, weekNumber: w.weekNumber } })) },
      { OR: mergedScope(a) },
    ],
  };
  if (await tx.shift.count({ where }) > EXPORT_MAX_SHIFTS) throw new ApiError("Zu viele Schichten (mehr als " + EXPORT_MAX_SHIFTS + "). Bitte Zeitraum oder Filter einschränken.");
  const shifts = (await tx.shift.findMany({ where, include: shiftInclude })).filter(visibleFor(a)).filter(s => {
    const date = shiftRange(s).date;
    return date >= q.from && date <= q.to;
  });
  const ineffective = await ineffectiveFor(tx, a, shifts);
  const all = shifts.map(s => shiftView(s, a, ineffective));

  // Sichtbare Personen: nur die, die shiftView in den Buchungen ausgibt.
  const people = new Map<string, { firstName: string; lastName: string }>();
  for (const v of all) for (const b of v.bookings) if (b.userId) people.set(b.userId, b.user);

  // Person ohne Personalsicht: nur wer ohnehin im Plan sichtbar ist (oder man selbst).
  let personName: string | undefined;
  if (q.userId) {
    const own = q.userId === a.userId ? a.member.user : null;
    const known = member?.user ?? own ?? people.get(q.userId);
    if (!known) throw notFound();
    personName = fullName(known);
  }
  const views = q.userId ? all.filter(v => v.bookings.some(b => b.userId === q.userId)) : all;

  // Filter auf Standort/Kunde ohne eigene Freigabe zeigt nur, was ohnehin sichtbar ist - ohne Treffer: nicht gefunden.
  const granted = (ids: string[]) => a.isAdmin || ids.some(x => a.branches.has(x));
  if (branch && !granted([branch.id]) && !views.length) throw notFound();
  if (customer && !granted(customer.branches.map(x => x.id)) && !views.length) throw notFound();

  const rows: ScheduleExportRow[] = views.map(v => ({
    date: v.date,
    weekday: WEEKDAYS[v.dayOfWeek - 1] ?? "",
    shiftFrom: v.shiftFrom,
    shiftTo: v.shiftTo,
    endsNextDay: v.endsNextDay,
    title: v.title?.trim() || v.division?.title || "",
    branch: v.branch?.name ?? "Ohne Standort",
    customer: v.branch?.customer?.name ?? "",
    assigned: [...v.bookings].sort((x, y) => byName(x.user, y.user)).map(b => fullName(b.user) + (b.former ? " (gelöscht)" : "")),
    open: v.missing,
    places: v.maxEmployees,
    occupied: v.occupiedCount,
    isPublic: v.isPublic,
  })).sort((x, y) => x.date.localeCompare(y.date) || x.shiftFrom.localeCompare(y.shiftFrom) || x.branch.localeCompare(y.branch, "de") || x.title.localeCompare(y.title, "de"));

  const customers = new Map<string, string>(), branches = new Map<string, { id: string; name: string; customerId: string | null }>();
  for (const v of all) {
    if (!v.branch) continue;
    branches.set(v.branch.id, { id: v.branch.id, name: v.branch.name, customerId: v.branch.customer?.id ?? null });
    if (v.branch.customer) customers.set(v.branch.customer.id, v.branch.customer.name);
  }
  return {
    period: { from: q.from, to: q.to },
    filters: { ...(customer ? { customer: customer.name } : {}), ...(branch ? { branch: branch.name } : {}), ...(personName ? { person: personName } : {}) },
    generatedAt: new Date().toISOString(),
    people: [...people].map(([userId, u]) => ({ userId, name: fullName(u), u })).sort((x, y) => byName(x.u, y.u)).map(({ userId, name }) => ({ userId, name })),
    customers: [...customers].map(([cid, name]) => ({ id: cid, name })).sort((x, y) => x.name.localeCompare(y.name, "de")),
    branches: [...branches.values()].sort((x, y) => x.name.localeCompare(y.name, "de")),
    rows,
  };
}
