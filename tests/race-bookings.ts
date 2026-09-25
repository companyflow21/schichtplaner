/*
 * Gezielte Nebenlaeufigkeitspruefung auf der isolierten Testinstallation
 * (Rollen-Szenario aus tests/seed-load-roles.ts):
 *
 *  1. Parallele Bestaetigungen: alle Testkonten bestaetigen gleichzeitig ihre
 *     veroeffentlichten Schichten, einige doppelt (Doppelklick).
 *  2. Besetzen durch Manager: acht gleichzeitige Anfragen auf den letzten
 *     freien Platz einer Schicht und sechs gleichzeitige Anfragen fuer
 *     dieselbe Person.
 *  3. Idempotency-Key beim Besetzen: derselbe Key gleichzeitig und spaeter,
 *     fuer eine andere Person, ungueltig, und eine gemerkte Ablehnung (409).
 *
 * Abgleich in der Datenbank: jede erfolgreiche Bestaetigung ist gespeichert,
 * keine Schicht ist ueberbucht, es entstehen keine zusaetzlichen Buchungen und
 * je erfolgreichem Vorgang genau eine Benachrichtigung und ein Socket-Signal.
 * Beim Besetzen endet keine Anfrage mit 5xx; Ablehnungen sind verstaendlich.
 *
 *   DATABASE_URL="postgresql://…" LOAD_BASE_URL="http://127.0.0.1:18080" LOAD_USER_PASSWORD="…" \
 *     LOAD_SCENARIO_FILE=szenario.json npx tsx tests/race-bookings.ts
 *
 * RACE_PARTS=besetzen (oder bestaetigen, idempotenz) fuehrt nur diese Teile aus.
 *
 * Schreibt nur in die Testorganisation des Szenarios: setzt dort die
 * Bestaetigungen veroeffentlichter Schichten zurueck und legt die Schichten
 * "Lasttest Ueberbuchung", "Lasttest Doppelanfrage" und "Lasttest Idempotenz"
 * neu an (fruehere werden als geloescht markiert).
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { randomUUID } from "node:crypto";
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
const TITEL_DOPPELT = "Lasttest Doppelanfrage";
const TITEL_IDEMPOTENZ = "Lasttest Idempotenz";
const PLAETZE = 2;
const TEILE = (process.env.RACE_PARTS || "bestaetigen,besetzen,idempotenz").split(",").map((t) => t.trim());
/** Verstaendliche Ablehnungen beim Besetzen; jede andere Antwort ausser 200 ist ein Fehler. */
const ABLEHNUNGEN = ["Schicht ist bereits besetzt.", "Bereits zugewiesen.", "Gleichzeitige Änderung, bitte erneut versuchen."];

type Antwort = { status: number; body: any; replayed?: boolean };
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
  async anfrage(pfad: string, method = "GET", data?: unknown, kopf: Record<string, string> = {}): Promise<Antwort> {
    try {
      const res = await fetch(BASIS + pfad, {
        method,
        redirect: "manual",
        headers: { Cookie: this.cookie(), "Content-Type": "application/json", ...kopf },
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
      return { status: res.status, body, replayed: res.headers.get("idempotent-replayed") === "true" };
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

  // Vorbereitung: Bestaetigungen zuruecksetzen, fruehere Probeschichten entfernen.
  const veroeffentlicht = { deletedAt: null, schedule: { organizationId: org.id, isPublic: true, deletedAt: null } };
  await db.shift.updateMany({ where: { title: { in: [TITEL, TITEL_DOPPELT, TITEL_IDEMPOTENZ] }, deletedAt: null, schedule: { organizationId: org.id } }, data: { deletedAt: new Date() } });
  if (TEILE.includes("bestaetigen")) await db.booking.updateMany({ where: { shift: veroeffentlicht }, data: { confirmedAt: null } });

  const sitzungen = new Map(szenario.konten.map((k) => [k.email, new Sitzung(k.email)]));
  const admin = szenario.konten.find((k) => k.role === "ADMIN");
  const manager = sitzungen.get(szenario.manager.email);
  if (!admin || !manager) throw new Error("Admin oder Manager fehlt im Szenario.");
  const ziele = !TEILE.includes("bestaetigen") ? [] : (
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
  if (TEILE.includes("bestaetigen")) {
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
  }

  // Veroeffentlichter Wochenplan fuer die Probeschichten der Teile 2 und 3.
  const plan = await db.schedule.findFirst({
    where: { organizationId: org.id, branchId: szenario.orte["Lasttest Objekt"], weekNumber: szenario.woche.weekNumber, year: szenario.woche.year, isPublic: true, deletedAt: null },
    select: { id: true },
  });
  type Kandidat = { userId: string; selectable: boolean; confirm: boolean };
  /** Neue Schicht mit zwei Plaetzen und die dafuer ohne Hinweis waehlbaren Personen. */
  const neueSchicht = async (title: string, shiftFrom: string, shiftTo: string) => {
    if (!plan) throw new Error("Veroeffentlichter Wochenplan am Standort Lasttest Objekt fehlt.");
    const { id } = await db.shift.create({ data: { scheduleId: plan.id, title, dayOfWeek: 7, shiftFrom, shiftTo, maxEmployees: PLAETZE }, select: { id: true } });
    const liste = ((await manager.anfrage(`/api/shifts/${id}/candidates`)).body?.candidates ?? []) as Kandidat[];
    return { id, title, personen: liste.filter((k) => k.selectable && !k.confirm).map((k) => k.userId) };
  };
  const besetze = (shiftId: string, userId: string, kopf: Record<string, string> = {}) => manager.anfrage("/api/bookings", "POST", { shiftId, userId }, kopf);

  // --- 2. Besetzen durch Manager ------------------------------------------
  if (TEILE.includes("besetzen")) {
    signale = 0;

    // a) Letzter freier Platz: ein Platz ist belegt, acht Personen wollen den zweiten.
    const platz = await neueSchicht(TITEL, "18:00", "22:00");
    pruefe(platz.personen.length >= 9, `genug waehlbare Personen fuer die Probe (${platz.personen.length})`);
    const erste = await besetze(platz.id, platz.personen[0]);
    pruefe(erste.status === 200, "erster Platz einzeln besetzt");
    const letzter = await Promise.all(platz.personen.slice(1, 9).map((userId) => besetze(platz.id, userId)));
    console.log(`\nLetzter freier Platz: ${letzter.length} gleichzeitige Anfragen – ${verteilung(letzter)}`);
    pruefe(letzter.filter((a) => a.status === 200).length === 1, "genau eine Anfrage erhaelt den letzten Platz");

    // b) Doppelte Anfragen: dieselbe Person sechsmal gleichzeitig auf eine freie Schicht.
    const doppelt = await neueSchicht(TITEL_DOPPELT, "08:00", "12:00");
    const doppelte = await Promise.all(Array.from({ length: 6 }, () => besetze(doppelt.id, doppelt.personen[0])));
    console.log(`Doppelte Anfragen: ${doppelte.length} gleichzeitige Anfragen fuer dieselbe Person – ${verteilung(doppelte)}`);
    pruefe(doppelte.filter((a) => a.status === 200).length === 1, "genau eine der doppelten Anfragen bucht");

    const alle = [erste, ...letzter, ...doppelte];
    const besetzt = alle.filter((a) => a.status === 200).length;
    const andere = alle.filter((a) => a.status !== 200 && !(a.status === 409 && ABLEHNUNGEN.includes(a.body?.error)));
    pruefe(andere.length === 0, `keine 5xx, nur verstaendliche Ablehnungen${andere.length ? " – sonst: " + verteilung(andere) : ""}`);
    await ruhe(() => signale);
    for (const [schicht, erwartet] of [[platz, PLAETZE], [doppelt, 1]] as const) {
      const gebucht = (await db.booking.findMany({ where: { shiftId: schicht.id }, select: { userId: true } })).map((b) => b.userId).sort();
      pruefe(gebucht.length === erwartet, `${schicht.title}: ${gebucht.length} Buchung(en), erwartet ${erwartet} (${PLAETZE} Plaetze)`);
      const empfaenger = (await db.message.findMany({ where: { shiftId: schicht.id }, select: { recipients: { select: { userId: true } } } }))
        .flatMap((n) => n.recipients.map((r) => r.userId))
        .sort();
      pruefe(JSON.stringify(empfaenger) === JSON.stringify(gebucht), `${schicht.title}: genau eine Benachrichtigung je Buchung (${empfaenger.length})`);
    }
    pruefe(signale === besetzt, `Socket-Signale ${signale}, erwartet genau ${besetzt} (eins je Erfolg)`);
  }

  // --- 3. Idempotency-Key beim Besetzen -----------------------------------
  if (TEILE.includes("idempotenz")) {
    const schicht = await neueSchicht(TITEL_IDEMPOTENZ, "13:00", "16:00");
    const [p0, p1, p2] = schicht.personen;
    const mitKey = (key: string, userId: string) => besetze(schicht.id, userId, { "Idempotency-Key": key });
    const [k1, k2, k3, k4] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
    signale = 0;

    const gleich = await Promise.all(Array.from({ length: 6 }, () => mitKey(k1, p0)));
    const ids = [...new Set(gleich.map((a) => a.body?.booking?.id))];
    const wiederholt = gleich.filter((a) => a.replayed).length;
    console.log(`\nIdempotenz: 6 gleichzeitige Anfragen mit demselben Key – ${verteilung(gleich)}, davon ${wiederholt} als Wiederholung`);
    pruefe(gleich.every((a) => a.status === 200) && ids.length === 1 && wiederholt === 5, "gleicher Key gleichzeitig: sechsmal 200, eine Buchung, fuenf Wiederholungen");
    const spaeter = await mitKey(k1, p0);
    pruefe(spaeter.status === 200 && spaeter.replayed === true && spaeter.body?.booking?.id === ids[0], "gleicher Key spaeter: 200 als Wiederholung mit derselben Buchung");
    const fremd = await mitKey(k1, p1);
    pruefe(fremd.status === 422, `gleicher Key fuer eine andere Person: ${fremd.status} "${fremd.body?.error}"`);
    const ungueltig = await mitKey("keine-uuid", p1);
    pruefe(ungueltig.status === 400, `ungueltiger Key: ${ungueltig.status} "${ungueltig.body?.error}"`);

    pruefe((await mitKey(k2, p1)).status === 200, "zweiter Platz besetzt");
    const voll = await mitKey(k3, p2);
    pruefe(voll.status === 409 && voll.body?.error === "Schicht ist bereits besetzt." && !voll.replayed, `volle Schicht: ${voll.status} "${voll.body?.error}"`);
    const frei = await manager.anfrage("/api/bookings", "DELETE", { shiftId: schicht.id, userId: p1 });
    pruefe(frei.status === 200, "ein Platz wieder frei");
    const nochmal = await mitKey(k3, p2);
    pruefe(nochmal.status === 409 && nochmal.replayed === true, `gleicher Key nach der Freigabe: ${nochmal.status} als Wiederholung, nicht neu ausgefuehrt`);
    const neu = await mitKey(k4, p2);
    pruefe(neu.status === 200 && !neu.replayed, `neuer Key bucht den freien Platz: ${neu.status}`);

    await ruhe(() => signale);
    const gebucht = (await db.booking.findMany({ where: { shiftId: schicht.id }, select: { userId: true } })).map((b) => b.userId).sort();
    pruefe(JSON.stringify(gebucht) === JSON.stringify([p0, p2].sort()), `${TITEL_IDEMPOTENZ}: ${gebucht.length} Buchungen, erwartet die erste und die dritte Person`);
    const empfaenger = (await db.message.findMany({ where: { shiftId: schicht.id, subject: "Neue Schicht" }, select: { recipients: { select: { userId: true } } } }))
      .flatMap((n) => n.recipients.map((r) => r.userId))
      .sort();
    pruefe(JSON.stringify(empfaenger) === JSON.stringify([p0, p1, p2].sort()), `genau eine Benachrichtigung je ausgefuehrter Buchung (${empfaenger.length})`);
    const gespeichert = await db.idempotencyKey.findMany({ where: { key: { in: [k1, k2, k3, k4] } }, select: { key: true, status: true } });
    const status = (k: string) => gespeichert.find((g) => g.key === k)?.status;
    pruefe(gespeichert.length === 4 && status(k1) === 200 && status(k3) === 409, `gespeicherte Keys: ${gespeichert.length}, Ergebnis erster Key ${status(k1)}, abgelehnter Key ${status(k3)}`);
    pruefe(signale === 4, `Socket-Signale ${signale}, erwartet 4 (drei Buchungen, eine Freigabe, keine fuer Wiederholungen)`);
  }

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
