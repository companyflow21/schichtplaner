import { Subcontractors } from "@/components/workforce/subcontractors";
import { redirect } from "next/navigation";
import { requireAccess } from "@/lib/access";

export const metadata = { title: "Subunternehmer" };

export default async function SubcontractorsPage() {
  const access = await requireAccess();
  if (!access.isAdmin) redirect("/dashboard");
  return <Subcontractors />;
}
