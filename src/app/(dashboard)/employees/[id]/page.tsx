import { EmployeeDetail } from "@/components/employees/employee-detail";

export const metadata = { title: "Mitarbeiter" };

export default async function EmployeeDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <EmployeeDetail memberId={id} />;
}
