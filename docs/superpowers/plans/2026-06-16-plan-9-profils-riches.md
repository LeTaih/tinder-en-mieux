# Plan 9 — Profils plus riches — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enrichir les profils (centres d'intérêt, métier/études/taille, prompts) avec une vue détaillée, un écran d'édition et une étape onboarding optionnelle.

**Architecture :** Données dans Postgres (catalogues lisibles + tables de liaison own-row + colonnes sur `profiles`) ; les champs riches d'autrui sont diffusés **inline** via `deck_candidates`/`my_matches` (`SECURITY DEFINER`) puis signés par les Edge Functions `get-deck`/`get-matches`. UI bâtie sur le thème/composants du Plan 8.

**Tech Stack :** Supabase (Postgres, RLS, RPC definer, Edge Functions Deno), Expo Router, React Native, @tanstack/react-query, jest-expo. Docker indispo → migration appliquée par le dev via SQL Editor.

**Spec :** `docs/superpowers/specs/2026-06-16-plan-9-profils-riches-design.md`

---

## Conventions (rappel)
- Thème : `import { Colors, Spacing, Radii, FontSizes } from '<...>/lib/theme';`
- Composants partagés (Plan 8) : `AppButton`, `EmptyState`, `ErrorText` (`src/components/`).
- Tests colocalisés ; tutoiement partout.

---

# PHASE 1 — Données + diffusion + affichage

## Task 1 : Migration SQL (1/3) — catalogues, tables de liaison, colonnes

**Files:** Create: `supabase/migrations/20260616180000_plan9_profils_riches.sql`

> Pas de test local (Docker indispo) — relecture + application cloud par le dev.

- [ ] **Step 1 : Créer le fichier avec ce contenu**

```sql
-- ============ Catalogues (lecture authentifiée, comme genders) ============
create table public.interests (
  id uuid primary key default gen_random_uuid(),
  key text unique not null,
  label text not null,
  is_active boolean not null default true,
  sort_order int not null default 0
);
alter table public.interests enable row level security;
create policy "interests: lecture authentifiée" on public.interests
  for select to authenticated using (true);
insert into public.interests (key, label, sort_order) values
  ('sport','Sport',1),('musique','Musique',2),('voyage','Voyage',3),('cuisine','Cuisine',4),
  ('cinema','Cinéma',5),('jeux_video','Jeux vidéo',6),('lecture','Lecture',7),('art','Art',8),
  ('nature','Nature',9),('animaux','Animaux',10),('sorties','Sorties',11),('fitness','Fitness',12),
  ('photographie','Photographie',13),('danse','Danse',14),('tech','Tech',15),('mode','Mode',16),
  ('cafe','Café',17),('vin','Vin',18),('yoga','Yoga',19),('festivals','Festivals',20);

create table public.prompts (
  id uuid primary key default gen_random_uuid(),
  key text unique not null,
  question text not null,
  is_active boolean not null default true,
  sort_order int not null default 0
);
alter table public.prompts enable row level security;
create policy "prompts: lecture authentifiée" on public.prompts
  for select to authenticated using (true);
insert into public.prompts (key, question, sort_order) values
  ('dimanche_ideal','Le dimanche idéal…',1),
  ('on_matche_si','On matche si…',2),
  ('passion_inavouable','Ma passion inavouable…',3),
  ('jamais_sans','Je ne pars jamais sans…',4),
  ('me_fait_rire','Ce qui me fait rire…',5),
  ('plat_signature','Mon plat signature…',6),
  ('voyage_reve','Mon prochain voyage de rêve…',7),
  ('petit_plaisir','Mon petit plaisir coupable…',8),
  ('fier_de','Je suis fier·e de…',9),
  ('week_end_parfait','Un week-end parfait…',10);

-- ============ Tables de liaison (RLS propre-ligne) ============
create table public.profile_interests (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  interest_id uuid not null references public.interests(id) on delete cascade,
  primary key (profile_id, interest_id)
);
alter table public.profile_interests enable row level security;
create policy "profile_interests: select own" on public.profile_interests
  for select to authenticated using (auth.uid() = profile_id);
create policy "profile_interests: insert own" on public.profile_interests
  for insert to authenticated with check (auth.uid() = profile_id);
create policy "profile_interests: delete own" on public.profile_interests
  for delete to authenticated using (auth.uid() = profile_id);

create table public.profile_prompts (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  prompt_id uuid not null references public.prompts(id),
  answer text not null check (length(btrim(answer)) between 1 and 200),
  position int not null check (position between 0 and 2),
  unique (profile_id, position),
  unique (profile_id, prompt_id)
);
alter table public.profile_prompts enable row level security;
create policy "profile_prompts: select own" on public.profile_prompts
  for select to authenticated using (auth.uid() = profile_id);
create policy "profile_prompts: insert own" on public.profile_prompts
  for insert to authenticated with check (auth.uid() = profile_id);
create policy "profile_prompts: update own" on public.profile_prompts
  for update to authenticated using (auth.uid() = profile_id) with check (auth.uid() = profile_id);
create policy "profile_prompts: delete own" on public.profile_prompts
  for delete to authenticated using (auth.uid() = profile_id);

-- ============ Colonnes riches sur profiles ============
alter table public.profiles
  add column if not exists job text check (job is null or length(job) <= 50),
  add column if not exists education text check (education is null or length(education) <= 50),
  add column if not exists height_cm int check (height_cm is null or height_cm between 120 and 230);
```

- [ ] **Step 2 : Relire** (catalogues + seeds, RLS propre-ligne sur les 2 tables de liaison, checks colonnes).
- [ ] **Step 3 : Commit**

```bash
git add supabase/migrations/20260616180000_plan9_profils_riches.sql
git commit -m "feat(plan-9): catalogues interests/prompts + tables de liaison + colonnes profiles"
```

---

## Task 2 : Migration SQL (2/3) — RPC set_my_interests / set_my_prompts

**Files:** Modify: `supabase/migrations/20260616180000_plan9_profils_riches.sql` (append)

- [ ] **Step 1 : Ajouter à la fin du fichier**

```sql
-- ============ set_my_interests (remplacement atomique, ≤5) ============
create function public.set_my_interests(p_interest_ids uuid[]) returns void
language plpgsql security definer set search_path = public as $$
declare v_me uuid := auth.uid();
begin
  if v_me is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if coalesce(array_length(p_interest_ids, 1), 0) > 5 then raise exception 'TOO_MANY_INTERESTS'; end if;
  delete from public.profile_interests where profile_id = v_me;
  insert into public.profile_interests (profile_id, interest_id)
    select v_me, i.id from public.interests i
    where i.id = any(p_interest_ids) and i.is_active
    on conflict do nothing;
end;
$$;
revoke execute on function public.set_my_interests(uuid[]) from public;
grant execute on function public.set_my_interests(uuid[]) to authenticated;

-- ============ set_my_prompts (remplacement atomique, ≤3, réponses 1..200) ============
create function public.set_my_prompts(p_prompt_ids uuid[], p_answers text[]) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
  v_n int := coalesce(array_length(p_prompt_ids, 1), 0);
  i int;
begin
  if v_me is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if v_n > 3 or v_n <> coalesce(array_length(p_answers, 1), 0) then raise exception 'INVALID_PROMPTS'; end if;
  if v_n <> (select count(distinct x) from unnest(p_prompt_ids) x) then raise exception 'DUPLICATE_PROMPT'; end if;
  delete from public.profile_prompts where profile_id = v_me;
  for i in 1 .. v_n loop
    if length(btrim(p_answers[i])) = 0 or length(p_answers[i]) > 200 then raise exception 'INVALID_ANSWER'; end if;
    if not exists (select 1 from public.prompts pr where pr.id = p_prompt_ids[i] and pr.is_active) then
      raise exception 'UNKNOWN_PROMPT';
    end if;
    insert into public.profile_prompts (profile_id, prompt_id, answer, position)
      values (v_me, p_prompt_ids[i], btrim(p_answers[i]), i - 1);
  end loop;
end;
$$;
revoke execute on function public.set_my_prompts(uuid[], text[]) from public;
grant execute on function public.set_my_prompts(uuid[], text[]) to authenticated;
```

- [ ] **Step 2 : Relire** (cantonnement `auth.uid()`, plafonds, validation longueur, doublons).
- [ ] **Step 3 : Commit**

```bash
git add supabase/migrations/20260616180000_plan9_profils_riches.sql
git commit -m "feat(plan-9): RPC set_my_interests / set_my_prompts"
```

---

## Task 3 : Migration SQL (3/3) — diffusion dans deck_candidates / my_matches

**Files:** Modify: `supabase/migrations/20260616180000_plan9_profils_riches.sql` (append)

> Le changement de type de retour impose `drop function` + recréation. **Conserver intégralement** les filtres existants (swipes + blocage du Plan 7).

- [ ] **Step 1 : Ajouter `deck_candidates` enrichi**

```sql
-- ============ deck_candidates : + champs riches (conserve filtres swipes + blocage) ============
drop function if exists public.deck_candidates(uuid, int, int);
create function public.deck_candidates(p_user uuid, p_limit int default 10, p_offset int default 0)
returns table (
  id uuid, display_name text, age int, distance_km int, bio text, photo_paths text[],
  job text, education text, height_cm int, interests text[], prompts jsonb
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
    ) as photo_paths,
    c.job, c.education, c.height_cm,
    array(
      select i.label from public.profile_interests pi
      join public.interests i on i.id = pi.interest_id
      where pi.profile_id = c.id order by i.sort_order
    ) as interests,
    coalesce((
      select jsonb_agg(jsonb_build_object('question', pr.question, 'answer', ppr.answer) order by ppr.position)
      from public.profile_prompts ppr join public.prompts pr on pr.id = ppr.prompt_id
      where ppr.profile_id = c.id
    ), '[]'::jsonb) as prompts
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

- [ ] **Step 2 : Ajouter `my_matches` enrichi** (+ `photo_paths` pour la vue détaillée)

```sql
-- ============ my_matches : + champs riches + toutes les photos (conserve filtre blocage) ============
drop function if exists public.my_matches(uuid);
create function public.my_matches(p_user uuid)
returns table (
  match_id uuid, other_id uuid, display_name text, photo_path text, photo_paths text[],
  expires_at timestamptz, is_active boolean,
  job text, education text, height_cm int, interests text[], prompts jsonb
)
language sql security definer set search_path = public as $$
  select
    m.id as match_id,
    other.id as other_id,
    other.display_name,
    (select pp.storage_path from public.profile_photos pp
       where pp.profile_id = other.id order by pp.position limit 1) as photo_path,
    array(select pp.storage_path from public.profile_photos pp
       where pp.profile_id = other.id order by pp.position) as photo_paths,
    m.expires_at,
    (m.expires_at > now()) as is_active,
    other.job, other.education, other.height_cm,
    array(
      select i.label from public.profile_interests pi
      join public.interests i on i.id = pi.interest_id
      where pi.profile_id = other.id order by i.sort_order
    ) as interests,
    coalesce((
      select jsonb_agg(jsonb_build_object('question', pr.question, 'answer', ppr.answer) order by ppr.position)
      from public.profile_prompts ppr join public.prompts pr on pr.id = ppr.prompt_id
      where ppr.profile_id = other.id
    ), '[]'::jsonb) as prompts
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

- [ ] **Step 3 : Relire** (filtres swipes + blocage présents dans deck_candidates ; blocage présent dans my_matches ; grants service_role).
- [ ] **Step 4 : Commit**

```bash
git add supabase/migrations/20260616180000_plan9_profils_riches.sql
git commit -m "feat(plan-9): deck_candidates / my_matches renvoient les champs riches"
```

---

## Task 4 : types `database.ts` (ajout manuel)

**Files:** Modify: `src/types/database.ts`

> Pour `tsc` avant régénération `db:types`. READ le fichier, repère le schéma `public`.

- [ ] **Step 1 : Tables** — ajouter dans `Tables` (après une entrée existante, ex. `prompts`/`preferences`) :
```ts
      interests: {
        Row: { id: string; key: string; label: string; is_active: boolean; sort_order: number }
        Insert: { id?: string; key: string; label: string; is_active?: boolean; sort_order?: number }
        Update: { id?: string; key?: string; label?: string; is_active?: boolean; sort_order?: number }
        Relationships: []
      }
      prompts: {
        Row: { id: string; key: string; question: string; is_active: boolean; sort_order: number }
        Insert: { id?: string; key: string; question: string; is_active?: boolean; sort_order?: number }
        Update: { id?: string; key?: string; question?: string; is_active?: boolean; sort_order?: number }
        Relationships: []
      }
      profile_interests: {
        Row: { profile_id: string; interest_id: string }
        Insert: { profile_id: string; interest_id: string }
        Update: { profile_id?: string; interest_id?: string }
        Relationships: []
      }
      profile_prompts: {
        Row: { id: string; profile_id: string; prompt_id: string; answer: string; position: number }
        Insert: { id?: string; profile_id: string; prompt_id: string; answer: string; position: number }
        Update: { id?: string; profile_id?: string; prompt_id?: string; answer?: string; position?: number }
        Relationships: []
      }
```

- [ ] **Step 2 : Colonnes `profiles`** — dans l'entrée `profiles` (Row/Insert/Update), ajouter les champs `job: string | null`, `education: string | null`, `height_cm: number | null` (Insert/Update en optionnels `?`).

- [ ] **Step 3 : Functions** — ajouter dans `Functions` :
```ts
      set_my_interests: { Args: { p_interest_ids: string[] }; Returns: undefined }
      set_my_prompts: { Args: { p_prompt_ids: string[]; p_answers: string[] }; Returns: undefined }
```
Et mettre à jour les `Returns` de `deck_candidates` et `my_matches` pour inclure les nouvelles colonnes (`job: string | null`, `education: string | null`, `height_cm: number | null`, `interests: string[]`, `prompts: Json`; et pour `my_matches` aussi `photo_paths: string[]`).

- [ ] **Step 4 : Vérifier** `npx tsc --noEmit` → 0 erreur.
- [ ] **Step 5 : Commit**

```bash
git add src/types/database.ts
git commit -m "chore(plan-9): types manuels (catalogues, liaisons, colonnes, RPC, retours enrichis)"
```

---

## Task 5 : Edge Functions get-deck / get-matches — passer les champs riches

**Files:** Modify: `supabase/functions/get-deck/index.ts`, `supabase/functions/get-matches/index.ts`

> Ces fonctions **mappent explicitement** les champs (pas de passe-plat) → il faut ajouter les nouveaux.

- [ ] **Step 1 : `get-deck`** — étendre l'objet poussé. Remplacer le `candidates.push({ ... })` par :
```ts
    candidates.push({
      id: r.id, display_name: r.display_name, age: r.age, distance_km: r.distance_km, bio: r.bio, photos,
      job: r.job ?? null, education: r.education ?? null, height_cm: r.height_cm ?? null,
      interests: r.interests ?? [], prompts: r.prompts ?? [],
    });
```
Et élargir le type du tableau `candidates` (la déclaration `as Array<{...}>`) pour inclure `job: string | null; education: string | null; height_cm: number | null; interests: string[]; prompts: unknown`.

- [ ] **Step 2 : `get-matches`** — signer toutes les photos + ajouter les champs riches. Remplacer la boucle de construction par :
```ts
  for (const r of rows ?? []) {
    let photo: string | null = null;
    if (r.photo_path) {
      const { data: signed } = await service.storage.from('profile-photos').createSignedUrl(r.photo_path, SIGNED_URL_TTL);
      photo = signed?.signedUrl ?? null;
    }
    const allPaths: string[] = r.photo_paths ?? [];
    let photos: string[] = [];
    if (allPaths.length > 0) {
      const { data: signedAll } = await service.storage.from('profile-photos').createSignedUrls(allPaths, SIGNED_URL_TTL);
      photos = (signedAll ?? []).map((s) => s.signedUrl).filter(Boolean) as string[];
    }
    matches.push({
      match_id: r.match_id, other_id: r.other_id, display_name: r.display_name,
      photo, photos, expires_at: r.expires_at, is_active: r.is_active,
      job: r.job ?? null, education: r.education ?? null, height_cm: r.height_cm ?? null,
      interests: r.interests ?? [], prompts: r.prompts ?? [],
    });
  }
```
Et élargir le type du tableau `matches` pour inclure `photos: string[]; job: string | null; education: string | null; height_cm: number | null; interests: string[]; prompts: unknown`.

- [ ] **Step 3 : Commit** (pas de test local ; déployées par le dev)

```bash
git add supabase/functions/get-deck/index.ts supabase/functions/get-matches/index.ts
git commit -m "feat(plan-9): get-deck / get-matches exposent les champs riches"
```

---

## Task 6 : types client + API/hook catalogues

**Files:** Modify: `src/features/deck/deck-api.ts`, `src/features/matches/matches-api.ts`; Create: `src/features/profile/catalog-api.ts`, `src/features/profile/use-catalogs.ts`

- [ ] **Step 1 : type partagé `RichProfileFields`** — créer `src/features/profile/rich-types.ts` :
```ts
export type PromptAnswer = { question: string; answer: string };
export type RichProfileFields = {
  job: string | null;
  education: string | null;
  height_cm: number | null;
  interests: string[];
  prompts: PromptAnswer[];
};
```

- [ ] **Step 2 : `DeckCandidate`** — dans `src/features/deck/deck-api.ts`, importer `RichProfileFields` et l'intersecter :
```ts
import type { RichProfileFields } from '../profile/rich-types';
export type DeckCandidate = {
  id: string; display_name: string; age: number; distance_km: number; bio: string | null; photos: string[];
} & RichProfileFields;
```

- [ ] **Step 3 : `Match`** — dans `src/features/matches/matches-api.ts` :
```ts
import type { RichProfileFields } from '../profile/rich-types';
export type Match = {
  match_id: string; other_id: string; display_name: string;
  photo: string | null; photos: string[]; expires_at: string; is_active: boolean;
} & RichProfileFields;
```

- [ ] **Step 4 : catalogues** — créer `src/features/profile/catalog-api.ts` :
```ts
import { supabase } from '../../lib/supabase';

export type Interest = { id: string; label: string };
export type Prompt = { id: string; question: string };

export async function fetchInterests(): Promise<Interest[]> {
  const { data, error } = await supabase.from('interests').select('id, label').eq('is_active', true).order('sort_order');
  if (error) throw error;
  return data ?? [];
}
export async function fetchPrompts(): Promise<Prompt[]> {
  const { data, error } = await supabase.from('prompts').select('id, question').eq('is_active', true).order('sort_order');
  if (error) throw error;
  return data ?? [];
}
```

- [ ] **Step 5 : hooks** — créer `src/features/profile/use-catalogs.ts` :
```ts
import { useQuery } from '@tanstack/react-query';
import { fetchInterests, fetchPrompts } from './catalog-api';

export function useInterests() {
  return useQuery({ queryKey: ['interests'], queryFn: fetchInterests, staleTime: 1000 * 60 * 60 });
}
export function usePrompts() {
  return useQuery({ queryKey: ['prompts'], queryFn: fetchPrompts, staleTime: 1000 * 60 * 60 });
}
```

- [ ] **Step 6 : Vérifier** `npx tsc --noEmit` → 0 erreur.
- [ ] **Step 7 : Commit**

```bash
git add src/features/profile/rich-types.ts src/features/profile/catalog-api.ts src/features/profile/use-catalogs.ts src/features/deck/deck-api.ts src/features/matches/matches-api.ts
git commit -m "feat(plan-9): types riches client + API/hooks catalogues"
```

---

## Task 7 : helpers de validation (pur, TDD)

**Files:** Create: `src/features/profile/rich-validation.ts`, `src/features/profile/rich-validation.test.ts`

- [ ] **Step 1 : test qui échoue** — `src/features/profile/rich-validation.test.ts` :
```ts
import { isValidHeight, canAddInterest, validatePromptAnswer } from './rich-validation';

describe('rich-validation', () => {
  it('taille valide entre 120 et 230', () => {
    expect(isValidHeight(170)).toBe(true);
    expect(isValidHeight(119)).toBe(false);
    expect(isValidHeight(231)).toBe(false);
    expect(isValidHeight(null)).toBe(true); // optionnel
  });
  it('plafond de 5 intérêts', () => {
    expect(canAddInterest(4)).toBe(true);
    expect(canAddInterest(5)).toBe(false);
  });
  it('réponse de prompt 1..200 non vide', () => {
    expect(validatePromptAnswer('Coucou')).toBeNull();
    expect(validatePromptAnswer('   ')).toBe('Réponse vide.');
    expect(validatePromptAnswer('x'.repeat(201))).toBe('200 caractères maximum.');
  });
});
```

- [ ] **Step 2 : lancer** `npm test -- rich-validation` → FAIL.
- [ ] **Step 3 : implémenter** — `src/features/profile/rich-validation.ts` :
```ts
export const MAX_INTERESTS = 5;
export const MAX_PROMPTS = 3;
export const MAX_ANSWER = 200;
export const MIN_HEIGHT = 120;
export const MAX_HEIGHT = 230;

export function isValidHeight(cm: number | null): boolean {
  if (cm === null) return true;
  return Number.isInteger(cm) && cm >= MIN_HEIGHT && cm <= MAX_HEIGHT;
}

export function canAddInterest(currentCount: number): boolean {
  return currentCount < MAX_INTERESTS;
}

export function validatePromptAnswer(answer: string): string | null {
  const t = answer.trim();
  if (t.length === 0) return 'Réponse vide.';
  if (answer.length > MAX_ANSWER) return `${MAX_ANSWER} caractères maximum.`;
  return null;
}
```

- [ ] **Step 4 : lancer** `npm test -- rich-validation` → PASS (3).
- [ ] **Step 5 : Commit**

```bash
git add src/features/profile/rich-validation.ts src/features/profile/rich-validation.test.ts
git commit -m "feat(plan-9): helpers de validation riches, testés"
```

---

## Task 8 : `ProfileDetailModal` (+ test)

**Files:** Create: `src/features/profile/ProfileDetailModal.tsx`, `src/features/profile/ProfileDetailModal.test.tsx`

> Composant présentational : reçoit les données déjà chargées (candidat ou match). Pas de fetch.

- [ ] **Step 1 : test qui échoue** — `src/features/profile/ProfileDetailModal.test.tsx` :
```tsx
import { fireEvent, render, screen } from '@testing-library/react-native';
import { ProfileDetailModal } from './ProfileDetailModal';

const data = {
  display_name: 'Léa', age: 24, distance_km: 3, bio: 'Salut', photos: ['https://x/p.jpg'],
  job: 'Designer', education: 'Beaux-Arts', height_cm: 168,
  interests: ['Sport', 'Voyage'],
  prompts: [{ question: 'On matche si…', answer: 'tu aimes la rando' }],
};

it('affiche infos riches + prompts et ferme', () => {
  const onClose = jest.fn();
  render(<ProfileDetailModal data={data} onClose={onClose} />);
  expect(screen.getByText('Léa, 24 ans')).toBeTruthy();
  expect(screen.getByText('Designer')).toBeTruthy();
  expect(screen.getByText('Sport')).toBeTruthy();
  expect(screen.getByText('On matche si…')).toBeTruthy();
  expect(screen.getByText('tu aimes la rando')).toBeTruthy();
  fireEvent.press(screen.getByLabelText('Fermer'));
  expect(onClose).toHaveBeenCalled();
});
```

- [ ] **Step 2 : lancer** `npm test -- ProfileDetailModal` → FAIL.
- [ ] **Step 3 : implémenter** — `src/features/profile/ProfileDetailModal.tsx` :
```tsx
import { Image, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { Colors, FontSizes, Radii, Spacing } from '../../lib/theme';
import { formatAge, formatDistance } from '../deck/deck-format';
import type { PromptAnswer } from './rich-types';

export type ProfileDetailData = {
  display_name: string;
  age: number;
  distance_km: number;
  bio: string | null;
  photos: string[];
  job: string | null;
  education: string | null;
  height_cm: number | null;
  interests: string[];
  prompts: PromptAnswer[];
};

function Chip({ label }: { label: string }) {
  return (
    <View style={{ backgroundColor: Colors.primaryBg, borderRadius: Radii.pill, paddingHorizontal: Spacing.md, paddingVertical: 6 }}>
      <Text style={{ color: Colors.primary, fontSize: FontSizes.sm }}>{label}</Text>
    </View>
  );
}

export function ProfileDetailModal({ data, onClose }: { data: ProfileDetailData; onClose: () => void }) {
  const facts = [data.job, data.education, data.height_cm ? `${data.height_cm} cm` : null].filter(Boolean) as string[];
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: Colors.white }}>
        <View style={{ flexDirection: 'row', justifyContent: 'flex-end', padding: Spacing.md }}>
          <Pressable accessibilityRole="button" accessibilityLabel="Fermer" hitSlop={12} onPress={onClose}>
            <Text style={{ fontSize: 28, color: Colors.textMuted }}>✕</Text>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={{ padding: Spacing.lg, gap: Spacing.lg }}>
          {data.photos[0] ? (
            <Image source={{ uri: data.photos[0] }} style={{ width: '100%', height: 380, borderRadius: Radii.lg }} resizeMode="cover" />
          ) : null}
          <Text style={{ fontSize: FontSizes.xxl, fontWeight: '800', color: Colors.text }}>
            {data.display_name}, {formatAge(data.age)}
          </Text>
          <Text style={{ color: Colors.textMuted }}>{formatDistance(data.distance_km)}</Text>
          {facts.length > 0 ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm }}>
              {facts.map((f) => <Chip key={f} label={f} />)}
            </View>
          ) : null}
          {data.bio ? <Text style={{ fontSize: FontSizes.md, color: Colors.text }}>{data.bio}</Text> : null}
          {data.interests.length > 0 ? (
            <View style={{ gap: Spacing.sm }}>
              <Text style={{ fontWeight: '700', color: Colors.text }}>Centres d'intérêt</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm }}>
                {data.interests.map((i) => <Chip key={i} label={i} />)}
              </View>
            </View>
          ) : null}
          {data.prompts.map((p) => (
            <View key={p.question} style={{ backgroundColor: Colors.bgMuted, borderRadius: Radii.md, padding: Spacing.md, gap: 4 }}>
              <Text style={{ fontWeight: '700', color: Colors.textMuted }}>{p.question}</Text>
              <Text style={{ fontSize: FontSizes.md, color: Colors.text }}>{p.answer}</Text>
            </View>
          ))}
          {data.photos.slice(1).map((uri, idx) => (
            <Image key={uri} source={{ uri }} style={{ width: '100%', height: 380, borderRadius: Radii.lg }} resizeMode="cover" />
          ))}
        </ScrollView>
      </View>
    </Modal>
  );
}
```

- [ ] **Step 4 : lancer** `npm test -- ProfileDetailModal` → PASS.
- [ ] **Step 5 : Commit**

```bash
git add src/features/profile/ProfileDetailModal.tsx src/features/profile/ProfileDetailModal.test.tsx
git commit -m "feat(plan-9): ProfileDetailModal (vue détaillée), testé"
```

---

## Task 9 : carte deck — puces d'intérêt + ouverture de la vue détaillée

**Files:** Modify: `src/features/deck/DeckCard.tsx`, `app/(tabs)/index.tsx`

- [ ] **Step 1 : `DeckCard` — props + puces + bouton « Voir le profil »**

Ajouter l'import `import { Colors, Radii, FontSizes } from '../../lib/theme';` (FontSizes en plus) et le prop `onOpenDetail: () => void` au type `Props`. Dans le bloc bas (après la bio, avant la rangée de boutons d'action), insérer :
```tsx
        {candidate.interests.length > 0 ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
            {candidate.interests.slice(0, 3).map((i) => (
              <View key={i} style={{ backgroundColor: 'rgba(255,255,255,0.85)', borderRadius: Radii.pill, paddingHorizontal: 10, paddingVertical: 4 }}>
                <Text style={{ color: Colors.text, fontSize: FontSizes.sm }}>{i}</Text>
              </View>
            ))}
          </View>
        ) : null}
        <Pressable accessibilityRole="button" accessibilityLabel="Voir le profil" onPress={onOpenDetail} style={{ marginTop: 8 }}>
          <Text style={[{ color: Colors.white, fontWeight: '700' }, textShadow]}>ⓘ Voir le profil</Text>
        </Pressable>
```
(`onOpenDetail` doit être ajouté à la déstructuration des props.)

- [ ] **Step 2 : `app/(tabs)/index.tsx` — état + modale**

Ajouter `import { ProfileDetailModal } from '../../src/features/profile/ProfileDetailModal';` et un state `const [detail, setDetail] = useState<DeckCandidate | null>(null);` (importer `DeckCandidate` déjà présent). Dans `renderCard`, passer `onOpenDetail={() => setDetail(item)}`. Avant le `</View>` racine final (à côté du `MatchModal`), ajouter :
```tsx
      {detail ? (
        <ProfileDetailModal
          data={{
            display_name: detail.display_name, age: detail.age, distance_km: detail.distance_km,
            bio: detail.bio, photos: detail.photos, job: detail.job, education: detail.education,
            height_cm: detail.height_cm, interests: detail.interests, prompts: detail.prompts,
          }}
          onClose={() => setDetail(null)}
        />
      ) : null}
```

- [ ] **Step 3 : Vérifier** `npx tsc --noEmit && npm test -- deck-card` → 0 erreur ; le test deck-card existant passe (le candidat de test n'a pas d'`interests` → il faut que le test fournisse `interests: []` etc. ; **mettre à jour le fixture du test** `deck-card.test.tsx` en ajoutant `interests: [], prompts: [], job: null, education: null, height_cm: null` à l'objet `candidate`, et passer une prop `onOpenDetail={jest.fn()}` au `<DeckCard>`).
- [ ] **Step 4 : Commit**

```bash
git add src/features/deck/DeckCard.tsx app/(tabs)/index.tsx src/features/deck/deck-card.test.tsx
git commit -m "feat(plan-9): puces d'intérêt + accès vue détaillée depuis la carte deck"
```

---

## Task 10 : accès vue détaillée depuis un match

**Files:** Modify: `app/match/[id].tsx`

- [ ] **Step 1 : bouton « Voir le profil » dans l'en-tête du chat**

Ajouter `import { ProfileDetailModal } from '../../src/features/profile/ProfileDetailModal';` et `useState`. Ajouter un state `const [showProfile, setShowProfile] = useState(false);`. Dans le `headerRight` (rangée existante countdown + SafetyMenu), insérer avant `SafetyMenu` un bouton :
```tsx
              <Pressable accessibilityRole="button" accessibilityLabel="Voir le profil" hitSlop={8} onPress={() => setShowProfile(true)}>
                <Text style={{ fontSize: 18 }}>ⓘ</Text>
              </Pressable>
```
Puis, dans le JSX rendu (au niveau du `KeyboardAvoidingView`, à l'intérieur du `<View style={{ flex: 1 }}>` racine), ajouter à la fin :
```tsx
      {showProfile ? (
        <ProfileDetailModal
          data={{
            display_name: match.display_name, age: 0, distance_km: 0, bio: null, photos: match.photos,
            job: match.job, education: match.education, height_cm: match.height_cm,
            interests: match.interests, prompts: match.prompts,
          }}
          onClose={() => setShowProfile(false)}
        />
      ) : null}
```
> Note : `my_matches` ne renvoie pas l'âge/la distance/la bio de l'autre (hors périmètre matchs) → on passe `age: 0`, `distance_km: 0`, `bio: null`. La modale masque déjà les sections vides ; **ajuster `ProfileDetailModal` pour ne pas afficher l'âge si `age === 0` ni la distance si `distance_km === 0`** : remplacer le titre par `data.age ? \`${data.display_name}, ${formatAge(data.age)}\` : data.display_name` et n'afficher la ligne distance que si `data.distance_km > 0`. (Mettre à jour le test de Task 8 reste valide car age=24/distance=3.)

- [ ] **Step 2 : Vérifier** `npx tsc --noEmit && npm test` → 0 erreur ; suite verte.
- [ ] **Step 3 : Commit**

```bash
git add app/match/[id].tsx src/features/profile/ProfileDetailModal.tsx
git commit -m "feat(plan-9): vue détaillée du profil accessible depuis un match"
```

---

# PHASE 2 — Édition

## Task 11 : API d'édition + extension de `fetchMyProfile`

**Files:** Modify: `src/features/profile/profile-api.ts`

- [ ] **Step 1 : RPC + scalaires** — ajouter à `profile-api.ts` :
```ts
export async function setMyInterests(interestIds: string[]) {
  const { error } = await supabase.rpc('set_my_interests', { p_interest_ids: interestIds });
  if (error) throw error;
}
export async function setMyPrompts(items: { promptId: string; answer: string }[]) {
  const { error } = await supabase.rpc('set_my_prompts', {
    p_prompt_ids: items.map((i) => i.promptId),
    p_answers: items.map((i) => i.answer),
  });
  if (error) throw error;
}
export async function updateMyProfileFields(
  userId: string,
  fields: { bio?: string | null; job?: string | null; education?: string | null; height_cm?: number | null },
) {
  const { error } = await supabase.from('profiles').update(fields).eq('id', userId);
  if (error) throw error;
}
```

- [ ] **Step 2 : étendre `MyProfileData` + `fetchMyProfile`** — ajouter au type `profile` les champs `job: string | null; education: string | null; height_cm: number | null` ; ajouter `interestIds: string[]` et `promptItems: { promptId: string; answer: string }[]` au retour. Dans `fetchMyProfile`, ajouter au `select` de `profiles` `, job, education, height_cm` et deux requêtes parallèles :
```ts
    supabase.from('profile_interests').select('interest_id').eq('profile_id', userId),
    supabase.from('profile_prompts').select('prompt_id, answer, position').eq('profile_id', userId).order('position'),
```
puis mapper `interestIds = (pi.data ?? []).map(r => r.interest_id)` et `promptItems = (ppr.data ?? []).map(r => ({ promptId: r.prompt_id, answer: r.answer }))`.

- [ ] **Step 3 : Vérifier** `npx tsc --noEmit` → 0 erreur.
- [ ] **Step 4 : Commit**

```bash
git add src/features/profile/profile-api.ts
git commit -m "feat(plan-9): API édition (interests/prompts/scalaires) + fetchMyProfile enrichi"
```

---

## Task 12 : composants `InterestSelector` + `PromptEditor` (+ tests)

**Files:** Create: `src/features/profile/InterestSelector.tsx` (+ test), `src/features/profile/PromptEditor.tsx` (+ test)

- [ ] **Step 1 : test `InterestSelector`** — `src/features/profile/InterestSelector.test.tsx` :
```tsx
import { fireEvent, render, screen } from '@testing-library/react-native';
import { InterestSelector } from './InterestSelector';

const all = [{ id: 'a', label: 'Sport' }, { id: 'b', label: 'Voyage' }];

it('sélectionne et désélectionne', () => {
  const onChange = jest.fn();
  render(<InterestSelector all={all} selectedIds={[]} onChange={onChange} />);
  fireEvent.press(screen.getByText('Sport'));
  expect(onChange).toHaveBeenCalledWith(['a']);
});

it('respecte le plafond de 5', () => {
  const onChange = jest.fn();
  render(<InterestSelector all={all} selectedIds={['a','b','c','d','e']} onChange={onChange} />);
  fireEvent.press(screen.getByText('Voyage')); // 'b' non sélectionné, plafond atteint
  expect(onChange).not.toHaveBeenCalled();
});
```

- [ ] **Step 2 : lancer** `npm test -- InterestSelector` → FAIL.
- [ ] **Step 3 : implémenter `InterestSelector.tsx`** :
```tsx
import { Pressable, Text, View } from 'react-native';
import { Colors, FontSizes, Radii, Spacing } from '../../lib/theme';
import { MAX_INTERESTS, canAddInterest } from './rich-validation';
import type { Interest } from './catalog-api';

type Props = { all: Interest[]; selectedIds: string[]; onChange: (ids: string[]) => void };

export function InterestSelector({ all, selectedIds, onChange }: Props) {
  function toggle(id: string) {
    if (selectedIds.includes(id)) {
      onChange(selectedIds.filter((x) => x !== id));
    } else if (canAddInterest(selectedIds.length)) {
      onChange([...selectedIds, id]);
    }
  }
  return (
    <View style={{ gap: Spacing.sm }}>
      <Text style={{ color: Colors.textMuted, fontSize: FontSizes.sm }}>{selectedIds.length}/{MAX_INTERESTS}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm }}>
        {all.map((i) => {
          const on = selectedIds.includes(i.id);
          return (
            <Pressable
              key={i.id}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              onPress={() => toggle(i.id)}
              style={{
                borderRadius: Radii.pill, paddingHorizontal: Spacing.md, paddingVertical: 8,
                borderWidth: 1, borderColor: on ? Colors.primary : Colors.border,
                backgroundColor: on ? Colors.primaryBg : Colors.white,
              }}
            >
              <Text style={{ color: on ? Colors.primary : Colors.text }}>{i.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
```

- [ ] **Step 4 : lancer** `npm test -- InterestSelector` → PASS.

- [ ] **Step 5 : test `PromptEditor`** — `src/features/profile/PromptEditor.test.tsx` :
```tsx
import { fireEvent, render, screen } from '@testing-library/react-native';
import { PromptEditor } from './PromptEditor';

const prompts = [{ id: 'p1', question: 'On matche si…' }, { id: 'p2', question: 'Le dimanche idéal…' }];

it('ajoute un prompt et édite la réponse', () => {
  const onChange = jest.fn();
  render(<PromptEditor allPrompts={prompts} value={[]} onChange={onChange} />);
  fireEvent.press(screen.getByText('On matche si…'));
  expect(onChange).toHaveBeenCalledWith([{ promptId: 'p1', answer: '' }]);
});
```

- [ ] **Step 6 : lancer** `npm test -- PromptEditor` → FAIL.
- [ ] **Step 7 : implémenter `PromptEditor.tsx`** :
```tsx
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
```

- [ ] **Step 8 : lancer** `npm test -- PromptEditor` → PASS. Puis `npx tsc --noEmit`.
- [ ] **Step 9 : Commit**

```bash
git add src/features/profile/InterestSelector.tsx src/features/profile/InterestSelector.test.tsx src/features/profile/PromptEditor.tsx src/features/profile/PromptEditor.test.tsx
git commit -m "feat(plan-9): composants InterestSelector + PromptEditor, testés"
```

---

## Task 13 : écran « Éditer le profil »

**Files:** Create: `app/profile-edit.tsx`

> Route hors onglets (comme `app/match/[id].tsx`). Charge le profil, édite scalaires + intérêts + prompts, enregistre.

- [ ] **Step 1 : implémenter `app/profile-edit.tsx`** :
```tsx
import { useEffect, useState } from 'react';
import { Alert, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { useSession } from '../src/features/auth/session-provider';
import { useMyProfile, useInterests, usePrompts } from '../src/features/profile/use-profile-edit';
import {
  setMyInterests, setMyPrompts, updateMyProfileFields,
} from '../src/features/profile/profile-api';
import { InterestSelector } from '../src/features/profile/InterestSelector';
import { PromptEditor, type PromptItem } from '../src/features/profile/PromptEditor';
import { AppButton } from '../src/components/AppButton';
import { ErrorText } from '../src/components/ErrorText';
import { isValidHeight, validatePromptAnswer } from '../src/features/profile/rich-validation';
import { Colors, FontSizes, Radii, Spacing } from '../src/lib/theme';

export default function ProfileEdit() {
  const router = useRouter();
  const qc = useQueryClient();
  const { session } = useSession();
  const userId = session?.user.id;
  const { data: me, isLoading } = useMyProfile(userId);
  const { data: interests = [] } = useInterests();
  const { data: prompts = [] } = usePrompts();

  const [bio, setBio] = useState('');
  const [job, setJob] = useState('');
  const [education, setEducation] = useState('');
  const [height, setHeight] = useState('');
  const [interestIds, setInterestIds] = useState<string[]>([]);
  const [promptItems, setPromptItems] = useState<PromptItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!me) return;
    setBio(me.profile?.bio ?? '');
    setJob(me.profile?.job ?? '');
    setEducation(me.profile?.education ?? '');
    setHeight(me.profile?.height_cm ? String(me.profile.height_cm) : '');
    setInterestIds(me.interestIds);
    setPromptItems(me.promptItems);
  }, [me]);

  if (!userId || isLoading) {
    return <SafeAreaView style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><Text>Chargement…</Text></SafeAreaView>;
  }

  async function onSave() {
    setError(null);
    const h = height.trim() === '' ? null : parseInt(height, 10);
    if (h !== null && (Number.isNaN(h) || !isValidHeight(h))) return setError('Taille invalide (120–230 cm).');
    for (const p of promptItems) {
      const e = validatePromptAnswer(p.answer);
      if (e) return setError(`Prompt : ${e}`);
    }
    setBusy(true);
    try {
      await updateMyProfileFields(userId!, {
        bio: bio.trim() || null, job: job.trim() || null, education: education.trim() || null, height_cm: h,
      });
      await setMyInterests(interestIds);
      await setMyPrompts(promptItems);
      await qc.invalidateQueries({ queryKey: ['my-profile', userId] });
      router.back();
    } catch (e: any) {
      setError(e?.message ?? "Échec de l'enregistrement.");
    } finally {
      setBusy(false);
    }
  }

  const field = { borderWidth: 1, borderColor: Colors.border, borderRadius: Radii.sm, padding: Spacing.md };
  return (
    <SafeAreaView style={{ flex: 1 }}>
      <Stack.Screen options={{ headerShown: true, title: 'Éditer mon profil' }} />
      <ScrollView contentContainerStyle={{ padding: Spacing.xxl, gap: Spacing.lg }}>
        <Text style={{ fontWeight: '700' }}>Bio</Text>
        <TextInput value={bio} onChangeText={setBio} multiline placeholder="Quelques mots sur toi…" style={[field, { minHeight: 80 }]} />
        <Text style={{ fontWeight: '700' }}>Métier</Text>
        <TextInput value={job} onChangeText={setJob} maxLength={50} placeholder="Ex. Designer" style={field} />
        <Text style={{ fontWeight: '700' }}>Études</Text>
        <TextInput value={education} onChangeText={setEducation} maxLength={50} placeholder="Ex. Beaux-Arts" style={field} />
        <Text style={{ fontWeight: '700' }}>Taille (cm)</Text>
        <TextInput value={height} onChangeText={setHeight} keyboardType="number-pad" maxLength={3} placeholder="170" style={field} />
        <Text style={{ fontSize: FontSizes.lg, fontWeight: '800', marginTop: Spacing.sm }}>Centres d'intérêt</Text>
        <InterestSelector all={interests} selectedIds={interestIds} onChange={setInterestIds} />
        <Text style={{ fontSize: FontSizes.lg, fontWeight: '800', marginTop: Spacing.sm }}>Prompts</Text>
        <PromptEditor allPrompts={prompts} value={promptItems} onChange={setPromptItems} />
        <ErrorText message={error} />
        <AppButton title="Enregistrer" onPress={onSave} loading={busy} />
      </ScrollView>
    </SafeAreaView>
  );
}
```

- [ ] **Step 2 : créer le barrel `src/features/profile/use-profile-edit.ts`** (regroupe les hooks utilisés par l'écran) :
```ts
export { useMyProfile } from './use-profile';
export { useInterests, usePrompts } from './use-catalogs';
```

- [ ] **Step 3 : Vérifier** `npx tsc --noEmit && npm test` → 0 erreur ; suite verte.
- [ ] **Step 4 : Commit**

```bash
git add app/profile-edit.tsx src/features/profile/use-profile-edit.ts
git commit -m "feat(plan-9): écran Éditer le profil (bio, métier, études, taille, intérêts, prompts)"
```

---

## Task 14 : bouton « Éditer mon profil » sur l'onglet Profil + affichage des intérêts

**Files:** Modify: `app/(tabs)/profile.tsx`

- [ ] **Step 1 : ajouter le bouton d'édition**

Dans `app/(tabs)/profile.tsx` : importer `useRouter` (`expo-router`) et `AppButton`. Récupérer `const router = useRouter();`. Avant le bouton « Se déconnecter », ajouter :
```tsx
      <AppButton title="Éditer mon profil" onPress={() => router.push('/profile-edit')} />
```
(Le bouton « Se déconnecter » reste en `variant="secondary"`.)

- [ ] **Step 2 : Vérifier** `npx tsc --noEmit && npm test` → 0 erreur ; suite verte.
- [ ] **Step 3 : Commit**

```bash
git add app/(tabs)/profile.tsx
git commit -m "feat(plan-9): accès à l'écran d'édition depuis l'onglet Profil"
```

---

## Task 15 : étape onboarding « centres d'intérêt » (optionnelle)

**Files:** Create: `app/(onboarding)/interests.tsx`; Modify: `app/(onboarding)/photos.tsx`

> On insère l'étape **entre photos et préférences** (skippable). Photos → Intérêts → Préférences.

- [ ] **Step 1 : créer `app/(onboarding)/interests.tsx`** :
```tsx
import { useState } from 'react';
import { Alert, ScrollView, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useInterests } from '../../src/features/profile/use-catalogs';
import { setMyInterests } from '../../src/features/profile/profile-api';
import { InterestSelector } from '../../src/features/profile/InterestSelector';
import { AppButton } from '../../src/components/AppButton';
import { Spacing, FontSizes } from '../../src/lib/theme';

export default function InterestsStep() {
  const router = useRouter();
  const { data: interests = [] } = useInterests();
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  async function onNext(save: boolean) {
    if (save && selected.length > 0) {
      setBusy(true);
      try {
        await setMyInterests(selected);
      } catch (e: any) {
        Alert.alert('Centres d\'intérêt', e?.message ?? 'Réessaie.');
        setBusy(false);
        return;
      }
      setBusy(false);
    }
    router.push('/(onboarding)/preferences');
  }

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ padding: Spacing.xxl, gap: Spacing.lg }}>
        <Text style={{ fontSize: FontSizes.xl, fontWeight: '700' }}>Tes centres d'intérêt</Text>
        <Text style={{ color: '#777' }}>Optionnel — tu pourras les modifier plus tard.</Text>
        <InterestSelector all={interests} selectedIds={selected} onChange={setSelected} />
        <AppButton title="Continuer" onPress={() => onNext(true)} loading={busy} />
        <AppButton title="Passer" onPress={() => onNext(false)} variant="secondary" />
      </ScrollView>
    </SafeAreaView>
  );
}
```

- [ ] **Step 2 : rediriger `photos.tsx` vers l'étape intérêts**

Dans `app/(onboarding)/photos.tsx`, le bouton Continuer pousse actuellement vers `/(onboarding)/preferences`. Le remplacer par `/(onboarding)/interests` :
```tsx
        <AppButton title="Continuer" onPress={() => router.push('/(onboarding)/interests')} disabled={count < 1 || busy} />
```

- [ ] **Step 3 : Vérifier** `npx tsc --noEmit && npm test` → 0 erreur ; suite verte.
- [ ] **Step 4 : Commit**

```bash
git add app/(onboarding)/interests.tsx app/(onboarding)/photos.tsx
git commit -m "feat(plan-9): étape onboarding optionnelle des centres d'intérêt"
```

---

## Déploiement (dev, après implémentation)
1. SQL Editor : appliquer `20260616180000_plan9_profils_riches.sql`.
2. `supabase functions deploy get-deck` et `get-matches`.
3. `npm run db:types` + `npx tsc --noEmit` (cast localisé si re-typage gênant).
4. Pas de rebuild (aucun module natif).
5. Test device : éditer son profil (intérêts/prompts/métier…), vérifier l'affichage sur la carte deck (puces) + vue détaillée (deck et match), et l'étape onboarding skippable.

---

## Self-Review
- **Couverture spec :** catalogues + seeds (T1) ; tables liaison + colonnes + RLS (T1) ; RPC écriture (T2) ; diffusion deck/matches (T3) ; types (T4/T6) ; Edge Functions (T5) ; validation (T7) ; vue détaillée (T8, +T10 ajustement match) ; carte deck puces + accès (T9) ; accès depuis match (T10) ; API édition (T11) ; sélecteurs (T12) ; écran d'édition (T13) ; entrée depuis Profil (T14) ; onboarding optionnel (T15). Sécurité (RLS own-row, catalogues lecture auth, definer, validations base+client) couverte par T1-T3 + T7. Hors-périmètre (filtrage par intérêt, modération, langues) non implémenté — conforme.
- **Placeholders :** aucun ; code complet (SQL, composants, écran) ou recette de champ exacte pour les types/Edge Functions.
- **Cohérence des types :** `RichProfileFields` (T6) partagé par `DeckCandidate`/`Match` et consommé par `ProfileDetailModal` (`ProfileDetailData` aligné : mêmes clés) ; `PromptItem {promptId, answer}` cohérent entre `PromptEditor` (T12), `setMyPrompts` (T11), `fetchMyProfile.promptItems` (T11), écran d'édition (T13) ; `Interest`/`Prompt` (T6) consommés par `InterestSelector`/`PromptEditor` ; helpers `canAddInterest`/`validatePromptAnswer`/`isValidHeight` (T7) utilisés en T12/T13. `deck-card.test.tsx` fixture mis à jour (T9) pour les nouveaux champs requis.
- **Tests à surveiller :** `deck-card.test.tsx` (ajouter champs riches au fixture + prop `onOpenDetail`) ; `ProfileDetailModal` test garde age=24/distance=3 donc l'ajustement age===0 ne casse rien.
