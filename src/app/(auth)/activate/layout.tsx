// Die Seite ist eine Client-Komponente und kann keinen Titel setzen; diese Hülle liefert ihn.
export const metadata = { title: "Zugang aktivieren" };

export default function ActivateLayout({ children }: { children: React.ReactNode }) {
  return children;
}
