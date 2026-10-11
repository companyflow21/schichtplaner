import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentMember, isAdminOrAbove } from "@/lib/auth-helpers";

// GET /api/topics/[id] — get topic with all posts
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const member = await getCurrentMember();
  if (!member) {
    return NextResponse.json({ error: "Nicht angemeldet." }, { status: 401 });
  }

  const { id } = await params;

  const topic = await db.topic.findFirst({
    where: { id, organizationId: member.organizationId },
    include: {
      posts: {
        include: {
          user: {
            select: { id: true, firstName: true, lastName: true, profileImage: true },
          },
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  if (!topic) {
    return NextResponse.json({ error: "Nicht gefunden." }, { status: 404 });
  }

  // Get creator details
  const creator = await db.user.findUnique({
    where: { id: topic.createdById },
    select: { id: true, firstName: true, lastName: true, profileImage: true },
  });

  return NextResponse.json({ topic: { ...topic, creator } });
}

// DELETE /api/topics/[id] — delete topic (admin only)
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const member = await getCurrentMember();
  if (!member) {
    return NextResponse.json({ error: "Nicht angemeldet." }, { status: 401 });
  }

  if (!isAdminOrAbove(member.role)) {
    return NextResponse.json({ error: "Keine Berechtigung." }, { status: 403 });
  }

  const { id } = await params;

  const topic = await db.topic.findFirst({
    where: { id, organizationId: member.organizationId },
  });

  if (!topic) {
    return NextResponse.json({ error: "Nicht gefunden." }, { status: 404 });
  }

  await db.topic.delete({ where: { id } });

  return NextResponse.json({ success: true });
}
