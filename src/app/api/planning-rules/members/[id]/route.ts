import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { api, body, serial, ApiError } from "@/lib/api";
import { requireAccess, requireAdmin } from "@/lib/access";
import { RULE_KEYS, partialRulesSchema, type PartialRules } from "@/lib/planning-rules";
import { ruleSettings } from "@/lib/planning-rules-service";

type Params = { params: Promise<{ id: string }> };
const input = z.object({ rules: partialRulesSchema.default({}), reset: z.array(z.enum(RULE_KEYS)).max(RULE_KEYS.length).default([]) });

/**
 * Abweichende Regeln einer Person: "rules" setzt einzelne Regeln, "reset"
 * stellt einzelne wieder auf die allgemeine Regel. Nur Admins.
 */
export async function PUT(request: Request, context: Params) {
  return api(async () => {
    const a = await requireAccess();
    requireAdmin(a);
    const { id } = await context.params;
    const data = await body(request, input);
    return serial(async (tx) => {
      if (!await tx.organizationMember.findFirst({ where: { id, organizationId: a.orgId }, select: { id: true } })) throw new ApiError("Nicht gefunden.", 404);
      const { overrides } = await ruleSettings(tx, a.orgId);
      const own: PartialRules = { ...overrides.get(id), ...data.rules };
      for (const key of data.reset) delete own[key];
      if (!Object.keys(own).length) await tx.planningRuleOverride.deleteMany({ where: { memberId: id } });
      else await tx.planningRuleOverride.upsert({ where: { memberId: id }, create: { organizationId: a.orgId, memberId: id, rules: own as Prisma.InputJsonObject }, update: { rules: own as Prisma.InputJsonObject } });
      return { own };
    });
  });
}
