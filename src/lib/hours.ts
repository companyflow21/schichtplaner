import type { Prisma } from "@prisma/client";
import { db } from "./db";
import { ApiError } from "./errors";
import { berlinDate, recordMinutes, shiftRange, addDate, isoWeek } from "./berlin";
import { branchIds, can, canSeeTime, canStaff, staffIds, timeScope, type Access } from "./access";
import { recordOverlaps } from "./time-service";
import { payrollReport } from "./payroll-service";
import { plannedMinutes } from "./planning";
import { wallToUtcMinutes } from "./checkin";
import { frozenPlans } from "./schedule-frozen";
import { balancesFor } from "./time-account-service";
import { absenceEffects } from "./absence-effects";
import type { PayLine } from "./payroll";

export type HoursStatus = "APPROVED" | "OPEN" | "MISSING" | "PLANNED" | "RUNNING" | "ABSENT";
/**
 * Genehmigung einer Buchung: OPEN (offen), REVIEWED (von einer pruefenden
 * Person) oder AUTO (ohne Pruefer: Altbestand, bei Einfuehrung der Pruefung
 * automatisch uebernommen, oder Einstellung "automatisch genehmigen").
 */
export type ApprovalKind = "OPEN" | "REVIEWED" | "AUTO";

/** Schicht einer Zuweisung im Stundenbericht - Live-Zeile oder Momentaufnahme eines Plans in Bearbeitung. */
type PlanShift = {
  id: string; scheduleId: string; dayOfWeek: number; shiftFrom: string; shiftTo: string; pauseOption: string; pauseValue: number; title: string | null;
  schedule: { year: number; weekNumber: number; branchId: string | null; branch: { name: string; customer: { name: string } | null } | null };
  division: { title: string; color: string } | null;
};
type PlanBooking = { userId: string | null; formerEmployeeId: string | null; shift: PlanShift };

/** Pause einer Schicht in echten Minuten: Bruttodauer (Europe/Berlin) minus Planminuten aus planning.ts. */
function pauseMinutes(shift: PlanShift): number {
  const range = shiftRange(shift);
  return wallToUtcMinutes(range.end) - wallToUtcMinutes(range.start) - plannedMinutes(shift);
}

/**
 * Stunden pruefen: je Person die geplanten Schichten im Zeitraum mit den
 * zugehoerigen Buchungen (Plan/Ist/Status) sowie Buchungen ohne Schicht.
 * Sichtbarkeit wie die Monatsauswertung: eigene immer; fremde nur mit
 * "Stunden einsehen" fuer die Person und "Zeiterfassung einsehen" am Standort.
 * Lohn nur fuer die Administration.
 *
 * Hauptlinie:
 * - Personen tragen key (userId bzw. "former:" + Id). Zeiten und vergangene
 *   Zuweisungen geloeschter Personen (FormerEmployee) sieht nur die
 *   Administration, als eigene Zeile (former: true); dort wird nichts
 *   nachgetragen oder geaendert, nur genehmigt.
 * - Platzhalter von Subunternehmern haben keine Zeiten: ihre Zuweisungen
 *   erzeugen keine Zeile und kein "nicht erfasst".
 * - Plaene in Bearbeitung: wer den Plan nicht live sieht (lib/schedule-frozen.ts),
 *   bekommt die Planspalte aus der Momentaufnahme; Iststunden bleiben live.
 * - Genehmigte Abwesenheit (lib/absence-effects.ts): Schicht ohne Buchung wird
 *   "abwesend" mit Planstunden (bezahlt) oder 0 Stunden; ohne Entscheidung
 *   (Altbestand) 0 Stunden. Geloeschte Personen haben keine Abwesenheiten mehr.
 */
export async function hoursReport(a: Access, from: string, to: string, branchId: string | null, options: { userId?: string } = {}) {
  if (branchId && !can(a, "VIEW_TIME", branchId)) throw new ApiError("Nicht gefunden.", 404);
  if (branchId && !await db.branch.findFirst({ where: { id: branchId, organizationId: a.orgId }, select: { id: true } })) throw new ApiError("Nicht gefunden.", 404);
  const timeBranches = branchIds(a, "VIEW_TIME");
  const managed = staffIds(a, "VIEW_HOURS");
  const others = managed === null ? null : timeBranches && timeBranches.length ? managed.filter((id) => id !== a.userId) : [];
  const allowedBranches = branchId ? [branchId] : timeBranches;
  // Geloeschte Personen nur fuer die Administration und nur im Gesamtbericht (nicht im Stundenzettel einer Person).
  const withFormer = a.isAdmin && !options.userId;
  const members = await db.organizationMember.findMany({
    where: { organizationId: a.orgId, AND: [others === null ? {} : { userId: { in: [a.userId, ...others] } }, options.userId ? { userId: options.userId } : {}] },
    select: { userId: true, isActive: true, personnelNumber: true, user: { select: { firstName: true, lastName: true } } },
  });
  const userIds = members.map((p) => p.userId);
  const weeks = new Map<string, { year: number; weekNumber: number }>();
  for (let d = addDate(from, -1); d <= to; d = addDate(d, 1)) { const w = isoWeek(d); weeks.set(w.year + "-" + w.weekNumber, w); }
  // Wer: Personen mit Konto im Rahmen, dazu (nur Admin) geloeschte Personen. Platzhalter (contractorWorkerId) nie.
  const whoseBookings: Prisma.BookingWhereInput = { OR: [{ userId: { in: userIds } }, ...(withFormer ? [{ formerEmployeeId: { not: null } }] : [])] };
  const bookingScope: Prisma.BookingWhereInput = others === null
    ? (branchId ? { shift: { schedule: { branchId } } } : {})
    : { OR: [{ userId: a.userId, ...(branchId ? { shift: { schedule: { branchId } } } : {}) }, { userId: { in: others }, shift: { schedule: { branchId: { in: allowedBranches ?? [] } } } }] };
  const [records, liveBookings, frozen] = await Promise.all([
    db.timeRecord.findMany({
      where: { AND: [timeScope(a, "view"), { OR: [{ userId: { in: userIds } }, ...(withFormer ? [{ formerEmployeeId: { not: null } }] : [])], date: { gte: new Date(from), lte: new Date(to) } }, ...(branchId ? [{ branchId }] : [])] },
      include: {
        branch: { select: { name: true } }, category: { select: { id: true, name: true } }, formerEmployee: { select: { id: true, firstName: true, lastName: true } },
        checkin: { select: { method: true, status: true, lateMinutes: true, distanceM: true } }, corrections: { where: { status: "PENDING" }, select: { id: true } },
      },
      orderBy: [{ date: "asc" }, { timeFrom: "asc" }],
    }),
    db.booking.findMany({
      where: { AND: [whoseBookings, { shift: { deletedAt: null, schedule: { organizationId: a.orgId, deletedAt: null, isPublic: true, OR: [...weeks.values()] } } }, bookingScope] },
      include: {
        formerEmployee: { select: { id: true, firstName: true, lastName: true } },
        shift: { include: { schedule: { include: { branch: { select: { name: true, customer: { select: { name: true } } } } } }, division: { select: { title: true, color: true } } } },
      },
    }),
    frozenPlans(db, a, { OR: [...weeks.values()], ...(branchId ? { branchId } : {}) }),
  ]);
  // Plaene in Bearbeitung ohne Planungssicht: Zuweisungen aus der Momentaufnahme im selben Rahmen wie bookingScope.
  const frozenIds = new Set(frozen.shifts.map((s) => s.id));
  const inScope = (b: { userId: string | null }, shift: { schedule: { branchId: string | null } }) =>
    b.userId === a.userId ? (!branchId || shift.schedule.branchId === branchId) : !!b.userId && !!others?.includes(b.userId) && !!shift.schedule.branchId && !!allowedBranches?.includes(shift.schedule.branchId);
  const bookings: PlanBooking[] = [
    ...liveBookings.filter((b) => !frozen.scheduleIds.has(b.shift.scheduleId) && !frozenIds.has(b.shift.id)),
    ...frozen.shifts.flatMap((shift) => shift.bookings.filter((b) => !!b.userId && userIds.includes(b.userId) && inScope(b, shift)).map((b) => ({ userId: b.userId, formerEmployeeId: null, shift }))),
  ];
  const pay = new Map<string, { totalCents: number; lines: PayLine[]; warnings: string[] }>();
  const payPeople = new Map<string, { payType: { title: string; hourlyRateCents: number } | null; lines: PayLine[]; warnings: string[] }>();
  let payroll: Awaited<ReturnType<typeof payrollReport>> | null = null;
  if (a.isAdmin) {
    payroll = await payrollReport(a, from, to, branchId);
    for (const p of payroll.people) {
      payPeople.set(p.key, { payType: p.payType ? { title: p.payType.title, hourlyRateCents: p.payType.hourlyRateCents } : null, lines: p.lines, warnings: p.warnings });
      for (const r of p.records) pay.set(r.id, { totalCents: r.totalCents, lines: r.lines, warnings: r.warnings });
    }
  }
  const today = berlinDate();
  const effects = await absenceEffects(a.orgId, userIds, from, to);

  // Personen mit Konto, dazu geloeschte Personen mit Zeiten oder Zuweisungen (Name aus der Momentaufnahme).
  const formerPeople = new Map<string, { firstName: string; lastName: string }>();
  for (const row of [...records, ...liveBookings]) if (!row.userId && row.formerEmployee) formerPeople.set(row.formerEmployee.id, row.formerEmployee);
  const people = [
    ...members.map((m) => ({ key: m.userId, userId: m.userId as string | null, formerEmployeeId: null as string | null, former: false, firstName: m.user.firstName, lastName: m.user.lastName, isActive: m.isActive, personnelNumber: m.personnelNumber })),
    ...[...formerPeople].map(([id, name]) => ({ key: "former:" + id, userId: null, formerEmployeeId: id as string | null, former: true, firstName: name.firstName, lastName: name.lastName, isActive: false, personnelNumber: null })),
  ];
  const belongs = (p: (typeof people)[number], row: { userId: string | null; formerEmployeeId: string | null }) => (p.userId ? row.userId === p.userId : !row.userId && row.formerEmployeeId === p.formerEmployeeId);

  const result = people.map((p) => {
    const shifts = bookings.filter((b) => belongs(p, b)).map((b) => ({ ...b.shift, range: shiftRange(b.shift) })).filter((s) => s.range.date >= from && s.range.date <= to);
    const own = records.filter((r) => belongs(p, r));
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
      // Pruefende: Admins; Manager mit "Zeiterfassung bearbeiten" am Standort und "Stunden einsehen"; eigene nur Admins.
      const reviewer = canSeeTime(a, r, "edit") && (r.userId !== a.userId || a.isAdmin);
      const approval: ApprovalKind = !r.approvedAt ? "OPEN" : r.approvedById ? "REVIEWED" : "AUTO";
      return {
        id: r.id, userId: r.userId, category: r.category, type: r.type, date: r.date.toISOString().slice(0, 10), timeFrom: r.timeFrom, timeTo: r.timeTo, durationHours: r.durationHours, durationMinutes: r.durationMinutes,
        breakSeconds: r.breakSeconds, categoryId: r.categoryId, comment: r.comment, branchName: r.branch?.name ?? null,
        minutes: running ? 0 : recordMinutes(r), running, approved: !!r.approvedAt, approval, pendingCorrection: r.corrections.length > 0,
        // Zeiten geloeschter Personen bleiben unveraendert (PATCH /api/time/[id] antwortet 409), genehmigen geht.
        checkin: r.checkin, canEdit: reviewer && !running && !!r.userId, canApprove: reviewer && !running, pay: pay.get(r.id) ?? null,
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
        // Nur Personen mit Konto; die Art nennt die Antwort nur, wer die Abwesenheiten der Person sieht.
        const effect = p.userId ? effects.forShift(p.userId, s) : null, period = p.userId ? effects.onShiftDays(p.userId, s) : null;
        const absence = !list.length && p.userId && (effect || period)
          ? { category: canStaff(a, "MANAGE_ABSENCES", p.userId) || p.userId === a.userId ? effect?.category ?? period!.category : null, handling: effect?.handling ?? null, pay: effect ? pay.get("a-" + effect.effectId) ?? null : null }
          : null;
        const ist = absence ? (absence.handling === "PAID" ? planned : 0) : list.reduce((sum, r) => sum + r.minutes, 0);
        // Zeit wie geplant nachtragen: nur Personen mit Konto - die Person selbst oder Pruefende fuer den Standort der Schicht.
        const canEnter = !!p.userId && p.isActive && (a.isAdmin || p.userId === a.userId || (!!s.schedule.branchId && can(a, "EDIT_TIME", s.schedule.branchId) && canStaff(a, "VIEW_HOURS", p.userId)));
        return {
          key: "s-" + s.id, date: s.range.date, status: absence ? "ABSENT" as const : status(list, s.range.date), canEnter: canEnter && !absence, absence, plannedMinutes: planned, istMinutes: ist, deviationMinutes: list.length ? ist - planned : null,
          shift: { id: s.id, from: s.shiftFrom, to: s.shiftTo, title: s.title, branchName: s.schedule.branch?.name ?? null, customerName: s.schedule.branch?.customer?.name ?? null, division: s.division ? { title: s.division.title, color: s.division.color } : null, pauseMinutes: pauseMinutes(s) },
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
      key: p.key, userId: p.userId, former: p.former, firstName: p.firstName, lastName: p.lastName, isActive: p.isActive,
      personnelNumber: a.isAdmin ? p.personnelNumber : null,
      plannedMinutes: rows.reduce((s, r) => s + r.plannedMinutes, 0), istMinutes: rows.reduce((s, r) => s + r.istMinutes, 0),
      openCount: all.filter((r) => !r.approved && !r.running).length, missingCount: rows.filter((r) => r.status === "MISSING").length,
      approvable: all.filter((r) => !r.approved && r.canApprove).map((r) => r.id),
      totalCents: a.isAdmin ? all.reduce((s, r) => s + (r.pay?.totalCents ?? 0), 0) + rows.reduce((s, r) => s + (r.absence?.pay?.totalCents ?? 0), 0) : null,
      /** Lohnart, Summen je Lohnart/Zuschlag und Hinweise - nur Administration. */
      pay: a.isAdmin ? payPeople.get(p.key) ?? { payType: null, lines: [], warnings: [] } : null,
      rows,
    };
  }).filter((p) => p.isActive || p.rows.length)
    .sort((x, y) => x.lastName.localeCompare(y.lastName, "de") || x.firstName.localeCompare(y.firstName, "de"));
  // Zeitkonto: Saldo zum letzten Tag der Abfrage, nur fuer sichtbare, aktive Konten.
  const balances = await balancesFor(a, result.flatMap((p) => (p.userId ? [p.userId] : [])), to);
  return {
    from, to, branchId, showPay: a.isAdmin, showBalance: balances.size > 0,
    people: result.map((p) => ({ ...p, balanceMinutes: p.userId && balances.has(p.userId) ? balances.get(p.userId)! : null })),
    /** Nur Administration: Hinweise zu Feiertagszuschlaegen und Einrichtung des Lohns (wie bisher die Lohnseite). */
    notices: payroll?.notices ?? [], setup: payroll?.setup ?? null,
    totals: { plannedMinutes: result.reduce((s, p) => s + p.plannedMinutes, 0), istMinutes: result.reduce((s, p) => s + p.istMinutes, 0), openCount: result.reduce((s, p) => s + p.openCount, 0), totalCents: a.isAdmin ? result.reduce((s, p) => s + (p.totalCents ?? 0), 0) : null },
  };
}
