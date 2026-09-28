/*
 * Reiner Kern des Check-ins (src/lib/checkin.ts) ohne Datenbank:
 * Entfernung, Positionsbewertung, Fenster und Verspaetung in Berliner Ortszeit.
 * Aufruf: npx tsx tests/checkin-unit.ts
 */
import assert from "node:assert/strict";
import { isoWeek } from "../src/lib/berlin";
import { checkinWindow, distanceM, evaluatePosition, MAX_ACCURACY_M, MAX_POSITION_AGE_S } from "../src/lib/checkin";

let checks = 0;
function check(value: unknown, message: string) { assert.ok(value, message); checks++; console.log("PASS: " + message); }

/** Schicht an einem Kalendertag (YYYY-MM-DD) in der Form, die shiftRange erwartet. */
function shift(date: string, shiftFrom: string, shiftTo: string) {
  const week = isoWeek(date), dayOfWeek = ((new Date(date + "T12:00:00Z").getUTCDay() + 6) % 7) + 1;
  return { dayOfWeek, shiftFrom, shiftTo, schedule: { year: week.year, weekNumber: week.weekNumber } };
}
const at = (iso: string) => new Date(iso);

// --- Entfernung ---------------------------------------------------------------
const site = { latitude: 50.7374, longitude: 7.0982, checkinRadiusM: 50 };
check(distanceM(site, site) === 0, "haversine: same point is 0 m");
const oneDegreeLat = distanceM({ latitude: 0, longitude: 0 }, { latitude: 1, longitude: 0 });
check(Math.abs(oneDegreeLat - 111195) < 5, "haversine: one degree of latitude is about 111.2 km");
const bonnCologne = distanceM({ latitude: 50.7374, longitude: 7.0982 }, { latitude: 50.9375, longitude: 6.9603 });
check(bonnCologne > 24000 && bonnCologne < 25000, "haversine: Bonn to Cologne is about 24.4 km");
check(Math.abs(distanceM({ latitude: 50.7374, longitude: 7.0982 }, { latitude: 50.7374 + 0.0004, longitude: 7.0982 }) - 44.5) < 0.5, "haversine: 0.0004 degrees north is about 44.5 m");

// --- Positionsbewertung -------------------------------------------------------
const now = at("2026-09-28T10:00:00Z");
const pos = (dLat: number, accuracy = 10, ageS = 5) => ({ latitude: site.latitude + dLat, longitude: site.longitude, accuracy, timestamp: now.getTime() - ageS * 1000 });
const inside = evaluatePosition({ branch: site, position: pos(0.0004), now });
check(inside.ok && inside.failure === null && inside.distanceM === 44 && inside.accuracyM === 10 && inside.positionAgeS === 5, "44 m away inside the 50 m radius");
const outside = evaluatePosition({ branch: site, position: pos(0.0005), now });
check(!outside.ok && outside.failure === "OUTSIDE" && outside.distanceM === 56, "56 m away is outside the 50 m radius");
check(evaluatePosition({ branch: { ...site, checkinRadiusM: 100 }, position: pos(0.0005), now }).ok, "radius per site is respected");
check(evaluatePosition({ branch: site, position: pos(0, 49), now }).ok, "accuracy 49 m is accepted");
check(evaluatePosition({ branch: site, position: pos(0, MAX_ACCURACY_M), now }).ok, "accuracy exactly 50 m is accepted");
check(evaluatePosition({ branch: site, position: pos(0, 51), now }).failure === "INACCURATE", "accuracy 51 m is rejected as inaccurate");
check(evaluatePosition({ branch: site, position: pos(0.01, 80), now }).failure === "INACCURATE", "inaccuracy is reported before distance");
check(evaluatePosition({ branch: site, position: pos(0, 10, MAX_POSITION_AGE_S), now }).ok, "position exactly 120 s old is accepted");
check(evaluatePosition({ branch: site, position: pos(0, 10, MAX_POSITION_AGE_S + 1), now }).failure === "STALE", "position 121 s old is stale");
check(evaluatePosition({ branch: site, position: pos(0, 10, 600), now }).failure === "STALE", "position 10 min old is stale");
check(evaluatePosition({ branch: site, position: pos(0, 10, -30), now }).ok, "device clock 30 s ahead is tolerated");
const future = evaluatePosition({ branch: site, position: pos(0, 10, -31), now });
check(future.failure === "STALE" && future.positionAgeS === 0, "timestamp 31 s in the future is rejected, age never negative");
check(evaluatePosition({ branch: { latitude: null, longitude: null, checkinRadiusM: 50 }, position: pos(0), now }).failure === "NO_COORDINATES", "site without coordinates cannot be checked");
check(!JSON.stringify(inside).includes("50.73"), "evaluation result carries no coordinates");

// --- Fenster: Tagschicht (Sommerzeit, UTC+2) -----------------------------------
const day = shift("2026-09-28", "08:00", "16:00"); // Montag
check(checkinWindow(day, at("2026-09-28T05:29:00Z")).state === "BEFORE", "07:29 is before the window (opens 30 min before start)");
const early = checkinWindow(day, at("2026-09-28T05:30:00Z"));
check(early.open && early.lateMinutes === -30 && early.opensAt === "07:30", "07:30 opens the window, 30 min early");
const onTime = checkinWindow(day, at("2026-09-28T06:00:00Z"));
check(onTime.open && onTime.lateMinutes === 0, "08:00 exactly is on time");
check(checkinWindow(day, at("2026-09-28T06:12:40Z")).lateMinutes === 12, "08:12:40 counts 12 minutes late");
check(checkinWindow(day, at("2026-09-28T13:59:00Z")).open, "15:59 is still inside the window");
const after = checkinWindow(day, at("2026-09-28T14:00:00Z"));
check(!after.open && after.state === "AFTER", "16:00 closes the window at shift end");
check(checkinWindow(day, at("2026-09-27T06:00:00Z")).state === "BEFORE" && checkinWindow(day, at("2026-09-29T06:00:00Z")).state === "AFTER", "other days are outside the window");

// --- Nachtschicht ueber Mitternacht --------------------------------------------
const night = shift("2026-09-28", "22:00", "06:00");
const n2310 = checkinWindow(night, at("2026-09-28T21:10:00Z"));
check(n2310.open && n2310.lateMinutes === 70 && n2310.date === "2026-09-28", "night shift: check-in at 23:10 is 70 min late");
const n0030 = checkinWindow(night, at("2026-09-28T22:30:00Z"));
check(n0030.open && n0030.lateMinutes === 150, "night shift: 00:30 of the next day is still inside the window, 150 min late");
check(checkinWindow(night, at("2026-09-28T19:30:00Z")).open && !checkinWindow(night, at("2026-09-28T19:29:00Z")).open, "night shift: window opens at 21:30");
check(checkinWindow(night, at("2026-09-29T03:59:00Z")).open && !checkinWindow(night, at("2026-09-29T04:00:00Z")).open, "night shift: window closes at 06:00 next morning");
check(checkinWindow(shift("2026-09-28", "00:10", "06:00"), at("2026-09-27T21:45:00Z")).open, "shift at 00:10: window opens 23:40 on the previous day");
check(checkinWindow(shift("2026-09-28", "00:10", "06:00"), at("2026-09-27T21:45:00Z")).opensAt === "23:40", "shift at 00:10: opening time wraps to 23:40");

// --- Zeitumstellung ------------------------------------------------------------
// 29.03.2026: 02:00 MEZ -> 03:00 MESZ. Schicht Samstag 28.03. 22:00 (MEZ, 21:00 UTC) bis 06:00 (MESZ, 04:00 UTC).
const spring = shift("2026-03-28", "22:00", "06:00");
const s0330 = checkinWindow(spring, at("2026-03-29T01:30:00Z")); // 03:30 MESZ
check(s0330.open && s0330.lateMinutes === 270, "spring DST: check-in at 03:30 CEST counts 270 real minutes late, not 330");
check(checkinWindow(spring, at("2026-03-29T03:59:00Z")).open && !checkinWindow(spring, at("2026-03-29T04:00:00Z")).open, "spring DST: window closes at 06:00 local time");
check(checkinWindow(spring, at("2026-03-28T21:00:00Z")).lateMinutes === 0, "spring DST: 22:00 CET start is on time");
// 25.10.2026: 03:00 MESZ -> 02:00 MEZ. Schicht Samstag 24.10. 22:00 (MESZ, 20:00 UTC) bis 06:00 (MEZ, 05:00 UTC).
const fall = shift("2026-10-24", "22:00", "06:00");
const f0230 = checkinWindow(fall, at("2026-10-25T01:30:00Z")); // 02:30 MEZ, zweites Auftreten
check(f0230.open && f0230.lateMinutes === 330, "fall DST: check-in at 02:30 CET (second pass) counts 330 real minutes late");
check(checkinWindow(fall, at("2026-10-25T00:30:00Z")).lateMinutes === 270, "fall DST: check-in at 02:30 CEST (first pass) counts 270 minutes late");
check(checkinWindow(fall, at("2026-10-25T04:59:00Z")).open && !checkinWindow(fall, at("2026-10-25T05:00:00Z")).open, "fall DST: window closes at 06:00 local time");
const repeated = shift("2026-10-25", "02:30", "06:00");
check(checkinWindow(repeated, at("2026-10-25T00:30:00Z")).lateMinutes === 0 && checkinWindow(repeated, at("2026-10-25T01:30:00Z")).lateMinutes === 60, "fall DST: a start inside the repeated hour counts from its first occurrence");

console.log("CHECKIN UNIT: " + checks + " checks passed.");
