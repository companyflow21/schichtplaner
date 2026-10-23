import { MessageList } from "@/components/portal/message-list";

export const metadata = { title: "Gesendete Nachrichten" };

export default function SentPage() {
  return <MessageList folder="sent" />;
}
