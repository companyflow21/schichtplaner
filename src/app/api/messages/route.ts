import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getCurrentMember } from "@/lib/auth-helpers";
import { emitToOrg } from "@/lib/emit";

// GET /api/messages?folder=inbox|sent|trash
export async function GET(request: NextRequest) {
  const member = await getCurrentMember();
  if (!member) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const folder = request.nextUrl.searchParams.get("folder") || "inbox";
  const userId = member.user.id;
  const orgId = member.organizationId;

  if (folder === "sent") {
    const messages = await db.message.findMany({
      where: { organizationId: orgId, senderId: userId },
      include: {
        sender: {
          select: { id: true, firstName: true, lastName: true, profileImage: true },
        },
        recipients: {
          include: {
            user: {
              select: { id: true, firstName: true, lastName: true },
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json({ messages });
  }

  if (folder === "trash") {
    const messages = await db.message.findMany({
      where: {
        organizationId: orgId,
        recipients: {
          some: { userId, isDeleted: true },
        },
      },
      include: {
        sender: {
          select: { id: true, firstName: true, lastName: true, profileImage: true },
        },
        recipients: {
          where: { userId },
          select: { isRead: true, isDeleted: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json({ messages });
  }

  // Default: inbox
  const messages = await db.message.findMany({
    where: {
      organizationId: orgId,
      recipients: {
        some: { userId, isDeleted: false },
      },
    },
    include: {
      sender: {
        select: { id: true, firstName: true, lastName: true, profileImage: true },
      },
      recipients: {
        where: { userId },
        select: { isRead: true, isDeleted: true },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  // Get unread count
  const unreadCount = await db.messageRecipient.count({
    where: { userId, isRead: false, isDeleted: false, message: { organizationId: orgId } },
  });

  return NextResponse.json({ messages, unreadCount });
}

// POST /api/messages — send a new message
const sendSchema = z.object({
  shiftId: z.string().optional(),
  subject: z.string().min(1),
  body: z.string().min(1),
  recipientIds: z.array(z.string().min(1)).min(1),
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

  const parsed = sendSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.issues },
      { status: 400 }
    );
  }

  const { subject, body: msgBody, recipientIds } = parsed.data;
  if (parsed.data.shiftId) {
    const shift = await db.shift.findFirst({ where: { id: parsed.data.shiftId, deletedAt: null, schedule: { organizationId: member.organizationId, isPublic: true, deletedAt: null } } });
    if (!shift) return NextResponse.json({ error: "Schicht nicht gefunden." }, { status: 404 });
  }

  // Verify recipients are in the same org
  const validRecipients = await db.organizationMember.findMany({
    where: {
      organizationId: member.organizationId,
      userId: { in: recipientIds },
      isActive: true,
    },
    select: { userId: true },
  });

  const validIds = validRecipients.map((r) => r.userId);

  if (validIds.length === 0) {
    return NextResponse.json(
      { error: "No valid recipients found" },
      { status: 400 }
    );
  }

  const message = await db.message.create({
    data: {
      organizationId: member.organizationId,
      senderId: member.user.id,
      shiftId: parsed.data.shiftId,
      subject,
      body: msgBody,
      recipients: {
        create: validIds.map((userId) => ({
          userId,
          isRead: false,
          isDeleted: false,
        })),
      },
    },
    include: {
      sender: {
        select: { id: true, firstName: true, lastName: true, profileImage: true },
      },
      recipients: {
        include: {
          user: {
            select: { id: true, firstName: true, lastName: true },
          },
        },
      },
    },
  });

  // Broadcast real-time notification to org members
  emitToOrg(member.organizationId, "message:new", {
    messageId: message.id,
    senderId: member.user.id,
    recipientIds: validIds,
    subject,
  });

  return NextResponse.json({ message }, { status: 201 });
}
