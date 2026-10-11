import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getCurrentMember } from "@/lib/auth-helpers";

// GET /api/topics — list topics for org
export async function GET() {
  const member = await getCurrentMember();
  if (!member) {
    return NextResponse.json({ error: "Nicht angemeldet." }, { status: 401 });
  }

  const topics = await db.topic.findMany({
    where: { organizationId: member.organizationId },
    include: {
      posts: {
        select: { id: true, createdAt: true },
        orderBy: { createdAt: "desc" },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  // Get creator details
  const creatorIds = [...new Set(topics.map((t) => t.createdById))];
  const creators = await db.user.findMany({
    where: { id: { in: creatorIds } },
    select: { id: true, firstName: true, lastName: true, profileImage: true },
  });
  const creatorMap = new Map(creators.map((c) => [c.id, c]));

  const result = topics.map((topic) => ({
    id: topic.id,
    title: topic.title,
    createdAt: topic.createdAt,
    creator: creatorMap.get(topic.createdById) || null,
    postCount: topic.posts.length,
    lastActivity: topic.posts[0]?.createdAt || topic.createdAt,
  }));

  return NextResponse.json({ topics: result });
}

// POST /api/topics — create topic
const createSchema = z.object({
  title: z.string().min(1).max(200),
});

export async function POST(request: NextRequest) {
  const member = await getCurrentMember();
  if (!member) {
    return NextResponse.json({ error: "Nicht angemeldet." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Ungültige Anfrage." }, { status: 400 });
  }

  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Ungültige Eingabe.", details: parsed.error.issues },
      { status: 400 }
    );
  }

  const topic = await db.topic.create({
    data: {
      organizationId: member.organizationId,
      title: parsed.data.title,
      createdById: member.user.id,
    },
  });

  return NextResponse.json({ topic }, { status: 201 });
}
