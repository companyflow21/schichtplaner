/*
 * Gezielte Nebenlaeufigkeitspruefung auf der isolierten Testinstallation
 * (Rollen-Szenario aus tests/seed-load-roles.ts):
 *
 *  1. Parallele Bestaetigungen: alle Testkonten bestaetigen gleichzeitig ihre
 *     veroeffentlichten Schichten, einige doppelt (Doppelklick).
 *  2. Ueberbuchungsschutz: ein Manager besetzt eine Schicht mit zwei Plaetzen
 *     in drei gleichzeitigen Wellen mit mehr Personen, als Plaetze frei sind.
 *
 * Abgleich in der Datenbank: jede erfolgreiche Bestaetigung ist gespeichert,
 * keine Schicht ist ueberbucht, es entstehen keine zusaetzlichen Buchungen und
 * je erfolgreichem Vorgang genau eine Benachrichtigung und ein Socket-Signal.
 *
 *   DATABASE_URL="postgresql://…" LOAD_BASE_URL="http://127.0.0.1:18080" LOAD_USER_PASSWORD="…" \
 *     LOAD_SCENARIO_FILE=szenario.json npx tsx tests/race-bookings.ts
 *
 * Schreibt nur in die Testorganisation des Szenarios: setzt dort die
 * Bestaetigungen veroeffentlichter Schichten zurueck und legt die Schicht
 * "Lasttest Ueberbuchung" neu an (eine fruehere wird als geloescht markiert).
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFileSync } from "node:fs";
import { io, type Socket } from "socket.io-client";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const BASIS = (process.env.LOAD_BASE_URL ?? "").replace(/\/+$/, "");
const PASSWORT = process.env.LOAD_USER_PASSWORD ?? "";
const DATENBANK = process.env.DATABASE_URL ?? "";
const SZENARIO = process.env.LOAD_SCENARIO_FILE ?? "";
if (!BASIS || !PASSWORT || !DATENBANK || !SZENARIO) {
  console.error("LOAD_BASE_URL, LOAD_USER_PASSWORD, DATABASE_URL und LOAD_SCENARIO_FILE muessen gesetzt sein.");
  process.exit(1);
}
const ziel = new URL(BASIS);
const datenbank = new URL(DATENBANK);
// Harte Sperre wie im Lasttest: nie gegen die Produktivumgebung.
if ([ziel.hostname, datenbank.hostname].some((h) => /(^|\.)akro-group\.com$/i.test(h))) {
  console.error("Ziel oder Datenbank zeigt auf die Produktivumgebung. Die Pruefung startet nicht.");
  process.exit(1);
}

type Szenario = {
  organisation: string;
  woche: { weekNumber: number; year: number };
  orte: Record<string, string>;
  manager: { email: string };
  konten: { email: string; role: string }[];
};
const szenario = JSON.parse(readFileSync(SZENARIO, "utf8")) as Szenario;
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: DATENBANK }) });
const TITEL = "Lasttest Ueberbuchung";
const PLAETZE = 2;

type Antwort = { status: number; body: any };
const warte = (ms: number) => new Promise((r) => setTimeout(r, ms));

class Sitzung {
  private jar = new Map<string, string>();
  constructor(readonly email: string) {}
  cookie(): string {
    return [...this.jar].map(([k, v]) => k + "=" + v).join("; ");
  }
  private merke(res: Response): void {
    for (const c of res.headers.getSetCookie()) {
      const paar = c.split(";")[0];
      const i = paar.indexOf("=");
      if (i > 0) this.jar.set(paar.slice(0, i), paar.slice(i + 1));
    }
  }
  async anfrage(pfad: string, method = "GET", data?: unknown): Promise<Antwort> {
    try {
      const res = await fetch(BASIS + pfad, {
        method,
        redirect: "manual",
        headers: { Cookie: this.cookie(), "Content-Type": "application/json" },
        ...(data === undefined ? {} : { body: JSON.stringify(data) }),
      });
      this.merke(res);
      const text = await res.text();
      let body: any = null;
      try {
        body = JSON.parse(text);
      } catch {
        // kein JSON
      }
      return { status: res.status, body };
    } catch {
      return { status: 0, body: null };
    }
  }
  async anmelden(): Promise<boolean> {
    const csrf = await this.anfrage("/api/auth/csrf");
    const res = await fetch(BASIS + "/api/auth/callback/credentials", {
      method: "POST",
      redirect: "manual",
      headers: { Cookie: this.cookie(), "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ csrfToken: csrf.body?.csrfToken ?? "", email: this.email, password: PASSWORT, callbackUrl: BASIS + "/dashboard" }),
    });
    this.merke(res);
    return (await this.anfrage("/api/auth/session")).body?.user?.email === this.email;
  }
}

function verbinde(s: Sitzung): Promise<Socket> {
  const socket = io(BASIS, { path: "/api/ws", transports: ["websocket"], extraHeaders: { Cookie: s.cookie() }, reconnection: false, timeout: 20_000 });
  return new Promise((ok, fehler) => {
    socket.once("connect", () => ok(socket));
    socket.once("connect_error", fehler);
  });
}

/** Statuscodes und Fehlermeldungen einer Welle, ohne Konten oder Personen. */
function verteilung(antworten: Antwort[]): string {
  const z = new Map<string, number>();
  for (const a of antworten) {
    const key = a.status === 200 ? "200" : `${a.status} "${a.body?.error ?? ""}"`;
    z.set(key, (z.get(key) ?? 0) + 1);
  }
  return [...z].map(([k, n]) => `${n}× ${k}`).join(", ");
}

/** Wartet, bis keine weiteren Socket-Signale mehr eintreffen. */
async function ruhe(zaehler: () => number): Promise<void> {
  let vorher = -1;
  while (vorher !== zaehler()) {
    vorher = zaehler();
    await warte(1500);
  }
}

async function main() {
  const org = await db.organization.findFirst({ where: { name: szenario.organisation }, select: { id: true, name: true } });
  if (!org || !/test|pilot|staging/i.test(org.name)) throw new Error("Testorganisation nicht gefunden.");
  console.log(`Ziel ${ziel.host}, Datenbank ${datenbank.host}${datenbank.pathname}, Organisation "${org.name}"`);

  const fehler: string[] = [];
  const pruefe = (ok: boolean, text: string) => {
    console.log((ok ? "OK      " : "FEHLER  ") + text);
    if (!ok) fehler.push(text);
  };

  // Vorbereitung: Bestaetigungen zuruecksetzen, fruehere Probeschicht entfernen.
  const veroeffentlicht = { deletedAt: null, schedule: { organizationId: org.id, isPublic: true, deletedAt: null } };
  await db.shift.updateMany({ where: { title: TITEL, deletedAt: null, schedule: { organizationId: org.id } }, data: { deletedAt: new Date() } });
  await db.booking.updateMany({ where: { shift: veroeffentlicht }, data: { confirmedAt: null } });

  const sitzungen = new Map(szenario.konten.map((k) => [k.email, new Sitzung(k.email)]));
  const admin = szenario.konten.find((k) => k.role === "ADMIN");
  const manager = sitzungen.get(szenario.manager.email);
  if (!admin || !manager) throw new Error("Admin oder Manager fehlt im Szenario.");
  const ziele = (
    await db.booking.findMany({ where: { shift: veroeffentlicht }, select: { id: true, shiftId: true, user: { select: { email: true } } } })
  ).filter((b) => sitzungen.has(b.user.email));

  const benoetigt = [...new Set([...ziele.map((b) => b.user.email), admin.email, szenario.manager.email])].map((e) => sitzungen.get(e)!);
  let angemeldet = 0;
  for (let i = 0; i < benoetigt.length; i += 5) {
    angemeldet += (await Promise.all(benoetigt.slice(i, i + 5).map((s) => s.anmelden()))).filter(Boolean).length;
  }
  pruefe(angemeldet === benoetigt.length, `Anmeldungen ${angemeldet}/${benoetigt.length}`);

  // Der Admin empfaengt jedes "booking:changed" genau einmal (Admin-Raum).
  const socket = await verbinde(sitzungen.get(admin.email)!);
  let signale = 0;
  socket.on("booking:changed", () => signale++);
  await warte(1000);

  // Aufwaermen ohne Datenaenderung (unbekannte Schicht, erwartet 404).
  await benoetigt[0].anfrage("/api/bookings", "PATCH", { shiftId: "aufwaermen" });
  await manager.anfrage("/api/bookings", "POST", { shiftId: "aufwaermen", userId: "aufwaermen" });

  // --- 1. Parallele Bestaetigungen ---------------------------------------
  const inOrg = { shift: { schedule: { organizationId: org.id } } };
  const buchungenVorher = await db.booking.count({ where: inOrg });
  const nachrichtenVorher = await db.message.count({ where: { organizationId: org.id } });
  const doppelt = ziele.slice(0, 5);
  const auftraege = [...ziele, ...doppelt];
  signale = 0;
  const start = performance.now();
  const antworten = await Promise.all(auftraege.map((b) => sitzungen.get(b.user.email)!.anfrage("/api/bookings", "PATCH", { shiftId: b.shiftId })));
  const dauer = Math.round(performance.now() - start);
  await ruhe(() => signale);
  const erfolge = antworten.filter((a) => a.status === 200).length;
  console.log(`\nParallele Bestaetigungen: ${auftraege.length} gleichzeitige Anfragen (${ziele.length} Buchungen + ${doppelt.length} Doppelklicks), ${dauer} ms`);
  console.log(`  Antworten: ${verteilung(antworten)}`);
  pruefe(erfolge === auftraege.length, `alle Bestaetigungen erfolgreich (${erfolge}/${auftraege.length})`);
  const bestaetigt = await db.booking.count({ where: { id: { in: ziele.map((b) => b.id) }, confirmedAt: { not: null } } });
  pruefe(bestaetigt === ziele.length, `in der Datenbank bestaetigt: ${bestaetigt}/${ziele.length} Buchungen`);
  const erfolgreich = [...new Set(auftraege.filter((_, i) => antworten[i].status === 200).map((b) => b.id))];
  const gespeichert = await db.booking.count({ where: { id: { in: erfolgreich }, confirmedAt: { not: null } } });
  pruefe(gespeichert === erfolgreich.length, `jede erfolgreiche Bestaetigung gespeichert (${gespeichert}/${erfolgreich.length})`);
  const buchungenNachher = await db.booking.count({ where: inOrg });
  pruefe(buchungenNachher === buchungenVorher, `keine zusaetzlichen oder verlorenen Buchungen (${buchungenVorher} → ${buchungenNachher})`);
  const nachrichtenNachher = await db.message.count({ where: { organizationId: org.id } });
  pruefe(nachrichtenNachher === nachrichtenVorher, `keine Benachrichtigungen durch Bestaetigungen (${nachrichtenVorher} → ${nachrichtenNachher})`);
  pruefe(signale === erfolge, `Socket-Signale ${signale}, erwartet genau ${erfolge} (eins je Erfolg)`);

  // --- 2. Ueberbuchungsschutz ---------------------------------------------
  const plan = await db.schedule.findFirst({
    where: { organizationId: org.id, branchId: szenario.orte["Lasttest Objekt"], weekNumber: szenario.woche.weekNumber, year: szenario.woche.year, isPublic: true, deletedAt: null },
    select: { id: true },
  });
  if (!plan) throw new Error("Veroeffentlichter Wochenplan am Standort Lasttest Objekt fehlt.");
  const schicht = await db.shift.create({ data: { scheduleId: plan.id, title: TITEL, dayOfWeek: 7, shiftFrom: "18:00", shiftTo: "22:00", maxEmployees: PLAETZE }, select: { id: true } });
  type Kandidat = { userId: string; selectable: boolean; confirm: boolean };
  const kandidaten = ((await manager.anfrage(`/api/shifts/${schicht.id}/candidates`)).body?.candidates ?? []) as Kandidat[];
  const auswahl = kandidaten.filter((k) => k.selectable && !k.confirm).slice(0, 8).map((k) => k.userId);
  pruefe(auswahl.length > PLAETZE + 1, `genug waehlbare Personen fuer die Probe (${auswahl.length})`);
  signale = 0;
  let besetzt = 0;
  console.log(`\nUeberbuchungsschutz: Schicht mit ${PLAETZE} Plaetzen, ${auswahl.length} Personen je Welle plus ein Doppelklick`);
  for (let welle = 1; welle <= 3; welle++) {
    const wellenAntworten = await Promise.all([...auswahl, auswahl[0]].map((userId) => manager.anfrage("/api/bookings", "POST", { shiftId: schicht.id, userId })));
    besetzt += wellenAntworten.filter((a) => a.status === 200).length;
    console.log(`  Welle ${welle}: ${verteilung(wellenAntworten)}`);
  }
  await ruhe(() => signale);
  const gebucht = (await db.booking.findMany({ where: { shiftId: schicht.id }, select: { userId: true } })).map((b) => b.userId).sort();
  pruefe(gebucht.length === PLAETZE, `voll, aber nicht ueberbucht: ${gebucht.length} von ${PLAETZE} Plaetzen`);
  pruefe(gebucht.length === besetzt, `jede erfolgreiche Besetzung genau einmal gespeichert (${gebucht.length}/${besetzt})`);
  const empfaenger = (await db.message.findMany({ where: { shiftId: schicht.id }, select: { recipients: { select: { userId: true } } } }))
    .flatMap((n) => n.recipients.map((r) => r.userId))
    .sort();
  pruefe(JSON.stringify(empfaenger) === JSON.stringify(gebucht), `genau eine Benachrichtigung je Besetzung (${empfaenger.length})`);
  pruefe(signale === besetzt, `Socket-Signale ${signale}, erwartet genau ${besetzt}`);

  const schichten = await db.shift.findMany({
    where: { deletedAt: null, schedule: { organizationId: org.id, deletedAt: null } },
    select: { maxEmployees: true, _count: { select: { bookings: true } } },
  });
  const ueberbucht = schichten.filter((s) => s._count.bookings > s.maxEmployees).length;
  pruefe(ueberbucht === 0, `keine Schicht der Testorganisation ueberbucht (${schichten.length} geprueft)`);

  socket.close();
  console.log(fehler.length ? "\nErgebnis: NICHT BESTANDEN" : "\nErgebnis: BESTANDEN");
  if (fehler.length) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
