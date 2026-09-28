import { z } from "zod";
import { api, body, serial, ApiError } from "@/lib/api";
import { canSeeTime, requireAccess } from "@/lib/access";
import { berlinTime } from "@/lib/berlin";
import { notify } from "@/lib/planning";
import { emitToUsers } from "@/lib/emit";
import { watchRecord } from "@/lib/checkin";

type Context = { params: Promise<{ id: string }> };

/**
 * Entscheidung ueber eine manuelle Check-in-Freigabe: wer die Zeiten der
 * Person bearbeiten darf (Admin, oder "Zeiterfassung bearbeiten" am Standort
 * plus "Stunden einsehen" fuer die Person), nie die Person selbst.
 * Die Freigabe startet die Zeiterfassung ab dem Zeitpunkt des Antrags
 * (Serverzeit). Nichts wird geloescht; Entscheidung, Zeitpunkt und Notiz
 * bleiben am Eintrag.
 */
export async function PATCH(request: Request, context: Context) {
  return api(async () => {
    const a = await requireAccess();
    const { id } = await context.params;
    const data = await body(request, z.object({ status: z.enum(["APPROVED", "DECLINED"]), note: z.string().trim().max(500).optional() }));
    const result = await serial(async (tx) => {
      const c = await tx.checkin.findFirst({ where: { id, organizationId: a.orgId }, include: { branch: { select: { name: true } } } });
      if (!c) throw new ApiError("Check-in nicht gefunden.", 404);
      if (c.userId === a.userId) throw new ApiError("Den eigenen Check-in kannst du nicht freigeben.", 403);
      if (!canSeeTime(a, c, "edit")) throw new ApiError(canSeeTime(a, c, "view") ? "Keine Berechtigung." : "Check-in nicht gefunden.", canSeeTime(a, c, "view") ? 403 : 404);
      if (c.status !== "PENDING") throw new ApiError("Über diesen Check-in wurde bereits entschieden.", 409);
      let timeRecordId: string | null = null;
      if (data.status === "APPROVED") {
        if (await tx.timeRecord.findFirst({ where: { organizationId: a.orgId, userId: c.userId, type: "WATCH", timeTo: null } })) throw new ApiError("Für diese Person läuft bereits eine Zeiterfassung.", 409);
        timeRecordId = (await tx.timeRecord.create({ data: watchRecord(a.orgId, c.userId, c.branchId, c.createdAt) })).id;
      }
      const checkin = await tx.checkin.update({ where: { id: c.id }, data: { status: data.status, reviewedById: a.userId, reviewedAt: new Date(), decisionNote: data.note || null, timeRecordId } });
      const approved = data.status === "APPROVED";
      await notify(tx, a.orgId, a.userId, [c.userId], approved ? "Check-in freigegeben" : "Check-in abgelehnt",
        approved
          ? `Dein Check-in für ${c.branch.name} ist freigegeben. Die Zeiterfassung läuft ab ${berlinTime(c.createdAt)} Uhr (Zeitpunkt deines Antrags).${data.note ? " Notiz: " + data.note : ""}`
          : `Dein Antrag auf Check-in für ${c.branch.name} wurde abgelehnt.${data.note ? " Notiz: " + data.note : ""}`,
        c.shiftId);
      return { checkin, userId: c.userId };
    }, { retry: true });
    emitToUsers([result.userId], "message:new");
    emitToUsers([result.userId], "time:watch");
    return { checkin: result.checkin };
  });
}
