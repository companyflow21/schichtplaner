// Die Seite ist eine Client-Komponente und kann keinen Titel setzen; diese Hülle liefert ihn.
export const metadata = { title: "KI-Insights & Prognose" };

export default function InsightsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
