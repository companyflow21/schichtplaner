import { z } from "zod";
import { Prisma } from "@prisma/client";
import { api, body, ApiError } from "@/lib/api";
import { db } from "@/lib/db";
import { requireAccess, requireAdmin } from "@/lib/access";
import { normalizeQualification } from "@/lib/qualifications";

/** Katalog der eigenen Organisation - fuer die Auswahl in Personal- und Schichtformularen. */
export async function GET() {
  return api(async () => {
    const a = await requireAccess();
    if (!a.isAdmin && a.role !== "MANAGER") throw new ApiError("Keine Berechtigung.", 403);
    const qualifications = await db.qualification.findMany({ where: { organizationId: a.orgId }, orderBy: { name: "asc" }, select: { id: true, name: true } });
    return { qualifications };
  });
}

/** Neuer Katalogeintrag - nur Admins. Doppelte verhindert der eindeutige Index, auch bei gleichzeitiger Anlage. */
export async function POST(request: Request) {
  return api(async () => {
    const a = await requireAccess();
    requireAdmin(a);
    const { name } = await body(request, z.object({ name: z.string().trim().min(1, "Bitte einen Namen eingeben.").max(100) }));
    try {
      const qualification = await db.qualification.create({ data: { organizationId: a.orgId, name, normalizedName: normalizeQualification(name) }, select: { id: true, name: true } });
      return Response.json({ qualification }, { status: 201 });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new ApiError("Diese Qualifikation gibt es bereits.", 409);
      throw error;
    }
  });
}
