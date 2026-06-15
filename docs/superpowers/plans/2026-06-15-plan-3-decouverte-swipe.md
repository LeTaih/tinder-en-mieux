# Plan 3 — Découverte & Swipe — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Afficher un deck de profils filtrés (géoloc + préférences) servi par une Edge Function sécurisée, et enregistrer les swipes like/pass avec quota de likes serveur et rewind. Aucun match créé (Plan 4).

**Architecture:** Fonction SQL `deck_candidates` (SECURITY DEFINER, PostGIS, exécutable par le seul rôle service) appelée par une Edge Function `get-deck` qui signe les photos et ne renvoie que des champs sûrs (URLs signées, distance arrondie, âge). Côté client : `rn-swiper-list` + TanStack Query, RPC `record_swipe`/`rewind_last_swipe`/`likes_remaining_today` (quota autoritatif en base). Logique d'affichage pure testée en TDD.

**Tech Stack:** Expo SDK 56, Expo Router, TypeScript, `rn-swiper-list` 3.0.0 (reanimated 4 / gesture-handler / worklets déjà installés), `@tanstack/react-query`, Supabase (Postgres + PostGIS + Edge Functions Deno + Storage), Jest + RNTL.

**Spec de référence :** `docs/superpowers/specs/2026-06-15-plan-3-decouverte-swipe-design.md`.

**Contrainte Docker :** migration SQL + Edge Function écrites en session, **déployées au cloud par le développeur** (Task 9). Garde-fous en session : `npm test` (logique pure + composant présentational) et `npx tsc --noEmit`. `database.ts` mis à jour à la main (Task 2), régénéré depuis le cloud en Task 9.

---

## Structure de fichiers (cible)

```
supabase/migrations/20260615130000_plan3_swipes.sql   # swipes + RLS + 4 fonctions + grants
supabase/functions/get-deck/index.ts                   # Edge Function Deno (signe les photos)
src/types/database.ts                                  # MODIFIÉ : + swipes + 3 RPC client
src/features/deck/
  deck-format.ts            # libellés distance/âge + clamp compteur (pur)
  deck-format.test.ts
  deck-api.ts               # fetchDeck (invoke) + recordSwipe/rewind/likesRemaining (rpc)
  use-deck.ts               # hooks TanStack Query
  DeckCard.tsx              # carte présentationnelle (sans reanimated)
  deck-card.test.tsx        # RNTL (dans src/, jamais dans app/)
app/_layout.tsx             # MODIFIÉ : GestureHandlerRootView à la racine
app/(tabs)/index.tsx        # MODIFIÉ : écran Deck (rn-swiper-list)
```

---

## Task 1: Migration SQL — swipes + fonctions + grants

Écrite, **non appliquée** en session.

**Files:**
- Create: `supabase/migrations/20260615130000_plan3_swipes.sql`

- [ ] **Step 1: Écrire la migration**

Create `supabase/migrations/20260615130000_plan3_swipes.sql` :
```sql
-- ============ Table des swipes ============
create table public.swipes (
  id uuid primary key default gen_random_uuid(),
  swiper_id uuid not null references public.profiles(id) on delete cascade,
  swipee_id uuid not null references public.profiles(id) on delete cascade,
  direction text not null check (direction in ('like', 'pass')),
  created_at timestamptz not null default now(),
  unique (swiper_id, swipee_id)
);
create index swipes_swiper_created_idx on public.swipes (swiper_id, created_at);

alter table public.swipes enable row level security;
create policy "swipes: select own" on public.swipes
  for select to authenticated using (auth.uid() = swiper_id);
create policy "swipes: insert own" on public.swipes
  for insert to authenticated with check (auth.uid() = swiper_id);
create policy "swipes: update own" on public.swipes
  for update to authenticated using (auth.uid() = swiper_id) with check (auth.uid() = swiper_id);
create policy "swipes: delete own" on public.swipes
  for delete to authenticated using (auth.uid() = swiper_id);

-- ============ Candidats du deck (interne : réservé au rôle service via l'Edge Function) ============
-- Reçoit l'id utilisateur en paramètre (l'Edge Function le dérive du JWT vérifié) plutôt que via
-- auth.uid(), car appelée avec la clé service. Ne renvoie aucune coordonnée brute ni date de naissance.
create function public.deck_candidates(p_user uuid, p_limit int default 10, p_offset int default 0)
returns table (
  id uuid, display_name text, age int, distance_km int, bio text, photo_paths text[]
)
language sql security definer set search_path = public, extensions as $$
  with me as (
    select pr.id, pr.gender_id, pr.birthdate, pr.location,
           prefs.age_min, prefs.age_max, prefs.max_distance_km
    from public.profiles pr
    join public.preferences prefs on prefs.profile_id = pr.id
    where pr.id = p_user
  )
  select
    c.id,
    c.display_name,
    date_part('year', age(c.birthdate))::int as age,
    round(extensions.st_distance(me.location, c.location) / 1000.0)::int as distance_km,
    c.bio,
    array(
      select pp.storage_path from public.profile_photos pp
      where pp.profile_id = c.id order by pp.position
    ) as photo_paths
  from me, public.profiles c
  join public.preferences cp on cp.profile_id = c.id
  where c.id <> me.id
    and c.location is not null
    and exists (select 1 from public.profile_photos pp where pp.profile_id = c.id)
    and c.gender_id in (select gender_id from public.preference_genders where profile_id = me.id)
    and date_part('year', age(c.birthdate))::int between me.age_min and me.age_max
    and extensions.st_dwithin(me.location, c.location, me.max_distance_km * 1000)
    and me.gender_id in (select gender_id from public.preference_genders where profile_id = c.id)
    and date_part('year', age(me.birthdate))::int between cp.age_min and cp.age_max
    and not exists (select 1 from public.swipes s where s.swiper_id = me.id and s.swipee_id = c.id)
  order by extensions.st_distance(me.location, c.location) asc
  limit p_limit offset p_offset;
$$;

-- ============ Enregistrer un swipe (quota de likes autoritatif) ============
create function public.record_swipe(p_target uuid, p_direction text)
returns int
language plpgsql security invoker set search_path = public as $$
declare
  v_used int;
  v_limit constant int := 20; -- quota de likes/jour (point unique de configuration)
begin
  if p_direction not in ('like', 'pass') then
    raise exception 'INVALID_DIRECTION';
  end if;
  if p_direction = 'like' then
    select count(*) into v_used from public.swipes
      where swiper_id = auth.uid() and direction = 'like' and created_at >= date_trunc('day', now());
    if v_used >= v_limit then
      raise exception 'QUOTA_EXCEEDED';
    end if;
  end if;
  insert into public.swipes (swiper_id, swipee_id, direction)
    values (auth.uid(), p_target, p_direction)
    on conflict (swiper_id, swipee_id) do update set direction = excluded.direction, created_at = now();
  select greatest(v_limit - count(*), 0) into v_used from public.swipes
    where swiper_id = auth.uid() and direction = 'like' and created_at >= date_trunc('day', now());
  return v_used;
end;
$$;

-- ============ Rewind : annuler le dernier swipe ============
create function public.rewind_last_swipe()
returns uuid
language plpgsql security invoker set search_path = public as $$
declare v_swipee uuid;
begin
  delete from public.swipes where id = (
    select id from public.swipes where swiper_id = auth.uid() order by created_at desc limit 1
  ) returning swipee_id into v_swipee;
  return v_swipee;
end;
$$;

-- ============ Likes restants aujourd'hui ============
create function public.likes_remaining_today()
returns int
language sql security invoker set search_path = public as $$
  select greatest(20 - count(*), 0)::int from public.swipes
    where swiper_id = auth.uid() and direction = 'like' and created_at >= date_trunc('day', now());
$$;

-- ============ Grants (hygiène anti-abus) ============
-- deck_candidates : JAMAIS exposée au client, uniquement au rôle service (Edge Function).
revoke execute on function public.deck_candidates(uuid, int, int) from public, authenticated;
grant execute on function public.deck_candidates(uuid, int, int) to service_role;

revoke execute on function public.record_swipe(uuid, text) from public;
grant execute on function public.record_swipe(uuid, text) to authenticated;
revoke execute on function public.rewind_last_swipe() from public;
grant execute on function public.rewind_last_swipe() to authenticated;
revoke execute on function public.likes_remaining_today() from public;
grant execute on function public.likes_remaining_today() to authenticated;
```

- [ ] **Step 2: Relecture**

Vérifie : RLS sur `swipes`, `deck_candidates` révoquée pour `authenticated` (réservée service), quota dans `record_swipe`, pas de coordonnée/date de naissance renvoyée par `deck_candidates`.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat(db): swipes, deck_candidates, record_swipe, rewind, quota (Plan 3)"
```

---

## Task 2: Mettre à jour `database.ts` (miroir manuel)

Ajoute la table `swipes` et les 3 RPC appelables par le client. (`deck_candidates` est volontairement absente : le client ne l'appelle jamais.)

**Files:**
- Modify: `src/types/database.ts`

- [ ] **Step 1: Ajouter la table `swipes`**

Modify `src/types/database.ts` — dans `public.Tables`, ajoute :
```ts
      swipes: {
        Row: { id: string; swiper_id: string; swipee_id: string; direction: string; created_at: string };
        Insert: { id?: string; swiper_id: string; swipee_id: string; direction: string; created_at?: string };
        Update: { id?: string; swiper_id?: string; swipee_id?: string; direction?: string; created_at?: string };
        Relationships: [];
      };
```

- [ ] **Step 2: Ajouter les 3 RPC client**

Modify `src/types/database.ts` — dans `public.Functions`, ajoute (à côté des fonctions existantes) :
```ts
      record_swipe: {
        Args: { p_target: string; p_direction: string };
        Returns: number;
      };
      rewind_last_swipe: {
        Args: Record<string, never>;
        Returns: string;
      };
      likes_remaining_today: {
        Args: Record<string, never>;
        Returns: number;
      };
```

- [ ] **Step 3: Vérifier**

Run : `npx tsc --noEmit`
Expected : 0 erreur.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "chore(types): + swipes et RPC swipe dans database.ts"
```

---

## Task 3: Edge Function `get-deck`

**Files:**
- Create: `supabase/functions/get-deck/index.ts`

- [ ] **Step 1: Écrire la fonction**

Create `supabase/functions/get-deck/index.ts` :
```ts
import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SIGNED_URL_TTL = 120;

Deno.serve(async (req) => {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return new Response('Unauthorized', { status: 401 });

  // Client scopé utilisateur : sert à identifier l'appelant à partir de son JWT.
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData.user) return new Response('Unauthorized', { status: 401 });
  const userId = userData.user.id;

  let limit = 10;
  let offset = 0;
  try {
    const body = await req.json();
    if (typeof body?.limit === 'number') limit = Math.min(Math.max(body.limit, 1), 30);
    if (typeof body?.offset === 'number') offset = Math.max(body.offset, 0);
  } catch (_e) {
    // pas de corps => valeurs par défaut
  }

  // Client service : exécute la requête candidats (fonction réservée au rôle service) et signe les photos.
  const service = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const { data: rows, error } = await service.rpc('deck_candidates', {
    p_user: userId,
    p_limit: limit,
    p_offset: offset,
  });
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });

  const candidates = [] as Array<{
    id: string; display_name: string; age: number; distance_km: number; bio: string | null; photos: string[];
  }>;
  for (const r of rows ?? []) {
    const paths: string[] = r.photo_paths ?? [];
    let photos: string[] = [];
    if (paths.length > 0) {
      const { data: signed } = await service.storage.from('profile-photos').createSignedUrls(paths, SIGNED_URL_TTL);
      photos = (signed ?? []).map((s) => s.signedUrl).filter(Boolean) as string[];
    }
    candidates.push({
      id: r.id, display_name: r.display_name, age: r.age, distance_km: r.distance_km, bio: r.bio, photos,
    });
  }

  return new Response(JSON.stringify({ candidates }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
```

- [ ] **Step 2: Commit**

```bash
git add -A && git commit -m "feat(edge): get-deck signe les photos et masque les champs sensibles"
```

---

## Task 4: `deck-format.ts` (pur, TDD)

**Files:**
- Create: `src/features/deck/deck-format.ts`, `src/features/deck/deck-format.test.ts`

- [ ] **Step 1: Test (échec)**

Create `src/features/deck/deck-format.test.ts` :
```ts
import { formatDistance, formatAge, clampRemaining } from './deck-format';

test('formatDistance', () => {
  expect(formatDistance(0)).toBe('à moins de 1 km');
  expect(formatDistance(1)).toBe('à 1 km');
  expect(formatDistance(12)).toBe('à 12 km');
});

test('formatAge', () => {
  expect(formatAge(24)).toBe('24 ans');
});

test('clampRemaining ne descend jamais sous 0', () => {
  expect(clampRemaining(5)).toBe(5);
  expect(clampRemaining(-3)).toBe(0);
});
```

- [ ] **Step 2: Lancer (échec)**

Run : `npm test -- "deck-format"`
Expected : FAIL — module introuvable.

- [ ] **Step 3: Implémenter**

Create `src/features/deck/deck-format.ts` :
```ts
export function formatDistance(km: number): string {
  if (km <= 0) return 'à moins de 1 km';
  return `à ${km} km`;
}

export function formatAge(age: number): string {
  return `${age} ans`;
}

export function clampRemaining(n: number): number {
  return Math.max(n, 0);
}
```

- [ ] **Step 4: Lancer (succès)**

Run : `npm test -- "deck-format"`
Expected : PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(deck): formatage distance/âge et clamp du compteur"
```

---

## Task 5: `deck-api.ts`

**Files:**
- Create: `src/features/deck/deck-api.ts`

- [ ] **Step 1: Implémenter**

Create `src/features/deck/deck-api.ts` :
```ts
import { supabase } from '../../lib/supabase';

export type DeckCandidate = {
  id: string;
  display_name: string;
  age: number;
  distance_km: number;
  bio: string | null;
  photos: string[];
};

export async function fetchDeck(limit = 10, offset = 0): Promise<DeckCandidate[]> {
  const { data, error } = await supabase.functions.invoke('get-deck', { body: { limit, offset } });
  if (error) throw error;
  return (data?.candidates ?? []) as DeckCandidate[];
}

export async function recordSwipe(target: string, direction: 'like' | 'pass'): Promise<number> {
  const { data, error } = await supabase.rpc('record_swipe', { p_target: target, p_direction: direction });
  if (error) throw error;
  return (data as number) ?? 0;
}

export async function rewindLastSwipe(): Promise<string | null> {
  const { data, error } = await supabase.rpc('rewind_last_swipe');
  if (error) throw error;
  return (data as string) ?? null;
}

export async function likesRemaining(): Promise<number> {
  const { data, error } = await supabase.rpc('likes_remaining_today');
  if (error) throw error;
  return (data as number) ?? 0;
}
```

- [ ] **Step 2: Vérifier**

Run : `npx tsc --noEmit`
Expected : 0 erreur.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat(deck): API deck (Edge Function + RPC swipe/rewind/quota)"
```

---

## Task 6: Hooks `use-deck.ts`

**Files:**
- Create: `src/features/deck/use-deck.ts`

- [ ] **Step 1: Implémenter**

Create `src/features/deck/use-deck.ts` :
```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchDeck, likesRemaining, recordSwipe, rewindLastSwipe } from './deck-api';

export function useDeck() {
  return useQuery({ queryKey: ['deck'], queryFn: () => fetchDeck(10, 0) });
}

export function useLikesRemaining() {
  return useQuery({ queryKey: ['likes-remaining'], queryFn: likesRemaining });
}

export function useSwipe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ target, direction }: { target: string; direction: 'like' | 'pass' }) =>
      recordSwipe(target, direction),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['likes-remaining'] });
    },
  });
}

export function useRewind() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: rewindLastSwipe,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['likes-remaining'] });
      qc.invalidateQueries({ queryKey: ['deck'] });
    },
  });
}
```

- [ ] **Step 2: Vérifier**

Run : `npx tsc --noEmit`
Expected : 0 erreur.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat(deck): hooks useDeck/useSwipe/useRewind/useLikesRemaining"
```

---

## Task 7: Composant `DeckCard` (présentationnel) + test RNTL

**Files:**
- Create: `src/features/deck/DeckCard.tsx`, `src/features/deck/deck-card.test.tsx`

- [ ] **Step 1: Test (échec)**

Create `src/features/deck/deck-card.test.tsx` :
```tsx
import { fireEvent, render, screen } from '@testing-library/react-native';
import { DeckCard } from './DeckCard';

const candidate = { id: 'c1', display_name: 'Léa', age: 24, distance_km: 3, bio: 'Salut', photos: ['https://x/p.jpg'] };

test('affiche prénom, âge et distance', () => {
  render(<DeckCard candidate={candidate} likesRemaining={5} onLike={jest.fn()} onPass={jest.fn()} onRewind={jest.fn()} />);
  expect(screen.getByText('Léa, 24 ans')).toBeTruthy();
  expect(screen.getByText('à 3 km')).toBeTruthy();
});

test('like désactivé quand quota épuisé', () => {
  const onLike = jest.fn();
  render(<DeckCard candidate={candidate} likesRemaining={0} onLike={onLike} onPass={jest.fn()} onRewind={jest.fn()} />);
  fireEvent.press(screen.getByText('♥'));
  expect(onLike).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Lancer (échec)**

Run : `npm test -- "deck-card"`
Expected : FAIL — module introuvable.

- [ ] **Step 3: Implémenter**

Create `src/features/deck/DeckCard.tsx` :
```tsx
import { useState } from 'react';
import { Image, Pressable, Text, View } from 'react-native';
import type { DeckCandidate } from './deck-api';
import { formatAge, formatDistance } from './deck-format';

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
  const photo = candidate.photos[photoIndex];

  return (
    <View style={{ flex: 1, borderRadius: 16, overflow: 'hidden', backgroundColor: '#eee' }}>
      <Pressable
        style={{ flex: 1 }}
        onPress={() => candidate.photos.length > 0 && setPhotoIndex((i) => (i + 1) % candidate.photos.length)}
      >
        {photo ? <Image source={{ uri: photo }} style={{ flex: 1 }} resizeMode="cover" /> : null}
      </Pressable>
      <View style={{ position: 'absolute', bottom: 90, left: 16, right: 16 }}>
        <Text style={{ fontSize: 24, fontWeight: '800', color: 'white' }}>
          {candidate.display_name}, {formatAge(candidate.age)}
        </Text>
        <Text style={{ color: 'white' }}>{formatDistance(candidate.distance_km)}</Text>
        {candidate.bio ? <Text style={{ color: 'white' }} numberOfLines={2}>{candidate.bio}</Text> : null}
      </View>
      <View style={{ position: 'absolute', bottom: 16, left: 0, right: 0, flexDirection: 'row', justifyContent: 'space-around' }}>
        <Pressable onPress={onRewind}><Text style={{ fontSize: 28 }}>↩️</Text></Pressable>
        <Pressable onPress={onPass}><Text style={{ fontSize: 28 }}>✕</Text></Pressable>
        <Pressable onPress={() => canLike && onLike()}>
          <Text style={{ fontSize: 28, opacity: canLike ? 1 : 0.3 }}>♥</Text>
        </Pressable>
      </View>
    </View>
  );
}
```

- [ ] **Step 4: Lancer (succès)**

Run : `npm test -- "deck-card"`
Expected : PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(deck): composant DeckCard + test RNTL"
```

---

## Task 8: Écran Deck (`rn-swiper-list`) + GestureHandlerRootView

**Files:**
- Modify: `app/_layout.tsx`, `app/(tabs)/index.tsx`, `package.json`

- [ ] **Step 1: Installer**

Run : `npx expo install rn-swiper-list react-native-gesture-handler` (gesture-handler déjà présent ; la commande aligne la version. `--legacy-peer-deps` si conflit.)
Expected : `rn-swiper-list` ajouté.

- [ ] **Step 2: GestureHandlerRootView à la racine**

Modify `app/_layout.tsx` — enveloppe le contenu de `RootLayout` dans `GestureHandlerRootView` (requis par gesture-handler / rn-swiper-list). Ajoute l'import et le wrapper le plus externe :
```tsx
import { GestureHandlerRootView } from 'react-native-gesture-handler';
// ... autres imports existants (QueryClientProvider, queryClient, SessionProvider, RootNavigator)

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

- [ ] **Step 3: Écran Deck**

Replace `app/(tabs)/index.tsx` par :
```tsx
import { useRef } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { Swiper, type SwiperCardRefType } from 'rn-swiper-list';
import { useDeck, useLikesRemaining, useRewind, useSwipe } from '../../src/features/deck/use-deck';
import { DeckCard } from '../../src/features/deck/DeckCard';
import type { DeckCandidate } from '../../src/features/deck/deck-api';

export default function Deck() {
  const ref = useRef<SwiperCardRefType>(null);
  const { data: candidates, isLoading } = useDeck();
  const { data: remaining = 0 } = useLikesRemaining();
  const swipe = useSwipe();
  const rewind = useRewind();

  if (isLoading) {
    return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator /></View>;
  }

  if (!candidates || candidates.length === 0) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <Text style={{ fontSize: 16, textAlign: 'center' }}>Plus de profils pour le moment. Reviens plus tard !</Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <View style={{ padding: 12, alignItems: 'center' }}>
        <Text>{remaining} like{remaining > 1 ? 's' : ''} restant{remaining > 1 ? 's' : ''} aujourd'hui</Text>
      </View>
      <View style={{ flex: 1, paddingHorizontal: 12, paddingBottom: 12 }}>
        <Swiper
          ref={ref}
          data={candidates}
          renderCard={(item: DeckCandidate) => (
            <DeckCard
              candidate={item}
              likesRemaining={remaining}
              onLike={() => ref.current?.swipeRight()}
              onPass={() => ref.current?.swipeLeft()}
              onRewind={() => { ref.current?.swipeBack(); rewind.mutate(); }}
            />
          )}
          onSwipeRight={(i: number) => swipe.mutate({ target: candidates[i].id, direction: 'like' })}
          onSwipeLeft={(i: number) => swipe.mutate({ target: candidates[i].id, direction: 'pass' })}
        />
      </View>
    </View>
  );
}
```
> NOTE D'INTÉGRATION : `rn-swiper-list` 3.0.0 expose `Swiper`, le type `SwiperCardRefType` et les méthodes ref `swipeLeft`/`swipeRight`/`swipeBack`, plus les props `data`/`renderCard`/`onSwipeLeft`/`onSwipeRight`. Si un nom diffère dans les types installés (`node_modules/rn-swiper-list`), aligne-toi sur la définition TypeScript réelle du package SANS changer la logique (mapping like=droite/pass=gauche, rewind=swipeBack). Vérifie via `npx tsc --noEmit`.

- [ ] **Step 4: Vérifier**

Run : `npx tsc --noEmit && npm test 2>&1 | tail -3`
Expected : 0 erreur ; tests verts.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(deck): écran de swipe rn-swiper-list + GestureHandlerRootView"
```

---

## Task 9: Déploiement cloud + 2ᵉ profil de test + e2e (développeur)

Pas exécutable en session (Docker, cloud, device). Procédure pour le développeur.

**Files:** `src/types/database.ts` (régénéré)

- [ ] **Step 1: Pousser la migration**

Run : `npx supabase db push` (projet déjà lié au Plan 2).
Expected : `20260615130000_plan3_swipes.sql` appliquée.

- [ ] **Step 2: Déployer l'Edge Function**

Run : `npx supabase functions deploy get-deck`
Expected : fonction déployée. (Les variables `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` sont injectées automatiquement par Supabase — rien à configurer.)

- [ ] **Step 3: Régénérer les types**

Run : `npm run db:types` puis `npx tsc --noEmit` (0 erreur ; corriger un éventuel écart mineur de nom).

- [ ] **Step 4: Créer un 2ᵉ profil de test**

Pour que le deck ne soit pas vide : créer un **2ᵉ compte** dans l'app (autre e-mail) et compléter son onboarding (profil complet, ≥ 1 photo, **position proche de la tienne**, préférences compatibles avec ton 1er compte et réciproquement). Astuce : sur le simulateur/téléphone, tu peux fixer une position GPS proche.

- [ ] **Step 5: Rebuild si nécessaire + tester**

`rn-swiper-list` et gesture-handler sont natifs → **refaire un build de dev** :
`npx eas-cli build --profile development --platform android`, réinstaller, puis `npx expo start --dev-client -c`.
Expected :
- l'onglet Deck affiche la carte de l'autre profil (photo via URL signée, prénom/âge, distance) ;
- swipe à droite = like (le compteur décrémente), à gauche = pass, bouton rewind ramène la carte ;
- après 20 likes dans la journée, un nouveau like est refusé (erreur `QUOTA_EXCEEDED`) ;
- quand il n'y a plus de candidats : message « Plus de profils ».

- [ ] **Step 6: Vérifier la sécurité (rapide)**

Confirme qu'un appel direct (REST) à `deck_candidates` avec la clé anon est **refusé** (fonction réservée au rôle service), et que la réponse de `get-deck` ne contient **ni coordonnées, ni date de naissance, ni chemins de stockage** (seulement des URLs signées).

---

## Self-Review (couverture du spec)

- **§3 deck_candidates (PostGIS, bidirectionnel, champs sûrs) + Edge Function get-deck (signe, masque)** : Tasks 1, 3. ✓
- **§4 swipes + RLS + record_swipe (quota 20) + rewind + likes_remaining** : Task 1 ; types Task 2. ✓
- **§5 client (deck-api, hooks, DeckCard, écran rn-swiper-list)** : Tasks 5, 6, 7, 8. ✓
- **§6 sécurité (Edge Function unique surface, quota base, RLS, deck_candidates réservée service)** : Tasks 1 (grants), 3. ✓
- **§7 déploiement cloud (Docker)** : Task 9. ✓
- **§8 tests (deck-format TDD, DeckCard RNTL dans src/)** : Tasks 4, 7. ✓
- **§9 rn-swiper-list / GestureHandlerRootView** : Task 8. ✓

Cohérence des noms : `DeckCandidate` (T5) utilisé en T6/T7/T8 ; `fetchDeck`/`recordSwipe`/`rewindLastSwipe`/`likesRemaining` (T5) → hooks T6 ; `formatDistance`/`formatAge`/`clampRemaining` (T4) → DeckCard T7 ; RPC `record_swipe`/`rewind_last_swipe`/`likes_remaining_today` (T1) ↔ database.ts (T2) ↔ deck-api (T5). Mapping swipe : like=droite, pass=gauche, rewind=swipeBack (T8).

Placeholders : aucun (la NOTE d'intégration rn-swiper-list pointe vers les types réels du package, pas un placeholder de logique).
