import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert } from 'react-native';
import * as Location from 'expo-location';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { locationDriftKm, setMyLocation } from './profile-api';
import { reverseGeocodeLabel } from './geocode';
import { isSignificantDrift } from './location-check';

// Récupère la position courante, géocode la ville et l'enregistre côté serveur, puis invalide
// les caches dépendants. Partagé entre le contrôle au lancement et le bouton manuel.
async function applyCurrentLocation(userId: string, queryClient: QueryClient): Promise<void> {
  const pos = await Location.getCurrentPositionAsync({});
  const { longitude, latitude } = pos.coords;
  const label = await reverseGeocodeLabel(latitude, longitude);
  await setMyLocation(longitude, latitude, label);
  await queryClient.invalidateQueries({ queryKey: ['my-profile', userId] });
  await queryClient.invalidateQueries({ queryKey: ['deck'] });
}

// Contrôle au lancement (une fois par session) : si la position actuelle s'écarte beaucoup
// de celle enregistrée sur le profil, on propose de la mettre à jour. Silencieux si la
// permission n'a pas déjà été accordée (on n'interrompt pas l'utilisateur avec une demande
// de permission au démarrage) ou si aucune position n'est encore stockée.
export function useLocationCheck(userId: string | undefined) {
  const queryClient = useQueryClient();
  const ranForUser = useRef<string | null>(null);

  useEffect(() => {
    if (!userId) return;
    if (ranForUser.current === userId) return;
    ranForUser.current = userId;

    let cancelled = false;
    (async () => {
      try {
        const perm = await Location.getForegroundPermissionsAsync();
        if (!perm.granted) return;

        const pos = await Location.getCurrentPositionAsync({});
        const drift = await locationDriftKm(pos.coords.longitude, pos.coords.latitude);
        if (cancelled || !isSignificantDrift(drift)) return;

        Alert.alert(
          'Mettre à jour ta position ?',
          `Tu sembles être à environ ${drift} km de la position enregistrée sur ton profil. La mettre à jour pour voir les profils proches d'ici ?`,
          [
            { text: 'Garder', style: 'cancel' },
            {
              text: 'Mettre à jour',
              onPress: () => {
                applyCurrentLocation(userId, queryClient).catch(() => {
                  // Échec silencieux : on retentera au prochain lancement.
                });
              },
            },
          ],
        );
      } catch {
        // Position indisponible / erreur réseau : on ignore, on retentera au prochain lancement.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [userId, queryClient]);
}

// Mise à jour manuelle de la position (action explicite : on peut demander la permission ici).
export function useUpdateMyLocation(userId: string | undefined) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);

  const update = useCallback(async () => {
    if (!userId || busy) return;
    setBusy(true);
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Localisation', 'Permission refusée. Active la localisation pour mettre à jour ta position.');
        return;
      }
      await applyCurrentLocation(userId, queryClient);
      Alert.alert('Position mise à jour', 'Ta position a bien été actualisée.');
    } catch {
      Alert.alert('Localisation', "Impossible de récupérer ta position. Réessaie dans un instant.");
    } finally {
      setBusy(false);
    }
  }, [userId, busy, queryClient]);

  return { update, busy };
}
