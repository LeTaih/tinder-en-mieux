# Plan 8 — Polish & QA — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rendre la v1 démo-ready : thème UI centralisé, composants partagés, états vides/chargement/erreur soignés, accessibilité, compte à rebours `mm:ss`, icônes d'onglets, SafeArea, et fix du clavier qui recouvre le chat — sans nouvelle fonctionnalité.

**Architecture :** On pose d'abord les fondations (`src/lib/theme.ts` + composants `src/components/*`), puis on les applique aux écrans existants. Tutoiement partout. Le clavier du chat utilise `useSafeAreaInsets` (Expo Router 56 n'a pas `@react-navigation/elements`).

**Tech Stack :** Expo SDK 56, React Native, Expo Router, `react-native-safe-area-context` (installé), `expo-status-bar` (installé), `@expo/vector-icons` (à installer — runtime, pas de rebuild), jest-expo + @testing-library/react-native.

**Spec :** `docs/superpowers/specs/2026-06-16-plan-8-polish-qa-design.md`

---

## Conventions partagées (rappel, utilisées dans plusieurs tâches)

**Thème** (créé en Task 1) — import : `import { Colors, Spacing, Radii, FontSizes } from '<chemin>/lib/theme';`
Mapping des littéraux à remplacer : `#208AEF`→`Colors.primary`, `#E6F0FF`→`Colors.primaryBg`, `#E53935`→`Colors.danger`, `'red'`→`Colors.danger`, `#ccc`→`Colors.border`, `#ddd`→`Colors.borderLight`, `#999`→`Colors.textFaint`, `#777`→`Colors.textMuted`, `#E9E9EB`→`Colors.bubbleOther`, `#f2f2f2`→`Colors.bgMuted`, `#eee`→`Colors.placeholder`, `'rgba(0,0,0,0.85)'`→`Colors.overlayStrong`, `'rgba(0,0,0,0.4)'`→`Colors.overlay`.

**AppButton** (Task 2) — `import { AppButton } from '<chemin>/components/AppButton';`
API : `<AppButton title="…" onPress={fn} loading={bool} disabled={bool} variant="primary"|"secondary" />`

**ErrorText** (Task 4) — `import { ErrorText } from '<chemin>/components/ErrorText';`
API : `<ErrorText message={error} />` (ne rend rien si `message` vide/undefined).

**EmptyState** (Task 3) — `import { EmptyState } from '<chemin>/components/EmptyState';`
API : `<EmptyState icon="🔥" title="…" message="…" actionLabel="…" onAction={fn} />` (icon/message/action optionnels).

---

## Task 1 : thème `src/lib/theme.ts`

**Files:**
- Create: `src/lib/theme.ts`

- [ ] **Step 1 : Créer le thème**

Créer `src/lib/theme.ts` :

```ts
export const Colors = {
  primary: '#208AEF',
  primaryBg: '#E6F0FF',
  danger: '#E53935',
  white: '#FFFFFF',
  black: '#000000',
  text: '#222222',
  textMuted: '#777777',
  textFaint: '#999999',
  border: '#CCCCCC',
  borderLight: '#DDDDDD',
  bubbleOther: '#E9E9EB',
  bgMuted: '#F2F2F2',
  placeholder: '#EEEEEE',
  overlay: 'rgba(0,0,0,0.4)',
  overlayStrong: 'rgba(0,0,0,0.85)',
} as const;

export const Spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24 } as const;
export const Radii = { sm: 8, md: 12, lg: 16, pill: 24 } as const;
export const FontSizes = { sm: 14, md: 16, lg: 18, xl: 20, xxl: 24, title: 32 } as const;
```

- [ ] **Step 2 : Vérifier la compilation**

Run: `npx tsc --noEmit`
Expected: 0 erreur.

- [ ] **Step 3 : Commit**

```bash
git add src/lib/theme.ts
git commit -m "feat(plan-8): thème centralisé (couleurs, espacements, radii)"
```

---

## Task 2 : composant `AppButton` (TDD)

**Files:**
- Create: `src/components/AppButton.tsx`
- Test: `src/components/AppButton.test.tsx`

- [ ] **Step 1 : Écrire le test qui échoue**

Créer `src/components/AppButton.test.tsx` :

```tsx
import { fireEvent, render, screen } from '@testing-library/react-native';
import { AppButton } from './AppButton';

describe('AppButton', () => {
  it('affiche le titre et déclenche onPress', () => {
    const onPress = jest.fn();
    render(<AppButton title="Se connecter" onPress={onPress} />);
    fireEvent.press(screen.getByText('Se connecter'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('en chargement : masque le titre et ignore le press', () => {
    const onPress = jest.fn();
    render(<AppButton title="Se connecter" onPress={onPress} loading />);
    expect(screen.queryByText('Se connecter')).toBeNull();
    fireEvent.press(screen.getByRole('button'));
    expect(onPress).not.toHaveBeenCalled();
  });

  it('désactivé : ignore le press', () => {
    const onPress = jest.fn();
    render(<AppButton title="Continuer" onPress={onPress} disabled />);
    fireEvent.press(screen.getByText('Continuer'));
    expect(onPress).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2 : Lancer le test → échec**

Run: `npm test -- AppButton`
Expected: FAIL (`Cannot find module './AppButton'`).

- [ ] **Step 3 : Implémenter**

Créer `src/components/AppButton.tsx` :

```tsx
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
```

- [ ] **Step 4 : Lancer le test → succès**

Run: `npm test -- AppButton`
Expected: PASS (3 tests).

- [ ] **Step 5 : Commit**

```bash
git add src/components/AppButton.tsx src/components/AppButton.test.tsx
git commit -m "feat(plan-8): composant AppButton (spinner + état désactivé), testé"
```

---

## Task 3 : composant `EmptyState` (TDD)

**Files:**
- Create: `src/components/EmptyState.tsx`
- Test: `src/components/EmptyState.test.tsx`

- [ ] **Step 1 : Écrire le test qui échoue**

Créer `src/components/EmptyState.test.tsx` :

```tsx
import { fireEvent, render, screen } from '@testing-library/react-native';
import { EmptyState } from './EmptyState';

describe('EmptyState', () => {
  it('affiche titre et message', () => {
    render(<EmptyState title="Plus de profils" message="Reviens plus tard !" />);
    expect(screen.getByText('Plus de profils')).toBeTruthy();
    expect(screen.getByText('Reviens plus tard !')).toBeTruthy();
  });

  it('déclenche l’action quand fournie', () => {
    const onAction = jest.fn();
    render(<EmptyState title="Oups" actionLabel="Réessayer" onAction={onAction} />);
    fireEvent.press(screen.getByText('Réessayer'));
    expect(onAction).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2 : Lancer le test → échec**

Run: `npm test -- EmptyState`
Expected: FAIL (module introuvable).

- [ ] **Step 3 : Implémenter**

Créer `src/components/EmptyState.tsx` :

```tsx
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
```

- [ ] **Step 4 : Lancer le test → succès**

Run: `npm test -- EmptyState`
Expected: PASS (2 tests).

- [ ] **Step 5 : Commit**

```bash
git add src/components/EmptyState.tsx src/components/EmptyState.test.tsx
git commit -m "feat(plan-8): composant EmptyState, testé"
```

---

## Task 4 : composant `ErrorText` (TDD)

**Files:**
- Create: `src/components/ErrorText.tsx`
- Test: `src/components/ErrorText.test.tsx`

- [ ] **Step 1 : Écrire le test qui échoue**

Créer `src/components/ErrorText.test.tsx` :

```tsx
import { render, screen } from '@testing-library/react-native';
import { ErrorText } from './ErrorText';

describe('ErrorText', () => {
  it('affiche le message', () => {
    render(<ErrorText message="Champ requis" />);
    expect(screen.getByText('Champ requis')).toBeTruthy();
  });

  it('ne rend rien si vide', () => {
    const { toJSON } = render(<ErrorText message={undefined} />);
    expect(toJSON()).toBeNull();
  });
});
```

- [ ] **Step 2 : Lancer le test → échec**

Run: `npm test -- ErrorText`
Expected: FAIL (module introuvable).

- [ ] **Step 3 : Implémenter**

Créer `src/components/ErrorText.tsx` :

```tsx
import { Text } from 'react-native';
import { Colors, FontSizes } from '../lib/theme';

export function ErrorText({ message }: { message?: string | null }) {
  if (!message) return null;
  return <Text style={{ color: Colors.danger, fontSize: FontSizes.sm }}>{message}</Text>;
}
```

- [ ] **Step 4 : Lancer le test → succès**

Run: `npm test -- ErrorText`
Expected: PASS (2 tests).

- [ ] **Step 5 : Commit**

```bash
git add src/components/ErrorText.tsx src/components/ErrorText.test.tsx
git commit -m "feat(plan-8): composant ErrorText, testé"
```

---

## Task 5 : SafeArea + StatusBar (racine) + mock jest safe-area

**Files:**
- Modify: `app/_layout.tsx`
- Modify: `jest.setup.ts`

- [ ] **Step 1 : Ajouter le mock safe-area pour jest**

Les écrans qui utiliseront `SafeAreaView` (auth/onboarding) sont rendus en test. Lire `jest.setup.ts` et y ajouter, à la fin du fichier :

```ts
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
```

- [ ] **Step 2 : Vérifier que la suite passe toujours**

Run: `npm test`
Expected: tous les tests existants passent (le mock n'affecte rien tant que personne n'importe SafeAreaView).

- [ ] **Step 3 : Envelopper la racine (SafeAreaProvider + StatusBar)**

Dans `app/_layout.tsx`, ajouter en haut (après les imports existants) :

```tsx
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
```

Puis remplacer le corps de `RootLayout` :

```tsx
export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <QueryClientProvider client={queryClient}>
        <SessionProvider>
          <RootNavigator />
        </SessionProvider>
      </QueryClientProvider>
    </GestureHandlerRootView>
  );
}
```

par :

```tsx
export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <SessionProvider>
            <StatusBar style="dark" />
            <RootNavigator />
          </SessionProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
```

- [ ] **Step 4 : Vérifier compilation + tests**

Run: `npx tsc --noEmit && npm test`
Expected: 0 erreur ; tous les tests passent.

- [ ] **Step 5 : Commit**

```bash
git add app/_layout.tsx jest.setup.ts
git commit -m "feat(plan-8): SafeAreaProvider + StatusBar à la racine + mock jest safe-area"
```

---

## Task 6 : compte à rebours `mm:ss`

**Files:**
- Modify: `src/features/matches/countdown.ts:11`
- Test: `src/features/matches/countdown.test.ts`

- [ ] **Step 1 : Mettre à jour le test (padding des minutes)**

Dans `src/features/matches/countdown.test.ts`, remplacer le test « pad les secondes » :

```ts
test('formatCountdown pad les secondes', () => {
  const future = new Date(base.getTime() + (5 * 60 + 3) * 1000).toISOString();
  expect(formatCountdown(future, base)).toBe('5:03');
});
```

par (minutes paddées) :

```ts
test('formatCountdown pad minutes et secondes', () => {
  const future = new Date(base.getTime() + (5 * 60 + 3) * 1000).toISOString();
  expect(formatCountdown(future, base)).toBe('05:03');
});
```

- [ ] **Step 2 : Lancer le test → échec**

Run: `npm test -- countdown`
Expected: FAIL (reçoit `'5:03'`, attend `'05:03'`).

- [ ] **Step 3 : Implémenter le padding**

Dans `src/features/matches/countdown.ts`, remplacer la ligne 11 :

```ts
  return `${m}:${s.toString().padStart(2, '0')}`;
```

par :

```ts
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
```

- [ ] **Step 4 : Lancer le test → succès**

Run: `npm test -- countdown`
Expected: PASS (4 tests ; `59:32` et `05:03` OK).

- [ ] **Step 5 : Commit**

```bash
git add src/features/matches/countdown.ts src/features/matches/countdown.test.ts
git commit -m "feat(plan-8): compte à rebours en mm:ss (padding des minutes)"
```

---

## Task 7 : icônes d'onglets

**Files:**
- Modify: `app/(tabs)/_layout.tsx`
- Modify: `package.json` (via `expo install`)

- [ ] **Step 1 : Installer @expo/vector-icons**

Run: `npx expo install @expo/vector-icons`
Expected: ajoute la dépendance (polices chargées au runtime → pas de rebuild natif).

- [ ] **Step 2 : Câbler les icônes**

Remplacer tout `app/(tabs)/_layout.tsx` par :

```tsx
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../src/lib/theme';

export default function TabsLayout() {
  return (
    <Tabs screenOptions={{ tabBarActiveTintColor: Colors.primary }}>
      <Tabs.Screen
        name="index"
        options={{ title: 'Deck', tabBarIcon: ({ color, size }) => <Ionicons name="flame" color={color} size={size} /> }}
      />
      <Tabs.Screen
        name="matches"
        options={{ title: 'Matchs', tabBarIcon: ({ color, size }) => <Ionicons name="chatbubbles" color={color} size={size} /> }}
      />
      <Tabs.Screen
        name="profile"
        options={{ title: 'Profil', tabBarIcon: ({ color, size }) => <Ionicons name="person" color={color} size={size} /> }}
      />
    </Tabs>
  );
}
```

- [ ] **Step 3 : Vérifier compilation + tests**

Run: `npx tsc --noEmit && npm test`
Expected: 0 erreur ; suite verte (aucun test ne rend ce layout).

- [ ] **Step 4 : Commit**

```bash
git add app/(tabs)/_layout.tsx package.json
git commit -m "feat(plan-8): icônes d'onglets (Ionicons) + teinte active"
```

---

## Task 8 : accessibilité + thème dans `ChatInput` et `MessageBubble`

**Files:**
- Modify: `src/features/chat/ChatInput.tsx`
- Modify: `src/features/chat/MessageBubble.tsx`

- [ ] **Step 1 : `ChatInput` — labels d'accessibilité + thème + cible tactile**

Remplacer tout `src/features/chat/ChatInput.tsx` par :

```tsx
import { useState } from 'react';
import { Alert, Pressable, Text, TextInput, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Colors, Radii, Spacing } from '../../lib/theme';

type Props = {
  disabled?: boolean;
  onSendText: (body: string) => void;
  onSendImage: (localUri: string) => void;
};

export function ChatInput({ disabled, onSendText, onSendImage }: Props) {
  const [text, setText] = useState('');

  function submitText() {
    const body = text.trim();
    if (!body || disabled) return;
    onSendText(body);
    setText('');
  }

  async function pickImage() {
    if (disabled) return;
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permission', 'Accès aux photos refusé.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ quality: 1 });
    if (result.canceled) return;
    onSendImage(result.assets[0].uri);
  }

  const canSend = !disabled && text.trim().length > 0;

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, padding: Spacing.sm }}>
      <Pressable
        onPress={pickImage}
        disabled={disabled}
        hitSlop={12}
        accessibilityRole="button"
        accessibilityLabel="Joindre une image"
        style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}
      >
        <Text style={{ fontSize: 22 }}>📎</Text>
      </Pressable>
      <TextInput
        style={{
          flex: 1,
          borderWidth: 1,
          borderColor: Colors.borderLight,
          borderRadius: Radii.pill,
          paddingHorizontal: 14,
          paddingVertical: Spacing.sm,
        }}
        placeholder="Message…"
        value={text}
        onChangeText={setText}
        editable={!disabled}
        onSubmitEditing={submitText}
        returnKeyType="send"
      />
      <Pressable
        onPress={submitText}
        disabled={!canSend}
        accessibilityRole="button"
        accessibilityLabel="Envoyer"
        style={{
          backgroundColor: Colors.primary,
          opacity: canSend ? 1 : 0.4,
          minWidth: 44,
          minHeight: 44,
          paddingHorizontal: Spacing.lg,
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: Radii.pill,
        }}
      >
        <Text style={{ color: Colors.white, fontSize: 18 }}>➤</Text>
      </Pressable>
    </View>
  );
}
```

- [ ] **Step 2 : `MessageBubble` — thème**

Dans `src/features/chat/MessageBubble.tsx` : ajouter l'import `import { Colors, Radii } from '../../lib/theme';` (après l'import de `chat-format`), puis remplacer les littéraux :
- ligne du placeholder image : `backgroundColor: '#ddd'` → `backgroundColor: Colors.borderLight` (et `borderRadius: 12` → `borderRadius: Radii.md`).
- bulle texte : `backgroundColor: mine ? '#208AEF' : '#E9E9EB'` → `backgroundColor: mine ? Colors.primary : Colors.bubbleOther` ; `borderRadius: 16` → `borderRadius: Radii.lg` ; `color: mine ? 'white' : 'black'` → `color: mine ? Colors.white : Colors.black`.
- image envoyée : `borderRadius: 12` → `borderRadius: Radii.md`.

- [ ] **Step 3 : Vérifier compilation + tests**

Run: `npx tsc --noEmit && npm test -- MessageBubble`
Expected: 0 erreur ; le test `MessageBubble` existant passe.

- [ ] **Step 4 : Commit**

```bash
git add src/features/chat/ChatInput.tsx src/features/chat/MessageBubble.tsx
git commit -m "feat(plan-8): chat — accessibilité, cibles tactiles 44pt, thème"
```

---

## Task 9 : chat — fix clavier + état « chat vide » + thème

**Files:**
- Modify: `app/match/[id].tsx`

> Le clavier recouvre les messages/la saisie car le `KeyboardAvoidingView` n'enveloppe que `ChatInput` et `behavior` est `undefined` sur Android. On enveloppe toute la zone et on décale de la hauteur d'en-tête via `useSafeAreaInsets`.

- [ ] **Step 1 : Imports (safe area + EmptyState + thème)**

Dans `app/match/[id].tsx`, après la ligne `import { SafetyMenu } from '../../src/features/safety/SafetyMenu';`, ajouter :

```tsx
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { EmptyState } from '../../src/components/EmptyState';
import { Colors } from '../../src/lib/theme';
```

- [ ] **Step 2 : Récupérer les insets**

Juste après `const router = useRouter();`, ajouter :

```tsx
  const insets = useSafeAreaInsets();
```

- [ ] **Step 3 : Remplacer la zone liste + saisie par un KeyboardAvoidingView englobant + état vide**

Remplacer tout le bloc JSX depuis `<FlatList` jusqu'à la fin du `</View>` racine (c.-à-d. le `return ( <View style={{ flex: 1 }}> … </View> )`), par la version ci-dessous. Concrètement, remplacer :

```tsx
      <FlatList
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 12 }}
        inverted
        data={[...messages].reverse()}
        keyExtractor={(m) => m.id}
        renderItem={({ item }) => <MessageBubble message={item} mine={item.sender_id === myId} />}
      />
      {expired ? (
        <View style={{ padding: 16, backgroundColor: '#f2f2f2' }}>
          <Text style={{ textAlign: 'center', color: '#777' }}>
            Ce match a expiré — tu ne peux plus envoyer de messages.
          </Text>
        </View>
      ) : (
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ChatInput
            disabled={send.isPending}
            onSendText={(body) => send.mutate({ body })}
            onSendImage={(localUri) => send.mutate({ localUri })}
          />
        </KeyboardAvoidingView>
      )}
```

par :

```tsx
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top + 44 : 0}
      >
        {messages.length === 0 ? (
          <EmptyState title="Aucun message" message="Lance la conversation !" />
        ) : (
          <FlatList
            style={{ flex: 1 }}
            contentContainerStyle={{ padding: 12 }}
            inverted
            data={[...messages].reverse()}
            keyExtractor={(m) => m.id}
            renderItem={({ item }) => <MessageBubble message={item} mine={item.sender_id === myId} />}
          />
        )}
        {expired ? (
          <View style={{ padding: 16, backgroundColor: Colors.bgMuted }}>
            <Text style={{ textAlign: 'center', color: Colors.textMuted }}>
              Ce match a expiré — tu ne peux plus envoyer de messages.
            </Text>
          </View>
        ) : (
          <ChatInput
            disabled={send.isPending}
            onSendText={(body) => send.mutate({ body })}
            onSendImage={(localUri) => send.mutate({ localUri })}
          />
        )}
      </KeyboardAvoidingView>
```

- [ ] **Step 4 : Thème dans l'écran « Conversation indisponible » et l'en-tête**

Dans le même fichier : remplacer `color: '#777'` (texte « Conversation indisponible. ») par `color: Colors.textMuted` ; dans `headerRight`, remplacer `'#999'`→`Colors.textFaint`, `'#E53935'`→`Colors.danger`, `'#208AEF'`→`Colors.primary`.

- [ ] **Step 5 : Vérifier compilation + tests**

Run: `npx tsc --noEmit && npm test`
Expected: 0 erreur ; toute la suite passe. (Le comportement clavier se vérifie sur device.)

- [ ] **Step 6 : Commit**

```bash
git add app/match/[id].tsx
git commit -m "fix(plan-8): clavier du chat (KeyboardAvoidingView englobant) + état chat vide + thème"
```

---

## Task 10 : carte du deck — accessibilité, carrousel, lisibilité, thème

**Files:**
- Modify: `src/features/deck/DeckCard.tsx`

- [ ] **Step 1 : Réécrire `DeckCard` (indicateur multi-photos, 0/1 photo, ombre texte, a11y, like désactivé, thème)**

Remplacer tout `src/features/deck/DeckCard.tsx` par :

```tsx
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
```

- [ ] **Step 2 : Vérifier compilation + tests**

Run: `npx tsc --noEmit && npm test -- deck-card`
Expected: 0 erreur ; le test `deck-card` (qui mocke `SafetyMenu`) passe. Le candidat de test a 1 photo → pas d'indicateur ; les libellés « Léa, 24 ans » / « à 3 km » restent présents.

- [ ] **Step 3 : Commit**

```bash
git add src/features/deck/DeckCard.tsx
git commit -m "feat(plan-8): carte deck — a11y, indicateur photos, 0/1 photo, lisibilité, thème"
```

---

## Task 11 : matchs + modale + tutoiement

**Files:**
- Modify: `app/(tabs)/matches.tsx`
- Modify: `src/features/matches/MatchModal.tsx`
- Modify: `src/features/safety/SafetyMenu.tsx`

- [ ] **Step 1 : `matches.tsx` — EmptyState, thème, feedback de press**

Dans `app/(tabs)/matches.tsx` :
- Ajouter les imports : `import { EmptyState } from '../../src/components/EmptyState';` et `import { Colors } from '../../src/lib/theme';`.
- `MatchRow` : `backgroundColor: '#ddd'` → `Colors.borderLight` ; `color: expired ? '#999' : '#208AEF'` → `expired ? Colors.textFaint : Colors.primary`.
- Remplacer le bloc « aucun match » :
  ```tsx
  if (all.length === 0) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <Text style={{ textAlign: 'center' }}>Pas encore de match. Va swiper !</Text>
      </View>
    );
  }
  ```
  par :
  ```tsx
  if (all.length === 0) {
    return <EmptyState icon="💬" title="Pas encore de match" message="Va swiper pour matcher !" />;
  }
  ```
- Les deux `<Text style={{ color: '#999' }}>Aucun match actif./expiré.</Text>` → `color: Colors.textFaint`.
- Les deux `Pressable` de ligne : ajouter le feedback de press, ex. `style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}`.

- [ ] **Step 2 : `MatchModal.tsx` — tutoiement + thème**

Dans `src/features/matches/MatchModal.tsx` :
- Ajouter `import { Colors, Radii } from '../../lib/theme';`.
- `'rgba(0,0,0,0.85)'` → `Colors.overlayStrong` ; `color: 'white'` (les 3) → `Colors.white` ; `borderRadius: 16` → `Radii.lg` ; bouton `backgroundColor: 'white'` → `Colors.white`, `borderRadius: 24` → `Radii.pill`.
- **Tutoiement** : remplacer `Toi et {match.display_name} vous êtes likés` par `Toi et {match.display_name}, vous vous plaisez !`.

- [ ] **Step 3 : `SafetyMenu.tsx` — tutoiement**

Dans `src/features/safety/SafetyMenu.tsx`, remplacer le message de confirmation de blocage `'Elle disparaîtra et ne pourra plus vous contacter.'` par `'Elle disparaîtra et ne pourra plus te contacter.'`.

- [ ] **Step 4 : Vérifier compilation + tests**

Run: `npx tsc --noEmit && npm test`
Expected: 0 erreur ; suite verte (le test `match-modal` ne doit pas asserter l'ancienne phrase — sinon, mettre à jour l'assertion vers la nouvelle).

- [ ] **Step 5 : Commit**

```bash
git add app/(tabs)/matches.tsx src/features/matches/MatchModal.tsx src/features/safety/SafetyMenu.tsx
git commit -m "feat(plan-8): matchs — EmptyState, thème, feedback press, tutoiement"
```

---

## Task 12 : écrans auth (sign-in, sign-up)

**Files:**
- Modify: `app/(auth)/sign-in.tsx`
- Modify: `app/(auth)/sign-up.tsx`

- [ ] **Step 1 : `sign-in.tsx`**

Dans `app/(auth)/sign-in.tsx` :
- Imports : retirer `Button` de l'import `react-native` ; ajouter `SafeAreaView` depuis `react-native-safe-area-context` ; ajouter `import { AppButton } from '../../src/components/AppButton';`, `import { ErrorText } from '../../src/components/ErrorText';`, `import { Colors, Radii, Spacing } from '../../src/lib/theme';`.
- Remplacer le conteneur racine `<View style={{ flex: 1, justifyContent: 'center', padding: 24, gap: 12 }}>` (et son `</View>` de fermeture) par `<SafeAreaView style={{ flex: 1, justifyContent: 'center', padding: Spacing.xxl, gap: Spacing.md }}>` … `</SafeAreaView>`.
- Les deux `TextInput` : `borderColor: '#ccc'` → `Colors.border`, `borderRadius: 8` → `Radii.sm`, `padding: 12` → `Spacing.md`.
- Les deux `{errors.x ? <Text style={{ color: 'red' }}>{errors.x}</Text> : null}` → `<ErrorText message={errors.x} />`.
- Remplacer `<Button title={busy ? '...' : 'Se connecter'} onPress={onEmailSubmit} disabled={busy} />` par `<AppButton title="Se connecter" onPress={onEmailSubmit} loading={busy} />`.
- Remplacer `<Button title="Continuer avec Google" onPress={onGoogle} />` par `<AppButton title="Continuer avec Google" onPress={onGoogle} variant="secondary" />`.
- Le `<Link href="/sign-up">` reste (déjà en « tu » implicite, OK).

- [ ] **Step 2 : `sign-up.tsx`**

Dans `app/(auth)/sign-up.tsx`, mêmes transformations :
- Imports : retirer `Button` ; ajouter `SafeAreaView`, `AppButton`, `ErrorText`, `Colors`, `Radii`, `Spacing`.
- Conteneur racine `<View …>` → `<SafeAreaView style={{ flex: 1, justifyContent: 'center', padding: Spacing.xxl, gap: Spacing.md }}>` … `</SafeAreaView>`.
- `TextInput` : `'#ccc'`→`Colors.border`, `8`→`Radii.sm`, `12`→`Spacing.md`.
- Erreurs → `<ErrorText message={errors.email} />` / `<ErrorText message={errors.password} />`.
- `<Button title={busy ? '...' : "S'inscrire"} … />` → `<AppButton title="S'inscrire" onPress={onSubmit} loading={busy} />`.

- [ ] **Step 3 : Vérifier compilation + tests**

Run: `npx tsc --noEmit && npm test`
Expected: 0 erreur ; suite verte.

- [ ] **Step 4 : Commit**

```bash
git add app/(auth)/sign-in.tsx app/(auth)/sign-up.tsx
git commit -m "feat(plan-8): écrans auth — AppButton, ErrorText, SafeArea, thème"
```

---

## Task 13 : onboarding (identity, gender)

**Files:**
- Modify: `app/(onboarding)/identity.tsx`
- Modify: `app/(onboarding)/gender.tsx`

- [ ] **Step 1 : `identity.tsx`**

Dans `app/(onboarding)/identity.tsx` :
- Imports : retirer `Button` ; ajouter `SafeAreaView` (safe-area-context), `AppButton`, `ErrorText`, `Colors`, `Radii`, `Spacing`.
- Conteneur racine `<View style={{ flex: 1, padding: 24, gap: 12 }}>` → `<SafeAreaView style={{ flex: 1, padding: Spacing.xxl, gap: Spacing.md }}>` … `</SafeAreaView>`.
- Les 3 `TextInput` : `'#ccc'`→`Colors.border`, `8`→`Radii.sm`, `12`→`Spacing.md`.
- `{error ? <Text style={{ color: 'red' }}>{error}</Text> : null}` → `<ErrorText message={error} />`.
- `<Button title="Continuer" onPress={onNext} />` → `<AppButton title="Continuer" onPress={onNext} />`.

- [ ] **Step 2 : `gender.tsx` (spinner de chargement + reste)**

Dans `app/(onboarding)/gender.tsx` :
- Imports : retirer `Button` ; ajouter `ActivityIndicator` (react-native), `SafeAreaView` (safe-area-context), `AppButton`, `Colors`, `Radii`, `Spacing`.
- Conteneur racine `<View style={{ flex: 1, padding: 24, gap: 12 }}>` → `<SafeAreaView style={{ flex: 1, padding: Spacing.xxl, gap: Spacing.md }}>` … `</SafeAreaView>`.
- Remplacer `{isLoading ? <Text>Chargement…</Text> : null}` par `{isLoading ? <ActivityIndicator /> : null}`.
- `Pressable` de sélection : `'#208AEF'`→`Colors.primary`, `'#ccc'`→`Colors.border`, `'#E6F0FF'`→`Colors.primaryBg`, `'white'`→`Colors.white`, `borderRadius: 8`→`Radii.sm` ; ajouter le feedback de press en passant à `style={({ pressed }) => ({ … , opacity: pressed ? 0.7 : 1 })}`.
- `<Button title={busy ? '...' : 'Continuer'} onPress={onNext} disabled={busy || !selected} />` → `<AppButton title="Continuer" onPress={onNext} loading={busy} disabled={!selected} />`.

- [ ] **Step 3 : Vérifier compilation + tests**

Run: `npx tsc --noEmit && npm test -- identity-screen`
Expected: 0 erreur ; le test `identity-screen` passe (le bouton « Continuer » reste trouvable par son texte ; les messages d'erreur restent rendus par `ErrorText`). Puis `npm test` complet → vert.

- [ ] **Step 4 : Commit**

```bash
git add app/(onboarding)/identity.tsx app/(onboarding)/gender.tsx
git commit -m "feat(plan-8): onboarding identity/gender — AppButton, spinner, SafeArea, thème"
```

---

## Task 14 : onboarding (preferences, photos, location)

**Files:**
- Modify: `app/(onboarding)/preferences.tsx`
- Modify: `app/(onboarding)/photos.tsx`
- Modify: `app/(onboarding)/location.tsx`

- [ ] **Step 1 : `preferences.tsx`**

Dans `app/(onboarding)/preferences.tsx` :
- Imports : retirer `Button` ; ajouter `SafeAreaView`, `AppButton`, `ErrorText`, `Colors`, `Radii`, `Spacing`.
- Conteneur racine `<View style={{ flex: 1, padding: 24, gap: 12 }}>` → `<SafeAreaView style={{ flex: 1, padding: Spacing.xxl, gap: Spacing.md }}>` … `</SafeAreaView>`.
- `Pressable` de sélection : `'#208AEF'`→`Colors.primary`, `'#ccc'`→`Colors.border`, `'#E6F0FF'`→`Colors.primaryBg`, `'white'`→`Colors.white`, `8`→`Radii.sm` ; feedback de press `style={({ pressed }) => ({ … , opacity: pressed ? 0.7 : 1 })}`.
- Les 3 `TextInput` : `'#ccc'`→`Colors.border`, `8`→`Radii.sm`, `12`→`Spacing.md`.
- `{error ? <Text style={{ color: 'red' }}>{error}</Text> : null}` → `<ErrorText message={error} />`.
- `<Button title={busy ? '...' : 'Continuer'} onPress={onNext} disabled={busy} />` → `<AppButton title="Continuer" onPress={onNext} loading={busy} />`.

- [ ] **Step 2 : `photos.tsx`**

Dans `app/(onboarding)/photos.tsx` :
- Imports : retirer `Button` ; ajouter `SafeAreaView`, `AppButton`, `Colors`, `Radii`, `Spacing`.
- Conteneur racine `<View style={{ flex: 1, padding: 24, gap: 12 }}>` → `<SafeAreaView style={{ flex: 1, padding: Spacing.xxl, gap: Spacing.md }}>` … `</SafeAreaView>`.
- Vignettes : `borderRadius: 8` → `Radii.sm`.
- Les 2 `Pressable` (Galerie / Appareil photo) : `color: '#208AEF'` → `Colors.primary` ; ajouter un retour visuel désactivé : `style={{ opacity: busy || isLoading ? 0.5 : 1 }}` sur le Pressable, et `accessibilityRole="button"` + `accessibilityLabel` (« Ajouter depuis la galerie » / « Prendre une photo »).
- `<Button title="Continuer" onPress={() => router.push('/(onboarding)/preferences')} disabled={count < 1 || busy} />` → `<AppButton title="Continuer" onPress={() => router.push('/(onboarding)/preferences')} disabled={count < 1 || busy} />`.

- [ ] **Step 3 : `location.tsx`**

Dans `app/(onboarding)/location.tsx` :
- Imports : retirer `Button` ; ajouter `SafeAreaView`, `AppButton`, `Spacing`.
- Conteneur racine `<View style={{ flex: 1, padding: 24, gap: 12, justifyContent: 'center' }}>` → `<SafeAreaView style={{ flex: 1, padding: Spacing.xxl, gap: Spacing.md, justifyContent: 'center' }}>` … `</SafeAreaView>`.
- `<Button title={busy ? '...' : 'Activer la localisation et terminer'} onPress={onFinish} disabled={busy} />` → `<AppButton title="Activer la localisation et terminer" onPress={onFinish} loading={busy} />`.

- [ ] **Step 4 : Vérifier compilation + tests**

Run: `npx tsc --noEmit && npm test`
Expected: 0 erreur ; toute la suite passe (dont `preferences-screen` : le bouton « Continuer » reste trouvable, les erreurs via `ErrorText`).

- [ ] **Step 5 : Commit**

```bash
git add app/(onboarding)/preferences.tsx app/(onboarding)/photos.tsx app/(onboarding)/location.tsx
git commit -m "feat(plan-8): onboarding preferences/photos/location — AppButton, SafeArea, thème"
```

---

## Vérification finale (après toutes les tâches)

- [ ] `npx tsc --noEmit` → 0 erreur.
- [ ] `npm test` → toute la suite verte.
- [ ] Recherche de littéraux résiduels (doit être quasi vide hors `theme.ts`) :
  `grep -rn "#208AEF\|#E53935\|'#ccc'\|'#ddd'\|color: 'red'" src/ app/ | grep -v theme.ts`
- [ ] Vérifs **device** (nouveau build) : clavier du chat ne recouvre plus la saisie, icônes d'onglets, SafeArea sur auth/onboarding, spinners des boutons, compte à rebours `05:00`.

---

## Self-Review

- **Couverture spec :** tu/vous (T9/T11), thème (T1 + appliqué partout), AppButton/EmptyState/ErrorText (T2/T3/T4), états vides/chargement/erreur (T3 + matches T11 + chat T9 + gender spinner T13 + deck T10), accessibilité (ChatInput T8, DeckCard T10, photos T14), compte à rebours mm:ss (T6), icônes d'onglets (T7), SafeArea + StatusBar (T5 + SafeAreaView par écran T12-14), carrousel photo (T10), clavier du chat (T9), feedback de press (T11/T13/T14). Hors-périmètre (InputField/SelectButton, menu↔swipe, emojis chat) non touchés — conforme.
- **Placeholders :** aucun ; code complet ou recette de remplacement exacte (imports + littéraux ciblés) par fichier.
- **Cohérence des types :** `Colors/Spacing/Radii/FontSizes` (T1) réutilisés tels quels ; API `AppButton` (`title/onPress/loading/disabled/variant`), `ErrorText` (`message`), `EmptyState` (`icon/title/message/actionLabel/onAction`) identiques entre définition et usages. `useSafeAreaInsets` dispo car `SafeAreaProvider` ajouté en T5 avant son usage en T9.
- **Tests existants à surveiller :** `match-modal` (phrase du modal — mettre à jour l'assertion si elle vérifie l'ancien texte « vous êtes likés »), `identity-screen`/`preferences-screen` (boutons trouvés par texte — OK avec `AppButton`). Mock jest safe-area ajouté en T5 pour ne pas casser les écrans rendus.
