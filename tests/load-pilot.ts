/*
 * Lasttest fuer den internen Pilotbetrieb (rund 20 Mitarbeitende).
 *
 * Der Test laeuft ausschliesslich gegen eine ausdruecklich konfigurierte
 * Testumgebung. Es gibt keine Standardadresse und keine Zugangsdaten im
 * Quelltext; fehlt etwas, bricht der Lauf mit einer Meldung ab. Benutzer
 * werden nie angelegt - es werden nur vorhandene Testkonten verwendet.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { io, type Socket } from "socket.io-client";
import { berlinDate, isoWeek } from "../src/lib/berlin";

// ---------------------------------------------------------------------------
// Konfiguration - ausschliesslich ueber Umgebungsvariablen
// ---------------------------------------------------------------------------

function zahl(name: string, standard: number): number {
  const wert = process.env[name];
  if (wert === undefined || wert.trim() === "") return standard;
  const n = Number(wert);
  if (!Number.isFinite(n) || n <= 0) {
    console.error(`${name} muss eine positive Zahl sein, gelesen wurde: ${wert}`);
    process.exit(1);
  }
  return n;
}

const BASIS = (process.env.LOAD_BASE_URL ?? "").replace(/\/+$/, "");
const PASSWORT = process.env.LOAD_USER_PASSWORD ?? "";
const PRAEFIX = process.env.LOAD_USER_PREFIX || "load-user-";
const NUTZER = Math.floor(zahl("LOAD_USERS", 30));
const DAUER_MINUTEN = zahl("LOAD_DURATION_MINUTES", 15);
const SPITZE = Math.floor(zahl("LOAD_SPIKE_USERS", 40));
const SCHREIBEN_ERLAUBT = (process.env.LOAD_ALLOW_WRITES ?? "false").toLowerCase() === "true";
/** Optional: Rollen-Szenario aus tests/seed-load-roles.ts (IDs, erwartete Sichtbarkeit, keine Passwoerter). */
const SZENARIO_DATEI = process.env.LOAD_SCENARIO_FILE ?? "";
/** Optional: Messwerte, Befunde und Schreibprotokoll als JSON fuer die Nachpruefung. */
const ERGEBNIS_DATEI = process.env.LOAD_RESULT_FILE ?? "";
/** Welcher Entwurf aus dem Szenario besetzt und veroeffentlicht wird ("funktion" oder "last"). */
const MANAGER_LAUF = process.env.LOAD_MANAGER_RUN || "last";

type SzenarioKonto = { email: string; role: string; orte: string[]; kunden: string[]; planen: boolean };
type Ziel = { scheduleId: string; shiftId: string; week: { weekNumber: number; year: number } };
type Szenario = {
  organisation: string;
  woche: { weekNumber: number; year: number };
  orte: Record<string, string>;
  manager: { email: string; ziele: Record<string, Ziel> };
  fremd: { organisation: string; kunde: string; ortId: string; schichtId: string };
  konten: SzenarioKonto[];
};
const szenario: Szenario | null = SZENARIO_DATEI ? JSON.parse(readFileSync(SZENARIO_DATEI, "utf8")) : null;

/** Nennplan des Lasttests; kuerzere Laufzeiten verkuerzen ihn anteilig. */
const PHASEN = [
  { name: "Phase 1", minuten: 2, nutzer: () => 5 },
  { name: "Phase 2", minuten: 3, nutzer: () => 15 },
  { name: "Phase 3", minuten: 10, nutzer: () => NUTZER },
  { name: "Phase 4", minuten: 2, nutzer: () => SPITZE },
];
const NENNDAUER_MINUTEN = PHASEN.reduce((summe, p) => summe + p.minuten, 0);

/** Endpunkte, deren p95 als normaler Lesezugriff bewertet wird. */
const LESEN = [
  "/api/me",
  "/api/dashboard",
  "/api/schedules",
  "/api/messages/unread-count",
  // Rollen-Szenario
  "/api/branches",
  "/api/schedules?standort",
  "/api/shifts/:id/candidates",
  "/api/mod-requests",
  "/api/messages",
  "/api/messages/recipients",
  "/api/time",
  "/api/schedules (Mitarbeiter-Sicht)",
  "Gleichzeitig /api/dashboard",
  "Gleichzeitig /api/schedules",
];
/** Endpunkte, deren p95 als Schreibzugriff bewertet wird. */
const SCHREIBEN = [
  "/api/bookings (PATCH)",
  "/api/mod-requests (POST)",
  "/api/messages (POST)",
  // Rollen-Szenario
  "/api/time (POST)",
  "/api/bookings (POST)",
  "/api/schedules (PATCH)",
];

const GRENZE_FEHLERQUOTE = 1; // Prozent
const GRENZE_P95_LESEN = 800; // Millisekunden
const GRENZE_P95_SCHREIBEN = 1500; // Millisekunden
const PAUSE_MIN = 15_000;
const PAUSE_MAX = 45_000;
/** Hoechstzahl Schreibvorgaenge je simuliertem Benutzer im ganzen Lauf. */
const SCHREIBGRENZE = 2;

function pruefeKonfiguration(): void {
  const fehlt: string[] = [];
  if (!BASIS) fehlt.push("LOAD_BASE_URL");
  if (!PASSWORT) fehlt.push("LOAD_USER_PASSWORD");
  if (fehlt.length) {
    console.error("Der Lasttest wurde nicht gestartet. Es fehlen diese Umgebungsvariablen:");
    for (const name of fehlt) console.error("  - " + name);
    console.error("");
    console.error("Beispiel:");
    console.error('  LOAD_BASE_URL="https://dienstplan.test.example" LOAD_USER_PASSWORD="…" npm run test:load:pilot');
    console.error("Niemals gegen die Produktivumgebung testen.");
    process.exit(1);
  }
  let adresse: URL;
  try {
    adresse = new URL(BASIS);
  } catch {
    console.error(`LOAD_BASE_URL ist keine gueltige Adresse: ${BASIS}`);
    process.exit(1);
  }
  if (adresse.protocol !== "http:" && adresse.protocol !== "https:") {
    console.error(`LOAD_BASE_URL muss http oder https verwenden, gelesen wurde: ${adresse.protocol}`);
    process.exit(1);
  }
  // Harte Sperre: nie gegen die Produktivumgebung, egal was sonst konfiguriert ist.
  if (/(^|\.)akro-group\.com$/i.test(adresse.hostname)) {
    console.error(`LOAD_BASE_URL zeigt auf die Produktivumgebung (${adresse.hostname}). Der Lasttest startet nicht.`);
    process.exit(1);
  }
}

/** Baut die Adresse eines Testkontos, z. B. load-user-001@akro-test.invalid */
function kontoAdresse(nummer: number): string {
  const n = String(nummer).padStart(3, "0");
  const at = PRAEFIX.indexOf("@");
  if (at >= 0) return PRAEFIX.slice(0, at) + n + PRAEFIX.slice(at);
  return PRAEFIX + n + "@akro-test.invalid";
}

// ---------------------------------------------------------------------------
// Messwerte
// ---------------------------------------------------------------------------

type Messreihe = { anfragen: number; fehler: number; dauern: number[] };

const messung = new Map<string, Messreihe>();

function reihe(endpunkt: string): Messreihe {
  let vorhanden = messung.get(endpunkt);
  if (!vorhanden) {
    vorhanden = { anfragen: 0, fehler: 0, dauern: [] };
    messung.set(endpunkt, vorhanden);
  }
  return vorhanden;
}

function erfasse(endpunkt: string, dauer: number, erfolg: boolean): void {
  const r = reihe(endpunkt);
  r.anfragen++;
  if (erfolg) r.dauern.push(dauer);
  else r.fehler++;
}

const zaehler = {
  loginsOk: 0,
  loginsFehler: 0,
  socketsOk: 0,
  socketsFehler: 0,
  socketsGeplant: 0,
  socketAbbrueche: 0,
  schreibvorgaenge: 0,
  authFehler: 0,
  mandantFehler: 0,
  // Rollen-Szenario
  sicherheitsPruefungen: 0,
  sicherheitsFehler: 0,
  datenFehler: 0,
  socketEreignisse: 0,
  socketsJetzt: 0,
  socketsMax: 0,
  gleichzeitigNutzer: 0,
  managerBesetzt: false,
  managerVeroeffentlicht: false,
  sichtbarNachVeroeffentlichung: false,
};

/** Sicherheits- und Datenbefunde; Konten nur mit Nummer, ohne Adresse oder Passwort. */
const befunde: string[] = [];
/** Erfolgreiche Schreibvorgaenge fuer die Nachpruefung in der Datenbank. */
const schreibprotokoll: { typ: string; konto: number; shiftId?: string; userId?: string; id?: string }[] = [];
const zeitplan: { phase: string; start: string; nutzer: number }[] = [];

/** Nearest-Rank-Perzentil auf einer bereits sortierten Liste. */
function perzentil(sortiert: number[], anteil: number): number {
  if (sortiert.length === 0) return 0;
  const rang = Math.ceil(anteil * sortiert.length);
  return sortiert[Math.min(sortiert.length - 1, Math.max(0, rang - 1))];
}

function ms(wert: number): string {
  return wert === 0 ? "-" : Math.round(wert) + " ms";
}

// ---------------------------------------------------------------------------
// Simulierter Benutzer
// ---------------------------------------------------------------------------

type Buchung = { userId: string; confirmedAt: string | null };
type Schicht = {
  id: string;
  bookings: Buchung[];
  title?: string | null;
  maxEmployees?: number;
  missing?: number;
  occupiedCount?: number;
};
type Antraege = { requests?: { shiftId: string; state: string; userId: string | null }[] };
type Plan = { schedule?: { id: string; shifts?: Schicht[] } };
type Konto = { organizationId?: string; organizationName?: string; user?: { id: string } };

class Nutzer {
  private jar = new Map<string, string>();
  private socket: Socket | null = null;
  /** Solange gesetzt, gehoert der Benutzer zur laufenden Phase. */
  aktiv = false;
  private wecker: (() => void) | null = null;
  private schleife: Promise<void> | null = null;
  private geschrieben = 0;
  orgId = "";
  orgName = "";
  userId = "";
  /** Laufende Nummer des Kontos; Befunde nennen nur sie. */
  readonly nr: number;
  /** Erwartete Rolle und Sichtbarkeit aus dem Szenario. */
  readonly erwartet: SzenarioKonto | null;
  angemeldet = false;
  /** Gehoert laut /api/me nicht zur Organisation des ersten Kontos - dann nie schreiben. */
  fremdeOrganisation = false;
  private ortPlan: Plan | null = null;
  private antraege: Antraege | null = null;

  constructor(readonly email: string) {
    this.nr = Number(email.match(/(\d+)@/)?.[1] ?? 0);
    this.erwartet = szenario?.konten.find((k) => k.email === email) ?? null;
  }

  private cookieKopf(): string {
    return [...this.jar].map(([k, v]) => k + "=" + v).join("; ");
  }

  private merkeCookies(res: Response): void {
    for (const cookie of res.headers.getSetCookie()) {
      const paar = cookie.split(";")[0];
      const index = paar.indexOf("=");
      if (index > 0) this.jar.set(paar.slice(0, index), paar.slice(index + 1));
    }
  }

  /** Eine gemessene Anfrage. Gibt den Rumpf zurueck oder null bei Fehler. */
  async anfrage<T>(endpunkt: string, pfad: string, method = "GET", data?: unknown): Promise<T | null> {
    const start = performance.now();
    try {
      const res = await fetch(BASIS + pfad, {
        method,
        redirect: "manual",
        headers: { Cookie: this.cookieKopf(), "Content-Type": "application/json" },
        ...(data === undefined ? {} : { body: JSON.stringify(data) }),
      });
      this.merkeCookies(res);
      const text = await res.text();
      const dauer = performance.now() - start;
      const erfolg = res.status >= 200 && res.status < 300;
      if (!erfolg) {
        // 401/403 und die Umleitung auf die Anmeldung sind Zugriffsfehler,
        // kein normales Lastergebnis.
        if (res.status === 401 || res.status === 403 || res.status === 307) zaehler.authFehler++;
        erfasse(endpunkt, dauer, false);
        return null;
      }
      erfasse(endpunkt, dauer, true);
      if (!res.headers.get("content-type")?.includes("json")) return null;
      return JSON.parse(text) as T;
    } catch {
      erfasse(endpunkt, performance.now() - start, false);
      return null;
    }
  }

  /** Anmeldung ueber den Anmeldedienst der Anwendung. */
  async anmelden(): Promise<boolean> {
    const start = performance.now();
    try {
      const csrfRes = await fetch(BASIS + "/api/auth/csrf", {
        headers: { Cookie: this.cookieKopf() },
      });
      this.merkeCookies(csrfRes);
      const { csrfToken } = (await csrfRes.json()) as { csrfToken: string };
      const res = await fetch(BASIS + "/api/auth/callback/credentials", {
        method: "POST",
        redirect: "manual",
        headers: {
          Cookie: this.cookieKopf(),
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          csrfToken,
          email: this.email,
          password: PASSWORT,
          callbackUrl: BASIS + "/dashboard",
        }),
      });
      this.merkeCookies(res);
      const sitzungRes = await fetch(BASIS + "/api/auth/session", {
        headers: { Cookie: this.cookieKopf() },
      });
      this.merkeCookies(sitzungRes);
      const sitzung = (await sitzungRes.json()) as { user?: { email?: string } };
      const ok = sitzung.user?.email === this.email;
      erfasse("Login", performance.now() - start, ok);
      if (ok) zaehler.loginsOk++;
      else zaehler.loginsFehler++;
      return ok;
    } catch {
      erfasse("Login", performance.now() - start, false);
      zaehler.loginsFehler++;
      return false;
    }
  }

  /** Liest die eigene Mitgliedschaft; liefert false, wenn sie fehlt. */
  async ladeKonto(): Promise<boolean> {
    const konto = await this.anfrage<Konto>("/api/me", "/api/me");
    if (!konto?.organizationId || !konto.user?.id) return false;
    this.orgId = konto.organizationId;
    this.orgName = konto.organizationName ?? "";
    this.userId = konto.user.id;
    return true;
  }

  private async verbinde(): Promise<void> {
    zaehler.socketsGeplant++;
    const start = performance.now();
    const verbindung = io(BASIS, {
      path: "/api/ws",
      transports: ["websocket", "polling"],
      extraHeaders: { Cookie: this.cookieKopf() },
      // Kein automatischer Neuaufbau: unerwartete Abbrueche sollen sichtbar
      // bleiben und nicht stillschweigend geheilt werden.
      reconnection: false,
      timeout: 20_000,
    });
    this.socket = verbindung;
    const verbunden = await new Promise<boolean>((auf) => {
      const fertig = (wert: boolean) => {
        verbindung.off("connect", beiVerbindung);
        verbindung.off("connect_error", beiFehler);
        auf(wert);
      };
      const beiVerbindung = () => fertig(true);
      const beiFehler = () => fertig(false);
      verbindung.once("connect", beiVerbindung);
      verbindung.once("connect_error", beiFehler);
    });
    erfasse("Socket.IO", performance.now() - start, verbunden);
    if (!verbunden) {
      zaehler.socketsFehler++;
      verbindung.close();
      this.socket = null;
      return;
    }
    zaehler.socketsOk++;
    zaehler.socketsJetzt++;
    zaehler.socketsMax = Math.max(zaehler.socketsMax, zaehler.socketsJetzt);
    // Eigener Organisationsraum - der Server prueft die Zugehoerigkeit.
    verbindung.emit("join:org", this.orgId);
    verbindung.onAny(() => {
      zaehler.socketEreignisse++;
    });
    verbindung.on("disconnect", () => {
      zaehler.socketsJetzt--;
      if (this.aktiv) zaehler.socketAbbrueche++;
    });
  }

  private async trenne(): Promise<void> {
    const verbindung = this.socket;
    this.socket = null;
    if (!verbindung) return;
    verbindung.removeAllListeners("disconnect");
    if (verbindung.connected) zaehler.socketsJetzt--;
    verbindung.close();
  }

  /** Ein Lesedurchgang, wie ihn ein geoeffnetes Fenster erzeugt. */
  private async durchgang(): Promise<void> {
    const konto = await this.anfrage<Konto>("/api/me", "/api/me");
    // Mandantentrennung: die Antwort muss zur eigenen Organisation gehoeren.
    if (konto && konto.organizationId !== this.orgId) zaehler.mandantFehler++;
    if (!this.aktiv) return;
    await this.anfrage("/api/dashboard", "/api/dashboard");
    if (!this.aktiv) return;
    const woche = isoWeek(berlinDate());
    const plan = await this.anfrage<Plan>(
      "/api/schedules",
      `/api/schedules?kw=${woche.weekNumber}&year=${woche.year}`
    );
    if (!this.aktiv) return;
    await this.anfrage("/api/messages/unread-count", "/api/messages/unread-count");
    if (szenario && this.erwartet && this.aktiv) await this.szenarioLesen();
    if (darfSchreiben() && !this.fremdeOrganisation && this.geschrieben < SCHREIBGRENZE && this.aktiv) {
      await this.schreibe(plan);
    }
  }

  /** Weitere Ansichten des Rollen-Szenarios: Standortplan, Kandidaten, Antraege, Nachrichten, Zeiten. */
  private async szenarioLesen(): Promise<void> {
    const woche = isoWeek(berlinDate());
    const ort = this.erwartet?.orte[0];
    if (ort) {
      this.ortPlan = await this.anfrage<Plan>(
        "/api/schedules?standort",
        `/api/schedules?kw=${woche.weekNumber}&year=${woche.year}&standort=${encodeURIComponent(ort)}`
      );
    }
    if (!this.aktiv) return;
    const schichten = this.ortPlan?.schedule?.shifts ?? [];
    if (this.erwartet?.planen && schichten.length) {
      const offen = schichten.find((x) => offenePlaetze(x) > 0) ?? schichten[0];
      await this.anfrage("/api/shifts/:id/candidates", `/api/shifts/${offen.id}/candidates`);
    }
    if (!this.aktiv) return;
    this.antraege = await this.anfrage<Antraege>("/api/mod-requests", "/api/mod-requests");
    if (!this.aktiv) return;
    await this.anfrage("/api/messages", "/api/messages");
    if (!this.aktiv) return;
    await this.anfrage("/api/time", `/api/time?month=${berlinDate().slice(0, 7)}`);
  }

  /** Anfrage, deren Ablehnung erwartet wird: gemessen, aber nicht als Lastfehler gezaehlt. */
  private async sonde(pfad: string): Promise<{ status: number; body: unknown }> {
    const start = performance.now();
    try {
      const res = await fetch(BASIS + pfad, { redirect: "manual", headers: { Cookie: this.cookieKopf() } });
      const text = await res.text();
      erfasse("Sichtbarkeitspruefung", performance.now() - start, true);
      let body: unknown = null;
      try {
        body = JSON.parse(text);
      } catch {
        body = null;
      }
      return { status: res.status, body };
    } catch {
      erfasse("Sichtbarkeitspruefung", performance.now() - start, false);
      return { status: 0, body: null };
    }
  }

  /**
   * Fremde Kunden und Einsatzorte muessen verborgen bleiben: gleicher Mandant
   * mit anderem Kunden bzw. Einsatzort und ein fremder Mandant. Jeder Treffer
   * ist ein Sicherheitsfehler.
   */
  async pruefeSichtbarkeit(): Promise<void> {
    if (!szenario || !this.erwartet) return;
    const erwartet = this.erwartet;
    zaehler.sicherheitsPruefungen++;
    const fehler = (text: string) => {
      zaehler.sicherheitsFehler++;
      befunde.push(`Konto ${this.nr} (${erwartet.role}): ${text}`);
    };
    const admin = erwartet.role === "ADMIN";
    const eigene = new Set(admin ? Object.values(szenario.orte) : erwartet.orte);

    const orte = await this.anfrage<{ branches: { id: string; customer?: { name: string } | null }[] }>("/api/branches", "/api/branches");
    for (const b of orte?.branches ?? []) {
      if (b.id === szenario.fremd.ortId || b.customer?.name === szenario.fremd.kunde) fehler("sieht Einsatzort oder Kunden des fremden Mandanten");
      else if (!eigene.has(b.id)) fehler("sieht einen nicht zugeordneten Einsatzort");
    }

    // Wochenplaene fremder Einsatzorte. "Lasttest Objekt" bleibt aussen vor,
    // weil dort alle Konten eine eigene Schicht haben.
    const woche = szenario.woche;
    const fremdeOrte = Object.entries(szenario.orte)
      .filter(([name, id]) => !admin && name !== "Lasttest Objekt" && !eigene.has(id))
      .map(([, id]) => id);
    fremdeOrte.push(szenario.fremd.ortId);
    for (const id of fremdeOrte) {
      const r = await this.sonde(`/api/schedules?kw=${woche.weekNumber}&year=${woche.year}&standort=${encodeURIComponent(id)}`);
      const zahl = (r.body as Plan | null)?.schedule?.shifts?.length ?? 0;
      if (r.status >= 200 && r.status < 300 && zahl > 0) fehler(`sieht den Wochenplan eines fremden Einsatzorts (${zahl} Schichten)`);
    }
    const k = await this.sonde(`/api/shifts/${szenario.fremd.schichtId}/candidates`);
    if (k.status >= 200 && k.status < 300) fehler("erhaelt die Kandidatenliste einer Schicht des fremden Mandanten");

    const dash = JSON.stringify((await this.sonde("/api/dashboard")).body ?? "");
    if (dash.includes(szenario.fremd.kunde) || dash.includes(szenario.fremd.organisation)) fehler("Dashboard enthaelt Daten des fremden Mandanten");
    for (const [name, id] of Object.entries(szenario.orte)) {
      if (admin || name === "Lasttest Objekt" || eigene.has(id)) continue;
      if (dash.includes(`"${name}"`)) fehler(`Dashboard nennt den nicht zugeordneten Einsatzort ${name}`);
    }
  }

  /**
   * Manager besetzt waehrend der Last eine Schicht (mit bestaetigtem Hinweis,
   * falls noetig) und veroeffentlicht den Wochenplan. Danach muss die
   * eingeteilte Person die Schicht sehen.
   */
  async managerAktion(): Promise<void> {
    if (!szenario) return;
    const ziel = szenario.manager.ziele[MANAGER_LAUF];
    if (!ziel) return;
    const datenfehler = (text: string) => {
      zaehler.datenFehler++;
      befunde.push(`Manager (Konto ${this.nr}): ${text}`);
    };
    type Kandidat = { userId: string; group: number; selectable: boolean; confirm: boolean };
    const liste = await this.anfrage<{ candidates: Kandidat[] }>("/api/shifts/:id/candidates", `/api/shifts/${ziel.shiftId}/candidates`);
    const wahl = liste?.candidates.find((c) => c.group === 1 && c.selectable);
    if (!wahl) return datenfehler("kein waehlbarer Kandidat in Gruppe 1");
    const buchung = await this.anfrage<{ booking?: { id: string } }>("/api/bookings (POST)", "/api/bookings", "POST", {
      shiftId: ziel.shiftId,
      userId: wahl.userId,
      ...(wahl.confirm ? { confirm: true } : {}),
    });
    if (!buchung) return datenfehler("Besetzen fehlgeschlagen");
    zaehler.managerBesetzt = true;
    schreibprotokoll.push({ typ: "Besetzung durch Manager", konto: this.nr, shiftId: ziel.shiftId, userId: wahl.userId, id: buchung.booking?.id });
    const veroeffentlicht = await this.anfrage("/api/schedules (PATCH)", `/api/schedules/${ziel.scheduleId}`, "PATCH", { isPublic: true });
    if (veroeffentlicht === null) return datenfehler("Veroeffentlichen fehlgeschlagen");
    zaehler.managerVeroeffentlicht = true;
    schreibprotokoll.push({ typ: "Veroeffentlichung durch Manager", konto: this.nr, id: ziel.scheduleId });

    const person = nutzer.find((n) => n.userId === wahl.userId && n.angemeldet);
    if (!person) return datenfehler("eingeteilte Person ist nicht angemeldet - Sicht nicht pruefbar");
    const sicht = await person.anfrage<Plan>(
      "/api/schedules (Mitarbeiter-Sicht)",
      `/api/schedules?kw=${ziel.week.weekNumber}&year=${ziel.week.year}`
    );
    const sichtbar = sicht?.schedule?.shifts?.some((x) => x.id === ziel.shiftId && x.bookings?.some((b) => b.userId === wahl.userId));
    if (!sichtbar) return datenfehler("eingeteilte Person sieht die veroeffentlichte Schicht nicht");
    zaehler.sichtbarNachVeroeffentlichung = true;
  }

  /**
   * Genau ein kontrollierter Schreibvorgang: eigene Schicht bestaetigen,
   * eigenen Antrag stellen oder eine Nachricht an ein anderes Testkonto.
   * Fremde Schichten, Einstellungen und Stammdaten bleiben unberuehrt.
   */
  private async schreibe(plan: Plan | null): Promise<void> {
    const schichten = plan?.schedule?.shifts ?? [];
    const eigene = schichten.filter((s) => s.bookings?.some((b) => b.userId === this.userId));
    const unbestaetigt = eigene.find((s) =>
      s.bookings.some((b) => b.userId === this.userId && !b.confirmedAt)
    );

    if (unbestaetigt) {
      const ok = await this.anfrage("/api/bookings (PATCH)", "/api/bookings", "PATCH", {
        shiftId: unbestaetigt.id,
      });
      if (ok !== null) {
        this.zaehleSchreiben();
        schreibprotokoll.push({ typ: "Bestaetigung", konto: this.nr, shiftId: unbestaetigt.id, userId: this.userId });
      }
      return;
    }
    if (szenario && this.erwartet) return this.schreibeSzenario();
    if (eigene.length > 0) {
      const ok = await this.anfrage("/api/mod-requests (POST)", "/api/mod-requests", "POST", {
        shiftId: eigene[0].id,
        kind: "SWAP",
      });
      if (ok !== null) this.zaehleSchreiben();
      return;
    }
    const empfaenger = anderesTestkonto(this.userId);
    if (!empfaenger) return;
    const ok = await this.anfrage("/api/messages (POST)", "/api/messages", "POST", {
      subject: "Lasttest",
      body: "Automatisch erzeugte Testnachricht des Pilot-Lasttests.",
      recipientIds: [empfaenger],
    });
    if (ok !== null) this.zaehleSchreiben();
  }

  /** Zweiter Schreibvorgang im Rollen-Szenario: Uebernahmeantrag, Zeitbuchung oder Nachricht. */
  private async schreibeSzenario(): Promise<void> {
    if (this.erwartet?.role !== "EMPLOYEE") return;
    const art = this.nr % 4;
    if (art === 0) {
      const r = await this.anfrage<{ record?: { id: string } }>("/api/time (POST)", "/api/time", "POST", {
        type: "MANUAL",
        userId: this.userId,
        date: berlinDate(),
        timeFrom: "05:00",
        timeTo: "05:30",
        breakMinutes: 0,
        comment: "Lasttest",
      });
      if (r) {
        this.zaehleSchreiben();
        schreibprotokoll.push({ typ: "Zeitbuchung", konto: this.nr, userId: this.userId, id: r.record?.id });
      }
      return;
    }
    if (art === 1) {
      const liste = await this.anfrage<{ recipients?: { id: string }[] }>("/api/messages/recipients", "/api/messages/recipients");
      const empfaenger = liste?.recipients?.[0]?.id;
      if (!empfaenger) return;
      const r = await this.anfrage<{ message?: { id: string } }>("/api/messages (POST)", "/api/messages", "POST", {
        subject: "Lasttest",
        body: "Automatisch erzeugte Testnachricht des Lasttests.",
        recipientIds: [empfaenger],
      });
      if (r) {
        this.zaehleSchreiben();
        schreibprotokoll.push({ typ: "Nachricht", konto: this.nr, userId: empfaenger, id: r.message?.id });
      }
      return;
    }
    const offen = new Set(
      (this.antraege?.requests ?? []).filter((x) => x.state === "OPEN" && x.userId === this.userId).map((x) => x.shiftId)
    );
    const schicht = (this.ortPlan?.schedule?.shifts ?? []).find(
      (x) => x.title === "Lasttest offen" && offenePlaetze(x) > 0 && !x.bookings?.some((b) => b.userId === this.userId) && !offen.has(x.id)
    );
    if (!schicht) return;
    const r = await this.anfrage<{ request?: { id: string } }>("/api/mod-requests (POST)", "/api/mod-requests", "POST", {
      shiftId: schicht.id,
      kind: "TAKEOVER",
    });
    if (r) {
      this.zaehleSchreiben();
      schreibprotokoll.push({ typ: "Uebernahmeantrag", konto: this.nr, shiftId: schicht.id, userId: this.userId, id: r.request?.id });
    }
  }

  private zaehleSchreiben(): void {
    this.geschrieben++;
    zaehler.schreibvorgaenge++;
  }

  /** Startet Verbindung und Leseschleife des Benutzers. */
  starte(): void {
    if (this.aktiv) return;
    this.aktiv = true;
    this.schleife = (async () => {
      if (!this.angemeldet) {
        // Anmeldung erst beim Einstieg - so laeuft sie unter der Last der anderen.
        const ok = (await this.anmelden()) && (await this.ladeKonto());
        if (!ok) {
          this.aktiv = false;
          return;
        }
        this.angemeldet = true;
        pruefeMandant(this);
        await this.pruefeSichtbarkeit();
        if (!this.aktiv) return;
      }
      await this.verbinde();
      while (this.aktiv) {
        await this.durchgang();
        if (!this.aktiv) break;
        await this.warte(PAUSE_MIN + Math.random() * (PAUSE_MAX - PAUSE_MIN));
      }
      await this.trenne();
    })();
  }

  /** Beendet den Benutzer geordnet und wartet auf das Ende der Schleife. */
  async stoppe(): Promise<void> {
    if (!this.aktiv) return;
    this.aktiv = false;
    this.wecker?.();
    const laufend = this.schleife;
    this.schleife = null;
    await laufend;
  }

  /** Abbrechbare Pause mit Jitter, damit nicht alle gleichzeitig abfragen. */
  private warte(dauer: number): Promise<void> {
    return new Promise<void>((auf) => {
      const uhr = setTimeout(() => {
        this.wecker = null;
        auf();
      }, dauer);
      this.wecker = () => {
        clearTimeout(uhr);
        this.wecker = null;
        auf();
      };
    });
  }
}

// ---------------------------------------------------------------------------
// Testumgebung und Schreibfreigabe
// ---------------------------------------------------------------------------

const nutzer: Nutzer[] = [];
let testumgebung = false;
let schreibgrund = "";

function offenePlaetze(s: Schicht): number {
  return s.missing ?? Math.max(0, (s.maxEmployees ?? 0) - (s.occupiedCount ?? s.bookings?.length ?? 0));
}

/** Jedes spaeter angemeldete Konto muss zur Organisation des ersten gehoeren. */
function pruefeMandant(n: Nutzer): void {
  const erste = nutzer.find((x) => x.angemeldet && x !== n);
  if (!erste || erste.orgId === n.orgId) return;
  zaehler.mandantFehler++;
  n.fremdeOrganisation = true;
  befunde.push(`Konto ${n.nr}: gehoert zu einer anderen Organisation als Konto ${erste.nr}`);
}

function darfSchreiben(): boolean {
  return SCHREIBEN_ERLAUBT && testumgebung;
}

function anderesTestkonto(eigeneId: string): string | null {
  const andere = nutzer.find((n) => n.userId && n.userId !== eigeneId);
  return andere?.userId ?? null;
}

/**
 * Eine Umgebung gilt nur dann als Testumgebung, wenn alle verwendeten Konten
 * auf der reservierten Endung .invalid liegen und die Organisation sich
 * selbst als Test kennzeichnet. Sonst wird nicht geschrieben.
 */
function pruefeTestumgebung(): void {
  const alleUngueltig = nutzer.every((n) => n.email.toLowerCase().endsWith(".invalid"));
  // Angemeldet sind hier nur die vorab gepruefte(n) Konten; spaetere prueft pruefeMandant.
  const angemeldete = nutzer.filter((n) => n.angemeldet);
  const orgName = angemeldete[0]?.orgName ?? "";
  const heisstTest = /test|pilot|staging/i.test(orgName);
  const eineOrganisation = new Set(angemeldete.map((n) => n.orgId)).size === 1;
  testumgebung = alleUngueltig && heisstTest && eineOrganisation;
  if (testumgebung) return;
  if (!alleUngueltig) schreibgrund = "Testkonten liegen nicht auf der reservierten Endung .invalid";
  else if (!eineOrganisation) schreibgrund = "Die Konten gehoeren zu mehreren Organisationen";
  else schreibgrund = `Die Organisation "${orgName}" ist nicht als Testorganisation erkennbar`;
}

// ---------------------------------------------------------------------------
// Ablauf
// ---------------------------------------------------------------------------

function schlafe(dauer: number): Promise<void> {
  return new Promise<void>((auf) => {
    setTimeout(auf, dauer);
  });
}

/** Wird durch SIGINT/SIGTERM gesetzt und bricht den Lauf geordnet ab. */
let abbruch = false;

/** Weckt eine laufende Phase vorzeitig, sobald ein Signal eintrifft. */
let phasenWecker: (() => void) | null = null;

function phasenPause(dauer: number): Promise<void> {
  return new Promise<void>((auf) => {
    const uhr = setTimeout(() => {
      phasenWecker = null;
      auf();
    }, dauer);
    phasenWecker = () => {
      clearTimeout(uhr);
      phasenWecker = null;
      auf();
    };
  });
}

/** Meldet alle benoetigten Konten an; fehlende werden benannt. */
async function anmeldung(anzahl: number): Promise<string[]> {
  const fehlend: string[] = [];
  const gleichzeitig = 5;
  for (let start = 0; start < anzahl; start += gleichzeitig) {
    const gruppe = nutzer.slice(start, Math.min(start + gleichzeitig, anzahl));
    await Promise.all(
      gruppe.map(async (n) => {
        if (!(await n.anmelden()) || !(await n.ladeKonto())) fehlend.push(n.email);
        else n.angemeldet = true;
      })
    );
  }
  return fehlend;
}

/** Wartet, bis die Zielzahl angemeldet und aktiv ist (hoechstens eine Minute). */
async function warteAufAnmeldung(ziel: number): Promise<void> {
  const ende = Date.now() + 60_000;
  while (Date.now() < ende && !abbruch) {
    if (nutzer.filter((n) => n.aktiv && n.angemeldet).length >= ziel) return;
    await schlafe(500);
  }
}

/** Kontrollierter gleichzeitiger Abruf: alle aktiven Nutzer im selben Augenblick. */
async function gleichzeitigerAbruf(): Promise<void> {
  const bereit = nutzer.filter((n) => n.aktiv && n.angemeldet);
  zaehler.gleichzeitigNutzer = bereit.length;
  console.log(`  Gleichzeitiger Abruf durch ${bereit.length} Nutzer …`);
  const woche = isoWeek(berlinDate());
  await Promise.all(bereit.map((n) => n.anfrage("Gleichzeitig /api/dashboard", "/api/dashboard")));
  await Promise.all(
    bereit.map((n) => n.anfrage("Gleichzeitig /api/schedules", `/api/schedules?kw=${woche.weekNumber}&year=${woche.year}`))
  );
}

async function setzeZielzahl(ziel: number): Promise<void> {
  const aktive = nutzer.filter((n) => n.aktiv);
  if (aktive.length < ziel) {
    for (const n of nutzer) {
      if (abbruch) break;
      if (nutzer.filter((x) => x.aktiv).length >= ziel) break;
      if (!n.aktiv) {
        n.starte();
        // Gestaffelter Anlauf statt gleichzeitigem Einstieg aller Clients.
        await schlafe(150);
      }
    }
    return;
  }
  const zuViel = aktive.slice(ziel);
  await Promise.all(zuViel.map((n) => n.stoppe()));
}

function tabelle(): void {
  const zeilen = [...LESEN, ...SCHREIBEN, "Login", "Socket.IO", "Sichtbarkeitspruefung"].filter((endpunkt) =>
    messung.has(endpunkt)
  );
  const breite = Math.max(28, ...zeilen.map((z) => z.length + 2));
  const kopf =
    "Endpoint".padEnd(breite) +
    "Requests".padStart(9) +
    "Fehler".padStart(8) +
    "p50".padStart(10) +
    "p95".padStart(10) +
    "p99".padStart(10) +
    "Max".padStart(10);
  console.log("");
  console.log(kopf);
  console.log("-".repeat(kopf.length));
  for (const endpunkt of zeilen) {
    const r = reihe(endpunkt);
    const sortiert = [...r.dauern].sort((a, b) => a - b);
    console.log(
      endpunkt.padEnd(breite) +
        String(r.anfragen).padStart(9) +
        String(r.fehler).padStart(8) +
        ms(perzentil(sortiert, 0.5)).padStart(10) +
        ms(perzentil(sortiert, 0.95)).padStart(10) +
        ms(perzentil(sortiert, 0.99)).padStart(10) +
        ms(sortiert[sortiert.length - 1] ?? 0).padStart(10)
    );
  }
}

function bewerte(laufzeitMs: number): string[] {
  const gruende: string[] = [];
  let anfragen = 0;
  let fehler = 0;
  let schnellste = Number.POSITIVE_INFINITY;
  let summe = 0;
  let werte = 0;
  for (const [endpunkt, r] of messung) {
    if (endpunkt === "Socket.IO") continue;
    anfragen += r.anfragen;
    fehler += r.fehler;
    for (const d of r.dauern) {
      schnellste = Math.min(schnellste, d);
      summe += d;
      werte++;
    }
  }
  const quote = anfragen === 0 ? 0 : (fehler / anfragen) * 100;

  console.log("");
  console.log("Anfragen gesamt          " + anfragen);
  console.log("davon erfolgreich        " + (anfragen - fehler));
  console.log("davon fehlgeschlagen     " + fehler);
  console.log("Fehlerquote              " + quote.toFixed(2) + " %");
  console.log("Antwortzeit Minimum      " + ms(werte ? schnellste : 0));
  console.log("Antwortzeit Durchschnitt " + ms(werte ? summe / werte : 0));
  console.log("Logins erfolgreich       " + zaehler.loginsOk);
  console.log("Logins fehlgeschlagen    " + zaehler.loginsFehler);
  console.log("Socket-Verbindungen      " + zaehler.socketsOk + " von " + zaehler.socketsGeplant);
  console.log("Socket-Verbindungsfehler " + zaehler.socketsFehler);
  console.log("Unerwartete Abbrueche    " + zaehler.socketAbbrueche);
  console.log("Schreibvorgaenge         " + zaehler.schreibvorgaenge);
  console.log("Testdauer                " + (laufzeitMs / 60_000).toFixed(1) + " Minuten");
  if (szenario) {
    console.log("Sockets gleichzeitig max " + zaehler.socketsMax);
    console.log("Socket-Ereignisse        " + zaehler.socketEreignisse);
    console.log("Gleichzeitiger Abruf     " + zaehler.gleichzeitigNutzer + " Nutzer");
    console.log("Sichtbarkeitspruefungen  " + zaehler.sicherheitsPruefungen + " Konten, " + zaehler.sicherheitsFehler + " Befunde");
    console.log("Manager besetzt          " + (zaehler.managerBesetzt ? "ja" : "nein"));
    console.log("Manager veroeffentlicht  " + (zaehler.managerVeroeffentlicht ? "ja" : "nein"));
    console.log("Sicht nach Veroeffentl.  " + (zaehler.sichtbarNachVeroeffentlichung ? "ja" : "nein"));
    console.log("Datenfehler              " + zaehler.datenFehler);
    for (const befund of befunde) console.log("Befund: " + befund);
  }

  if (anfragen === 0) gruende.push("Es wurde keine einzige Anfrage ausgefuehrt.");
  if (quote >= GRENZE_FEHLERQUOTE) {
    gruende.push(`Fehlerquote ${quote.toFixed(2)} % liegt nicht unter ${GRENZE_FEHLERQUOTE} %.`);
  }
  for (const endpunkt of LESEN) {
    const r = messung.get(endpunkt);
    if (!r || r.dauern.length === 0) continue;
    const p95 = perzentil([...r.dauern].sort((a, b) => a - b), 0.95);
    if (p95 >= GRENZE_P95_LESEN) {
      gruende.push(`p95 von ${endpunkt} betraegt ${Math.round(p95)} ms (Grenze ${GRENZE_P95_LESEN} ms).`);
    }
  }
  for (const endpunkt of SCHREIBEN) {
    const r = messung.get(endpunkt);
    if (!r || r.dauern.length === 0) continue;
    const p95 = perzentil([...r.dauern].sort((a, b) => a - b), 0.95);
    if (p95 >= GRENZE_P95_SCHREIBEN) {
      gruende.push(`p95 von ${endpunkt} betraegt ${Math.round(p95)} ms (Grenze ${GRENZE_P95_SCHREIBEN} ms).`);
    }
  }
  if (zaehler.socketsFehler > 0 || zaehler.socketsOk < zaehler.socketsGeplant) {
    gruende.push(
      `Nur ${zaehler.socketsOk} von ${zaehler.socketsGeplant} Socket-Verbindungen kamen zustande.`
    );
  }
  if (zaehler.socketAbbrueche > 0) {
    gruende.push(`${zaehler.socketAbbrueche} unerwartete Socket-Abbrueche.`);
  }
  if (zaehler.authFehler > 0) {
    gruende.push(`${zaehler.authFehler} Antworten mit Authentifizierungsfehler (401/403/Umleitung).`);
  }
  if (zaehler.mandantFehler > 0) {
    gruende.push(`${zaehler.mandantFehler} Antworten aus einer fremden Organisation.`);
  }
  // Sicherheits- und Datenfehler sind immer ein Fehlschlag.
  if (zaehler.sicherheitsFehler > 0) {
    gruende.push(`${zaehler.sicherheitsFehler} Sicherheitsfehler: fremde Kunden, Einsatzorte oder Mandanten sichtbar.`);
  }
  if (zaehler.datenFehler > 0) gruende.push(`${zaehler.datenFehler} Datenfehler im Ablauf des Managers.`);
  if (szenario && !zaehler.managerVeroeffentlicht) gruende.push("Der Manager hat keinen Plan besetzt und veroeffentlicht.");
  if (szenario && zaehler.sicherheitsPruefungen < nutzer.filter((n) => n.angemeldet).length) {
    gruende.push("Nicht fuer jedes angemeldete Konto lief die Sichtbarkeitspruefung.");
  }
  // Ein Schreibtest ohne einen einzigen Schreibvorgang hat nichts belegt.
  if (SCHREIBEN_ERLAUBT && zaehler.schreibvorgaenge === 0) {
    gruende.push(
      testumgebung
        ? "LOAD_ALLOW_WRITES=true, aber kein einziger Schreibvorgang war erfolgreich. Haben die Testkonten Schichten in der laufenden Woche?"
        : `LOAD_ALLOW_WRITES=true, aber Schreibtests wurden abgelehnt: ${schreibgrund}.`
    );
  }
  return gruende;
}

async function main(): Promise<void> {
  pruefeKonfiguration();

  const benoetigt = Math.max(NUTZER, SPITZE, 5);
  for (let i = 1; i <= benoetigt; i++) nutzer.push(new Nutzer(kontoAdresse(i)));

  console.log(`Ziel:        ${BASIS}`);
  console.log(`Konten:      ${benoetigt} (${nutzer[0].email} … ${nutzer[benoetigt - 1].email})`);
  console.log(`Laufzeit:    ${DAUER_MINUTEN} Minuten (Nennplan ${NENNDAUER_MINUTEN} Minuten)`);
  console.log("");
  console.log("Melde Testkonten an …");

  // Im Rollen-Szenario meldet sich vorab nur das erste Konto an (Pruefung der
  // Zugangsdaten); alle anderen melden sich beim Einstieg unter Last an.
  const fehlend = await anmeldung(szenario ? 1 : benoetigt);
  if (fehlend.length) {
    console.error("");
    console.error("Diese Testkonten konnten sich nicht anmelden:");
    for (const email of fehlend) console.error("  - " + email);
    console.error("");
    console.error("Der Lasttest legt keine Benutzer an. Lege die Konten in der");
    console.error("Testorganisation an oder passe LOAD_USER_PREFIX an.");
    process.exitCode = 1;
    return;
  }

  pruefeTestumgebung();
  if (szenario) await nutzer[0].pruefeSichtbarkeit();
  console.log(`Organisation: ${nutzer[0].orgName}`);
  if (SCHREIBEN_ERLAUBT && !testumgebung) {
    console.log(`Schreibtests abgelehnt: ${schreibgrund}.`);
  } else if (SCHREIBEN_ERLAUBT) {
    console.log("Schreibtests aktiv: nur eigene Schicht, eigener Antrag, Testnachricht.");
  } else {
    console.log("Schreibtests aus (LOAD_ALLOW_WRITES=false).");
  }

  const faktor = DAUER_MINUTEN / NENNDAUER_MINUTEN;
  const start = performance.now();
  const beiSignal = () => {
    abbruch = true;
    // Laufende Phase sofort beenden, statt Minuten abzuwarten.
    phasenWecker?.();
    console.log("\nSignal empfangen - Phase wird abgebrochen, Verbindungen werden abgebaut …");
  };
  process.once("SIGINT", beiSignal);
  process.once("SIGTERM", beiSignal);

  for (const phase of PHASEN) {
    if (abbruch) break;
    const ziel = Math.max(1, Math.min(phase.nutzer(), nutzer.length));
    const dauer = Math.max(10_000, phase.minuten * faktor * 60_000);
    console.log(
      `\n${phase.name}: ${ziel} Nutzer für ${(dauer / 60_000).toFixed(1)} Minuten`
    );
    const phasenStart = performance.now();
    zeitplan.push({ phase: phase.name, start: new Date().toISOString(), nutzer: ziel });
    await setzeZielzahl(ziel);
    if (abbruch) break;
    if (szenario && phase.name === "Phase 3") {
      // Unter voller Last: ein Manager besetzt eine Schicht und veroeffentlicht.
      await phasenPause(Math.min(60_000, dauer / 3));
      if (abbruch) break;
      const manager = nutzer.find((n) => n.email === szenario.manager.email && n.angemeldet);
      console.log("  Manager besetzt eine Schicht und veroeffentlicht den Plan …");
      if (manager) await manager.managerAktion();
      else {
        zaehler.datenFehler++;
        befunde.push("Manager-Konto war waehrend Phase 3 nicht angemeldet.");
      }
    }
    if (szenario && phase.name === "Phase 4") {
      await warteAufAnmeldung(ziel);
      if (!abbruch) await gleichzeitigerAbruf();
    }
    const rest = dauer - (performance.now() - phasenStart);
    if (rest > 0 && !abbruch) await phasenPause(rest);
  }

  console.log("\nPhase 5: Verbindungen abbauen …");
  await Promise.all(nutzer.map((n) => n.stoppe()));
  process.off("SIGINT", beiSignal);
  process.off("SIGTERM", beiSignal);

  const laufzeit = performance.now() - start;
  tabelle();
  const gruende = bewerte(laufzeit);
  if (ERGEBNIS_DATEI) {
    const endpunkte = Object.fromEntries(
      [...messung].map(([name, r]) => {
        const d = [...r.dauern].sort((a, b) => a - b);
        return [name, { anfragen: r.anfragen, fehler: r.fehler, p50: perzentil(d, 0.5), p95: perzentil(d, 0.95), p99: perzentil(d, 0.99), max: d[d.length - 1] ?? 0 }];
      })
    );
    writeFileSync(
      ERGEBNIS_DATEI,
      JSON.stringify({ ziel: BASIS, laufzeitMinuten: laufzeit / 60_000, zeitplan, zaehler, gruende, befunde, schreibprotokoll, endpunkte }, null, 2)
    );
  }
  console.log("");
  if (gruende.length === 0 && !abbruch) {
    console.log("Ergebnis: BESTANDEN");
    return;
  }
  console.log("Ergebnis: NICHT BESTANDEN");
  console.log("Gründe:");
  if (abbruch) console.log("- Der Lauf wurde vorzeitig abgebrochen.");
  for (const grund of gruende) console.log("- " + grund);
  process.exitCode = 1;
}

main().catch((fehler) => {
  console.error(fehler);
  process.exitCode = 1;
});
