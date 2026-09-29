/**
 * Browser-Push (Web-Push-Standard) fuer Mitteilungen im Postfach.
 *
 * - Inhaltsleer: Der Hinweis nennt keine Namen, Orte oder Zeiten; er laeuft
 *   ueber die Push-Dienste von Google, Apple, Mozilla bzw. Microsoft.
 * - Nach dem Speichern: Jede Benachrichtigung ist eine Postfach-Nachricht.
 *   Ein Hintergrundlauf (server.ts) arbeitet ungelesene, noch nicht
 *   gepushte Empfaengerzeilen ab. Zurueckgerollte Transaktionen erzeugen
 *   so nie einen Push.
 * - Nur an Push-Dienste: Abos anderer Adressen nimmt die API nicht an.
 */
import webpush from "web-push";
import { db } from "./db";

/** Hoechstens so alt darf eine Mitteilung sein, damit noch gepusht wird. */
const MAX_AGE_MS = 60 * 60_000;
const BATCH = 500;

/** Bekannte Push-Dienste (Endpunkte der Browser). */
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /(^|\.)push\.apple\.com$/, /^updates\.push\.services\.mozilla\.com$/, /(^|\.)notify\.windows\.com$/];

export function isPushEndpoint(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    return url.protocol === "https:" && PUSH_HOSTS.some((host) => host.test(url.hostname));
  } catch {
    return false;
  }
}

/**
 * Schluessel und Absender. Der Absender muss laut Standard eine https:- oder
 * mailto:-Adresse sein (VAPID_SUBJECT, sonst APP_URL); sonst ist Push aus.
 */
export function pushConfig(): { publicKey: string; privateKey: string; subject: string } | null {
  const publicKey = process.env.VAPID_PUBLIC_KEY, privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || process.env.APP_URL || "";
  if (!publicKey || !privateKey || !/^(https:\/\/|mailto:)/.test(subject)) return null;
  return { publicKey, privateKey, subject };
}

export function pushPayload(count: number) {
  return {
    title: "AKRO Dienstplan",
    body: count === 1 ? "Es gibt eine neue Mitteilung zu deinem Dienstplan." : `Es gibt ${count} neue Mitteilungen zu deinem Dienstplan.`,
    url: "/portal/inbox",
  };
}

type Subscription = { id: string; endpoint: string; p256dh: string; auth: string };
export type PushSender = (subscription: Subscription, payload: string) => Promise<void>;

function defaultSender(): PushSender | null {
  const config = pushConfig();
  if (!config) return null;
  webpush.setVapidDetails(config.subject, config.publicKey, config.privateKey);
  return async (s, payload) => { await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 3600 }); };
}

/**
 * Ein Durchlauf: offene Empfaengerzeilen beanspruchen (pushedAt setzen), je
 * Person einen Hinweis an alle ihre Geraete der Organisation senden.
 * Abgelaufene Abos (404/410) werden entfernt. Gibt die Zahl der Sendungen zurueck.
 */
export async function processPushOutbox(send: PushSender | null = defaultSender(), now = new Date()): Promise<number> {
  const since = new Date(now.getTime() - MAX_AGE_MS);
  // Zu alt, geloescht oder schon gelesen: ohne Push erledigen.
  await db.messageRecipient.updateMany({ where: { pushedAt: null, OR: [{ isRead: true }, { isDeleted: true }, { message: { createdAt: { lt: since } } }] }, data: { pushedAt: now } });
  const rows = await db.messageRecipient.findMany({
    where: { pushedAt: null },
    select: { messageId: true, userId: true, message: { select: { organizationId: true } } },
    take: BATCH,
  });
  if (!rows.length) return 0;
  const claimed = await db.messageRecipient.updateMany({ where: { pushedAt: null, OR: rows.map((r) => ({ messageId: r.messageId, userId: r.userId })) }, data: { pushedAt: now } });
  if (!claimed.count || !send) return 0;
  const perPerson = new Map<string, { userId: string; orgId: string; count: number }>();
  for (const r of rows) {
    const key = r.userId + "|" + r.message.organizationId;
    const entry = perPerson.get(key) ?? { userId: r.userId, orgId: r.message.organizationId, count: 0 };
    entry.count++;
    perPerson.set(key, entry);
  }
  let sent = 0;
  for (const p of perPerson.values()) {
    // Nur aktive Mitglieder und nur Geraete, die fuer diese Organisation angemeldet sind.
    const subscriptions = await db.pushSubscription.findMany({
      where: { userId: p.userId, organizationId: p.orgId, organization: { members: { some: { userId: p.userId, isActive: true } } } },
      select: { id: true, endpoint: true, p256dh: true, auth: true },
    });
    const payload = JSON.stringify(pushPayload(p.count));
    for (const s of subscriptions) {
      try {
        await send(s, payload);
        sent++;
      } catch (error) {
        const status = (error as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) await db.pushSubscription.deleteMany({ where: { id: s.id } });
        else console.error("Push fehlgeschlagen", status ?? (error as Error).message);
      }
    }
  }
  return sent;
}

/** Hintergrundlauf im eigenen Server; ohne Schluessel inaktiv. */
export function startPushLoop(intervalMs = 10_000): void {
  // Tests: API pruefen, ohne echte Push-Dienste anzusprechen.
  if (process.env.PUSH_LOOP_DISABLED === "1") return;
  let send: PushSender | null = null;
  try { send = defaultSender(); } catch (error) { console.error("Push-Einrichtung fehlgeschlagen", (error as Error).message); }
  if (!send) { console.log("> Push deaktiviert (VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY fehlen oder Absender ist keine https:/mailto:-Adresse)"); return; }
  let running = false;
  setInterval(async () => {
    if (running) return;
    running = true;
    try { await processPushOutbox(send); } catch (error) { console.error("Push-Durchlauf fehlgeschlagen", (error as Error).message); } finally { running = false; }
  }, intervalMs).unref();
  console.log("> Push aktiv");
}
