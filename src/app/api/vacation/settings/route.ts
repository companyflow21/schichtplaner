import { z } from "zod";
import { api, body, ApiError } from "@/lib/api";
import { db } from "@/lib/db";
import { requireAccess, requireAdmin } from "@/lib/access";
import { berlinDate, validDate } from "@/lib/berlin";
import { vacationYear } from "@/lib/vacation";

/** Regeln des Urlaubskontos mit Personen und ihren Abweichungen. Nur Admins. */
export async function GET() {
  return api(async () => {
    const a = await requireAccess();
    requireAdmin(a);
    const [settings, members, categories] = await Promise.all([
      db.vacationSettings.findUnique({ where: { organizationId: a.orgId } }),
      db.organizationMember.findMany({ where: { organizationId: a.orgId, isActive: true }, select: { id: true, userId: true, user: { select: { firstName: true, lastName: true } }, vacationRule: true } }),
      db.absenceCategory.findMany({ where: { organizationId: a.orgId }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    ]);
    return {
      settings: settings ? { ...settings, startDate: settings.startDate?.toISOString().slice(0, 10) ?? null } : null, categories,
      members: members.map((m) => ({
        memberId: m.id, userId: m.userId, firstName: m.user.firstName, lastName: m.user.lastName,
        included: m.vacationRule?.included ?? true, daysPerYear: m.vacationRule?.daysPerYear ?? null,
        startDate: m.vacationRule?.startDate?.toISOString().slice(0, 10) ?? null, carryOver: m.vacationRule?.carryOver ?? null,
      })).sort((x, y) => x.lastName.localeCompare(y.lastName, "de") || x.firstName.localeCompare(y.firstName, "de")),
    };
  });
}

const input = z.object({
  enabled: z.boolean().optional(),
  categoryId: z.string().min(1).nullable().optional(),
  yearStart: z.string().regex(/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, "Beginn des Urlaubsjahres als MM-TT.").optional(),
  startDate: z.string().refine(validDate, "Ungültiges Datum.").nullable().optional(),
  daysPerYear: z.number().min(0).max(366).optional(),
  allocation: z.enum(["YEARLY", "MONTHLY"]).optional(),
  carryOver: z.boolean().optional(),
  carryOverMax: z.number().min(0).max(366).nullable().optional(),
  excludedWeekdays: z.array(z.number().int().min(1).max(7)).max(7).optional(),
  countHolidays: z.boolean().optional(),
  visible: z.boolean().optional(),
});

/** Regeln speichern. Beim ersten Einschalten beginnt das Konto mit dem aktuellen Urlaubsjahr. Nur Admins. */
export async function PATCH(request: Request) {
  return api(async () => {
    const a = await requireAccess();
    requireAdmin(a);
    const data = await body(request, input);
    if (data.categoryId && !await db.absenceCategory.findFirst({ where: { id: data.categoryId, organizationId: a.orgId }, select: { id: true } })) throw new ApiError("Abwesenheitsart nicht gefunden.", 404);
    const existing = await db.vacationSettings.findUnique({ where: { organizationId: a.orgId } });
    const yearStart = data.yearStart ?? existing?.yearStart ?? "01-01";
    const startDate = data.startDate !== undefined ? (data.startDate ? new Date(data.startDate) : null) : existing?.startDate ?? (data.enabled ? new Date(vacationYear(berlinDate(), yearStart).from) : undefined);
    const values = { ...data, startDate, ...(data.excludedWeekdays ? { excludedWeekdays: [...new Set(data.excludedWeekdays)].sort() } : {}) };
    const settings = await db.vacationSettings.upsert({ where: { organizationId: a.orgId }, create: { organizationId: a.orgId, ...values }, update: values });
    return { settings };
  });
}
