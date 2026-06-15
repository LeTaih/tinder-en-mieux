import { Text, View } from 'react-native';
import { Colors, FontSizes, Spacing } from '../lib/theme';
import { AppButton } from './AppButton';

type Props = {
  icon?: string;
  title: string;
  message?: string;
  actionLabel?: string;
  onAction?: () => void;
};

export function EmptyState({ icon, title, message, actionLabel, onAction }: Props) {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xxl, gap: Spacing.md }}>
      {icon ? <Text style={{ fontSize: 48 }}>{icon}</Text> : null}
      <Text style={{ fontSize: FontSizes.lg, fontWeight: '700', textAlign: 'center', color: Colors.text }}>{title}</Text>
      {message ? (
        <Text style={{ fontSize: FontSizes.md, color: Colors.textMuted, textAlign: 'center' }}>{message}</Text>
      ) : null}
      {actionLabel && onAction ? (
        <View style={{ marginTop: Spacing.sm, alignSelf: 'stretch' }}>
          <AppButton title={actionLabel} onPress={onAction} />
        </View>
      ) : null}
    </View>
  );
}
