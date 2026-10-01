import type { NextRequest } from "next/server";
import { api, serial, ApiError } from "@/lib/api";
import { assertCan, requireAccess } from "@/lib/access";
import { planningPool } from "@/lib/planning";

/**
 * Einplanbare Personen fuer neue Schichten eines Standorts (Auswahl beim
 * Anlegen). Gleicher Kreis wie beim Besetzen (planningPool), Reihenfolge:
 * Standort, andere Standorte desselben Kunden, uebrige - je nach Name.
 * Nur Namen und Herkunft, keine Profil- oder Kontaktdaten. Verfuegbarkeit
 * und Sperren prueft die Vorschau beim Anlegen.
 */
export async function GET(request: NextRequest) {
  return api(async () => {
    const a = await requireAccess();
    const branchId = request.nextUrl.searchParams.get("branchId");
    if (!branchId) throw new ApiError("Standort fehlt.", 400);
    return serial(async tx => {
      const branch = await tx.branch.findFirst({ where: { id: branchId, organizationId: a.orgId }, select: { id: true, name: true, customer: { select: { name: true } } } });
      if (!branch) throw new ApiError("Standort nicht gefunden.", 404);
      assertCan(a, "EDIT_SHIFTS", branch.id);
      const pool = await planningPool(tx, a, branch.id);
      const people = await tx.organizationMember.findMany({
        where: { organizationId: a.orgId, isActive: true, isActivated: true, userId: { in: [...pool.keys()] } },
        select: { userId: true, user: { select: { firstName: true, lastName: true } } },
        orderBy: [{ user: { lastName: "asc" } }, { user: { firstName: "asc" } }],
      });
      const rank = { site: 1, customer: 2, rest: 3 } as const;
      const list = people.map(p => {
        const entry = pool.get(p.userId)!;
        return { userId: p.userId, firstName: p.user.firstName, lastName: p.user.lastName, group: entry.tier, sites: entry.tier === "customer" ? entry.sites : [] };
      });
      // Stabil: Gruppe, innerhalb der Gruppe bleibt die Namensreihenfolge.
      list.sort((x, y) => rank[x.group] - rank[y.group]);
      return { site: branch.name, customer: branch.customer?.name ?? null, admin: a.isAdmin, people: list };
    });
  });
}
