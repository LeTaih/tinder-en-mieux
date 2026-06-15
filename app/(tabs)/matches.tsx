import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useMatches } from '../../src/features/matches/use-matches';
import { formatCountdown, isExpired } from '../../src/features/matches/countdown';
import type { Match } from '../../src/features/matches/matches-api';

function MatchRow({ match, now }: { match: Match; now: Date }) {
  const expired = isExpired(match.expires_at, now);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, opacity: expired ? 0.5 : 1 }}>
      {match.photo ? (
        <Image source={{ uri: match.photo }} style={{ width: 56, height: 56, borderRadius: 28 }} />
      ) : (
        <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: '#ddd' }} />
      )}
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 16, fontWeight: '600' }}>{match.display_name}</Text>
        <Text style={{ color: expired ? '#999' : '#208AEF' }}>
          {expired ? 'Expiré' : `⏳ ${formatCountdown(match.expires_at, now)}`}
        </Text>
      </View>
    </View>
  );
}

export default function Matches() {
  const { data: matches, isLoading } = useMatches();
  const [now, setNow] = useState(() => new Date());
  const router = useRouter();

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  if (isLoading) {
    return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator /></View>;
  }

  const all = matches ?? [];
  const actifs = all.filter((m) => !isExpired(m.expires_at, now));
  const expires = all.filter((m) => isExpired(m.expires_at, now));

  if (all.length === 0) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <Text style={{ textAlign: 'center' }}>Pas encore de match. Va swiper !</Text>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={{ padding: 16 }}>
      <Text style={{ fontSize: 18, fontWeight: '800', marginBottom: 8 }}>Actifs</Text>
      {actifs.length === 0 ? <Text style={{ color: '#999' }}>Aucun match actif.</Text> : null}
      {actifs.map((m) => (
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        <Pressable key={m.match_id} onPress={() => router.push({ pathname: '/match/[id]', params: { id: m.match_id } } as any)}>
          <MatchRow match={m} now={now} />
        </Pressable>
      ))}

      <Text style={{ fontSize: 18, fontWeight: '800', marginTop: 24, marginBottom: 8 }}>Expirés</Text>
      {expires.length === 0 ? <Text style={{ color: '#999' }}>Aucun match expiré.</Text> : null}
      {expires.map((m) => (
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        <Pressable key={m.match_id} onPress={() => router.push({ pathname: '/match/[id]', params: { id: m.match_id } } as any)}>
          <MatchRow match={m} now={now} />
        </Pressable>
      ))}
    </ScrollView>
  );
}
