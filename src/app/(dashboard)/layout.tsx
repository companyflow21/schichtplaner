import { TopNav } from "@/components/layout/top-nav";
import { Toaster } from "sonner";
import { QueryProvider } from "@/components/providers/query-provider";
import { SocketProvider } from "@/components/providers/socket-provider";
import { SessionProvider } from "next-auth/react";
import { ThemeProvider } from "next-themes";
import { getCurrentMember } from "@/lib/auth-helpers";
import { redirect } from "next/navigation";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (!await getCurrentMember()) redirect("/login");
  return (
    <SessionProvider>
      <ThemeProvider attribute="class" defaultTheme="light" enableSystem>
        <QueryProvider>
          <SocketProvider>
            <div className="min-h-screen bg-background">
              <TopNav />
              <main className="mx-auto max-w-[1400px] p-4 md:p-6">
                {children}
              </main>
            </div>
            <Toaster position="top-right" />
          </SocketProvider>
        </QueryProvider>
      </ThemeProvider>
    </SessionProvider>
  );
}
