import { api } from "@/lib/api";
import { requireAccess } from "@/lib/access";
import { berlinDate } from "@/lib/berlin";
import { hoursReport } from "@/lib/hours";
import { payrollPeriod } from "@/lib/payroll-service";

/** Stunden pruefen: Plan und Ist je Schicht mit Genehmigungsstatus; Lohn nur fuer Admins. */
export async function GET(request: Request) {
  return api(async () => {
    const a = await requireAccess();
    const { from, to, branchId } = payrollPeriod(request, berlinDate());
    return hoursReport(a, from, to, branchId);
  });
}
