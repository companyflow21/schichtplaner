/*
 * Gezielte Pruefung der Anmeldewelle auf der isolierten Testinstallation
 * (Konten aus tests/seed-load-pilot.ts, Passwort-Hashes mit Kostenfaktor 12):
 *
 *  1. Anmeldung mit einem bestehenden Passwort-Hash gelingt.
 *  2. Ein falsches Passwort wird abgelehnt.
 *  3. Welle: LOAD_WAVE_USERS (Standard 35) verschiedene Konten melden sich
 *     gleichzeitig an. Waehrenddessen oeffnet ein bereits angemeldetes Konto
 *     laufend sein Dashboard; gemessen wird, wie lange es warten muss.
 *
 *   LOAD_BASE_URL="http://127.0.0.1:18080" LOAD_USER_PASSWORD="…" npx tsx tests/login-wave.ts
 *
 * Schreibt nichts ausser Sitzungen; ein falsches Passwort zaehlt als ein
 * Fehlversuch fuer ein einzelnes Testkonto.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
const BASIS = (process.env.LOAD_BASE_URL ?? "").replace(/\/+$/, "");
const PASSWORT = process.env.LOAD_USER_PASSWORD ?? "";
const PRAEFIX = process.env.LOAD_USER_PREFIX || "load-user-";
const WELLE = Number(process.env.LOAD_WAVE_USERS || 35);
if (!BASIS || !PASSWORT) {
  console.error("LOAD_BASE_URL und LOAD_USER_PASSWORD muessen gesetzt sein.");
  process.exit(1);
}
// Harte Sperre wie im Lasttest: nie gegen die Produktivumgebung.
if (/(^|\.)akro-group\.com$/i.test(new URL(BASIS).hostname)) {
  console.error("Ziel zeigt auf die Produktivumgebung. Die Pruefung startet nicht.");
  process.exit(1);
}

const konto = (n: number) => PRAEFIX + String(n).padStart(3, "0") + "@akro-test.invalid";

class Sitzung {
  private jar = new Map<string, string>();
  constructor(readonly email: string) {}
  private cookie() { return [...this.jar].map(([k, v]) => k + "=" + v).join("; "); }
  private merke(res: Response) {
    for (const c of res.headers.getSetCookie()) { const p = c.split(";")[0], i = p.indexOf("="); if (i > 0) this.jar.set(p.slice(0, i), p.slice(i + 1)); }
  }
  async anfrage(pfad: string): Promise<{ status: number; body: any; ms: number }> {
    const start = performance.now();
    const res = await fetch(BASIS + pfad, { redirect: "manual", headers: { Cookie: this.cookie() } });
    this.merke(res);
    const text = await res.text();
    let body: any = null;
    try { body = JSON.parse(text); } catch { /* kein JSON */ }
    return { status: res.status, body, ms: performance.now() - start };
  }
  async anmelden(passwort = PASSWORT): Promise<{ ok: boolean; ms: number }> {
    const start = performance.now();
    const csrf = await this.anfrage("/api/auth/csrf");
    const res = await fetch(BASIS + "/api/auth/callback/credentials", {
      method: "POST",
      redirect: "manual",
      headers: { Cookie: this.cookie(), "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ csrfToken: csrf.body?.csrfToken ?? "", email: this.email, password: passwort, callbackUrl: BASIS + "/dashboard" }),
    });
    this.merke(res);
    const ok = (await this.anfrage("/api/auth/session")).body?.user?.email === this.email;
    return { ok, ms: performance.now() - start };
  }
}

const warte = (ms: number) => new Promise((r) => setTimeout(r, ms));
const quantil = (werte: number[], q: number) => { const s = [...werte].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(q * s.length))] ?? 0; };
const ms = (x: number) => Math.round(x) + " ms";
let fehler = 0;
function pruefe(bedingung: boolean, text: string) { console.log((bedingung ? "OK      " : "FEHLER  ") + text); if (!bedingung) fehler++; }

async function main() {
  console.log(`Ziel ${new URL(BASIS).host}, Welle mit ${WELLE} Konten`);
  // 1. und 2.: bestehender Hash, falsches Passwort (eigenes Konto, nicht Teil der Welle)
  const einzel = await new Sitzung(konto(WELLE + 2)).anmelden();
  pruefe(einzel.ok, `Anmeldung mit bestehendem Passwort-Hash (${ms(einzel.ms)})`);
  const falsch = await new Sitzung(konto(WELLE + 3)).anmelden(PASSWORT + "x");
  pruefe(!falsch.ok, `falsches Passwort abgelehnt (${ms(falsch.ms)})`);

  // Beobachter: bereits angemeldet, oeffnet laufend das Dashboard.
  const beobachter = new Sitzung(konto(WELLE + 1));
  pruefe((await beobachter.anmelden()).ok, "Beobachter angemeldet");
  const ruhig: number[] = [];
  for (let i = 0; i < 5; i++) { ruhig.push((await beobachter.anfrage("/api/dashboard")).ms); await warte(200); }

  let laeuft = true;
  const dashboard: { status: number; ms: number }[] = [];
  const beobachtung = (async () => {
    while (laeuft) { const r = await beobachter.anfrage("/api/dashboard"); dashboard.push({ status: r.status, ms: r.ms }); await warte(100); }
  })();
  await warte(300);
  const start = performance.now();
  const welle = await Promise.all(Array.from({ length: WELLE }, (_, i) => new Sitzung(konto(i + 1)).anmelden()));
  const dauer = performance.now() - start;
  await warte(300);
  laeuft = false;
  await beobachtung;

  const anmeldungen = welle.map((w) => w.ms);
  const zeiten = dashboard.map((d) => d.ms);
  console.log(`\nDashboard ohne Welle: Median ${ms(quantil(ruhig, 0.5))}`);
  console.log(`Welle: ${welle.filter((w) => w.ok).length}/${WELLE} angemeldet in ${ms(dauer)}; je Anmeldung Median ${ms(quantil(anmeldungen, 0.5))}, 95 % ${ms(quantil(anmeldungen, 0.95))}, max ${ms(Math.max(...anmeldungen))}`);
  console.log(`Dashboard waehrend der Welle: ${dashboard.length} Aufrufe, Median ${ms(quantil(zeiten, 0.5))}, 95 % ${ms(quantil(zeiten, 0.95))}, max ${ms(Math.max(...zeiten))}`);
  pruefe(welle.every((w) => w.ok), `alle ${WELLE} Konten der Welle angemeldet`);
  pruefe(dashboard.length > 0 && dashboard.every((d) => d.status === 200), "Dashboard waehrend der Welle immer erreichbar (200)");
  console.log(`\nErgebnis: ${fehler ? "NICHT BESTANDEN (" + fehler + ")" : "BESTANDEN"}`);
  process.exitCode = fehler ? 1 : 0;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
