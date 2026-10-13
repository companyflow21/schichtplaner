import type { Booking, Shift } from "@prisma/client";
import type { ScheduleDiffChange } from "@/types/schedule";

/** Buchung in der Momentaufnahme: alle Felder, Zeitpunkte als ISO-Text. */
export type SnapshotBooking = {
  id: string; shiftId: string; userId: string | null; formerEmployeeId: string | null; contractorWorkerId: string | null;
  bookedAt: string; bookedBy: string | null; confirmedAt: string | null; confirmation: "PLANNER" | "EMPLOYEE" | null;
};
/** Schicht in der Momentaufnahme: alle Felder ausser deletedAt (immer leer) und alle Buchungen. */
export type SnapshotShift = {
  id: string; scheduleId: string; divisionId: string | null; requiredQualifications: string[];
  dayOfWeek: number; shiftFrom: string; shiftTo: string; maxEmployees: number;
  pauseOption: "PER_HOUR" | "PER_SHIFT"; pauseValue: number; title: string | null; description: string | null;
  createdAt: string; bookings: SnapshotBooking[];
};
export type Snapshot = { version: 1; takenAt: string; shifts: SnapshotShift[] };

export type ScheduleDiff = {
  added: SnapshotShift[];
  /** Stand der Momentaufnahme; movedTo ist die Live-Zeile, wenn die Schicht jetzt in einem anderen Plan liegt. */
  removed: (SnapshotShift & { movedTo: SnapshotShift | null })[];
  changed: { shift: SnapshotShift; before: SnapshotShift; after: SnapshotShift; changes: ScheduleDiffChange[] }[];
  affectedUserIds: string[];
  openPlacesAdded: boolean;
};

/** Live-Zeile in der Form der Momentaufnahme; Buchungen nach id sortiert (stabiler Vergleich). */
export function toSnapshotShift(shift: Shift & { bookings: Booking[] }): SnapshotShift {
  return {
    id: shift.id, scheduleId: shift.scheduleId, divisionId: shift.divisionId, requiredQualifications: shift.requiredQualifications,
    dayOfWeek: shift.dayOfWeek, shiftFrom: shift.shiftFrom, shiftTo: shift.shiftTo, maxEmployees: shift.maxEmployees,
    pauseOption: shift.pauseOption, pauseValue: shift.pauseValue, title: shift.title, description: shift.description,
    createdAt: shift.createdAt.toISOString(),
    bookings: shift.bookings.map(b => ({
      id: b.id, shiftId: b.shiftId, userId: b.userId, formerEmployeeId: b.formerEmployeeId, contractorWorkerId: b.contractorWorkerId,
      bookedAt: b.bookedAt.toISOString(), bookedBy: b.bookedBy, confirmedAt: b.confirmedAt?.toISOString() ?? null, confirmation: b.confirmation,
    })).sort((x, y) => x.id < y.id ? -1 : 1),
  };
}

/** Personenschluessel einer Buchung (Konto, Subunternehmer-Platzhalter oder geloeschte Person). */
export function personKey(b: SnapshotBooking): string {
  return b.userId ?? (b.contractorWorkerId ? "contractor:" + b.contractorWorkerId : "former:" + b.formerEmployeeId);
}
export function bookedUsers(s: SnapshotShift): string[] {
  return s.bookings.flatMap(b => b.userId ? [b.userId] : []);
}
export function openPlaces(s: SnapshotShift): number {
  return Math.max(0, s.maxEmployees - s.bookings.length);
}

/** Aenderungen, ueber die Eingeteilte informiert werden (wie bei "Schicht geändert"). */
export const RELEVANT: ScheduleDiffChange[] = ["Zeit", "Tag", "Titel", "Pause"];

export function shiftChanges(before: SnapshotShift, after: SnapshotShift): ScheduleDiffChange[] {
  const changes: ScheduleDiffChange[] = [];
  const set = (values: string[]) => [...values].sort().join("\n");
  if (before.shiftFrom !== after.shiftFrom || before.shiftTo !== after.shiftTo) changes.push("Zeit");
  if (before.dayOfWeek !== after.dayOfWeek) changes.push("Tag");
  if ((before.title ?? "") !== (after.title ?? "")) changes.push("Titel");
  if (before.pauseOption !== after.pauseOption || before.pauseValue !== after.pauseValue) changes.push("Pause");
  if (set(before.requiredQualifications) !== set(after.requiredQualifications)) changes.push("Qualifikation");
  if (before.divisionId !== after.divisionId) changes.push("Arbeitsbereich");
  if (before.maxEmployees !== after.maxEmployees) changes.push("Plätze");
  if (set(before.bookings.map(personKey)) !== set(after.bookings.map(personKey))) changes.push("Besetzung");
  return changes;
}

/**
 * Aenderungen gegenueber der Momentaufnahme. live: Schichten des Plans (nicht
 * geloescht), optional dazu Live-Zeilen von Schichten der Momentaufnahme, die
 * inzwischen in einem anderen Plan liegen - sie zaehlen als entfernt (movedTo).
 * Betroffen ist, wer eine neue oder entfallene Schicht hat, in einer Schicht
 * neu eingeteilt oder ausgetragen wurde oder eingeteilt bleibt, waehrend sich
 * Zeit, Tag, Taetigkeit oder Pause aendern. Beschreibung allein zaehlt nicht.
 */
export function scheduleDiff(snapshot: Snapshot, live: SnapshotShift[]): ScheduleDiff {
  const before = new Map(snapshot.shifts.map(s => [s.id, s]));
  const now = new Map(live.map(s => [s.id, s]));
  const added = live.filter(s => !before.has(s.id));
  const removed: ScheduleDiff["removed"] = [];
  const changed: ScheduleDiff["changed"] = [];
  for (const b of snapshot.shifts) {
    const a = now.get(b.id);
    if (!a || a.scheduleId !== b.scheduleId) { removed.push({ ...b, movedTo: a ?? null }); continue; }
    const changes = shiftChanges(b, a);
    if (changes.length) changed.push({ shift: a, before: b, after: a, changes });
  }
  const affected = new Set<string>();
  for (const s of [...added, ...removed]) for (const id of bookedUsers(s)) affected.add(id);
  for (const c of changed) {
    const was = bookedUsers(c.before), is = bookedUsers(c.after);
    const relevant = c.changes.some(x => RELEVANT.includes(x));
    for (const id of is) if (relevant || !was.includes(id)) affected.add(id);
    for (const id of was) if (!is.includes(id)) affected.add(id);
  }
  const openPlacesAdded = added.some(s => openPlaces(s) > 0)
    || changed.some(c => openPlaces(c.after) > 0 && (openPlaces(c.after) > openPlaces(c.before) || c.changes.includes("Zeit") || c.changes.includes("Tag")));
  return { added, removed, changed, affectedUserIds: [...affected], openPlacesAdded };
}
