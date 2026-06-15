import { useState } from 'react';
import { Image, Pressable, Text, View } from 'react-native';
import type { DeckCandidate } from './deck-api';
import { formatAge, formatDistance } from './deck-format';
import { SafetyMenu } from '../safety/SafetyMenu';
import { Colors, Radii } from '../../lib/theme';

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
  const photoCount = candidate.photos.length;
  const photo = candidate.photos[photoIndex];
  const textShadow = { textShadowColor: 'rgba(0,0,0,0.6)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3 };

  return (
    <View style={{ flex: 1, borderRadius: Radii.lg, overflow: 'hidden', backgroundColor: Colors.placeholder }}>
      <Pressable
        style={{ flex: 1 }}
        accessibilityRole="imagebutton"
        accessibilityLabel={photoCount > 1 ? `Photo ${photoIndex + 1} sur ${photoCount}, toucher pour la suivante` : undefined}
        onPress={() => photoCount > 1 && setPhotoIndex((i) => (i + 1) % photoCount)}
      >
        {photo ? (
          <Image source={{ uri: photo }} style={{ flex: 1 }} resizeMode="cover" />
        ) : (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ fontSize: 40 }}>📷</Text>
          </View>
        )}
      </Pressable>

      {photoCount > 1 ? (
        <View style={{ position: 'absolute', top: 10, left: 16, right: 56, flexDirection: 'row', gap: 4 }}>
          {candidate.photos.map((_, i) => (
            <View
              key={i}
              style={{ flex: 1, height: 3, borderRadius: 2, backgroundColor: i === photoIndex ? Colors.white : 'rgba(255,255,255,0.4)' }}
            />
          ))}
        </View>
      ) : null}

      <View style={{ position: 'absolute', top: 12, right: 12 }}>
        <SafetyMenu targetId={candidate.id} />
      </View>

      <View style={{ position: 'absolute', bottom: 90, left: 16, right: 16 }}>
        <Text style={[{ fontSize: 24, fontWeight: '800', color: Colors.white }, textShadow]}>
          {candidate.display_name}, {formatAge(candidate.age)}
        </Text>
        <Text style={[{ color: Colors.white }, textShadow]}>{formatDistance(candidate.distance_km)}</Text>
        {candidate.bio ? (
          <Text style={[{ color: Colors.white }, textShadow]} numberOfLines={2}>
            {candidate.bio}
          </Text>
        ) : null}
      </View>

      <View style={{ position: 'absolute', bottom: 16, left: 0, right: 0, flexDirection: 'row', justifyContent: 'space-around' }}>
        <Pressable onPress={onRewind} accessibilityRole="button" accessibilityLabel="Revenir au profil précédent">
          <Text style={{ fontSize: 28 }}>↩️</Text>
        </Pressable>
        <Pressable onPress={onPass} accessibilityRole="button" accessibilityLabel="Passer">
          <Text style={{ fontSize: 28 }}>✕</Text>
        </Pressable>
        <Pressable
          onPress={() => canLike && onLike()}
          disabled={!canLike}
          accessibilityRole="button"
          accessibilityLabel="Aimer"
          accessibilityState={{ disabled: !canLike }}
        >
          <Text style={{ fontSize: 28, opacity: canLike ? 1 : 0.3 }}>♥</Text>
        </Pressable>
      </View>
    </View>
  );
}
