import { useRef } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { Swiper, type SwiperCardRefType } from 'rn-swiper-list';
import { useDeck, useLikesRemaining, useRewind, useSwipe } from '../../src/features/deck/use-deck';
import { DeckCard } from '../../src/features/deck/DeckCard';
import type { DeckCandidate } from '../../src/features/deck/deck-api';

export default function Deck() {
  const ref = useRef<SwiperCardRefType>(null);
  const { data: candidates, isLoading } = useDeck();
  const { data: remaining = 0 } = useLikesRemaining();
  const swipe = useSwipe();
  const rewind = useRewind();

  if (isLoading) {
    return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator /></View>;
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
        <Text>{remaining} like{remaining > 1 ? 's' : ''} restant{remaining > 1 ? 's' : ''} aujourd'hui</Text>
      </View>
      <View style={{ flex: 1, paddingHorizontal: 12, paddingBottom: 12 }}>
        <Swiper
          ref={ref}
          data={candidates}
          renderCard={(item: DeckCandidate) => (
            <DeckCard
              candidate={item}
              likesRemaining={remaining}
              onLike={() => ref.current?.swipeRight()}
              onPass={() => ref.current?.swipeLeft()}
              onRewind={() => { ref.current?.swipeBack(); rewind.mutate(); }}
            />
          )}
          onSwipeRight={(i: number) => swipe.mutate({ target: candidates[i].id, direction: 'like' })}
          onSwipeLeft={(i: number) => swipe.mutate({ target: candidates[i].id, direction: 'pass' })}
        />
      </View>
    </View>
  );
}
