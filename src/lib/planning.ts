import type { Prisma, Shift, Schedule } from "@prisma/client";
import { ApiError } from "./errors";
import { addDate, overlaps, rangeMinutes, shiftRange } from "./berlin";
import { branchIds, can, type Access } from "./access";
import { normalizeBranchRights } from "./access-shared";

type Tx = Prisma.TransactionClient;

export const publicUser = { id: true, firstName: true, lastName: true, nickname: true, profileImage: true } as const;
export const branchView = { id: true, name: true, address: true, meetingPoint: true, notes: true, positions: true, isActive: true, customer: { select: { id: true, name: true } } } as const;
export const shiftInclude = {
  schedule: { include: { branch: { select: branchView } } },
  division: true,
  bookings: { include: { user: { select: publicUser } } },
} as const;
export type PlannedShift = Shift & { schedule: Schedule };
export type ShiftWithRelations = Prisma.ShiftGetPayload<{ include: typeof shiftInclude }>;

/** Letzter Kalendertag, den eine Schicht beruehrt (Nachtschichten enden am Folgetag). */
export function lastShiftDate(shift: { dayOfWeek: number; shiftFrom: string; shiftTo: string; schedule: { year: number; weekNumber: number } }) {
  const range = shiftRange(shift);
  return rangeMinutes(shift.shiftFrom, shift.shiftTo) + Number(shift.shiftFrom.slice(0, 2)) * 60 + Number(shift.shiftFrom.slice(3)) > 1440 ? addDate(range.date, 1) : range.date;
}

/**
 * Pruefung einer Einteilung, getrennt nach Wirkung:
 * - blocks: harte Sperren, die keine Bestaetigung aufhebt. "Frei" ist, wer
 *   keine zeitliche Ueberschneidung, keine genehmigte Abwesenheit und keine
 *   ausdruecklich eingetragene Nichtverfuegbarkeit hat; dazu kommen inaktives
 *   Konto und inaktiver Einsatzort.
 * - warnings: kurze Hinweise, die die Planung mit einer Bestaetigung
 *   uebersteuert (fehlende Qualifikation, Taetigkeit, Arbeitsbereich, Schicht
 *   ausserhalb der eingetragenen Verfuegbarkeit).
 * - declared: fuer den Schichtzeitraum ist ausdruecklich Verfuegbarkeit
 *   eingetragen. Ohne Eintrag gilt eine Person als frei.
 */
export type Assessment = { blocks: string[]; warnings: string[]; declared: boolean };

export async function assessAssignment(tx: Tx, shift: PlannedShift, userId: string, excludeShiftId = shift.id): Promise<Assessment> {
  return assess(shift, userId, await assessmentBasis(tx, [shift], [userId]), excludeShiftId);
}

/**
 * Einwaende einer Person gegen viele Schichten auf einmal - dieselben Regeln
 * wie checkAssignment, aber eine feste Zahl von Abfragen statt fuenf bis
 * sechs je Schicht (Dashboard: anfragbare offene Schichten).
 */
export async function checkAssignments(tx: Tx, shifts: PlannedShift[], userId: string): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>();
  if (!shifts.length) return result;
  const basis = await assessmentBasis(tx, shifts, [userId]);
  for (const shift of shifts) {
    const { blocks, warnings } = assess(shift, userId, basis, shift.id);
    result.set(shift.id, [...blocks, ...warnings]);
  }
  return result;
}

type AssessmentBasis = {
  members: Map<string, Prisma.OrganizationMemberGetPayload<object>>;
  branches: Map<string, Prisma.BranchGetPayload<object>>;
  divisions: Map<string, Prisma.DivisionGetPayload<{ include: { members: true } }>>;
  absences: { userId: string; dateFrom: Date; dateTo: Date }[];
  bookings: Prisma.BookingGetPayload<{ include: { shift: { include: { schedule: true } } } }>[];
  windows: Prisma.AvailabilityGetPayload<object>[];
};

/** Alles, was assess fuer diese Schichten (eines Mandanten) und Personen braucht. */
async function assessmentBasis(tx: Tx, shifts: PlannedShift[], userIds: string[]): Promise<AssessmentBasis> {
  const orgId = shifts[0].schedule.organizationId;
  const starts = shifts.map(s => shiftRange(s).date).sort();
  const lasts = shifts.map(s => lastShiftDate(s)).sort();
  const years = shifts.map(s => s.schedule.year);
  const branchIdList = [...new Set(shifts.map(s => s.schedule.branchId).filter((id): id is string => !!id))];
  const divisionIds = [...new Set(shifts.map(s => s.divisionId).filter((id): id is string => !!id))];
  const members = await tx.organizationMember.findMany({ where: { organizationId: orgId, userId: { in: userIds } } });
  const branches = branchIdList.length ? await tx.branch.findMany({ where: { id: { in: branchIdList } } }) : [];
  const divisions = divisionIds.length ? await tx.division.findMany({ where: { id: { in: divisionIds } }, include: { members: true } }) : [];
  // Die Art der Abwesenheit bleibt Personaldaten; die Planung erfaehrt nur, dass sie genehmigt ist.
  const absences = await tx.absence.findMany({ where: { userId: { in: userIds }, status: "APPROVED", category: { organizationId: orgId }, dateFrom: { lte: new Date(lasts[lasts.length - 1]) }, dateTo: { gte: new Date(starts[0]) } }, select: { userId: true, dateFrom: true, dateTo: true } });
  const bookings = await tx.booking.findMany({ where: { userId: { in: userIds }, shift: { deletedAt: null, schedule: { deletedAt: null, organizationId: orgId, year: { gte: Math.min(...years) - 1, lte: Math.max(...years) + 1 } } } }, include: { shift: { include: { schedule: true } } } });
  const windows = await tx.availability.findMany({ where: { organizationId: orgId, userId: { in: userIds }, date: { gte: new Date(addDate(starts[0], -1)), lte: new Date(addDate(starts[starts.length - 1], 1)) } } });
  return {
    members: new Map(members.map(m => [m.userId, m])),
    branches: new Map(branches.map(b => [b.id, b])),
    divisions: new Map(divisions.map(d => [d.id, d])),
    absences,
    bookings,
    windows,
  };
}

/** Die Regeln einer Einteilung fuer eine Schicht und eine Person (Daten aus assessmentBasis). */
function assess(shift: PlannedShift, userId: string, basis: AssessmentBasis, excludeShiftId: string): Assessment {
  const member = basis.members.get(userId);
  if (!member?.isActive) return { blocks: ["Mitarbeiter ist nicht aktiv."], warnings: [], declared: false };
  const blocks: string[] = [], warnings: string[] = [];
  if (shift.schedule.branchId) {
    const branch = basis.branches.get(shift.schedule.branchId);
    if (!branch?.isActive) blocks.push("Einsatzort ist nicht aktiv.");
    if (branch?.positions.length && !branch.positions.some(p => p.toLocaleLowerCase("de-DE") === member.position?.toLocaleLowerCase("de-DE"))) warnings.push("Tätigkeit passt nicht zum Einsatzort.");
  }
  const qualifications = new Set(member.qualifications.map(q => q.toLocaleLowerCase("de-DE")));
  if (shift.divisionId) {
    const division = basis.divisions.get(shift.divisionId);
    if (division && !division.isSystem && division.members.length && !division.members.some(m => m.userId === userId)) warnings.push("Gehört nicht zum Arbeitsbereich.");
  }
  const missing = shift.requiredQualifications.filter(q => !qualifications.has(q.toLocaleLowerCase("de-DE")));
  if (missing.length) warnings.push("Erforderliche Qualifikation fehlt: " + missing.join(", ") + ".");
  const range = shiftRange(shift);
  const lastDate = lastShiftDate(shift);
  const from = new Date(range.date).getTime(), to = new Date(lastDate).getTime();
  if (basis.absences.some(x => x.userId === userId && x.dateFrom.getTime() <= to && x.dateTo.getTime() >= from)) blocks.push("Genehmigte Abwesenheit.");
  const bookings = basis.bookings.filter(b => b.userId === userId && b.shiftId !== excludeShiftId && Math.abs(b.shift.schedule.year - shift.schedule.year) <= 1);
  if (bookings.some(b => overlaps(range, shiftRange(b.shift)))) blocks.push("Zeitliche Überschneidung mit einer anderen Schicht.");
  const windowFrom = new Date(addDate(range.date, -1)).getTime(), windowTo = new Date(addDate(range.date, 1)).getTime();
  const windows = basis.windows.filter(w => w.userId === userId && w.date.getTime() >= windowFrom && w.date.getTime() <= windowTo);
  const normalized = windows.map(w => { const start = w.date.getTime() / 60000 + Number(w.timeFrom.slice(0, 2)) * 60 + Number(w.timeFrom.slice(3)); return { ...w, start, end: start + rangeMinutes(w.timeFrom, w.timeTo) }; });
  if (normalized.some(w => !w.available && overlaps(range, w))) blocks.push("Als nicht verfügbar eingetragen.");
  let declared = false, outside = false;
  for (const day of [range.date, ...(lastDate !== range.date ? [lastDate] : [])]) {
    const start = Date.parse(day) / 60000, end = start + 1440;
    const segment = { start: Math.max(start, range.start), end: Math.min(end, range.end) };
    const available = normalized.filter(w => w.available && overlaps({ start, end }, w)).sort((a,b) => a.start - b.start);
    if (available.length) {
      declared = true;
      let covered = segment.start;
      for (const w of available) if (w.start <= covered) covered = Math.max(covered, w.end);
      if (covered < segment.end) outside = true;
    }
  }
  if (outside) warnings.push("Schicht liegt außerhalb der eingetragenen Verfügbarkeit.");
  return { blocks, warnings, declared: declared && !outside && !blocks.length };
}

/** Alle Einwaende ohne Unterscheidung - fuer Antraege von Mitarbeitenden, die nichts uebersteuern koennen. */
export async function checkAssignment(tx: Tx, shift: PlannedShift, userId: string, excludeShiftId = shift.id): Promise<string[]> {
  const { blocks, warnings } = await assessAssignment(tx, shift, userId, excludeShiftId);
  return [...blocks, ...warnings];
}

/**
 * Eine Nachricht je Empfaenger: niemand erfaehrt ueber eine Benachrichtigung,
 * wer sie sonst noch bekommen hat.
 */
export async function notify(tx: Tx, organizationId: string, senderId: string, recipientIds: string[], subject: string, text: string, shiftId?: string) {
  const ids = [...new Set(recipientIds)].filter(id => id !== senderId);
  for (const userId of ids) await tx.message.create({ data: { organizationId, senderId, subject, body: text, shiftId, recipients: { create: [{ userId }] } } });
  return ids;
}

/** Wer beim Besetzen zur Auswahl steht: Admins alle, Manager nur zugeordnete Personen mit "Einplanen". */
export function assignableUserIds(a: Access): string[] | null {
  if (a.isAdmin) return null;
  return [...a.staff].filter(([, s]) => s.rights.has("ASSIGN_SHIFTS")).map(([userId]) => userId);
}

/**
 * Wer fuer eine Schicht an diesem Standort eingeplant werden darf, mit Herkunft:
 * - site:     Mitarbeitende, die dem Standort der Schicht zugeordnet sind
 * - customer: Mitarbeitende anderer Standorte desselben Kunden, sofern die
 *             planende Person dort "Schichten erstellen und bearbeiten" hat
 * - rest:     Manager: persoenlich mit "In Schichten einplanen" zugeordnete
 *             Personen; Admins: alle uebrigen aktiven Mitglieder
 * Fuer site und customer genuegt die Standortzuordnung (Freigabe "Offene
 * Schichten sehen und anfragen"); eine Personalzuordnung ist dort nicht noetig.
 * Gilt fuer die Auswahl und fuer POST /api/bookings. Das Recht am Standort
 * der Schicht selbst prueft der Aufrufer (assertCan EDIT_SHIFTS).
 */
export type PoolEntry = { tier: "site" | "customer" | "rest"; sites: string[] };

export async function planningPool(tx: Tx, a: Access, branchId: string | null): Promise<Map<string, PoolEntry>> {
  const pool = new Map<string, PoolEntry>();
  const branch = branchId ? await tx.branch.findFirst({ where: { id: branchId, organizationId: a.orgId }, select: { id: true, customerId: true } }) : null;
  if (branch) {
    const managed = branchIds(a, "EDIT_SHIFTS");
    const siblings = branch.customerId
      ? await tx.branch.findMany({ where: { organizationId: a.orgId, customerId: branch.customerId, id: managed ? { in: managed.filter(id => id !== branch.id) } : { not: branch.id } }, select: { id: true, name: true }, orderBy: { name: "asc" } })
      : [];
    const names = new Map(siblings.map(s => [s.id, s.name]));
    const grants = await tx.branchAccess.findMany({
      where: { organizationId: a.orgId, branchId: { in: [branch.id, ...names.keys()] }, member: { isActive: true, role: "EMPLOYEE" } },
      select: { branchId: true, rights: true, member: { select: { userId: true, role: true } } },
    });
    const assigned = grants.filter(g => normalizeBranchRights(g.rights, g.member.role).includes("REQUEST_SHIFTS"));
    for (const g of assigned) if (g.branchId === branch.id) pool.set(g.member.userId, { tier: "site", sites: [] });
    for (const g of assigned) {
      if (g.branchId === branch.id || pool.get(g.member.userId)?.tier === "site") continue;
      const entry = pool.get(g.member.userId) ?? { tier: "customer" as const, sites: [] };
      entry.sites.push(names.get(g.branchId)!);
      pool.set(g.member.userId, entry);
    }
  }
  const rest = a.isAdmin
    ? (await tx.organizationMember.findMany({ where: { organizationId: a.orgId, isActive: true }, select: { userId: true } })).map(m => m.userId)
    : assignableUserIds(a) ?? [];
  for (const userId of rest) if (!pool.has(userId)) pool.set(userId, { tier: "rest", sites: [] });
  return pool;
}

/**
 * Auswahl fuer eine Schicht in genau dieser Reihenfolge:
 * 1 frei, Standort der Schicht
 * 2 belegt oder abwesend, Standort der Schicht (sichtbar, nicht waehlbar)
 * 3 frei, andere verwaltete Standorte desselben Kunden
 * 4 belegt oder abwesend, andere verwaltete Standorte desselben Kunden
 * 5 uebrige einplanbare Personen (freie waehlbar, gesperrte sichtbar)
 * Innerhalb einer Gruppe stehen ausdruecklich Verfuegbare zuerst. Hinweise
 * (etwa fehlende Qualifikation) aendern Gruppe und Reihenfolge nicht.
 * Ausgegeben werden nur Namen und kurze Gruende.
 */
export async function shiftCandidates(tx: Tx, a: Access, shift: ShiftWithRelations) {
  const pool = await planningPool(tx, a, shift.schedule.branchId);
  const people = await tx.organizationMember.findMany({
    where: { organizationId: a.orgId, isActive: true, isActivated: true, userId: { in: [...pool.keys()] } },
    select: { userId: true, user: { select: { firstName: true, lastName: true } } },
    orderBy: [{ user: { lastName: "asc" } }, { user: { firstName: "asc" } }],
  });
  // reasons: Herkunft und Zustand (frei, verfuegbar eingetragen oder Sperrgrund);
  // hints: Hinweise, die vor der Zuweisung genau eine Bestaetigung verlangen.
  const candidates: { userId: string; firstName: string; lastName: string; group: 1 | 2 | 3 | 4 | 5; selectable: boolean; confirm: boolean; declared: boolean; reasons: string[]; hints: string[] }[] = [];
  for (const p of people) {
    if (shift.bookings.some(b => b.userId === p.userId)) continue;
    const entry = pool.get(p.userId)!;
    const r = await assessAssignment(tx, shift, p.userId);
    const free = r.blocks.length === 0;
    const group = entry.tier === "site" ? (free ? 1 : 2) : entry.tier === "customer" ? (free ? 3 : 4) : 5;
    const origin = entry.tier === "customer" ? ["Standort " + entry.sites.join(", ") + "."] : entry.tier === "rest" && !a.isAdmin ? ["Persönlich zugeordnet."] : [];
    const state = free ? [r.declared ? "Verfügbar eingetragen." : "Frei."] : r.blocks;
    const hints = free ? r.warnings : [];
    candidates.push({ userId: p.userId, firstName: p.user.firstName, lastName: p.user.lastName, group, selectable: free, confirm: hints.length > 0, declared: r.declared, reasons: [...origin, ...state], hints });
  }
  // Stabil: Gruppe, dann waehlbar vor gesperrt (Gruppe 5), dann eingetragene Verfuegbarkeit, dann Name.
  candidates.sort((x, y) => x.group - y.group || Number(y.selectable) - Number(x.selectable) || Number(y.declared) - Number(x.declared));
  return {
    // Fuer die Ueberschriften der Gruppen.
    site: shift.schedule.branch?.name ?? null,
    customer: shift.schedule.branch?.customer?.name ?? null,
    admin: a.isAdmin,
    candidates: candidates.map(({ declared: _d, ...c }) => { void _d; return c; }),
  };
}

/**
 * Einteilen. Harte Sperren gelten immer. Qualifikationshinweise verlangen
 * genau eine Bestaetigung (confirm); ohne sie antwortet der Server mit 409
 * und { confirm: true, warnings }, damit die Oberflaeche einmal nachfragt.
 */
export async function assign(tx: Tx, a: Access, shiftId: string, userId: string, confirm = false) {
  const shift = await tx.shift.findFirst({ where: { id: shiftId, deletedAt: null, schedule: { organizationId: a.orgId, deletedAt: null } }, include: shiftInclude });
  if (!shift) throw new ApiError("Schicht nicht gefunden.", 404);
  if (shift.bookings.some(b => b.userId === userId)) throw new ApiError("Bereits zugewiesen.", 409);
  if (shift.bookings.length >= shift.maxEmployees) throw new ApiError("Schicht ist bereits besetzt.", 409);
  const { blocks, warnings } = await assessAssignment(tx, shift, userId);
  if (blocks.length) throw new ApiError([...blocks, ...warnings].join(" "), 409);
  if (warnings.length && !confirm) throw new ApiError(warnings.join(" "), 409, { confirm: true, warnings });
  const booking = await tx.booking.create({ data: { shiftId, userId, bookedBy: a.userId }, include: { user: { select: publicUser } } });
  if (shift.schedule.isPublic) await notify(tx, a.orgId, a.userId, [userId], "Neue Schicht", shiftRange(shift).date + ": " + shift.shiftFrom + "–" + shift.shiftTo + ". Bitte bestätigen.", shiftId);
  return { booking, shift };
}

/**
 * Buchungen, die nicht wirksam sind: Konto nicht mehr aktiv oder eine
 * genehmigte Abwesenheit ueberschneidet sich mit dem Schichttag.
 */
export async function ineffectiveBookings(tx: Tx, orgId: string, shifts: ShiftWithRelations[]): Promise<Set<string>> {
  const userIds = [...new Set(shifts.flatMap(s => s.bookings.map(b => b.userId)))];
  if (!userIds.length) return new Set();
  const dates = shifts.flatMap(s => [shiftRange(s).date, lastShiftDate(s)]).sort();
  const [inactive, absences] = await Promise.all([
    tx.organizationMember.findMany({ where: { organizationId: orgId, userId: { in: userIds }, isActive: false }, select: { userId: true } }),
    tx.absence.findMany({ where: { userId: { in: userIds }, status: "APPROVED", category: { organizationId: orgId }, dateFrom: { lte: new Date(dates[dates.length - 1]) }, dateTo: { gte: new Date(dates[0]) } }, select: { userId: true, dateFrom: true, dateTo: true } }),
  ]);
  const gone = new Set(inactive.map(m => m.userId));
  const result = new Set<string>();
  for (const shift of shifts) {
    const first = shiftRange(shift).date, last = lastShiftDate(shift);
    for (const b of shift.bookings) {
      const absent = absences.some(x => x.userId === b.userId && x.dateFrom.toISOString().slice(0, 10) <= last && x.dateTo.toISOString().slice(0, 10) >= first);
      if (gone.has(b.userId) || absent) result.add(b.id);
    }
  }
  return result;
}

/**
 * Schicht fuer die Ausgabe - nur die Felder, die die betrachtende Person
 * sehen darf. Namen anderer Eingeteilter nur mit "Dienstplan ansehen";
 * Bestaetigungs- und Verfuegbarkeitsstatus nur fuer die Planung.
 */
export function shiftView(shift: ShiftWithRelations, a: Access, ineffective: Set<string> = new Set()) {
  const branchId = shift.schedule.branchId;
  const fullPlan = can(a, "VIEW_SCHEDULE", branchId);
  const planner = fullPlan && (a.isAdmin || a.role === "MANAGER");
  const effective = shift.bookings.filter(b => !ineffective.has(b.id)).length;
  const range = shiftRange(shift);
  const branch = shift.schedule.branch;
  return {
    id: shift.id, scheduleId: shift.scheduleId, divisionId: shift.divisionId, dayOfWeek: shift.dayOfWeek,
    shiftFrom: shift.shiftFrom, shiftTo: shift.shiftTo, maxEmployees: shift.maxEmployees,
    pauseOption: shift.pauseOption, pauseValue: shift.pauseValue, title: shift.title, description: shift.description,
    requiredQualifications: shift.requiredQualifications, createdAt: shift.createdAt, deletedAt: shift.deletedAt,
    date: range.date, endsNextDay: rangeMinutes(shift.shiftFrom, shift.shiftTo) + Number(shift.shiftFrom.slice(0, 2)) * 60 + Number(shift.shiftFrom.slice(3)) > 1440,
    isPublic: shift.schedule.isPublic,
    branchId,
    branch: branch ? { id: branch.id, name: branch.name, address: branch.address, meetingPoint: branch.meetingPoint, notes: branch.notes, customer: branch.customer } : null,
    division: shift.division ? { id: shift.division.id, title: shift.division.title, color: shift.division.color } : null,
    bookings: shift.bookings.filter(b => fullPlan || b.userId === a.userId).map(b => ({
      id: b.id, shiftId: b.shiftId, userId: b.userId, bookedAt: b.bookedAt, user: b.user,
      confirmedAt: planner || b.userId === a.userId ? b.confirmedAt : null,
      ...(planner ? { unavailable: ineffective.has(b.id) } : {}),
    })),
    occupiedCount: shift.bookings.length,
    missing: Math.max(0, shift.maxEmployees - (planner ? effective : shift.bookings.length)),
    can: {
      edit: can(a, "EDIT_SHIFTS", branchId),
      handle: can(a, "HANDLE_REQUESTS", branchId),
      request: shift.schedule.isPublic && can(a, "REQUEST_SHIFTS", branchId),
    },
  };
}
export type ShiftView = ReturnType<typeof shiftView>;
