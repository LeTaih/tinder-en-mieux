import { Image, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { Colors, FontSizes, Radii, Spacing } from '../../lib/theme';
import { formatAge, formatDistance } from '../deck/deck-format';
import type { PromptAnswer } from './rich-types';

export type ProfileDetailData = {
  display_name: string;
  age: number;
  distance_km: number;
  bio: string | null;
  photos: string[];
  job: string | null;
  education: string | null;
  height_cm: number | null;
  interests: string[];
  prompts: PromptAnswer[];
};

function Chip({ label }: { label: string }) {
  return (
    <View style={{ backgroundColor: Colors.primaryBg, borderRadius: Radii.pill, paddingHorizontal: Spacing.md, paddingVertical: 6 }}>
      <Text style={{ color: Colors.primary, fontSize: FontSizes.sm }}>{label}</Text>
    </View>
  );
}

export function ProfileDetailModal({ data, onClose }: { data: ProfileDetailData; onClose: () => void }) {
  const facts = [data.job, data.education, data.height_cm ? `${data.height_cm} cm` : null].filter(Boolean) as string[];
  const title = data.age ? `${data.display_name}, ${formatAge(data.age)}` : data.display_name;
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: Colors.white }}>
        <View style={{ flexDirection: 'row', justifyContent: 'flex-end', padding: Spacing.md }}>
          <Pressable accessibilityRole="button" accessibilityLabel="Fermer" hitSlop={12} onPress={onClose}>
            <Text style={{ fontSize: 28, color: Colors.textMuted }}>✕</Text>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={{ padding: Spacing.lg, gap: Spacing.lg }}>
          {data.photos[0] ? (
            <Image source={{ uri: data.photos[0] }} style={{ width: '100%', height: 380, borderRadius: Radii.lg }} resizeMode="cover" />
          ) : null}
          <Text style={{ fontSize: FontSizes.xxl, fontWeight: '800', color: Colors.text }}>{title}</Text>
          {data.distance_km > 0 ? <Text style={{ color: Colors.textMuted }}>{formatDistance(data.distance_km)}</Text> : null}
          {facts.length > 0 ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm }}>
              {facts.map((f) => <Chip key={f} label={f} />)}
            </View>
          ) : null}
          {data.bio ? <Text style={{ fontSize: FontSizes.md, color: Colors.text }}>{data.bio}</Text> : null}
          {data.interests.length > 0 ? (
            <View style={{ gap: Spacing.sm }}>
              <Text style={{ fontWeight: '700', color: Colors.text }}>Centres d'intérêt</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm }}>
                {data.interests.map((i) => <Chip key={i} label={i} />)}
              </View>
            </View>
          ) : null}
          {data.prompts.map((p) => (
            <View key={p.question} style={{ backgroundColor: Colors.bgMuted, borderRadius: Radii.md, padding: Spacing.md, gap: 4 }}>
              <Text style={{ fontWeight: '700', color: Colors.textMuted }}>{p.question}</Text>
              <Text style={{ fontSize: FontSizes.md, color: Colors.text }}>{p.answer}</Text>
            </View>
          ))}
          {data.photos.slice(1).map((uri) => (
            <Image key={uri} source={{ uri }} style={{ width: '100%', height: 380, borderRadius: Radii.lg }} resizeMode="cover" />
          ))}
        </ScrollView>
      </View>
    </Modal>
  );
}
