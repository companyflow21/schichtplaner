import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentMember } from "@/lib/auth-helpers";

// GET /api/messages/unread-count
export async function GET() {
  const member = await getCurrentMember();
  if (!member) {
    return NextResponse.json({ error: "Nicht angemeldet." }, { status: 401 });
  }

  const count = await db.messageRecipient.count({
    where: {
      userId: member.user.id,
      isRead: false,
      isDeleted: false,
      message: { organizationId: member.organizationId },
    },
  });

  return NextResponse.json({ count });
}
