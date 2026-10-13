import { api } from "@/lib/api";
import { db } from "@/lib/db";
import { requireAccess, requireAdmin } from "@/lib/access";

/** Lohneinstellungen: Lohnarten, Zuschlaege, Personalnummer und Lohnart je Person und Arbeitsbereich. Nur Admins. */
export async function GET() {
  return api(async () => {
    const a = await requireAccess();
    requireAdmin(a);
    const [payTypes, surcharges, members, divisions] = await Promise.all([
      db.payType.findMany({ where: { organizationId: a.orgId }, orderBy: { title: "asc" } }),
      db.surcharge.findMany({ where: { organizationId: a.orgId }, orderBy: { name: "asc" } }),
      db.organizationMember.findMany({ where: { organizationId: a.orgId }, select: { id: true, userId: true, isActive: true, personnelNumber: true, payTypeId: true, user: { select: { firstName: true, lastName: true } } } }),
      db.division.findMany({ where: { organizationId: a.orgId, deletedAt: null }, select: { id: true, title: true, color: true, payTypeId: true }, orderBy: { title: "asc" } }),
    ]);
    return {
      payTypes, surcharges, divisions,
      members: members
        .map((m) => ({ memberId: m.id, userId: m.userId, firstName: m.user.firstName, lastName: m.user.lastName, isActive: m.isActive, personnelNumber: m.personnelNumber, payTypeId: m.payTypeId }))
        .sort((x, y) => Number(y.isActive) - Number(x.isActive) || x.lastName.localeCompare(y.lastName, "de") || x.firstName.localeCompare(y.firstName, "de")),
    };
  });
}
