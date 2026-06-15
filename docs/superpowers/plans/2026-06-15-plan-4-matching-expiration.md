# Plan 4 — Matching & Moteur d'expiration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Créer un match sur like mutuel avec un timer 1h autoritatif serveur, annoncer le match (modale « It's a match »), et lister les matchs avec un compte à rebours qui archive à l'expiration.

**Architecture:** La RPC `record_swipe` (Plan 3) devient `SECURITY DEFINER` et crée le match côté serveur de confiance (retour JSON `{likes_remaining, matched, match_id}`). La table `matches` est en lecture RLS-participants, sans écriture client. La liste des matchs est servie par une Edge Function `get-matches` qui signe la photo de l'autre. Compte à rebours dérivé de `expires_at` (autorité serveur), helper pur testé.

**Tech Stack:** Expo SDK 56, Expo Router, TypeScript, `@tanstack/react-query`, Supabase (Postgres + Edge Functions Deno + Storage), Jest + RNTL.

**Spec de référence :** `docs/superpowers/specs/2026-06-15-plan-4-matching-expiration-design.md`.

**Contrainte Docker :** migration SQL + Edge Function écrites en session, appliquées au cloud par le développeur (Task 9). Garde-fous en session : `npm test` + `npx tsc --noEmit`. `database.ts` mis à jour à la main (Task 2), régénéré depuis le cloud en Task 9.

---

## Structure de fichiers (cible)

```
supabase/migrations/20260615140000_plan4_matches.sql   # matches + record_swipe (DEFINER) + my_matches + grants
supabase/functions/get-matches/index.ts                # Edge Function Deno (signe la photo de l'autre)
src/types/database.ts                                  # MODIFIÉ : + matches, record_swipe renvoie un objet
src/features/deck/deck-api.ts                          # MODIFIÉ : recordSwipe renvoie SwipeResult
src/features/matches/
  countdown.ts            # formatCountdown / isExpired (pur)
  countdown.test.ts
  matches-api.ts          # fetchMatches (invoke get-matches) + type Match
  use-matches.ts          # hook useMatches
  MatchModal.tsx          # modale « It's a match »
  match-modal.test.tsx    # RNTL (dans src/)
app/(tabs)/matches.tsx    # MODIFIÉ : liste actifs (countdown) + archivés
app/(tabs)/index.tsx      # MODIFIÉ : déclenche MatchModal sur match
```

---

## Task 1: Migration SQL — matches + record_swipe (DEFINER) + my_matches

Écrite, **non appliquée** en session.

**Files:**
- Create: `supabase/migrations/20260615140000_plan4_matches.sql`

- [ ] **Step 1: Écrire la migration**

Create `supabase/migrations/20260615140000_plan4_matches.sql` :
```sql
-- ============ Table des matchs ============
create table public.matches (
  id uuid primary key default gen_random_uuid(),
  user_a uuid not null references public.profiles(id) on delete cascade,
  user_b uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  constraint matches_ordered_pair check (user_a < user_b)
);
create index matches_user_a_idx on public.matches (user_a);
create index matches_user_b_idx on public.matches (user_b);
create index matches_expires_idx on public.matches (expires_at);

alter table public.matches enable row level security;
-- Lecture réservée aux 2 participants. AUCUNE policy insert/update/delete -> écriture
-- exclusivement via record_swipe (SECURITY DEFINER), donc impossible de fabriquer de faux matchs.
create policy "matches: select participant" on public.matches
  for select to authenticated using (auth.uid() = user_a or auth.uid() = user_b);

-- ============ record_swipe : passe en SECURITY DEFINER + crée le match sur like mutuel ============
-- Le type de retour change (int -> json) : il faut drop puis recreate.
drop function if exists public.record_swipe(uuid, text);

create function public.record_swipe(p_target uuid, p_direction text)
returns json
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
  v_used int;
  v_limit constant int := 20;
  v_matched boolean := false;
  v_match_id uuid := null;
  v_a uuid;
  v_b uuid;
begin
  if v_me is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if p_direction not in ('like', 'pass') then raise exception 'INVALID_DIRECTION'; end if;
  if p_target = v_me then raise exception 'CANNOT_SWIPE_SELF'; end if;

  if p_direction = 'like' then
    select count(*) into v_used from public.swipes
      where swiper_id = v_me and direction = 'like' and created_at >= date_trunc('day', now());
    if v_used >= v_limit then raise exception 'QUOTA_EXCEEDED'; end if;
  end if;

  insert into public.swipes (swiper_id, swipee_id, direction)
    values (v_me, p_target, p_direction)
    on conflict (swiper_id, swipee_id) do update set direction = excluded.direction, created_at = now();

  -- Match si le like est réciproque
  if p_direction = 'like'
     and exists (
       select 1 from public.swipes s
       where s.swiper_id = p_target and s.swipee_id = v_me and s.direction = 'like'
     ) then
    v_a := least(v_me, p_target);
    v_b := greatest(v_me, p_target);
    if not exists (
      select 1 from public.matches m
      where m.user_a = v_a and m.user_b = v_b and m.expires_at > now()
    ) then
      insert into public.matches (user_a, user_b, expires_at)
        values (v_a, v_b, now() + interval '60 minutes')
        returning id into v_match_id;
      v_matched := true;
    end if;
  end if;

  select greatest(v_limit - count(*), 0) into v_used from public.swipes
    where swiper_id = v_me and direction = 'like' and created_at >= date_trunc('day', now());

  return json_build_object('likes_remaining', v_used, 'matched', v_matched, 'match_id', v_match_id);
end;
$$;

revoke execute on function public.record_swipe(uuid, text) from public;
grant execute on function public.record_swipe(uuid, text) to authenticated;

-- ============ my_matches : liste des matchs d'un utilisateur (réservée au rôle service) ============
create function public.my_matches(p_user uuid)
returns table (
  match_id uuid, other_id uuid, display_name text, photo_path text,
  expires_at timestamptz, is_active boolean
)
language sql security definer set search_path = public as $$
  select
    m.id as match_id,
    other.id as other_id,
    other.display_name,
    (select pp.storage_path from public.profile_photos pp
       where pp.profile_id = other.id order by pp.position limit 1) as photo_path,
    m.expires_at,
    (m.expires_at > now()) as is_active
  from public.matches m
  join public.profiles other
    on other.id = case when m.user_a = p_user then m.user_b else m.user_a end
  where m.user_a = p_user or m.user_b = p_user
  order by m.expires_at desc;
$$;

revoke execute on function public.my_matches(uuid) from public, authenticated;
grant execute on function public.my_matches(uuid) to service_role;
```

- [ ] **Step 2: Relecture**

Vérifie : RLS `matches` en lecture participant + aucune policy d'écriture ; `record_swipe` en
`SECURITY DEFINER` cantonnée à `auth.uid()` ; garde re-match sur `expires_at > now()` ; `my_matches`
réservée au rôle service.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat(db): matches + record_swipe crée le match (DEFINER) + my_matches (Plan 4)"
```

---

## Task 2: Types `database.ts` + `recordSwipe` renvoie un objet

Le changement de type de retour de `record_swipe` impacte `deck-api.ts` → on fait les deux ensemble
pour garder `tsc` vert.

**Files:**
- Modify: `src/types/database.ts`, `src/features/deck/deck-api.ts`

- [ ] **Step 1: Ajouter `matches` dans `database.ts`**

Modify `src/types/database.ts` — dans `public.Tables`, ajoute :
```ts
      matches: {
        Row: { id: string; user_a: string; user_b: string; created_at: string; expires_at: string };
        Insert: { id?: string; user_a: string; user_b: string; created_at?: string; expires_at: string };
        Update: { id?: string; user_a?: string; user_b?: string; created_at?: string; expires_at?: string };
        Relationships: [];
      };
```

- [ ] **Step 2: Changer le type de retour de `record_swipe`**

Modify `src/types/database.ts` — dans `public.Functions`, remplace l'entrée `record_swipe` par :
```ts
      record_swipe: {
        Args: { p_target: string; p_direction: string };
        Returns: { likes_remaining: number; matched: boolean; match_id: string | null };
      };
```

- [ ] **Step 3: Adapter `recordSwipe` dans `deck-api.ts`**

Modify `src/features/deck/deck-api.ts` — remplace la fonction `recordSwipe` (et ajoute le type) :
```ts
export type SwipeResult = { likesRemaining: number; matched: boolean; matchId: string | null };

export async function recordSwipe(target: string, direction: 'like' | 'pass'): Promise<SwipeResult> {
  const { data, error } = await supabase.rpc('record_swipe', { p_target: target, p_direction: direction });
  if (error) throw error;
  return {
    likesRemaining: data?.likes_remaining ?? 0,
    matched: data?.matched ?? false,
    matchId: data?.match_id ?? null,
  };
}
```

- [ ] **Step 4: Vérifier**

Run : `npx tsc --noEmit`
Expected : 0 erreur. (`useSwipe` consomme `recordSwipe` ; son `data` devient `SwipeResult` — utilisé en Task 8.)

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "chore(types): + matches, record_swipe renvoie {likes_remaining,matched,match_id}"
```

---

## Task 3: Edge Function `get-matches`

**Files:**
- Create: `supabase/functions/get-matches/index.ts`

- [ ] **Step 1: Écrire la fonction**

Create `supabase/functions/get-matches/index.ts` :
```ts
import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SIGNED_URL_TTL = 120;

Deno.serve(async (req) => {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return new Response('Unauthorized', { status: 401 });

  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData.user) return new Response('Unauthorized', { status: 401 });

  const service = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const { data: rows, error } = await service.rpc('my_matches', { p_user: userData.user.id });
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });

  const matches = [] as Array<{
    match_id: string; other_id: string; display_name: string;
    photo: string | null; expires_at: string; is_active: boolean;
  }>;
  for (const r of rows ?? []) {
    let photo: string | null = null;
    if (r.photo_path) {
      const { data: signed } = await service.storage.from('profile-photos').createSignedUrl(r.photo_path, SIGNED_URL_TTL);
      photo = signed?.signedUrl ?? null;
    }
    matches.push({
      match_id: r.match_id, other_id: r.other_id, display_name: r.display_name,
      photo, expires_at: r.expires_at, is_active: r.is_active,
    });
  }

  return new Response(JSON.stringify({ matches }), { headers: { 'Content-Type': 'application/json' } });
});
```

- [ ] **Step 2: Commit**

```bash
git add -A && git commit -m "feat(edge): get-matches signe la photo de l'autre participant"
```

---

## Task 4: `countdown.ts` (pur, TDD)

**Files:**
- Create: `src/features/matches/countdown.ts`, `src/features/matches/countdown.test.ts`

- [ ] **Step 1: Test (échec)**

Create `src/features/matches/countdown.test.ts` :
```ts
import { formatCountdown, isExpired } from './countdown';

const base = new Date('2026-06-15T12:00:00Z');

test('formatCountdown mm:ss', () => {
  const future = new Date(base.getTime() + (59 * 60 + 32) * 1000).toISOString();
  expect(formatCountdown(future, base)).toBe('59:32');
});

test('formatCountdown pad les secondes', () => {
  const future = new Date(base.getTime() + (5 * 60 + 3) * 1000).toISOString();
  expect(formatCountdown(future, base)).toBe('5:03');
});

test('formatCountdown expiré', () => {
  const past = new Date(base.getTime() - 1000).toISOString();
  expect(formatCountdown(past, base)).toBe('Expiré');
});

test('isExpired', () => {
  expect(isExpired(new Date(base.getTime() - 1).toISOString(), base)).toBe(true);
  expect(isExpired(new Date(base.getTime() + 1000).toISOString(), base)).toBe(false);
});
```

- [ ] **Step 2: Lancer (échec)**

Run : `npm test -- countdown`
Expected : FAIL — module introuvable.

- [ ] **Step 3: Implémenter**

Create `src/features/matches/countdown.ts` :
```ts
export function isExpired(expiresAtISO: string, now: Date): boolean {
  return new Date(expiresAtISO).getTime() <= now.getTime();
}

export function formatCountdown(expiresAtISO: string, now: Date): string {
  const ms = new Date(expiresAtISO).getTime() - now.getTime();
  if (ms <= 0) return 'Expiré';
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}
```

- [ ] **Step 4: Lancer (succès)**

Run : `npm test -- countdown`
Expected : PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(matches): helper compte à rebours (formatCountdown/isExpired)"
```

---

## Task 5: `matches-api.ts` + `use-matches.ts`

**Files:**
- Create: `src/features/matches/matches-api.ts`, `src/features/matches/use-matches.ts`

- [ ] **Step 1: API**

Create `src/features/matches/matches-api.ts` :
```ts
import { supabase } from '../../lib/supabase';

export type Match = {
  match_id: string;
  other_id: string;
  display_name: string;
  photo: string | null;
  expires_at: string;
  is_active: boolean;
};

export async function fetchMatches(): Promise<Match[]> {
  const { data, error } = await supabase.functions.invoke<{ matches: Match[] }>('get-matches', { body: {} });
  if (error) throw error;
  return data?.matches ?? [];
}
```

- [ ] **Step 2: Hook**

Create `src/features/matches/use-matches.ts` :
```ts
import { useQuery } from '@tanstack/react-query';
import { fetchMatches } from './matches-api';

export function useMatches() {
  return useQuery({ queryKey: ['matches'], queryFn: fetchMatches });
}
```

- [ ] **Step 3: Vérifier**

Run : `npx tsc --noEmit`
Expected : 0 erreur.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat(matches): API + hook useMatches (Edge Function get-matches)"
```

---

## Task 6: `MatchModal` + test RNTL

**Files:**
- Create: `src/features/matches/MatchModal.tsx`, `src/features/matches/match-modal.test.tsx`

- [ ] **Step 1: Test (échec)**

Create `src/features/matches/match-modal.test.tsx` :
```tsx
import { render, screen } from '@testing-library/react-native';
import { MatchModal } from './MatchModal';

jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock('./use-matches', () => ({
  useMatches: () => ({
    data: [{ match_id: 'm1', other_id: 'o1', display_name: 'Brigitte', photo: 'https://x/p.jpg', expires_at: '', is_active: true }],
  }),
}));

test('affiche le titre et le prénom du match', () => {
  render(<MatchModal matchId="m1" onClose={jest.fn()} />);
  expect(screen.getByText("C'est un match !")).toBeTruthy();
  expect(screen.getByText(/Brigitte/)).toBeTruthy();
});
```

- [ ] **Step 2: Lancer (échec)**

Run : `npm test -- match-modal`
Expected : FAIL — module introuvable.

- [ ] **Step 3: Implémenter**

Create `src/features/matches/MatchModal.tsx` :
```tsx
import { Image, Modal, Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useMatches } from './use-matches';

type Props = { matchId: string; onClose: () => void };

export function MatchModal({ matchId, onClose }: Props) {
  const router = useRouter();
  const { data: matches } = useMatches();
  const match = (matches ?? []).find((m) => m.match_id === matchId);

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', alignItems: 'center', justifyContent: 'center', gap: 20, padding: 24 }}>
        <Text style={{ color: 'white', fontSize: 32, fontWeight: '800' }}>C'est un match !</Text>
        {match?.photo ? (
          <Image source={{ uri: match.photo }} style={{ width: 160, height: 200, borderRadius: 16 }} />
        ) : null}
        {match ? (
          <Text style={{ color: 'white', fontSize: 18 }}>Toi et {match.display_name} vous êtes likés</Text>
        ) : null}
        <Pressable
          onPress={() => { onClose(); router.push('/(tabs)/matches'); }}
          style={{ backgroundColor: 'white', paddingHorizontal: 24, paddingVertical: 12, borderRadius: 24 }}
        >
          <Text style={{ fontWeight: '700' }}>Voir mes matchs</Text>
        </Pressable>
        <Pressable onPress={onClose}>
          <Text style={{ color: 'white' }}>Continuer à swiper</Text>
        </Pressable>
      </View>
    </Modal>
  );
}
```

- [ ] **Step 4: Lancer (succès)**

Run : `npm test -- match-modal`
Expected : PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(matches): modale It's a match + test RNTL"
```

---

## Task 7: Onglet Matchs (liste actifs + archivés)

**Files:**
- Modify: `app/(tabs)/matches.tsx`

- [ ] **Step 1: Écran Matchs**

Replace `app/(tabs)/matches.tsx` par :
```tsx
import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, ScrollView, Text, View } from 'react-native';
import { useMatches } from '../../src/features/matches/use-matches';
import { formatCountdown, isExpired } from '../../src/features/matches/countdown';
import type { Match } from '../../src/features/matches/matches-api';

function MatchRow({ match, now }: { match: Match; now: Date }) {
  const expired = isExpired(match.expires_at, now);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, opacity: expired ? 0.5 : 1 }}>
      {match.photo ? (
        <Image source={{ uri: match.photo }} style={{ width: 56, height: 56, borderRadius: 28 }} />
      ) : (
        <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: '#ddd' }} />
      )}
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 16, fontWeight: '600' }}>{match.display_name}</Text>
        <Text style={{ color: expired ? '#999' : '#208AEF' }}>
          {expired ? 'Expiré' : `⏳ ${formatCountdown(match.expires_at, now)}`}
        </Text>
      </View>
    </View>
  );
}

export default function Matches() {
  const { data: matches, isLoading } = useMatches();
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  if (isLoading) {
    return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator /></View>;
  }

  const all = matches ?? [];
  const actifs = all.filter((m) => !isExpired(m.expires_at, now));
  const expires = all.filter((m) => isExpired(m.expires_at, now));

  if (all.length === 0) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <Text style={{ textAlign: 'center' }}>Pas encore de match. Va swiper !</Text>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={{ padding: 16 }}>
      <Text style={{ fontSize: 18, fontWeight: '800', marginBottom: 8 }}>Actifs</Text>
      {actifs.length === 0 ? <Text style={{ color: '#999' }}>Aucun match actif.</Text> : null}
      {actifs.map((m) => <MatchRow key={m.match_id} match={m} now={now} />)}

      <Text style={{ fontSize: 18, fontWeight: '800', marginTop: 24, marginBottom: 8 }}>Expirés</Text>
      {expires.length === 0 ? <Text style={{ color: '#999' }}>Aucun match expiré.</Text> : null}
      {expires.map((m) => <MatchRow key={m.match_id} match={m} now={now} />)}
    </ScrollView>
  );
}
```

- [ ] **Step 2: Vérifier**

Run : `npx tsc --noEmit && npm test 2>&1 | tail -3`
Expected : 0 erreur ; tests verts.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat(matches): onglet Matchs (actifs avec compte à rebours + archivés)"
```

---

## Task 8: Déclencher la modale depuis le deck

**Files:**
- Modify: `app/(tabs)/index.tsx`

- [ ] **Step 1: Câbler la modale sur un match**

Modify `app/(tabs)/index.tsx` :

1. Ajoute aux imports (en plus de l'existant) :
```tsx
import { useQueryClient } from '@tanstack/react-query';
import { MatchModal } from '../../src/features/matches/MatchModal';
```
2. Dans le composant `Deck`, après les hooks existants (`useRef`, `useDeck`, `useLikesRemaining`, `useSwipe`, `useRewind`), ajoute :
```tsx
  const qc = useQueryClient();
  const [matchId, setMatchId] = useState<string | null>(null);
```
(et assure-toi que `useState` est importé depuis `react`, en plus de `useRef`.)

3. Remplace la fonction `onSwiped` par :
```tsx
  function onSwiped(direction: 'like' | 'pass', index: number) {
    if (!candidates) return;
    swipe.mutate(
      { target: candidates[index].id, direction },
      {
        onSuccess: (res) => {
          if (res.matched && res.matchId) {
            qc.invalidateQueries({ queryKey: ['matches'] });
            setMatchId(res.matchId);
          }
        },
        onError: (e: any) => {
          if (typeof e?.message === 'string' && e.message.includes('QUOTA_EXCEEDED')) {
            Alert.alert('Quota atteint', 'Tu as utilisé tes 20 likes du jour. Reviens demain !');
          } else {
            Alert.alert('Oups', 'Action impossible pour le moment. Réessaie.');
          }
        },
      },
    );
  }
```
4. Juste avant la balise fermante `</View>` racine du `return` principal (celui qui contient le `Swiper`), ajoute le rendu conditionnel de la modale :
```tsx
      {matchId ? <MatchModal matchId={matchId} onClose={() => setMatchId(null)} /> : null}
```

- [ ] **Step 2: Vérifier**

Run : `npx tsc --noEmit && npm test 2>&1 | tail -3`
Expected : 0 erreur ; tests verts.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat(deck): affiche la modale It's a match au like mutuel"
```

---

## Task 9: Déploiement cloud + test e2e (développeur)

Pas exécutable en session (Docker, cloud, device). Procédure pour le développeur.

**Files:** `src/types/database.ts` (régénéré)

- [ ] **Step 1: Appliquer la migration (SQL Editor)**

Ouvre `supabase/migrations/20260615140000_plan4_matches.sql`, copie tout, colle dans le **SQL Editor**
du dashboard, **Run**. (Crée `matches`, remplace `record_swipe`, crée `my_matches` + grants.)

- [ ] **Step 2: Déployer l'Edge Function**

Run : `npx supabase functions deploy get-matches`
Expected : déployée (les variables `SUPABASE_*` sont injectées automatiquement).

- [ ] **Step 3: Régénérer les types**

Run : `npm run db:types` puis `npx tsc --noEmit` (0 erreur ; corriger un éventuel écart de type
mineur — notamment si `record_swipe` est généré en `Json`, garder l'usage `data?.likes_remaining`).

- [ ] **Step 4: Rebuild + tester le match**

`npx eas-cli build --profile development --platform android` (pas de nouveau module natif ici, donc
un simple `npx expo start --dev-client -c` peut suffire si le build précédent est à jour ; rebuild par
sécurité). Avec tes 2 comptes de test :
- compte A like le compte B, puis compte B like le compte A → **modale « It's a match »** chez B ;
- l'onglet **Matchs** montre le match en **section Actifs** avec le **compte à rebours** qui descend ;
- chez A, le match apparaît dans la liste au rafraîchissement.

- [ ] **Step 5: Tester l'expiration (sans attendre 1 h)**

Dans le SQL Editor, force l'expiration d'un match :
```sql
update public.matches set expires_at = now() - interval '1 minute'
where id = '<MATCH_ID>';
```
Recharge l'onglet Matchs → le match passe en **section Expirés** (grisé). Re-like entre les deux →
un **nouveau** match actif est créé (garde re-match OK).

- [ ] **Step 6: Vérifier la sécurité (rapide)**

Confirme qu'un `insert` direct dans `public.matches` avec la clé anon est **refusé** (aucune policy
d'insert), et que `get-matches` ne renvoie ni chemin de stockage ni coordonnée — uniquement une URL
signée + prénom + `expires_at`.

---

## Self-Review (couverture du spec)

- **§2/§3 création de match via record_swipe SECURITY DEFINER (retour {likes_remaining,matched,match_id}, garde re-match)** : Task 1 ; types/usage Task 2. ✓
- **§4 table matches + RLS participant + aucune écriture client** : Task 1. ✓
- **§5 expiration dérivée d'expires_at (is_active)** : Task 1 (`my_matches`), Tasks 4/7 (countdown/affichage). ✓
- **§6 liste des matchs via Edge Function get-matches (photo signée)** : Tasks 3, 5, 7. ✓
- **§7 modale It's a match** : Tasks 6, 8. ✓
- **§8 compte à rebours pur testé** : Task 4. ✓
- **§9 architecture client (features/matches, hooks, modale, onglet)** : Tasks 5, 6, 7, 8. ✓
- **§10 sécurité (pas de faux matchs, RLS, photos signées, my_matches service-only)** : Tasks 1, 3. ✓
- **§11 migrations & déploiement (Docker, SQL Editor, deploy get-matches)** : Task 9. ✓
- **§12 tests** : Task 4 (countdown TDD), Task 6 (MatchModal RNTL). ✓

Cohérence des noms : `recordSwipe`/`SwipeResult` (T2) → `useSwipe`/deck (T8) ; `Match`/`fetchMatches`
(T5) → `useMatches` (T5) → `MatchModal` (T6) + onglet (T7) ; `formatCountdown`/`isExpired` (T4) →
onglet (T7) ; RPC `record_swipe`/`my_matches` (T1) ↔ `database.ts` (T2) / Edge Function (T3). Retour
JSON `{likes_remaining, matched, match_id}` cohérent T1 ↔ T2 (`record_swipe.Returns`) ↔ `recordSwipe`.

Placeholders : aucun.
```
