export type PushData = { type?: 'message' | 'match' | 'expiring'; matchId?: string };

// Les 3 types de notif mènent au chat du match concerné.
export function routeForNotification(data: PushData | undefined): string | null {
  if (!data || !data.matchId) return null;
  if (data.type === 'message' || data.type === 'match' || data.type === 'expiring') {
    return `/match/${data.matchId}`;
  }
  return null;
}
