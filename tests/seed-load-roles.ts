/*
 * Ergaenzt die Daten aus seed-load-pilot.ts um Rollen und Standortrechte fuer
 * einen Lasttest mit 50 Konten: zwei Kunden mit drei Einsatzorten, drei
 * Manager, ein Admin, Mitarbeitende mit Standortzuordnung, offene Schichten
 * fuer Uebernahmeantraege, Entwuerfe zum Besetzen und Veroeffentlichen sowie
 * Daten eines fremden Mandanten fuer die Sichtbarkeitspruefung.
 *
 * Gleiche Schutzregeln wie seed-load-pilot.ts: DATABASE_URL muss bewusst
 * gesetzt sein, gearbeitet wird nur in einer Organisation, die sich als Test,
 * Pilot oder Staging ausweist, und nur mit Konten auf .invalid. Es wird
 * nichts geloescht. Das Ergebnis (IDs und erwartete Sichtbarkeit je Konto,
 * keine Passwoerter) geht nach LOAD_SCENARIO_FILE.
 *
 * Aufruf nach test:load:seed:
 *   DATABASE_URL="postgresql://…" LOAD_USERS=50 LOAD_SCENARIO_FILE=szenario.json npx tsx tests/seed-load-roles.ts
 */
import { writeFileSync } from "node:fs";
import { PrismaClient, type BranchRight, type OrgRole } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { berlinDate, isoWeek, addDate, weekDate } from "../src/lib/berlin";

const DATENBANK = process.env.DATABASE_URL ?? "";
const PRAEFIX = process.env.LOAD_USER_PREFIX || "load-user-";
const ORG_NAME = process.env.LOAD_ORG_NAME ?? "";
const FREMD_ORG = process.env.LOAD_FOREIGN_ORG_NAME || "Fremdmandant Muster GmbH";
const ANZAHL = Number(process.env.LOAD_USERS || 50);
const DATEI = process.env.LOAD_SCENARIO_FILE ?? "";

if (!DATENBANK || !DATEI) {
  console.error("DATABASE_URL (Testdatenbank) und LOAD_SCENARIO_FILE muessen gesetzt sein. Es wurde nichts geaendert.");
  process.exit(1);
}
if (ANZAHL < 50) {
  console.error("Das Rollenszenario braucht mindestens 50 Konten (LOAD_USERS).");
  process.exit(1);
}

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: DATENBANK }) });

function kontoAdresse(nummer: number): string {
  const n = String(nummer).padStart(3, "0");
  const at = PRAEFIX.indexOf("@");
  if (at >= 0) return PRAEFIX.slice(0, at) + n + PRAEFIX.slice(at);
  return PRAEFIX + n + "@akro-test.invalid";
}

const PLANEN: BranchRight[] = ["VIEW_SCHEDULE", "EDIT_SHIFTS", "PUBLISH_SCHEDULE", "HANDLE_REQUESTS", "VIEW_TIME"];
const ANSEHEN: BranchRight[] = ["VIEW_SCHEDULE", "HANDLE_REQUESTS"];
const ANFRAGEN: BranchRight[] = ["REQUEST_SHIFTS"];

/** Rolle und Standortrechte je Kontonummer. */
function rolle(nr: number): { role: OrgRole; rechte: [ort: string, rechte: BranchRight[]][] } {
  if (nr === 1) return { role: "MANAGER", rechte: [["Lasttest Objekt", PLANEN], ["Lasttest Objekt 2", PLANEN]] };
  if (nr === 2) return { role: "MANAGER", rechte: [["Lasttest Süd", PLANEN]] };
  if (nr === 3) return { role: "MANAGER", rechte: [["Lasttest Objekt 2", ANSEHEN]] };
  if (nr === 50) return { role: "ADMIN", rechte: [] };
  if (nr <= 28) return { role: "EMPLOYEE", rechte: [["Lasttest Objekt", ANFRAGEN]] };
  if (nr <= 30) return { role: "EMPLOYEE", rechte: [["Lasttest Objekt", ANFRAGEN], ["Lasttest Objekt 2", ANFRAGEN]] };
  if (nr <= 40) return { role: "EMPLOYEE", rechte: [["Lasttest Objekt 2", ANFRAGEN]] };
  return { role: "EMPLOYEE", rechte: [["Lasttest Süd", ANFRAGEN]] };
}

async function testOrganisation() {
  const kandidaten = await db.organization.findMany({
    where: { deletedAt: null, OR: ["test", "pilot", "staging"].map((w) => ({ name: { contains: w, mode: "insensitive" as const } })) },
    select: { id: true, name: true },
  });
  const passend = ORG_NAME ? kandidaten.filter((o) => o.name === ORG_NAME) : kandidaten;
  if (passend.length !== 1) throw new Error(`Genau eine Testorganisation erwartet, gefunden: ${passend.length}. Nichts geaendert.`);
  return passend[0];
}

async function kunde(orgId: string, name: string) {
  return db.customer.upsert({
    where: { organizationId_name: { organizationId: orgId, name } },
    create: { organizationId: orgId, name, notes: "Synthetische Daten für den Lasttest." },
    update: {},
    select: { id: true, name: true },
  });
}

async function ort(orgId: string, customerId: string, name: string) {
  const vorhanden = await db.branch.findFirst({ where: { organizationId: orgId, name }, select: { id: true } });
  if (vorhanden) return vorhanden.id;
  const neu = await db.branch.create({
    data: { organizationId: orgId, customerId, name, address: "Teststraße 1, 00000 Testort", positions: ["Sicherheit"] },
    select: { id: true },
  });
  return neu.id;
}

async function plan(orgId: string, branchId: string, week: { weekNumber: number; year: number }, isPublic: boolean) {
  const vorhanden = await db.schedule.findFirst({
    where: { organizationId: orgId, branchId, weekNumber: week.weekNumber, year: week.year, deletedAt: null },
    select: { id: true },
  });
  if (vorhanden) {
    await db.schedule.update({ where: { id: vorhanden.id }, data: { isPublic } });
    return vorhanden.id;
  }
  const neu = await db.schedule.create({ data: { organizationId: orgId, branchId, weekNumber: week.weekNumber, year: week.year, isPublic }, select: { id: true } });
  return neu.id;
}

type Zeit = { title: string; dayOfWeek: number; shiftFrom: string; shiftTo: string; maxEmployees: number; requiredQualifications?: string[] };
async function schicht(scheduleId: string, z: Zeit) {
  const vorhanden = await db.shift.findFirst({
    where: { scheduleId, title: z.title, dayOfWeek: z.dayOfWeek, shiftFrom: z.shiftFrom, deletedAt: null },
    select: { id: true },
  });
  if (vorhanden) return vorhanden.id;
  const neu = await db.shift.create({
    data: { scheduleId, pauseOption: "PER_SHIFT", pauseValue: 30, requiredQualifications: [], ...z },
    select: { id: true },
  });
  return neu.id;
}

async function main() {
  const org = await testOrganisation();
  const fremd = await db.organization.findFirst({ where: { name: FREMD_ORG, deletedAt: null }, select: { id: true, name: true } });
  if (!fremd || fremd.id === org.id) throw new Error(`Fremdorganisation "${FREMD_ORG}" fehlt. Nichts geaendert.`);
  const woche = isoWeek(berlinDate());
  const naechste = (n: number) => isoWeek(addDate(weekDate(woche.year, woche.weekNumber), 7 * n));

  // --- Kunden und Einsatzorte ---
  const nord = await kunde(org.id, "Lasttest Kunde");
  const sued = await kunde(org.id, "Lasttest Kunde Süd");
  const orte: Record<string, string> = {
    "Lasttest Objekt": await ort(org.id, nord.id, "Lasttest Objekt"),
    "Lasttest Objekt 2": await ort(org.id, nord.id, "Lasttest Objekt 2"),
    "Lasttest Süd": await ort(org.id, sued.id, "Lasttest Süd"),
  };
  const kundeVonOrt: Record<string, string> = { "Lasttest Objekt": nord.name, "Lasttest Objekt 2": nord.name, "Lasttest Süd": sued.name };

  // --- Rollen und Standortrechte ---
  const konten: { email: string; nr: number; role: OrgRole; userId: string; orte: string[]; kunden: string[]; planen: boolean }[] = [];
  for (let nr = 1; nr <= ANZAHL; nr++) {
    const email = kontoAdresse(nr);
    if (!email.endsWith(".invalid")) throw new Error("Testkonten muessen auf .invalid enden.");
    const user = await db.user.findUnique({ where: { email }, select: { id: true } });
    if (!user) throw new Error(`Konto ${email} fehlt – zuerst test:load:seed ausfuehren.`);
    const { role, rechte } = nr > 50 ? { role: "EMPLOYEE" as OrgRole, rechte: [["Lasttest Objekt", ANFRAGEN]] as [string, BranchRight[]][] } : rolle(nr);
    const member = await db.organizationMember.update({
      where: { organizationId_userId: { organizationId: org.id, userId: user.id } },
      data: { role },
      select: { id: true },
    });
    for (const [name, r] of rechte) {
      await db.branchAccess.upsert({
        where: { memberId_branchId: { memberId: member.id, branchId: orte[name] } },
        create: { organizationId: org.id, memberId: member.id, branchId: orte[name], rights: r },
        update: { rights: r },
      });
    }
    const eigeneOrte = rechte.map(([name]) => orte[name]);
    const planen = rechte.some(([, r]) => r.includes("EDIT_SHIFTS"));
    konten.push({ email, nr, role, userId: user.id, orte: eigeneOrte, kunden: [...new Set(rechte.map(([name]) => kundeVonOrt[name]))], planen });
  }

  // --- Laufende Woche: offene Schichten fuer Antraege, eigene Schichten in Sued ---
  const offen = (tag: number, von: string, bis: string): Zeit => ({ title: "Lasttest offen", dayOfWeek: tag, shiftFrom: von, shiftTo: bis, maxEmployees: 3 });
  const planNord = await plan(org.id, orte["Lasttest Objekt"], woche, true);
  await schicht(planNord, offen(6, "08:00", "16:00"));
  await schicht(planNord, offen(7, "08:00", "16:00"));
  const planNord2 = await plan(org.id, orte["Lasttest Objekt 2"], woche, true);
  await schicht(planNord2, offen(6, "10:00", "18:00"));
  await schicht(planNord2, offen(7, "10:00", "18:00"));
  const planSued = await plan(org.id, orte["Lasttest Süd"], woche, true);
  const suedSchicht = await schicht(planSued, { title: "Lasttest Süd", dayOfWeek: 6, shiftFrom: "06:00", shiftTo: "14:00", maxEmployees: 9 });
  await schicht(planSued, offen(7, "08:00", "16:00"));
  for (const k of konten.filter((k) => k.nr >= 41 && k.nr <= 49)) {
    await db.booking.upsert({ where: { shiftId_userId: { shiftId: suedSchicht, userId: k.userId } }, create: { shiftId: suedSchicht, userId: k.userId }, update: {} });
  }

  // --- Entwuerfe fuer den Manager: eine Woche fuer den Funktionstest, eine fuer den Lastlauf ---
  const ziele: Record<string, { scheduleId: string; shiftId: string; week: { weekNumber: number; year: number } }> = {};
  for (const [lauf, abstand] of [["funktion", 1], ["last", 2]] as const) {
    const w = naechste(abstand);
    const id = await plan(org.id, orte["Lasttest Objekt"], w, false);
    const ziel = await schicht(id, { title: "Lasttest besetzen", dayOfWeek: 2, shiftFrom: "08:00", shiftTo: "16:00", maxEmployees: 1, requiredQualifications: ["Sachkunde 34a"] });
    await schicht(id, { title: "Lasttest Plan", dayOfWeek: 3, shiftFrom: "08:00", shiftTo: "16:00", maxEmployees: 2 });
    ziele[lauf] = { scheduleId: id, shiftId: ziel, week: w };
  }

  // --- Fremder Kunde im selben Mandanten ist "Lasttest Kunde Süd"; zusaetzlich ein fremder Mandant ---
  const fremdKunde = await kunde(fremd.id, "Fremdkunde Nord");
  const fremdOrt = await ort(fremd.id, fremdKunde.id, "Fremdobjekt");
  const fremdPlan = await plan(fremd.id, fremdOrt, woche, true);
  const fremdSchicht = await schicht(fremdPlan, { title: "Fremdschicht", dayOfWeek: 6, shiftFrom: "08:00", shiftTo: "16:00", maxEmployees: 2 });

  writeFileSync(
    DATEI,
    JSON.stringify(
      {
        organisation: org.name,
        woche,
        orte,
        kunden: [nord.name, sued.name],
        manager: { email: kontoAdresse(1), ziele },
        fremd: { organisation: fremd.name, kunde: fremdKunde.name, ortId: fremdOrt, schichtId: fremdSchicht },
        konten: konten.map(({ email, role, orte: o, kunden: k, planen }) => ({ email, role, orte: o, kunden: k, planen })),
      },
      null,
      2
    )
  );
  const zahl = (r: OrgRole) => konten.filter((k) => k.role === r).length;
  console.log(`Organisation: ${org.name}, KW ${woche.weekNumber}/${woche.year}`);
  console.log(`Rollen: ${zahl("ADMIN")} Admin, ${zahl("MANAGER")} Manager, ${zahl("EMPLOYEE")} Mitarbeitende`);
  console.log(`Einsatzorte: ${Object.keys(orte).join(", ")} | Fremdmandant mit 1 Einsatzort`);
  console.log(`Entwuerfe fuer den Manager: KW ${ziele.funktion.week.weekNumber} (Funktionstest), KW ${ziele.last.week.weekNumber} (Lastlauf)`);
}

main()
  .catch((fehler) => {
    console.error(fehler instanceof Error ? fehler.message : fehler);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
