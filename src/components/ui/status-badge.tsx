import { AlertTriangle, Check, CircleX, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type StatusTon = "ok" | "hinweis" | "fehler" | "neutral";

const TON: Record<StatusTon, { klasse: string; icon: LucideIcon | null }> = {
  ok: { klasse: "border-ok/35 bg-ok/10 text-ok", icon: Check },
  hinweis: { klasse: "border-warn/40 bg-warn/10 text-warn", icon: AlertTriangle },
  fehler: { klasse: "border-destructive/35 bg-destructive/10 text-destructive", icon: CircleX },
  neutral: { klasse: "border-border bg-muted text-muted-foreground", icon: null },
};

/**
 * Status mit Farbe, Symbol und kurzem Text - Farbe traegt nie allein.
 * ok = passend oder erledigt, hinweis = braucht Aufmerksamkeit,
 * fehler = etwas ist schiefgegangen, neutral = reine Angabe.
 */
export function StatusBadge({
  ton,
  children,
  klein = false,
  icon,
  title,
  className,
}: {
  ton: StatusTon;
  children: React.ReactNode;
  /** Kompakte Form fuer Schichtkarten und Tageskoepfe. */
  klein?: boolean;
  /** Eigenes Symbol statt des Standards der Bedeutung, z. B. fuer "Entwurf". */
  icon?: LucideIcon;
  title?: string;
  className?: string;
}) {
  const { klasse, icon: standard } = TON[ton];
  const Icon = icon ?? standard;
  return (
    <span
      title={title}
      className={cn(
        "tabular inline-flex shrink-0 items-center gap-1 rounded-full border font-medium whitespace-nowrap",
        klein ? "px-1.5 py-px text-[11px] leading-4" : "px-2 py-0.5 text-[12px] leading-4",
        klasse,
        className
      )}
    >
      {Icon && <Icon aria-hidden="true" className={klein ? "size-3" : "size-3.5"} />}
      {children}
    </span>
  );
}
