// Die Seite ist eine Client-Komponente und kann keinen Titel setzen; diese Hülle liefert ihn.
export const metadata = { title: "Nachrichten" };

export default function InboxLayout({ children }: { children: React.ReactNode }) {
  return children;
}
