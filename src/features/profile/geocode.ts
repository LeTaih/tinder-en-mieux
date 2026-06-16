import * as Location from 'expo-location';

// On ne garde qu'un libellé grossier (ville/sous-région/région) : jamais l'adresse précise.
export function formatPlaceLabel(place: Location.LocationGeocodedAddress | undefined | null): string | null {
  if (!place) return null;
  const label = place.city ?? place.subregion ?? place.region ?? null;
  const trimmed = label?.trim();
  return trimmed ? trimmed : null;
}

// Géocodage inverse sur l'appareil (pas d'appel serveur, pas de clé API).
// Renvoie null silencieusement en cas d'échec : le libellé reste optionnel.
export async function reverseGeocodeLabel(latitude: number, longitude: number): Promise<string | null> {
  try {
    const places = await Location.reverseGeocodeAsync({ latitude, longitude });
    return formatPlaceLabel(places[0]);
  } catch {
    return null;
  }
}
