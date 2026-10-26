// Die Seite ist eine Client-Komponente und kann keinen Titel setzen; diese Hülle liefert ihn.
export const metadata = { title: "Abwesenheiten" };

export default function AbsencesLayout({ children }: { children: React.ReactNode }) {
  return children;
}
