import { z } from "zod";
import { Prisma } from "@prisma/client";
import { api, body, serial, ApiError } from "@/lib/api";
import { requireAccess, requireAdmin } from "@/lib/access";
import { normalizeQualification } from "@/lib/qualifications";
import { berlinDate, isoWeek } from "@/lib/berlin";

type Params = { params: Promise<{ id: string }> };

/** Ersetzt Eintraege mit alter Vergleichsform durch die neue Schreibweise; Reihenfolge bleibt, Doppelte entfallen. */
function replaced(list: string[], oldKey: string, name: string): string[] | null {
  if (!list.some((q) => normalizeQualification(q) === oldKey)) return null;
  const out: string[] = [];
  for (const q of list) {
    const value = normalizeQualification(q) === oldKey ? name : q;
    const key = normalizeQualification(value);
    if (!out.some((o) => normalizeQualification(o) === key)) out.push(value);
  }
  return out.join("\u0000") === list.join("\u0000") ? null : out;
}

/** Katalogeintrag umbenennen - nur Admins. Zuordnungen bei Mitarbeitenden und Schichten (auch vergangene) ziehen mit. */
export async function PATCH(request: Request, context: Params) {
  return api(async () => {
    const a = await requireAccess();
    requireAdmin(a);
    const { id } = await context.params;
    const { name } = await body(request, z.object({ name: z.string().trim().min(1, "Bitte einen Namen eingeben.").max(100) }));
    const newKey = normalizeQualification(name);
    try {
      return await serial(async (tx) => {
        const entry = await tx.qualification.findFirst({ where: { id, organizationId: a.orgId }, select: { normalizedName: true } });
        if (!entry) throw new ApiError("Qualifikation nicht gefunden.", 404);
        if (await tx.qualification.findFirst({ where: { organizationId: a.orgId, normalizedName: newKey, NOT: { id } }, select: { id: true } })) throw new ApiError("Diese Qualifikation gibt es bereits.", 409);
        const oldKey = entry.normalizedName;
        const qualification = await tx.qualification.update({ where: { id }, data: { name, normalizedName: newKey }, select: { id: true, name: true } });
        const members = await tx.organizationMember.findMany({ where: { organizationId: a.orgId, NOT: { qualifications: { isEmpty: true } } }, select: { id: true, qualifications: true } });
        for (const m of members) {
          const next = replaced(m.qualifications, oldKey, name);
          if (next) await tx.organizationMember.update({ where: { id: m.id }, data: { qualifications: next } });
        }
        const shifts = await tx.shift.findMany({ where: { schedule: { organizationId: a.orgId }, NOT: { requiredQualifications: { isEmpty: true } } }, select: { id: true, requiredQualifications: true } });
        for (const s of shifts) {
          const next = replaced(s.requiredQualifications, oldKey, name);
          if (next) await tx.shift.update({ where: { id: s.id }, data: { requiredQualifications: next } });
        }
        return { qualification };
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new ApiError("Diese Qualifikation gibt es bereits.", 409);
      throw error;
    }
  });
}

/** Katalogeintrag loeschen - nur Admins, nur wenn niemand ihn mehr aktiv nutzt. Vergangene Schichten behalten ihren Text. */
export async function DELETE(_request: Request, context: Params) {
  return api(async () => {
    const a = await requireAccess();
    requireAdmin(a);
    const { id } = await context.params;
    const now = isoWeek(berlinDate());
    return serial(async (tx) => {
      const entry = await tx.qualification.findFirst({ where: { id, organizationId: a.orgId }, select: { normalizedName: true } });
      if (!entry) throw new ApiError("Qualifikation nicht gefunden.", 404);
      const key = entry.normalizedName;
      const members = (await tx.organizationMember.findMany({ where: { organizationId: a.orgId, isActive: true, NOT: { qualifications: { isEmpty: true } } }, select: { qualifications: true } }))
        .filter((m) => m.qualifications.some((q) => normalizeQualification(q) === key)).length;
      const shifts = (await tx.shift.findMany({
        where: { deletedAt: null, NOT: { requiredQualifications: { isEmpty: true } }, schedule: { organizationId: a.orgId, OR: [{ year: { gt: now.year } }, { year: now.year, weekNumber: { gte: now.weekNumber } }] } },
        select: { requiredQualifications: true },
      })).filter((s) => s.requiredQualifications.some((q) => normalizeQualification(q) === key)).length;
      if (members || shifts) {
        const parts = [members && members + " Mitarbeitenden", shifts && shifts + (shifts === 1 ? " künftigen Schicht" : " künftigen Schichten")].filter(Boolean);
        throw new ApiError("Wird noch bei " + parts.join(" und ") + " verwendet. Bitte dort zuerst entfernen.", 409);
      }
      await tx.qualification.delete({ where: { id } });
      return { success: true };
    });
  });
}
