export function isExpired(expiresAtISO: string, now: Date): boolean {
  return new Date(expiresAtISO).getTime() <= now.getTime();
}

export function formatCountdown(expiresAtISO: string, now: Date): string {
  const ms = new Date(expiresAtISO).getTime() - now.getTime();
  if (ms <= 0) return 'Expiré';
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}
