"use client";

import { useSyncExternalStore } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell } from "lucide-react";
import { useCurrentMember } from "@/lib/hooks/use-current-member";
import { useUnreadCount } from "@/lib/hooks/use-unread-count";
import { seitenTitel } from "./nav-config";
import { UserMenu } from "./user-menu";
import { ConnectionStatus } from "./connection-status";

/** Weckt die Kopfschiene einmal pro Minute; kein Zustand in Effekten. */
function abonniereMinute(melden: () => void) {
  const id = window.setInterval(melden, 20_000);
  return () => window.clearInterval(id);
}

function minutenStempel(): string {
  const jetzt = new Date();
  return `${jetzt.getFullYear()}-${jetzt.getMonth()}-${jetzt.getDate()}-${jetzt.getHours()}-${jetzt.getMinutes()}`;
}

const datumsFormat = new Intl.DateTimeFormat("de-DE", {
  weekday: "short",
  day: "2-digit",
  month: "2-digit",
});

const zeitFormat = new Intl.DateTimeFormat("de-DE", {
  hour: "2-digit",
  minute: "2-digit",
});

/** Datum und Uhrzeit der Leitstelle. Vor dem ersten Rendern leer. */
function Dienstzeit() {
  const stempel = useSyncExternalStore(
    abonniereMinute,
    minutenStempel,
    () => ""
  );
  if (!stempel) return <span className="w-[8.5rem]" aria-hidden="true" />;

  const jetzt = new Date();
  return (
    <span className="tabular text-[13px] text-muted-foreground">
      {datumsFormat.format(jetzt)}
      <span className="px-1.5 text-border" aria-hidden="true">
        |
      </span>
      <span className="font-medium text-foreground">
        {zeitFormat.format(jetzt)}
      </span>
    </span>
  );
}

/**
 * Glocke rechts in der Kopfschiene: fuehrt in den Posteingang, wo alle
 * Benachrichtigungen liegen, und zeigt die ungelesenen an.
 */
function Glocke() {
  const unread = useUnreadCount();
  return (
    <Link
      href="/portal/inbox"
      aria-label={`Posteingang, ${unread} ungelesen`}
      className="relative flex size-11 shrink-0 items-center justify-center rounded-[var(--radius)] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      <Bell className="size-5" />
      {unread > 0 && (
        <span
          aria-hidden="true"
          className="akro-kennzahl absolute top-1 right-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-primary px-1 text-[12px] text-primary-foreground"
        >
          {unread > 99 ? "99+" : unread}
        </span>
      )}
    </Link>
  );
}

/**
 * Kopfschiene der Arbeitsoberflaeche. Auf dem Handy traegt sie die
 * Wortmarke, ab Tablet den Namen des aktuellen Bereichs - die
 * Navigation selbst steht dann links in der Seitenleiste.
 */
export function TopNav() {
  const pathname = usePathname();
  const { data: me } = useCurrentMember();
  const titel = seitenTitel(pathname, me);

  return (
    <header className="sticky top-0 z-30 border-b bg-card">
      {/* Markenlinie: das einzige Farbelement der Kopfschiene. */}
      <div className="akro-markenlinie h-[2px]" aria-hidden="true" />

      <div className="flex h-[72px] items-center gap-3 px-4 md:px-6 lg:px-8">
        <Link
          href="/dashboard"
          className="flex min-h-11 shrink-0 items-center md:hidden"
          aria-label="AKRO Schichtplaner - zur Startseite"
        >
          <Image
            src="/akro/img/akro-wortmarke.svg"
            alt=""
            width={115}
            height={30}
            priority
            className="h-[20px] w-auto"
          />
        </Link>

        <h2 className="hidden min-w-0 truncate text-[22px] leading-none font-semibold tracking-[-0.02em] md:block">
          {titel}
        </h2>

        <div className="ml-auto flex items-center gap-3">
          <span className="hidden md:block">
            <Dienstzeit />
          </span>
          <ConnectionStatus />
          <Glocke />
          <span className="md:hidden">
            <UserMenu collapsed />
          </span>
        </div>
      </div>
    </header>
  );
}
