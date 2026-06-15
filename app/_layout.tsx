import { QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SessionProvider, useSession } from '../src/features/auth/session-provider';
import { useProfileCompleteness } from '../src/features/profile/use-profile';
import { usePushNotifications } from '../src/features/notifications/use-push';
import { queryClient } from '../src/lib/query-client';

function RootNavigator() {
  const { session, loading } = useSession();
  const userId = session?.user.id;
  const { complete, isLoading: profileLoading } = useProfileCompleteness(userId);
  usePushNotifications(userId);

  if (loading || (!!session && profileLoading)) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={!!session && complete === true}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="match/[id]" />
      </Stack.Protected>
      <Stack.Protected guard={!!session && complete !== true}>
        <Stack.Screen name="(onboarding)" />
      </Stack.Protected>
      <Stack.Protected guard={!session}>
        <Stack.Screen name="(auth)" />
      </Stack.Protected>
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <SessionProvider>
            <StatusBar style="dark" />
            <RootNavigator />
          </SessionProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
