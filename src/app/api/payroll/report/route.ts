import { api } from "@/lib/api";
import { requireAccess } from "@/lib/access";
import { berlinDate } from "@/lib/berlin";
import { payrollPeriod, payrollReport } from "@/lib/payroll-service";

/** Stunden und Lohn je Person mit Rechenweg je Buchung - nur Admins. */
export async function GET(request: Request) {
  return api(async () => {
    const a = await requireAccess();
    const { from, to, branchId } = payrollPeriod(request, berlinDate());
    return payrollReport(a, from, to, branchId);
  });
}
