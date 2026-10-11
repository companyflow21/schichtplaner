import { api } from "@/lib/api";
import { requireAccess } from "@/lib/access";
import { planningOverview } from "@/lib/overview";

/**
 * Planungsstand je Standort fuer die Standortauswahl im Dienstplan - dieselben
 * Regeln und Rechte wie die Startseite (offene Plaetze inkl. unwirksamer
 * Einteilungen, Entwurfswochen nur fuer die Planung), ohne Schichtdetails.
 */
export async function GET() {
  return api(async () => {
    const a = await requireAccess();
    const { horizon, customers, unassigned } = await planningOverview(a);
    return { horizon, branches: [...customers.flatMap((c) => c.branches), ...unassigned] };
  });
}
