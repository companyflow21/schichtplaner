"use client";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Bell } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { json } from "./client";

type State = "laden" | "nicht-unterstuetzt" | "iphone-installieren" | "blockiert" | "aus" | "an";

function urlBase64ToUint8Array(value: string) {
  const base64 = (value + "=".repeat((4 - (value.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}

async function sendSubscription(subscription: PushSubscription, method: "POST" | "DELETE") {
  const data = method === "POST" ? subscription.toJSON() : { endpoint: subscription.endpoint };
  await json("/api/push", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
}

/**
 * Benachrichtigungen fuer dieses Geraet ein- und ausschalten. Der Browser
 * fragt erst beim Klick; auf dem iPhone geht Push nur aus der installierten
 * App (Teilen -> Zum Home-Bildschirm).
 */
export function PushSetup() {
  const server = useQuery({ queryKey: ["push"], queryFn: () => json<{ enabled: boolean; publicKey: string | null }>("/api/push") });
  const [state, setState] = useState<State>("laden");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!server.data?.enabled) return;
    let cancelled = false;
    (async () => {
      const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
      const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
      let next: State;
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) next = ios && !standalone ? "iphone-installieren" : "nicht-unterstuetzt";
      else if (Notification.permission === "denied") next = "blockiert";
      else {
        const registration = await navigator.serviceWorker.getRegistration("/");
        const subscription = await registration?.pushManager.getSubscription();
        // Bestehendes Abo der angemeldeten Person zuordnen (Geraetewechsel, neue Anmeldung).
        if (subscription) await sendSubscription(subscription, "POST").catch(() => undefined);
        next = subscription ? "an" : "aus";
      }
      if (!cancelled) setState(next);
    })();
    return () => { cancelled = true; };
  }, [server.data?.enabled]);

  async function einschalten() {
    setBusy(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") { setState(permission === "denied" ? "blockiert" : "aus"); return; }
      const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(server.data!.publicKey!) });
      await sendSubscription(subscription, "POST");
      setState("an");
      toast.success("Benachrichtigungen aktiviert");
    } catch (error) {
      toast.error((error as Error).message || "Benachrichtigungen konnten nicht aktiviert werden.");
    } finally { setBusy(false); }
  }

  async function ausschalten() {
    setBusy(true);
    try {
      const subscription = await (await navigator.serviceWorker.getRegistration("/"))?.pushManager.getSubscription();
      if (subscription) { await sendSubscription(subscription, "DELETE"); await subscription.unsubscribe(); }
      setState("aus");
      toast.success("Benachrichtigungen auf diesem Gerät ausgeschaltet");
    } catch (error) {
      toast.error((error as Error).message);
    } finally { setBusy(false); }
  }

  if (!server.data?.enabled || state === "laden") return null;
  const text: Record<Exclude<State, "laden">, string> = {
    "an": "Benachrichtigungen sind auf diesem Gerät aktiv.",
    "aus": "Erhalte eine Benachrichtigung, wenn sich dein Dienstplan ändert – auch wenn die App geschlossen ist. Sie enthält keine Details; die stehen in der App.",
    "blockiert": "Benachrichtigungen sind für diese Seite blockiert. Du kannst sie in den Browser- oder Handy-Einstellungen wieder erlauben.",
    "iphone-installieren": "Auf dem iPhone: In Safari auf „Teilen“ und „Zum Home-Bildschirm“ tippen, die App von dort öffnen und hier Benachrichtigungen aktivieren.",
    "nicht-unterstuetzt": "Dieser Browser unterstützt keine Benachrichtigungen.",
  };
  return (
    <section className="akro-panel flex flex-wrap items-center gap-3 px-4 py-3" aria-label="Benachrichtigungen">
      <Bell className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <p className="min-w-0 flex-1 text-[14px] text-muted-foreground">{text[state]}</p>
      {state === "aus" && <Button size="sm" disabled={busy} onClick={einschalten}>Benachrichtigungen aktivieren</Button>}
      {state === "an" && <Button size="sm" variant="ghost" disabled={busy} onClick={ausschalten}>Ausschalten</Button>}
    </section>
  );
}
