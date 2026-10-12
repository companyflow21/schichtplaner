import { NextRequest } from "next/server";
import { z } from "zod";
import { api, body, ApiError } from "@/lib/api";
import { db } from "@/lib/db";
import { canStaff, requireAccess, staffHolders, staffIds } from "@/lib/access";
import { validDate } from "@/lib/berlin";
import { notify } from "@/lib/planning";
import { signalBookedSites } from "@/lib/conflicts";
import { applyEffects, effectsSchema } from "@/lib/absence-effects";

const include = {
  user: { select: { id: true, firstName: true, lastName: true, profileImage: true } },
  category: { select: { id: true, name: true, color: true, isPaid: true } },
} as const;

/**
 * Abwesenheiten: eigene immer; fremde nur fuer Admins und fuer Manager mit
 * "Abwesenheiten einsehen und entscheiden" fuer genau diese Person.
 */
export async function GET(request: NextRequest) {
  return api(async () => {
    const a = await requireAccess();
    const { searchParams } = request.nextUrl;
    const managed = staffIds(a, "MANAGE_ABSENCES");
    const scope = managed ? [a.userId, ...managed] : null;
    // Abwesenheiten deaktivierter Personen bleiben sichtbar (Verlauf); eintragen nur fuer aktive.
    const members = await db.organizationMember.findMany({ where: { organizationId: a.orgId, ...(scope ? { userId: { in: scope } } : {}) }, select: { userId: true, isActive: true } });
    const userIds = members.map((m) => m.userId);
    const activeIds = members.filter((m) => m.isActive).map((m) => m.userId);
    const where: Record<string, unknown> = { category: { organizationId: a.orgId }, userId: { in: userIds } };
    const yearParam = searchParams.get("year"), monthParam = searchParams.get("month");
    if (yearParam && !Number.isNaN(parseInt(yearParam, 10))) {
      const year = parseInt(yearParam, 10);
      where.dateFrom = { lte: new Date(`${year}-12-31`) };
      where.dateTo = { gte: new Date(`${year}-01-01`) };
    } else if (monthParam && /^\d{4}-(0[1-9]|1[0-2])$/.test(monthParam)) {
      const start = new Date(monthParam + "-01T00:00:00Z"), end = new Date(start);
      end.setUTCMonth(end.getUTCMonth() + 1);
      end.setUTCDate(0);
      where.dateFrom = { lte: end };
      where.dateTo = { gte: start };
    }
    const userIdParam = searchParams.get("userId");
    if (userIdParam && userIds.includes(userIdParam)) where.userId = userIdParam;
    const statusParam = searchParams.get("status");
    if (statusParam && ["PENDING", "APPROVED", "DECLINED"].includes(statusParam)) where.status = statusParam;
    const canManage = a.isAdmin || (managed?.length ?? 0) > 0;
    const [absences, all, people] = await Promise.all([
      db.absence.findMany({ where, include, orderBy: { dateFrom: "asc" } }),
      db.absence.findMany({ where: { category: { organizationId: a.orgId }, userId: { in: userIds } }, select: { status: true } }),
      canManage ? db.user.findMany({ where: { id: { in: activeIds } }, select: { id: true, firstName: true, lastName: true }, orderBy: [{ lastName: "asc" }, { firstName: "asc" }] }) : Promise.resolve([]),
    ]);
    const decides = (userId: string) => activeIds.includes(userId) && canStaff(a, "MANAGE_ABSENCES", userId) && (a.isAdmin || userId !== a.userId);
    return {
      absences: absences.map((x) => ({ ...x, canDecide: decides(x.userId) })),
      counts: { all: all.length, pending: all.filter((x) => x.status === "PENDING").length, approved: all.filter((x) => x.status === "APPROVED").length, declined: all.filter((x) => x.status === "DECLINED").length },
      canManage,
      // Personen, fuer die die Oberflaeche Abwesenheiten eintragen darf (eigene plus zugeordnete).
      people: people.map((p) => ({ userId: p.id, firstName: p.firstName, lastName: p.lastName })),
    };
  });
}

const createAbsenceSchema = z.object({
  userId: z.string().min(1),
  categoryId: z.string().min(1),
  dateFrom: z.string().refine(validDate, "Ungültiges Datum."),
  dateTo: z.string().refine(validDate, "Ungültiges Datum."),
  note: z.string().max(2000).optional(),
  status: z.enum(["PENDING", "APPROVED"]).optional(),
  /** Wirkung auf die Schichten im Zeitraum, nur bei sofortiger Genehmigung. */
  effects: effectsSchema.optional(),
});

export async function POST(request: NextRequest) {
  return api(async () => {
    const a = await requireAccess();
    const data = await body(request, createAbsenceSchema);
    const self = data.userId === a.userId;
    const manages = canStaff(a, "MANAGE_ABSENCES", data.userId) && (a.isAdmin || !self);
    if (!self && !manages) throw new ApiError("Nicht gefunden.", 404);
    const status = manages && data.status === "APPROVED" ? "APPROVED" : "PENDING";
    if (!await db.organizationMember.findFirst({ where: { organizationId: a.orgId, userId: data.userId, isActive: true } })) throw new ApiError("Nicht gefunden.", 404);
    const category = await db.absenceCategory.findFirst({ where: { id: data.categoryId, organizationId: a.orgId } });
    if (!category) throw new ApiError("Kategorie nicht gefunden.", 404);
    if (data.dateFrom > data.dateTo) throw new ApiError("Enddatum liegt vor dem Beginn.");
    const absence = await db.$transaction(async (tx) => {
      const created = await tx.absence.create({ data: { userId: data.userId, categoryId: data.categoryId, dateFrom: new Date(data.dateFrom), dateTo: new Date(data.dateTo), note: data.note || null, status, ...(status === "APPROVED" ? { approvedById: a.userId, approvedAt: new Date() } : {}) }, include });
      if (status === "APPROVED") await applyEffects(tx, a, created, category, data.effects);
      const recipients = status === "PENDING" ? await staffHolders(tx, a.orgId, data.userId, "MANAGE_ABSENCES") : [data.userId];
      await notify(tx, a.orgId, a.userId, recipients, status === "PENDING" ? "Neuer Abwesenheitsantrag" : "Abwesenheit genehmigt", data.dateFrom + " bis " + data.dateTo + " · " + category.name);
      return created;
    });
    // Genehmigte Abwesenheit macht Zuweisungen in diesem Zeitraum zum Konflikt: betroffene Plaene neu pruefen lassen.
    if (status === "APPROVED") await signalBookedSites(a.orgId, [data.userId], "schedule:updated", { from: data.dateFrom, to: data.dateTo });
    return Response.json({ absence }, { status: 201 });
  });
}
