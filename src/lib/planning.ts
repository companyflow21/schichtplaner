import type { Prisma, Shift, Schedule } from "@prisma/client";
import { ApiError } from "./errors";
import { addDate, overlaps, rangeMinutes, shiftRange } from "./berlin";
import { branchIds, can, type Access } from "./access";
import { normalizeBranchRights } from "./access-shared";
import { CHECKED_IN, wallToUtcMinutes } from "./checkin";
import { notifiesEmployees, scheduleStatus } from "./schedule-status";

type Tx = Prisma.TransactionClient;

export const publicUser = { id: true, firstName: true, lastName: true, profileImage: true } as const;
export const branchView = { id: true, name: true, address: true, meetingPoint: true, notes: true, positions: true, isActive: true, customer: { select: { id: true, name: true } } } as const;
/** Momentaufnahme einer geloeschten Person (nur Name) - fuer die Historie. */
export const formerView = { id: true, firstName: true, lastName: true } as const;
export const contractorWorkerView = { id: true, name: true, subcontractor: { select: { id: true, name: true } } } as const;
export const shiftInclude = {
  schedule: { include: { branch: { select: branchView } } },
  division: true,
  bookings: { include: { user: { select: publicUser }, formerEmployee: { select: formerView }, contractorWorker: { select: contractorWorkerView } } },
} as const;

/**
 * Personen-IDs bestehender Konten. Zuweisungen, Zeiten und Check-ins
 * geloeschter Personen (userId leer, formerEmployeeId gesetzt) bleiben als
 * Historie erhalten, nehmen aber an Planung und Benachrichtigung nicht teil.
 */
export function personIds(rows: { userId: string | null }[]): string[] {
  return rows.flatMap(r => r.userId ? [r.userId] : []);
}

/** Anzeigename einer Zeile mit Konto oder Momentaufnahme. */
export function personName(row: { user?: { firstName: string; lastName: string } | null; formerEmployee?: { firstName: string; lastName: string } | null; contractorWorker?: { name: string; subcontractor: { name: string } } | null }): { firstName: string; lastName: string; former: boolean } {
  if (row.user) return { firstName: row.user.firstName, lastName: row.user.lastName, former: false };
  if (row.contractorWorker) return { firstName: row.contractorWorker.subcontractor.name, lastName: "· " + row.contractorWorker.name, former: false };
  return { firstName: row.formerEmployee?.firstName ?? "Gelöschte", lastName: row.formerEmployee?.lastName ?? "Person", former: true };
}
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

/*
 * Reine Vergleiche der Einteilungspruefung - gemeinsam fuer assessAssignment
 * (einzelne Einteilung) und die Konfliktpruefung einer Standortwoche
 * (lib/conflicts.ts), damit beide dieselben Regeln anwenden.
 */
const lower = (value: string) => value.toLocaleLowerCase("de-DE");

/** Einsatzort verlangt Taetigkeiten, und die Taetigkeit der Person ist nicht darunter. */
export function positionMismatch(positions: string[], position: string | null | undefined): boolean {
  const own = position?.toLocaleLowerCase("de-DE");
  return positions.length > 0 && !positions.some(p => lower(p) === own);
}

/** Erforderliche Qualifikationen, die die Person nicht hat (ohne Gross-/Kleinschreibung). */
export function missingQualifications(required: string[], held: string[]): string[] {
  const have = new Set(held.map(lower));
  return required.filter(q => !have.has(lower(q)));
}

/** Arbeitsbereich mit Mitgliedern (kein Systembereich), zu denen die Person nicht gehoert. */
export function outsideDivision(division: { isSystem: boolean; members: { userId: string }[] } | null, userId: string): boolean {
  return !!division && !division.isSystem && division.members.length > 0 && !division.members.some(m => m.userId === userId);
}

/**
 * Eingetragene Verfuegbarkeit gegen den Schichtzeitraum (Fenster vom Vortag
 * bis Folgetag): unavailable = ein "nicht verfuegbar"-Fenster ueberschneidet
 * sich; declared = fuer einen Schichttag ist Verfuegbarkeit eingetragen;
 * outside = die Schicht ragt an einem solchen Tag ueber die Fenster hinaus.
 */
export function availabilityState(range: { date: string; start: number; end: number }, lastDate: string, windows: { date: Date; timeFrom: string; timeTo: string; available: boolean }[]) {
  const normalized = windows.map(w => { const start = w.date.getTime() / 60000 + Number(w.timeFrom.slice(0, 2)) * 60 + Number(w.timeFrom.slice(3)); return { ...w, start, end: start + rangeMinutes(w.timeFrom, w.timeTo) }; });
  const unavailable = normalized.some(w => !w.available && overlaps(range, w));
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
  return { unavailable, declared, outside };
}

export async function assessAssignment(tx: Tx, shift: PlannedShift, userId: string, excludeShiftId = shift.id): Promise<Assessment> {
  const member = await tx.organizationMember.findUnique({ where: { organizationId_userId: { organizationId: shift.schedule.organizationId, userId } } });
  if (!member?.isActive) return { blocks: ["Mitarbeiter ist nicht aktiv."], warnings: [], declared: false };
  const blocks: string[] = [], warnings: string[] = [];
  if (shift.schedule.branchId) {
    const branch = await tx.branch.findUnique({ where: { id: shift.schedule.branchId } });
    if (!branch?.isActive) blocks.push("Einsatzort ist nicht aktiv.");
    if (branch && positionMismatch(branch.positions, member.position)) warnings.push("Tätigkeit passt nicht zum Einsatzort.");
  }
  if (shift.divisionId) {
    const division = await tx.division.findUnique({ where: { id: shift.divisionId }, include: { members: true } });
    if (outsideDivision(division, userId)) warnings.push("Gehört nicht zum Arbeitsbereich.");
  }
  const missing = missingQualifications(shift.requiredQualifications, member.qualifications);
  if (missing.length) warnings.push("Erforderliche Qualifikation fehlt: " + missing.join(", ") + ".");
  const range = shiftRange(shift);
  const lastDate = lastShiftDate(shift);
  const absences = await tx.absence.count({ where: { userId, status: "APPROVED", category: { organizationId: shift.schedule.organizationId }, dateFrom: { lte: new Date(lastDate) }, dateTo: { gte: new Date(range.date) } } });
  // Die Art der Abwesenheit bleibt Personaldaten; die Planung erfaehrt nur, dass sie genehmigt ist.
  if (absences) blocks.push("Genehmigte Abwesenheit.");
  const bookings = await tx.booking.findMany({ where: { userId, shiftId: { not: excludeShiftId }, shift: { deletedAt: null, schedule: { deletedAt: null, organizationId: shift.schedule.organizationId, year: { gte: shift.schedule.year - 1, lte: shift.schedule.year + 1 } } } }, include: { shift: { include: { schedule: true } } } });
  if (bookings.some(b => overlaps(range, shiftRange(b.shift)))) blocks.push("Zeitliche Überschneidung mit einer anderen Schicht.");
  const windows = await tx.availability.findMany({ where: { organizationId: shift.schedule.organizationId, userId, date: { gte: new Date(addDate(range.date, -1)), lte: new Date(addDate(range.date, 1)) } } });
  const availability = availabilityState(range, lastDate, windows);
  if (availability.unavailable) blocks.push("Als nicht verfügbar eingetragen.");
  if (availability.outside) warnings.push("Schicht liegt außerhalb der eingetragenen Verfügbarkeit.");
  return { blocks, warnings, declared: availability.declared && !availability.outside && !blocks.length };
}

/** Alle Einwaende ohne Unterscheidung - fuer Antraege von Mitarbeitenden, die nichts uebersteuern koennen. */
export async function checkAssignment(tx: Tx, shift: PlannedShift, userId: string, excludeShiftId = shift.id): Promise<string[]> {
  const { blocks, warnings } = await assessAssignment(tx, shift, userId, excludeShiftId);
  return [...blocks, ...warnings];
}

/** Platzhalter haben kein Konto und keine Personaldaten; Eignung wird extern bestaetigt. */
export async function assessContractorAssignment(tx: Tx, shift: PlannedShift, contractorWorkerId: string, excludeShiftId = shift.id): Promise<Assessment> {
  const worker = await tx.contractorWorker.findFirst({ where: { id: contractorWorkerId, organizationId: shift.schedule.organizationId }, include: { subcontractor: true } });
  if (!worker) throw new ApiError("Subunternehmer-Platzhalter nicht gefunden.", 404);
  const blocks: string[] = [], warnings: string[] = [];
  if (!worker.isActive || !worker.subcontractor.isActive) blocks.push("Subunternehmer oder Platzhalter ist nicht aktiv.");
  if (shift.schedule.branchId) {
    const branch = await tx.branch.findUnique({ where: { id: shift.schedule.branchId } });
    if (!branch?.isActive) blocks.push("Einsatzort ist nicht aktiv.");
    if (branch?.positions.length) warnings.push("Bei Platzhaltern ist die Tätigkeit nicht hinterlegt. Bitte die Tätigkeiten am Einsatzort beim Subunternehmer prüfen.");
  }
  if (shift.requiredQualifications.length) warnings.push("Bei Platzhaltern sind Qualifikationen nicht hinterlegt. Bitte die erforderlichen Qualifikationen beim Subunternehmer prüfen: " + shift.requiredQualifications.join(", ") + ".");
  if (shift.divisionId) {
    const division = await tx.division.findUnique({ where: { id: shift.divisionId } });
    if (division && !division.isSystem) warnings.push("Bei Platzhaltern ist der Arbeitsbereich nicht hinterlegt. Bitte die Einsatzfähigkeit beim Subunternehmer prüfen.");
  }
  const range = shiftRange(shift);
  const bookings = await tx.booking.findMany({ where: { contractorWorkerId, shiftId: { not: excludeShiftId }, shift: { deletedAt: null, schedule: { deletedAt: null, organizationId: shift.schedule.organizationId, year: { gte: shift.schedule.year - 1, lte: shift.schedule.year + 1 } } } }, include: { shift: { include: { schedule: true } } } });
  if (bookings.some(b => overlaps(range, shiftRange(b.shift)))) blocks.push("Zeitliche Überschneidung mit einer anderen Schicht.");
  return { blocks, warnings, declared: false };
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
  const contractorWorkers: { id: string; name: string; subcontractor: { id: string; name: string }; selectable: boolean; confirm: boolean; reasons: string[]; hints: string[] }[] = [];
  if (a.isAdmin) {
    const workers = await tx.contractorWorker.findMany({ where: { organizationId: a.orgId, isActive: true, subcontractor: { isActive: true } }, select: contractorWorkerView, orderBy: [{ subcontractor: { name: "asc" } }, { name: "asc" }] });
    for (const worker of workers) {
      if (shift.bookings.some(b => b.contractorWorkerId === worker.id)) continue;
      const r = await assessContractorAssignment(tx, shift, worker.id);
      const free = r.blocks.length === 0;
      contractorWorkers.push({ ...worker, selectable: free, confirm: free && r.warnings.length > 0, reasons: free ? ["Frei."] : r.blocks, hints: free ? r.warnings : [] });
    }
  }
  return {
    // Fuer die Ueberschriften der Gruppen.
    site: shift.schedule.branch?.name ?? null,
    customer: shift.schedule.branch?.customer?.name ?? null,
    admin: a.isAdmin,
    candidates: candidates.map(({ declared: _d, ...c }) => { void _d; return c; }),
    contractorWorkers,
  };
}

const WEEKDAYS = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
/** Datum fuer Nachrichten: "Mo, 05.10.2026". */
export function dayLabel(date: string): string {
  return WEEKDAYS[new Date(date + "T12:00:00Z").getUTCDay()] + ", " + date.slice(8, 10) + "." + date.slice(5, 7) + "." + date.slice(0, 4);
}
/** Schicht fuer Nachrichten: Datum, Zeit, Standort. */
export function shiftLabel(shift: { dayOfWeek: number; shiftFrom: string; shiftTo: string; schedule: { year: number; weekNumber: number; branch?: { name: string } | null } }): string {
  return [dayLabel(shiftRange(shift).date), shift.shiftFrom + "–" + shift.shiftTo, shift.schedule.branch?.name].filter(Boolean).join(", ");
}

/**
 * Zuweisung durch Planung oder Administration ist sofort verbindlich
 * (PLANNER); die Person muss nichts bestaetigen.
 */
export function plannerBooking(a: Pick<Access, "userId">) {
  return { confirmation: "PLANNER" as const, confirmedAt: new Date(), bookedBy: a.userId };
}

/** Schicht der Organisation (nicht geloescht) mit Plan, Standort und Buchungen. */
export function findShift(tx: Tx, orgId: string, id: string) {
  return tx.shift.findFirst({ where: { id, deletedAt: null, schedule: { organizationId: orgId, deletedAt: null } }, include: shiftInclude });
}

/**
 * Einteilen ohne Nachricht - fuer Aufrufer, die Nachrichten je Person
 * buendeln (Wechsel). Harte Sperren gelten immer. Hinweise wie eine
 * fehlende Qualifikation verlangen genau eine Bestaetigung (confirm); ohne
 * sie antwortet der Server mit 409 und { confirm: true, warnings }, damit
 * die Oberflaeche einmal nachfragt.
 */
export async function placeBooking(tx: Tx, a: Access, shift: ShiftWithRelations, userId: string, confirm = false) {
  if (shift.bookings.some(b => b.userId === userId)) throw new ApiError("Bereits zugewiesen.", 409);
  if (shift.bookings.length >= shift.maxEmployees) throw new ApiError("Schicht ist bereits besetzt.", 409);
  const { blocks, warnings } = await assessAssignment(tx, shift, userId);
  if (blocks.length) throw new ApiError([...blocks, ...warnings].join(" "), 409);
  if (warnings.length && !confirm) throw new ApiError(warnings.join(" "), 409, { confirm: true, warnings });
  return tx.booking.create({ data: { shiftId: shift.id, userId, ...plannerBooking(a) }, include: { user: { select: publicUser } } });
}

/** Verbindliche Sub-Einteilung ohne Benachrichtigung oder Zugangskonto. */
export async function placeContractorBooking(tx: Tx, a: Access, shift: ShiftWithRelations, contractorWorkerId: string, confirm = false) {
  if (!a.isAdmin) throw new ApiError("Keine Berechtigung.", 403);
  const { blocks, warnings } = await assessContractorAssignment(tx, shift, contractorWorkerId);
  if (shift.bookings.some(b => b.contractorWorkerId === contractorWorkerId)) throw new ApiError("Bereits zugewiesen.", 409);
  if (shift.bookings.length >= shift.maxEmployees) throw new ApiError("Schicht ist bereits besetzt.", 409);
  if (blocks.length) throw new ApiError(blocks.join(" "), 409);
  if (warnings.length && !confirm) throw new ApiError(warnings.join(" "), 409, { confirm: true, warnings });
  return tx.booking.create({ data: { shiftId: shift.id, contractorWorkerId, ...plannerBooking(a) }, include: { contractorWorker: { select: contractorWorkerView } } });
}

/** Einteilen mit Nachricht an die Person (nur veroeffentlichte Plaene ausserhalb der Bearbeitung). */
export async function assign(tx: Tx, a: Access, shiftId: string, userId: string, confirm = false) {
  const shift = await findShift(tx, a.orgId, shiftId);
  if (!shift) throw new ApiError("Schicht nicht gefunden.", 404);
  const booking = await placeBooking(tx, a, shift, userId, confirm);
  if (notifiesEmployees(shift.schedule)) await notify(tx, a.orgId, a.userId, [userId], "Neue Schicht", shiftLabel(shift) + ": Du bist fest eingeteilt.", shiftId);
  return { booking, shift };
}

/**
 * Geplante Nettozeit einer Schicht in echten Minuten: Dauer zwischen Beginn
 * und Ende in Europe/Berlin (Nacht der Zeitumstellung 7 bzw. 9 Stunden),
 * abzueglich der Pausenregel genau einmal ("pro Stunde": je volle Stunde).
 * Grundlage fuer Planstunden in Dienstplan, Auswertung und CSV.
 */
export function plannedMinutes(shift: Parameters<typeof shiftRange>[0] & { pauseOption: string; pauseValue: number }): number {
  const range = shiftRange(shift);
  const gross = wallToUtcMinutes(range.end) - wallToUtcMinutes(range.start);
  return Math.max(0, gross - (shift.pauseOption === "PER_HOUR" ? Math.floor(gross / 60) * shift.pauseValue : shift.pauseValue));
}

/** Schicht ist vorbei (echtes Ende in Europe/Berlin). */
export function shiftEnded(shift: Parameters<typeof shiftRange>[0], now = new Date()): boolean {
  return wallToUtcMinutes(shiftRange(shift).end) <= now.getTime() / 60000;
}

/**
 * Bestehende Zuweisung loesen (Wechsel, Aufheben) - nicht nach Schichtende
 * und nicht nach einem Check-in der Person: Dann ist ihr Einsatz erfasst
 * und die Zuweisung bleibt Nachweis.
 */
export async function assertReleasable(tx: Tx, shift: ShiftWithRelations, userId: string) {
  if (shiftEnded(shift)) throw new ApiError("Die Schicht ist bereits beendet. Zuweisungen vergangener Schichten bleiben als Nachweis unverändert.", 409);
  const checkin = await tx.checkin.findFirst({ where: { shiftId: shift.id, userId, status: { in: [...CHECKED_IN, "PENDING"] } }, select: { id: true } });
  if (checkin) {
    const who = shift.bookings.find(b => b.userId === userId)?.user;
    throw new ApiError((who ? who.firstName + " " + who.lastName : "Die Person") + " hat für diese Schicht bereits eingecheckt. Die Zuweisung bleibt als Nachweis erhalten.", 409);
  }
}

/**
 * Buchungen, die nicht wirksam sind: Konto nicht mehr aktiv oder eine
 * genehmigte Abwesenheit ueberschneidet sich mit dem Schichttag.
 */
export async function ineffectiveBookings(tx: Tx, orgId: string, shifts: ShiftWithRelations[]): Promise<Set<string>> {
  const userIds = [...new Set(shifts.flatMap(s => personIds(s.bookings)))];
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
      if (!b.userId) continue;
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
    date: range.date, endsAt: new Date(wallToUtcMinutes(range.end) * 60000).toISOString(), endsNextDay: rangeMinutes(shift.shiftFrom, shift.shiftTo) + Number(shift.shiftFrom.slice(0, 2)) * 60 + Number(shift.shiftFrom.slice(3)) > 1440,
    plannedMinutes: plannedMinutes(shift),
    isPublic: shift.schedule.isPublic,
    branchId,
    branch: branch ? { id: branch.id, name: branch.name, address: branch.address, meetingPoint: branch.meetingPoint, notes: branch.notes, customer: branch.customer } : null,
    division: shift.division ? { id: shift.division.id, title: shift.division.title, color: shift.division.color } : null,
    bookings: shift.bookings.filter(b => fullPlan || (b.userId !== null && b.userId === a.userId)).map(b => ({
      id: b.id, shiftId: b.shiftId, userId: b.userId, contractorWorkerId: b.contractorWorkerId, bookedAt: b.bookedAt,
      // Geloeschte Person: nur der Name aus der Momentaufnahme, kein Konto.
      user: b.user ?? { id: null, ...personName(b), profileImage: null },
      former: !b.userId && !b.contractorWorkerId,
      // Stabiler Schluessel je Person, auch fuer geloeschte (Momentaufnahme).
      personKey: b.userId ?? (b.contractorWorkerId ? "contractor:" + b.contractorWorkerId : "former:" + b.formerEmployeeId),
      confirmedAt: planner || b.userId === a.userId ? b.confirmedAt : null,
      confirmation: planner || b.userId === a.userId ? b.confirmation : null,
      ...(planner ? { unavailable: ineffective.has(b.id) } : {}),
    })),
    occupiedCount: shift.bookings.length,
    missing: Math.max(0, shift.maxEmployees - (planner ? effective : shift.bookings.length)),
    can: {
      edit: can(a, "EDIT_SHIFTS", branchId),
      handle: can(a, "HANDLE_REQUESTS", branchId),
      // Waehrend der Bearbeitung ruhen Antraege.
      request: scheduleStatus(shift.schedule) === "PUBLISHED" && can(a, "REQUEST_SHIFTS", branchId),
      manageContractors: a.isAdmin,
    },
  };
}
export type ShiftView = ReturnType<typeof shiftView>;
