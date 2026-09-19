import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getCurrentMember, isManagerOrAbove } from "@/lib/auth-helpers";
import { notify, planners } from "@/lib/planning";
import { emitToOrg } from "@/lib/emit";

const updateScheduleSchema = z.object({
  isPublic: z.boolean().optional(),
  settingsLayout: z.enum(["LAYOUT_1", "LAYOUT_2"]).optional(),
  showTitle: z.boolean().optional(),
  showPauses: z.boolean().optional(),
});

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * PATCH /api/schedules/:id
 *
 * Update schedule settings (isPublic, settingsLayout, showTitle, showPauses).
 * Manager+ only.
 */
export async function PATCH(request: NextRequest, context: RouteContext) {
  const member = await getCurrentMember();
  if (!member) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isManagerOrAbove(member.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await context.params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = updateScheduleSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.issues },
      { status: 400 }
    );
  }

  // Verify schedule exists and belongs to member's org
  const existing = await db.schedule.findFirst({
    where: { id, deletedAt: null },
  });

  if (!existing || existing.organizationId !== member.organizationId) {
    return NextResponse.json(
      { error: "Schichtplan nicht gefunden" },
      { status: 404 }
    );
  }

  const schedule = await db.$transaction(async tx => {
    const result = await tx.schedule.update({ where: { id }, data: parsed.data });
    if (parsed.data.isPublic !== undefined && parsed.data.isPublic !== existing.isPublic) {
      const people = await tx.organizationMember.findMany({ where: { organizationId: member.organizationId, isActive: true }, select: { userId: true } });
      await notify(tx, member.organizationId, member.userId, people.map(p => p.userId), result.isPublic ? "Dienstplan veröffentlicht" : "Dienstplan zurückgezogen", "KW " + result.weekNumber + "/" + result.year + (result.isPublic ? " ist jetzt verfügbar." : " wird überarbeitet."));
    }
    return result;
  });
  emitToOrg(member.organizationId, "schedule:updated", { scheduleId: id });

  return NextResponse.json({
    schedule: {
      id: schedule.id,
      isPublic: schedule.isPublic,
      settingsLayout: schedule.settingsLayout,
      showTitle: schedule.showTitle,
      showPauses: schedule.showPauses,
    },
  });
}
