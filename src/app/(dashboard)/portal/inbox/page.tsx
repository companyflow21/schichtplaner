"use client";

import { useSearchParams } from "next/navigation";
import { MessageList } from "@/components/portal/message-list";
import { MessageDetail } from "@/components/portal/message-detail";
import { Suspense, useState } from "react";
import { ComposeMessage } from "@/components/portal/compose-message";
import { Button } from "@/components/ui/button";

function InboxContent() {
  const searchParams = useSearchParams();
  const messageId = searchParams.get("id");
  const shiftId = searchParams.get("shiftId");
  const branchId = searchParams.get("branchId");
  const [compose, setCompose] = useState(!!shiftId || !!branchId);

  if (messageId) {
    return <MessageDetail />;
  }

  return <div className="flex-1">{(shiftId || branchId) && <><Button className="mb-4" onClick={() => setCompose(true)}>{shiftId ? "Nachricht zur Schicht verfassen" : "Nachricht zum Standort verfassen"}</Button><ComposeMessage open={compose} onOpenChange={setCompose} shiftId={shiftId ?? undefined} branchId={branchId ?? undefined} defaultSubject={shiftId ? "Nachricht zu deiner Schicht" : "Nachricht zum Standort"} /></>}<MessageList folder="inbox" /></div>;
}

export default function InboxPage() {
  return (
    <Suspense fallback={<div className="h-32 animate-pulse rounded bg-muted" />}>
      <InboxContent />
    </Suspense>
  );
}
