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
    <div className="flex items-center gap-1 rounded-lg border bg-muted/30 p-1">
      {views.map((view) => {
        const isActive = activeView === view.key;
        const Icon = view.icon;
        const href =
          view.key === "month"
            ? view.getHref(effectiveKW, effectiveMonth)
            : view.getHref(effectiveKW, effectiveMonth);

        return (
          <Link
            key={view.key}
            href={href}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-all",
              isActive
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground hover:bg-background/50"
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
