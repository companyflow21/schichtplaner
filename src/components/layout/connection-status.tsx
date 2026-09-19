"use client";

import { useSocketStatus } from "@/lib/socket";
import { Wifi, WifiOff } from "lucide-react";

/**
 * Zeigt nur an, wenn die Live-Verbindung fehlt. Eine stehende Verbindung ist
 * der Normalfall und braucht kein Dauerlicht in der Kopfleiste.
 */
export function ConnectionStatus() {
  const status = useSocketStatus();

  if (status === "connected") {
    return (
      <span
        className="hidden items-center text-[rgba(255,253,249,.4)] sm:flex"
        title="Live-Verbindung steht"
      >
        <Wifi className="size-3.5" />
        <span className="sr-only">Live-Verbindung steht</span>
      </span>
    );
  }

  const reconnecting = status === "reconnecting";

  return (
    <span
      className="flex items-center gap-1.5 rounded-md bg-signal/15 px-2 py-1 text-xs font-medium text-signal"
      title={
        reconnecting
          ? "Verbindung wird wiederhergestellt"
          : "Keine Live-Verbindung - Aenderungen erscheinen verzoegert"
      }
    >
      <WifiOff className="size-3.5" />
      <span className="hidden sm:inline">
        {reconnecting ? "Verbinde ..." : "Offline"}
      </span>
    </span>
  );
}
