import { api } from "@/lib/api";
import { db } from "@/lib/db";
import { requireAccess, visiblePeople } from "@/lib/access";
import { classifyRecipients } from "@/lib/messages";

/** Personen, denen die angemeldete Person schreiben darf - nur Namen, gruppiert nach Zustaendigkeit. */
export async function GET() {
  return api(async () => {
    const a = await requireAccess();
    const people = await visiblePeople(a);
    const members = await db.organizationMember.findMany({
      where: { organizationId: a.orgId, isActive: true, userId: { not: a.userId, ...(people ? { in: [...people] } : {}) } },
      select: { role: true, user: { select: { id: true, firstName: true, lastName: true, profileImage: true } } },
      orderBy: [{ user: { lastName: "asc" } }, { user: { firstName: "asc" } }],
    });
    const { group, noResponsible } = await classifyRecipients(a, members.map((m) => ({ userId: m.user.id, role: m.role })));
    return { recipients: members.map((m) => ({ ...m.user, role: m.role, group: group.get(m.user.id) })), noResponsible };
  });
}
