import { redirect } from "next/navigation";

/** Frueherer Pfad der Lohnseite; heute Teil von "Stunden und Lohn". */
export default function PayrollPage() {
  redirect("/hours");
}
