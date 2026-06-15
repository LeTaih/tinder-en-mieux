import { ActivityIndicator, Pressable, Text } from 'react-native';
import { Colors, FontSizes, Radii, Spacing } from '../lib/theme';

type Props = {
  title: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  variant?: 'primary' | 'secondary';
};

export function AppButton({ title, onPress, loading = false, disabled = false, variant = 'primary' }: Props) {
  const isDisabled = disabled || loading;
  const secondary = variant === 'secondary';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      onPress={() => {
        if (!isDisabled) onPress();
      }}
      style={({ pressed }) => ({
        backgroundColor: secondary ? Colors.white : Colors.primary,
        borderWidth: secondary ? 1 : 0,
        borderColor: Colors.primary,
        borderRadius: Radii.sm,
        paddingVertical: Spacing.md,
        paddingHorizontal: Spacing.lg,
        minHeight: 48,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: isDisabled ? 0.5 : pressed ? 0.85 : 1,
      })}
    >
      {loading ? (
        <ActivityIndicator color={secondary ? Colors.primary : Colors.white} />
      ) : (
        <Text style={{ color: secondary ? Colors.primary : Colors.white, fontSize: FontSizes.md, fontWeight: '700' }}>
          {title}
        </Text>
      )}
    </Pressable>
  );
}
