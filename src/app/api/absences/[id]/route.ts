import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getCurrentMember, isAdminOrAbove } from "@/lib/auth-helpers";
import { validDate } from "@/lib/berlin";
import { notify } from "@/lib/planning";

// PATCH /api/absences/[id] - Update absence (approve/decline/edit)
const updateAbsenceSchema = z.object({
  status: z.enum(["PENDING", "APPROVED", "DECLINED"]).optional(),
  dateFrom: z.string().refine(validDate).optional(),
  dateTo: z.string().refine(validDate).optional(),
  note: z.string().nullable().optional(),
  categoryId: z.string().optional(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const member = await getCurrentMember();
  if (!member) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const isAdmin = isAdminOrAbove(member.role);

  // Find the absence
  const absence = await db.absence.findFirst({
    where: { id, category: { organizationId: member.organizationId } },
    include: { user: true },
  });

  if (!absence) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Verify user is in the same org
  const orgMember = await db.organizationMember.findFirst({
    where: {
      organizationId: member.organizationId,
      userId: absence.userId,
      isActive: true,
    },
  });
  if (!orgMember) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = updateAbsenceSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.issues },
      { status: 400 }
    );
  }

  const data = parsed.data;
  if ((data.dateFrom || absence.dateFrom.toISOString().slice(0,10)) > (data.dateTo || absence.dateTo.toISOString().slice(0,10))) return NextResponse.json({ error: "Enddatum liegt vor dem Beginn." }, { status: 400 });

  // Only admin+ can approve/decline
  if (data.status && (data.status === "APPROVED" || data.status === "DECLINED")) {
    if (!isAdmin) {
      return NextResponse.json(
        { error: "Only admins can approve or decline absences" },
        { status: 403 }
      );
    }
  }

  // Non-admins can only edit their own PENDING absences
  if (!isAdmin) {
    if (absence.userId !== member.user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (absence.status !== "PENDING") {
      return NextResponse.json(
        { error: "Can only edit pending absences" },
        { status: 400 }
      );
    }
  }

  // Build update data
  const updateData: Record<string, unknown> = {};

  if (data.status !== undefined) {
    updateData.status = data.status;
  }
  if (data.dateFrom !== undefined) {
    updateData.dateFrom = new Date(data.dateFrom + "T00:00:00.000Z");
  }
  if (data.dateTo !== undefined) {
    updateData.dateTo = new Date(data.dateTo + "T00:00:00.000Z");
  }
  if (data.note !== undefined) {
    updateData.note = data.note;
  }
  if (data.categoryId !== undefined) {
    // Verify category belongs to org
    const category = await db.absenceCategory.findFirst({
      where: {
        id: data.categoryId,
        organizationId: member.organizationId,
      },
    });
    if (!category) {
      return NextResponse.json(
        { error: "Category not found" },
        { status: 404 }
      );
    }
    updateData.categoryId = data.categoryId;
  }

  const updated = await db.$transaction(async tx => {
  const result = await tx.absence.update({
    where: { id },
    data: updateData,
    include: {
      user: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          profileImage: true,
        },
      },
      category: {
        select: {
          id: true,
          name: true,
          color: true,
          isPaid: true,
        },
      },
    },
  });

  if (data.status && data.status !== absence.status) await notify(tx, member.organizationId, member.userId, [absence.userId], "Abwesenheitsantrag " + (data.status === "APPROVED" ? "genehmigt" : data.status === "DECLINED" ? "abgelehnt" : "zur Prüfung"), result.dateFrom.toISOString().slice(0,10) + " bis " + result.dateTo.toISOString().slice(0,10));
  return result;
  });
  return NextResponse.json({ absence: updated });
}

// DELETE /api/absences/[id] - Delete absence
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const member = await getCurrentMember();
  if (!member) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const isAdmin = isAdminOrAbove(member.role);

  // Find the absence
  const absence = await db.absence.findFirst({ where: { id, category: { organizationId: member.organizationId } } });
  if (!absence) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Verify user is in the same org
  const orgMember = await db.organizationMember.findFirst({
    where: {
      organizationId: member.organizationId,
      userId: absence.userId,
      isActive: true,
    },
  });
  if (!orgMember) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Admin+ can always delete. Employees can delete their own PENDING absences only.
  if (!isAdmin) {
    if (absence.userId !== member.user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (absence.status !== "PENDING") {
      return NextResponse.json(
        { error: "Can only delete pending absences" },
        { status: 400 }
      );
    }
  }

  await db.absence.delete({ where: { id } });

  return NextResponse.json({ success: true });
}
