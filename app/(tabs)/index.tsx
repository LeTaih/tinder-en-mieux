import { useRef, useState } from 'react';
import { ActivityIndicator, Alert, Button, Text, View } from 'react-native';
import { Swiper, type SwiperCardRefType } from 'rn-swiper-list';
import { useQueryClient } from '@tanstack/react-query';
import { useDeck, useLikesRemaining, useRewind, useSwipe } from '../../src/features/deck/use-deck';
import { DeckCard } from '../../src/features/deck/DeckCard';
import { clampRemaining } from '../../src/features/deck/deck-format';
import type { DeckCandidate } from '../../src/features/deck/deck-api';
import { MatchModal } from '../../src/features/matches/MatchModal';

export default function Deck() {
  const ref = useRef<SwiperCardRefType>(null);
  const { data: candidates, isLoading, isError, refetch } = useDeck();
  const { data: remainingRaw = 0 } = useLikesRemaining();
  const remaining = clampRemaining(remainingRaw);
  const swipe = useSwipe();
  const rewind = useRewind();
  const qc = useQueryClient();
  const [matchId, setMatchId] = useState<string | null>(null);

  function onSwiped(direction: 'like' | 'pass', index: number) {
    if (!candidates) return;
    swipe.mutate(
      { target: candidates[index].id, direction },
      {
        onSuccess: (res) => {
          if (res.matched && res.matchId) {
            qc.invalidateQueries({ queryKey: ['matches'] });
            setMatchId(res.matchId);
          }
        },
        onError: (e: any) => {
          if (typeof e?.message === 'string' && e.message.includes('QUOTA_EXCEEDED')) {
            Alert.alert('Quota atteint', 'Tu as utilisé tes 20 likes du jour. Reviens demain !');
          } else {
            Alert.alert('Oups', 'Action impossible pour le moment. Réessaie.');
          }
        },
      },
    );
  }

  if (isLoading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator />
      </View>
    );
  }

  if (isError) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 }}>
        <Text style={{ textAlign: 'center' }}>Impossible de charger les profils.</Text>
        <Button title="Réessayer" onPress={() => refetch()} />
      </View>
    );
  }

  if (!candidates || candidates.length === 0) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <Text style={{ fontSize: 16, textAlign: 'center' }}>Plus de profils pour le moment. Reviens plus tard !</Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <View style={{ padding: 12, alignItems: 'center' }}>
        <Text>
          {remaining} like{remaining > 1 ? 's' : ''} restant{remaining > 1 ? 's' : ''} aujourd'hui
        </Text>
      </View>
      <View style={{ flex: 1, paddingHorizontal: 12, paddingBottom: 12 }}>
        <Swiper
          ref={ref}
          data={candidates}
          disableRightSwipe={remaining <= 0}
          cardStyle={{ width: '100%', height: '100%' }}
          renderCard={(item: DeckCandidate) => (
            <DeckCard
              candidate={item}
              likesRemaining={remaining}
              onLike={() => ref.current?.swipeRight()}
              onPass={() => ref.current?.swipeLeft()}
              onRewind={() => {
                ref.current?.swipeBack();
                rewind.mutate();
              }}
            />
          )}
          onSwipeRight={(i: number) => onSwiped('like', i)}
          onSwipeLeft={(i: number) => onSwiped('pass', i)}
        />
      </View>
      {matchId ? <MatchModal matchId={matchId} onClose={() => setMatchId(null)} /> : null}
    </View>
  );
}
