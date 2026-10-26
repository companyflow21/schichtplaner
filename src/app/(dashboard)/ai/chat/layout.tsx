// Die Seite ist eine Client-Komponente und kann keinen Titel setzen; diese Hülle liefert ihn.
export const metadata = { title: "KI-Assistent" };

export default function ChatLayout({ children }: { children: React.ReactNode }) {
  return children;
}
