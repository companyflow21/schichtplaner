import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getCurrentMember } from "@/lib/auth-helpers";

const postSchema = z.object({
  text: z.string().min(1),
});

// POST /api/topics/[id]/posts — create post
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const member = await getCurrentMember();
  if (!member) {
    return NextResponse.json({ error: "Nicht angemeldet." }, { status: 401 });
  }

  const { id } = await params;

  // Verify topic exists in org
  const topic = await db.topic.findFirst({
    where: { id, organizationId: member.organizationId },
  });

  if (!topic) {
    return NextResponse.json({ error: "Thema nicht gefunden." }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Ungültige Anfrage." }, { status: 400 });
  }

  const parsed = postSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Ungültige Eingabe.", details: parsed.error.issues },
      { status: 400 }
    );
  }

  const post = await db.topicPost.create({
    data: {
      topicId: id,
      userId: member.user.id,
      text: parsed.data.text,
    },
    include: {
      user: {
        select: { id: true, firstName: true, lastName: true, profileImage: true },
      },
    },
  });

  return NextResponse.json({ post }, { status: 201 });
}
