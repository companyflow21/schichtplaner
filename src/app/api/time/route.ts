import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { recordMinutes, berlinDate, validDate } from "@/lib/berlin";
import { getCurrentMember, isManagerOrAbove } from "@/lib/auth-helpers";

// GET /api/time — list time records for a month
export async function GET(request: NextRequest) {
  const member = await getCurrentMember();
  if (!member) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = request.nextUrl;
  const monthParam = searchParams.get("month"); // e.g. "2026-03"
  const userIdParam = searchParams.get("userId");

  const month = monthParam || berlinDate().slice(0, 7);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return NextResponse.json({ error: "Ungültiger Monat (JJJJ-MM)." }, { status: 400 });
  const monthStart = new Date(month + "-01T00:00:00Z");
  const monthEnd = new Date(monthStart);
  monthEnd.setUTCMonth(monthEnd.getUTCMonth() + 1);

  // Get all org members to filter by org
  const orgMembers = await db.organizationMember.findMany({
    where: { organizationId: member.organizationId, isActive: true },
    include: {
      user: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          profileImage: true,
        },
      },
    },
  });

  const orgUserIds = orgMembers.map((m) => m.user.id);

  // Employees can only see their own records
  const isManager = isManagerOrAbove(member.role);
  let filterUserIds: string[];

  if (isManager) {
    if (userIdParam && orgUserIds.includes(userIdParam)) {
      filterUserIds = [userIdParam];
    } else {
      filterUserIds = orgUserIds;
    }
  } else {
    filterUserIds = [member.user.id];
  }

  const records = await db.timeRecord.findMany({
    where: {
      organizationId: member.organizationId,
      userId: { in: filterUserIds },
      date: { gte: monthStart, lt: monthEnd },
    },
    include: {
      category: { select: { id: true, name: true } },
    },
    orderBy: [{ date: "asc" }, { timeFrom: "asc" }],
  });

  // Group by user
  const groupedMap = new Map<
    string,
    {
      userId: string;
      firstName: string;
      lastName: string;
      profileImage: string | null;
      totalHours: number;
      records: typeof records;
    }
  >();

  // Initialize all filtered users
  for (const uid of filterUserIds) {
    const om = orgMembers.find((m) => m.user.id === uid);
    if (om) {
      groupedMap.set(uid, {
        userId: uid,
        firstName: om.user.firstName,
        lastName: om.user.lastName,
        profileImage: om.user.profileImage,
        totalHours: 0,
        records: [],
      });
    }
  }

  for (const record of records) {
    const group = groupedMap.get(record.userId);
    if (!group) continue;
    group.records.push(record);

    // One calculation for stopwatch, pauses, corrections and exports.
    group.totalHours += recordMinutes(record) / 60;
  }

  const grouped = Array.from(groupedMap.values()).sort((a, b) =>
    a.lastName.localeCompare(b.lastName)
  );

  return NextResponse.json({ employees: grouped });
}

// POST /api/time — create manual time record
const createManualSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("MANUAL"),
    breakMinutes: z.number().int().min(0).max(1440).default(0),
    userId: z.string().min(1),
    date: z.string().refine(validDate),
    timeFrom: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    timeTo: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    categoryId: z.string().optional(),
    comment: z.string().optional(),
  }),
  z.object({
    type: z.literal("MANUAL_DURATION"),
    breakMinutes: z.number().int().min(0).max(1440).default(0),
    userId: z.string().min(1),
    date: z.string().refine(validDate),
    durationHours: z.number().int().min(0),
    durationMinutes: z.number().int().min(0).max(59),
    categoryId: z.string().optional(),
    comment: z.string().optional(),
  }),
]);

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

  const parsed = createManualSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.issues },
      { status: 400 }
    );
  }

  const data = parsed.data;
  if (data.type === "MANUAL" && data.timeFrom === data.timeTo) return NextResponse.json({ error: "Beginn und Ende müssen unterschiedlich sein." }, { status: 400 });
  const gross = data.type === "MANUAL" ? recordMinutes({ type: data.type, timeFrom: data.timeFrom, timeTo: data.timeTo, durationHours: null, durationMinutes: null }) : data.durationHours * 60 + data.durationMinutes;
  if (data.breakMinutes > gross) return NextResponse.json({ error: "Die Pause überschreitet die Arbeitszeit." }, { status: 400 });

  // Permission check: employees can only create for themselves
  if (!isManagerOrAbove(member.role) && data.userId !== member.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Check that the user is in the same org
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

  const recordDate = new Date(data.date + "T00:00:00.000Z");
  if (data.categoryId && !await db.timeCategory.findFirst({ where: { id: data.categoryId, organizationId: member.organizationId } })) return NextResponse.json({ error: "Kategorie nicht gefunden." }, { status: 400 });

  const record = await db.timeRecord.create({
    data: {
      organizationId: member.organizationId,
      userId: data.userId,
      date: recordDate,
      type: data.type,
      breakSeconds: data.breakMinutes * 60,
      timeFrom: data.type === "MANUAL" ? data.timeFrom : null,
      timeTo: data.type === "MANUAL" ? data.timeTo : null,
      durationHours:
        data.type === "MANUAL_DURATION" ? data.durationHours : null,
      durationMinutes:
        data.type === "MANUAL_DURATION" ? data.durationMinutes : null,
      categoryId: data.categoryId || null,
      comment: data.comment || null,
    },
    include: {
      category: { select: { id: true, name: true } },
    },
  });

  return NextResponse.json({ record }, { status: 201 });
}
