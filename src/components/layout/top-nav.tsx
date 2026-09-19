"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  CalendarDays,
  Clock,
  Users,
  Building2,
  MessageSquare,
  BarChart3,
  Settings,
  House,
  CalendarCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { UserMenu } from "./user-menu";
import { MobileNav } from "./mobile-nav";
import { ConnectionStatus } from "./connection-status";
import { useCurrentMember } from "@/lib/hooks/use-current-member";

const navItems = [
  { key: "dashboard", icon: House, href: "/dashboard", label: "Start" },
  { key: "schedule", icon: CalendarDays, href: "/schedule/flexible", label: "Dienstplan" },
  { key: "availability", icon: CalendarCheck, href: "/employees/absences", label: "Abwesenheiten" },
  { key: "time", icon: Clock, href: "/time", label: "Zeiterfassung" },
  { key: "employees", icon: Users, href: "/employees", label: "Mitarbeiter" },
  { key: "divisions", icon: Building2, href: "/divisions", label: "Einsatzorte" },
  { key: "portal", icon: MessageSquare, href: "/portal/inbox", label: "Nachrichten" },
  { key: "reporting", icon: BarChart3, href: "/reporting", label: "Auswertung" },
  { key: "settings", icon: Settings, href: "/settings", label: "Einstellungen" },
] as const;

export { navItems };
export function visibleNav(role?: string) {
  return navItems.filter(item => !["employees", "divisions", "settings"].includes(item.key) || ["OWNER", "ADMIN", "MANAGER"].includes(role || ""));
}

export function TopNav() {
  const pathname = usePathname();
  const { data: me } = useCurrentMember();

  const { data: unreadData } = useQuery<{ count: number }>({
    queryKey: ["messages", "unread-count"],
    queryFn: () => fetch("/api/messages/unread-count").then((r) => r.json()),
    refetchInterval: 30000,
  });

  const unreadCount = unreadData?.count ?? 0;

  function isActive(href: string) {
    if (href === "/employees/absences") return pathname.startsWith(href);
    if (href === "/employees") return pathname.startsWith(href) && !pathname.startsWith("/employees/absences");
    const segment = "/" + href.split("/")[1];
    return pathname.startsWith(segment);
  }

  // Graphit-Leiste als schwebendes Material: der Plan laeuft darunter
  // durch. Die aktive Seite traegt den Akzent der Marke als Unterkante -
  // Flaeche und Linie statt Kachel.
  const linkBase =
    "relative flex items-center gap-1.5 px-3 py-2 text-sm font-medium transition-colors " +
    "after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:transition-colors";
  const linkActive = "text-[var(--akro-text-hell)] after:bg-[var(--akro-akzent)]";
  const linkIdle =
    "text-[rgba(255,253,249,.66)] hover:text-[var(--akro-text-hell)] after:bg-transparent";

  return (
    <header className="akro-material akro-kante sticky top-0 z-40">
      <div className="mx-auto flex h-14 max-w-[1400px] items-center gap-2 px-4">
        {/* Mobile hamburger */}
        <MobileNav />

        {/* Die echte Wortmarke aus dem Design Starter, lokal gehostet. */}
        <Link
          href="/dashboard"
          className="mr-5 flex items-center gap-3"
          aria-label="AKRO Schichtplaner - zur Startseite"
        >
          <Image
            src="/akro/img/akro-wortmarke.svg"
            alt=""
            width={84}
            height={22}
            priority
            className="h-[18px] w-auto"
          />
          <span className="akro-label hidden text-[rgba(255,253,249,.66)] sm:inline">
            Schichtplaner
          </span>
        </Link>

        {/* Desktop nav */}
        <nav className="hidden md:flex md:items-center md:gap-1">
          {visibleNav(me?.role).map((item) => {
            const Icon = item.icon;
            const active = isActive(item.href);
            return (
              <Link
                key={item.key}
                href={item.href}
                aria-label={item.label}
                title={item.label}
                aria-current={active ? "page" : undefined}
                className={cn(linkBase, active ? linkActive : linkIdle)}
              >
                <Icon className="size-4" />
                <span className="hidden 2xl:inline">{item.label}</span>
                {item.key === "portal" && unreadCount > 0 && (
                  <span className="absolute top-0.5 right-0 flex size-4 items-center justify-center rounded-full bg-signal text-[10px] font-bold text-[#0b1626]">
                    {unreadCount > 9 ? "9+" : unreadCount}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        {/* Right side */}
        <div className="ml-auto flex items-center gap-2">
          <ConnectionStatus />
          <UserMenu />
        </div>
      </div>
    </header>
  );
}
