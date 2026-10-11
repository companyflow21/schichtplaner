import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentMember } from "@/lib/auth-helpers";

// GET /api/holidays - List holidays for the org
export async function GET(request: NextRequest) {
  const member = await getCurrentMember();
  if (!member) {
    return NextResponse.json({ error: "Nicht angemeldet." }, { status: 401 });
  }

  const { searchParams } = request.nextUrl;
  const yearParam = searchParams.get("year");

  const where: Record<string, unknown> = {
    organizationId: member.organizationId,
  };

  if (yearParam) {
    const year = parseInt(yearParam, 10);
    if (!isNaN(year)) {
      where.date = {
        gte: new Date(`${year}-01-01`),
        lte: new Date(`${year}-12-31`),
      };
    }
  }

  const holidays = await db.holiday.findMany({
    where,
    orderBy: { date: "asc" },
  });

  return NextResponse.json({ holidays });
}
