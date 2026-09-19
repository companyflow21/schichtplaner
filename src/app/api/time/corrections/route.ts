import { z } from "zod";
import { api, body, requireMember, serial, ApiError } from "@/lib/api";
import { db } from "@/lib/db";
import { isManagerOrAbove } from "@/lib/auth-helpers";
import { timeChange, validatedTimeChange } from "@/lib/time-service";
import { notify } from "@/lib/planning";
export async function GET() {
  return api(async () => {
    const m = await requireMember();
    return { corrections: await db.timeCorrection.findMany({ where: { organizationId: m.organizationId, ...(!isManagerOrAbove(m.role) ? { record: { userId: m.userId } } : {}) }, include: { record: { include: { user: { select: { firstName: true, lastName: true } } } } }, orderBy: { createdAt: "desc" }, take: 100 }) };
  });
}
export async function PATCH(request: Request) {
  return api(async () => {
    const m = await requireMember(true);
    const { id, status } = await body(request, z.object({ id: z.string(), status: z.enum(["APPROVED", "DECLINED"]) }));
    return serial(async tx => {
      const c = await tx.timeCorrection.findFirst({ where: { id, organizationId: m.organizationId }, include: { record: true } });
      if (!c) throw new ApiError("Korrektur nicht gefunden.", 404);
      if (c.status !== "PENDING") throw new ApiError("Korrektur bereits entschieden.", 409);
      if (status === "APPROVED") {
        const before = c.before as { updatedAt: string };
        if (before.updatedAt !== c.record.updatedAt.toISOString()) throw new ApiError("Die Zeitbuchung wurde inzwischen geändert. Bitte Antrag ablehnen und neu erfassen.", 409);
        const data = timeChange.parse(c.proposed);
        await tx.timeRecord.update({ where: { id: c.recordId }, data: await validatedTimeChange(tx, m.organizationId, c.record, data) });
      }
      const correction = await tx.timeCorrection.update({ where: { id }, data: { status, reviewedBy: m.userId, reviewedAt: new Date() } });
      await notify(tx, m.organizationId, m.userId, [c.record.userId], status === "APPROVED" ? "Zeitkorrektur genehmigt" : "Zeitkorrektur abgelehnt", c.reason);
      return { correction };
    });
  });
}
