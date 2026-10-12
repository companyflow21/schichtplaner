import { z } from "zod";
import { api, body, ApiError } from "@/lib/api";
import { db } from "@/lib/db";
import { requireAccess, requireAdmin } from "@/lib/access";
import { validDate } from "@/lib/berlin";

type Params = { params: Promise<{ id: string }> };
const input = z.object({
  included: z.boolean().optional(),
  daysPerYear: z.number().min(0).max(366).nullable().optional(),
  startDate: z.string().refine(validDate, "Ungültiges Datum.").nullable().optional(),
  carryOver: z.boolean().nullable().optional(),
});

/** Abweichende Urlaubsregeln einer Person (null = allgemein). Nur Admins. */
export async function PUT(request: Request, context: Params) {
  return api(async () => {
    const a = await requireAccess();
    requireAdmin(a);
    const { id } = await context.params;
    const data = await body(request, input);
    if (!await db.organizationMember.findFirst({ where: { id, organizationId: a.orgId }, select: { id: true } })) throw new ApiError("Nicht gefunden.", 404);
    const values = { ...data, ...(data.startDate !== undefined ? { startDate: data.startDate ? new Date(data.startDate) : null } : {}) };
    const rule = await db.vacationRule.upsert({ where: { memberId: id }, create: { organizationId: a.orgId, memberId: id, ...values }, update: values });
    return { rule };
  });
}
