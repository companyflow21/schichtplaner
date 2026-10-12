import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { api, body, serial } from "@/lib/api";
import { requireAccess, requireAdmin } from "@/lib/access";
import { effectiveRules, partialRulesSchema } from "@/lib/planning-rules";
import { ruleSettings } from "@/lib/planning-rules-service";

/** Allgemeine Regeln (vollstaendig, mit Vorgaben) und die Abweichungen je Person. Nur Admins. */
export async function GET() {
  return api(async () => {
    const a = await requireAccess();
    requireAdmin(a);
    return serial(async (tx) => {
      const { general, overrides } = await ruleSettings(tx, a.orgId);
      const members = await tx.organizationMember.findMany({ where: { organizationId: a.orgId, isActive: true }, select: { id: true, userId: true, user: { select: { firstName: true, lastName: true } } } });
      return {
        general: effectiveRules(general),
        members: members.map((m) => ({ memberId: m.id, userId: m.userId, firstName: m.user.firstName, lastName: m.user.lastName, own: overrides.get(m.id) ?? {} }))
          .sort((x, y) => x.lastName.localeCompare(y.lastName, "de") || x.firstName.localeCompare(y.firstName, "de")),
      };
    });
  });
}

/** Einzelne allgemeine Regeln speichern (jede genannte Regel ganz). Nur Admins. */
export async function PUT(request: Request) {
  return api(async () => {
    const a = await requireAccess();
    requireAdmin(a);
    const { rules } = await body(request, z.object({ rules: partialRulesSchema }));
    return serial(async (tx) => {
      const { general } = await ruleSettings(tx, a.orgId);
      const next = { ...general, ...rules } as Prisma.InputJsonObject;
      await tx.planningRules.upsert({ where: { organizationId: a.orgId }, create: { organizationId: a.orgId, rules: next }, update: { rules: next } });
      return { general: effectiveRules({ ...general, ...rules }) };
    });
  });
}
