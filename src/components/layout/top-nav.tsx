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

  // Kopfleiste nach Designsystem: helle Flaeche, Wortmarke links,
  // Navigation in 14px/500, aktive Seite in AKRO-Blau mit Unterkante.
  // Linien strukturieren - keine Kacheln, kein Glas, keine Schatten.
  const linkBase =
    "relative flex items-center gap-1.5 px-3 py-2 text-[14px] font-medium transition-colors " +
    "after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:transition-colors";
  const linkActive = "text-[var(--brand)] after:bg-[var(--brand)]";
  const linkIdle =
    "text-foreground hover:text-[var(--brand)] after:bg-transparent";

  return (
    <header className="sticky top-0 z-40 border-b bg-background">
      <div className="mx-auto flex h-16 max-w-[1344px] items-center gap-2 px-4 md:px-8">
        {/* Mobile hamburger */}
        <MobileNav />

        {/* Die echte Wortmarke aus dem Design Starter, lokal gehostet. */}
        <Link
          href="/dashboard"
          className="mr-5 flex shrink-0 items-center gap-3"
          aria-label="AKRO Schichtplaner - zur Startseite"
        >
          <Image
            src="/akro/img/akro-wortmarke.svg"
            alt=""
            width={115}
            height={30}
            priority
            className="h-[22px] w-auto"
          />
          {/* Senkrechte Linie wie in der Kopfzeile des Designsystems. */}
          <span className="hidden border-l pl-5 text-[14px] whitespace-nowrap text-muted-foreground lg:inline">
            Schichtplaner
          </span>
        </Link>

        {/* Desktop nav */}
        <nav className="hidden min-w-0 overflow-x-auto md:flex md:items-center md:gap-1">
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
                className={cn(linkBase, "shrink-0 whitespace-nowrap", active ? linkActive : linkIdle)}
              >
                <Icon className="size-4" />
                <span className="hidden 2xl:inline">{item.label}</span>
                {item.key === "portal" && unreadCount > 0 && (
                  <span className="absolute top-0.5 right-0 flex size-4 items-center justify-center rounded-full bg-[var(--brand)] text-[10px] font-bold text-white">
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
