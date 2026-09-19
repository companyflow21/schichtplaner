import { DivisionList } from "@/components/divisions/division-list";
import { Locations } from "@/components/workforce/locations";

export default function DivisionsPage() {
  return <div className="space-y-10"><Locations /><DivisionList /></div>;
}
