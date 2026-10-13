"use client";

import { Loader2, ShieldAlert } from "lucide-react";
import { PayrollView } from "@/components/reporting/payroll-view";
import { useCurrentMember } from "@/lib/hooks/use-current-member";

/** Lohn - nur fuer die Administration (der Server prueft das ebenfalls). */
export default function PayrollPage() {
  const { data: me, isLoading } = useCurrentMember();
  if (isLoading) return <div className="flex justify-center py-20"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>;
  if (me?.role !== "OWNER" && me?.role !== "ADMIN") {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-20">
        <ShieldAlert className="size-12 text-muted-foreground/50" />
        <h2 className="text-xl font-semibold">Zugriff verweigert</h2>
        <p className="text-sm text-muted-foreground">Lohndaten sieht nur die Administration.</p>
      </div>
    );
  }
  return <PayrollView />;
}
