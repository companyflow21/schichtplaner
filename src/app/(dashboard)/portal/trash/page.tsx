import { MessageList } from "@/components/portal/message-list";

export const metadata = { title: "Papierkorb" };

export default function TrashPage() {
  return <MessageList folder="trash" />;
}
