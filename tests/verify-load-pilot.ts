/*
 * Nachpruefung eines Lasttests in der Datenbank der Testinstallation:
 * Jeder im Ergebnis protokollierte erfolgreiche Schreibvorgang muss
 * gespeichert sein, keine Schicht darf ueberbucht sein und der fremde
 * Mandant darf keine Spuren des Tests enthalten.
 *
 *   DATABASE_URL="postgresql://…" LOAD_RESULT_FILE=ergebnis.json LOAD_SCENARIO_FILE=szenario.json npx tsx tests/verify-load-pilot.ts
 *
 * Liest nur. Wie die Seeds nur mit bewusst gesetzter DATABASE_URL.
 */
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const DATENBANK = process.env.DATABASE_URL ?? "";
const ERGEBNIS = process.env.LOAD_RESULT_FILE ?? "";
const SZENARIO = process.env.LOAD_SCENARIO_FILE ?? "";
if (!DATENBANK || !ERGEBNIS || !SZENARIO) {
  console.error("DATABASE_URL, LOAD_RESULT_FILE und LOAD_SCENARIO_FILE muessen gesetzt sein.");
  process.exit(1);
}

type Eintrag = { typ: string; konto: number; shiftId?: string; userId?: string; id?: string };
const ergebnis = JSON.parse(readFileSync(ERGEBNIS, "utf8")) as { schreibprotokoll: Eintrag[] };
const szenario = JSON.parse(readFileSync(SZENARIO, "utf8")) as { organisation: string; fremd: { organisation: string } };
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: DATENBANK }) });

async function main() {
  const org = await db.organization.findFirst({ where: { name: szenario.organisation }, select: { id: true, name: true } });
  if (!org || !/test|pilot|staging/i.test(org.name)) throw new Error("Testorganisation nicht gefunden.");
  const fremd = await db.organization.findFirst({ where: { name: szenario.fremd.organisation }, select: { id: true } });

  const fehler: string[] = [];
  const zaehler = new Map<string, { gesamt: number; gefunden: number }>();
  const zaehle = (typ: string, ok: boolean, text: string) => {
    const z = zaehler.get(typ) ?? { gesamt: 0, gefunden: 0 };
    z.gesamt++;
    if (ok) z.gefunden++;
    else fehler.push(`${typ} (Konto ${text}) nicht gespeichert`);
    zaehler.set(typ, z);
  };

  for (const e of ergebnis.schreibprotokoll) {
    const konto = String(e.konto);
    if (e.typ === "Bestaetigung") {
      const b = await db.booking.findUnique({ where: { shiftId_userId: { shiftId: e.shiftId!, userId: e.userId! } }, select: { confirmedAt: true } });
      zaehle(e.typ, !!b?.confirmedAt, konto);
    } else if (e.typ === "Uebernahmeantrag") {
      const r = await db.modRequest.findUnique({ where: { id: e.id! }, select: { shiftId: true, userId: true } });
      zaehle(e.typ, r?.shiftId === e.shiftId && r?.userId === e.userId, konto);
    } else if (e.typ === "Zeitbuchung") {
      const t = await db.timeRecord.findUnique({ where: { id: e.id! }, select: { userId: true, organizationId: true } });
      zaehle(e.typ, t?.userId === e.userId && t?.organizationId === org.id, konto);
    } else if (e.typ === "Nachricht") {
      const m = await db.message.findUnique({ where: { id: e.id! }, select: { recipients: { select: { userId: true } } } });
      zaehle(e.typ, !!m?.recipients.some((r) => r.userId === e.userId), konto);
    } else if (e.typ === "Besetzung durch Manager") {
      const b = await db.booking.findUnique({ where: { shiftId_userId: { shiftId: e.shiftId!, userId: e.userId! } }, select: { id: true } });
      zaehle(e.typ, !!b, konto);
    } else if (e.typ === "Veroeffentlichung durch Manager") {
      const s = await db.schedule.findUnique({ where: { id: e.id! }, select: { isPublic: true } });
      zaehle(e.typ, !!s?.isPublic, konto);
    }
  }

  // Keine Schicht der Testorganisation ist ueberbucht.
  const schichten = await db.shift.findMany({
    where: { deletedAt: null, schedule: { organizationId: org.id, deletedAt: null } },
    select: { id: true, maxEmployees: true, _count: { select: { bookings: true } } },
  });
  const ueberbucht = schichten.filter((s) => s._count.bookings > s.maxEmployees).length;
  if (ueberbucht) fehler.push(`${ueberbucht} Schichten ueberbucht`);

  // Der fremde Mandant bleibt unberuehrt: keine Buchungen, Antraege oder Zeiten.
  let fremdSpuren = 0;
  if (fremd) {
    fremdSpuren =
      (await db.booking.count({ where: { shift: { schedule: { organizationId: fremd.id } } } })) +
      (await db.modRequest.count({ where: { shift: { schedule: { organizationId: fremd.id } } } })) +
      (await db.timeRecord.count({ where: { organizationId: fremd.id } }));
    if (fremdSpuren) fehler.push(`${fremdSpuren} Datensaetze im fremden Mandanten`);
  }

  for (const [typ, z] of zaehler) console.log(`${typ.padEnd(34)} ${z.gefunden} von ${z.gesamt} gespeichert`);
  console.log(`Schichten geprueft                 ${schichten.length}, davon ueberbucht: ${ueberbucht}`);
  console.log(`Spuren im fremden Mandanten        ${fremdSpuren}`);
  console.log(fehler.length ? "Datenpruefung: NICHT BESTANDEN\n- " + fehler.join("\n- ") : "Datenpruefung: BESTANDEN (keine Daten verloren)");
  if (fehler.length) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
