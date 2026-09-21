"use client";

import { useCallback, useSyncExternalStore } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCurrentMember } from "@/lib/hooks/use-current-member";
import { useUnreadCount } from "@/lib/hooks/use-unread-count";
import { isNavActive, navFooterItems, navGroups } from "./nav-config";
import { UserMenu } from "./user-menu";

const SPEICHER_SCHLUESSEL = "akro:sidebar-eingeklappt";

// Kleiner Speicher ausserhalb von React: der eingeklappte Zustand gehoert
// zum Browser des Nutzers, nicht zum Server.
const zuhoerer = new Set<() => void>();

function abonnieren(cb: () => void) {
  zuhoerer.add(cb);
  return () => {
    zuhoerer.delete(cb);
  };
}

function melden() {
  zuhoerer.forEach((cb) => cb());
}

function leseZustand(): boolean {
  try {
    return window.localStorage.getItem(SPEICHER_SCHLUESSEL) === "1";
  } catch {
    // Ohne Browser-Speicher bleibt die Leiste ausgeklappt.
    return false;
  }
}

/**
 * Linke Hauptnavigation ab Tablet-Breite. Eingeklappt bleibt sie als
 * Symbolleiste bedienbar; der Zustand ueberlebt den Seitenwechsel.
 */
export function AppSidebar() {
  const pathname = usePathname();
  const { data: me } = useCurrentMember();
  const unread = useUnreadCount();
  const collapsed = useSyncExternalStore(
    abonnieren,
    leseZustand,
    () => false
  );

  const toggle = useCallback(() => {
    try {
      window.localStorage.setItem(SPEICHER_SCHLUESSEL, collapsed ? "0" : "1");
    } catch {
      // Nicht speicherbar ist kein Fehler, nur nicht gemerkt.
    }
    melden();
  }, [collapsed]);

  const groups = navGroups(me?.role);
  const footer = navFooterItems(me?.role);

  return (
    <aside
      data-collapsed={collapsed ? "true" : "false"}
      className={cn(
        "sticky top-0 hidden h-screen shrink-0 flex-col border-r bg-card md:flex",
        collapsed ? "w-[68px]" : "w-[236px]"
      )}
    >
      <div
        className={cn(
          "flex h-16 items-center border-b",
          collapsed ? "justify-center px-2" : "justify-between px-4"
        )}
      >
        <Link
          href="/dashboard"
          className="flex items-center gap-3"
          aria-label="AKRO Schichtplaner - zur Startseite"
        >
          <Image
            src="/akro/img/akro-wortmarke.svg"
            alt=""
            width={115}
            height={30}
            priority
            className={cn("w-auto", collapsed ? "h-[18px]" : "h-[22px]")}
          />
        </Link>
        {!collapsed && (
          <button
            type="button"
            onClick={toggle}
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label="Navigation einklappen"
          >
            <PanelLeftClose className="size-4" />
          </button>
        )}
      </div>

      <nav className="flex-1 overflow-y-auto px-2 py-4">
        {groups.map((group) => (
          <div key={group.title} className="mb-5 last:mb-0">
            {!collapsed && (
              <p className="mb-1.5 px-3 text-[11px] font-semibold tracking-wide text-muted-foreground">
                {group.title}
              </p>
            )}
            <ul className="space-y-0.5">
              {group.items.map((item) => {
                const Icon = item.icon;
                const active = isNavActive(item.href, pathname);
                const count = item.badge === "unread" ? unread : 0;
                return (
                  <li key={item.key}>
                    <Link
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      title={collapsed ? item.label : undefined}
                      className={cn(
                        "relative flex items-center gap-3 rounded-md px-3 py-2 text-[14px] font-medium transition-colors",
                        collapsed && "justify-center px-0",
                        active
                          ? "bg-accent text-accent-foreground"
                          : "text-foreground hover:bg-muted"
                      )}
                    >
                      <Icon
                        className={cn(
                          "size-[18px] shrink-0",
                          active ? "text-primary" : "text-muted-foreground"
                        )}
                      />
                      {!collapsed && <span className="truncate">{item.label}</span>}
                      {count > 0 && (
                        <span
                          className={cn(
                            "flex min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-semibold text-primary-foreground",
                            collapsed ? "absolute top-1 right-2 min-w-4 px-1" : "ml-auto"
                          )}
                        >
                          {count > 99 ? "99+" : count}
                          <span className="sr-only"> ungelesene Nachrichten</span>
                        </span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className={cn("border-t py-2", collapsed ? "px-1" : "px-2")}>
        {footer.map((item) => {
          const Icon = item.icon;
          const active = isNavActive(item.href, pathname);
          return (
            <Link
              key={item.key}
              href={item.href}
              aria-current={active ? "page" : undefined}
              title={collapsed ? item.label : undefined}
              className={cn(
                "mb-1 flex items-center gap-3 rounded-md px-3 py-2 text-[14px] font-medium transition-colors",
                collapsed && "justify-center px-0",
                active ? "bg-accent text-accent-foreground" : "text-foreground hover:bg-muted"
              )}
            >
              <Icon
                className={cn(
                  "size-[18px] shrink-0",
                  active ? "text-primary" : "text-muted-foreground"
                )}
              />
              {!collapsed && <span>{item.label}</span>}
            </Link>
          );
        })}

        <UserMenu collapsed={collapsed} />

        {collapsed && (
          <button
            type="button"
            onClick={toggle}
            className="mt-1 flex w-full justify-center rounded-md p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label="Navigation ausklappen"
          >
            <PanelLeftOpen className="size-4" />
          </button>
        )}
      </div>
    </aside>
  );
}
