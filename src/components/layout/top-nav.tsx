"use client";

import Image from "next/image";
import Link from "next/link";
import { UserMenu } from "./user-menu";
import { ConnectionStatus } from "./connection-status";

/**
 * Schmale Kopfzeile fuer Handy und kleine Tablets. Ab Tablet-Breite
 * uebernimmt die Seitenleiste (AppSidebar) die Navigation.
 */
export function TopNav() {
  return (
    <header className="sticky top-0 z-30 border-b bg-card md:hidden">
      <div className="flex h-14 items-center gap-2 px-4">
        <Link
          href="/dashboard"
          className="flex shrink-0 items-center"
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

        <div className="ml-auto flex items-center gap-1">
          <ConnectionStatus />
          <UserMenu />
        </div>
      </div>
    </header>
  );
}
