import { api, serial, ApiError } from "@/lib/api";
import { assertCan, can, requireAccess } from "@/lib/access";
import { contractorWorkerView, formerView, shiftLabel } from "@/lib/planning";
import { shiftRange } from "@/lib/berlin";
import { formatName } from "@/lib/names";
import { scheduleStatus } from "@/lib/schedule-status";
import { diffPlans, diffShifts, editDiff } from "@/lib/schedule-editing";
import { openPlaces, personKey, type SnapshotShift } from "@/lib/schedule-diff";
import type { ScheduleDiffData, ScheduleDiffShift } from "@/types/schedule";

type Context = { params: Promise<{ id: string }> };

/**
 * Aenderungen gegenueber dem veroeffentlichten Stand fuer den
 * Veroeffentlichen-Dialog - nur fuer die Planung (Schichten bearbeiten oder
 * Dienstplan veroeffentlichen am Standort). Entwurf: alle Schichten neu;
 * veroeffentlicht ohne Bearbeitung: keine Aenderungen. Namen im
 * Namensformat der Organisation.
 */
export async function GET(_request: Request, context: Context) {
  return api(async () => {
    const a = await requireAccess();
    const { id } = await context.params;
    return serial(async tx => {
      const schedule = await tx.schedule.findFirst({ where: { id, organizationId: a.orgId, deletedAt: null } });
      if (!schedule) throw new ApiError("Schichtplan nicht gefunden.", 404);
      if (!can(a, "PUBLISH_SCHEDULE", schedule.branchId)) assertCan(a, "EDIT_SHIFTS", schedule.branchId);
      const diff = await editDiff(tx, schedule);
      const shifts = diffShifts(diff);
      const format = a.member.organization.nameFormat;
      const bookings = shifts.flatMap(s => s.bookings);
      const ids = (pick: (b: SnapshotShift["bookings"][number]) => string | null) => [...new Set(bookings.flatMap(b => pick(b) ?? []))];
      const [plans, users, workers, formers, divisions] = await Promise.all([
        diffPlans(tx, shifts),
        tx.user.findMany({ where: { id: { in: ids(b => b.userId) } }, select: { id: true, firstName: true, lastName: true } }),
        tx.contractorWorker.findMany({ where: { id: { in: ids(b => b.contractorWorkerId) }, organizationId: a.orgId }, select: contractorWorkerView }),
        tx.formerEmployee.findMany({ where: { id: { in: ids(b => b.formerEmployeeId) }, organizationId: a.orgId }, select: formerView }),
        tx.division.findMany({ where: { id: { in: [...new Set(shifts.flatMap(s => s.divisionId ?? []))] }, organizationId: a.orgId }, select: { id: true, title: true } }),
      ]);
      const names = new Map<string, string>([
        ...users.map(u => [u.id, formatName(u, format)] as const),
        ...workers.map(w => ["contractor:" + w.id, formatName({ firstName: w.subcontractor.name, lastName: "· " + w.name }, format, { contractor: true })] as const),
        ...formers.map(f => ["former:" + f.id, formatName(f, format)] as const),
      ]);
      const entry = (s: SnapshotShift): ScheduleDiffShift => {
        const shift = { ...s, schedule: plans.get(s.scheduleId)! };
        return {
          id: s.id, label: shiftLabel(shift), date: shiftRange(shift).date, dayOfWeek: s.dayOfWeek, shiftFrom: s.shiftFrom, shiftTo: s.shiftTo,
          title: s.title, pauseOption: s.pauseOption, pauseValue: s.pauseValue, maxEmployees: s.maxEmployees, openPlaces: openPlaces(s),
          requiredQualifications: s.requiredQualifications, division: divisions.find(d => d.id === s.divisionId) ?? null,
          people: s.bookings.map(b => ({ key: personKey(b), name: names.get(personKey(b)) ?? "Gelöschte Person" })),
        };
      };
      // Nur Personen, die noch zur Organisation gehoeren, erhalten eine Mitteilung.
      const members = await tx.organizationMember.findMany({ where: { organizationId: a.orgId, userId: { in: diff.affectedUserIds } }, select: { userId: true } });
      const affected = diff.affectedUserIds.filter(userId => members.some(m => m.userId === userId));
      const result: ScheduleDiffData = {
        added: diff.added.map(entry),
        removed: diff.removed.map(r => ({ ...entry(r), movedTo: r.movedTo ? entry(r.movedTo) : null })),
        changed: diff.changed.map(c => ({ shift: { id: c.shift.id, label: entry(c.shift).label }, before: entry(c.before), after: entry(c.after), changes: c.changes })),
        affectedUserIds: affected,
        affected: affected.map(userId => ({ userId, name: names.get(userId) ?? "Unbekannte Person" })),
        openPlacesAdded: diff.openPlacesAdded,
      };
      return { status: scheduleStatus(schedule), diff: result };
    }, { retry: true });
  });
}
