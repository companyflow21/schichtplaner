/*
 * Gemeinsame Bausteine fuer tests/shift-delete.ts und tests/employee-delete.ts:
 * eigene Personen ueber die API anlegen und aktivieren (die geteilten
 * Testpersonen anderer Reihen bleiben unberuehrt) sowie Schichten anlegen.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { isoWeek } from "../src/lib/berlin";
import type { TestContext } from "./permissions";

export type Sess = InstanceType<TestContext["Session"]>;
export type Person = { id: string; memberId: string; email: string; firstName: string; lastName: string; session: Sess };

/** Konto ueber die Verwaltung anlegen, per Einladungslink aktivieren und anmelden. */
export async function newPerson(t: TestContext, admin: Sess, key: string, firstName: string, lastName: string, role: "EMPLOYEE" | "MANAGER" = "EMPLOYEE", branchIds?: string[]): Promise<Person> {
  const email = key.toLowerCase() + "@akro-test.invalid";
  const created = await admin.request("/api/employees", "POST", { employees: [{ firstName, lastName, email, role, ...(branchIds?.length ? { branchIds } : {}) }] }, 201);
  const member = created.members[0];
  const token = new URL(member.activationUrl).searchParams.get("token");
  await new t.Session().request("/api/auth/activate", "POST", { token, password: t.password });
  const session = new t.Session();
  await session.login(email);
  return { id: member.user.id, memberId: member.id, email, firstName, lastName, session };
}

export const dayOfWeek = (day: string) => ((new Date(day + "T12:00:00Z").getUTCDay() + 6) % 7) + 1;

/** Schichten eines Standorts anlegen; Wochenplaene werden bei Bedarf geoeffnet und gemerkt. */
export function planner(admin: Sess, branchId: string) {
  const plans = new Map<string, any>();
  const paths = new Map<string, string>();
  async function planFor(day: string) {
    const w = isoWeek(day), key = w.year + "-" + w.weekNumber, path = "/api/schedules?kw=" + w.weekNumber + "&year=" + w.year + "&standort=" + branchId;
    if (!plans.has(key)) plans.set(key, (await admin.request(path)).schedule);
    return { plan: plans.get(key), path };
  }
  return {
    async shift(day: string, from: string, to: string, max = 1, extra: Record<string, unknown> = {}) {
      const { plan, path } = await planFor(day);
      const created = (await admin.request("/api/shifts", "POST", { scheduleId: plan.id, dayOfWeek: dayOfWeek(day), shiftFrom: from, shiftTo: to, maxEmployees: max, title: "Löschtest", ...extra })).shifts[0];
      paths.set(created.id, path);
      return created;
    },
    book: (shiftId: string, userId: string) => admin.request("/api/bookings", "POST", { shiftId, userId, confirm: true }),
    async publish(day: string) {
      const { plan } = await planFor(day);
      await admin.request("/api/schedules/" + plan.id, "PATCH", { isPublic: true });
    },
    /** Schicht laut Standortplan (Admin-Sicht); undefined, wenn sie dort nicht mehr steht. */
    async view(shiftId: string, day: string) {
      const { path } = await planFor(day);
      return (await admin.request(path)).schedule.shifts.find((s: any) => s.id === shiftId);
    },
  };
}

/** Anzahl der Nachrichten mit diesem Betreff im Posteingang. */
export async function inboxCount(s: Sess, subject: string): Promise<number> {
  return (await s.request("/api/messages?folder=inbox")).messages.filter((m: any) => m.subject === subject).length;
}

/** Anmeldeversuch mit richtigem Passwort, der scheitern muss (Konto geloescht oder deaktiviert): danach gibt es keine Sitzung. */
export async function loginRefused(t: TestContext, email: string): Promise<boolean> {
  const s = new t.Session();
  const csrf = await s.request("/api/auth/csrf");
  const res = await fetch(t.base + "/api/auth/callback/credentials", {
    method: "POST", redirect: "manual", headers: { Cookie: s.cookie(), "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ csrfToken: csrf.csrfToken, email, password: t.password, callbackUrl: t.base + "/dashboard" }),
  });
  const received = res.headers.getSetCookie().map((c) => c.split(";")[0]);
  const session = await (await fetch(t.base + "/api/auth/session", { headers: { Cookie: [s.cookie(), ...received].filter(Boolean).join("; ") } })).json();
  return !session?.user;
}
