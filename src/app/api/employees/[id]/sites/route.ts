import { z } from "zod";
import { api, body, serial, ApiError } from "@/lib/api";
import { db } from "@/lib/db";
import { requireAccess, type Access } from "@/lib/access";
import { canManageSites, setSites, sitesOf } from "@/lib/staff-sites";
import { refreshRealtime } from "@/lib/emit";

type Context = { params: Promise<{ id: string }> };

async function targetFor(a: Access, id: string) {
  const target = await db.organizationMember.findFirst({ where: { id, organizationId: a.orgId }, select: { id: true, userId: true, role: true, isActive: true } });
  if (target && canManageSites(a, target)) return target;
  if (target && a.isAdmin) throw new ApiError("Standorte werden nur Mitarbeitenden zugeordnet. Manager erhalten ihre Freigaben im Profil.", 400);
  throw new ApiError("Nicht gefunden.", 404);
}

/** Standortzuordnung einer Person - nur Standorte im eigenen Bereich. */
export async function GET(_request: Request, context: Context) {
  return api(async () => {
    const a = await requireAccess();
    const target = await targetFor(a, (await context.params).id);
    return { sites: await sitesOf(db, a, target) };
  });
}

/** Zuordnung setzen: branchIds sind alle gewuenschten Standorte im eigenen Bereich. */
export async function PUT(request: Request, context: Context) {
  return api(async () => {
    const a = await requireAccess();
    const target = await targetFor(a, (await context.params).id);
    const { branchIds } = await body(request, z.object({ branchIds: z.array(z.string().min(1)).max(200) }));
    const sites = await serial(async (tx) => {
      await setSites(tx, a, target, branchIds);
      return sitesOf(tx, a, target);
    });
    await refreshRealtime([target.userId]);
    return { sites };
  });
}
