export type Message = {
  id: string;
  match_id: string;
  sender_id: string;
  body: string | null;
  image_path: string | null;
  created_at: string;
};

const HOUR_MS = 60 * 60 * 1000;

// La RPC send_message ramène expires_at à now()+60min ; côté client on dérive
// la même valeur à partir du created_at du dernier message reçu.
export function expiresAtFromMessage(createdAtISO: string): string {
  return new Date(new Date(createdAtISO).getTime() + HOUR_MS).toISOString();
}

export function isImageMessage(message: Message): boolean {
  return message.image_path != null;
}

// Trie par created_at croissant et dédoublonne par id (écho Realtime + rendu optimiste).
export function sortAndDedupe(messages: Message[]): Message[] {
  const byId = new Map<string, Message>();
  for (const m of messages) byId.set(m.id, m);
  return [...byId.values()].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  );
}
