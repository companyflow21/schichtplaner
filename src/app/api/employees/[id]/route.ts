import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getCurrentMember, isAdminOrAbove } from "@/lib/auth-helpers";

// GET /api/employees/[id] - Get employee detail
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const member = await getCurrentMember();
  if (!member) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const employee = await db.organizationMember.findFirst({
    where: {
      id,
      organizationId: member.organizationId,
    },
    include: {
      user: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          phone: true,
          nickname: true,
          profileImage: true,
          createdAt: true,
        },
      },
    },
  });

  if (!employee) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!isAdminOrAbove(member.role) && employee.userId !== member.userId) return NextResponse.json({ error: "Keine Berechtigung." }, { status: 403 });

  return NextResponse.json({ ...employee, activationToken: undefined, activationExpiresAt: undefined });
}

// PATCH /api/employees/[id] - Update employee data
const updateEmployeeSchema = z.object({
  position: z.string().max(100).optional(),
  employmentType: z.string().max(100).optional(),
  targetHoursPerWeek: z.number().min(0).max(80).optional(),
  qualifications: z.array(z.string().trim().min(1).max(100)).max(50).optional(),
  isActive: z.boolean().optional(),
  firstName: z.string().min(1).optional(),
  lastName: z.string().min(1).optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  nickname: z.string().optional(),
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

  // Verify the target is in the same org
  const target = await db.organizationMember.findFirst({
    where: {
      id,
      organizationId: member.organizationId,
    },
  });

  if (!target) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Only admin+ or the user themselves can edit
  const isSelf = target.userId === member.userId;
  if (!isSelf && !isAdminOrAbove(member.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = updateEmployeeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.issues },
      { status: 400 }
    );
  }

  const data = parsed.data;
  const { position, employmentType, targetHoursPerWeek, qualifications, isActive } = data;
  const personnelEdit = [position, employmentType, targetHoursPerWeek, qualifications, isActive].some(v => v !== undefined);
  if (personnelEdit && !isAdminOrAbove(member.role)) return NextResponse.json({ error: "Nur Administratoren dürfen Stammdaten ändern." }, { status: 403 });
  if (isActive === false && (target.userId === member.userId || target.role === "OWNER")) return NextResponse.json({ error: "Eigenes Konto und Inhaber können nicht deaktiviert werden." }, { status: 400 });

  // Check email uniqueness if changing email
  if (data.email) {
    const existing = await db.user.findFirst({
      where: {
        email: data.email.toLowerCase(),
        NOT: { id: target.userId },
      },
    });
    if (existing) {
      return NextResponse.json(
        { error: "Email already in use" },
        { status: 409 }
      );
    }
  }

  const updated = await db.$transaction(async tx => {
    if (personnelEdit) await tx.organizationMember.update({ where: { id }, data: { position, employmentType, targetHoursPerWeek, qualifications, isActive } });
    return tx.user.update({
    where: { id: target.userId },
    data: {
      ...(data.firstName !== undefined && { firstName: data.firstName }),
      ...(data.lastName !== undefined && { lastName: data.lastName }),
      ...(data.email !== undefined && { email: data.email.toLowerCase() }),
      ...(data.phone !== undefined && { phone: data.phone || null }),
      ...(data.nickname !== undefined && { nickname: data.nickname || null }),
    },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      phone: true,
      nickname: true,
      profileImage: true,
    },
    });
  });

  return NextResponse.json(updated);
}

// DELETE /api/employees/[id] - Soft-delete (deactivate)
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const member = await getCurrentMember();
  if (!member) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isAdminOrAbove(member.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  const target = await db.organizationMember.findFirst({
    where: {
      id,
      organizationId: member.organizationId,
    },
  });

  if (!target) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Cannot deactivate yourself
  if (target.userId === member.userId) {
    return NextResponse.json(
      { error: "Cannot deactivate yourself" },
      { status: 400 }
    );
  }

  // Cannot deactivate the owner
  if (target.role === "OWNER") {
    return NextResponse.json(
      { error: "Cannot deactivate the owner" },
      { status: 400 }
    );
  }

  await db.organizationMember.update({
    where: { id },
    data: { isActive: false },
  });

  return NextResponse.json({ success: true });
}
