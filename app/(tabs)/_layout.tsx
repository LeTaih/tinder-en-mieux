import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../src/lib/theme';
import { useSession } from '../../src/features/auth/session-provider';
import { useLocationCheck } from '../../src/features/profile/use-location-check';

export default function TabsLayout() {
  const { session } = useSession();
  useLocationCheck(session?.user.id);

  return (
    <Tabs screenOptions={{ tabBarActiveTintColor: Colors.primary }}>
      <Tabs.Screen
        name="index"
        options={{ title: 'Deck', tabBarIcon: ({ color, size }) => <Ionicons name="flame" color={color} size={size} /> }}
      />
      <Tabs.Screen
        name="matches"
        options={{ title: 'Matchs', tabBarIcon: ({ color, size }) => <Ionicons name="chatbubbles" color={color} size={size} /> }}
      />
      <Tabs.Screen
        name="profile"
        options={{ title: 'Profil', tabBarIcon: ({ color, size }) => <Ionicons name="person" color={color} size={size} /> }}
      />
    </Tabs>
  );
}
