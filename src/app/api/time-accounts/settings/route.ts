import { api } from "@/lib/api";
import { db } from "@/lib/db";
import { requireAccess, requireAdmin } from "@/lib/access";
import { accountSettings } from "@/lib/time-account-service";

/** Einstellungen der Zeitkonten mit allen Personen, ihren Abweichungen und Soll-Eintraegen. Nur Admins. */
export async function GET() {
  return api(async () => {
    const a = await requireAccess();
    requireAdmin(a);
    const [settings, members] = await Promise.all([
      accountSettings(a.orgId),
      db.organizationMember.findMany({
        where: { organizationId: a.orgId },
        select: { id: true, userId: true, isActive: true, targetHoursPerMonth: true, user: { select: { firstName: true, lastName: true } }, timeAccount: true, targetHours: { orderBy: { startDate: "asc" } } },
      }),
    ]);
    return {
      settings,
      members: members
        .map((m) => ({
          memberId: m.id, userId: m.userId, firstName: m.user.firstName, lastName: m.user.lastName, isActive: m.isActive, targetHoursPerMonth: m.targetHoursPerMonth,
          included: m.timeAccount?.included ?? true, method: m.timeAccount?.method ?? null, visible: m.timeAccount?.visible ?? null,
          targets: m.targetHours.map((t) => ({ id: t.id, startDate: t.startDate.toISOString().slice(0, 10), minutes: t.minutes, period: t.period })),
        }))
        .sort((x, y) => Number(y.isActive) - Number(x.isActive) || x.lastName.localeCompare(y.lastName, "de") || x.firstName.localeCompare(y.firstName, "de")),
    };
  });
}
