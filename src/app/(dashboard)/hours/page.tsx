import { HoursView } from "@/components/reporting/hours-view";

export const metadata = { title: "Stunden und Lohn" };

/** Stunden und Lohn. Was sichtbar ist, entscheidet der Server (eigene Stunden, Freigaben; Lohn nur Administration). */
export default function HoursPage() {
  return <HoursView />;
}
