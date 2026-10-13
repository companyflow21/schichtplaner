"use client";

import { useState } from "react";
import { toast } from "sonner";
import { FileText, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { json } from "@/components/workforce/client";
import type { SiteReport, Timesheet } from "@/lib/timesheet";

const fileName = (text: string) => text.normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/ß/g, "ss").replace(/[^A-Za-z0-9_-]+/g, "_");

/** Stundenzettel einer Person als PDF (ohne userId: die eigene Person). */
export function TimesheetButton({ userId, from, to, label = "Stundenzettel (PDF)" }: { userId?: string; from: string; to: string; label?: string }) {
  const [pending, setPending] = useState(false);
  async function run() {
    setPending(true);
    try {
      const data = await json<Timesheet>("/api/timesheet?from=" + from + "&to=" + to + (userId ? "&userId=" + encodeURIComponent(userId) : ""));
      const { timesheetPdf, download } = await import("@/lib/timesheet-pdf");
      download(await timesheetPdf(data), "Stundenzettel_" + fileName(data.person.name) + "_" + from + "_" + to + ".pdf");
    } catch (e) { toast.error(e instanceof Error ? e.message : "Stundenzettel konnte nicht erstellt werden."); }
    finally { setPending(false); }
  }
  return <Button size="sm" variant="outline" disabled={pending} onClick={run}>{pending ? <Loader2 className="size-4 animate-spin" /> : <FileText className="size-4" />}{label}</Button>;
}

/** Leistungsnachweis eines Einsatzorts als PDF. */
export function SiteReportButton({ branchId, from, to }: { branchId: string; from: string; to: string }) {
  const [pending, setPending] = useState(false);
  async function run() {
    setPending(true);
    try {
      const data = await json<SiteReport>("/api/timesheet/site?standort=" + encodeURIComponent(branchId) + "&from=" + from + "&to=" + to);
      const { siteReportPdf, download } = await import("@/lib/timesheet-pdf");
      download(await siteReportPdf(data), "Leistungsnachweis_" + fileName(data.site) + "_" + from + "_" + to + ".pdf");
    } catch (e) { toast.error(e instanceof Error ? e.message : "Leistungsnachweis konnte nicht erstellt werden."); }
    finally { setPending(false); }
  }
  return <Button size="sm" variant="outline" disabled={pending} onClick={run}>{pending ? <Loader2 className="size-4 animate-spin" /> : <FileText className="size-4" />}Leistungsnachweis (PDF)</Button>;
}
