import { api, serial } from "@/lib/api";
import { requireAccess } from "@/lib/access";
import { scheduleViolations } from "@/lib/planning-rules-service";

/** Regelverstoesse in der Woche dieses Plans - nur fuer die Planung. */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  return api(async () => {
    const a = await requireAccess();
    const { id } = await context.params;
    return serial((tx) => scheduleViolations(tx, a, id));
  });
}
