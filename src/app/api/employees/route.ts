import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { api, ApiError } from "@/lib/api";
import { db } from "@/lib/db";
import { requireAccess } from "@/lib/access";
import { activationUrl, canCreateStaff, canManageSites, checkSites, siteScope, SITE_RIGHTS } from "@/lib/staff-sites";
import { normalizeBranchRights } from "@/lib/access-shared";

/**
 * Personalliste. Admins sehen alle, Manager nur ihnen ausdruecklich
 * zugeordnete Personen - Kontaktdaten nur mit "Personalprofil ansehen".
 * Mitarbeitende haben keine Personalliste.
 */
export async function GET(request: NextRequest) {
  return api(async () => {
    const a = await requireAccess();
    if (!a.isAdmin && a.role !== "MANAGER") throw new ApiError("Keine Berechtigung.", 403);
    const { searchParams } = request.nextUrl;
    const search = searchParams.get("search") || "";
    const role = searchParams.get("role") || "";
    const status = searchParams.get("status") || "";
    const staff = a.isAdmin ? null : [...a.staff.keys()];

    const where: Record<string, unknown> = { organizationId: a.orgId, ...(staff ? { userId: { in: staff } } : {}) };
    if (status === "inactive") where.isActive = false;
    else if (status === "not_activated") { where.isActive = true; where.isActivated = false; }
    else if (status !== "all") where.isActive = true;
    if (role && role !== "all") where.role = role.toUpperCase();

    const members = await db.organizationMember.findMany({
      where: {
        ...where,
        ...(search ? { user: { OR: [
          { firstName: { contains: search, mode: "insensitive" as const } },
          { lastName: { contains: search, mode: "insensitive" as const } },
          // Suche ueber E-Mail nur, wo die E-Mail auch sichtbar ist.
          ...(a.isAdmin ? [{ email: { contains: search, mode: "insensitive" as const } }] : []),
        ] } } : {}),
      },
      include: { user: { select: { id: true, firstName: true, lastName: true, email: true, phone: true, nickname: true, profileImage: true } } },
      orderBy: { joinedAt: "asc" },
    });
    const all = await db.organizationMember.findMany({ where: { organizationId: a.orgId, ...(staff ? { userId: { in: staff } } : {}) }, select: { role: true, isActive: true, isActivated: true } });
    const counts = {
      all: all.filter((m) => m.isActive).length,
      admin: all.filter((m) => m.isActive && m.role === "ADMIN").length,
      manager: all.filter((m) => m.isActive && m.role === "MANAGER").length,
      not_activated: all.filter((m) => m.isActive && !m.isActivated).length,
      inactive: all.filter((m) => !m.isActive).length,
    };
    // Standortzuordnung nur innerhalb des eigenen Bereichs (Admins: alle).
    const scope = siteScope(a);
    const grants = await db.branchAccess.findMany({
      where: { organizationId: a.orgId, memberId: { in: members.filter((m) => m.role === "EMPLOYEE").map((m) => m.id) }, ...(scope ? { branchId: { in: scope } } : {}) },
      select: { memberId: true, rights: true, branch: { select: { id: true, name: true } } },
      orderBy: { branch: { name: "asc" } },
    });

    return {
      members: members.map((m) => {
        const profile = a.isAdmin || (a.staff.get(m.userId)?.rights.has("VIEW_PROFILE") ?? false);
        const { email, phone, nickname, ...name } = m.user;
        return {
          id: m.id, role: m.role, isActive: m.isActive, isActivated: m.isActivated, joinedAt: m.joinedAt,
          user: profile ? { ...name, email, phone, nickname } : { ...name, email: null, phone: null, nickname: null },
          rights: a.isAdmin ? null : [...(a.staff.get(m.userId)?.rights ?? [])],
          sites: m.role === "EMPLOYEE" ? grants.filter((g) => g.memberId === m.id && normalizeBranchRights(g.rights, m.role).includes("REQUEST_SHIFTS")).map((g) => g.branch) : null,
          canEditSites: canManageSites(a, m),
          canInvite: m.isActive && !m.isActivated && (a.isAdmin || (m.createdByMemberId === a.memberId && m.role === "EMPLOYEE" && a.staff.has(m.userId))),
        };
      }),
      counts,
      canCreate: canCreateStaff(a),
    };
  });
}

const createEmployeeSchema = z.object({
  employees: z.array(z.object({
    firstName: z.string().trim().min(1).max(100),
    lastName: z.string().trim().min(1).max(100),
    email: z.string().trim().email().max(254),
    role: z.enum(["ADMIN", "MANAGER", "EMPLOYEE"]),
    /** Standortzuordnung (nur Mitarbeitende), auch ueber Kunden hinweg. */
    branchIds: z.array(z.string().min(1)).max(200).optional(),
  })).min(1).max(100),
});

/**
 * POST /api/employees - Konten anlegen.
 * Admins: alle Rollen, alle Standorte. Manager: nur die Rolle EMPLOYEE und
 * nur Standorte, an denen sie selbst EDIT_SHIFTS haben; sie werden der neuen
 * Person mit "Einplanen" zugeordnet - nichts darueber hinaus. Die Antwort
 * enthaelt den Aktivierungslink fuer die anlegende Person.
 */
export async function POST(request: NextRequest) {
  return api(async () => {
    const a = await requireAccess();
    if (!canCreateStaff(a)) throw new ApiError("Keine Berechtigung.", 403);
    let raw: unknown;
    try { raw = await request.json(); } catch { throw new ApiError("Ungültige Anfrage."); }
    const { employees } = createEmployeeSchema.parse(raw);
    const manager = !a.isAdmin;
    if (manager && employees.some((e) => e.role !== "EMPLOYEE")) throw new ApiError("Manager können nur Konten mit der Rolle Mitarbeiter anlegen.", 403);
    if (employees.some((e) => e.role !== "EMPLOYEE" && e.branchIds?.length)) throw new ApiError("Standorte werden nur Mitarbeitenden zugeordnet. Manager erhalten ihre Freigaben im Profil.", 400);
    if (manager && employees.some((e) => !e.branchIds?.length)) throw new ApiError("Bitte für jede Person mindestens einen Standort wählen.", 400);
    await checkSites(db, a, employees.flatMap((e) => e.branchIds ?? []));

    const emails = employees.map((e) => e.email.toLowerCase());
    if (new Set(emails).size !== emails.length) throw new ApiError("E-Mail-Adressen sind doppelt angegeben.");
    const existingUsers = await db.user.findMany({ where: { email: { in: emails } }, select: { id: true, email: true } });
    const existingEmails = new Set(existingUsers.map((u) => u.email.toLowerCase()));
    // Manager legen nur neue Konten an: ein bestehendes Benutzerkonto samt
    // Anmeldung bindet nur die Administration an diese Organisation.
    if (manager && existingUsers.length) throw new ApiError("Diese E-Mail-Adresse ist bereits vergeben. Bitte die Administration ansprechen.", 409, { emails: existingUsers.map((u) => u.email) });
    if (existingUsers.length > 0) {
      const memberships = await db.organizationMember.findMany({ where: { organizationId: a.orgId, userId: { in: existingUsers.map((u) => u.id) } }, select: { userId: true } });
      const already = new Set(memberships.map((m) => m.userId));
      const duplicates = existingUsers.filter((u) => already.has(u.id)).map((u) => u.email);
      if (duplicates.length) return NextResponse.json({ error: "Some employees are already members", emails: duplicates }, { status: 409 });
    }

    const createdMembers = await db.$transaction(async (tx) => {
      const results = [];
      for (const emp of employees) {
        const user = existingEmails.has(emp.email.toLowerCase())
          ? existingUsers.find((u) => u.email.toLowerCase() === emp.email.toLowerCase())!
          : await tx.user.create({ data: { email: emp.email.toLowerCase(), firstName: emp.firstName, lastName: emp.lastName, passwordHash: await bcrypt.hash(crypto.randomUUID(), 10) } });
        const member = await tx.organizationMember.create({
          data: { organizationId: a.orgId, userId: user.id, role: emp.role, isActivated: false, activationToken: crypto.randomUUID(), activationExpiresAt: new Date(Date.now() + 7 * 86400000), createdByMemberId: a.memberId },
          include: { user: { select: { id: true, firstName: true, lastName: true, email: true, phone: true, nickname: true, profileImage: true } } },
        });
        const sites = [...new Set(emp.branchIds ?? [])];
        if (sites.length) await tx.branchAccess.createMany({ data: sites.map((branchId) => ({ organizationId: a.orgId, memberId: member.id, branchId, rights: SITE_RIGHTS })) });
        if (manager) await tx.staffAssignment.create({ data: { organizationId: a.orgId, managerMemberId: a.memberId, employeeMemberId: member.id, rights: ["ASSIGN_SHIFTS"] } });
        results.push(member);
      }
      return results;
    });
    return NextResponse.json({
      members: createdMembers.map(({ activationToken, activationExpiresAt, createdByMemberId: _c, ...m }) => {
        void _c;
        return { ...m, activationUrl: activationUrl(request, activationToken!), activationValidUntil: activationExpiresAt };
      }),
    }, { status: 201 });
  });
}
