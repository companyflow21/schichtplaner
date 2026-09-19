import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getCurrentMember, isManagerOrAbove } from "@/lib/auth-helpers";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * Verify a schedule exists and belongs to the user's org.
 */
async function getScheduleForMember(scheduleId: string, orgId: string) {
  return db.schedule.findFirst({
    where: {
      id: scheduleId,
      organizationId: orgId,
      deletedAt: null,
    },
  });
}

/**
 * GET /api/schedules/:id/briefing
 *
 * Get the briefing for a schedule. Returns the first (most recent) briefing.
 */
export async function GET(_request: NextRequest, context: RouteContext) {
  const member = await getCurrentMember();
  if (!member) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;

  const schedule = await getScheduleForMember(id, member.organizationId);
  if (!schedule || (!isManagerOrAbove(member.role) && !schedule.isPublic)) {
    return NextResponse.json(
      { error: "Schichtplan nicht gefunden" },
      { status: 404 }
    );
  }

  const briefing = await db.briefing.findFirst({
    where: { scheduleId: id },
    orderBy: { updatedAt: "desc" },
  });

  return NextResponse.json({ briefing: briefing ?? null });
}

const briefingSchema = z.object({
  text: z.string().min(1, "Text darf nicht leer sein").max(5000),
});

/**
 * POST /api/schedules/:id/briefing
 *
 * Create or update the briefing for a schedule.
 * If a briefing already exists, it is updated. Otherwise a new one is created.
 * Manager+ only.
 */
export async function POST(request: NextRequest, context: RouteContext) {
  const member = await getCurrentMember();
  if (!member) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isManagerOrAbove(member.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await context.params;

  const schedule = await getScheduleForMember(id, member.organizationId);
  if (!schedule) {
    return NextResponse.json(
      { error: "Schichtplan nicht gefunden" },
      { status: 404 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = briefingSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.issues },
      { status: 400 }
    );
  }

  // Upsert: find existing briefing or create new one
  const existing = await db.briefing.findFirst({
    where: { scheduleId: id },
  });

  let briefing;
  if (existing) {
    briefing = await db.briefing.update({
      where: { id: existing.id },
      data: { text: parsed.data.text },
    });
  } else {
    briefing = await db.briefing.create({
      data: {
        scheduleId: id,
        text: parsed.data.text,
      },
    });
  }

  return NextResponse.json({ briefing }, { status: existing ? 200 : 201 });
}

/**
 * DELETE /api/schedules/:id/briefing
 *
 * Delete all briefings for a schedule.
 * Manager+ only.
 */
export async function DELETE(_request: NextRequest, context: RouteContext) {
  const member = await getCurrentMember();
  if (!member) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isManagerOrAbove(member.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await context.params;

  const schedule = await getScheduleForMember(id, member.organizationId);
  if (!schedule) {
    return NextResponse.json(
      { error: "Schichtplan nicht gefunden" },
      { status: 404 }
    );
  }

  await db.briefing.deleteMany({
    where: { scheduleId: id },
  });

  return NextResponse.json({ success: true });
}
