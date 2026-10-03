import assert from "node:assert/strict";
import { messageRequest, updateMessages } from "../src/components/portal/message-requests";

async function main() {
  const originalFetch = globalThis.fetch;
  try {
    for (const status of [401, 403, 500]) {
      globalThis.fetch = async () => new Response('{"error":"Fehler"}', { status });
      await assert.rejects(messageRequest("/api/messages?folder=inbox"));
    }
    globalThis.fetch = async () => new Response('{"messages":[]}', { status: 200 });
    assert.deepEqual(await (await messageRequest("/api/messages?folder=inbox")).json(), { messages: [] });

    for (const method of ["PATCH", "DELETE"]) {
      const calls: string[] = [];
      globalThis.fetch = async (url, init) => {
        assert.equal(init?.method, method);
        calls.push(String(url));
        if (String(url).endsWith("/network")) throw new Error("offline");
        return new Response(null, { status: String(url).endsWith("/denied") ? 403 : 204 });
      };
      assert.deepEqual(
        await updateMessages(["ok", "denied", "network"], { method }),
        ["denied", "network"]
      );
      assert.equal(calls.length, 3);
      assert.deepEqual(await updateMessages(["ok"], { method }), []);
    }

    // Ein schneller Fehler darf die Sammelaktion nicht vor dem späteren Erfolg beenden.
    let completeSlow: (response: Response) => void = () => {};
    let settled = false;
    globalThis.fetch = async (url) => {
      if (String(url).endsWith("/slow")) {
        return new Promise<Response>((resolve) => { completeSlow = resolve; });
      }
      throw new Error("offline");
    };
    const batch = updateMessages(["failed", "slow"], { method: "PATCH" })
      .then((failedIds) => { settled = true; return failedIds; });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(settled, false);
    completeSlow(new Response(null, { status: 204 }));
    assert.deepEqual(await batch, ["failed"]);
    console.log("PASS: Postfach HTTP-Fehler, erfolgreiche Antworten, PATCH/DELETE-Teil-Erfolge und spätes Sammelergebnis");
  } finally {
    globalThis.fetch = originalFetch;
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });