import type { Prisma } from "@prisma/client";
import { db } from "./db";
import { ApiError } from "./errors";
import { berlinDate, plannedMinutes, rangeMinutes, recordMinutes, shiftRange, addDate, isoWeek } from "./berlin";
import { branchIds, can, canSeeTime, canStaff, staffIds, timeScope, type Access } from "./access";
import { recordOverlaps } from "./time-service";
import { payrollReport } from "./payroll-service";
import { balancesFor } from "./time-account-service";
import { absenceEffects } from "./absence-effects";
import type { PayLine } from "./payroll";

export type HoursStatus = "APPROVED" | "OPEN" | "MISSING" | "PLANNED" | "RUNNING" | "ABSENT";


/**
 * Stunden pruefen: je Person die geplanten Schichten im Zeitraum mit den
 * zugehoerigen Buchungen (Plan/Ist/Status) sowie Buchungen ohne Schicht.
 * Sichtbarkeit wie die Monatsauswertung: eigene immer; fremde nur mit
 * "Stunden einsehen" fuer die Person und "Zeiterfassung einsehen" am Standort.
 * Lohn nur fuer die Administration.
 */
export async function hoursReport(a: Access, from: string, to: string, branchId: string | null, options: { userId?: string } = {}) {
  if (branchId && !can(a, "VIEW_TIME", branchId)) throw new ApiError("Nicht gefunden.", 404);
  if (branchId && !await db.branch.findFirst({ where: { id: branchId, organizationId: a.orgId }, select: { id: true } })) throw new ApiError("Nicht gefunden.", 404);
  const timeBranches = branchIds(a, "VIEW_TIME");
  const managed = staffIds(a, "VIEW_HOURS");
  const others = managed === null ? null : timeBranches && timeBranches.length ? managed.filter((id) => id !== a.userId) : [];
  const allowedBranches = branchId ? [branchId] : timeBranches;
  const people = await db.organizationMember.findMany({
    where: { organizationId: a.orgId, AND: [others === null ? {} : { userId: { in: [a.userId, ...others] } }, options.userId ? { userId: options.userId } : {}] },
    select: { userId: true, isActive: true, personnelNumber: true, user: { select: { firstName: true, lastName: true } } },
  });
  const userIds = people.map((p) => p.userId);
  const weeks = new Map<string, { year: number; weekNumber: number }>();
  for (let d = addDate(from, -1); d <= to; d = addDate(d, 1)) { const w = isoWeek(d); weeks.set(w.year + "-" + w.weekNumber, w); }
  const bookingScope: Prisma.BookingWhereInput = others === null
    ? (branchId ? { shift: { schedule: { branchId } } } : {})
    : { OR: [{ userId: a.userId, ...(branchId ? { shift: { schedule: { branchId } } } : {}) }, { userId: { in: others }, shift: { schedule: { branchId: { in: allowedBranches ?? [] } } } }] };
  const [records, bookings] = await Promise.all([
    db.timeRecord.findMany({
      where: { AND: [timeScope(a, "view"), { userId: { in: userIds }, date: { gte: new Date(from), lte: new Date(to) } }, ...(branchId ? [{ branchId }] : [])] },
      include: { branch: { select: { name: true } }, category: { select: { id: true, name: true } }, checkin: { select: { method: true, status: true, lateMinutes: true, distanceM: true } }, corrections: { where: { status: "PENDING" }, select: { id: true } } },
      orderBy: [{ date: "asc" }, { timeFrom: "asc" }],
    }),
    db.booking.findMany({
      where: { AND: [{ userId: { in: userIds }, shift: { deletedAt: null, schedule: { organizationId: a.orgId, deletedAt: null, isPublic: true, OR: [...weeks.values()] } } }, bookingScope] },
      include: { shift: { include: { schedule: { include: { branch: { select: { name: true, customer: { select: { name: true } } } } } }, division: { select: { title: true, color: true } } } } },
    }),
  ]);
  const pay = new Map<string, { totalCents: number; lines: PayLine[]; warnings: string[] }>();
  if (a.isAdmin) {
    const report = await payrollReport(a, from, to, branchId);
    for (const p of report.people) for (const r of p.records) pay.set(r.id, { totalCents: r.totalCents, lines: r.lines, warnings: r.warnings });
  }
  const today = berlinDate();
  const effects = await absenceEffects(a.orgId, userIds, from, to);

  const result = people.map((p) => {
    const shifts = bookings.filter((b) => b.userId === p.userId).map((b) => ({ ...b.shift, range: shiftRange(b.shift) })).filter((s) => s.range.date >= from && s.range.date <= to);
    const own = records.filter((r) => r.userId === p.userId);
    const byShift = new Map<string, typeof own>();
    const loose: typeof own = [];
    for (const r of own) {
      const span = { date: r.date.toISOString().slice(0, 10), timeFrom: r.timeFrom, timeTo: r.timeTo };
      const linked = r.shiftId && shifts.some((s) => s.id === r.shiftId) ? r.shiftId : null;
      const inferred = linked ?? (() => { const hits = shifts.filter((s) => recordOverlaps(span, s.range)); return hits.length === 1 ? hits[0].id : null; })();
      if (inferred) byShift.set(inferred, [...(byShift.get(inferred) ?? []), r]); else loose.push(r);
    }
    const recordView = (r: (typeof own)[number]) => {
      const running = r.type === "WATCH" && !r.timeTo;
      const reviewer = canSeeTime(a, r, "edit") && (r.userId !== a.userId || a.isAdmin);
      return {
        id: r.id, userId: r.userId, category: r.category, type: r.type, date: r.date.toISOString().slice(0, 10), timeFrom: r.timeFrom, timeTo: r.timeTo, durationHours: r.durationHours, durationMinutes: r.durationMinutes,
        breakSeconds: r.breakSeconds, categoryId: r.categoryId, comment: r.comment, branchName: r.branch?.name ?? null,
        minutes: running ? 0 : recordMinutes(r), running, approved: !!r.approvedAt, approvedAt: r.approvedAt, pendingCorrection: r.corrections.length > 0,
        checkin: r.checkin, canEdit: reviewer && !running, canApprove: reviewer && !running, pay: pay.get(r.id) ?? null,
      };
    };
    type RecordView = ReturnType<typeof recordView>;
    const status = (list: RecordView[], date: string | null): HoursStatus =>
      list.some((r) => r.running) ? "RUNNING" : list.length === 0 ? (date && date >= today ? "PLANNED" : "MISSING") : list.every((r) => r.approved) ? "APPROVED" : "OPEN";
    const rows = [
      ...shifts.map((s) => {
        const list = (byShift.get(s.id) ?? []).map(recordView);
        const planned = plannedMinutes(s);
        // Genehmigte Abwesenheit ohne erfasste Zeit: bezahlt mit Planstunden, sonst 0 (auch Altbestand ohne Entscheidung).
        const effect = effects.byShift.get(s.id), day = effects.onDay(p.userId, s.range.date);
        const absence = !list.length && (effect?.userId === p.userId || day)
          ? { category: effect?.userId === p.userId ? effect.category : day!.category, handling: effect?.userId === p.userId ? effect.handling : null, pay: effect ? pay.get("a-" + effect.effectId) ?? null : null }
          : null;
        const ist = absence ? (absence.handling === "PAID" ? planned : 0) : list.reduce((sum, r) => sum + r.minutes, 0);
        // Zeit nachtragen: die Person selbst (als Antrag) oder Pruefende fuer den Standort der Schicht.
        const canEnter = p.isActive && (a.isAdmin || p.userId === a.userId || (!!s.schedule.branchId && can(a, "EDIT_TIME", s.schedule.branchId) && canStaff(a, "VIEW_HOURS", p.userId)));
        return {
          key: "s-" + s.id, date: s.range.date, status: absence ? "ABSENT" as const : status(list, s.range.date), canEnter: canEnter && !absence, absence, plannedMinutes: planned, istMinutes: ist, deviationMinutes: list.length ? ist - planned : null,
          shift: { id: s.id, from: s.shiftFrom, to: s.shiftTo, title: s.title, branchName: s.schedule.branch?.name ?? null, customerName: s.schedule.branch?.customer?.name ?? null, division: s.division, pauseMinutes: rangeMinutes(s.shiftFrom, s.shiftTo) - planned },
          records: list,
        };
      }),
      ...loose.map((r) => {
        const view = recordView(r);
        return { key: "r-" + r.id, date: view.date, status: status([view], null), canEnter: false, absence: null, plannedMinutes: 0, istMinutes: view.minutes, deviationMinutes: null, shift: null, records: [view] };
      }),
    ].sort((x, y) => x.date.localeCompare(y.date) || (x.shift?.from ?? x.records[0]?.timeFrom ?? "").localeCompare(y.shift?.from ?? y.records[0]?.timeFrom ?? ""));
    const all = rows.flatMap((r) => r.records);
    return {
      userId: p.userId, firstName: p.user.firstName, lastName: p.user.lastName, isActive: p.isActive,
      personnelNumber: a.isAdmin ? p.personnelNumber : null,
      plannedMinutes: rows.reduce((s, r) => s + r.plannedMinutes, 0), istMinutes: rows.reduce((s, r) => s + r.istMinutes, 0),
      openCount: all.filter((r) => !r.approved && !r.running).length, missingCount: rows.filter((r) => r.status === "MISSING").length,
      approvable: all.filter((r) => !r.approved && r.canApprove).map((r) => r.id),
      totalCents: a.isAdmin ? all.reduce((s, r) => s + (r.pay?.totalCents ?? 0), 0) + rows.reduce((s, r) => s + (r.absence?.pay?.totalCents ?? 0), 0) : null,
      rows,
    };
  }).filter((p) => p.isActive || p.rows.length)
    .sort((x, y) => x.lastName.localeCompare(y.lastName, "de") || x.firstName.localeCompare(y.firstName, "de"));
  // Zeitkonto: Saldo zum letzten Tag der Abfrage, nur fuer sichtbare, aktive Konten.
  const balances = await balancesFor(a, result.map((p) => p.userId), to);
  return {
    from, to, branchId, showPay: a.isAdmin, showBalance: balances.size > 0,
    people: result.map((p) => ({ ...p, balanceMinutes: balances.has(p.userId) ? balances.get(p.userId)! : null })),
    totals: { plannedMinutes: result.reduce((s, p) => s + p.plannedMinutes, 0), istMinutes: result.reduce((s, p) => s + p.istMinutes, 0), openCount: result.reduce((s, p) => s + p.openCount, 0), totalCents: a.isAdmin ? result.reduce((s, p) => s + (p.totalCents ?? 0), 0) : null },
  };
}
