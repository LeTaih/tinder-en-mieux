# Plan 5 — Chat temps réel — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permettre à deux personnes matchées d'échanger des messages texte et photo en temps réel, avec reset du timer 1 h à chaque message et passage en lecture seule à l'expiration.

**Architecture:** Backend Supabase only (pas de SaaS, pas de kit d'UI tiers). Table `messages` immuable, écrite exclusivement par une RPC de confiance `send_message` (`SECURITY DEFINER`) qui vérifie participant + match actif, insère le message et ramène `matches.expires_at` à `now() + 60 min`. Les deux participants lisent via RLS, reçoivent les nouveaux messages via Supabase Realtime `postgres_changes`, et affichent les photos via URLs signées du bucket privé `chat-media`. UI custom légère (FlatList + bulle + barre de saisie).

**Tech Stack:** Expo SDK 56 (RN 0.85.3, React 19.2.3, Expo Router 56), TypeScript, Supabase (Postgres + RLS + Realtime + Storage), @tanstack/react-query v5, expo-image-manipulator, expo-image-picker, expo-crypto. Tests : jest-expo + @testing-library/react-native (les tests vivent dans `src/`, jamais dans `app/`).

**Spec :** `docs/superpowers/specs/2026-06-15-plan-5-chat-temps-reel-design.md`

---

## Contexte pour l'ingénieur (à lire avant de commencer)

- **Docker est indisponible.** Les migrations SQL ne sont **pas** poussées via `supabase db push`. L'ingénieur écrit le fichier de migration, puis **le développeur l'applique manuellement via le SQL Editor du dashboard Supabase** (le projet a été initialisé ainsi ; un `db push` rejouerait tout et planterait). Les « tests » de la Task 1 sont donc des requêtes SQL de vérification à lancer dans le SQL Editor, pas des tests jest.
- **Pattern d'écriture sécurisée du projet :** toutes les écritures sensibles passent par des fonctions `SECURITY DEFINER` cantonnées à `auth.uid()` (cf. `record_swipe`, `set_my_location`). On ne donne **aucune** policy d'`insert`/`update`/`delete` au client sur les tables sensibles (`matches`, `messages`).
- **Pattern d'upload d'image** (référence : `app/(onboarding)/photos.tsx`) : permission → `ImagePicker.launch…Async` → `ImageManipulator.manipulateAsync(uri, [{resize:{width}}], {compress, format: JPEG, base64:true})` → `Uint8Array.from(atob(base64), c => c.charCodeAt(0))` → `supabase.storage.from(bucket).upload(path, bytes, {contentType:'image/jpeg'})`. Constantes `PHOTO_MAX_DIMENSION = 1080`, `PHOTO_COMPRESS = 0.7` dans `src/features/profile/image.ts`. `randomUUID` vient de `expo-crypto`. En tête de fichier qui décode du base64 : `declare const atob: (s: string) => string;`.
- **Tests RNTL** : importer le composant et le rendre ; mocker les modules réseau (`jest.mock('./chat-image', …)`). Voir `src/features/profile/identity-screen.test.tsx`.
- **Commandes de test** : `npx jest <chemin>` (ex. `npx jest src/features/chat/chat-format.test.ts`).

---

## File Structure

**Backend / types**
- Create `supabase/migrations/20260615150000_plan5_chat.sql` — `messages` + RLS, `send_message` RPC, `matches.last_message_at`, bucket `chat-media` + policies, publication Realtime.
- Modify `src/types/database.ts` — ajoute la table `messages`, la colonne `matches.last_message_at`, la fonction `send_message`.

**Feature client `src/features/chat/`**
- Create `chat-format.ts` — logique **pure** (type `Message`, `expiresAtFromMessage`, `sortAndDedupe`, `isImageMessage`). Zéro import → testable sans charger d'expo.
- Create `chat-format.test.ts` — tests unitaires de la logique pure.
- Create `chat-image.ts` — `signedChatImageUrl(path)` (import `supabase` uniquement ; sert à l'affichage).
- Create `chat-api.ts` — `fetchMessages`, `sendText`, `sendImage` (compression + upload + RPC).
- Create `use-chat.ts` — `useMessages` (query + abonnement Realtime), `useSendMessage` (mutation + rendu optimiste).
- Create `MessageBubble.tsx` — bulle texte / image.
- Create `MessageBubble.test.tsx` — test RNTL léger.
- Create `ChatInput.tsx` — barre de saisie (texte + bouton photo).

**Écran / navigation**
- Create `app/match/[id].tsx` — écran de chat.
- Modify `app/_layout.tsx` — déclare la route `match/[id]` dans le bloc protégé des onglets.
- Modify `app/(tabs)/matches.tsx` — tap sur un match → navigue vers le chat.
- Modify `src/features/matches/MatchModal.tsx` — « Voir le match » → navigue vers le chat.

---

## Task 1 : Migration SQL + types

**Files:**
- Create: `supabase/migrations/20260615150000_plan5_chat.sql`
- Modify: `src/types/database.ts`

- [ ] **Step 1 : Écrire la migration**

Créer `supabase/migrations/20260615150000_plan5_chat.sql` :

```sql
-- ============ Colonne d'activité sur matches ============
alter table public.matches add column if not exists last_message_at timestamptz;

-- ============ Table des messages (texte XOR image) ============
create table public.messages (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  body text,
  image_path text,
  created_at timestamptz not null default now(),
  constraint messages_body_xor_image check (
    (body is not null and image_path is null) or
    (body is null and image_path is not null)
  )
);
create index messages_match_created_idx on public.messages (match_id, created_at);

alter table public.messages enable row level security;
-- Lecture réservée aux participants (match actif OU expiré -> archive consultable).
create policy "messages: select participant" on public.messages
  for select to authenticated
  using (exists (
    select 1 from public.matches m
    where m.id = messages.match_id and (m.user_a = auth.uid() or m.user_b = auth.uid())
  ));
-- Aucune policy insert/update/delete : écriture uniquement via send_message (SECURITY DEFINER).

-- ============ RPC d'envoi (sécurisée, serveur-autoritaire) ============
create function public.send_message(p_match_id uuid, p_body text, p_image_path text)
returns json
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_me uuid := auth.uid();
  v_msg public.messages;
begin
  if v_me is null then raise exception 'NOT_AUTHENTICATED'; end if;

  -- Participant + match actif (lecture seule à l'expiration garantie ici).
  if not exists (
    select 1 from public.matches m
    where m.id = p_match_id
      and (m.user_a = v_me or m.user_b = v_me)
      and m.expires_at > now()
  ) then
    if exists (
      select 1 from public.matches m
      where m.id = p_match_id and (m.user_a = v_me or m.user_b = v_me)
    ) then
      raise exception 'MATCH_EXPIRED';
    else
      raise exception 'NOT_A_PARTICIPANT';
    end if;
  end if;

  -- XOR texte/image.
  if (p_body is null and p_image_path is null)
     or (p_body is not null and p_image_path is not null) then
    raise exception 'INVALID_MESSAGE_CONTENT';
  end if;
  if p_body is not null and length(btrim(p_body)) = 0 then
    raise exception 'EMPTY_MESSAGE';
  end if;

  -- Une image doit vivre dans le dossier du match.
  if p_image_path is not null and split_part(p_image_path, '/', 1) <> p_match_id::text then
    raise exception 'INVALID_IMAGE_PATH';
  end if;

  insert into public.messages (match_id, sender_id, body, image_path)
    values (p_match_id, v_me, p_body, p_image_path)
    returning * into v_msg;

  -- Reset du timer (le coeur du produit).
  update public.matches
    set expires_at = now() + interval '60 minutes', last_message_at = now()
    where id = p_match_id;

  return json_build_object(
    'id', v_msg.id,
    'match_id', v_msg.match_id,
    'sender_id', v_msg.sender_id,
    'body', v_msg.body,
    'image_path', v_msg.image_path,
    'created_at', v_msg.created_at
  );
end;
$$;

revoke execute on function public.send_message(uuid, text, text) from public;
grant execute on function public.send_message(uuid, text, text) to authenticated;

-- ============ Storage : bucket privé chat-media + policies par participation ============
insert into storage.buckets (id, name, public)
values ('chat-media', 'chat-media', false)
on conflict (id) do nothing;

create policy "chat-media: select participant" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'chat-media'
    and exists (
      select 1 from public.matches m
      where m.id::text = (storage.foldername(name))[1]
        and (m.user_a = auth.uid() or m.user_b = auth.uid())
    )
  );
create policy "chat-media: insert participant actif" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'chat-media'
    and exists (
      select 1 from public.matches m
      where m.id::text = (storage.foldername(name))[1]
        and (m.user_a = auth.uid() or m.user_b = auth.uid())
        and m.expires_at > now()
    )
  );

-- ============ Realtime : diffuser les inserts de messages (gouverné par la RLS select) ============
alter publication supabase_realtime add table public.messages;
```

- [ ] **Step 2 : Mettre à jour les types — colonne `last_message_at` sur `matches`**

Dans `src/types/database.ts`, table `matches`, ajouter `last_message_at` (ordre alphabétique, juste après `id`) dans `Row`, `Insert` et `Update`.

`Row` :
```ts
      matches: {
        Row: {
          created_at: string
          expires_at: string
          id: string
          last_message_at: string | null
          user_a: string
          user_b: string
        }
```
`Insert` :
```ts
        Insert: {
          created_at?: string
          expires_at: string
          id?: string
          last_message_at?: string | null
          user_a: string
          user_b: string
        }
```
`Update` :
```ts
        Update: {
          created_at?: string
          expires_at?: string
          id?: string
          last_message_at?: string | null
          user_a?: string
          user_b?: string
        }
```

- [ ] **Step 3 : Mettre à jour les types — table `messages`**

Dans `src/types/database.ts`, insérer le bloc `messages` **juste après** la table `matches` (après son `]` de `Relationships` et son `}` fermant), avant `preference_genders` :

```ts
      messages: {
        Row: {
          body: string | null
          created_at: string
          id: string
          image_path: string | null
          match_id: string
          sender_id: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          id?: string
          image_path?: string | null
          match_id: string
          sender_id: string
        }
        Update: {
          body?: string | null
          created_at?: string
          id?: string
          image_path?: string | null
          match_id?: string
          sender_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
```

- [ ] **Step 4 : Mettre à jour les types — fonction `send_message`**

Dans `src/types/database.ts`, section `Functions`, insérer après `rewind_last_swipe` (avant `set_my_location`). `p_body`/`p_image_path` sont nullables côté appel :

```ts
      send_message: {
        Args: { p_body: string | null; p_image_path: string | null; p_match_id: string }
        Returns: Json
      }
```

- [ ] **Step 5 : Vérifier que le projet compile**

Run: `npx tsc --noEmit`
Expected: aucune erreur (les types ajoutés sont cohérents).

- [ ] **Step 6 : Commit**

```bash
git add supabase/migrations/20260615150000_plan5_chat.sql src/types/database.ts
git commit -m "feat(plan-5): schéma chat (messages, send_message, chat-media, realtime)"
```

- [ ] **Step 7 : APPLICATION CLOUD (action développeur, Docker indispo)**

Coller le contenu de `20260615150000_plan5_chat.sql` dans le **SQL Editor** du dashboard Supabase et exécuter. Puis vérifier dans le SQL Editor :

```sql
-- 1) la table et la contrainte XOR existent
select count(*) from public.messages;                       -- attendu : 0
-- 2) la fonction existe et est SECURITY DEFINER
select prosecdef from pg_proc where proname = 'send_message'; -- attendu : t
-- 3) le bucket est privé
select public from storage.buckets where id = 'chat-media';  -- attendu : f
-- 4) la table est dans la publication realtime
select 1 from pg_publication_tables
  where pubname = 'supabase_realtime' and tablename = 'messages'; -- attendu : 1 ligne
```

Aucune Edge Function à déployer pour ce plan.

---

## Task 2 : Logique pure `chat-format.ts` (TDD)

**Files:**
- Create: `src/features/chat/chat-format.ts`
- Test: `src/features/chat/chat-format.test.ts`

- [ ] **Step 1 : Écrire les tests qui échouent**

Créer `src/features/chat/chat-format.test.ts` :

```ts
import { expiresAtFromMessage, isImageMessage, sortAndDedupe, type Message } from './chat-format';

function msg(over: Partial<Message>): Message {
  return {
    id: 'x',
    match_id: 'm',
    sender_id: 'u',
    body: 'hi',
    image_path: null,
    created_at: '2026-06-15T12:00:00.000Z',
    ...over,
  };
}

test('expiresAtFromMessage ajoute 60 minutes', () => {
  expect(expiresAtFromMessage('2026-06-15T12:00:00.000Z')).toBe('2026-06-15T13:00:00.000Z');
});

test('isImageMessage true si image_path renseigné', () => {
  expect(isImageMessage(msg({ body: null, image_path: 'm/a.jpg' }))).toBe(true);
  expect(isImageMessage(msg({ body: 'coucou', image_path: null }))).toBe(false);
});

test('sortAndDedupe trie par created_at croissant', () => {
  const a = msg({ id: 'a', created_at: '2026-06-15T12:00:02.000Z' });
  const b = msg({ id: 'b', created_at: '2026-06-15T12:00:01.000Z' });
  expect(sortAndDedupe([a, b]).map((m) => m.id)).toEqual(['b', 'a']);
});

test('sortAndDedupe enlève les doublons par id (garde le dernier vu)', () => {
  const a1 = msg({ id: 'a', body: 'v1' });
  const a2 = msg({ id: 'a', body: 'v2' });
  const out = sortAndDedupe([a1, a2]);
  expect(out).toHaveLength(1);
  expect(out[0].body).toBe('v2');
});
```

- [ ] **Step 2 : Lancer le test, vérifier qu'il échoue**

Run: `npx jest src/features/chat/chat-format.test.ts`
Expected: FAIL — `Cannot find module './chat-format'`.

- [ ] **Step 3 : Écrire l'implémentation minimale**

Créer `src/features/chat/chat-format.ts` :

```ts
export type Message = {
  id: string;
  match_id: string;
  sender_id: string;
  body: string | null;
  image_path: string | null;
  created_at: string;
};

const HOUR_MS = 60 * 60 * 1000;

// La RPC send_message ramène expires_at à now()+60min ; côté client on dérive
// la même valeur à partir du created_at du dernier message reçu.
export function expiresAtFromMessage(createdAtISO: string): string {
  return new Date(new Date(createdAtISO).getTime() + HOUR_MS).toISOString();
}

export function isImageMessage(message: Message): boolean {
  return message.image_path != null;
}

// Trie par created_at croissant et dédoublonne par id (écho Realtime + rendu optimiste).
export function sortAndDedupe(messages: Message[]): Message[] {
  const byId = new Map<string, Message>();
  for (const m of messages) byId.set(m.id, m);
  return [...byId.values()].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  );
}
```

- [ ] **Step 4 : Lancer le test, vérifier qu'il passe**

Run: `npx jest src/features/chat/chat-format.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5 : Commit**

```bash
git add src/features/chat/chat-format.ts src/features/chat/chat-format.test.ts
git commit -m "feat(plan-5): helpers purs du chat (expires/tri/dédup)"
```

---

## Task 3 : Accès données `chat-image.ts` + `chat-api.ts`

**Files:**
- Create: `src/features/chat/chat-image.ts`
- Create: `src/features/chat/chat-api.ts`

- [ ] **Step 1 : Écrire `chat-image.ts`**

Créer `src/features/chat/chat-image.ts` (import `supabase` uniquement, pour rester léger à l'affichage) :

```ts
import { supabase } from '../../lib/supabase';

const CHAT_BUCKET = 'chat-media';
const SIGNED_URL_TTL_SECONDS = 120;

export async function signedChatImageUrl(path: string): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from(CHAT_BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
  if (error) return null;
  return data.signedUrl;
}
```

- [ ] **Step 2 : Écrire `chat-api.ts`**

Créer `src/features/chat/chat-api.ts` :

```ts
import * as ImageManipulator from 'expo-image-manipulator';
import { randomUUID } from 'expo-crypto';
import { supabase } from '../../lib/supabase';
import { PHOTO_COMPRESS, PHOTO_MAX_DIMENSION } from '../profile/image';
import type { Message } from './chat-format';

declare const atob: (s: string) => string;

const CHAT_BUCKET = 'chat-media';

export async function fetchMessages(matchId: string): Promise<Message[]> {
  const { data, error } = await supabase
    .from('messages')
    .select('id, match_id, sender_id, body, image_path, created_at')
    .eq('match_id', matchId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function sendText(matchId: string, body: string): Promise<Message> {
  const { data, error } = await supabase.rpc('send_message', {
    p_match_id: matchId,
    p_body: body,
    p_image_path: null,
  });
  if (error) throw error;
  return data as unknown as Message;
}

export async function sendImage(matchId: string, localUri: string): Promise<Message> {
  const manipulated = await ImageManipulator.manipulateAsync(
    localUri,
    [{ resize: { width: PHOTO_MAX_DIMENSION } }],
    { compress: PHOTO_COMPRESS, format: ImageManipulator.SaveFormat.JPEG, base64: true },
  );
  if (!manipulated.base64) throw new Error('Compression échouée');
  const path = `${matchId}/${randomUUID()}.jpg`;
  const bytes = Uint8Array.from(atob(manipulated.base64), (c) => c.charCodeAt(0));
  const up = await supabase.storage.from(CHAT_BUCKET).upload(path, bytes, { contentType: 'image/jpeg' });
  if (up.error) throw up.error;
  const { data, error } = await supabase.rpc('send_message', {
    p_match_id: matchId,
    p_body: null,
    p_image_path: path,
  });
  if (error) throw error;
  return data as unknown as Message;
}
```

- [ ] **Step 3 : Vérifier la compilation**

Run: `npx tsc --noEmit`
Expected: aucune erreur.

- [ ] **Step 4 : Commit**

```bash
git add src/features/chat/chat-image.ts src/features/chat/chat-api.ts
git commit -m "feat(plan-5): accès données chat (fetch, send texte/image, URL signée)"
```

---

## Task 4 : Hooks `use-chat.ts` (query + Realtime + envoi)

**Files:**
- Create: `src/features/chat/use-chat.ts`

- [ ] **Step 1 : Écrire `use-chat.ts`**

Créer `src/features/chat/use-chat.ts` :

```ts
import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { fetchMessages, sendImage, sendText } from './chat-api';
import { sortAndDedupe, type Message } from './chat-format';

export function useMessages(matchId: string) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ['messages', matchId],
    queryFn: () => fetchMessages(matchId),
  });

  useEffect(() => {
    const channel = supabase
      .channel(`messages:${matchId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `match_id=eq.${matchId}` },
        (payload) => {
          const incoming = payload.new as Message;
          qc.setQueryData<Message[]>(['messages', matchId], (prev) =>
            sortAndDedupe([...(prev ?? []), incoming]),
          );
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [matchId, qc]);

  return query;
}

export type SendInput = { body: string } | { localUri: string };

export function useSendMessage(matchId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SendInput) =>
      'body' in input ? sendText(matchId, input.body) : sendImage(matchId, input.localUri),
    onSuccess: (msg) => {
      // Rendu optimiste : on insère tout de suite (dédup par id avec l'écho Realtime).
      qc.setQueryData<Message[]>(['messages', matchId], (prev) => sortAndDedupe([...(prev ?? []), msg]));
      // Le timer a bougé : rafraîchir la liste des matchs (compte à rebours).
      qc.invalidateQueries({ queryKey: ['matches'] });
    },
  });
}
```

- [ ] **Step 2 : Vérifier la compilation**

Run: `npx tsc --noEmit`
Expected: aucune erreur.

- [ ] **Step 3 : Commit**

```bash
git add src/features/chat/use-chat.ts
git commit -m "feat(plan-5): hooks chat (messages temps réel + envoi optimiste)"
```

---

## Task 5 : Composants `MessageBubble.tsx` (+ test) et `ChatInput.tsx`

**Files:**
- Create: `src/features/chat/MessageBubble.tsx`
- Test: `src/features/chat/MessageBubble.test.tsx`
- Create: `src/features/chat/ChatInput.tsx`

- [ ] **Step 1 : Écrire le test RNTL qui échoue**

Créer `src/features/chat/MessageBubble.test.tsx` :

```tsx
import { render, screen } from '@testing-library/react-native';
import { MessageBubble } from './MessageBubble';
import type { Message } from './chat-format';

jest.mock('./chat-image', () => ({ signedChatImageUrl: jest.fn().mockResolvedValue(null) }));

function msg(over: Partial<Message>): Message {
  return {
    id: 'x', match_id: 'm', sender_id: 'u',
    body: 'Coucou', image_path: null, created_at: '2026-06-15T12:00:00.000Z',
    ...over,
  };
}

test('affiche le texte d\'un message texte', () => {
  render(<MessageBubble message={msg({})} mine={false} />);
  expect(screen.getByText('Coucou')).toBeTruthy();
});

test('un message image n\'affiche pas de texte', () => {
  render(<MessageBubble message={msg({ body: null, image_path: 'm/a.jpg' })} mine />);
  expect(screen.queryByText('Coucou')).toBeNull();
});
```

- [ ] **Step 2 : Lancer le test, vérifier qu'il échoue**

Run: `npx jest src/features/chat/MessageBubble.test.tsx`
Expected: FAIL — `Cannot find module './MessageBubble'`.

- [ ] **Step 3 : Écrire `MessageBubble.tsx`**

Créer `src/features/chat/MessageBubble.tsx` :

```tsx
import { useEffect, useState } from 'react';
import { Image, Text, View } from 'react-native';
import { signedChatImageUrl } from './chat-image';
import { isImageMessage, type Message } from './chat-format';

export function MessageBubble({ message, mine }: { message: Message; mine: boolean }) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (message.image_path) {
      signedChatImageUrl(message.image_path).then((url) => {
        if (!cancelled) setImageUrl(url);
      });
    }
    return () => {
      cancelled = true;
    };
  }, [message.image_path]);

  const containerStyle = {
    alignSelf: (mine ? 'flex-end' : 'flex-start') as 'flex-end' | 'flex-start',
    maxWidth: '78%' as const,
    marginVertical: 4,
  };

  if (isImageMessage(message)) {
    return (
      <View style={containerStyle}>
        {imageUrl ? (
          <Image source={{ uri: imageUrl }} style={{ width: 200, height: 250, borderRadius: 12 }} />
        ) : (
          <View style={{ width: 200, height: 250, borderRadius: 12, backgroundColor: '#ddd' }} />
        )}
      </View>
    );
  }

  return (
    <View style={containerStyle}>
      <View
        style={{
          backgroundColor: mine ? '#208AEF' : '#E9E9EB',
          borderRadius: 16,
          paddingHorizontal: 12,
          paddingVertical: 8,
        }}
      >
        <Text style={{ color: mine ? 'white' : 'black' }}>{message.body}</Text>
      </View>
    </View>
  );
}
```

- [ ] **Step 4 : Lancer le test, vérifier qu'il passe**

Run: `npx jest src/features/chat/MessageBubble.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5 : Écrire `ChatInput.tsx`**

Créer `src/features/chat/ChatInput.tsx` (la sélection d'image suit le pattern de `app/(onboarding)/photos.tsx`) :

```tsx
import { useState } from 'react';
import { Alert, Pressable, TextInput, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';

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

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, padding: 8 }}>
      <Pressable onPress={pickImage} disabled={disabled} hitSlop={8}>
        <TextInput pointerEvents="none" editable={false} value="📎" style={{ fontSize: 22, width: 28 }} />
      </Pressable>
      <TextInput
        style={{
          flex: 1,
          borderWidth: 1,
          borderColor: '#ddd',
          borderRadius: 20,
          paddingHorizontal: 14,
          paddingVertical: 8,
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
        disabled={disabled || text.trim().length === 0}
        style={{
          backgroundColor: '#208AEF',
          opacity: disabled || text.trim().length === 0 ? 0.4 : 1,
          paddingHorizontal: 16,
          paddingVertical: 10,
          borderRadius: 20,
        }}
      >
        <TextInput pointerEvents="none" editable={false} value="➤" style={{ color: 'white' }} />
      </Pressable>
    </View>
  );
}
```

> Note : le bouton 📎 et ➤ utilisent un `TextInput` non éditable pour rendre l'emoji de façon stable
> sous RN 0.85 ; si tu préfères, remplace par `<Text>`. Garde l'API du composant identique.

- [ ] **Step 6 : Vérifier la compilation + tous les tests**

Run: `npx tsc --noEmit && npx jest src/features/chat`
Expected: compilation OK ; tests chat verts (chat-format 4, MessageBubble 2).

- [ ] **Step 7 : Commit**

```bash
git add src/features/chat/MessageBubble.tsx src/features/chat/MessageBubble.test.tsx src/features/chat/ChatInput.tsx
git commit -m "feat(plan-5): composants bulle + saisie du chat"
```

---

## Task 6 : Écran `app/match/[id].tsx` + navigation

**Files:**
- Create: `app/match/[id].tsx`
- Modify: `app/_layout.tsx`
- Modify: `app/(tabs)/matches.tsx`
- Modify: `src/features/matches/MatchModal.tsx`

- [ ] **Step 1 : Créer l'écran de chat**

Créer `app/match/[id].tsx` :

```tsx
import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Platform, Text, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useSession } from '../../src/features/auth/session-provider';
import { useMatches } from '../../src/features/matches/use-matches';
import { formatCountdown, isExpired } from '../../src/features/matches/countdown';
import { useMessages, useSendMessage } from '../../src/features/chat/use-chat';
import { expiresAtFromMessage } from '../../src/features/chat/chat-format';
import { MessageBubble } from '../../src/features/chat/MessageBubble';
import { ChatInput } from '../../src/features/chat/ChatInput';

const TEN_MIN_MS = 10 * 60 * 1000;

export default function ChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const matchId = id as string;
  const { session } = useSession();
  const myId = session?.user.id;

  const { data: matches } = useMatches();
  const match = (matches ?? []).find((m) => m.match_id === matchId);

  const { data: messages = [], isLoading } = useMessages(matchId);
  const send = useSendMessage(matchId);

  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // expires_at vivant : dérivé du dernier message si présent, sinon celui du match.
  const last = messages.length ? messages[messages.length - 1] : null;
  const liveExpiresAt = last ? expiresAtFromMessage(last.created_at) : match?.expires_at ?? null;

  if (!match || !myId || (isLoading && messages.length === 0)) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator />
      </View>
    );
  }

  const expired = liveExpiresAt ? isExpired(liveExpiresAt, now) : true;
  const remainingMs = liveExpiresAt ? new Date(liveExpiresAt).getTime() - now.getTime() : 0;
  const under10 = !expired && remainingMs < TEN_MIN_MS;

  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen
        options={{
          headerShown: true,
          title: match.display_name,
          headerRight: () => (
            <Text style={{ color: expired ? '#999' : under10 ? '#E53935' : '#208AEF', fontWeight: '600' }}>
              {expired ? 'Expiré' : `⏳ ${formatCountdown(liveExpiresAt as string, now)}`}
            </Text>
          ),
        }}
      />
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
          <Text style={{ textAlign: 'center', color: '#777' }}>Ce match a expiré.</Text>
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
    </View>
  );
}
```

- [ ] **Step 2 : Déclarer la route dans le layout protégé**

Dans `app/_layout.tsx`, ajouter l'écran `match/[id]` dans le bloc protégé des onglets (il doit être accessible quand on est connecté avec profil complet). Remplacer :

```tsx
      <Stack.Protected guard={!!session && complete === true}>
        <Stack.Screen name="(tabs)" />
      </Stack.Protected>
```
par :
```tsx
      <Stack.Protected guard={!!session && complete === true}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="match/[id]" />
      </Stack.Protected>
```

- [ ] **Step 3 : Rendre les lignes de match cliquables**

Dans `app/(tabs)/matches.tsx` :

Ajouter l'import du router en tête (à côté des autres imports `react-native` / `expo-router`) :
```tsx
import { Pressable } from 'react-native';
import { useRouter } from 'expo-router';
```
(`Pressable` s'ajoute à la liste déjà importée depuis `react-native`.)

Dans le composant `Matches`, après `const [now, setNow] = useState(() => new Date());`, ajouter :
```tsx
  const router = useRouter();
```

Remplacer les deux rendus de `MatchRow` pour les rendre cliquables. Pour les actifs :
```tsx
      {actifs.map((m) => (
        <Pressable key={m.match_id} onPress={() => router.push(`/match/${m.match_id}`)}>
          <MatchRow match={m} now={now} />
        </Pressable>
      ))}
```
Pour les expirés (toujours consultables en lecture seule) :
```tsx
      {expires.map((m) => (
        <Pressable key={m.match_id} onPress={() => router.push(`/match/${m.match_id}`)}>
          <MatchRow match={m} now={now} />
        </Pressable>
      ))}
```

- [ ] **Step 4 : Brancher la modale « C'est un match » vers le chat**

Dans `src/features/matches/MatchModal.tsx`, remplacer le bouton qui pousse vers l'onglet matchs par une navigation vers le chat du match. Remplacer :

```tsx
        <Pressable
          onPress={() => { onClose(); router.push('/(tabs)/matches'); }}
          style={{ backgroundColor: 'white', paddingHorizontal: 24, paddingVertical: 12, borderRadius: 24 }}
        >
          <Text style={{ fontWeight: '700' }}>Voir mes matchs</Text>
        </Pressable>
```
par :
```tsx
        <Pressable
          onPress={() => { onClose(); router.push(`/match/${matchId}`); }}
          style={{ backgroundColor: 'white', paddingHorizontal: 24, paddingVertical: 12, borderRadius: 24 }}
        >
          <Text style={{ fontWeight: '700' }}>Voir le match</Text>
        </Pressable>
```

- [ ] **Step 5 : Vérifier compilation + suite de tests complète**

Run: `npx tsc --noEmit && npx jest`
Expected: compilation OK ; **tous** les tests verts (anciens + chat-format + MessageBubble).

- [ ] **Step 6 : Commit**

```bash
git add app/match/ app/_layout.tsx "app/(tabs)/matches.tsx" src/features/matches/MatchModal.tsx
git commit -m "feat(plan-5): écran de chat + navigation depuis matchs et modale"
```

- [ ] **Step 7 : VÉRIFICATION CLOUD/DEVICE (action développeur)**

Pré-requis : la migration de la Task 1 est appliquée. Avec **deux comptes matchés** (cf. Plans 3-4) :
1. Ouvrir le chat des deux côtés → envoyer un texte d'un côté, vérifier qu'il **apparaît en temps réel** de l'autre.
2. Envoyer une **photo** → elle s'affiche des deux côtés (URL signée).
3. Vérifier que le **compte à rebours remonte à 60:00** chez les deux quand un message part.
4. **Lecture seule** : forcer l'expiration via le SQL Editor puis tenter d'envoyer →
   ```sql
   update public.matches set expires_at = now() - interval '1 minute' where id = '<MATCH_ID>';
   ```
   Côté app : la saisie disparaît, le bandeau « Ce match a expiré » s'affiche, les messages restent lisibles.

---

## Self-Review

**1. Spec coverage** (spec §1–§14) :
- Messages texte + photo → Tasks 1 (table XOR), 3 (`sendText`/`sendImage`), 5 (bulle texte/image). ✅
- Reset du timer à chaque message → Task 1 (`send_message` met `expires_at = now()+60min`). ✅
- Lecture seule à l'expiration (serveur) → Task 1 (`send_message` lève `MATCH_EXPIRED`) ; UI Task 6 (bandeau). ✅
- Temps réel → Task 1 (publication) + Task 4 (`postgres_changes` + dédup). ✅
- Compte à rebours vivant → Task 2 (`expiresAtFromMessage`) + Task 6 (header). ✅
- `chat-media` privé + RLS participation + URL signée client → Task 1 (bucket/policies) + Task 3 (`signedChatImageUrl`/`sendImage`). ✅
- Écran `app/match/[id].tsx` + navigation (onglet + modale) → Task 6. ✅
- Pas d'écriture client directe sur `messages` → Task 1 (aucune policy insert/update/delete ; RPC SECURITY DEFINER). ✅
- `matches.last_message_at` → Task 1. ✅
- Tests (logique pure + composant léger, hors `app/`) → Tasks 2 & 5. ✅
- Hors périmètre (typing/accusés, push/cron, block) → non implémentés. ✅

**2. Placeholder scan** : aucun TBD/TODO ; chaque étape contient le code complet et la commande exacte.

**3. Type consistency** : `Message` défini en Task 2 (`chat-format.ts`) et réutilisé partout (chat-api, use-chat, MessageBubble, écran) avec les mêmes champs (`id, match_id, sender_id, body, image_path, created_at`). RPC `send_message(p_match_id, p_body, p_image_path)` : signature identique en SQL (Task 1), types (Task 1 step 4) et appels (Task 3). `signedChatImageUrl` défini en Task 3, consommé en Task 5. `useMessages`/`useSendMessage` (Task 4) consommés en Task 6. Routes `'/match/${id}'` cohérentes (écran Task 6 step 1, layout step 2, navigations steps 3-4). ✅
