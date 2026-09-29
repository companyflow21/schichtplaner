import { z } from "zod";
import { api, body, ApiError } from "@/lib/api";
import { db } from "@/lib/db";
import { requireAccess } from "@/lib/access";
import { isPushEndpoint, pushConfig } from "@/lib/push";

/** Hoechstens so viele Geraete je Person; das aelteste faellt weg. */
const MAX_DEVICES = 10;

/** Ob Push auf dem Server eingerichtet ist, samt oeffentlichem Schluessel und Zahl eigener Geraete. */
export async function GET() {
  return api(async () => {
    const a = await requireAccess();
    const config = pushConfig();
    const devices = await db.pushSubscription.count({ where: { userId: a.userId, organizationId: a.orgId } });
    return { enabled: !!config, publicKey: config?.publicKey ?? null, devices };
  });
}

const subscription = z.object({
  endpoint: z.string().max(1000).refine(isPushEndpoint, "Unbekannter Push-Dienst."),
  keys: z.object({ p256dh: z.string().min(1).max(200), auth: z.string().min(1).max(100) }),
});

/** Dieses Geraet fuer die angemeldete Person anmelden (oder uebernehmen). */
export async function POST(request: Request) {
  return api(async () => {
    const a = await requireAccess();
    if (!pushConfig()) throw new ApiError("Push ist auf dem Server nicht eingerichtet.", 409);
    const data = await body(request, subscription);
    const fields = { organizationId: a.orgId, userId: a.userId, p256dh: data.keys.p256dh, auth: data.keys.auth };
    await db.pushSubscription.upsert({ where: { endpoint: data.endpoint }, create: { endpoint: data.endpoint, ...fields }, update: fields });
    const devices = await db.pushSubscription.findMany({ where: { userId: a.userId }, orderBy: { updatedAt: "desc" }, select: { id: true } });
    if (devices.length > MAX_DEVICES) await db.pushSubscription.deleteMany({ where: { id: { in: devices.slice(MAX_DEVICES).map((d) => d.id) } } });
    return { subscribed: true };
  });
}

/** Dieses Geraet abmelden - nur eigene Abos. */
export async function DELETE(request: Request) {
  return api(async () => {
    const a = await requireAccess();
    const data = await body(request, z.object({ endpoint: z.string().max(1000) }));
    await db.pushSubscription.deleteMany({ where: { endpoint: data.endpoint, userId: a.userId } });
    return { subscribed: false };
  });
}
