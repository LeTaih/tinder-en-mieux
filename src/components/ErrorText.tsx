import { Text } from 'react-native';
import { Colors, FontSizes } from '../lib/theme';

export function ErrorText({ message }: { message?: string | null }) {
  if (!message) return null;
  return <Text style={{ color: Colors.danger, fontSize: FontSizes.sm }}>{message}</Text>;
}
