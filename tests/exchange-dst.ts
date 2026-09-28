/* Zukunftspruefung von Tauschschichten an echten DST-Grenzen. Keine DB-Abfragen. */
import { isoWeek } from "../src/lib/berlin";
import type { TestContext } from "./permissions";

export async function exchangeDstTests(t: Pick<TestContext, "check">) {
  const { isFuture } = await import("../src/lib/shift-requests");
  const shift = (date: string, from: string, to: string) => ({
    dayOfWeek: (new Date(date + "T12:00:00Z").getUTCDay() + 6) % 7 + 1,
    shiftFrom: from, shiftTo: to, schedule: isoWeek(date),
  });
  const fall = shift("2026-10-25", "02:30", "06:00");
  t.check(isFuture(fall, new Date("2026-10-25T00:29:59Z")), "exchange DST: a second before first 02:30 is future");
  t.check(!isFuture(fall, new Date("2026-10-25T00:30:00Z")), "exchange DST: first 02:30 is already started");
  t.check(!isFuture(fall, new Date("2026-10-25T01:00:00Z")), "exchange DST: second 02:00 cannot make a started shift future again");
  t.check(!isFuture(fall, new Date("2026-10-25T01:30:00Z")), "exchange DST: second 02:30 remains started");
  const spring = shift("2026-03-29", "03:00", "06:00");
  t.check(isFuture(spring, new Date("2026-03-29T00:59:59Z")), "exchange spring DST: 01:59:59 is before the 03:00 shift");
  t.check(!isFuture(spring, new Date("2026-03-29T01:00:00Z")), "exchange spring DST: 03:00 is already started");
}
