export async function messageRequest(url: string, init?: RequestInit) {
  const response = await fetch(url, init);
  if (!response.ok) throw new Error("Nachrichtenanfrage fehlgeschlagen");
  return response;
}

export async function updateMessages(ids: string[], init: RequestInit) {
  const results = await Promise.allSettled(
    ids.map((id) => messageRequest(`/api/messages/${id}`, init))
  );
  return ids.filter((_, index) => results[index].status === "rejected");
}