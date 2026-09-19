import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { NextResponse } from "next/server";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const member = await db.organizationMember.findFirst({
    where: { userId: session.user.id, isActive: true, isActivated: true, organization: { deletedAt: null } },
    include: {
      organization: { select: { id: true, name: true } },
      user: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          profileImage: true,
          locale: true,
        },
      },
    },
    orderBy: { joinedAt: "asc" },
  });

  if (!member) {
    return NextResponse.json({ error: "No membership found" }, { status: 404 });
  }

  return NextResponse.json({
    id: member.id,
    role: member.role,
    organizationId: member.organization.id,
    organizationName: member.organization.name,
    user: member.user,
  });
}
