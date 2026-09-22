"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { LayoutGrid, User, CalendarDays } from "lucide-react";
import { cn } from "@/lib/utils";

interface ViewSwitcherProps {
  /** Current KW string like "09-2026" or null for month view */
  kw?: string;
  /** Current month string like "03-2026" or null for KW views */
  month?: string;
}

const views: {
  key: string;
  label: string;
  icon: typeof LayoutGrid;
  getHref: (kw: string, month: string) => string;
}[] = [
  {
    key: "flexible",
    label: "Planung",
    icon: LayoutGrid,
    getHref: (kw: string, _month: string) => `/schedule/flexible/${kw}`,
  },
  {
    key: "employee",
    label: "Mitarbeiter",
    icon: User,
    getHref: (kw: string, _month: string) => `/schedule/employee/${kw}`,
  },
  {
    key: "month",
    label: "Monat",
    icon: CalendarDays,
    getHref: (_kw: string, month: string) => `/schedule/month/${month}`,
  },
];

/**
 * Derive month string "MM-YYYY" from a KW string "WW-YYYY".
 * Uses the Thursday of the ISO week to determine the month.
 */
function kwToMonth(kw: string): string {
  const match = kw.match(/^(\d{1,2})-(\d{4})$/);
  if (!match) {
    const now = new Date();
    return `${String(now.getMonth() + 1).padStart(2, "0")}-${now.getFullYear()}`;
  }
  const weekNumber = parseInt(match[1], 10);
  const year = parseInt(match[2], 10);
  // Jan 4 is always in ISO week 1
  const jan4 = new Date(year, 0, 4);
  const dayOfWeek = jan4.getDay() || 7;
  const startOfWeek1 = new Date(jan4);
  startOfWeek1.setDate(jan4.getDate() - dayOfWeek + 1);
  // Thursday of target week
  const thursday = new Date(startOfWeek1);
  thursday.setDate(startOfWeek1.getDate() + (weekNumber - 1) * 7 + 3);
  return `${String(thursday.getMonth() + 1).padStart(2, "0")}-${thursday.getFullYear()}`;
}

export function ViewSwitcher({ kw, month }: ViewSwitcherProps) {
  const pathname = usePathname();

  // Determine the effective KW and month for link generation
  const effectiveKW = kw ?? "01-2026";
  const effectiveMonth = month ?? kwToMonth(effectiveKW);

  // Determine active view from current pathname
  const activeView = pathname.includes("/schedule/employee")
      ? "employee"
      : pathname.includes("/schedule/month")
        ? "month"
        : "flexible";

  return (
    // Segmentschalter: eine Kante, innen nur Haarlinien.
    <div
      role="group"
      aria-label="Ansicht"
      className="flex items-center overflow-hidden rounded-[var(--radius)] border bg-card"
    >
      {views.map((view) => {
        const isActive = activeView === view.key;
        const Icon = view.icon;
        const href = view.getHref(effectiveKW, effectiveMonth);

        return (
          <Link
            key={view.key}
            href={href}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "flex h-8 items-center gap-1.5 border-l px-3 text-[13px] font-medium transition-colors first:border-l-0",
              isActive
                ? "bg-[var(--flaeche-vertieft)] text-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
          >
            <Icon className="size-3.5" />
            <span className="hidden sm:inline">{view.label}</span>
          </Link>
        );
      })}
    </div>
  );
}
