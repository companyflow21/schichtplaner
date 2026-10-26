// Die Seite ist eine Client-Komponente und kann keinen Titel setzen; diese Hülle liefert ihn.
export const metadata = { title: "Einstellungen" };

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
