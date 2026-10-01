/**
 * Smart Briefing Generator
 *
 * Gathers context about a schedule week (shifts, booked employees,
 * divisions, absences) and sends it to Claude to generate a
 * concise weekly briefing.
 */

import { db } from "@/lib/db";
import { generateAIResponse } from "./client";

// ─── Types ──────────────────────────────────────────────────────────

export interface GeneratedBriefing {
  text: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

// ─── Helpers ────────────────────────────────────────────────────────

const DAY_NAMES = [
  "",
  "Montag",
  "Dienstag",
  "Mittwoch",
  "Donnerstag",
  "Freitag",
  "Samstag",
  "Sonntag",
];

/** Estimate hours between two HH:mm strings. */
function estimateHours(from: string, to: string): number {
  const [fh, fm] = from.split(":").map(Number);
  const [th, tm] = to.split(":").map(Number);
  let diff = th * 60 + tm - (fh * 60 + fm);
  if (diff < 0) diff += 24 * 60;
  return diff / 60;
}

/** Get the Monday of an ISO week. */
function getWeekStartDate(weekNumber: number, year: number): Date {
  const jan4 = new Date(year, 0, 4);
  const dayOfWeek = jan4.getDay() || 7;
  const monday = new Date(jan4);
  monday.setDate(jan4.getDate() - dayOfWeek + 1);
  monday.setDate(monday.getDate() + (weekNumber - 1) * 7);
  return monday;
}

// ─── Context Gathering ──────────────────────────────────────────────

interface BriefingContext {
  weekNumber: number;
  year: number;
  totalShifts: number;
  totalBookedHours: number;
  unfilledSpots: number;
  shiftsPerDay: Array<{
    day: string;
    shiftCount: number;
    bookedCount: number;
    openSpots: number;
  }>;
  divisions: Array<{
    name: string;
    shiftCount: number;
  }>;
  employeeSummary: {
    totalBooked: number;
    avgHoursPerEmployee: number;
  };
  absences: Array<{
    name: string;
    category: string;
    from: string;
    to: string;
  }>;
}

async function gatherBriefingContext(
  scheduleId: string,
  orgId: string
): Promise<BriefingContext> {
  // 1. Get the schedule with shifts and bookings
  const schedule = await db.schedule.findUnique({
    where: { id: scheduleId },
    include: {
      shifts: {
        where: { deletedAt: null },
        include: {
          division: { select: { title: true } },
          bookings: {
            include: {
              user: { select: { firstName: true, lastName: true } },
            },
          },
        },
        orderBy: [{ dayOfWeek: "asc" }, { shiftFrom: "asc" }],
      },
    },
  });

  if (!schedule) {
    throw new Error("Schedule nicht gefunden");
  }

  // 2. Aggregate per-day stats
  const dayStats = new Map<
    number,
    { shiftCount: number; bookedCount: number; openSpots: number }
  >();

  let totalBookedHours = 0;
  let unfilledSpots = 0;
  const bookedEmployees = new Set<string>();
  const divisionCounts = new Map<string, number>();

  for (const shift of schedule.shifts) {
    const day = shift.dayOfWeek;
    const stats = dayStats.get(day) ?? {
      shiftCount: 0,
      bookedCount: 0,
      openSpots: 0,
    };
    stats.shiftCount++;
    stats.bookedCount += shift.bookings.length;
    const open = Math.max(0, shift.maxEmployees - shift.bookings.length);
    stats.openSpots += open;
    unfilledSpots += open;
    dayStats.set(day, stats);

    // Hours
    const hours = estimateHours(shift.shiftFrom, shift.shiftTo);
    totalBookedHours += hours * shift.bookings.length;

    // Track booked employees
    for (const booking of shift.bookings) {
      if (booking.userId) bookedEmployees.add(booking.userId);
    }

    // Division counts
    if (shift.division) {
      divisionCounts.set(
        shift.division.title,
        (divisionCounts.get(shift.division.title) ?? 0) + 1
      );
    }
  }

  // Build per-day array
  const shiftsPerDay = Array.from(dayStats.entries())
    .sort(([a], [b]) => a - b)
    .map(([day, stats]) => ({
      day: DAY_NAMES[day] ?? `Tag ${day}`,
      ...stats,
    }));

  const divisions = Array.from(divisionCounts.entries())
    .sort(([, a], [, b]) => b - a)
    .map(([name, shiftCount]) => ({ name, shiftCount }));

  // 3. Get absences for the week
  const weekStart = getWeekStartDate(schedule.weekNumber, schedule.year);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 6);

  const absences = await db.absence.findMany({
    where: {
      user: {
        memberships: {
          some: { organizationId: orgId, isActive: true },
        },
      },
      status: { in: ["APPROVED", "PENDING"] },
      dateFrom: { lte: weekEnd },
      dateTo: { gte: weekStart },
    },
    include: {
      user: { select: { firstName: true, lastName: true } },
      category: { select: { name: true } },
    },
    orderBy: { dateFrom: "asc" },
  });

  return {
    weekNumber: schedule.weekNumber,
    year: schedule.year,
    totalShifts: schedule.shifts.length,
    totalBookedHours: Math.round(totalBookedHours * 10) / 10,
    unfilledSpots,
    shiftsPerDay,
    divisions,
    employeeSummary: {
      totalBooked: bookedEmployees.size,
      avgHoursPerEmployee:
        bookedEmployees.size > 0
          ? Math.round((totalBookedHours / bookedEmployees.size) * 10) / 10
          : 0,
    },
    absences: absences.map((a) => ({
      name: `${a.user.firstName} ${a.user.lastName}`,
      category: a.category.name,
      from: a.dateFrom.toISOString().split("T")[0],
      to: a.dateTo.toISOString().split("T")[0],
    })),
  };
}

// ─── Main Function ──────────────────────────────────────────────────

/**
 * Generate a smart briefing for a schedule week.
 * Uses Claude to produce a concise, actionable summary.
 */
export async function generateSmartBriefing(
  scheduleId: string,
  orgId: string
): Promise<GeneratedBriefing> {
  // 1. Gather context
  const ctx = await gatherBriefingContext(scheduleId, orgId);

  // 2. Build prompt
  const systemPrompt = `Du bist ein Schichtplanungs-Assistent. Erstelle ein kurzes, uebersichtliches Wochen-Briefing fuer Manager.

Formatierung:
- Verwende kurze Absaetze und Aufzaehlungspunkte
- Nenne konkrete Zahlen
- Weise auf Probleme hin (offene Schichten, fehlende Besetzung, viele Abwesenheiten)
- Gib 1-2 Handlungsempfehlungen wenn noetig
- Halte es unter 300 Woertern
- Antworte auf Deutsch`;

  const userMessage = `Erstelle ein Briefing fuer KW ${ctx.weekNumber}/${ctx.year}:

## Ueberblick
- ${ctx.totalShifts} Schichten, ${ctx.totalBookedHours} gebuchte Stunden
- ${ctx.unfilledSpots} offene Plaetze
- ${ctx.employeeSummary.totalBooked} Mitarbeiter eingebucht (Ø ${ctx.employeeSummary.avgHoursPerEmployee}h pro MA)

## Tagesaufteilung
${ctx.shiftsPerDay.map((d) => `- ${d.day}: ${d.shiftCount} Schichten, ${d.bookedCount} gebucht, ${d.openSpots} offen`).join("\n")}

## Bereiche
${ctx.divisions.length > 0 ? ctx.divisions.map((d) => `- ${d.name}: ${d.shiftCount} Schichten`).join("\n") : "- Keine Bereiche zugeordnet"}

## Abwesenheiten (${ctx.absences.length})
${ctx.absences.length > 0 ? ctx.absences.map((a) => `- ${a.name}: ${a.category} (${a.from} - ${a.to})`).join("\n") : "- Keine Abwesenheiten gemeldet"}`;

  // 3. Call Claude
  const response = await generateAIResponse({
    orgId,
    feature: "smartBriefing",
    systemPrompt,
    userMessage,
    maxTokens: 1000,
  });

  return {
    text: response.content,
    model: response.model,
    inputTokens: response.inputTokens,
    outputTokens: response.outputTokens,
  };
}
