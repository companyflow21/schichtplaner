import { api } from "@/lib/api";
import { db } from "@/lib/db";
import { requireAccess, requireAdmin } from "@/lib/access";
import { branchHasHistory } from "@/lib/archive";

/**
 * Archiv der Verwaltung (nur Administration): archivierte Kunden und
 * Einsatzorte mit Datum; deletable nur ohne Historie (Einsatzort) bzw. ohne
 * Einsatzorte (Kunde) - dieselben Regeln wie beim endgueltigen Loeschen.
 */
export async function GET() {
  return api(async () => {
    const a = await requireAccess();
    requireAdmin(a);
    const [customers, branches] = await Promise.all([
      db.customer.findMany({ where: { organizationId: a.orgId, archivedAt: { not: null } }, orderBy: { name: "asc" }, select: { id: true, name: true, archivedAt: true, _count: { select: { branches: true } } } }),
      db.branch.findMany({ where: { organizationId: a.orgId, archivedAt: { not: null } }, orderBy: { name: "asc" }, select: { id: true, name: true, archivedAt: true, customer: { select: { id: true, name: true, archivedAt: true } } } }),
    ]);
    const history = await Promise.all(branches.map((b) => branchHasHistory(db, b.id)));
    return {
      customers: customers.map(({ _count, ...c }) => ({ ...c, deletable: _count.branches === 0 })),
      branches: branches.map((b, i) => ({ ...b, deletable: !history[i] })),
    };
  });
}
