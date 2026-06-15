import { Pressable, Text, TextInput, View } from 'react-native';
import { Colors, FontSizes, Radii, Spacing } from '../../lib/theme';
import { MAX_ANSWER, MAX_PROMPTS } from './rich-validation';
import type { Prompt } from './catalog-api';

export type PromptItem = { promptId: string; answer: string };
type Props = { allPrompts: Prompt[]; value: PromptItem[]; onChange: (items: PromptItem[]) => void };

export function PromptEditor({ allPrompts, value, onChange }: Props) {
  const usedIds = value.map((v) => v.promptId);
  const available = allPrompts.filter((p) => !usedIds.includes(p.id));
  const questionOf = (id: string) => allPrompts.find((p) => p.id === id)?.question ?? '';

  function add(promptId: string) {
    if (value.length >= MAX_PROMPTS) return;
    onChange([...value, { promptId, answer: '' }]);
  }
  function setAnswer(promptId: string, answer: string) {
    onChange(value.map((v) => (v.promptId === promptId ? { ...v, answer } : v)));
  }
  function remove(promptId: string) {
    onChange(value.filter((v) => v.promptId !== promptId));
  }

  return (
    <View style={{ gap: Spacing.md }}>
      {value.map((v) => (
        <View key={v.promptId} style={{ gap: 4 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={{ fontWeight: '700', color: Colors.text, flex: 1 }}>{questionOf(v.promptId)}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Retirer" onPress={() => remove(v.promptId)} hitSlop={8}>
              <Text style={{ color: Colors.textMuted }}>✕</Text>
            </Pressable>
          </View>
          <TextInput
            value={v.answer}
            onChangeText={(t) => setAnswer(v.promptId, t)}
            maxLength={MAX_ANSWER}
            placeholder="Ta réponse…"
            style={{ borderWidth: 1, borderColor: Colors.border, borderRadius: Radii.sm, padding: Spacing.md }}
          />
        </View>
      ))}
      {value.length < MAX_PROMPTS ? (
        <View style={{ gap: Spacing.sm }}>
          <Text style={{ color: Colors.textMuted, fontSize: FontSizes.sm }}>Ajouter un prompt ({value.length}/{MAX_PROMPTS})</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm }}>
            {available.map((p) => (
              <Pressable
                key={p.id}
                accessibilityRole="button"
                onPress={() => add(p.id)}
                style={{ borderRadius: Radii.pill, paddingHorizontal: Spacing.md, paddingVertical: 8, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.white }}
              >
                <Text style={{ color: Colors.text }}>{p.question}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}
    </View>
  );
}
