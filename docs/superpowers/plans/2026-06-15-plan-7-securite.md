# Plan 7 — Sécurité (blocage & signalement) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permettre de bloquer / signaler une personne (silencieusement, signaler bloque aussi), avec exclusion bidirectionnelle des paires bloquées dans tout le serveur et une UI discrète (« ⋯ ») sur le deck et le chat.

**Architecture:** La ligne `blocks(blocker_id, blocked_id)` est l'unique source de vérité. Les RPC `block_user` / `report_user` (`SECURITY DEFINER`, cantonnées à `auth.uid()`) insèrent ; les fonctions existantes (`deck_candidates`, `record_swipe`, `my_matches`, `send_message`) ajoutent un prédicat « pas de blocage entre les deux dans un sens ou l'autre ». Côté client, une feature `src/features/safety/` (api + hooks React Query + composant `SafetyMenu`) branchée sur `DeckCard` et l'en-tête du chat.

**Tech Stack:** Supabase Postgres (RLS, RPC `SECURITY DEFINER`, `search_path` figé), React Native / Expo Router, @tanstack/react-query v5, jest-expo + @testing-library/react-native.

**Contrainte environnement :** Docker indisponible → la migration `plan7` n'est **pas** appliquée localement. Les tâches SQL produisent le fichier de migration ; l'application réelle se fait côté cloud (SQL Editor) par le dev, puis `npm run db:types`. Les tâches client sont vérifiables localement (`npm test`, `npx tsc --noEmit`).

**Spec :** `docs/superpowers/specs/2026-06-15-plan-7-securite-block-report-design.md`

---

## File Structure

**Créés :**
- `supabase/migrations/20260615170000_plan7_securite.sql` — tables `blocks`/`reports` + RLS, RPC `block_user`/`report_user`, `create or replace` des 4 fonctions avec le prédicat de blocage.
- `src/features/safety/report-reasons.ts` — liste des motifs + helpers (pur, testé).
- `src/features/safety/report-reasons.test.ts` — tests du module pur.
- `src/features/safety/safety-api.ts` — `blockUser` / `reportUser` (appels RPC).
- `src/features/safety/use-safety.ts` — hooks `useBlockUser` / `useReportUser`.
- `src/features/safety/SafetyMenu.tsx` — menu discret « ⋯ » (Bloquer / Signaler + motifs).
- `src/features/safety/SafetyMenu.test.tsx` — test RNTL du menu.

**Modifiés :**
- `src/types/database.ts` — ajout manuel des types `block_user`/`report_user` (Functions) et `blocks`/`reports` (Tables) pour que `tsc` passe avant régénération.
- `src/features/deck/DeckCard.tsx` — « ⋯ » en haut à droite de la carte.
- `app/match/[id].tsx` — « ⋯ » dans l'en-tête + écran « Conversation indisponible » (fin du spinner infini).

---

## Task 1 : Migration SQL — tables `blocks` / `reports` + RPC `block_user` / `report_user`

**Files:**
- Create: `supabase/migrations/20260615170000_plan7_securite.sql`

> Pas de test local (Docker indisponible). Vérification = relecture du SQL ; application réelle par le dev via le SQL Editor.

- [ ] **Step 1 : Créer le fichier de migration avec les tables et les RPC**

Créer `supabase/migrations/20260615170000_plan7_securite.sql` avec exactement ce contenu :

```sql
-- ============ Blocages (RLS propre-ligne ; source de vérité unique) ============
create table public.blocks (
  blocker_id uuid not null references public.profiles(id) on delete cascade,
  blocked_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  constraint blocks_distinct check (blocker_id <> blocked_id)
);
create index blocks_blocked_idx on public.blocks (blocked_id);

alter table public.blocks enable row level security;
create policy "blocks: select own" on public.blocks
  for select to authenticated using (auth.uid() = blocker_id);
create policy "blocks: insert own" on public.blocks
  for insert to authenticated with check (auth.uid() = blocker_id);
create policy "blocks: delete own" on public.blocks
  for delete to authenticated using (auth.uid() = blocker_id);

-- ============ Signalements (insert propre-ligne uniquement ; AUCUNE lecture client) ============
create table public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  reported_id uuid not null references public.profiles(id) on delete cascade,
  reason text not null check (reason in ('spam', 'inapproprie', 'harcelement', 'faux_profil', 'autre')),
  created_at timestamptz not null default now(),
  constraint reports_distinct check (reporter_id <> reported_id)
);
create index reports_reported_idx on public.reports (reported_id);

alter table public.reports enable row level security;
-- Pas de policy select : la modération lit côté service_role / dashboard.
create policy "reports: insert own" on public.reports
  for insert to authenticated with check (auth.uid() = reporter_id);

-- ============ block_user : bloque une personne (en son propre nom) ============
create function public.block_user(p_target uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_me uuid := auth.uid();
begin
  if v_me is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if p_target = v_me then raise exception 'CANNOT_BLOCK_SELF'; end if;
  insert into public.blocks (blocker_id, blocked_id)
    values (v_me, p_target)
    on conflict do nothing;
end;
$$;
revoke execute on function public.block_user(uuid) from public;
grant execute on function public.block_user(uuid) to authenticated;

-- ============ report_user : signale (motif prédéfini) ET bloque dans la foulée ============
create function public.report_user(p_target uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare v_me uuid := auth.uid();
begin
  if v_me is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if p_target = v_me then raise exception 'CANNOT_REPORT_SELF'; end if;
  if p_reason not in ('spam', 'inapproprie', 'harcelement', 'faux_profil', 'autre') then
    raise exception 'INVALID_REASON';
  end if;
  insert into public.reports (reporter_id, reported_id, reason)
    values (v_me, p_target, p_reason);
  insert into public.blocks (blocker_id, blocked_id)
    values (v_me, p_target)
    on conflict do nothing;
end;
$$;
revoke execute on function public.report_user(uuid, text) from public;
grant execute on function public.report_user(uuid, text) to authenticated;
```

- [ ] **Step 2 : Relire le SQL**

Vérifier à l'œil : `check` distinct sur les deux tables, RLS activée, `reports` **sans** policy select, `block_user`/`report_user` en `security definer set search_path = public`, grants `authenticated`, `report_user` insère bien dans `reports` **et** `blocks`.

- [ ] **Step 3 : Commit**

```bash
git add supabase/migrations/20260615170000_plan7_securite.sql
git commit -m "feat(plan-7): tables blocks/reports + RPC block_user/report_user"
```

---

## Task 2 : Migration SQL — exclusion des blocages dans les 4 fonctions existantes

**Files:**
- Modify: `supabase/migrations/20260615170000_plan7_securite.sql` (ajout à la fin)

> Toujours pas de test local. On remplace 4 fonctions par `create or replace` (signatures inchangées → grants préservés ; on les re-énonce par sécurité).

- [ ] **Step 1 : Ajouter le remplacement de `deck_candidates`**

Ajouter à la fin du fichier `supabase/migrations/20260615170000_plan7_securite.sql` :

```sql
-- ============ deck_candidates : exclure les paires bloquées (deux sens) ============
create or replace function public.deck_candidates(p_user uuid, p_limit int default 10, p_offset int default 0)
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
    and not exists (
      select 1 from public.blocks b
      where (b.blocker_id = me.id and b.blocked_id = c.id)
         or (b.blocker_id = c.id and b.blocked_id = me.id)
    )
  order by extensions.st_distance(me.location, c.location) asc
  limit p_limit offset p_offset;
$$;
revoke execute on function public.deck_candidates(uuid, int, int) from public, authenticated;
grant execute on function public.deck_candidates(uuid, int, int) to service_role;
```

- [ ] **Step 2 : Ajouter le remplacement de `record_swipe`**

Ajouter à la suite :

```sql
-- ============ record_swipe : pas de match si blocage (défense en profondeur) ============
create or replace function public.record_swipe(p_target uuid, p_direction text)
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

  if p_direction = 'like'
     and not exists (
       select 1 from public.blocks b
       where (b.blocker_id = v_me and b.blocked_id = p_target)
          or (b.blocker_id = p_target and b.blocked_id = v_me)
     )
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
```

- [ ] **Step 3 : Ajouter le remplacement de `my_matches`**

Ajouter à la suite :

```sql
-- ============ my_matches : exclure les matchs d'une paire bloquée ============
create or replace function public.my_matches(p_user uuid)
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
  where (m.user_a = p_user or m.user_b = p_user)
    and not exists (
      select 1 from public.blocks b
      where (b.blocker_id = p_user and b.blocked_id = other.id)
         or (b.blocker_id = other.id and b.blocked_id = p_user)
    )
  order by m.expires_at desc;
$$;
revoke execute on function public.my_matches(uuid) from public, authenticated;
grant execute on function public.my_matches(uuid) to service_role;
```

- [ ] **Step 4 : Ajouter le remplacement de `send_message`**

Ajouter à la suite (version Plan 6 + garde de blocage `MATCH_UNAVAILABLE`) :

```sql
-- ============ send_message : refuser si blocage entre les participants ============
create or replace function public.send_message(p_match_id uuid, p_body text, p_image_path text)
returns json
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_me uuid := auth.uid();
  v_msg public.messages;
begin
  if v_me is null then raise exception 'NOT_AUTHENTICATED'; end if;

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

  if exists (
    select 1 from public.matches m
    join public.blocks b
      on (b.blocker_id = v_me and b.blocked_id = case when m.user_a = v_me then m.user_b else m.user_a end)
      or (b.blocked_id = v_me and b.blocker_id = case when m.user_a = v_me then m.user_b else m.user_a end)
    where m.id = p_match_id
  ) then
    raise exception 'MATCH_UNAVAILABLE';
  end if;

  if (p_body is null and p_image_path is null)
     or (p_body is not null and p_image_path is not null) then
    raise exception 'INVALID_MESSAGE_CONTENT';
  end if;
  if p_body is not null and length(btrim(p_body)) = 0 then
    raise exception 'EMPTY_MESSAGE';
  end if;
  if p_body is not null and length(p_body) > 2000 then
    raise exception 'MESSAGE_TOO_LONG';
  end if;
  if p_image_path is not null and split_part(p_image_path, '/', 1) <> p_match_id::text then
    raise exception 'INVALID_IMAGE_PATH';
  end if;

  insert into public.messages (match_id, sender_id, body, image_path)
    values (p_match_id, v_me, p_body, p_image_path)
    returning * into v_msg;

  update public.matches
    set expires_at = now() + interval '60 minutes',
        last_message_at = now(),
        notified_expiring = false
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
```

- [ ] **Step 5 : Relire l'ensemble du fichier**

Vérifier que le prédicat de blocage est présent dans les 4 fonctions et que `send_message` conserve le reset `notified_expiring = false` (régression Plan 6 à ne pas perdre).

- [ ] **Step 6 : Commit**

```bash
git add supabase/migrations/20260615170000_plan7_securite.sql
git commit -m "feat(plan-7): exclusion des blocages (deck, swipe, matchs, message)"
```

---

## Task 3 : `report-reasons.ts` — motifs prédéfinis (pur, TDD)

**Files:**
- Create: `src/features/safety/report-reasons.ts`
- Test: `src/features/safety/report-reasons.test.ts`

- [ ] **Step 1 : Écrire le test qui échoue**

Créer `src/features/safety/report-reasons.test.ts` :

```ts
import { REPORT_REASONS, isValidReason, labelForReason } from './report-reasons';

describe('report-reasons', () => {
  it('expose les 5 motifs dans l’ordre attendu', () => {
    expect(REPORT_REASONS.map((r) => r.value)).toEqual([
      'spam',
      'inapproprie',
      'harcelement',
      'faux_profil',
      'autre',
    ]);
  });

  it('valide les motifs connus et rejette les inconnus', () => {
    expect(isValidReason('spam')).toBe(true);
    expect(isValidReason('faux_profil')).toBe(true);
    expect(isValidReason('n_importe_quoi')).toBe(false);
    expect(isValidReason('')).toBe(false);
  });

  it('renvoie le libellé FR du motif', () => {
    expect(labelForReason('harcelement')).toBe('Harcèlement');
    expect(labelForReason('inapproprie')).toBe('Contenu inapproprié');
  });
});
```

- [ ] **Step 2 : Lancer le test pour vérifier qu'il échoue**

Run: `npm test -- report-reasons`
Expected: FAIL (`Cannot find module './report-reasons'`).

- [ ] **Step 3 : Écrire l'implémentation minimale**

Créer `src/features/safety/report-reasons.ts` :

```ts
export type ReportReason = 'spam' | 'inapproprie' | 'harcelement' | 'faux_profil' | 'autre';

export const REPORT_REASONS: { value: ReportReason; label: string }[] = [
  { value: 'spam', label: 'Spam' },
  { value: 'inapproprie', label: 'Contenu inapproprié' },
  { value: 'harcelement', label: 'Harcèlement' },
  { value: 'faux_profil', label: 'Faux profil' },
  { value: 'autre', label: 'Autre' },
];

const BY_VALUE = new Map<string, string>(REPORT_REASONS.map((r) => [r.value, r.label]));

export function isValidReason(value: string): value is ReportReason {
  return BY_VALUE.has(value);
}

export function labelForReason(value: ReportReason): string {
  return BY_VALUE.get(value) ?? value;
}
```

- [ ] **Step 4 : Lancer le test pour vérifier qu'il passe**

Run: `npm test -- report-reasons`
Expected: PASS (3 tests).

- [ ] **Step 5 : Commit**

```bash
git add src/features/safety/report-reasons.ts src/features/safety/report-reasons.test.ts
git commit -m "feat(plan-7): motifs de signalement prédéfinis, testés"
```

---

## Task 4 : Types `database.ts` — `block_user` / `report_user` + tables `blocks` / `reports`

**Files:**
- Modify: `src/types/database.ts`

> Ajout manuel pour que `tsc` passe **avant** la régénération (`npm run db:types`) côté dev, comme au Plan 5/6.

- [ ] **Step 1 : Ajouter les deux fonctions dans `Functions`**

Dans `src/types/database.ts`, repérer la ligne `clear_badge: { Args: never; Returns: undefined }` dans le bloc `Functions:` du schéma `public`. Ajouter **juste au-dessus** :

```ts
      block_user: {
        Args: { p_target: string }
        Returns: undefined
      }
```

Puis repérer la ligne `rewind_last_swipe: { Args: never; Returns: string }` et ajouter **juste au-dessus** :

```ts
      report_user: {
        Args: { p_reason: string; p_target: string }
        Returns: undefined
      }
```

- [ ] **Step 2 : Ajouter les deux tables dans `Tables`**

Repérer la fin du bloc `push_tokens: { … }` dans le `Tables:` du schéma `public` (la ligne `      }` qui ferme l'entrée `push_tokens`, suivie de l'entrée suivante). Insérer **après** la fermeture de `push_tokens` :

```ts
      blocks: {
        Row: {
          blocked_id: string
          blocker_id: string
          created_at: string
        }
        Insert: {
          blocked_id: string
          blocker_id: string
          created_at?: string
        }
        Update: {
          blocked_id?: string
          blocker_id?: string
          created_at?: string
        }
        Relationships: []
      }
      reports: {
        Row: {
          created_at: string
          id: string
          reason: string
          reported_id: string
          reporter_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          reason: string
          reported_id: string
          reporter_id: string
        }
        Update: {
          created_at?: string
          id?: string
          reason?: string
          reported_id?: string
          reporter_id?: string
        }
        Relationships: []
      }
```

- [ ] **Step 3 : Vérifier que TypeScript compile**

Run: `npx tsc --noEmit`
Expected: aucune erreur nouvelle (mêmes éventuels warnings préexistants qu'avant la tâche, mais 0 erreur).

- [ ] **Step 4 : Commit**

```bash
git add src/types/database.ts
git commit -m "chore(plan-7): types manuels blocks/reports + block_user/report_user"
```

---

## Task 5 : `safety-api.ts` — appels RPC

**Files:**
- Create: `src/features/safety/safety-api.ts`

> Wrapper mince (comme `deck-api.ts` / `chat-api.ts`) : pas de test unitaire dédié ; couvert par `tsc` + le test de `SafetyMenu` + le cloud.

- [ ] **Step 1 : Écrire l'API**

Créer `src/features/safety/safety-api.ts` :

```ts
import { supabase } from '../../lib/supabase';
import type { ReportReason } from './report-reasons';

export async function blockUser(targetId: string): Promise<void> {
  const { error } = await supabase.rpc('block_user', { p_target: targetId });
  if (error) throw error;
}

export async function reportUser(targetId: string, reason: ReportReason): Promise<void> {
  const { error } = await supabase.rpc('report_user', { p_target: targetId, p_reason: reason });
  if (error) throw error;
}
```

- [ ] **Step 2 : Vérifier la compilation**

Run: `npx tsc --noEmit`
Expected: 0 erreur (les noms de RPC et leurs args sont reconnus grâce à la Task 4).

- [ ] **Step 3 : Commit**

```bash
git add src/features/safety/safety-api.ts
git commit -m "feat(plan-7): safety-api (block_user / report_user)"
```

---

## Task 6 : `use-safety.ts` — hooks React Query

**Files:**
- Create: `src/features/safety/use-safety.ts`

- [ ] **Step 1 : Écrire les hooks**

Créer `src/features/safety/use-safety.ts` :

```ts
import { Alert } from 'react-native';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { blockUser, reportUser } from './safety-api';
import type { ReportReason } from './report-reasons';

function notifyError() {
  Alert.alert('Action impossible', "L'opération n'a pas pu aboutir. Réessaie dans un instant.");
}

export function useBlockUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (targetId: string) => blockUser(targetId),
    onSuccess: () => {
      // La personne bloquée disparaît du deck et des matchs (filtrage serveur).
      qc.invalidateQueries({ queryKey: ['deck'] });
      qc.invalidateQueries({ queryKey: ['matches'] });
    },
    onError: notifyError,
  });
}

export function useReportUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ targetId, reason }: { targetId: string; reason: ReportReason }) =>
      reportUser(targetId, reason),
    onSuccess: () => {
      // Signaler bloque aussi : mêmes invalidations.
      qc.invalidateQueries({ queryKey: ['deck'] });
      qc.invalidateQueries({ queryKey: ['matches'] });
    },
    onError: notifyError,
  });
}
```

- [ ] **Step 2 : Vérifier la compilation**

Run: `npx tsc --noEmit`
Expected: 0 erreur.

- [ ] **Step 3 : Commit**

```bash
git add src/features/safety/use-safety.ts
git commit -m "feat(plan-7): hooks useBlockUser / useReportUser"
```

---

## Task 7 : `SafetyMenu.tsx` — menu discret (Bloquer / Signaler) + test

**Files:**
- Create: `src/features/safety/SafetyMenu.tsx`
- Test: `src/features/safety/SafetyMenu.test.tsx`

- [ ] **Step 1 : Écrire le test qui échoue**

Créer `src/features/safety/SafetyMenu.test.tsx` :

```tsx
import { Alert } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { SafetyMenu } from './SafetyMenu';

const blockMutate = jest.fn();
const reportMutate = jest.fn();

jest.mock('./use-safety', () => ({
  useBlockUser: () => ({ mutate: blockMutate }),
  useReportUser: () => ({ mutate: reportMutate }),
}));

describe('SafetyMenu', () => {
  beforeEach(() => {
    blockMutate.mockClear();
    reportMutate.mockClear();
  });

  it('ouvre le menu et affiche Bloquer / Signaler', () => {
    render(<SafetyMenu targetId="u1" />);
    fireEvent.press(screen.getByLabelText('Options'));
    expect(screen.getByText('Bloquer')).toBeTruthy();
    expect(screen.getByText('Signaler')).toBeTruthy();
  });

  it('« Signaler » révèle les motifs et envoie le bon motif', () => {
    render(<SafetyMenu targetId="u1" />);
    fireEvent.press(screen.getByLabelText('Options'));
    fireEvent.press(screen.getByText('Signaler'));
    expect(screen.getByText('Harcèlement')).toBeTruthy();
    fireEvent.press(screen.getByText('Harcèlement'));
    expect(reportMutate).toHaveBeenCalledWith(
      { targetId: 'u1', reason: 'harcelement' },
      expect.any(Object),
    );
  });

  it('« Bloquer » demande confirmation avant d’agir', () => {
    const spy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    render(<SafetyMenu targetId="u1" />);
    fireEvent.press(screen.getByLabelText('Options'));
    fireEvent.press(screen.getByText('Bloquer'));
    expect(spy).toHaveBeenCalled();
    expect(blockMutate).not.toHaveBeenCalled(); // l'action attend la confirmation
    spy.mockRestore();
  });
});
```

- [ ] **Step 2 : Lancer le test pour vérifier qu'il échoue**

Run: `npm test -- SafetyMenu`
Expected: FAIL (`Cannot find module './SafetyMenu'`).

- [ ] **Step 3 : Écrire le composant**

Créer `src/features/safety/SafetyMenu.tsx` :

```tsx
import { useState } from 'react';
import { Alert, Modal, Pressable, Text, View } from 'react-native';
import { REPORT_REASONS, type ReportReason } from './report-reasons';
import { useBlockUser, useReportUser } from './use-safety';

type Props = {
  targetId: string;
  onActionDone?: () => void;
  // Couleur du « ⋯ » : clair sur une photo de deck, foncé dans un en-tête blanc.
  tint?: string;
};

export function SafetyMenu({ targetId, onActionDone, tint = '#fff' }: Props) {
  const [open, setOpen] = useState(false);
  const [showReasons, setShowReasons] = useState(false);
  const block = useBlockUser();
  const report = useReportUser();

  function close() {
    setOpen(false);
    setShowReasons(false);
  }

  function done() {
    close();
    onActionDone?.();
  }

  function onBlock() {
    Alert.alert('Bloquer cette personne ?', 'Elle disparaîtra et ne pourra plus vous contacter.', [
      { text: 'Annuler', style: 'cancel' },
      {
        text: 'Bloquer',
        style: 'destructive',
        onPress: () => block.mutate(targetId, { onSuccess: done }),
      },
    ]);
  }

  function onPickReason(reason: ReportReason) {
    report.mutate({ targetId, reason }, { onSuccess: done });
  }

  return (
    <>
      <Pressable accessibilityLabel="Options" hitSlop={12} onPress={() => setOpen(true)}>
        <Text style={{ fontSize: 22, fontWeight: '700', color: tint }}>⋯</Text>
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={close}>
        <Pressable
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' }}
          onPress={close}
        >
          <Pressable
            style={{
              backgroundColor: 'white',
              borderTopLeftRadius: 16,
              borderTopRightRadius: 16,
              padding: 16,
              gap: 4,
            }}
            onPress={() => {}}
          >
            {showReasons ? (
              <>
                <Text style={{ fontSize: 16, fontWeight: '700', marginBottom: 8 }}>
                  Motif du signalement
                </Text>
                {REPORT_REASONS.map((r) => (
                  <Pressable key={r.value} onPress={() => onPickReason(r.value)} style={{ paddingVertical: 12 }}>
                    <Text style={{ fontSize: 16 }}>{r.label}</Text>
                  </Pressable>
                ))}
              </>
            ) : (
              <>
                <Pressable onPress={onBlock} style={{ paddingVertical: 12 }}>
                  <Text style={{ fontSize: 16 }}>Bloquer</Text>
                </Pressable>
                <Pressable onPress={() => setShowReasons(true)} style={{ paddingVertical: 12 }}>
                  <Text style={{ fontSize: 16 }}>Signaler</Text>
                </Pressable>
              </>
            )}
            <Pressable onPress={close} style={{ paddingVertical: 12 }}>
              <Text style={{ fontSize: 16, color: '#888' }}>Annuler</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}
```

- [ ] **Step 4 : Lancer le test pour vérifier qu'il passe**

Run: `npm test -- SafetyMenu`
Expected: PASS (3 tests).

- [ ] **Step 5 : Commit**

```bash
git add src/features/safety/SafetyMenu.tsx src/features/safety/SafetyMenu.test.tsx
git commit -m "feat(plan-7): SafetyMenu discret (bloquer/signaler), testé"
```

---

## Task 8 : Brancher `SafetyMenu` sur la carte du deck

**Files:**
- Modify: `src/features/deck/DeckCard.tsx`

- [ ] **Step 1 : Importer `SafetyMenu`**

Dans `src/features/deck/DeckCard.tsx`, après la ligne `import { formatAge, formatDistance } from './deck-format';`, ajouter :

```tsx
import { SafetyMenu } from '../safety/SafetyMenu';
```

- [ ] **Step 2 : Ajouter le « ⋯ » en haut à droite de la carte**

Toujours dans `src/features/deck/DeckCard.tsx`, juste **après** le bloc `</Pressable>` qui ferme la zone photo (la ligne `</Pressable>` à la fin du `<Pressable style={{ flex: 1 }} …>`), ajouter :

```tsx
      <View style={{ position: 'absolute', top: 12, right: 12 }}>
        <SafetyMenu targetId={candidate.id} />
      </View>
```

(Le menu en position absolue se superpose à la photo ; son `Pressable` capte le tap.)

- [ ] **Step 3 : Vérifier la compilation et la suite de tests**

Run: `npx tsc --noEmit && npm test -- deck-card`
Expected: 0 erreur TypeScript ; les tests `deck-card` existants passent toujours.

- [ ] **Step 4 : Commit**

```bash
git add src/features/deck/DeckCard.tsx
git commit -m "feat(plan-7): menu sécurité discret sur la carte du deck"
```

---

## Task 9 : Brancher `SafetyMenu` sur l'en-tête du chat + « Conversation indisponible »

**Files:**
- Modify: `app/match/[id].tsx`

- [ ] **Step 1 : Mettre à jour les imports**

Dans `app/match/[id].tsx` :

Remplacer la ligne :

```tsx
import { Stack, useLocalSearchParams } from 'expo-router';
```

par :

```tsx
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
```

Puis, après la ligne `import { ChatInput } from '../../src/features/chat/ChatInput';`, ajouter :

```tsx
import { SafetyMenu } from '../../src/features/safety/SafetyMenu';
```

- [ ] **Step 2 : Récupérer `router` et l'état de chargement des matchs**

Remplacer :

```tsx
  const { session } = useSession();
  const myId = session?.user.id;

  const { data: matches } = useMatches();
  const match = (matches ?? []).find((m) => m.match_id === matchId);

  const { data: messages = [], isLoading } = useMessages(matchId);
```

par :

```tsx
  const router = useRouter();
  const { session } = useSession();
  const myId = session?.user.id;

  const { data: matches, isLoading: matchesLoading } = useMatches();
  const match = (matches ?? []).find((m) => m.match_id === matchId);

  const { data: messages = [], isLoading: messagesLoading } = useMessages(matchId);
```

- [ ] **Step 3 : Remplacer le garde unique par trois cas (dont l'écran « indisponible »)**

Remplacer le bloc :

```tsx
  if (!match || !myId || (isLoading && messages.length === 0)) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator />
      </View>
    );
  }
```

par :

```tsx
  // Session ou liste des matchs encore en cours de chargement.
  if (!myId || matchesLoading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator />
      </View>
    );
  }

  // Matchs chargés mais celui-ci est absent (bloqué, expiré et purgé, ou supprimé) :
  // on évite le spinner infini en affichant un état clair (+ bouton retour via l'en-tête).
  if (!match) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <Stack.Screen options={{ headerShown: true, title: 'Conversation' }} />
        <Text style={{ textAlign: 'center', color: '#777' }}>Conversation indisponible.</Text>
      </View>
    );
  }

  // Match présent : messages encore en cours de premier chargement.
  if (messagesLoading && messages.length === 0) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator />
      </View>
    );
  }
```

- [ ] **Step 4 : Ajouter le « ⋯ » dans l'en-tête, à côté du compte à rebours**

Remplacer le `headerRight` :

```tsx
          headerRight: () => (
            <Text style={{ color: expired ? '#999' : under10 ? '#E53935' : '#208AEF', fontWeight: '600' }}>
              {expired ? 'Expiré' : `⏳ ${formatCountdown(expiresAt, now)}`}
            </Text>
          ),
```

par :

```tsx
          headerRight: () => (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <Text style={{ color: expired ? '#999' : under10 ? '#E53935' : '#208AEF', fontWeight: '600' }}>
                {expired ? 'Expiré' : `⏳ ${formatCountdown(expiresAt, now)}`}
              </Text>
              <SafetyMenu
                targetId={match.other_id}
                tint="#333"
                onActionDone={() => router.back()}
              />
            </View>
          ),
```

- [ ] **Step 5 : Vérifier la compilation et lancer toute la suite de tests**

Run: `npx tsc --noEmit && npm test`
Expected: 0 erreur TypeScript ; tous les tests passent (dont `report-reasons` et `SafetyMenu`).

- [ ] **Step 6 : Commit**

```bash
git add app/match/[id].tsx
git commit -m "feat(plan-7): menu sécurité dans l'en-tête du chat + écran conversation indisponible"
```

---

## Déploiement (après implémentation, côté dev)

1. **SQL Editor** : appliquer `supabase/migrations/20260615170000_plan7_securite.sql` (tables + RLS + RPC + remplacement des 4 fonctions).
2. `npm run db:types` pour régénérer `src/types/database.ts` ; relancer `npx tsc --noEmit` (surveiller un éventuel re-typage des params RPC, comme l'incident `send_message` au Plan 5 ; ajouter un cast localisé si besoin).
3. **Pas** de nouvelle Edge Function, **pas** de secret Vault, **pas** de rebuild EAS (aucun module natif).
4. Test manuel : bloquer depuis une carte → la personne disparaît du deck ; bloquer/signaler depuis un chat → le match disparaît des deux côtés et l'écran affiche « Conversation indisponible ».

---

## Self-Review

- **Spec coverage :** blocks/reports + RLS (Task 1) ; RPC block_user/report_user, signaler-bloque-aussi (Task 1) ; exclusion deck/swipe/matchs/message (Task 2) ; motifs prédéfinis (Task 3) ; api/hooks (Tasks 5-6) ; UI discrète deck + chat (Tasks 7-9) ; gestion gracieuse « Conversation indisponible » (Task 9) ; reports non lisibles client (Task 1, pas de policy select) ; sécurité definer/search_path figé (Tasks 1-2). Hors périmètre (déblocage, modération in-app) non implémenté — conforme.
- **Placeholders :** aucun ; code complet à chaque étape.
- **Type consistency :** `ReportReason`/`REPORT_REASONS`/`isValidReason`/`labelForReason` (Task 3) réutilisés tels quels en 5/6/7 ; `blockUser`/`reportUser` (Task 5) ↔ `useBlockUser`/`useReportUser` (Task 6) ↔ `SafetyMenu` (Task 7) ; `reportUser` signature `(targetId, reason)` et hook `mutate({ targetId, reason })` cohérents avec le test ; `match.other_id` confirmé dans le retour de `my_matches`/type `Match`.
