/**
 * Zusaetzliche "Offene Aufgaben" der Startseite fuer die Planung - jeweils
 * nur im Rahmen der Rechte und mit Sprungziel. null: keine Zustaendigkeit,
 * der Eintrag entfaellt (eine Null wuerde Zustaendigkeit vortaeuschen).
 */
import { db } from "./db";
import { isoWeek } from "./berlin";
import { formatKW } from "./utils/calendar";
import type { Access } from "./access";
import type { planningOverview } from "./overview";

type Overview = Awaited<ReturnType<typeof planningOverview>>;

/** Eine Schicht in der Form, wie shiftView sie ausgibt - nur die Felder der Zählregel. */
type ConfirmationShift = {
  isPublic: boolean;
  /** Echtes Ende als ISO-Zeitpunkt (shiftView.endsAt); beendet heißt endsAt <= jetzt, wie shiftEnded() in planning.ts. */
  endsAt: string;
  bookings: { userId: string | null; former?: boolean; confirmedAt: Date | string | null; confirmation?: "PLANNER" | "EMPLOYEE" | null }[];
};

/**
 * Zählregel "Bestätigungen offen" - Startseite und Wochenplan zählen gleich:
 * Gezählt wird jede Buchung mit Person (userId gesetzt, keine gelöschte
 * Person), ohne confirmedAt und nicht confirmation === "PLANNER" (Einteilungen
 * der Planung sind verbindlich) - und nur an noch nicht beendeten Schichten
 * (shiftEnded aus planning.ts, siehe archive.ts). Entwürfe sind für
 * Mitarbeitende unsichtbar und haben nichts zu bestätigen.
 */
export function openConfirmations(shift: ConfirmationShift, now = new Date()): number {
  if (!shift.isPublic || Date.parse(shift.endsAt) <= now.getTime()) return 0;
  return shift.bookings.filter((b) => !!b.userId && !b.former && !b.confirmedAt && b.confirmation !== "PLANNER").length;
}

export type DashboardTasks = {
  /** Aktive, nicht freigeschaltete Personen (Link: /employees?status=not_activated). */
  notActivated: number | null;
  /** Summe der Entwurfswochen ueber alle Standortkarten. */
  draftWeeks: number | null;
  /** Wochenplan der fruehesten Entwurfswoche am ersten betroffenen Standort. */
  draftHref: string | null;
};

/**
 * Derselbe Umfang wie der Zaehler "Nicht freigeschaltet" in GET /api/employees:
 * Admins die ganze Organisation, Manager nur ihnen zugeordnete Personen,
 * Mitarbeitende nichts.
 */
async function notActivated(a: Access): Promise<number | null> {
  if (!a.isAdmin && a.role !== "MANAGER") return null;
  const staff = a.isAdmin ? null : [...a.staff.keys()];
  if (staff && !staff.length) return null;
  return db.organizationMember.count({ where: { organizationId: a.orgId, isActive: true, isActivated: false, ...(staff ? { userId: { in: staff } } : {}) } });
}

export async function dashboardTasks(a: Access, overview: Overview): Promise<DashboardTasks> {
  // draftWeeks ist nur dort gesetzt, wo Entwuerfe sichtbar sind (Planung mit "Dienstplan ansehen").
  const cards = [...overview.customers.flatMap((c) => c.branches), ...overview.unassigned].filter((b) => b.draftWeeks !== null);
  const first = cards.find((b) => b.draftWeeks! > 0);
  const firstDraft = first && overview.views.filter((s) => s.branchId === first.id && !s.isPublic).map((s) => s.date).sort()[0];
  const week = firstDraft ? isoWeek(firstDraft) : null;
  return {
    notActivated: await notActivated(a),
    draftWeeks: cards.length ? cards.reduce((sum, b) => sum + b.draftWeeks!, 0) : null,
    draftHref: first && week ? `/schedule/flexible/${formatKW(week.weekNumber, week.year)}?standort=${first.id}` : null,
  };
}
