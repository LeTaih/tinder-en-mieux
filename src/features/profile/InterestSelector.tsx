import { Pressable, Text, View } from 'react-native';
import { Colors, FontSizes, Radii, Spacing } from '../../lib/theme';
import { MAX_INTERESTS, canAddInterest } from './rich-validation';
import type { Interest } from './catalog-api';

type Props = { all: Interest[]; selectedIds: string[]; onChange: (ids: string[]) => void };

export function InterestSelector({ all, selectedIds, onChange }: Props) {
  function toggle(id: string) {
    if (selectedIds.includes(id)) {
      // La désélection est toujours possible, même au plafond (pour pouvoir échanger un intérêt).
      onChange(selectedIds.filter((x) => x !== id));
    } else if (canAddInterest(selectedIds.length)) {
      onChange([...selectedIds, id]);
    }
  }
  return (
    <View style={{ gap: Spacing.sm }}>
      <Text style={{ color: Colors.textMuted, fontSize: FontSizes.sm }}>{selectedIds.length}/{MAX_INTERESTS}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm }}>
        {all.map((i) => {
          const on = selectedIds.includes(i.id);
          return (
            <Pressable
              key={i.id}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              onPress={() => toggle(i.id)}
              style={{
                borderRadius: Radii.pill, paddingHorizontal: Spacing.md, paddingVertical: 8,
                borderWidth: 1, borderColor: on ? Colors.primary : Colors.border,
                backgroundColor: on ? Colors.primaryBg : Colors.white,
              }}
            >
              <Text style={{ color: on ? Colors.primary : Colors.text }}>{i.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
