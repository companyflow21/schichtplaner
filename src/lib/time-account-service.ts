import { db } from "./db";
import { ApiError } from "./errors";
import { berlinDate, isoWeek, addDate, recordMinutes, shiftRange } from "./berlin";
import { canStaff, type Access } from "./access";
import { plannedMinutes } from "./planning";
import { frozenPlans } from "./schedule-frozen";
import { computeAccount, type AccountMethod, type AccountResult, type DayMinutes } from "./time-account";
import { absenceEffects } from "./absence-effects";

type Settings = { accountsEnabled: boolean; accountMethod: AccountMethod; accountVisible: boolean };

export async function accountSettings(orgId: string): Promise<Settings> {
  const s = await db.timeSettings.findUnique({ where: { organizationId: orgId }, select: { accountsEnabled: true, accountMethod: true, accountVisible: true } });
  return s ?? { accountsEnabled: false, accountMethod: "ACTUAL_MINUS_TARGET", accountVisible: false };
}

/**
 * Wer den Saldo einer Person sieht: Admins, Manager mit "Stunden einsehen"
 * fuer die Person (nur die Summe, auch aus Standorten ohne eigene Freigabe)
 * und die Person selbst, wenn die Sichtbarkeit eingeschaltet ist.
 */
function mayView(a: Access, userId: string, visible: boolean): boolean {
  if (a.isAdmin) return true;
  if (userId === a.userId) return visible;
  return canStaff(a, "VIEW_HOURS", userId);
}

/**
 * Ist- und Planminuten je Kalendertag einer Person in [from, to]. Planminuten
 * wie die Monatsauswertung (planning.ts, echte Dauer in Europe/Berlin) aus
 * veroeffentlichten Plaenen; wer einen Plan in Bearbeitung nicht live sieht,
 * rechnet mit der Momentaufnahme (wie "Stunden und Lohn"). Ist bleibt live;
 * bezahlte Abwesenheit (lib/absence-effects.ts) zaehlt mit den Planstunden.
 */
async function dayMinutes(a: Access, userId: string, from: string, to: string): Promise<Map<string, DayMinutes>> {
  const weeks = new Map<string, { year: number; weekNumber: number }>();
  for (let d = addDate(from, -1); d <= to; d = addDate(d, 7)) { const w = isoWeek(d); weeks.set(w.year + "-" + w.weekNumber, w); }
  const last = isoWeek(to); weeks.set(last.year + "-" + last.weekNumber, last);
  const [records, bookings, frozen] = await Promise.all([
    db.timeRecord.findMany({ where: { organizationId: a.orgId, userId, date: { gte: new Date(from), lte: new Date(to) }, NOT: { type: "WATCH", timeTo: null } } }),
    db.booking.findMany({ where: { userId, shift: { deletedAt: null, schedule: { organizationId: a.orgId, deletedAt: null, isPublic: true, OR: [...weeks.values()] } } }, include: { shift: { include: { schedule: true } } } }),
    frozenPlans(db, a, { OR: [...weeks.values()] }),
  ]);
  const frozenIds = new Set(frozen.shifts.map((s) => s.id));
  const shifts = [
    ...bookings.map((b) => b.shift).filter((s) => !frozen.scheduleIds.has(s.scheduleId) && !frozenIds.has(s.id)),
    ...frozen.shifts.filter((s) => s.bookings.some((b) => b.userId === userId)),
  ];
  const effects = await absenceEffects(a.orgId, [userId], from, to);
  const days = new Map<string, DayMinutes>();
  const at = (d: string) => { if (!days.has(d)) days.set(d, { actual: 0, planned: 0 }); return days.get(d)!; };
  for (const r of records) at(r.date.toISOString().slice(0, 10)).actual += recordMinutes(r);
  // Bezahlte Abwesenheit zaehlt mit den Planstunden der Schicht als Ist - ausser es wurde fuer die Schicht doch Zeit erfasst.
  const worked = new Set(records.map((r) => r.shiftId).filter(Boolean));
  for (const s of shifts) {
    const d = shiftRange(s).date;
    if (d < from || d > to) continue;
    at(d).planned += plannedMinutes(s);
    if (effects.forShift(userId, s)?.handling === "PAID" && !worked.has(s.id)) at(d).actual += plannedMinutes(s);
  }
  return days;
}

export type AccountView = {
  memberId: string; enabled: boolean; active: boolean; method: AccountMethod; visible: boolean; canEdit: boolean;
  result: AccountResult; compensations: { id: string; date: string; minutes: number; description: string }[];
};

/**
 * Zeitkonto einer Person mit Konto bis zum Stichtag "to". 404, wenn man es
 * nicht sehen darf oder die Person nicht (mehr) Mitglied ist: Geloeschte
 * Personen haben kein Zeitkonto mehr (Konto, Soll und Ausgleich entfallen mit
 * der Mitgliedschaft), Platzhalter von Subunternehmern nie eines.
 */
export async function accountFor(a: Access, userId: string, to: string, known?: Settings): Promise<AccountView> {
  const settings = known ?? await accountSettings(a.orgId);
  const member = await db.organizationMember.findFirst({
    where: { organizationId: a.orgId, userId },
    include: { timeAccount: true, targetHours: { orderBy: { startDate: "asc" } }, compensations: { orderBy: { date: "asc" } } },
  });
  const visible = member?.timeAccount?.visible ?? settings.accountVisible;
  if (!member || !mayView(a, userId, visible)) throw new ApiError("Nicht gefunden.", 404);
  const method = member.timeAccount?.method ?? settings.accountMethod;
  const active = settings.accountsEnabled && (member.timeAccount?.included ?? true) && member.targetHours.length > 0;
  const base = { memberId: member.id, enabled: settings.accountsEnabled, method, visible, canEdit: a.isAdmin };
  const compensations = member.compensations.map((c) => ({ id: c.id, date: c.date.toISOString().slice(0, 10), minutes: c.minutes, description: c.description }));
  if (!active) return { ...base, active: false, result: null, compensations };
  const targets = member.targetHours.map((t) => ({ startDate: t.startDate.toISOString().slice(0, 10), minutes: t.minutes, period: t.period }));
  const start = targets[0].startDate;
  const days = start <= to ? await dayMinutes(a, userId, start, to) : new Map<string, DayMinutes>();
  const result = computeAccount({ targets, days, compensations: compensations.filter((c) => c.date <= to), method, today: berlinDate(), to });
  return { ...base, active: true, result, compensations };
}

/**
 * Salden mehrerer Personen fuer "Stunden und Lohn"; nur sichtbare und aktive
 * Konten. userIds sind Personen mit Konto - Zeilen geloeschter Personen
 * (userId null) und Platzhalter haben keinen Saldo.
 */
export async function balancesFor(a: Access, userIds: string[], to: string): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const settings = await accountSettings(a.orgId);
  if (!settings.accountsEnabled || !userIds.length) return out;
  const withTargets = await db.organizationMember.findMany({ where: { organizationId: a.orgId, userId: { in: userIds }, targetHours: { some: {} } }, select: { userId: true } });
  for (const { userId } of withTargets) {
    try {
      const view = await accountFor(a, userId, to, settings);
      if (view.active && view.result) out.set(userId, view.result.balanceMinutes);
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
    }
  }
  return out;
}
