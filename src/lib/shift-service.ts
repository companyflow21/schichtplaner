import { z } from "zod";
import type { Branch, Prisma, Schedule } from "@prisma/client";
import { ApiError } from "./errors";
import { timeSchema } from "./api";
import { assessAssignment, dayLabel, notify, personIds, planningPool, plannerBooking, shiftInclude, shiftLabel, type ShiftWithRelations } from "./planning";
import { isoWeek, weekDate, addDate, shiftRange, rangeMinutes, minuteOfDay, validDate } from "./berlin";
import { assertCan, branchHolders, type Access } from "./access";
import { catalogQualifications } from "./qualifications";

type Tx = Prisma.TransactionClient;

const shiftFields = {
  divisionId: z.string().nullable().optional(), branchId: z.string().nullable().optional(),
  dayOfWeek: z.number().int().min(1).max(7), shiftFrom: timeSchema, shiftTo: timeSchema,
  maxEmployees: z.number().int().min(1).max(100), pauseOption: z.enum(["PER_HOUR", "PER_SHIFT"]),
  pauseValue: z.number().int().min(0).max(120), title: z.string().max(100).nullable().optional(),
  description: z.string().max(2000).nullable().optional(), requiredQualifications: z.array(z.string().trim().min(1).max(100)).max(30),
};
/** Unbekannte Felder (etwa userId/userIds) werden abgelehnt statt still ignoriert. */
const strict = { error: (issue: { code?: string; keys?: string[] }) => issue.code === "unrecognized_keys" ? "Unbekanntes Feld: " + (issue.keys ?? []).join(", ") + "." : undefined };
const options = {
  // Direkt einteilen (verbindlich, PLANNER); confirm bestaetigt Hinweise, preview prueft nur.
  confirm: z.boolean().optional(), preview: z.boolean().optional(),
};
export const shiftInput = z.strictObject({
  ...shiftFields, scheduleId: z.string().min(1),
  pauseOption: shiftFields.pauseOption.default("PER_SHIFT"), pauseValue: shiftFields.pauseValue.default(0),
  requiredQualifications: shiftFields.requiredQualifications.default([]),
  repeatDays: z.array(z.number().int().min(1).max(7)).max(7).optional(), repeatWeeks: z.number().int().min(1).max(52).default(1),
  assignees: z.array(z.string().min(1)).max(100).default([]), ...options,
}, strict)
  .refine(d => new Set(d.assignees).size === d.assignees.length, { message: "Jede Person nur einmal auswählen.", path: ["assignees"] })
  .refine(d => d.assignees.length <= d.maxEmployees, { message: "Mehr Mitarbeitende ausgewählt als Plätze vorhanden.", path: ["assignees"] });
/** Aenderung einzelner Felder - ohne Standardwerte (Zod setzt sie sonst auch bei .partial()). */
export const shiftPatch = z.object(shiftFields).partial();
/** Kopie auf mehrere Tage; { date } bleibt fuer aeltere Aufrufer gueltig. */
const day = z.string().refine(validDate, "Ungültiges Datum.");
export const copyInput = z.strictObject({
  date: day.optional(),
  dates: z.array(day).min(1, "Bitte mindestens einen Tag wählen.").max(62, "Höchstens 62 Tage auf einmal.").optional(),
  withAssignments: z.boolean().default(false), ...options,
}, strict)
  .refine(d => !!d.date !== !!d.dates, "Bitte Zieltage angeben.")
  .refine(d => !d.dates || new Set(d.dates).size === d.dates.length, "Jeder Tag nur einmal.");

/** Ergebnis einer Vorschau; Konflikte und Hinweise je Person und Tag. */
export type Issue = { userId: string; name: string; date: string; reasons: string[] };
export type ShiftPreview = { preview: true; occurrences: { date: string; shiftFrom: string; shiftTo: string; endsNextDay: boolean; duplicate: boolean }[]; conflicts: Issue[]; warnings: Issue[] };
/** Vorschau: alles wie beim Speichern rechnen, dann die Transaktion zuruecknehmen. */
export class PreviewRollback extends Error {
  constructor(public result: ShiftPreview) { super("Vorschau"); }
}
/** Vorschau-Ergebnis statt Fehler zurueckgeben (die Transaktion ist dann zurueckgenommen). */
export function previewResult(error: unknown): ShiftPreview {
  if (error instanceof PreviewRollback) return error.result;
  throw error;
}

/** Ein Standort, an dem geplant werden darf: gleiche Organisation, Recht, aktiv, einem Kunden zugeordnet. */
export async function plannableBranch(tx: Tx, a: Access, branchId: string) {
  const branch = await tx.branch.findFirst({ where: { id: branchId, organizationId: a.orgId } });
  if (!branch) throw new ApiError("Standort nicht gefunden.", 404);
  assertCan(a, "EDIT_SHIFTS", branch.id);
  if (!branch.isActive) throw new ApiError("Der Standort ist nicht aktiv.", 409);
  if (!branch.customerId) throw new ApiError("Der Standort ist noch keinem Kunden zugeordnet. Bitte zuerst unter Einsatzorte einen Kunden festlegen.", 409);
  return branch;
}

/** Wochenplan eines Standorts; wird bei Bedarf angelegt. */
export async function ensureSchedule(tx: Tx, orgId: string, branchId: string, week: { year: number; weekNumber: number }, template?: Pick<Schedule, "isPublic" | "settingsLayout" | "showTitle" | "showPauses">): Promise<Schedule> {
  const found = await tx.schedule.findFirst({ where: { organizationId: orgId, branchId, weekNumber: week.weekNumber, year: week.year, deletedAt: null } });
  if (found) return found;
  const settings = template ? { isPublic: template.isPublic, settingsLayout: template.settingsLayout, showTitle: template.showTitle, showPauses: template.showPauses } : {};
  return tx.schedule.create({ data: { organizationId: orgId, branchId, weekNumber: week.weekNumber, year: week.year, ...settings } });
}

async function validateDivision(tx: Tx, orgId: string, divisionId?: string | null) {
  if (divisionId && !await tx.division.findFirst({ where: { id: divisionId, organizationId: orgId, deletedAt: null } })) throw new ApiError("Arbeitsbereich nicht gefunden.", 404);
}

type ShiftBase = Omit<Prisma.ShiftUncheckedCreateInput, "id" | "scheduleId" | "dayOfWeek" | "createdAt" | "deletedAt"> & { shiftFrom: string; shiftTo: string; maxEmployees: number };
type Target = { schedule: Schedule; dayOfWeek: number };
type PlanOptions = { assignees: string[]; confirm?: boolean; preview?: boolean };

function endsNextDay(shift: { shiftFrom: string; shiftTo: string }) {
  return minuteOfDay(shift.shiftFrom) + rangeMinutes(shift.shiftFrom, shift.shiftTo) > 1440;
}
function describe(issues: Issue[]) {
  return issues.map(i => i.name + " (" + dayLabel(i.date) + "): " + i.reasons.join(" ")).join(" · ");
}

/**
 * Neue Schichten an einem Standort anlegen und optional direkt besetzen -
 * alles oder nichts in der Transaktion des Aufrufers:
 * - Recht je Person einmal (Manager: Planungskreis des Standorts, sonst 403)
 * - jede Einteilung mit assessAssignment; spaetere Termine sehen die
 *   Buchungen frueherer Termine derselben Anfrage
 * - erst alle Probleme sammeln: Sperren -> 409 mit details.conflicts,
 *   Hinweise ohne confirm -> 409 { confirm: true, warnings }; nichts bleibt
 * - preview: dieselbe Rechnung, dann PreviewRollback (nichts bleibt)
 * Nachrichten erst am Ende, eine je Person (nur veroeffentlichte Plaene).
 */
async function placeShifts(tx: Tx, a: Access, branch: Branch, base: ShiftBase, targets: Target[], options: PlanOptions): Promise<ShiftWithRelations[]> {
  const { assignees } = options;
  if (assignees.length && !a.isAdmin) {
    const pool = await planningPool(tx, a, branch.id);
    if (assignees.some(id => !pool.has(id))) throw new ApiError("Diese Person kannst du für diesen Standort nicht einplanen.", 403);
  }
  const members = assignees.length ? await tx.organizationMember.findMany({ where: { organizationId: a.orgId, userId: { in: assignees } }, select: { userId: true, user: { select: { firstName: true, lastName: true } } } }) : [];
  const names = new Map(members.map(m => [m.userId, m.user.firstName + " " + m.user.lastName]));
  const start = (t: Target) => shiftRange({ ...base, dayOfWeek: t.dayOfWeek, schedule: t.schedule }).start;
  const occurrences: ShiftPreview["occurrences"] = [];
  const conflicts: Issue[] = [], warnings: Issue[] = [];
  const created: ShiftWithRelations[] = [];
  for (const t of [...targets].sort((x, y) => start(x) - start(y))) {
    const date = weekDate(t.schedule.year, t.schedule.weekNumber, t.dayOfWeek);
    // Gleiche Schicht (Standort, Tag, Zeit, Taetigkeit) gibt es schon - nur Hinweis.
    const duplicate = !!await tx.shift.findFirst({ where: { deletedAt: null, dayOfWeek: t.dayOfWeek, shiftFrom: base.shiftFrom, shiftTo: base.shiftTo, title: base.title ?? null, schedule: { organizationId: a.orgId, branchId: branch.id, year: t.schedule.year, weekNumber: t.schedule.weekNumber, deletedAt: null } }, select: { id: true } });
    occurrences.push({ date, shiftFrom: base.shiftFrom, shiftTo: base.shiftTo, endsNextDay: endsNextDay(base), duplicate });
    const shift = await tx.shift.create({ data: { ...base, scheduleId: t.schedule.id, dayOfWeek: t.dayOfWeek }, include: shiftInclude });
    created.push(shift);
    for (const userId of assignees) {
      const r = await assessAssignment(tx, shift, userId);
      const name = names.get(userId) ?? "Unbekannte Person";
      if (r.blocks.length) { conflicts.push({ userId, name, date, reasons: r.blocks }); continue; }
      if (r.warnings.length) warnings.push({ userId, name, date, reasons: r.warnings });
      await tx.booking.create({ data: { shiftId: shift.id, userId, ...plannerBooking(a) } });
    }
  }
  if (options.preview) throw new PreviewRollback({ preview: true, occurrences, conflicts, warnings });
  if (conflicts.length) throw new ApiError("Nichts angelegt. Konflikte: " + describe(conflicts), 409, { conflicts });
  if (warnings.length && !options.confirm) throw new ApiError("Hinweise vor dem Einteilen: " + describe(warnings), 409, { confirm: true, warnings });
  const stored = await tx.shift.findMany({ where: { id: { in: created.map(s => s.id) } }, include: shiftInclude });
  const shifts = created.map(c => stored.find(s => s.id === c.id)!);
  // Eingeteilte Personen: eine Nachricht fuer alle neuen Schichten.
  const published = shifts.filter(s => s.schedule.isPublic);
  if (assignees.length && published.length) {
    const one = published.length === 1;
    await notify(tx, a.orgId, a.userId, assignees, one ? "Neue Schicht" : "Neue Schichten",
      one ? shiftLabel(published[0]) + ": Du bist fest eingeteilt." : "Du bist fest eingeteilt:\n" + published.map(s => "– " + shiftLabel(s)).join("\n"),
      one ? published[0].id : undefined);
  }
  // Offene Plaetze: eine Nachricht je Person mit Freigabe, alle Wochen zusammen.
  const weeks = [...new Set(published.filter(s => s.bookings.length < s.maxEmployees).map(s => "KW " + s.schedule.weekNumber + "/" + s.schedule.year))];
  if (weeks.length) {
    const audience = (await branchHolders(tx, a.orgId, branch.id, ["REQUEST_SHIFTS"], false)).filter(id => !assignees.includes(id));
    await notify(tx, a.orgId, a.userId, audience, "Neue offene Schichten", branch.name + ": Im veröffentlichten Dienstplan " + weeks.join(", ") + " gibt es neue Schichten.");
  }
  return shifts;
}

export async function createShifts(tx: Tx, a: Access, data: z.output<typeof shiftInput>) {
  if (data.shiftFrom === data.shiftTo) throw new ApiError("Beginn und Ende müssen unterschiedlich sein.");
  const schedule = await tx.schedule.findFirst({ where: { id: data.scheduleId, organizationId: a.orgId, deletedAt: null } });
  if (!schedule) throw new ApiError("Plan nicht gefunden.", 404);
  if (!schedule.branchId) throw new ApiError("Neue Schichten brauchen einen Standort. Bitte den Plan eines Standorts öffnen.", 409);
  if (data.branchId && data.branchId !== schedule.branchId) throw new ApiError("Der angegebene Standort passt nicht zum Plan.", 400);
  const branch = await plannableBranch(tx, a, schedule.branchId);
  await validateDivision(tx, a.orgId, data.divisionId);
  const { repeatDays, repeatWeeks, branchId: _branchId, scheduleId: _scheduleId, dayOfWeek, assignees, confirm, preview, ...rest } = data;
  void _branchId; void _scheduleId;
  const base = { ...rest, requiredQualifications: await catalogQualifications(tx, a.orgId, rest.requiredQualifications) };
  const days = [...new Set(repeatDays?.length ? repeatDays : [dayOfWeek])].sort((x, y) => x - y);
  const targets: Target[] = [];
  for (let w = 0; w < repeatWeeks; w++) {
    const target = w === 0 ? schedule : await ensureSchedule(tx, a.orgId, branch.id, isoWeek(addDate(weekDate(schedule.year, schedule.weekNumber), w * 7)));
    for (const d of days) targets.push({ schedule: target, dayOfWeek: d });
  }
  return placeShifts(tx, a, branch, base, targets, { assignees, confirm, preview });
}

/**
 * Kopie auf einen oder mehrere Tage - immer am Standort der Ausgangsschicht.
 * Uebernommen werden Zeiten (Nachtschichten enden wieder am Folgetag),
 * Pause, Plaetze, Taetigkeit, Hinweise, Qualifikationen und Arbeitsbereich;
 * mit withAssignments auch die aktuell eingeteilten Personen (alle
 * Pruefungen, verbindlich). Alles oder nichts, Vertrag wie createShifts.
 */
export async function copyShift(tx: Tx, a: Access, id: string, data: z.output<typeof copyInput>) {
  const source = await tx.shift.findFirst({ where: { id, deletedAt: null, schedule: { organizationId: a.orgId, deletedAt: null } }, include: shiftInclude });
  if (!source) throw new ApiError("Schicht nicht gefunden.", 404);
  assertCan(a, "EDIT_SHIFTS", source.schedule.branchId);
  if (!source.schedule.branchId) throw new ApiError("Schichten ohne Standort können nicht kopiert werden. Bitte zuerst einem Standort zuordnen.", 409);
  const branch = await plannableBranch(tx, a, source.schedule.branchId);
  await validateDivision(tx, a.orgId, source.divisionId);
  const base: ShiftBase = {
    divisionId: source.divisionId, shiftFrom: source.shiftFrom, shiftTo: source.shiftTo, maxEmployees: source.maxEmployees,
    pauseOption: source.pauseOption, pauseValue: source.pauseValue, title: source.title, description: source.description,
    requiredQualifications: await catalogQualifications(tx, a.orgId, source.requiredQualifications),
  };
  const targets: Target[] = [];
  for (const date of [...(data.dates ?? [data.date!])].sort()) {
    targets.push({ schedule: await ensureSchedule(tx, a.orgId, branch.id, isoWeek(date)), dayOfWeek: ((new Date(date + "T12:00:00Z").getUTCDay() + 6) % 7) + 1 });
  }
  return placeShifts(tx, a, branch, base, targets, { assignees: data.withAssignments ? personIds(source.bookings) : [], confirm: data.confirm, preview: data.preview });
}

function pauseText(shift: { pauseOption: string; pauseValue: number }) {
  return shift.pauseValue ? shift.pauseValue + " Min." + (shift.pauseOption === "PER_HOUR" ? " pro Stunde" : "") : "keine";
}

export async function updateShift(tx: Tx, a: Access, id: string, data: z.output<typeof shiftPatch>) {
  const existing = await tx.shift.findFirst({ where: { id, deletedAt: null, schedule: { organizationId: a.orgId, deletedAt: null } }, include: shiftInclude });
  if (!existing) throw new ApiError("Schicht nicht gefunden.", 404);
  assertCan(a, "EDIT_SHIFTS", existing.schedule.branchId);
  await validateDivision(tx, a.orgId, data.divisionId);
  const { branchId, ...patch } = data;
  const fields = { ...patch, ...(patch.requiredQualifications !== undefined ? { requiredQualifications: await catalogQualifications(tx, a.orgId, patch.requiredQualifications) } : {}) };
  let schedule: Schedule = existing.schedule;
  if (branchId !== undefined && branchId !== existing.schedule.branchId) {
    // Umzug an einen anderen Standort: Recht an beiden Standorten, gleiche Woche.
    if (!branchId) throw new ApiError("Eine Schicht braucht einen Standort.", 400);
    const target = await plannableBranch(tx, a, branchId);
    schedule = await ensureSchedule(tx, a.orgId, target.id, existing.schedule, existing.schedule);
  }
  const effective = { ...existing, ...fields, scheduleId: schedule.id, schedule };
  if (effective.shiftFrom === effective.shiftTo) throw new ApiError("Beginn und Ende müssen unterschiedlich sein.");
  if (effective.maxEmployees < existing.bookings.length) throw new ApiError("Die Schicht hat mehr Zuweisungen als Plätze.", 409);
  for (const booking of existing.bookings) {
    // Historie geloeschter Personen wird nicht neu geprueft.
    if (!booking.userId || !booking.user) continue;
    // Harte Sperren gelten immer. Ein Qualifikationshinweis, der schon vor der
    // Aenderung bestand, wurde beim Einteilen bestaetigt und blockiert nicht
    // erneut; erst durch die Aenderung entstehende Hinweise blockieren.
    const after = await assessAssignment(tx, effective, booking.userId);
    const before = after.warnings.length ? (await assessAssignment(tx, existing, booking.userId)).warnings : [];
    const problems = [...after.blocks, ...after.warnings.filter(w => !before.includes(w))];
    if (problems.length) throw new ApiError(booking.user.firstName + ": " + problems.join(" "), 409);
  }
  const shift = await tx.shift.update({ where: { id }, data: { ...fields, scheduleId: schedule.id }, include: shiftInclude });
  // Zuweisungen bleiben verbindlich; Information nur bei relevanter Aenderung.
  const moved = shift.dayOfWeek !== existing.dayOfWeek || shift.shiftFrom !== existing.shiftFrom || shift.shiftTo !== existing.shiftTo || shift.scheduleId !== existing.scheduleId;
  const pause = shift.pauseOption !== existing.pauseOption || shift.pauseValue !== existing.pauseValue;
  const title = (shift.title ?? "") !== (existing.title ?? "");
  if ((moved || pause || title) && (existing.schedule.isPublic || schedule.isPublic)) {
    const text = [moved ? "Neu: " + shiftLabel(shift) + ". Vorher: " + shiftLabel(existing) + "." : shiftLabel(shift) + "."];
    if (pause) text.push("Pause jetzt: " + pauseText(shift) + ".");
    if (title) text.push("Tätigkeit jetzt: " + (shift.title || "keine Angabe") + ".");
    await notify(tx, a.orgId, a.userId, personIds(existing.bookings), "Schicht geändert", text.join(" "), id);
  }
  return { shift, previousBranchId: existing.schedule.branchId };
}
