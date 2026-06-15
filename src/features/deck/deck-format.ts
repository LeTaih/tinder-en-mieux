export function formatDistance(km: number): string {
  if (km <= 0) return 'à moins de 1 km';
  return `à ${km} km`;
}

export function formatAge(age: number): string {
  return `${age} ans`;
}

export function clampRemaining(n: number): number {
  return Math.max(n, 0);
}
