// Seuil de dérive : on ne propose de mettre à jour la position que si elle a vraiment changé.
export const LOCATION_DRIFT_THRESHOLD_KM = 25;

// Vrai si la distance entre la position actuelle et celle du profil justifie une proposition
// de mise à jour. null (pas encore de position stockée) → pas de proposition au lancement.
export function isSignificantDrift(
  driftKm: number | null,
  threshold: number = LOCATION_DRIFT_THRESHOLD_KM,
): boolean {
  return driftKm != null && driftKm >= threshold;
}
