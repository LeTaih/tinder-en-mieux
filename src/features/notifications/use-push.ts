import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { useRouter, type Href } from 'expo-router';
import { clearBadge, registerPushToken } from './push-api';
import { routeForNotification, type PushData } from './notification-format';

// Affiche aussi les notifs quand l'app est au premier plan.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

export function usePushNotifications(userId: string | undefined) {
  const router = useRouter();

  // Enregistrement du token (permission + device physique).
  useEffect(() => {
    if (!userId || !Device.isDevice) return;
    let cancelled = false;
    (async () => {
      const existing = await Notifications.getPermissionsAsync();
      let status = existing.status;
      if (status !== 'granted') {
        status = (await Notifications.requestPermissionsAsync()).status;
      }
      if (status !== 'granted' || cancelled) return;
      const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
      if (!projectId) return;
      const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
      if (!cancelled) await registerPushToken(token, Platform.OS);
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  // Deep-link au tap (app au premier plan, en arrière-plan, ou tuée).
  useEffect(() => {
    function open(data: PushData | undefined) {
      const route = routeForNotification(data);
      if (route) router.push(route as Href);
    }
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      open(response.notification.request.content.data as PushData);
    });
    Notifications.getLastNotificationResponseAsync().then((response) => {
      if (response) open(response.notification.request.content.data as PushData);
    });
    return () => sub.remove();
  }, [router]);

  // Remise à zéro du badge à l'ouverture / retour au premier plan.
  useEffect(() => {
    if (!userId) return;
    function reset() {
      // Cosmétique : un échec ne doit ni crasher ni émettre d'unhandled-rejection.
      clearBadge().catch(() => {});
      Notifications.setBadgeCountAsync(0).catch(() => {});
    }
    reset();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') reset();
    });
    return () => sub.remove();
  }, [userId]);
}
