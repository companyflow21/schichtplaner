import { z } from "zod";
import { api, body, requireMember, ApiError } from "@/lib/api";
import { db } from "@/lib/db";
const schema = z.object({ name: z.string().trim().min(1).max(100), address: z.string().max(500).default(""), meetingPoint: z.string().max(500).default(""), notes: z.string().max(2000).default(""), positions: z.array(z.string().trim().min(1).max(100)).max(30).default([]), isActive: z.boolean().default(true) });
export async function GET() {
  return api(async () => { const m = await requireMember(); return { branches: await db.branch.findMany({ where: { organizationId: m.organizationId }, orderBy: { name: "asc" } }) }; });
}
export async function POST(request: Request) {
  return api(async () => { const m = await requireMember(true); const data = await body(request, schema); return { branch: await db.branch.create({ data: { ...data, organizationId: m.organizationId } }) }; });
}
export async function PATCH(request: Request) {
  return api(async () => {
    const m = await requireMember(true);
    const { id, ...data } = await body(request, schema.extend({ id: z.string() }));
    const result = await db.branch.updateMany({ where: { id, organizationId: m.organizationId }, data });
    if (!result.count) throw new ApiError("Einsatzort nicht gefunden.", 404);
    return { success: true };
  });
}
