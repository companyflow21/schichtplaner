import {
  BarChart3,
  Building2,
  CalendarCheck,
  CalendarDays,
  Clock,
  House,
  MessageSquare,
  Settings,
  Users,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  key: string;
  href: string;
  label: string;
  icon: LucideIcon;
  /** Zaehlt ungelesene Nachrichten an diesem Punkt. */
  badge?: "unread";
};

export type NavGroup = { title: string; items: NavItem[] };

export function isPlanner(role?: string): boolean {
  return role === "OWNER" || role === "ADMIN" || role === "MANAGER";
}

export function isAdmin(role?: string): boolean {
  return role === "OWNER" || role === "ADMIN";
}

/**
 * Navigation nach Rolle. Bereiche, die eine Rolle nicht benutzen darf,
 * tauchen gar nicht erst auf - die Berechtigungen selbst liegen weiterhin
 * in den API-Routen.
 */
export function navGroups(role?: string): NavGroup[] {
  if (!isPlanner(role)) {
    return [
      {
        title: "Arbeit",
        items: [
          { key: "dashboard", href: "/dashboard", label: "Heute", icon: House },
          {
            key: "schedule",
            href: "/schedule/employee",
            label: "Mein Dienstplan",
            icon: CalendarDays,
          },
          { key: "time", href: "/time", label: "Zeiterfassung", icon: Clock },
        ],
      },
      {
        title: "Meine Anliegen",
        items: [
          {
            key: "requests",
            href: "/employees/absences",
            label: "Anträge",
            icon: CalendarCheck,
          },
          {
            key: "portal",
            href: "/portal/inbox",
            label: "Nachrichten",
            icon: MessageSquare,
            badge: "unread",
          },
        ],
      },
    ];
  }

  return [
    {
      title: "Arbeit",
      items: [
        { key: "dashboard", href: "/dashboard", label: "Heute", icon: House },
        {
          key: "schedule",
          href: "/schedule/flexible",
          label: "Dienstplan",
          icon: CalendarDays,
        },
      ],
    },
    {
      title: "Personal",
      items: [
        { key: "employees", href: "/employees", label: "Mitarbeiter", icon: Users },
        {
          key: "absences",
          href: "/employees/absences",
          label: "Abwesenheiten",
          icon: CalendarCheck,
        },
        { key: "time", href: "/time", label: "Zeiterfassung", icon: Clock },
      ],
    },
    {
      title: "Organisation",
      items: [
        { key: "divisions", href: "/divisions", label: "Einsatzorte", icon: Building2 },
        { key: "reporting", href: "/reporting", label: "Auswertung", icon: BarChart3 },
        {
          key: "portal",
          href: "/portal/inbox",
          label: "Nachrichten",
          icon: MessageSquare,
          badge: "unread",
        },
      ],
    },
  ];
}

/** Fuss der Seitenleiste: nur für Rollen, die Einstellungen aendern duerfen. */
export function navFooterItems(role?: string): NavItem[] {
  return isPlanner(role)
    ? [{ key: "settings", href: "/settings", label: "Einstellungen", icon: Settings }]
    : [];
}

/** Untere Navigation auf dem Handy: hoechstens vier Ziele plus "Mehr". */
export function mobileNavItems(role?: string): NavItem[] {
  const planner = isPlanner(role);
  return [
    { key: "dashboard", href: "/dashboard", label: "Heute", icon: House },
    {
      key: "schedule",
      href: planner ? "/schedule/flexible" : "/schedule/employee",
      label: "Plan",
      icon: CalendarDays,
    },
    { key: "time", href: "/time", label: "Zeit", icon: Clock },
    {
      key: "requests",
      href: "/employees/absences",
      label: "Anträge",
      icon: CalendarCheck,
    },
  ];
}

/** Ist dieser Navigationspunkt zur aktuellen Adresse aktiv? */
export function isNavActive(href: string, pathname: string): boolean {
  if (href === "/employees/absences") return pathname.startsWith(href);
  if (href === "/employees") {
    return pathname.startsWith("/employees") && !pathname.startsWith("/employees/absences");
  }
  const segment = "/" + href.split("/")[1];
  return pathname === segment || pathname.startsWith(segment + "/");
}
