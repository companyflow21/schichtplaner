import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getCurrentMember, isAdminOrAbove } from "@/lib/auth-helpers";

// GET /api/files?folderId=xxx (null/omit for root)
export async function GET(request: NextRequest) {
  const member = await getCurrentMember();
  if (!member) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const folderId = request.nextUrl.searchParams.get("folderId") || null;
  const orgId = member.organizationId;

  // Validate the requested folder and its entire ancestry before returning
  // anything. A foreign parent must not leak its name into the breadcrumb.
  const breadcrumb: { id: string; name: string }[] = [];
  const visited = new Set<string>();
  let currentFolderId = folderId;
  while (currentFolderId) {
    if (visited.has(currentFolderId)) {
      return NextResponse.json({ error: "Folder not found" }, { status: 404 });
    }
    visited.add(currentFolderId);

    const folder = await db.portalFolder.findFirst({
      where: { id: currentFolderId, organizationId: orgId },
      select: { id: true, name: true, parentId: true },
    });
    if (!folder) {
      return NextResponse.json({ error: "Folder not found" }, { status: 404 });
    }
    breadcrumb.unshift({ id: folder.id, name: folder.name });
    currentFolderId = folder.parentId;
  }

  // Get folders at this level
  const folders = await db.portalFolder.findMany({
    where: { organizationId: orgId, parentId: folderId },
    orderBy: { name: "asc" },
  });

  // Get files at this level
  const files = await db.portalFile.findMany({
    where: { organizationId: orgId, folderId },
    include: {
      uploadedBy: {
        select: { id: true, firstName: true, lastName: true },
      },
    },
    orderBy: { name: "asc" },
  });

  return NextResponse.json({ folders, files, breadcrumb });
}

// POST /api/files — create folder
const createFolderSchema = z.object({
  name: z.string().min(1).max(100),
  parentId: z.string().nullable().optional(),
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

  const parsed = createFolderSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.issues },
      { status: 400 }
    );
  }

  const { name, parentId } = parsed.data;

  // Verify parent folder if provided
  if (parentId) {
    const parent = await db.portalFolder.findFirst({
      where: { id: parentId, organizationId: member.organizationId },
    });
    if (!parent) {
      return NextResponse.json({ error: "Parent folder not found" }, { status: 404 });
    }
  }

  const folder = await db.portalFolder.create({
    data: {
      organizationId: member.organizationId,
      name,
      parentId: parentId || null,
    },
  });

  return NextResponse.json({ folder }, { status: 201 });
}
