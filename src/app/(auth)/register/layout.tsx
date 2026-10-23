// Die Seite ist eine Client-Komponente und kann keinen Titel setzen; diese Hülle liefert ihn.
export const metadata = { title: "Firma registrieren" };

export default function RegisterLayout({ children }: { children: React.ReactNode }) {
  return children;
}
