import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getCurrentMember, isAdminOrAbove } from "@/lib/auth-helpers";
import bcrypt from "bcryptjs";

// GET /api/employees - List all org members
export async function GET(request: NextRequest) {
  const member = await getCurrentMember();
  if (!member) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = request.nextUrl;
  const search = searchParams.get("search") || "";
  const role = searchParams.get("role") || "";
  const status = searchParams.get("status") || "";

  // Build where clause
  const where: Record<string, unknown> = {
    organizationId: member.organizationId,
  };

  // Status filter
  if (status === "inactive") {
    where.isActive = false;
  } else if (status === "not_activated") {
    where.isActive = true;
    where.isActivated = false;
  } else if (status !== "all") {
    // Default: show active
    where.isActive = true;
  }

  // Role filter
  if (role && role !== "all") {
    where.role = role.toUpperCase();
  }

  const members = await db.organizationMember.findMany({
    where: {
      ...where,
      ...(search
        ? {
            user: {
              OR: [
                { firstName: { contains: search, mode: "insensitive" as const } },
                { lastName: { contains: search, mode: "insensitive" as const } },
                { email: { contains: search, mode: "insensitive" as const } },
              ],
            },
          }
        : {}),
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
        },
      },
    },
    orderBy: { joinedAt: "asc" },
  });

  // Also get counts per category for the tabs
  const allMembers = await db.organizationMember.findMany({
    where: { organizationId: member.organizationId },
    select: { role: true, isActive: true, isActivated: true },
  });

  const counts = {
    all: allMembers.filter((m) => m.isActive).length,
    admin: allMembers.filter((m) => m.isActive && m.role === "ADMIN").length,
    manager: allMembers.filter((m) => m.isActive && m.role === "MANAGER").length,
    not_activated: allMembers.filter((m) => m.isActive && !m.isActivated).length,
    inactive: allMembers.filter((m) => !m.isActive).length,
  };

  return NextResponse.json({ members: members.map(m => ({ id: m.id, role: m.role, isActive: m.isActive, isActivated: m.isActivated, joinedAt: m.joinedAt, user: m.user })), counts });
}

// POST /api/employees - Create new employee(s)
const createEmployeeSchema = z.object({
  employees: z.array(
    z.object({
      firstName: z.string().min(1),
      lastName: z.string().min(1),
      email: z.string().email(),
      role: z.enum(["ADMIN", "MANAGER", "EMPLOYEE"]),
    })
  ),
});

export async function POST(request: NextRequest) {
  const member = await getCurrentMember();
  if (!member) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isAdminOrAbove(member.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = createEmployeeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.issues },
      { status: 400 }
    );
  }

  const { employees } = parsed.data;

  // Check for duplicate emails
  const emails = employees.map((e) => e.email.toLowerCase());
  if (new Set(emails).size !== emails.length) return NextResponse.json({ error: "E-Mail-Adressen sind doppelt angegeben." }, { status: 400 });
  const existingUsers = await db.user.findMany({
    where: { email: { in: emails } },
    select: { id: true, email: true },
  });

  const existingEmails = new Set(existingUsers.map((u) => u.email.toLowerCase()));

  // Check if any existing users are already in this org
  if (existingUsers.length > 0) {
    const existingMemberships = await db.organizationMember.findMany({
      where: {
        organizationId: member.organizationId,
        userId: { in: existingUsers.map((u) => u.id) },
      },
      select: { userId: true },
    });
    const alreadyMemberIds = new Set(existingMemberships.map((m) => m.userId));
    const alreadyMemberEmails = existingUsers
      .filter((u) => alreadyMemberIds.has(u.id))
      .map((u) => u.email);

    if (alreadyMemberEmails.length > 0) {
      return NextResponse.json(
        {
          error: "Some employees are already members",
          emails: alreadyMemberEmails,
        },
        { status: 409 }
      );
    }
  }

  // Create users and memberships in a transaction
  const createdMembers = await db.$transaction(async (tx) => {
    const results = [];

    for (const emp of employees) {
      let user;
      if (existingEmails.has(emp.email.toLowerCase())) {
        user = existingUsers.find(
          (u) => u.email.toLowerCase() === emp.email.toLowerCase()
        )!;
      } else {
        // Create user with a temporary password hash
        const tempHash = await bcrypt.hash(
          Math.random().toString(36).slice(2),
          10
        );
        user = await tx.user.create({
          data: {
            email: emp.email.toLowerCase(),
            firstName: emp.firstName,
            lastName: emp.lastName,
            passwordHash: tempHash,
          },
        });
      }

      const membership = await tx.organizationMember.create({
        data: {
          organizationId: member.organizationId,
          userId: user.id,
          role: emp.role,
          isActivated: false,
          activationToken: crypto.randomUUID(),
          activationExpiresAt: new Date(Date.now() + 7 * 86400000),
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
            },
          },
        },
      });

      results.push(membership);
    }

    return results;
  });

  return NextResponse.json({ members: createdMembers }, { status: 201 });
}
