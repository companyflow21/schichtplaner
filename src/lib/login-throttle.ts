/**
 * Schutz gegen Passwort-Raten (Brute Force) beim Login.
 *
 * Pro E-Mail-Adresse sind 5 Fehlversuche in 15 Minuten erlaubt. Danach ist
 * die Anmeldung fuer diese Adresse 15 Minuten gesperrt, auch mit richtigem
 * Passwort. Ein erfolgreicher Login setzt den Zaehler zurueck.
 *
 * Bewusst im Arbeitsspeicher: Beim Neustart der App ist alles zurueckgesetzt.
 * Das reicht fuer eine selbst gehostete Installation mit einem App-Container.
 */

const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60_000; // 15 Minuten
const MAX_TRACKED_EMAILS = 10_000;
const CLEANUP_INTERVAL_MS = 60_000;

/** E-Mail (klein geschrieben) -> Zeitpunkte der Fehlversuche (epoch ms). */
const failures = new Map<string, number[]>();
let lastCleanupAt = 0;

function cleanupExpired(now: number): void {
  if (now - lastCleanupAt < CLEANUP_INTERVAL_MS) return;
  const cutoff = now - WINDOW_MS;
  for (const [key, attempts] of failures) {
    if (attempts.every((time) => time <= cutoff)) failures.delete(key);
  }
  lastCleanupAt = now;
}

function remember(key: string, attempts: number[]): void {
  // Keep insertion order as a simple oldest-first eviction policy.
  failures.delete(key);
  failures.set(key, attempts);
  while (failures.size > MAX_TRACKED_EMAILS) {
    const oldest = failures.keys().next().value;
    if (oldest === undefined) break;
    failures.delete(oldest);
  }
}

function recentFailures(key: string, now: number): number[] {
  cleanupExpired(now);
  const cutoff = now - WINDOW_MS;
  const pruned = (failures.get(key) ?? []).filter((t) => t > cutoff);
  if (pruned.length > 0) {
    remember(key, pruned);
  } else {
    failures.delete(key);
  }
  return pruned;
}

/** true, wenn fuer diese Adresse aktuell zu viele Fehlversuche vorliegen. */
export function isLoginBlocked(email: string): boolean {
  const key = email.toLowerCase();
  return recentFailures(key, Date.now()).length >= MAX_ATTEMPTS;
}

/** Fehlversuch merken. */
export function recordLoginFailure(email: string): void {
  const key = email.toLowerCase();
  const now = Date.now();
  const attempts = recentFailures(key, now);
  // Concurrent requests may all have passed isLoginBlocked before recording.
  // Keep only the threshold timestamps so these races cannot grow an array or
  // extend the existing lockout window.
  if (attempts.length < MAX_ATTEMPTS) attempts.push(now);
  remember(key, attempts);
}

/** Nach erfolgreicher Anmeldung den Zaehler leeren. */
export function clearLoginFailures(email: string): void {
  failures.delete(email.toLowerCase());
}
