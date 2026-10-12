import type { Prisma } from "@prisma/client";
import { db } from "./db";
import { ApiError } from "./errors";
import { addDate, isoWeek, minuteOfDay, overlaps, rangeMinutes, shiftRange, validDate } from "./berlin";
import { requireAdmin, type Access } from "./access";
import { effectivePayType, payForAbsence, payForRecord, sumLines, type PayTypeLite, type RecordPay, type SurchargeLite } from "./payroll";
import { paidAbsenceShifts } from "./absence-effects";

/** Zeitraum aus ?from=&to= (YYYY-MM-DD), sonst ?month=&year=, sonst aktueller Monat. */
export function payrollPeriod(request: Request, today: string) {
  const q = new URL(request.url).searchParams;
  let from = q.get("from") ?? "", to = q.get("to") ?? "";
  if (!from || !to) {
    const year = Number(q.get("year") || today.slice(0, 4)), month = Number(q.get("month") || today.slice(5, 7));
    if (!Number.isInteger(month) || month < 1 || month > 12 || !Number.isInteger(year) || year < 2000 || year > 2100) throw new ApiError("Ungültiger Monat.");
    from = year + "-" + String(month).padStart(2, "0") + "-01";
    to = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
  }
  if (!validDate(from) || !validDate(to) || from > to) throw new ApiError("Ungültiger Zeitraum.");
  if (Date.parse(to) - Date.parse(from) > 400 * 86400000) throw new ApiError("Der Zeitraum ist zu lang (höchstens 400 Tage).");
  return { from, to, branchId: q.get("standort") || null };
}

type RecordRow = Prisma.TimeRecordGetPayload<{ include: { branch: { select: { name: true } }; checkin: { select: { shiftId: true } } } }>;

/**
 * Arbeitsbereich je Buchung: ueber die gespeicherte Schicht (bzw. den
 * Check-in), sonst die einzige veroeffentlichte Schicht der Person, mit der
 * sich die Buchung zeitlich ueberschneidet (Altbestand, Regel wie
 * branchForTime). Mehrdeutig oder ohne Schicht: kein Arbeitsbereich.
 */
async function divisionsFor(orgId: string, records: RecordRow[], from: string, to: string): Promise<Map<string, string | null>> {
  const result = new Map<string, string | null>();
  if (!records.length) return result;
  const weeks = new Map<string, { year: number; weekNumber: number }>();
  for (let d = addDate(from, -1); d <= addDate(to, 1); d = addDate(d, 7)) { const w = isoWeek(d); weeks.set(w.year + "-" + w.weekNumber, w); }
  const last = isoWeek(addDate(to, 1)); weeks.set(last.year + "-" + last.weekNumber, last);
  const userIds = [...new Set(records.map((r) => r.userId))];
  const [bookings, checkinShifts] = await Promise.all([
    db.booking.findMany({
      where: { userId: { in: userIds }, shift: { deletedAt: null, schedule: { organizationId: orgId, deletedAt: null, isPublic: true, OR: [...weeks.values()] } } },
      select: { userId: true, shift: { select: { id: true, divisionId: true, dayOfWeek: true, shiftFrom: true, shiftTo: true, schedule: { select: { year: true, weekNumber: true } } } } },
    }),
    db.shift.findMany({ where: { id: { in: records.flatMap((r) => [r.shiftId, r.checkin?.shiftId].filter((id): id is string => !!id)) }, schedule: { organizationId: orgId } }, select: { id: true, divisionId: true } }),
  ]);
  const byShift = new Map(checkinShifts.map((s) => [s.id, s.divisionId]));
  for (const r of records) {
    const known = [r.shiftId, r.checkin?.shiftId].find((id) => id && byShift.has(id));
    if (known) { result.set(r.id, byShift.get(known) ?? null); continue; }
    const date = r.date.toISOString().slice(0, 10);
    const start = Date.parse(date + "T00:00:00Z") / 60000 + (r.timeFrom ? minuteOfDay(r.timeFrom) : 0);
    const span = r.timeFrom ? { start, end: start + (r.timeTo ? rangeMinutes(r.timeFrom, r.timeTo) || 1440 : 1) } : null;
    const hits = new Set<string>();
    const areas = new Map<string, string | null>();
    for (const b of bookings) {
      if (b.userId !== r.userId) continue;
      const range = shiftRange(b.shift);
      if (span ? overlaps(span, range) : range.date === date) { hits.add(b.shift.id); areas.set(b.shift.id, b.shift.divisionId); }
    }
    result.set(r.id, hits.size === 1 ? areas.get([...hits][0]) ?? null : null);
  }
  return result;
}

export type PayrollPerson = Awaited<ReturnType<typeof payrollReport>>["people"][number];

/**
 * Lohn je Person fuer einen Zeitraum aus den Zeitbuchungen (nach Buchungsdatum,
 * wie die Monatsauswertung). Nur fuer die Administration: Lohndaten gibt es
 * fuer Manager nicht.
 */
export async function payrollReport(a: Access, from: string, to: string, branchId: string | null) {
  requireAdmin(a);
  if (branchId && !await db.branch.findFirst({ where: { id: branchId, organizationId: a.orgId } })) throw new ApiError("Nicht gefunden.", 404);
  return payrollData(a.orgId, from, to, branchId);
}

/**
 * Rechnung ohne Rechtepruefung - nur fuer Aufrufer, die selbst pruefen und
 * hoechstens Stunden weitergeben (Stundenzettel: Zuschlagsstunden ohne Betraege).
 */
export async function payrollData(orgId: string, from: string, to: string, branchId: string | null) {
  const a = { orgId };
  const [members, payTypes, surcharges, holidays, records] = await Promise.all([
    db.organizationMember.findMany({ where: { organizationId: a.orgId }, select: { id: true, userId: true, isActive: true, personnelNumber: true, payTypeId: true, user: { select: { firstName: true, lastName: true } } } }),
    db.payType.findMany({ where: { organizationId: a.orgId } }),
    db.surcharge.findMany({ where: { organizationId: a.orgId, isActive: true } }),
    db.holiday.findMany({ where: { organizationId: a.orgId, date: { gte: new Date(addDate(from, -1)), lte: new Date(addDate(to, 1)) } }, select: { date: true } }),
    db.timeRecord.findMany({
      where: { organizationId: a.orgId, date: { gte: new Date(from), lte: new Date(to) }, NOT: { type: "WATCH", timeTo: null }, ...(branchId ? { branchId } : {}) },
      include: { branch: { select: { name: true } }, checkin: { select: { shiftId: true } } },
      orderBy: [{ date: "asc" }, { timeFrom: "asc" }],
    }),
  ]);
  const divisions = await db.division.findMany({ where: { organizationId: a.orgId }, select: { id: true, title: true, payTypeId: true } });
  const typeById = new Map<string, PayTypeLite>(payTypes.map((p) => [p.id, p]));
  const divisionById = new Map(divisions.map((d) => [d.id, d]));
  const holidaySet = new Set(holidays.map((h) => h.date.toISOString().slice(0, 10)));
  const recordDivision = await divisionsFor(a.orgId, records, from, to);
  const lite = surcharges as SurchargeLite[];
  // Bezahlte Abwesenheit nur fuer Schichten, fuer die keine Zeit erfasst wurde (sonst doppelt bezahlt).
  const worked = new Set(records.flatMap((r) => [r.shiftId, r.checkin?.shiftId]).filter((id): id is string => !!id));
  const absences = (await paidAbsenceShifts(a.orgId, members.map((m) => m.userId), from, to)).filter((x) => (!branchId || x.branchId === branchId) && !worked.has(x.shiftId));

  const people = members
    .map((m) => {
      const own = records.filter((r) => r.userId === m.userId);
      const pays: (RecordPay & { record: RecordRow; divisionTitle: string | null })[] = own.map((r) => {
        const divisionId = recordDivision.get(r.id) ?? null, division = divisionId ? divisionById.get(divisionId) : undefined;
        const pay = payForRecord(r, { payType: effectivePayType(typeById, division?.payTypeId, m.payTypeId), divisionId, surcharges: lite, holidays: holidaySet });
        return { ...pay, record: r, divisionTitle: division?.title ?? null };
      });
      const absent = absences.filter((x) => x.userId === m.userId).map((x) => {
        const division = x.divisionId ? divisionById.get(x.divisionId) : undefined;
        return { ...payForAbsence(x, effectivePayType(typeById, division?.payTypeId, m.payTypeId)), absence: x, divisionTitle: division?.title ?? null };
      });
      const all: RecordPay[] = [...pays, ...absent];
      const warnings = [...new Set([...all.flatMap((p) => p.warnings), ...(all.length && !m.personnelNumber ? ["Keine Personalnummer."] : [])])];
      return {
        userId: m.userId, memberId: m.id, firstName: m.user.firstName, lastName: m.user.lastName, isActive: m.isActive,
        personnelNumber: m.personnelNumber, payType: m.payTypeId ? typeById.get(m.payTypeId) ?? null : null,
        minutes: all.reduce((s, p) => s + p.minutes, 0), totalCents: all.reduce((s, p) => s + p.totalCents, 0),
        lines: sumLines(all), warnings,
        records: [
          ...pays.map((p) => ({
            id: p.recordId, date: p.record.date.toISOString().slice(0, 10), type: p.record.type as string, timeFrom: p.record.timeFrom, timeTo: p.record.timeTo,
            breakMinutes: Math.round(p.record.breakSeconds / 60), branchName: p.record.branch?.name ?? null, divisionTitle: p.divisionTitle,
            minutes: p.minutes, totalCents: p.totalCents, lines: p.lines, warnings: p.warnings,
          })),
          ...absent.map((p) => ({
            id: p.recordId, date: p.absence.date, type: "ABSENCE", timeFrom: p.absence.from, timeTo: p.absence.to, breakMinutes: 0, branchName: null, divisionTitle: p.divisionTitle,
            minutes: p.minutes, totalCents: p.totalCents, lines: p.lines, warnings: p.warnings,
          })),
        ].sort((x, y) => x.date.localeCompare(y.date) || (x.timeFrom ?? "").localeCompare(y.timeFrom ?? "")),
      };
    })
    .filter((p) => p.isActive || p.records.length)
    .sort((x, y) => x.lastName.localeCompare(y.lastName, "de") || x.firstName.localeCompare(y.firstName, "de"));
  return {
    from, to, branchId, people,
    totals: { minutes: people.reduce((s, p) => s + p.minutes, 0), totalCents: people.reduce((s, p) => s + p.totalCents, 0) },
    setup: { payTypes: payTypes.filter((p) => p.isActive).length, surcharges: surcharges.length },
  };
}
