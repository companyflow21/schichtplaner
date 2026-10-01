import type { Prisma } from "@prisma/client";
import { db } from "./db";
import { ApiError } from "./errors";
import { berlinDate, recordMinutes, weekDate, rangeMinutes, isoWeek, addDate } from "./berlin";
import { branchIds, can, staffIds, type Access } from "./access";

/**
 * Monatsauswertung. Eigene Werte sieht jede Person; fremde Werte nur, wer
 * die Person mit "Stunden einsehen" zugeordnet hat - und dann nur fuer
 * Standorte mit "Zeiterfassung einsehen". Sollstunden gelten
 * standortuebergreifend und erscheinen fuer andere Personen nur bei Admins.
 * Sollstunden sind Monatswerte: targetStatus "hidden" (nicht sichtbar),
 * "unset" (nicht festgelegt) oder "set"; aus fehlenden Werten wird kein Soll
 * und keine Abweichung berechnet.
 * Mit branchId wird auf einen Standort eingeschraenkt.
 * Mit includeFormer sehen Admins zusaetzlich je geloeschter Person (Momentaufnahme,
 * nur Name) eine Zeile mit den historischen Plan- und Iststunden (former: true,
 * ohne Sollstunden); Manager sehen weiterhin nur ihre zugeordneten Personen.
 */
export async function monthlyReport(a: Access, month: number, year: number, options: { branchId?: string | null; selfOnly?: boolean; includeFormer?: boolean } = {}) {
  const first = year + "-" + String(month).padStart(2, "0") + "-01";
  const last = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
  const branch = options.branchId ?? null;
  if (branch && !can(a, "VIEW_TIME", branch)) throw new ApiError("Nicht gefunden.", 404);
  const timeBranches = branchIds(a, "VIEW_TIME");
  const managed = options.selfOnly ? [] : staffIds(a, "VIEW_HOURS");
  const others = managed === null ? null : timeBranches && timeBranches.length ? managed.filter((id) => id !== a.userId) : [];
  const allowedBranches = branch ? [branch] : timeBranches;

  const people = await db.organizationMember.findMany({
    where: { organizationId: a.orgId, ...(others === null ? {} : { userId: { in: [a.userId, ...others] } }) },
    include: { user: { select: { id: true, firstName: true, lastName: true, profileImage: true } } },
  });
  // Eigene Werte vollstaendig, fremde nur an freigegebenen Standorten.
  const recordScope: Prisma.TimeRecordWhereInput = others === null
    ? (branch ? { branchId: branch } : {})
    : { OR: [{ userId: a.userId, ...(branch ? { branchId: branch } : {}) }, { userId: { in: others }, branchId: { in: allowedBranches ?? [] } }] };
  const bookingScope: Prisma.BookingWhereInput = others === null
    ? (branch ? { shift: { schedule: { branchId: branch } } } : {})
    : { OR: [{ userId: a.userId, ...(branch ? { shift: { schedule: { branchId: branch } } } : {}) }, { userId: { in: others }, shift: { schedule: { branchId: { in: allowedBranches ?? [] } } } }] };

  const [records, bookings] = await Promise.all([
    db.timeRecord.findMany({ where: { AND: [{ organizationId: a.orgId, userId: { in: people.map((p) => p.userId) }, date: { gte: new Date(first), lte: new Date(last) } }, recordScope] } }),
    db.booking.findMany({
      where: { AND: [{ userId: { in: people.map((p) => p.userId) }, shift: { deletedAt: null, schedule: { organizationId: a.orgId, deletedAt: null, isPublic: true, year: { gte: year - 1, lte: year + 1 } } } }, bookingScope] },
      include: { shift: { include: { schedule: true } } },
    }),
  ]);
  const weeks = new Map<number, { weekNumber: number; label: string }>();
  for (let d = first; d <= last; d = addDate(d, 1)) {
    const week = isoWeek(d);
    weeks.set(week.weekNumber, { weekNumber: week.weekNumber, label: "KW " + week.weekNumber });
  }
  // Plan- und Iststunden einer Person aus ihren Zeitbuchungen und Zuweisungen des Monats.
  const hours = (own: typeof records, assigned: typeof bookings) => {
    const shifts = assigned.filter((b) => { const d = weekDate(b.shift.schedule.year, b.shift.schedule.weekNumber, b.shift.dayOfWeek); return d >= first && d <= last; });
    const totalMinutes = own.reduce((sum, r) => sum + recordMinutes(r), 0);
    const plannedMinutes = shifts.reduce((sum, b) => { const s = b.shift, gross = rangeMinutes(s.shiftFrom, s.shiftTo); return sum + Math.max(0, gross - (s.pauseOption === "PER_HOUR" ? Math.floor(gross / 60) * s.pauseValue : s.pauseValue)); }, 0);
    return {
      totalMinutes, plannedMinutes, deviationMinutes: totalMinutes - plannedMinutes, shiftCount: shifts.length,
      kwBreakdown: [...weeks.values()].map((w) => ({ weekNumber: w.weekNumber, totalMinutes: own.filter((r) => isoWeek(r.date.toISOString().slice(0, 10)).weekNumber === w.weekNumber).reduce((sum, r) => sum + recordMinutes(r), 0), shiftCount: shifts.filter((b) => b.shift.schedule.weekNumber === w.weekNumber).length })),
    };
  };
  const employees = people.map((p) => {
    const showTarget = !branch && (a.isAdmin || p.userId === a.userId);
    const targetStatus: "hidden" | "unset" | "set" = !showTarget ? "hidden" : p.targetHoursPerMonth === null ? "unset" : "set";
    const targetMinutes = targetStatus === "set" ? Math.round(p.targetHoursPerMonth! * 60) : null;
    return {
      /** Stabiler Schluessel je Zeile (Personen mit Konto: userId; geloeschte: "former:" + Id). */
      key: p.userId, userId: p.userId as string | null, former: false, firstName: p.user.firstName, lastName: p.user.lastName, profileImage: p.user.profileImage as string | null, targetMinutes, targetStatus,
      ...hours(records.filter((t) => t.userId === p.userId), bookings.filter((b) => b.userId === p.userId)),
    };
  });
  // Geloeschte Personen (Momentaufnahme): nur fuer Admins, ohne Sollstunden.
  if (a.isAdmin && options.includeFormer && !options.selfOnly) {
    const [formerRecords, formerBookings] = await Promise.all([
      db.timeRecord.findMany({ where: { organizationId: a.orgId, formerEmployeeId: { not: null }, date: { gte: new Date(first), lte: new Date(last) }, ...(branch ? { branchId: branch } : {}) }, include: { formerEmployee: true } }),
      db.booking.findMany({
        where: { formerEmployeeId: { not: null }, shift: { deletedAt: null, schedule: { organizationId: a.orgId, deletedAt: null, isPublic: true, year: { gte: year - 1, lte: year + 1 }, ...(branch ? { branchId: branch } : {}) } } },
        include: { shift: { include: { schedule: true } }, formerEmployee: true },
      }),
    ]);
    const former = new Map<string, { firstName: string; lastName: string }>();
    for (const row of [...formerRecords, ...formerBookings]) if (row.formerEmployee) former.set(row.formerEmployee.id, row.formerEmployee);
    for (const [id, name] of former) {
      const own = formerRecords.filter((t) => t.formerEmployeeId === id), figures = hours(own, formerBookings.filter((b) => b.formerEmployeeId === id));
      // Nur Personen mit Buchungen oder Schichten in diesem Monat.
      if (!own.length && !figures.shiftCount) continue;
      employees.push({
        key: "former:" + id, userId: null, former: true, firstName: name.firstName, lastName: name.lastName, profileImage: null, targetMinutes: null as number | null, targetStatus: "hidden" as "hidden" | "unset" | "set",
        ...figures,
      });
    }
  }
  employees.sort((x, y) => x.lastName.localeCompare(y.lastName, "de"));
  return { month, year, branchId: branch, kwHeaders: [...weeks.values()], employees, totals: { totalMinutes: employees.reduce((s, e) => s + e.totalMinutes, 0), totalShifts: employees.reduce((s, e) => s + e.shiftCount, 0) } };
}

export function reportPeriod(request: Request) {
  const q = new URL(request.url).searchParams, today = berlinDate();
  return { month: Number(q.get("month") || today.slice(5, 7)), year: Number(q.get("year") || today.slice(0, 4)), branchId: q.get("standort") || null };
}
