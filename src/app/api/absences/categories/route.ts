import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getCurrentMember, isAdminOrAbove } from "@/lib/auth-helpers";

// GET /api/absences/categories - List absence categories
export async function GET() {
  const member = await getCurrentMember();
  if (!member) {
    return NextResponse.json({ error: "Nicht angemeldet." }, { status: 401 });
  }

  const categories = await db.absenceCategory.findMany({
    where: { organizationId: member.organizationId },
    orderBy: { name: "asc" },
  });

  return NextResponse.json({ categories });
}

// POST /api/absences/categories - Create category
const createCategorySchema = z.object({
  name: z.string().min(1),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  isPaid: z.boolean(),
});

export async function POST(request: NextRequest) {
  const member = await getCurrentMember();
  if (!member) {
    return NextResponse.json({ error: "Nicht angemeldet." }, { status: 401 });
  }

  if (!isAdminOrAbove(member.role)) {
    return NextResponse.json({ error: "Keine Berechtigung." }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Ungültige Anfrage." }, { status: 400 });
  }

  const parsed = createCategorySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Ungültige Eingabe.", details: parsed.error.issues },
      { status: 400 }
    );
  }

  const data = parsed.data;

  const category = await db.absenceCategory.create({
    data: {
      organizationId: member.organizationId,
      name: data.name,
      color: data.color,
      isPaid: data.isPaid,
    },
  });

  return NextResponse.json({ category }, { status: 201 });
}

// PATCH /api/absences/categories - Edit category (id in body)
const updateCategorySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  isPaid: z.boolean().optional(),
});

export async function PATCH(request: NextRequest) {
  const member = await getCurrentMember();
  if (!member) {
    return NextResponse.json({ error: "Nicht angemeldet." }, { status: 401 });
  }

  if (!isAdminOrAbove(member.role)) {
    return NextResponse.json({ error: "Keine Berechtigung." }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Ungültige Anfrage." }, { status: 400 });
  }

  const parsed = updateCategorySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Ungültige Eingabe.", details: parsed.error.issues },
      { status: 400 }
    );
  }

  const { id, ...data } = parsed.data;

  // Verify category belongs to org
  const existing = await db.absenceCategory.findFirst({
    where: { id, organizationId: member.organizationId },
  });
  if (!existing) {
    return NextResponse.json({ error: "Nicht gefunden." }, { status: 404 });
  }

  const updated = await db.absenceCategory.update({
    where: { id },
    data: {
      ...(data.name !== undefined && { name: data.name }),
      ...(data.color !== undefined && { color: data.color }),
      ...(data.isPaid !== undefined && { isPaid: data.isPaid }),
    },
  });

  return NextResponse.json({ category: updated });
}

// DELETE /api/absences/categories - Delete category (id in query param)
export async function DELETE(request: NextRequest) {
  const member = await getCurrentMember();
  if (!member) {
    return NextResponse.json({ error: "Nicht angemeldet." }, { status: 401 });
  }

  if (!isAdminOrAbove(member.role)) {
    return NextResponse.json({ error: "Keine Berechtigung." }, { status: 403 });
  }

  const { searchParams } = request.nextUrl;
  const id = searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "Kennung fehlt." }, { status: 400 });
  }

  // Verify category belongs to org
  const existing = await db.absenceCategory.findFirst({
    where: { id, organizationId: member.organizationId },
  });
  if (!existing) {
    return NextResponse.json({ error: "Nicht gefunden." }, { status: 404 });
  }

  // Check if category is used by any absence
  const absenceCount = await db.absence.count({
    where: { categoryId: id },
  });
  if (absenceCount > 0) {
    return NextResponse.json(
      {
        error: `Kategorie wird von ${absenceCount} Abwesenheit${absenceCount > 1 ? "en" : ""} verwendet und kann nicht gelöscht werden`,
      },
      { status: 409 }
    );
  }

  await db.absenceCategory.delete({ where: { id } });

  return NextResponse.json({ success: true });
}
