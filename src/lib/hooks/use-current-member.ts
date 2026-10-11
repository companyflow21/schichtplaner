import { useQuery } from "@tanstack/react-query";
import type { AccessSummary } from "@/lib/access-shared";

export type CurrentMember = {
  id: string;
  role: "OWNER" | "ADMIN" | "MANAGER" | "EMPLOYEE";
  organizationId: string;
  organizationName: string;
  /** Namensformat der Organisation fuer den Schichtplan (siehe formatName). */
  nameFormat: string;
  user: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    profileImage: string | null;
    locale: string;
  };
  /** Aktuelle Rechte - nur fuer Navigation und Schaltflaechen, geprueft wird serverseitig. */
  access: AccessSummary;
};

/** Namensformat fuer Planansichten; undefined bis /api/me geladen ist. */
export function useNameFormat(): string | undefined {
  return useCurrentMember().data?.nameFormat;
}

export function useCurrentMember() {
  return useQuery<CurrentMember>({
    queryKey: ["current-member"],
    queryFn: async () => {
      const res = await fetch("/api/me");
      if (!res.ok) throw new Error("Failed to fetch member");
      return res.json();
    },
  });
}
