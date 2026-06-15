import { Image, Modal, Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useMatches } from './use-matches';

type Props = { matchId: string; onClose: () => void };

export function MatchModal({ matchId, onClose }: Props) {
  const router = useRouter();
  const { data: matches } = useMatches();
  const match = (matches ?? []).find((m) => m.match_id === matchId);

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', alignItems: 'center', justifyContent: 'center', gap: 20, padding: 24 }}>
        <Text style={{ color: 'white', fontSize: 32, fontWeight: '800' }}>C'est un match !</Text>
        {match?.photo ? (
          <Image source={{ uri: match.photo }} style={{ width: 160, height: 200, borderRadius: 16 }} />
        ) : null}
        {match ? (
          <Text style={{ color: 'white', fontSize: 18 }}>Toi et {match.display_name} vous êtes likés</Text>
        ) : null}
        <Pressable
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          onPress={() => { onClose(); router.push({ pathname: '/match/[id]', params: { id: matchId } } as any); }}
          style={{ backgroundColor: 'white', paddingHorizontal: 24, paddingVertical: 12, borderRadius: 24 }}
        >
          <Text style={{ fontWeight: '700' }}>Voir le match</Text>
        </Pressable>
        <Pressable onPress={onClose}>
          <Text style={{ color: 'white' }}>Continuer à swiper</Text>
        </Pressable>
      </View>
    </Modal>
  );
}
