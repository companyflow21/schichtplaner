import { db } from "./db";
import { ApiError } from "./errors";
import { addDate, berlinDate } from "./berlin";
import { canStaff, staffIds, type Access } from "./access";
import { computeVacation, vacationDays, vacationYear, type VacationRules, type VacationYear } from "./vacation";

export async function vacationSettings(orgId: string) {
  return db.vacationSettings.findUnique({ where: { organizationId: orgId } });
}

/** Wer ein Urlaubskonto sieht: Admins, Manager mit "Abwesenheiten entscheiden" fuer die Person, die Person selbst bei Freigabe. */
function mayView(a: Access, userId: string, visible: boolean) {
  if (a.isAdmin) return true;
  if (userId === a.userId) return visible;
  return canStaff(a, "MANAGE_ABSENCES", userId);
}

export type VacationView = {
  memberId: string; enabled: boolean; active: boolean; canEdit: boolean; categoryId: string | null; categoryName: string | null;
  rules: VacationRules | null; years: VacationYear[]; current: VacationYear | null;
  adjustments: { id: string; date: string; days: number; comment: string }[];
};

type MemberRow = { id: string; userId: string; vacationRule: { included: boolean; daysPerYear: number | null; startDate: Date | null; carryOver: boolean | null } | null };
type Settings = NonNullable<Awaited<ReturnType<typeof vacationSettings>>>;

function rulesFor(member: MemberRow, settings: Settings, asOf: string): VacationRules {
  return {
    yearStart: settings.yearStart, daysPerYear: member.vacationRule?.daysPerYear ?? settings.daysPerYear, allocation: settings.allocation,
    carryOver: member.vacationRule?.carryOver ?? settings.carryOver, carryOverMax: settings.carryOverMax, excludedWeekdays: settings.excludedWeekdays,
    countHolidays: settings.countHolidays,
    startDate: (member.vacationRule?.startDate ?? settings.startDate)?.toISOString().slice(0, 10) ?? vacationYear(asOf, settings.yearStart).from,
  };
}

/** Urlaubskonten mehrerer Personen mit je einer Abfrage fuer Abwesenheiten, Korrekturen und Feiertage. */
async function compute(orgId: string, members: MemberRow[], settings: Settings, asOf: string) {
  const rules = new Map(members.map((m) => [m.id, rulesFor(m, settings, asOf)]));
  const earliest = [...rules.values()].reduce((min, r) => (r.startDate! < min ? r.startDate! : min), vacationYear(asOf, settings.yearStart).from);
  const yearEnd = vacationYear(asOf, settings.yearStart).to;
  const [absences, adjustments, holidays] = await Promise.all([
    settings.categoryId ? db.absence.findMany({ where: { userId: { in: members.map((m) => m.userId) }, categoryId: settings.categoryId, status: { in: ["APPROVED", "PENDING"] }, dateTo: { gte: new Date(earliest) }, dateFrom: { lte: new Date(yearEnd) } } }) : Promise.resolve([]),
    db.vacationAdjustment.findMany({ where: { memberId: { in: members.map((m) => m.id) } }, orderBy: { date: "asc" } }),
    db.holiday.findMany({ where: { organizationId: orgId, date: { gte: new Date(earliest), lte: new Date(yearEnd) } }, select: { date: true } }),
  ]);
  const holidaySet = new Set(holidays.map((h) => h.date.toISOString().slice(0, 10)));
  const today = berlinDate();
  return new Map(members.map((m) => {
    const r = rules.get(m.id)!;
    const own = adjustments.filter((x) => x.memberId === m.id).map((x) => ({ id: x.id, date: x.date.toISOString().slice(0, 10), days: x.days, comment: x.comment }));
    const years = computeVacation({
      rules: r, today, asOf, holidays: holidaySet, adjustments: own,
      absences: absences.filter((x) => x.userId === m.userId && x.dateTo.toISOString().slice(0, 10) >= r.startDate!).map((x) => ({ from: x.dateFrom.toISOString().slice(0, 10), to: x.dateTo.toISOString().slice(0, 10), status: x.status as "APPROVED" | "PENDING" })),
    });
    return [m.id, { rules: r, years, adjustments: own }];
  }));
}

/** Urlaubskonto einer Person zum Stichtag (Vorgabe heute); 404, wenn man es nicht sehen darf. */
export async function vacationFor(a: Access, userId: string, asOf = berlinDate()): Promise<VacationView> {
  const settings = await vacationSettings(a.orgId);
  const member = await db.organizationMember.findFirst({ where: { organizationId: a.orgId, userId }, select: { id: true, userId: true, vacationRule: true } });
  if (!member || !mayView(a, userId, settings?.visible ?? true)) throw new ApiError("Nicht gefunden.", 404);
  const category = settings?.categoryId ? await db.absenceCategory.findFirst({ where: { id: settings.categoryId, organizationId: a.orgId }, select: { name: true } }) : null;
  const base = { memberId: member.id, enabled: !!settings?.enabled, canEdit: a.isAdmin, categoryId: settings?.categoryId ?? null, categoryName: category?.name ?? null };
  if (!settings?.enabled || !settings.categoryId || member.vacationRule?.included === false) return { ...base, active: false, rules: null, years: [], current: null, adjustments: [] };
  const { rules, years, adjustments } = (await compute(a.orgId, [member], settings, asOf)).get(member.id)!;
  return { ...base, active: true, rules, years, current: years[years.length - 1] ?? null, adjustments };
}

/** Uebersicht des aktuellen Urlaubsjahres fuer alle Personen, deren Abwesenheiten man entscheidet. */
export async function vacationOverview(a: Access, asOf = berlinDate()) {
  const settings = await vacationSettings(a.orgId);
  if (!settings?.enabled || !settings.categoryId) return { enabled: !!settings?.enabled, people: [] };
  const managed = staffIds(a, "MANAGE_ABSENCES");
  if (managed !== null && !managed.length) throw new ApiError("Nicht gefunden.", 404);
  const members = await db.organizationMember.findMany({
    where: { organizationId: a.orgId, isActive: true, ...(managed ? { userId: { in: managed } } : {}) },
    select: { id: true, userId: true, vacationRule: true, user: { select: { firstName: true, lastName: true } } },
  });
  const included = members.filter((m) => m.vacationRule?.included !== false);
  const accounts = await compute(a.orgId, included, settings, asOf);
  const people = included.map((m) => {
    const { years, rules } = accounts.get(m.id)!;
    return { userId: m.userId, memberId: m.id, firstName: m.user.firstName, lastName: m.user.lastName, deviates: !!m.vacationRule && (m.vacationRule.daysPerYear !== null || m.vacationRule.startDate !== null || m.vacationRule.carryOver !== null), daysPerYear: rules.daysPerYear, current: years[years.length - 1] };
  });
  return { enabled: true, people: people.sort((x, y) => x.lastName.localeCompare(y.lastName, "de") || x.firstName.localeCompare(y.firstName, "de")) };
}

/** Tage, die eine (geplante) Abwesenheit vom Urlaubskonto abzieht - fuer die Anzeige im Antrag. */
export async function vacationCost(orgId: string, from: string, to: string) {
  const settings = await vacationSettings(orgId);
  if (!settings?.enabled) return 0;
  const holidays = await db.holiday.findMany({ where: { organizationId: orgId, date: { gte: new Date(from), lte: new Date(addDate(to, 1)) } }, select: { date: true } });
  return vacationDays({ from, to }, { from, to }, settings, new Set(holidays.map((h) => h.date.toISOString().slice(0, 10))));
}
