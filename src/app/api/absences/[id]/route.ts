import { z } from "zod";
import { api, body, serial, ApiError } from "@/lib/api";
import { db } from "@/lib/db";
import { canStaff, requireAccess, type Access } from "@/lib/access";
import { validDate } from "@/lib/berlin";
import { notify } from "@/lib/planning";
import { signalBookedSites } from "@/lib/conflicts";
import { applyEffects, effectsSchema, signalReleased, type Released } from "@/lib/absence-effects";

type Context = { params: Promise<{ id: string }> };
const include = {
  user: { select: { id: true, firstName: true, lastName: true, profileImage: true } },
  category: { select: { id: true, name: true, color: true, isPaid: true } },
} as const;

/** Eigene Abwesenheit oder eine, die die angemeldete Person entscheiden darf - sonst 404. */
async function absenceFor(a: Access, id: string) {
  const absence = await db.absence.findFirst({ where: { id, category: { organizationId: a.orgId } } });
  if (!absence) throw new ApiError("Nicht gefunden.", 404);
  const self = absence.userId === a.userId;
  const manages = canStaff(a, "MANAGE_ABSENCES", absence.userId) && (a.isAdmin || !self);
  if (!self && !manages) throw new ApiError("Nicht gefunden.", 404);
  if (!await db.organizationMember.findFirst({ where: { organizationId: a.orgId, userId: absence.userId, isActive: true } })) throw new ApiError("Nicht gefunden.", 404);
  return { absence, manages };
}

/** Kalendertage, die der alte oder der neue Zeitraum beruehrt. */
function spanOf(before: { dateFrom: Date; dateTo: Date }, after: { dateFrom: Date; dateTo: Date }) {
  const day = (value: Date) => value.toISOString().slice(0, 10);
  return { from: [day(before.dateFrom), day(after.dateFrom)].sort()[0], to: [day(before.dateTo), day(after.dateTo)].sort()[1] };
}

const updateAbsenceSchema = z.object({
  status: z.enum(["PENDING", "APPROVED", "DECLINED"]).optional(),
  dateFrom: z.string().refine(validDate).optional(),
  dateTo: z.string().refine(validDate).optional(),
  note: z.string().max(2000).nullable().optional(),
  categoryId: z.string().optional(),
  /** Wirkung auf die Schichten (beim Genehmigen oder fuer eine genehmigte Abwesenheit). */
  effects: effectsSchema.optional(),
});

export async function PATCH(request: Request, context: Context) {
  return api(async () => {
    const a = await requireAccess();
    const { absence, manages } = await absenceFor(a, (await context.params).id);
    const data = await body(request, updateAbsenceSchema);
    if ((data.dateFrom || absence.dateFrom.toISOString().slice(0, 10)) > (data.dateTo || absence.dateTo.toISOString().slice(0, 10))) throw new ApiError("Enddatum liegt vor dem Beginn.");
    if ((data.status === "APPROVED" || data.status === "DECLINED") && !manages) throw new ApiError("Keine Berechtigung, Abwesenheiten zu genehmigen oder abzulehnen.", 403);
    if (!manages && absence.status !== "PENDING") throw new ApiError("Nur noch nicht entschiedene Anträge können bearbeitet werden.");
    if (data.categoryId && !await db.absenceCategory.findFirst({ where: { id: data.categoryId, organizationId: a.orgId } })) throw new ApiError("Kategorie nicht gefunden.", 404);
    const nextStatus = data.status ?? absence.status;
    if (data.effects && (!manages || nextStatus !== "APPROVED")) throw new ApiError("Die Wirkung auf Schichten legt fest, wer die Abwesenheit genehmigt.", 400);
    // Austragen ist eine Planaenderung wie beim Aufheben: serialisiert, bei Kollision begrenzt neu.
    const { updated, released } = await serial(async (tx) => {
      let released: Released[] = [];
      const result = await tx.absence.update({
        where: { id: absence.id },
        data: {
          ...(data.status !== undefined && { status: data.status }),
          ...(data.dateFrom !== undefined && { dateFrom: new Date(data.dateFrom + "T00:00:00.000Z") }),
          ...(data.dateTo !== undefined && { dateTo: new Date(data.dateTo + "T00:00:00.000Z") }),
          ...(data.note !== undefined && { note: data.note }),
          ...(data.categoryId !== undefined && { categoryId: data.categoryId }),
          ...(nextStatus === "APPROVED" && absence.status !== "APPROVED" ? { approvedById: a.userId, approvedAt: new Date() } : {}),
          ...(nextStatus !== "APPROVED" ? { approvedById: null, approvedAt: null } : {}),
        },
        include,
      });
      // Genehmigt: Wirkung (neu) anwenden; nicht mehr genehmigt: Wirkung entfaellt (freigegebene Schichten bleiben offen).
      if (nextStatus === "APPROVED" && (absence.status !== "APPROVED" || data.effects || data.dateFrom || data.dateTo || data.categoryId)) released = (await applyEffects(tx, a, result, result.category, data.effects)).released;
      if (nextStatus !== "APPROVED" && absence.status === "APPROVED") await tx.absenceShift.deleteMany({ where: { absenceId: absence.id, handling: { not: "RELEASED" } } });
      if (data.status && data.status !== absence.status) await notify(tx, a.orgId, a.userId, [absence.userId], "Abwesenheitsantrag " + (data.status === "APPROVED" ? "genehmigt" : data.status === "DECLINED" ? "abgelehnt" : "zur Prüfung"), result.dateFrom.toISOString().slice(0, 10) + " bis " + result.dateTo.toISOString().slice(0, 10));
      return { updated: result, released };
    }, { retry: true });
    // Genehmigt vorher oder nachher: Konflikte im alten und neuen Zeitraum koennen sich aendern.
    if (absence.status === "APPROVED" || updated.status === "APPROVED") await signalBookedSites(a.orgId, [absence.userId], "schedule:updated", spanOf(absence, updated));
    await signalReleased(a.orgId, absence.userId, released);
    return { absence: updated };
  });
}

export async function DELETE(_request: Request, context: Context) {
  return api(async () => {
    const a = await requireAccess();
    const { absence, manages } = await absenceFor(a, (await context.params).id);
    if (!manages && absence.status !== "PENDING") throw new ApiError("Nur noch nicht entschiedene Anträge können gelöscht werden.");
    await db.absence.delete({ where: { id: absence.id } });
    if (absence.status === "APPROVED") await signalBookedSites(a.orgId, [absence.userId], "schedule:updated", spanOf(absence, absence));
    return { success: true };
  });
}
