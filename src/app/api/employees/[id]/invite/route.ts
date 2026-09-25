import { api, ApiError } from "@/lib/api";
import { db } from "@/lib/db";
import { requireAccess } from "@/lib/access";
import { activationUrl } from "@/lib/staff-sites";

/**
 * Neuer Aktivierungslink (der alte verliert seine Gueltigkeit). Admins fuer
 * jedes noch nicht aktivierte Konto; Manager nur fuer Mitarbeitende, die sie
 * selbst angelegt haben und die ihnen weiterhin zugeordnet sind - sonst
 * koennte ein Manager fremde Konten vor deren Inhaber aktivieren.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return api(async () => {
    const a = await requireAccess();
    const { id } = await context.params;
    const target = await db.organizationMember.findFirst({ where: { id, organizationId: a.orgId } });
    const allowed = !!target && (a.isAdmin || (a.role === "MANAGER" && target.role === "EMPLOYEE" && target.createdByMemberId === a.memberId && a.staff.has(target.userId)));
    if (!target || !allowed) throw new ApiError(a.isAdmin ? "Nicht gefunden." : "Keine Berechtigung.", a.isAdmin ? 404 : 403);
    if (!target.isActive || target.isActivated) throw new ApiError("Konto ist bereits aktiviert oder nicht aktiv.", 409);
    const token = crypto.randomUUID();
    await db.organizationMember.update({ where: { id }, data: { activationToken: token, activationExpiresAt: new Date(Date.now() + 7 * 86400000) } });
    return { url: activationUrl(request, token) };
  });
}
