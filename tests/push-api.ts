/*
 * Push-Abos ueber die echte API. Der Hintergrundversand ist im Testserver
 * abgeschaltet (PUSH_LOOP_DISABLED); geprueft wird er in tests/push-outbox.ts.
 */
import type { TestContext } from "./permissions";

export async function pushApiTests(t: TestContext) {
  const { users, check } = t;
  const session = async (email: string) => { const s = new t.Session(); await s.login(email); return s; };
  const staff = await session(users.staffA.email), other = await session(users.staffB.email), anonymous = new t.Session();
  const endpoint = "https://fcm.googleapis.com/fcm/send/workflow-test";
  const keys = { p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM", auth: "tBHItJI5svbpez7KI4CCXg" };

  const info = await staff.request("/api/push");
  check(info.enabled === true && typeof info.publicKey === "string" && info.publicKey.length > 40, "push is enabled and exposes only the public key");
  await anonymous.request("/api/push", "POST", { endpoint, keys }, 307);
  await staff.request("/api/push", "POST", { endpoint: "https://example.com/push", keys }, 400);
  await staff.request("/api/push", "POST", { endpoint: "http://fcm.googleapis.com/fcm/send/x", keys }, 400);
  const devices = async (s: typeof staff) => (await s.request("/api/push")).devices;
  await staff.request("/api/push", "POST", { endpoint, keys });
  await staff.request("/api/push", "POST", { endpoint, keys });
  check(await devices(staff) === 1, "subscribing the same device twice keeps one subscription");
  await other.request("/api/push", "DELETE", { endpoint });
  check(await devices(staff) === 1, "nobody can unsubscribe someone else's device");
  // Ein Geraet wechselt die Person: das Abo gehoert danach der neuen Anmeldung.
  await other.request("/api/push", "POST", { endpoint, keys });
  check(await devices(staff) === 0 && await devices(other) === 1, "a device moves to the person signed in on it");
  await other.request("/api/push", "DELETE", { endpoint });
  check(await devices(other) === 0, "own device can be unsubscribed");
  console.log("PUSH API: " + t.counter() + " checks so far.");
}
