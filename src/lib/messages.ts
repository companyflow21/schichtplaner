import { db } from "./db";
import { berlinDate, addDate, isoWeek, weekDate } from "./berlin";
import { can, canSee, branchIds, anyBranchIds, branchHolders, type Access } from "./access";
import { ApiError } from "./errors";

type Recipient = { userId: string; isRead: boolean; isDeleted: boolean; user?: { id: string; firstName: string; lastName: string; profileImage?: string | null } };

/**
 * Empfaengerliste fuer die Ausgabe: nur Personen, die die betrachtende Person
 * auch sonst sehen darf; der Rest erscheint nur als Anzahl.
 */
export function recipientsFor<T extends Recipient>(recipients: T[], people: Set<string> | null, viewerId: string) {
  const visible = recipients.filter((r) => r.userId === viewerId || canSee(people, r.userId));
  return { recipients: visible, hiddenRecipients: recipients.length - visible.length };
}

/**
 * Standort einer Schicht fuer den Nachrichtenbezug: null bei Altbestand ohne
 * Standort, undefined wenn die Schicht fuer die Person gar nicht sichtbar ist.
 * Sichtbar sind planende Manager/Admins sowie - bei veroeffentlichten Plaenen -
 * gebuchte oder zur Standortanfrage berechtigte Personen (wie im Dienstplan).
 */
export async function shiftBranchForMessage(a: Access, shiftId: string): Promise<string | null | undefined> {
  const shift = await db.shift.findFirst({
    where: { id: shiftId, deletedAt: null, schedule: { organizationId: a.orgId, deletedAt: null } },
    select: { schedule: { select: { branchId: true, isPublic: true } }, bookings: { where: { userId: a.userId }, select: { id: true } } },
  });
  if (!shift) return undefined;
  const branchId = shift.schedule.branchId;
  const planner = can(a, "VIEW_SCHEDULE", branchId) && (a.isAdmin || a.role === "MANAGER");
  const visible = planner || (shift.schedule.isPublic && (shift.bookings.length > 0 || can(a, "REQUEST_SHIFTS", branchId)));
  return visible ? branchId : undefined;
}

/** Standorte, auf die die Person in einer Nachricht verweisen darf (Task 1: eigene Planungsstandorte oder Standort einer veroeffentlichten eigenen Buchung). */
export async function referencableBranches(a: Access): Promise<{ id: string; name: string }[]> {
  if (a.isAdmin) {
    return db.branch.findMany({ where: { organizationId: a.orgId, isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } });
  }
  const ids = new Set<string>(anyBranchIds(a) ?? []);
  const booked = await db.schedule.findMany({
    where: { organizationId: a.orgId, branchId: { not: null }, isPublic: true, deletedAt: null, shifts: { some: { deletedAt: null, bookings: { some: { userId: a.userId } } } } },
    select: { branchId: true },
    distinct: ["branchId"],
  });
  for (const s of booked) if (s.branchId) ids.add(s.branchId);
  if (!ids.size) return [];
  return db.branch.findMany({ where: { id: { in: [...ids] }, organizationId: a.orgId }, select: { id: true, name: true }, orderBy: { name: "asc" } });
}

/** Darf die Person auf diesen Standort verweisen? Existenz eines fremden Standorts wird nicht preisgegeben. */
export async function branchVisibleForMessage(a: Access, branchId: string): Promise<boolean> {
  const branch = await db.branch.findFirst({ where: { id: branchId, organizationId: a.orgId }, select: { id: true } });
  if (!branch) return false;
  if (a.isAdmin) return true;
  const allowed = await referencableBranches(a);
  return allowed.some((b) => b.id === branchId);
}

/**
 * Loest den optionalen Schicht-/Standortbezug einer neuen Nachricht auf.
 * Wirft 404 fuer eine unsichtbare/fremde Schicht oder einen unsichtbaren/
 * fremden Standort (ohne dessen Existenz preiszugeben) und 400, wenn Schicht
 * und angegebener Standort nicht zusammenpassen.
 */
export async function resolveMessageReference(a: Access, shiftId: string | undefined, branchId: string | undefined): Promise<{ shiftId?: string; branchId?: string }> {
  if (shiftId) {
    const derived = await shiftBranchForMessage(a, shiftId);
    if (derived === undefined) throw new ApiError("Schicht nicht gefunden.", 404);
    if (derived) {
      if (branchId && branchId !== derived) throw new ApiError("Schicht und Standort passen nicht zusammen.", 400);
      return { shiftId, branchId: derived };
    }
    // Altbestand ohne Standort: ein zusaetzlich angegebener Standort wird eigenstaendig geprueft.
    if (branchId) {
      if (!(await branchVisibleForMessage(a, branchId))) throw new ApiError("Standort nicht gefunden.", 404);
      return { shiftId, branchId };
    }
    return { shiftId };
  }
  if (branchId) {
    if (!(await branchVisibleForMessage(a, branchId))) throw new ApiError("Standort nicht gefunden.", 404);
    return { branchId };
  }
  return {};
}

const WEEKDAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

/** Lesbarer Bezugstext fuer Liste und Detailansicht; null ohne Bezug. */
export function messageReference(message: {
  shift?: { dayOfWeek: number; shiftFrom: string; shiftTo: string; schedule: { year: number; weekNumber: number; branch: { name: string } | null } } | null;
  branch?: { name: string } | null;
}): string | null {
  if (message.shift) {
    const date = weekDate(message.shift.schedule.year, message.shift.schedule.weekNumber, message.shift.dayOfWeek);
    const [, m, d] = date.split("-");
    const weekday = WEEKDAYS[(message.shift.dayOfWeek - 1 + 7) % 7];
    const site = message.shift.schedule.branch?.name;
    return `Bezug: Schicht ${weekday} ${d}.${m}. ${message.shift.shiftFrom}–${message.shift.shiftTo}${site ? " · " + site : ""}`;
  }
  if (message.branch) return `Bezug: Standort ${message.branch.name}`;
  return null;
}

/** Feld-Auswahl, um shift/branch fuer messageReference() mitzuladen. */
export const referenceInclude = {
  shift: { select: { dayOfWeek: true, shiftFrom: true, shiftTo: true, schedule: { select: { year: true, weekNumber: true, branch: { select: { name: true } } } } } },
  branch: { select: { name: true } },
} as const;

export type RecipientGroup = "zustaendig" | "administration" | "weitere";

/**
 * Personen, die fuer eine Mitarbeiterin/einen Mitarbeiter als "zustaendig"
 * gelten: zugeordnete Manager (Personalzuordnung) sowie Manager mit
 * "Schichten bearbeiten" oder "Anfragen bearbeiten" an einem Standort, an dem
 * die Person offene Schichten anfragen darf oder veroeffentlicht gebucht ist.
 */
async function responsibleManagerIds(a: Access): Promise<Set<string>> {
  const ids = new Set<string>();
  const assignments = await db.staffAssignment.findMany({
    where: { organizationId: a.orgId, employeeMemberId: a.memberId, manager: { isActive: true, role: "MANAGER" } },
    select: { manager: { select: { userId: true } } },
  });
  for (const s of assignments) ids.add(s.manager.userId);
  const requestBranches = branchIds(a, "REQUEST_SHIFTS") ?? [];
  const booked = await db.schedule.findMany({
    where: { organizationId: a.orgId, branchId: { not: null }, isPublic: true, deletedAt: null, shifts: { some: { deletedAt: null, bookings: { some: { userId: a.userId } } } } },
    select: { branchId: true },
    distinct: ["branchId"],
  });
  const sites = new Set<string>([...requestBranches, ...booked.map((s) => s.branchId!).filter(Boolean)]);
  for (const branchId of sites) {
    const planners = await branchHolders(db, a.orgId, branchId, ["EDIT_SHIFTS", "HANDLE_REQUESTS"], false);
    for (const id of planners) ids.add(id);
  }
  return ids;
}

/**
 * Ordnet die sichtbaren Empfaenger in Gruppen ein, ohne den sichtbaren
 * Personenkreis zu erweitern. Fuer Mitarbeitende: zustaendig/administration/
 * weitere; fuer Manager und Administration: nur administration/weitere.
 */
export async function classifyRecipients(a: Access, members: { userId: string; role: string }[]): Promise<{ group: Map<string, RecipientGroup>; noResponsible: boolean }> {
  const group = new Map<string, RecipientGroup>();
  const isEmployee = !a.isAdmin && a.role === "EMPLOYEE";
  const responsible = isEmployee ? await responsibleManagerIds(a) : new Set<string>();
  for (const m of members) {
    if (m.role === "OWNER" || m.role === "ADMIN") group.set(m.userId, "administration");
    else if (isEmployee && responsible.has(m.userId)) group.set(m.userId, "zustaendig");
    else group.set(m.userId, "weitere");
  }
  const noResponsible = isEmployee && !members.some((m) => group.get(m.userId) === "zustaendig");
  return { group, noResponsible };
}

/** Die ISO-Kalenderwochen (Jahr/KW), die ein Zeitraum ab "from" ueberdeckt. */
function weeksInRange(from: string, days: number): { year: number; weekNumber: number }[] {
  const seen = new Map<string, { year: number; weekNumber: number }>();
  for (let i = 0; i <= days; i++) {
    const w = isoWeek(addDate(from, i));
    seen.set(w.year + "-" + w.weekNumber, w);
  }
  return [...seen.values()];
}

/**
 * Schichten, auf die die Person in einer Nachricht verweisen darf (Task 4):
 * eigene veroeffentlichte Buchungen der naechsten 30 Tage, fuer Planer
 * zusaetzlich Schichten ihrer "Schichten bearbeiten"-Standorte im selben
 * Zeitraum. Hoechstens 50 Eintraege, nach Datum sortiert.
 */
export async function referencableShifts(a: Access): Promise<{ id: string; date: string; shiftFrom: string; shiftTo: string; title: string | null; branchName: string | null }[]> {
  const today = berlinDate();
  const until = addDate(today, 30);
  const weeks = weeksInRange(today, 30);
  const select = {
    id: true,
    dayOfWeek: true,
    shiftFrom: true,
    shiftTo: true,
    title: true,
    schedule: { select: { year: true, weekNumber: true, branch: { select: { name: true } } } },
  } as const;
  const own = await db.shift.findMany({
    where: { deletedAt: null, schedule: { organizationId: a.orgId, isPublic: true, deletedAt: null }, bookings: { some: { userId: a.userId } } },
    select,
  });
  const editBranches = branchIds(a, "EDIT_SHIFTS");
  const plannerShifts =
    a.isAdmin || (editBranches && editBranches.length)
      ? await db.shift.findMany({
          where: {
            deletedAt: null,
            schedule: {
              organizationId: a.orgId,
              isPublic: true,
              deletedAt: null,
              ...(editBranches ? { branchId: { in: editBranches } } : {}),
              OR: weeks.map((w) => ({ year: w.year, weekNumber: w.weekNumber })),
            },
          },
          select,
          take: 300,
        })
      : [];
  const byId = new Map<string, (typeof own)[number]>();
  for (const s of [...own, ...plannerShifts]) byId.set(s.id, s);
  const result: { id: string; date: string; shiftFrom: string; shiftTo: string; title: string | null; branchName: string | null }[] = [];
  for (const s of byId.values()) {
    const date = weekDate(s.schedule.year, s.schedule.weekNumber, s.dayOfWeek);
    if (date < today || date > until) continue;
    result.push({ id: s.id, date, shiftFrom: s.shiftFrom, shiftTo: s.shiftTo, title: s.title, branchName: s.schedule.branch?.name ?? null });
  }
  result.sort((x, z) => (x.date + x.shiftFrom).localeCompare(z.date + z.shiftFrom));
  return result.slice(0, 50);
}
