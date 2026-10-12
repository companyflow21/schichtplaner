import type { Prisma } from "@prisma/client";
import { ApiError } from "./errors";
import { addDate, isoWeek, plannedMinutes, shiftRange, weekDate } from "./berlin";
import { can, type Access } from "./access";
import { anyEnabled, effectiveRules, readRules, ruleViolations, type PartialRules, type Violation } from "./planning-rules";

type Tx = Prisma.TransactionClient;

/** Allgemeine Regeln und Abweichungen je Mitglied (memberId). */
export async function ruleSettings(tx: Tx, orgId: string) {
  const [general, overrides] = await Promise.all([
    tx.planningRules.findUnique({ where: { organizationId: orgId } }),
    tx.planningRuleOverride.findMany({ where: { organizationId: orgId } }),
  ]);
  return { general: readRules(general?.rules), overrides: new Map<string, PartialRules>(overrides.map((o) => [o.memberId, readRules(o.rules)])) };
}

export type PersonViolations = { userId: string; firstName: string; lastName: string; violations: Violation[] };

/**
 * Verstoesse der Woche eines Plans fuer alle dort eingeteilten Personen -
 * nur fuer die Planung (Admins, Manager mit "Dienstplan ansehen" am Standort).
 */
export async function scheduleViolations(tx: Tx, a: Access, scheduleId: string) {
  const schedule = await tx.schedule.findFirst({
    where: { id: scheduleId, organizationId: a.orgId, deletedAt: null },
    select: { branchId: true, year: true, weekNumber: true, shifts: { where: { deletedAt: null }, select: { id: true, bookings: { select: { userId: true } } } } },
  });
  if (!schedule || !can(a, "VIEW_SCHEDULE", schedule.branchId) || !(a.isAdmin || a.role === "MANAGER")) throw new ApiError("Nicht gefunden.", 404);
  const userIds = [...new Set(schedule.shifts.flatMap((s) => s.bookings.map((b) => b.userId)))];
  return violationsForWeek(tx, a.orgId, schedule, userIds, new Set(schedule.shifts.map((s) => s.id)));
}

/**
 * Verstoesse von Personen in einer Kalenderwoche. Gemeldet wird, was in der
 * Woche liegt oder eine der "relevant"-Schichten betrifft. Gezaehlt werden
 * alle Schichten der Person (alle Standorte, auch Entwuerfe), ohne Tage mit
 * genehmigter Abwesenheit.
 */
export async function violationsForWeek(tx: Tx, orgId: string, week: { year: number; weekNumber: number }, userIds: string[], relevant: Set<string>) {
  const from = weekDate(week.year, week.weekNumber), to = addDate(from, 6);
  const { general, overrides } = await ruleSettings(tx, orgId);
  const enabled = anyEnabled(effectiveRules(general)) || [...overrides.values()].some((o) => anyEnabled(effectiveRules({}, o)));
  const members = userIds.length && enabled ? await tx.organizationMember.findMany({
    where: { organizationId: orgId, userId: { in: userIds }, isActive: true },
    select: { id: true, userId: true, user: { select: { firstName: true, lastName: true } } },
  }) : [];
  const people = members.map((m) => ({ ...m, rules: effectiveRules(general, overrides.get(m.id)) })).filter((p) => anyEnabled(p.rules));
  if (!people.length) return { enabled, count: 0, people: [] as PersonViolations[] };

  // Folgen brauchen Vor- und Nachlauf, Monatssummen den ganzen Monat.
  const context = Math.max(35, ...people.map((p) => 7 * (p.rules.consecutiveWeekends.max + 2)), ...people.map((p) => p.rules.consecutiveDays.max + 2));
  let start = addDate(from, -context), end = addDate(to, context);
  if (people.some((p) => p.rules.hours.enabled && p.rules.hours.period === "MONTH")) {
    const monthStart = from.slice(0, 8) + "01", monthEnd = addDate(addDate(to.slice(0, 8) + "01", 32).slice(0, 8) + "01", -1);
    if (monthStart < start) start = monthStart;
    if (monthEnd > end) end = monthEnd;
  }
  const weeks = new Map<string, { year: number; weekNumber: number }>();
  for (let d = addDate(start, -1); d <= end; d = addDate(d, 1)) { const w = isoWeek(d); weeks.set(w.year + "-" + w.weekNumber, w); }
  const [bookings, absences] = await Promise.all([
    tx.booking.findMany({
      where: { userId: { in: people.map((p) => p.userId) }, shift: { deletedAt: null, schedule: { organizationId: orgId, deletedAt: null, OR: [...weeks.values()] } } },
      select: { userId: true, shift: { select: { id: true, dayOfWeek: true, shiftFrom: true, shiftTo: true, pauseOption: true, pauseValue: true, schedule: { select: { year: true, weekNumber: true } } } } },
    }),
    tx.absence.findMany({
      where: { userId: { in: people.map((p) => p.userId) }, status: "APPROVED", category: { organizationId: orgId }, dateFrom: { lte: new Date(end) }, dateTo: { gte: new Date(start) } },
      select: { userId: true, dateFrom: true, dateTo: true },
    }),
  ]);
  const result: PersonViolations[] = [];
  for (const p of people) {
    const away = absences.filter((x) => x.userId === p.userId).map((x) => ({ from: x.dateFrom.toISOString().slice(0, 10), to: x.dateTo.toISOString().slice(0, 10) }));
    const shifts = bookings.filter((b) => b.userId === p.userId).map((b) => {
      const range = shiftRange(b.shift);
      return { id: b.shift.id, date: range.date, start: range.start, end: range.end, minutes: plannedMinutes(b.shift) };
    }).filter((s) => s.date >= start && s.date <= end && !away.some((x) => x.from <= s.date && x.to >= s.date));
    const violations = ruleViolations(p.rules, shifts, { from, to }).filter((v) => (v.date >= from && v.date <= to) || v.shiftIds.some((id) => relevant.has(id)));
    if (violations.length) result.push({ userId: p.userId, firstName: p.user.firstName, lastName: p.user.lastName, violations });
  }
  result.sort((x, y) => x.lastName.localeCompare(y.lastName, "de") || x.firstName.localeCompare(y.firstName, "de"));
  return { enabled, count: result.reduce((sum, p) => sum + p.violations.length, 0), people: result };
}
