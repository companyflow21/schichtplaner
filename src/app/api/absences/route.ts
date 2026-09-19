import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getCurrentMember, isAdminOrAbove } from "@/lib/auth-helpers";
import { validDate } from "@/lib/berlin";
import { notify, planners } from "@/lib/planning";

// GET /api/absences - List absences for the org
export async function GET(request: NextRequest) {
  const member = await getCurrentMember();
  if (!member) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = request.nextUrl;
  const monthParam = searchParams.get("month"); // e.g. "2026-03"
  const yearParam = searchParams.get("year"); // e.g. "2026"
  const userIdParam = searchParams.get("userId");
  const statusParam = searchParams.get("status"); // PENDING, APPROVED, DECLINED

  // Get all org members
  const orgMembers = await db.organizationMember.findMany({
    where: { organizationId: member.organizationId, isActive: true },
    select: { userId: true },
  });
  const orgUserIds = orgMembers.map((m) => m.userId);

  // Build where clause
  const where: Record<string, unknown> = {
    category: { organizationId: member.organizationId },
    userId: { in: orgUserIds },
  };

  // Date range filter
  if (yearParam) {
    const year = parseInt(yearParam, 10);
    if (!isNaN(year)) {
      where.dateFrom = { lte: new Date(`${year}-12-31`) };
      where.dateTo = { gte: new Date(`${year}-01-01`) };
    }
  } else if (monthParam) {
    if (/^\d{4}-(0[1-9]|1[0-2])$/.test(monthParam)) {
      const monthStart = new Date(monthParam + "-01T00:00:00Z");
      const monthEnd = new Date(monthStart);
      monthEnd.setUTCMonth(monthEnd.getUTCMonth() + 1);
      monthEnd.setUTCDate(0);
      where.dateFrom = { lte: monthEnd };
      where.dateTo = { gte: monthStart };
    }
  }

  // User filter
  if (userIdParam && orgUserIds.includes(userIdParam)) {
    where.userId = userIdParam;
  }

  // Status filter
  if (statusParam && ["PENDING", "APPROVED", "DECLINED"].includes(statusParam)) {
    where.status = statusParam;
  }

  // Employees can only see their own absences
  const isAdmin = isAdminOrAbove(member.role);
  if (!isAdmin) {
    where.userId = member.user.id;
  }

  const absences = await db.absence.findMany({
    where,
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
    orderBy: { dateFrom: "asc" },
  });

  // Get counts by status
  const allAbsences = await db.absence.findMany({
    where: {
      category: { organizationId: member.organizationId },
      userId: isAdmin ? { in: orgUserIds } : member.user.id,
    },
    select: { status: true },
  });

  const counts = {
    all: allAbsences.length,
    pending: allAbsences.filter((a) => a.status === "PENDING").length,
    approved: allAbsences.filter((a) => a.status === "APPROVED").length,
    declined: allAbsences.filter((a) => a.status === "DECLINED").length,
  };

  return NextResponse.json({ absences, counts });
}

// POST /api/absences - Create absence request
const createAbsenceSchema = z.object({
  userId: z.string().min(1),
  categoryId: z.string().min(1),
  dateFrom: z.string().refine(validDate),
  dateTo: z.string().refine(validDate),
  note: z.string().optional(),
  status: z.enum(["PENDING", "APPROVED"]).optional(),
});

export async function POST(request: NextRequest) {
  const member = await getCurrentMember();
  if (!member) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = createAbsenceSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.issues },
      { status: 400 }
    );
  }

  const data = parsed.data;

  // Permission check: employees can only create for themselves
  const isAdmin = isAdminOrAbove(member.role);
  if (!isAdmin && data.userId !== member.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Employees always create as PENDING, admins can create as APPROVED
  const status = isAdmin && data.status === "APPROVED" ? "APPROVED" : "PENDING";

  // Verify user is in the org
  const targetMember = await db.organizationMember.findFirst({
    where: {
      organizationId: member.organizationId,
      userId: data.userId,
      isActive: true,
    },
  });
  if (!targetMember) {
    return NextResponse.json(
      { error: "User not found in organization" },
      { status: 404 }
    );
  }

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

  // Validate date range
  const dateFrom = new Date(data.dateFrom + "T00:00:00.000Z");
  const dateTo = new Date(data.dateTo + "T00:00:00.000Z");
  if (isNaN(dateFrom.getTime()) || isNaN(dateTo.getTime())) {
    return NextResponse.json(
      { error: "Invalid date format" },
      { status: 400 }
    );
  }
  if (dateFrom > dateTo) {
    return NextResponse.json(
      { error: "dateFrom must be before or equal to dateTo" },
      { status: 400 }
    );
  }

  const absence = await db.$transaction(async tx => {
  const created = await tx.absence.create({
    data: {
      userId: data.userId,
      categoryId: data.categoryId,
      dateFrom,
      dateTo,
      note: data.note || null,
      status,
    },
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

  await notify(tx, member.organizationId, member.userId, status === "PENDING" ? await planners(tx, member.organizationId) : [data.userId], status === "PENDING" ? "Neuer Abwesenheitsantrag" : "Abwesenheit genehmigt", data.dateFrom + " bis " + data.dateTo + " · " + category.name);
  return created;
  });
  return NextResponse.json({ absence }, { status: 201 });
}
