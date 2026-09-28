import { PortalSidebar } from "@/components/portal/portal-sidebar";

export default function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 md:flex-row md:gap-6">
      <PortalSidebar />
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}
