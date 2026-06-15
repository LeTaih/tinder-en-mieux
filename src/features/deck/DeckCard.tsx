import { useState } from 'react';
import { Image, Pressable, Text, View } from 'react-native';
import type { DeckCandidate } from './deck-api';
import { formatAge, formatDistance } from './deck-format';

type Props = {
  candidate: DeckCandidate;
  likesRemaining: number;
  onLike: () => void;
  onPass: () => void;
  onRewind: () => void;
};

export function DeckCard({ candidate, likesRemaining, onLike, onPass, onRewind }: Props) {
  const [photoIndex, setPhotoIndex] = useState(0);
  const canLike = likesRemaining > 0;
  const photo = candidate.photos[photoIndex];

  return (
    <View style={{ flex: 1, borderRadius: 16, overflow: 'hidden', backgroundColor: '#eee' }}>
      <Pressable
        style={{ flex: 1 }}
        onPress={() => candidate.photos.length > 0 && setPhotoIndex((i) => (i + 1) % candidate.photos.length)}
      >
        {photo ? <Image source={{ uri: photo }} style={{ flex: 1 }} resizeMode="cover" /> : null}
      </Pressable>
      <View style={{ position: 'absolute', bottom: 90, left: 16, right: 16 }}>
        <Text style={{ fontSize: 24, fontWeight: '800', color: 'white' }}>
          {candidate.display_name}, {formatAge(candidate.age)}
        </Text>
        <Text style={{ color: 'white' }}>{formatDistance(candidate.distance_km)}</Text>
        {candidate.bio ? <Text style={{ color: 'white' }} numberOfLines={2}>{candidate.bio}</Text> : null}
      </View>
      <View style={{ position: 'absolute', bottom: 16, left: 0, right: 0, flexDirection: 'row', justifyContent: 'space-around' }}>
        <Pressable onPress={onRewind}><Text style={{ fontSize: 28 }}>↩️</Text></Pressable>
        <Pressable onPress={onPass}><Text style={{ fontSize: 28 }}>✕</Text></Pressable>
        <Pressable onPress={() => canLike && onLike()}>
          <Text style={{ fontSize: 28, opacity: canLike ? 1 : 0.3 }}>♥</Text>
        </Pressable>
      </View>
    </View>
  );
}
