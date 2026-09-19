import { api, requireMember, serial, ApiError } from "@/lib/api";
import { checkAssignment, publicUser, shiftInclude } from "@/lib/planning";
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  return api(async () => {
    const m = await requireMember(true);
    const { id } = await context.params;
    return serial(async tx => {
      const shift = await tx.shift.findFirst({ where: { id, deletedAt: null, schedule: { organizationId: m.organizationId, deletedAt: null } }, include: shiftInclude });
      if (!shift) throw new ApiError("Schicht nicht gefunden.", 404);
      const people = await tx.organizationMember.findMany({ where: { organizationId: m.organizationId, isActive: true }, include: { user: { select: publicUser } } });
      const members = [];
      for (const person of people) if (!shift.bookings.some(b => b.userId === person.userId) && !(await checkAssignment(tx, shift, person.userId)).length) members.push(person);
      return { members: members.map(p => ({ id: p.id, userId: p.userId, role: p.role, user: p.user })) };
    });
  });
}
