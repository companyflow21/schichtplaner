import type { Prisma } from "@prisma/client";
import { addDate, isoWeek, shiftRange, weekDate } from "./berlin";
import { can, type Access } from "./access";
import { wallToUtcMinutes } from "./checkin";
import { formatName } from "./names";
import { plannedMinutes } from "./planning";
import { anyEnabled, effectiveRules, readRules, ruleViolations, type PartialRules, type PersonViolations, type ViolationReport } from "./planning-rules";

type Tx = Prisma.TransactionClient;

/** Allgemeine Regeln und Abweichungen je Mitglied (memberId). */
export async function ruleSettings(tx: Tx, orgId: string) {
  const [general, overrides] = await Promise.all([
    tx.planningRules.findUnique({ where: { organizationId: orgId } }),
    tx.planningRuleOverride.findMany({ where: { organizationId: orgId } }),
  ]);
  return { general: readRules(general?.rules), overrides: new Map<string, PartialRules>(overrides.map((o) => [o.memberId, readRules(o.rules)])) };
}

/**
 * Verstoesse in der Woche eines Plans fuer alle dort eingeteilten Personen.
 * Die Rechte (nur Planung) prueft die Route. Gezaehlt werden alle Schichten
 * einer Person (alle Standorte, auch Entwuerfe), ohne Tage mit genehmigter
 * Abwesenheit; nur Zuweisungen mit Konto (userId) - Subunternehmer-
 * Platzhalter und Zuweisungen geloeschter Personen nie. Schichten an
 * Standorten, deren Dienstplan die betrachtende Person nicht sehen darf,
 * zaehlen mit, werden aber nicht benannt (keine Schicht-ID, nur "an einem
 * anderen Standort"); Verstoesse, an denen nur solche Schichten beteiligt
 * sind, entfallen fuer sie. Gemeldet wird, was in der Woche liegt oder eine
 * Schicht dieses Plans betrifft.
 */
export async function scheduleViolations(tx: Tx, a: Access, schedule: { year: number; weekNumber: number; shifts: { id: string; bookings: { userId: string | null }[] }[] }): Promise<ViolationReport> {
  const userIds = [...new Set(schedule.shifts.flatMap((s) => s.bookings.flatMap((b) => (b.userId ? [b.userId] : []))))];
  const relevant = new Set(schedule.shifts.map((s) => s.id));
  const from = weekDate(schedule.year, schedule.weekNumber), to = addDate(from, 6);
  const { general, overrides } = await ruleSettings(tx, a.orgId);
  const enabled = anyEnabled(effectiveRules(general)) || [...overrides.values()].some((o) => anyEnabled(effectiveRules({}, o)));
  const members = userIds.length && enabled ? await tx.organizationMember.findMany({
    where: { organizationId: a.orgId, userId: { in: userIds }, isActive: true },
    select: { id: true, userId: true, user: { select: { firstName: true, lastName: true } } },
  }) : [];
  const people = members.map((m) => ({ ...m, rules: effectiveRules(general, overrides.get(m.id)) })).filter((p) => anyEnabled(p.rules));
  if (!people.length) return { enabled, count: 0, people: [] };

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
      where: { userId: { in: people.map((p) => p.userId) }, shift: { deletedAt: null, schedule: { organizationId: a.orgId, deletedAt: null, OR: [...weeks.values()] } } },
      select: { userId: true, shift: { select: { id: true, dayOfWeek: true, shiftFrom: true, shiftTo: true, pauseOption: true, pauseValue: true, schedule: { select: { year: true, weekNumber: true, branchId: true } } } } },
    }),
    tx.absence.findMany({
      where: { userId: { in: people.map((p) => p.userId) }, status: "APPROVED", category: { organizationId: a.orgId }, dateFrom: { lte: new Date(end) }, dateTo: { gte: new Date(start) } },
      select: { userId: true, dateFrom: true, dateTo: true },
    }),
  ]);
  const result: PersonViolations[] = [];
  for (const p of people) {
    const away = absences.filter((x) => x.userId === p.userId).map((x) => ({ from: x.dateFrom.toISOString().slice(0, 10), to: x.dateTo.toISOString().slice(0, 10) }));
    const shifts = bookings.filter((b) => b.userId === p.userId).map((b) => {
      // Echte Minuten (Europe/Berlin): die Ruhezeit stimmt auch in Naechten der Zeitumstellung.
      const range = shiftRange(b.shift);
      return {
        id: b.shift.id, date: range.date, start: wallToUtcMinutes(range.start), end: wallToUtcMinutes(range.end), minutes: plannedMinutes(b.shift),
        from: b.shift.shiftFrom, elsewhere: !can(a, "VIEW_SCHEDULE", b.shift.schedule.branchId),
      };
    }).filter((s) => s.date >= start && s.date <= end && !away.some((x) => x.from <= s.date && x.to >= s.date));
    const violations = ruleViolations(p.rules, shifts, { from, to })
      .filter((v) => (v.date >= from && v.date <= to) || v.shiftIds.some((id) => relevant.has(id)))
      .filter((v) => !(v.elsewhere && !v.shiftIds.length));
    if (violations.length) result.push({ userId: p.userId, name: formatName(p.user, a.member.organization.nameFormat), violations });
  }
  result.sort((x, y) => x.name.localeCompare(y.name, "de"));
  return { enabled, count: result.reduce((sum, p) => sum + p.violations.length, 0), people: result };
}
