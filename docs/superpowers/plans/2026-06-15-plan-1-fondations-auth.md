# Plan 1 — Fondations & Auth — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mettre en place le squelette de l'app Expo + Supabase et un flux d'authentification complet (email/mot de passe + Apple + Google) avec session persistée et routes gardées.

**Architecture:** App Expo Router (file-based). Supabase managé pour l'auth ; le client Supabase est initialisé une seule fois avec un stockage de session chiffré (`LargeSecureStore` : clé AES-256 dans `expo-secure-store`, valeur chiffrée dans AsyncStorage). Un `SessionProvider` écoute `onAuthStateChange` et expose la session ; le layout racine garde les routes via `Stack.Protected`. La logique pure (validation, mapping de session, mapping d'erreurs) est testée en unitaire ; les briques natives sont vérifiées en exécution.

**Tech Stack:** Expo SDK 56, Expo Router, TypeScript, `@supabase/supabase-js`, `expo-secure-store` + AsyncStorage + `aes-js`, `expo-apple-authentication`, `@react-native-google-signin/google-signin`, Supabase CLI (dev local + génération de types), Jest (`jest-expo`) + `@testing-library/react-native`.

**Spec de référence :** `docs/superpowers/specs/2026-06-15-tinder-en-mieux-mvp-design.md` (§2, §3, §4 « Auth », §5 partie scaffolding).

---

## Structure de fichiers (cible à la fin du Plan 1)

```
.
├── app/                          # routes Expo Router
│   ├── _layout.tsx               # layout racine : SessionProvider + Stack.Protected
│   ├── (auth)/
│   │   ├── _layout.tsx           # stack des écrans non authentifiés
│   │   ├── sign-in.tsx           # connexion (email + Apple + Google)
│   │   └── sign-up.tsx           # inscription email
│   └── (tabs)/
│       ├── _layout.tsx           # 3 onglets placeholder
│       ├── index.tsx             # Deck (placeholder)
│       ├── matches.tsx           # Matchs (placeholder)
│       └── profile.tsx           # Profil (placeholder, bouton Déconnexion)
├── src/
│   ├── lib/
│   │   ├── supabase.ts           # client Supabase + LargeSecureStore
│   │   └── env.ts                # lecture/validation des variables d'env
│   ├── features/auth/
│   │   ├── session-provider.tsx  # contexte de session + onAuthStateChange
│   │   ├── auth-api.ts           # wrappers signInWithPassword / signUp / Apple / Google / signOut
│   │   ├── validation.ts         # validation email/mot de passe (pur)
│   │   └── errors.ts             # mapping erreurs Supabase -> messages FR (pur)
│   └── types/database.ts         # types générés depuis Supabase (généré, non édité à la main)
├── supabase/                     # config Supabase CLI + migrations (dev local)
├── app.json                      # config Expo (plugins natifs)
├── .env.local                    # EXPO_PUBLIC_SUPABASE_URL / _KEY (non commité)
├── .env.example                  # gabarit commité
├── jest.config.js
└── jest.setup.ts
```

---

## Task 1: Scaffolder le projet Expo dans le repo existant

Le dossier contient déjà `.git/` et `docs/`. On scaffolde dans un dossier temporaire puis on rapatrie, pour ne rien écraser.

**Files:**
- Create: tout le squelette Expo (`app/`, `app.json`, `package.json`, `tsconfig.json`, etc.)

- [ ] **Step 1: Scaffolder dans un dossier temporaire**

Run :
```bash
cd /mnt/0EBD140D0EBD140D/codeperso/tinder-en-mieux
npx create-expo-app@latest .expo-init --template default
```
Expected : un dossier `.expo-init/` créé avec une app Expo Router TypeScript.

- [ ] **Step 2: Rapatrier les fichiers sans écraser `.git`/`docs`**

Run :
```bash
cd /mnt/0EBD140D0EBD140D/codeperso/tinder-en-mieux
# fichiers cachés inclus, sans .git
shopt -s dotglob
mv .expo-init/* .
rm -rf .expo-init
shopt -u dotglob
ls -a
```
Expected : `app/`, `package.json`, `tsconfig.json`, `app.json`, `.gitignore` présents à la racine, `.git/` et `docs/` intacts.

- [ ] **Step 3: Repartir d'un dossier `app/` propre**

Le template inclut un écran de démo. On le vide pour repartir sain.

Run :
```bash
cd /mnt/0EBD140D0EBD140D/codeperso/tinder-en-mieux
rm -rf app/* components/ constants/ hooks/ scripts/ 2>/dev/null
mkdir -p app src/lib src/features/auth src/types
```
Expected : `app/` vide, dossiers `src/...` créés.

- [ ] **Step 4: Écran d'accueil minimal pour vérifier le boot**

Create `app/_layout.tsx` :
```tsx
import { Stack } from 'expo-router';

export default function RootLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
```

Create `app/index.tsx` :
```tsx
import { Text, View } from 'react-native';

export default function Index() {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      <Text>tinder-en-mieux — boot OK</Text>
    </View>
  );
}
```

- [ ] **Step 5: Vérifier que l'app démarre**

Run : `npx expo start --web` (ou scanner le QR pour un appareil).
Expected : l'écran affiche « tinder-en-mieux — boot OK » sans erreur de bundling. Arrêter avec Ctrl-C.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: scaffold Expo Router app dans le repo"
```

---

## Task 2: Configuration de test (Jest + RNTL)

**Files:**
- Create: `jest.config.js`, `jest.setup.ts`
- Modify: `package.json` (script `test`)
- Test: `src/features/auth/validation.test.ts` (sanity check de l'infra)

- [ ] **Step 1: Installer les dépendances de test**

Run :
```bash
npx expo install jest-expo
npm install --save-dev jest @testing-library/react-native @types/jest
```
Expected : installation sans erreur.

- [ ] **Step 2: Configurer Jest**

Create `jest.config.js` :
```js
module.exports = {
  preset: 'jest-expo',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@unimodules/.*|unimodules|sentry-expo|native-base|react-native-svg|@supabase/.*|@react-native-google-signin/.*))',
  ],
};
```

Create `jest.setup.ts` :
```ts
import '@testing-library/react-native';
```

- [ ] **Step 3: Ajouter le script de test**

Modify `package.json` — dans `"scripts"`, ajouter :
```json
"test": "jest",
"test:watch": "jest --watch"
```

- [ ] **Step 4: Écrire un test sanity (qui échoue)**

Create `src/features/auth/validation.test.ts` :
```ts
import { isValidEmail } from './validation';

test('isValidEmail accepte une adresse valide', () => {
  expect(isValidEmail('a@b.co')).toBe(true);
});
```

- [ ] **Step 5: Lancer le test pour vérifier l'échec**

Run : `npm test -- validation`
Expected : FAIL — `Cannot find module './validation'`.

- [ ] **Step 6: Implémentation minimale**

Create `src/features/auth/validation.ts` :
```ts
export function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}
```

- [ ] **Step 7: Lancer le test pour vérifier le succès**

Run : `npm test -- validation`
Expected : PASS.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "chore: configuration Jest + RNTL"
```

---

## Task 3: Validation des entrées (pure, TDD)

**Files:**
- Modify: `src/features/auth/validation.ts`
- Test: `src/features/auth/validation.test.ts`

- [ ] **Step 1: Étendre les tests (échec)**

Modify `src/features/auth/validation.test.ts` — ajouter :
```ts
import { isValidEmail, isValidPassword, validateCredentials } from './validation';

test('isValidEmail rejette une adresse sans domaine', () => {
  expect(isValidEmail('a@b')).toBe(false);
});

test('isValidPassword exige au moins 8 caractères', () => {
  expect(isValidPassword('1234567')).toBe(false);
  expect(isValidPassword('12345678')).toBe(true);
});

test('validateCredentials renvoie les erreurs par champ', () => {
  expect(validateCredentials('bad', 'short')).toEqual({
    email: 'Adresse e-mail invalide.',
    password: 'Le mot de passe doit faire au moins 8 caractères.',
  });
  expect(validateCredentials('a@b.co', '12345678')).toEqual({});
});
```

- [ ] **Step 2: Lancer (échec)**

Run : `npm test -- validation`
Expected : FAIL — `isValidPassword`/`validateCredentials` non définis.

- [ ] **Step 3: Implémenter**

Modify `src/features/auth/validation.ts` — ajouter :
```ts
export function isValidPassword(value: string): boolean {
  return value.length >= 8;
}

export type CredentialErrors = { email?: string; password?: string };

export function validateCredentials(email: string, password: string): CredentialErrors {
  const errors: CredentialErrors = {};
  if (!isValidEmail(email)) errors.email = 'Adresse e-mail invalide.';
  if (!isValidPassword(password)) errors.password = 'Le mot de passe doit faire au moins 8 caractères.';
  return errors;
}
```

- [ ] **Step 4: Lancer (succès)**

Run : `npm test -- validation`
Expected : PASS (tous les tests).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: validation des identifiants (email/mot de passe)"
```

---

## Task 4: Mapping des erreurs Supabase en messages FR (pure, TDD)

**Files:**
- Create: `src/features/auth/errors.ts`
- Test: `src/features/auth/errors.test.ts`

- [ ] **Step 1: Test (échec)**

Create `src/features/auth/errors.test.ts` :
```ts
import { authErrorMessage } from './errors';

test('messages connus traduits en français', () => {
  expect(authErrorMessage('Invalid login credentials')).toBe('E-mail ou mot de passe incorrect.');
  expect(authErrorMessage('User already registered')).toBe('Un compte existe déjà avec cet e-mail.');
});

test('message inconnu -> message générique', () => {
  expect(authErrorMessage('some unmapped error')).toBe('Une erreur est survenue. Réessaie.');
});

test('null/undefined -> message générique', () => {
  expect(authErrorMessage(undefined)).toBe('Une erreur est survenue. Réessaie.');
});
```

- [ ] **Step 2: Lancer (échec)**

Run : `npm test -- errors`
Expected : FAIL — `Cannot find module './errors'`.

- [ ] **Step 3: Implémenter**

Create `src/features/auth/errors.ts` :
```ts
const MAP: Record<string, string> = {
  'Invalid login credentials': 'E-mail ou mot de passe incorrect.',
  'User already registered': 'Un compte existe déjà avec cet e-mail.',
  'Email not confirmed': 'Confirme ton e-mail avant de te connecter.',
};

const GENERIC = 'Une erreur est survenue. Réessaie.';

export function authErrorMessage(message?: string | null): string {
  if (!message) return GENERIC;
  return MAP[message] ?? GENERIC;
}
```

- [ ] **Step 4: Lancer (succès)**

Run : `npm test -- errors`
Expected : PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: mapping des erreurs auth en messages FR"
```

---

## Task 5: Variables d'environnement

**Files:**
- Create: `src/lib/env.ts`, `.env.example`
- Create: `.env.local` (non commité)
- Test: `src/lib/env.test.ts`

- [ ] **Step 1: Test (échec)**

Create `src/lib/env.test.ts` :
```ts
import { readEnv } from './env';

test('readEnv renvoie les valeurs présentes', () => {
  expect(readEnv({ EXPO_PUBLIC_SUPABASE_URL: 'https://x.supabase.co', EXPO_PUBLIC_SUPABASE_KEY: 'k' }))
    .toEqual({ supabaseUrl: 'https://x.supabase.co', supabaseKey: 'k' });
});

test('readEnv lève une erreur si une variable manque', () => {
  expect(() => readEnv({ EXPO_PUBLIC_SUPABASE_URL: 'https://x.supabase.co' }))
    .toThrow('EXPO_PUBLIC_SUPABASE_KEY');
});
```

- [ ] **Step 2: Lancer (échec)**

Run : `npm test -- env`
Expected : FAIL — `Cannot find module './env'`.

- [ ] **Step 3: Implémenter**

Create `src/lib/env.ts` :
```ts
type RawEnv = Record<string, string | undefined>;

export function readEnv(raw: RawEnv = process.env as RawEnv) {
  const supabaseUrl = raw.EXPO_PUBLIC_SUPABASE_URL;
  const supabaseKey = raw.EXPO_PUBLIC_SUPABASE_KEY;
  if (!supabaseUrl) throw new Error('Variable manquante : EXPO_PUBLIC_SUPABASE_URL');
  if (!supabaseKey) throw new Error('Variable manquante : EXPO_PUBLIC_SUPABASE_KEY');
  return { supabaseUrl, supabaseKey };
}

export const env = readEnv();
```

- [ ] **Step 4: Lancer (succès)**

Run : `npm test -- env`
Expected : PASS.

- [ ] **Step 5: Créer les fichiers d'environnement**

Create `.env.example` :
```
EXPO_PUBLIC_SUPABASE_URL=
EXPO_PUBLIC_SUPABASE_KEY=
```

Create `.env.local` (valeurs réelles obtenues à la Task 6, étape config Supabase ; non commité) :
```
EXPO_PUBLIC_SUPABASE_URL=__à_remplir__
EXPO_PUBLIC_SUPABASE_KEY=__à_remplir__
```

- [ ] **Step 6: Vérifier que `.env.local` est ignoré par git**

Run : `grep -q '.env.local' .gitignore || echo '.env.local' >> .gitignore; git check-ignore .env.local`
Expected : la commande affiche `.env.local` (donc bien ignoré).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: lecture/validation des variables d'environnement"
```

---

## Task 6: Supabase local + génération de types

On utilise le CLI Supabase en **dev local** (Docker) pour des migrations testables, et on remplit `.env.local`.

**Files:**
- Create: `supabase/` (via CLI), `src/types/database.ts` (généré)
- Modify: `.env.local`, `package.json` (scripts)

- [ ] **Step 1: Installer le CLI et initialiser**

Run :
```bash
cd /mnt/0EBD140D0EBD140D/codeperso/tinder-en-mieux
npm install --save-dev supabase
npx supabase init
```
Expected : dossier `supabase/` créé avec `config.toml`.

- [ ] **Step 2: Démarrer la stack locale**

Run : `npx supabase start`
Expected : sortie listant `API URL` (ex. `http://127.0.0.1:54321`), `anon key`, `service_role key`. **Noter l'`API URL` et l'`anon key`.**

- [ ] **Step 3: Remplir `.env.local`**

Modify `.env.local` avec les valeurs de l'étape 2 :
```
EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
EXPO_PUBLIC_SUPABASE_KEY=<anon key affichée par supabase start>
```

- [ ] **Step 4: Ajouter les scripts de types**

Modify `package.json` — dans `"scripts"`, ajouter :
```json
"db:types": "supabase gen types typescript --local > src/types/database.ts",
"db:reset": "supabase db reset"
```

- [ ] **Step 5: Générer les types initiaux**

Run : `npm run db:types`
Expected : `src/types/database.ts` créé (type `Database` présent même si schéma quasi vide).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: Supabase local + pipeline de génération de types"
```

---

## Task 7: Client Supabase avec stockage de session chiffré

**Files:**
- Create: `src/lib/supabase.ts`
- Modify: `package.json` (dépendances)

- [ ] **Step 1: Installer les dépendances**

Run :
```bash
npx expo install @supabase/supabase-js @react-native-async-storage/async-storage expo-secure-store react-native-url-polyfill react-native-get-random-values
npm install aes-js
npm install --save-dev @types/aes-js
```
Expected : installation sans erreur.

- [ ] **Step 2: Implémenter le client (LargeSecureStore)**

Create `src/lib/supabase.ts` :
```ts
import 'react-native-url-polyfill/auto';
import 'react-native-get-random-values';
import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import * as aesjs from 'aes-js';
import { env } from './env';
import type { Database } from '../types/database';

// expo-secure-store ne stocke pas >2048 octets : on garde une clé AES-256 dans
// SecureStore et on chiffre la valeur (la session) dans AsyncStorage.
class LargeSecureStore {
  private async _encrypt(key: string, value: string) {
    const encryptionKey = crypto.getRandomValues(new Uint8Array(256 / 8));
    const cipher = new aesjs.ModeOfOperation.ctr(encryptionKey, new aesjs.Counter(1));
    const encryptedBytes = cipher.encrypt(aesjs.utils.utf8.toBytes(value));
    await SecureStore.setItemAsync(key, aesjs.utils.hex.fromBytes(encryptionKey));
    return aesjs.utils.hex.fromBytes(encryptedBytes);
  }

  private async _decrypt(key: string, value: string) {
    const encryptionKeyHex = await SecureStore.getItemAsync(key);
    if (!encryptionKeyHex) return null;
    const cipher = new aesjs.ModeOfOperation.ctr(aesjs.utils.hex.toBytes(encryptionKeyHex), new aesjs.Counter(1));
    const decryptedBytes = cipher.decrypt(aesjs.utils.hex.toBytes(value));
    return aesjs.utils.utf8.fromBytes(decryptedBytes);
  }

  async getItem(key: string) {
    const encrypted = await AsyncStorage.getItem(key);
    if (!encrypted) return null;
    return this._decrypt(key, encrypted);
  }

  async removeItem(key: string) {
    await AsyncStorage.removeItem(key);
    await SecureStore.deleteItemAsync(key);
  }

  async setItem(key: string, value: string) {
    const encrypted = await this._encrypt(key, value);
    await AsyncStorage.setItem(key, encrypted);
  }
}

export const supabase = createClient<Database>(env.supabaseUrl, env.supabaseKey, {
  auth: {
    storage: new LargeSecureStore(),
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
```

- [ ] **Step 3: Vérifier le typage**

Run : `npx tsc --noEmit`
Expected : pas d'erreur de type (le client est typé avec `Database`).

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: client Supabase avec session chiffrée (LargeSecureStore)"
```

---

## Task 8: Wrappers d'API d'authentification

**Files:**
- Create: `src/features/auth/auth-api.ts`

- [ ] **Step 1: Implémenter les wrappers**

Ces fonctions encapsulent les appels Supabase ; les écrans n'appellent jamais `supabase.auth` directement. (Pas de test unitaire ici : ce sont de fines délégations au SDK, vérifiées en exécution aux Tasks 11-13.)

Create `src/features/auth/auth-api.ts` :
```ts
import { supabase } from '../../lib/supabase';

export async function signInWithEmail(email: string, password: string) {
  const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
  if (error) throw error;
}

export async function signUpWithEmail(email: string, password: string) {
  const { error } = await supabase.auth.signUp({ email: email.trim(), password });
  if (error) throw error;
}

export async function signInWithAppleIdToken(identityToken: string) {
  const { error } = await supabase.auth.signInWithIdToken({ provider: 'apple', token: identityToken });
  if (error) throw error;
}

export async function signInWithGoogleIdToken(idToken: string) {
  const { error } = await supabase.auth.signInWithIdToken({ provider: 'google', token: idToken });
  if (error) throw error;
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}
```

- [ ] **Step 2: Vérifier le typage**

Run : `npx tsc --noEmit`
Expected : pas d'erreur.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat: wrappers d'API d'authentification"
```

---

## Task 9: SessionProvider (contexte de session)

**Files:**
- Create: `src/features/auth/session-provider.tsx`
- Test: `src/features/auth/session-provider.test.tsx`

- [ ] **Step 1: Test du provider (échec)**

On teste que le provider expose `loading=true` au départ, puis la session émise par `onAuthStateChange`. On mocke `supabase`.

Create `src/features/auth/session-provider.test.tsx` :
```tsx
import { render, screen, act } from '@testing-library/react-native';
import { Text } from 'react-native';
import { SessionProvider, useSession } from './session-provider';

let authCallback: (event: string, session: unknown) => void = () => {};

jest.mock('../../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: jest.fn().mockResolvedValue({ data: { session: null } }),
      onAuthStateChange: (cb: (e: string, s: unknown) => void) => {
        authCallback = cb;
        return { data: { subscription: { unsubscribe: jest.fn() } } };
      },
    },
  },
}));

function Probe() {
  const { session, loading } = useSession();
  return <Text>{loading ? 'loading' : session ? 'in' : 'out'}</Text>;
}

test('expose loading puis l\'état de session', async () => {
  render(
    <SessionProvider>
      <Probe />
    </SessionProvider>,
  );
  // après résolution de getSession -> "out"
  expect(await screen.findByText('out')).toBeTruthy();

  await act(async () => {
    authCallback('SIGNED_IN', { user: { id: '1' } });
  });
  expect(screen.getByText('in')).toBeTruthy();
});
```

- [ ] **Step 2: Lancer (échec)**

Run : `npm test -- session-provider`
Expected : FAIL — `Cannot find module './session-provider'`.

- [ ] **Step 3: Implémenter**

Create `src/features/auth/session-provider.tsx` :
```tsx
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../../lib/supabase';

type SessionContextValue = { session: Session | null; loading: boolean };

const SessionContext = createContext<SessionContextValue>({ session: null, loading: true });

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      setLoading(false);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  return <SessionContext.Provider value={{ session, loading }}>{children}</SessionContext.Provider>;
}

export function useSession() {
  return useContext(SessionContext);
}
```

- [ ] **Step 4: Lancer (succès)**

Run : `npm test -- session-provider`
Expected : PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: SessionProvider basé sur onAuthStateChange"
```

---

## Task 10: Layout racine avec routes gardées + auto-refresh

**Files:**
- Modify: `app/_layout.tsx`
- Create: `app/(auth)/_layout.tsx`, `app/(tabs)/_layout.tsx`
- Delete: `app/index.tsx` (remplacé par les groupes de routes)

- [ ] **Step 1: Brancher auto-refresh sur l'état de l'app**

Modify `src/lib/supabase.ts` — ajouter en bas du fichier :
```ts
import { AppState } from 'react-native';

// Rafraîchit la session tant que l'app est au premier plan.
AppState.addEventListener('change', (state) => {
  if (state === 'active') supabase.auth.startAutoRefresh();
  else supabase.auth.stopAutoRefresh();
});
```

- [ ] **Step 2: Layout racine avec `Stack.Protected`**

Delete `app/index.tsx` :
```bash
rm app/index.tsx
```

Modify `app/_layout.tsx` :
```tsx
import { Stack } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';
import { SessionProvider, useSession } from '../src/features/auth/session-provider';

function RootNavigator() {
  const { session, loading } = useSession();

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={!!session}>
        <Stack.Screen name="(tabs)" />
      </Stack.Protected>
      <Stack.Protected guard={!session}>
        <Stack.Screen name="(auth)" />
      </Stack.Protected>
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <SessionProvider>
      <RootNavigator />
    </SessionProvider>
  );
}
```

- [ ] **Step 3: Layout du groupe (auth)**

Create `app/(auth)/_layout.tsx` :
```tsx
import { Stack } from 'expo-router';

export default function AuthLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
```

- [ ] **Step 4: Layout des onglets (placeholders)**

Create `app/(tabs)/_layout.tsx` :
```tsx
import { Tabs } from 'expo-router';

export default function TabsLayout() {
  return (
    <Tabs>
      <Tabs.Screen name="index" options={{ title: 'Deck' }} />
      <Tabs.Screen name="matches" options={{ title: 'Matchs' }} />
      <Tabs.Screen name="profile" options={{ title: 'Profil' }} />
    </Tabs>
  );
}
```

- [ ] **Step 5: Vérifier le typage**

Run : `npx tsc --noEmit`
Expected : pas d'erreur (les écrans des onglets sont créés à la Task 14, mais Expo Router ne casse pas le typage si absents ; s'il y a une erreur de route manquante, elle se résout après la Task 14).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: layout racine, routes gardées et auto-refresh de session"
```

---

## Task 11: Écran d'inscription (email)

**Files:**
- Create: `app/(auth)/sign-up.tsx`

- [ ] **Step 1: Implémenter l'écran**

Create `app/(auth)/sign-up.tsx` :
```tsx
import { useState } from 'react';
import { Alert, Button, Text, TextInput, View } from 'react-native';
import { Link } from 'expo-router';
import { validateCredentials } from '../../src/features/auth/validation';
import { authErrorMessage } from '../../src/features/auth/errors';
import { signUpWithEmail } from '../../src/features/auth/auth-api';

export default function SignUp() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});
  const [busy, setBusy] = useState(false);

  async function onSubmit() {
    const found = validateCredentials(email, password);
    setErrors(found);
    if (found.email || found.password) return;
    setBusy(true);
    try {
      await signUpWithEmail(email, password);
      Alert.alert('Compte créé', 'Vérifie ton e-mail si une confirmation est requise.');
    } catch (e: any) {
      Alert.alert('Inscription', authErrorMessage(e?.message));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={{ flex: 1, justifyContent: 'center', padding: 24, gap: 12 }}>
      <Text style={{ fontSize: 24, fontWeight: '700' }}>Créer un compte</Text>
      <TextInput
        placeholder="E-mail"
        autoCapitalize="none"
        keyboardType="email-address"
        value={email}
        onChangeText={setEmail}
        style={{ borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 12 }}
      />
      {errors.email ? <Text style={{ color: 'red' }}>{errors.email}</Text> : null}
      <TextInput
        placeholder="Mot de passe"
        secureTextEntry
        value={password}
        onChangeText={setPassword}
        style={{ borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 12 }}
      />
      {errors.password ? <Text style={{ color: 'red' }}>{errors.password}</Text> : null}
      <Button title={busy ? '...' : "S'inscrire"} onPress={onSubmit} disabled={busy} />
      <Link href="/sign-in">Déjà un compte ? Se connecter</Link>
    </View>
  );
}
```

- [ ] **Step 2: Vérifier le typage**

Run : `npx tsc --noEmit`
Expected : pas d'erreur.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat: écran d'inscription email"
```

---

## Task 12: Écran de connexion (email + Apple + Google)

**Files:**
- Create: `app/(auth)/sign-in.tsx`
- Modify: `package.json` (dépendances natives), `app.json` (plugins)

- [ ] **Step 1: Installer les dépendances natives**

Run :
```bash
npx expo install expo-apple-authentication @react-native-google-signin/google-signin
```
Expected : installation sans erreur.

- [ ] **Step 2: Déclarer les plugins natifs**

Modify `app.json` — dans `expo.plugins`, ajouter (créer le tableau s'il n'existe pas) :
```json
"plugins": [
  "expo-router",
  "expo-secure-store",
  "expo-apple-authentication",
  "@react-native-google-signin/google-signin"
]
```
Et dans `expo.ios`, activer Apple :
```json
"ios": {
  "usesAppleSignIn": true
}
```

- [ ] **Step 3: Implémenter l'écran de connexion**

Create `app/(auth)/sign-in.tsx` :
```tsx
import { useState } from 'react';
import { Alert, Button, Platform, Text, TextInput, View } from 'react-native';
import { Link } from 'expo-router';
import * as AppleAuthentication from 'expo-apple-authentication';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import { validateCredentials } from '../../src/features/auth/validation';
import { authErrorMessage } from '../../src/features/auth/errors';
import {
  signInWithEmail,
  signInWithAppleIdToken,
  signInWithGoogleIdToken,
} from '../../src/features/auth/auth-api';

GoogleSignin.configure({
  webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
});

export default function SignIn() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});
  const [busy, setBusy] = useState(false);

  async function onEmailSubmit() {
    const found = validateCredentials(email, password);
    setErrors(found);
    if (found.email || found.password) return;
    setBusy(true);
    try {
      await signInWithEmail(email, password);
    } catch (e: any) {
      Alert.alert('Connexion', authErrorMessage(e?.message));
    } finally {
      setBusy(false);
    }
  }

  async function onApple() {
    try {
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      });
      if (!credential.identityToken) throw new Error('No identityToken.');
      await signInWithAppleIdToken(credential.identityToken);
    } catch (e: any) {
      if (e?.code === 'ERR_REQUEST_CANCELED') return;
      Alert.alert('Apple', authErrorMessage(e?.message));
    }
  }

  async function onGoogle() {
    try {
      await GoogleSignin.hasPlayServices();
      const response = await GoogleSignin.signIn();
      const idToken = response.data?.idToken;
      if (!idToken) throw new Error('No idToken.');
      await signInWithGoogleIdToken(idToken);
    } catch (e: any) {
      Alert.alert('Google', authErrorMessage(e?.message));
    }
  }

  return (
    <View style={{ flex: 1, justifyContent: 'center', padding: 24, gap: 12 }}>
      <Text style={{ fontSize: 24, fontWeight: '700' }}>Connexion</Text>
      <TextInput
        placeholder="E-mail"
        autoCapitalize="none"
        keyboardType="email-address"
        value={email}
        onChangeText={setEmail}
        style={{ borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 12 }}
      />
      {errors.email ? <Text style={{ color: 'red' }}>{errors.email}</Text> : null}
      <TextInput
        placeholder="Mot de passe"
        secureTextEntry
        value={password}
        onChangeText={setPassword}
        style={{ borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 12 }}
      />
      {errors.password ? <Text style={{ color: 'red' }}>{errors.password}</Text> : null}
      <Button title={busy ? '...' : 'Se connecter'} onPress={onEmailSubmit} disabled={busy} />

      {Platform.OS === 'ios' ? (
        <AppleAuthentication.AppleAuthenticationButton
          buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
          buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
          cornerRadius={8}
          style={{ height: 48 }}
          onPress={onApple}
        />
      ) : null}

      <Button title="Continuer avec Google" onPress={onGoogle} />

      <Link href="/sign-up">Pas de compte ? S'inscrire</Link>
    </View>
  );
}
```

- [ ] **Step 4: Ajouter la variable Google au gabarit d'env**

Modify `.env.example` — ajouter :
```
EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=
```
Et renseigner la vraie valeur dans `.env.local` (Web Client ID depuis la console Google Cloud, configuré comme provider Google dans Supabase Auth).

- [ ] **Step 5: Vérifier le typage**

Run : `npx tsc --noEmit`
Expected : pas d'erreur.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: écran de connexion email + Apple + Google"
```

---

## Task 13: Écrans placeholder des onglets + déconnexion

**Files:**
- Create: `app/(tabs)/index.tsx`, `app/(tabs)/matches.tsx`, `app/(tabs)/profile.tsx`

- [ ] **Step 1: Deck placeholder**

Create `app/(tabs)/index.tsx` :
```tsx
import { Text, View } from 'react-native';

export default function Deck() {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      <Text>Deck (à venir — Plan 3)</Text>
    </View>
  );
}
```

- [ ] **Step 2: Matchs placeholder**

Create `app/(tabs)/matches.tsx` :
```tsx
import { Text, View } from 'react-native';

export default function Matches() {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      <Text>Matchs (à venir — Plan 5)</Text>
    </View>
  );
}
```

- [ ] **Step 3: Profil placeholder avec déconnexion**

Create `app/(tabs)/profile.tsx` :
```tsx
import { Alert, Button, Text, View } from 'react-native';
import { signOut } from '../../src/features/auth/auth-api';
import { authErrorMessage } from '../../src/features/auth/errors';

export default function Profile() {
  async function onSignOut() {
    try {
      await signOut();
    } catch (e: any) {
      Alert.alert('Déconnexion', authErrorMessage(e?.message));
    }
  }

  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16 }}>
      <Text>Profil (à venir — Plan 2)</Text>
      <Button title="Se déconnecter" onPress={onSignOut} />
    </View>
  );
}
```

- [ ] **Step 4: Vérifier le typage**

Run : `npx tsc --noEmit`
Expected : pas d'erreur.

- [ ] **Step 5: Lancer toute la suite de tests**

Run : `npm test`
Expected : PASS (validation, errors, env, session-provider).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: onglets placeholder + déconnexion"
```

---

## Task 14: Vérification de bout en bout (manuelle)

Pas de test automatisé : on valide le flux réel sur un build de dev (les modules natifs Apple/Google ne tournent pas sur Expo Go).

**Files:** aucun.

- [ ] **Step 1: Vérifier le flux email**

Run : `npx expo start` puis ouvrir l'app (build de dev ou web pour l'email).
Expected :
- non connecté → écrans `(auth)` (sign-in) affichés ;
- inscription email → puis connexion email → bascule automatique vers les onglets `(tabs)` ;
- onglet Profil → « Se déconnecter » → retour aux écrans `(auth)`.

- [ ] **Step 2: Vérifier la persistance de session**

Fermer puis rouvrir l'app en étant connecté.
Expected : on reste connecté (session lue depuis le stockage chiffré), atterrissage direct sur les onglets.

- [ ] **Step 3: Vérifier Apple/Google (build de dev)**

Sur un build de dev iOS : bouton Apple → connexion → onglets. Sur Android/iOS avec Google configuré : bouton Google → connexion → onglets.
Expected : connexion réussie et bascule vers `(tabs)`. (Si non configuré côté console, noter l'écart et traiter au moment du build de dev.)

- [ ] **Step 4: Commit (notes éventuelles)**

Si des ajustements de config ont été nécessaires :
```bash
git add -A
git commit -m "chore: ajustements config auth après vérification e2e"
```

---

## Self-Review (couverture du spec, périmètre Plan 1)

- **§2 stack / scaffolding** : Tasks 1, 2, 6, 7 (Expo Router, Jest, Supabase local, client typé). ✓
- **§3 principes** : types générés (Task 6), pas de secret en dur / env validé (Task 5), code par feature (`src/features/auth`). ✓
- **§4 Auth — email + Apple + Google, aucune logique maison** : Tasks 8, 11, 12 (wrappers Supabase, écrans). ✓
- **§4 Auth — session sécurisée** : Task 7 (LargeSecureStore) + Task 10 (auto-refresh). ✓
- **§5 navigation / squelette d'onglets** : Tasks 10, 13. ✓
- **Hors périmètre Plan 1 (traités dans les plans suivants)** : profils/photos/préférences (Plan 2), deck/swipe (Plan 3), matching/expiration (Plan 4), chat (Plan 5), push (Plan 6), block/report (Plan 7). Volontairement absents ici.

Pas de placeholder de plan détecté (chaque étape de code contient son code). Cohérence des noms vérifiée : `validateCredentials`/`isValidEmail`/`isValidPassword` (Task 3), `authErrorMessage` (Task 4), `signInWithEmail`/`signUpWithEmail`/`signInWithAppleIdToken`/`signInWithGoogleIdToken`/`signOut` (Task 8), `useSession`/`SessionProvider` (Task 9) — utilisés de façon identique dans les Tasks 10-13.
