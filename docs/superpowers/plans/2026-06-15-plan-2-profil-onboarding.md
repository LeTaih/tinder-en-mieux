# Plan 2 — Profil & Onboarding — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construire le parcours d'onboarding bloquant qui crée un profil complet (identité, genre, photos, préférences, position) avant de laisser accéder aux onglets, avec une sécurité forte (RLS stricte, stockage privé).

**Architecture:** Données serveur via TanStack Query + SDK Supabase. Schéma SQL (tables + RLS + Storage + RPC) dans des migrations appliquées au projet cloud. Logique pure (complétude, validation, params image) testée en TDD ; écrans d'onboarding en composants React Native sous un groupe de routes `(onboarding)` gardé par le layout racine selon la complétude du profil.

**Tech Stack:** Expo SDK 56, Expo Router, TypeScript, `@tanstack/react-query`, `@supabase/supabase-js`, `expo-image-picker`, `expo-image-manipulator`, `expo-location`, Supabase (Postgres + PostGIS + Storage), Jest + RNTL.

**Spec de référence :** `docs/superpowers/specs/2026-06-15-plan-2-profil-onboarding-design.md`.

**Contrainte d'environnement :** Docker indisponible en session → les migrations SQL sont écrites mais **appliquées au projet cloud par le développeur** (Task 17). En session, les garde-fous sont `npm test` (logique pure) et `npx tsc --noEmit`. Le `database.ts` est écrit à la main (Task 4) puis régénéré depuis le cloud (Task 17).

---

## Structure de fichiers (cible)

```
supabase/migrations/
  20260615120000_plan2_profiles.sql      # tables, RLS, contraintes, seed genres, RPC, Storage
src/types/database.ts                     # types réécrits à la main (mirroir du schéma), régénérés plus tard
src/lib/query-client.ts                   # QueryClient TanStack
src/features/profile/
  completeness.ts                         # isProfileComplete (pur)
  completeness.test.ts
  validation.ts                           # validations âge/préférences (pur)
  validation.test.ts
  image.ts                                # params recadrage/compression (pur)
  image.test.ts
  profile-api.ts                          # délégations Supabase (CRUD profil/photos/prefs/location)
  use-profile.ts                          # hooks useGenders / useMyProfile / useProfileCompleteness
  signed-url.ts                           # helper URL signée Storage
app/(onboarding)/
  _layout.tsx                             # pile d'étapes
  identity.tsx                            # étape 1
  gender.tsx                              # étape 2
  photos.tsx                              # étape 3
  preferences.tsx                         # étape 4
  location.tsx                            # étape 5 (termine l'onboarding)
app/_layout.tsx                           # MODIFIÉ : QueryClientProvider + garde de complétude
app/(tabs)/profile.tsx                    # MODIFIÉ : résumé lecture seule
app.json                                  # MODIFIÉ : plugins image-picker/location + chaînes iOS
```

---

## Task 1: Installer et câbler TanStack Query

**Files:**
- Create: `src/lib/query-client.ts`
- Modify: `app/_layout.tsx`, `package.json`

- [ ] **Step 1: Installer**

Run : `npx expo install @tanstack/react-query` (ajoute `--legacy-peer-deps` si conflit, comme le reste du projet).
Expected : installation sans erreur.

- [ ] **Step 2: Créer le QueryClient**

Create `src/lib/query-client.ts` :
```ts
import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1 },
  },
});
```

- [ ] **Step 3: Envelopper l'app**

Modify `app/_layout.tsx` — remplace le composant `RootLayout` par (garde `RootNavigator` tel quel pour l'instant ; il sera modifié en Task 10) :
```tsx
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '../src/lib/query-client';
// ... imports existants (Stack, ActivityIndicator, View, SessionProvider, useSession) inchangés

export default function RootLayout() {
  return (
    <QueryClientProvider client={queryClient}>
      <SessionProvider>
        <RootNavigator />
      </SessionProvider>
    </QueryClientProvider>
  );
}
```

- [ ] **Step 4: Vérifier**

Run : `npx tsc --noEmit && npm test 2>&1 | tail -3`
Expected : 0 erreur TS ; tests toujours verts (10).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "chore: câblage TanStack Query"
```

---

## Task 2: Migration SQL — schéma, RLS, Storage, RPC

Écrit la migration. **Non appliquée en session** (Docker indispo) ; appliquée au cloud en Task 17. Pas de test runtime ici : la vérif est la relecture + l'application cloud.

**Files:**
- Create: `supabase/migrations/20260615120000_plan2_profiles.sql`

- [ ] **Step 1: Écrire la migration**

Create `supabase/migrations/20260615120000_plan2_profiles.sql` :
```sql
-- PostGIS pour la géolocalisation
create extension if not exists postgis with schema extensions;

-- ============ Table de référence des genres (configurable) ============
create table public.genders (
  id uuid primary key default gen_random_uuid(),
  key text unique not null,
  label text not null,
  is_active boolean not null default true,
  sort_order int not null default 0
);
alter table public.genders enable row level security;
create policy "genders: lecture authentifiée" on public.genders
  for select to authenticated using (true);
-- aucune policy d'écriture => réservé au rôle service (bypass RLS)

insert into public.genders (key, label, sort_order) values
  ('homme', 'Homme', 1),
  ('femme', 'Femme', 2);

-- ============ Profils ============
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  birthdate date,
  gender_id uuid references public.genders(id),
  bio text,
  location extensions.geography(Point, 4326),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint birthdate_18plus
    check (birthdate is null or birthdate <= (current_date - interval '18 years'))
);
alter table public.profiles enable row level security;
create policy "profiles: select own" on public.profiles
  for select to authenticated using (auth.uid() = id);
create policy "profiles: insert own" on public.profiles
  for insert to authenticated with check (auth.uid() = id);
create policy "profiles: update own" on public.profiles
  for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);
create policy "profiles: delete own" on public.profiles
  for delete to authenticated using (auth.uid() = id);

-- ============ Photos ============
create table public.profile_photos (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  storage_path text not null,
  position int not null check (position between 0 and 5),
  created_at timestamptz not null default now(),
  unique (profile_id, position)
);
alter table public.profile_photos enable row level security;
create policy "photos: select own" on public.profile_photos
  for select to authenticated using (auth.uid() = profile_id);
create policy "photos: insert own" on public.profile_photos
  for insert to authenticated with check (auth.uid() = profile_id);
create policy "photos: update own" on public.profile_photos
  for update to authenticated using (auth.uid() = profile_id) with check (auth.uid() = profile_id);
create policy "photos: delete own" on public.profile_photos
  for delete to authenticated using (auth.uid() = profile_id);

-- garde-fou : max 6 photos par profil
create function public.enforce_max_photos() returns trigger
language plpgsql as $$
begin
  if (select count(*) from public.profile_photos where profile_id = new.profile_id) >= 6 then
    raise exception 'Maximum 6 photos par profil';
  end if;
  return new;
end;
$$;
create trigger trg_enforce_max_photos
  before insert on public.profile_photos
  for each row execute function public.enforce_max_photos();

-- ============ Préférences ============
create table public.preferences (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  age_min int not null check (age_min >= 18),
  age_max int not null,
  max_distance_km int not null check (max_distance_km > 0),
  constraint age_range check (age_max >= age_min)
);
alter table public.preferences enable row level security;
create policy "prefs: select own" on public.preferences
  for select to authenticated using (auth.uid() = profile_id);
create policy "prefs: insert own" on public.preferences
  for insert to authenticated with check (auth.uid() = profile_id);
create policy "prefs: update own" on public.preferences
  for update to authenticated using (auth.uid() = profile_id) with check (auth.uid() = profile_id);

create table public.preference_genders (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  gender_id uuid not null references public.genders(id),
  primary key (profile_id, gender_id)
);
alter table public.preference_genders enable row level security;
create policy "pref_genders: select own" on public.preference_genders
  for select to authenticated using (auth.uid() = profile_id);
create policy "pref_genders: insert own" on public.preference_genders
  for insert to authenticated with check (auth.uid() = profile_id);
create policy "pref_genders: delete own" on public.preference_genders
  for delete to authenticated using (auth.uid() = profile_id);

-- ============ RPC: enregistrer sa position (évite d'envoyer du WKT depuis le client) ============
create function public.set_my_location(lng double precision, lat double precision)
returns void
language sql security definer set search_path = public, extensions as $$
  update public.profiles
  set location = extensions.st_setsrid(extensions.st_makepoint(lng, lat), 4326)::extensions.geography,
      updated_at = now()
  where id = auth.uid();
$$;

-- ============ Storage : bucket privé + policies scopées par dossier utilisateur ============
insert into storage.buckets (id, name, public)
values ('profile-photos', 'profile-photos', false)
on conflict (id) do nothing;

create policy "photos storage: select own folder" on storage.objects
  for select to authenticated
  using (bucket_id = 'profile-photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "photos storage: insert own folder" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'profile-photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "photos storage: delete own folder" on storage.objects
  for delete to authenticated
  using (bucket_id = 'profile-photos' and (storage.foldername(name))[1] = auth.uid()::text);
```

- [ ] **Step 2: Relecture de cohérence**

Vérifie visuellement : RLS activée sur les 5 tables, aucune policy de lecture globale sur `profiles`, CHECK 18+ présent, RPC `set_my_location` en `security definer`, bucket privé. (Application réelle en Task 17.)

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat(db): migration profil/onboarding (tables, RLS, Storage, RPC)"
```

---

## Task 3: Types de domaine + réécriture de `database.ts`

`database.ts` (stub vide) est remplacé par un type reflétant le schéma de la Task 2, pour que `tsc` valide les accès Supabase. Sera écrasé par `npm run db:types` en Task 17.

**Files:**
- Modify: `src/types/database.ts`

- [ ] **Step 1: Réécrire les types**

Replace `src/types/database.ts` par :
```ts
// MIROIR MANUEL du schéma (migration 20260615120000). Source de vérité = `npm run db:types`
// (à régénérer depuis le cloud une fois la migration appliquée — voir Task 17).
type Timestamptz = string;

export type Database = {
  public: {
    Tables: {
      genders: {
        Row: { id: string; key: string; label: string; is_active: boolean; sort_order: number };
        Insert: { id?: string; key: string; label: string; is_active?: boolean; sort_order?: number };
        Update: { id?: string; key?: string; label?: string; is_active?: boolean; sort_order?: number };
        Relationships: [];
      };
      profiles: {
        Row: {
          id: string; display_name: string | null; birthdate: string | null;
          gender_id: string | null; bio: string | null; location: string | null;
          created_at: Timestamptz; updated_at: Timestamptz;
        };
        Insert: {
          id: string; display_name?: string | null; birthdate?: string | null;
          gender_id?: string | null; bio?: string | null; location?: string | null;
          created_at?: Timestamptz; updated_at?: Timestamptz;
        };
        Update: {
          id?: string; display_name?: string | null; birthdate?: string | null;
          gender_id?: string | null; bio?: string | null; location?: string | null;
          created_at?: Timestamptz; updated_at?: Timestamptz;
        };
        Relationships: [];
      };
      profile_photos: {
        Row: { id: string; profile_id: string; storage_path: string; position: number; created_at: Timestamptz };
        Insert: { id?: string; profile_id: string; storage_path: string; position: number; created_at?: Timestamptz };
        Update: { id?: string; profile_id?: string; storage_path?: string; position?: number; created_at?: Timestamptz };
        Relationships: [];
      };
      preferences: {
        Row: { profile_id: string; age_min: number; age_max: number; max_distance_km: number };
        Insert: { profile_id: string; age_min: number; age_max: number; max_distance_km: number };
        Update: { profile_id?: string; age_min?: number; age_max?: number; max_distance_km?: number };
        Relationships: [];
      };
      preference_genders: {
        Row: { profile_id: string; gender_id: string };
        Insert: { profile_id: string; gender_id: string };
        Update: { profile_id?: string; gender_id?: string };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      set_my_location: {
        Args: { lng: number; lat: number };
        Returns: undefined;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
```

- [ ] **Step 2: Vérifier**

Run : `npx tsc --noEmit`
Expected : 0 erreur.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "chore(types): database.ts reflète le schéma Plan 2 (régénéré depuis cloud plus tard)"
```

---

## Task 4: `completeness.ts` (pur, TDD)

**Files:**
- Create: `src/features/profile/completeness.ts`, `src/features/profile/completeness.test.ts`

- [ ] **Step 1: Test (échec)**

Create `src/features/profile/completeness.test.ts` :
```ts
import { isProfileComplete } from './completeness';

const base = {
  profile: { display_name: 'Léa', birthdate: '2000-01-01', gender_id: 'g1', location: '0101...' as string | null },
  photosCount: 1,
  preferences: { age_min: 18, age_max: 40, max_distance_km: 50 } as null | { age_min: number; age_max: number; max_distance_km: number },
  seekingGenderCount: 1,
};

test('profil complet => true', () => {
  expect(isProfileComplete(base)).toBe(true);
});

test('sans photo => false', () => {
  expect(isProfileComplete({ ...base, photosCount: 0 })).toBe(false);
});

test('sans position => false', () => {
  expect(isProfileComplete({ ...base, profile: { ...base.profile, location: null } })).toBe(false);
});

test('sans préférences ou sans genre recherché => false', () => {
  expect(isProfileComplete({ ...base, preferences: null })).toBe(false);
  expect(isProfileComplete({ ...base, seekingGenderCount: 0 })).toBe(false);
});

test('champs identité manquants => false', () => {
  expect(isProfileComplete({ ...base, profile: { ...base.profile, display_name: '' } })).toBe(false);
  expect(isProfileComplete({ ...base, profile: { ...base.profile, birthdate: null } })).toBe(false);
  expect(isProfileComplete({ ...base, profile: { ...base.profile, gender_id: null } })).toBe(false);
});
```

- [ ] **Step 2: Lancer (échec)**

Run : `npm test -- completeness`
Expected : FAIL — module introuvable.

- [ ] **Step 3: Implémenter**

Create `src/features/profile/completeness.ts` :
```ts
export type CompletenessInput = {
  profile: {
    display_name: string | null;
    birthdate: string | null;
    gender_id: string | null;
    location: string | null;
  } | null;
  photosCount: number;
  preferences: { age_min: number; age_max: number; max_distance_km: number } | null;
  seekingGenderCount: number;
};

export function isProfileComplete(input: CompletenessInput): boolean {
  const p = input.profile;
  if (!p) return false;
  if (!p.display_name || p.display_name.trim().length === 0) return false;
  if (!p.birthdate) return false;
  if (!p.gender_id) return false;
  if (!p.location) return false;
  if (input.photosCount < 1) return false;
  if (!input.preferences) return false;
  if (input.seekingGenderCount < 1) return false;
  return true;
}
```

- [ ] **Step 4: Lancer (succès)**

Run : `npm test -- completeness`
Expected : PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(profile): calcul de complétude du profil"
```

---

## Task 5: `validation.ts` (pur, TDD)

**Files:**
- Create: `src/features/profile/validation.ts`, `src/features/profile/validation.test.ts`

- [ ] **Step 1: Test (échec)**

Create `src/features/profile/validation.test.ts` :
```ts
import { ageFromBirthdate, isAdult, validatePreferences } from './validation';

test('ageFromBirthdate calcule l\'âge à une date donnée', () => {
  expect(ageFromBirthdate('2000-06-15', new Date('2026-06-15'))).toBe(26);
  expect(ageFromBirthdate('2000-06-16', new Date('2026-06-15'))).toBe(25);
});

test('isAdult', () => {
  expect(isAdult('2008-06-16', new Date('2026-06-15'))).toBe(false);
  expect(isAdult('2008-06-15', new Date('2026-06-15'))).toBe(true);
});

test('validatePreferences', () => {
  expect(validatePreferences({ age_min: 18, age_max: 40, max_distance_km: 50, seekingGenderCount: 1 })).toEqual({});
  expect(validatePreferences({ age_min: 17, age_max: 40, max_distance_km: 50, seekingGenderCount: 1 }).age_min).toBeTruthy();
  expect(validatePreferences({ age_min: 30, age_max: 20, max_distance_km: 50, seekingGenderCount: 1 }).age_max).toBeTruthy();
  expect(validatePreferences({ age_min: 18, age_max: 40, max_distance_km: 0, seekingGenderCount: 1 }).max_distance_km).toBeTruthy();
  expect(validatePreferences({ age_min: 18, age_max: 40, max_distance_km: 50, seekingGenderCount: 0 }).seekingGenders).toBeTruthy();
});
```

- [ ] **Step 2: Lancer (échec)**

Run : `npm test -- "features/profile/validation"`
Expected : FAIL — module introuvable.

- [ ] **Step 3: Implémenter**

Create `src/features/profile/validation.ts` :
```ts
export function ageFromBirthdate(birthdate: string, now: Date): number {
  const b = new Date(birthdate);
  let age = now.getFullYear() - b.getFullYear();
  const m = now.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < b.getDate())) age--;
  return age;
}

export function isAdult(birthdate: string, now: Date): boolean {
  return ageFromBirthdate(birthdate, now) >= 18;
}

export type PreferencesInput = {
  age_min: number;
  age_max: number;
  max_distance_km: number;
  seekingGenderCount: number;
};
export type PreferencesErrors = {
  age_min?: string;
  age_max?: string;
  max_distance_km?: string;
  seekingGenders?: string;
};

export function validatePreferences(input: PreferencesInput): PreferencesErrors {
  const e: PreferencesErrors = {};
  if (input.age_min < 18) e.age_min = "L'âge minimum doit être au moins 18 ans.";
  if (input.age_max < input.age_min) e.age_max = "L'âge maximum doit être supérieur ou égal au minimum.";
  if (input.max_distance_km <= 0) e.max_distance_km = 'La distance doit être supérieure à 0.';
  if (input.seekingGenderCount < 1) e.seekingGenders = 'Choisis au moins un genre recherché.';
  return e;
}
```

- [ ] **Step 4: Lancer (succès)**

Run : `npm test -- "features/profile/validation"`
Expected : PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(profile): validations âge (18+) et préférences"
```

---

## Task 6: `image.ts` — params de compression (pur, TDD)

**Files:**
- Create: `src/features/profile/image.ts`, `src/features/profile/image.test.ts`

- [ ] **Step 1: Test (échec)**

Create `src/features/profile/image.test.ts` :
```ts
import { PHOTO_MAX_DIMENSION, PHOTO_COMPRESS, photoStoragePath } from './image';

test('constantes de compression raisonnables', () => {
  expect(PHOTO_MAX_DIMENSION).toBe(1080);
  expect(PHOTO_COMPRESS).toBeGreaterThan(0);
  expect(PHOTO_COMPRESS).toBeLessThanOrEqual(1);
});

test('photoStoragePath préfixe par userId et finit en .jpg', () => {
  const path = photoStoragePath('user-123', 'abc');
  expect(path).toBe('user-123/abc.jpg');
});
```

- [ ] **Step 2: Lancer (échec)**

Run : `npm test -- "features/profile/image"`
Expected : FAIL — module introuvable.

- [ ] **Step 3: Implémenter**

Create `src/features/profile/image.ts` :
```ts
export const PHOTO_MAX_DIMENSION = 1080;
export const PHOTO_COMPRESS = 0.7;

export function photoStoragePath(userId: string, id: string): string {
  return `${userId}/${id}.jpg`;
}
```

- [ ] **Step 4: Lancer (succès)**

Run : `npm test -- "features/profile/image"`
Expected : PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(profile): params de compression et chemin de stockage photo"
```

---

## Task 7: Helper d'URL signée

**Files:**
- Create: `src/features/profile/signed-url.ts`

- [ ] **Step 1: Implémenter (délégation Storage, vérifiée par tsc)**

Create `src/features/profile/signed-url.ts` :
```ts
import { supabase } from '../../lib/supabase';

const SIGNED_URL_TTL_SECONDS = 60;

export async function signedPhotoUrl(storagePath: string): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from('profile-photos')
    .createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS);
  if (error) return null;
  return data.signedUrl;
}
```

- [ ] **Step 2: Vérifier**

Run : `npx tsc --noEmit`
Expected : 0 erreur.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat(profile): helper URL signée (TTL court)"
```

---

## Task 8: `profile-api.ts` — délégations Supabase

**Files:**
- Create: `src/features/profile/profile-api.ts`

- [ ] **Step 1: Implémenter**

Create `src/features/profile/profile-api.ts` :
```ts
import { supabase } from '../../lib/supabase';

export type GenderRow = { id: string; key: string; label: string };

export async function fetchActiveGenders(): Promise<GenderRow[]> {
  const { data, error } = await supabase
    .from('genders')
    .select('id, key, label')
    .eq('is_active', true)
    .order('sort_order');
  if (error) throw error;
  return data ?? [];
}

export async function upsertIdentity(
  userId: string,
  fields: { display_name: string; birthdate: string; gender_id: string; bio?: string | null },
) {
  const { error } = await supabase.from('profiles').upsert({ id: userId, ...fields });
  if (error) throw error;
}

export async function insertPhoto(userId: string, storagePath: string, position: number) {
  const { error } = await supabase
    .from('profile_photos')
    .insert({ profile_id: userId, storage_path: storagePath, position });
  if (error) throw error;
}

export async function deletePhoto(userId: string, photoId: string, storagePath: string) {
  await supabase.storage.from('profile-photos').remove([storagePath]);
  const { error } = await supabase.from('profile_photos').delete().eq('id', photoId).eq('profile_id', userId);
  if (error) throw error;
}

export async function upsertPreferences(
  userId: string,
  prefs: { age_min: number; age_max: number; max_distance_km: number },
  seekingGenderIds: string[],
) {
  const { error: e1 } = await supabase.from('preferences').upsert({ profile_id: userId, ...prefs });
  if (e1) throw e1;
  const { error: e2 } = await supabase.from('preference_genders').delete().eq('profile_id', userId);
  if (e2) throw e2;
  if (seekingGenderIds.length > 0) {
    const rows = seekingGenderIds.map((gid) => ({ profile_id: userId, gender_id: gid }));
    const { error: e3 } = await supabase.from('preference_genders').insert(rows);
    if (e3) throw e3;
  }
}

export async function setMyLocation(lng: number, lat: number) {
  const { error } = await supabase.rpc('set_my_location', { lng, lat });
  if (error) throw error;
}

export type MyProfileData = {
  profile: {
    display_name: string | null;
    birthdate: string | null;
    gender_id: string | null;
    bio: string | null;
    location: string | null;
  } | null;
  photos: { id: string; storage_path: string; position: number }[];
  preferences: { age_min: number; age_max: number; max_distance_km: number } | null;
  seekingGenderIds: string[];
};

export async function fetchMyProfile(userId: string): Promise<MyProfileData> {
  const [p, ph, pref, pg] = await Promise.all([
    supabase.from('profiles').select('display_name, birthdate, gender_id, bio, location').eq('id', userId).maybeSingle(),
    supabase.from('profile_photos').select('id, storage_path, position').eq('profile_id', userId).order('position'),
    supabase.from('preferences').select('age_min, age_max, max_distance_km').eq('profile_id', userId).maybeSingle(),
    supabase.from('preference_genders').select('gender_id').eq('profile_id', userId),
  ]);
  if (p.error) throw p.error;
  if (ph.error) throw ph.error;
  if (pref.error) throw pref.error;
  if (pg.error) throw pg.error;
  return {
    profile: p.data ?? null,
    photos: ph.data ?? [],
    preferences: pref.data ?? null,
    seekingGenderIds: (pg.data ?? []).map((r) => r.gender_id),
  };
}
```

- [ ] **Step 2: Vérifier**

Run : `npx tsc --noEmit`
Expected : 0 erreur.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat(profile): API de profil (CRUD via Supabase)"
```

---

## Task 9: Hooks `use-profile.ts`

**Files:**
- Create: `src/features/profile/use-profile.ts`

- [ ] **Step 1: Implémenter**

Create `src/features/profile/use-profile.ts` :
```ts
import { useQuery } from '@tanstack/react-query';
import { fetchActiveGenders, fetchMyProfile, type MyProfileData } from './profile-api';
import { isProfileComplete } from './completeness';

export function useGenders() {
  return useQuery({ queryKey: ['genders'], queryFn: fetchActiveGenders });
}

export function useMyProfile(userId: string | undefined) {
  return useQuery<MyProfileData>({
    queryKey: ['my-profile', userId],
    queryFn: () => fetchMyProfile(userId as string),
    enabled: !!userId,
  });
}

export function useProfileCompleteness(userId: string | undefined) {
  const query = useMyProfile(userId);
  const complete = query.data
    ? isProfileComplete({
        profile: query.data.profile,
        photosCount: query.data.photos.length,
        preferences: query.data.preferences,
        seekingGenderCount: query.data.seekingGenderIds.length,
      })
    : undefined;
  return { complete, isLoading: query.isLoading, isError: query.isError };
}
```

- [ ] **Step 2: Vérifier**

Run : `npx tsc --noEmit`
Expected : 0 erreur.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat(profile): hooks useGenders/useMyProfile/useProfileCompleteness"
```

---

## Task 10: Garde de complétude dans le layout racine

**Files:**
- Modify: `app/_layout.tsx`

- [ ] **Step 1: Modifier `RootNavigator`**

Modify `app/_layout.tsx` — remplace la fonction `RootNavigator` par (laisse `RootLayout` de la Task 1 inchangé) :
```tsx
import { Stack } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';
import { useSession } from '../src/features/auth/session-provider';
import { useProfileCompleteness } from '../src/features/profile/use-profile';

function RootNavigator() {
  const { session, loading } = useSession();
  const userId = session?.user.id;
  const { complete, isLoading: profileLoading } = useProfileCompleteness(userId);

  if (loading || (!!session && profileLoading)) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={!!session && complete === true}>
        <Stack.Screen name="(tabs)" />
      </Stack.Protected>
      <Stack.Protected guard={!!session && complete === false}>
        <Stack.Screen name="(onboarding)" />
      </Stack.Protected>
      <Stack.Protected guard={!session}>
        <Stack.Screen name="(auth)" />
      </Stack.Protected>
    </Stack>
  );
}
```
(Garde les imports `QueryClientProvider`, `queryClient`, `SessionProvider` du `RootLayout` ajoutés en Task 1.)

- [ ] **Step 2: Vérifier**

Run : `npx tsc --noEmit && npm test 2>&1 | tail -3`
Expected : 0 erreur ; tests verts.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat(onboarding): garde de routage selon complétude du profil"
```

---

## Task 11: Layout d'onboarding + étape Identité

**Files:**
- Create: `app/(onboarding)/_layout.tsx`, `app/(onboarding)/identity.tsx`

- [ ] **Step 1: Layout**

Create `app/(onboarding)/_layout.tsx` :
```tsx
import { Stack } from 'expo-router';

export default function OnboardingLayout() {
  return <Stack screenOptions={{ headerShown: true, title: 'Ton profil' }} initialRouteName="identity" />;
}
```

- [ ] **Step 2: Écran Identité**

Create `app/(onboarding)/identity.tsx` :
```tsx
import { useState } from 'react';
import { Button, Platform, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSession } from '../../src/features/auth/session-provider';
import { isAdult } from '../../src/features/profile/validation';

export default function Identity() {
  const router = useRouter();
  const { session } = useSession();
  const [name, setName] = useState('');
  const [birthdate, setBirthdate] = useState(''); // format AAAA-MM-JJ
  const [bio, setBio] = useState('');
  const [error, setError] = useState<string | null>(null);

  function onNext() {
    setError(null);
    if (name.trim().length === 0) return setError('Indique ton prénom.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(birthdate)) return setError('Date au format AAAA-MM-JJ.');
    if (!isAdult(birthdate, new Date())) return setError('Tu dois avoir au moins 18 ans.');
    // gender_id étant requis par la table, l'upsert complet de l'identité est réalisé
    // à l'étape Genre (Task 12). Ici on ne fait que transmettre les champs saisis.
    router.push({ pathname: '/(onboarding)/gender', params: { name: name.trim(), birthdate, bio } });
  }

  if (!session) return null;

  return (
    <View style={{ flex: 1, padding: 24, gap: 12 }}>
      <Text style={{ fontSize: 20, fontWeight: '700' }}>Qui es-tu ?</Text>
      <TextInput placeholder="Prénom" value={name} onChangeText={setName}
        style={{ borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 12 }} />
      <TextInput placeholder="Date de naissance (AAAA-MM-JJ)" value={birthdate} onChangeText={setBirthdate}
        autoCapitalize="none" keyboardType={Platform.OS === 'ios' ? 'numbers-and-punctuation' : 'default'}
        style={{ borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 12 }} />
      <TextInput placeholder="Bio (optionnel)" value={bio} onChangeText={setBio} multiline
        style={{ borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 12, minHeight: 80 }} />
      {error ? <Text style={{ color: 'red' }}>{error}</Text> : null}
      <Button title="Continuer" onPress={onNext} />
    </View>
  );
}
```

> Note : l'identité est transmise en paramètres à l'étape Genre, qui réalise l'`upsertIdentity` complet (la colonne `gender_id` est nécessaire). Cela évite une écriture en deux temps incohérente.

- [ ] **Step 3: Vérifier**

Run : `npx tsc --noEmit`
Expected : 0 erreur.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat(onboarding): layout + étape identité"
```

---

## Task 12: Étape Genre

**Files:**
- Create: `app/(onboarding)/gender.tsx`

- [ ] **Step 1: Écran Genre**

Create `app/(onboarding)/gender.tsx` :
```tsx
import { useState } from 'react';
import { Alert, Button, Pressable, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSession } from '../../src/features/auth/session-provider';
import { useGenders } from '../../src/features/profile/use-profile';
import { upsertIdentity } from '../../src/features/profile/profile-api';
import { authErrorMessage } from '../../src/features/auth/errors';

export default function Gender() {
  const router = useRouter();
  const { session } = useSession();
  const params = useLocalSearchParams<{ name: string; birthdate: string; bio: string }>();
  const { data: genders, isLoading } = useGenders();
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onNext() {
    if (!selected || !session) return;
    setBusy(true);
    try {
      await upsertIdentity(session.user.id, {
        display_name: String(params.name),
        birthdate: String(params.birthdate),
        gender_id: selected,
        bio: params.bio ? String(params.bio) : null,
      });
      router.push('/(onboarding)/photos');
    } catch (e: any) {
      Alert.alert('Genre', authErrorMessage(e?.message));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={{ flex: 1, padding: 24, gap: 12 }}>
      <Text style={{ fontSize: 20, fontWeight: '700' }}>Ton genre</Text>
      {isLoading ? <Text>Chargement…</Text> : null}
      {(genders ?? []).map((g) => (
        <Pressable key={g.id} onPress={() => setSelected(g.id)}
          style={{ padding: 14, borderRadius: 8, borderWidth: 1, borderColor: selected === g.id ? '#208AEF' : '#ccc', backgroundColor: selected === g.id ? '#E6F0FF' : 'white' }}>
          <Text>{g.label}</Text>
        </Pressable>
      ))}
      <Button title={busy ? '...' : 'Continuer'} onPress={onNext} disabled={busy || !selected} />
    </View>
  );
}
```

- [ ] **Step 2: Vérifier**

Run : `npx tsc --noEmit`
Expected : 0 erreur.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat(onboarding): étape genre"
```

---

## Task 13: Étape Photos (picker + compression + upload)

**Files:**
- Create: `app/(onboarding)/photos.tsx`
- Modify: `package.json`

- [ ] **Step 1: Installer**

Run : `npx expo install expo-image-picker expo-image-manipulator` (`--legacy-peer-deps` si besoin).
Expected : installation OK.

- [ ] **Step 2: Écran Photos**

Create `app/(onboarding)/photos.tsx` :
```tsx
import { useState } from 'react';
import { Alert, Button, Image, Pressable, ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { randomUUID } from 'expo-crypto';
import { useSession } from '../../src/features/auth/session-provider';
import { supabase } from '../../src/lib/supabase';
import { insertPhoto } from '../../src/features/profile/profile-api';
import { PHOTO_COMPRESS, PHOTO_MAX_DIMENSION, photoStoragePath } from '../../src/features/profile/image';
import { authErrorMessage } from '../../src/features/auth/errors';

type LocalPhoto = { uri: string; storagePath: string };

export default function Photos() {
  const router = useRouter();
  const { session } = useSession();
  const [photos, setPhotos] = useState<LocalPhoto[]>([]);
  const [busy, setBusy] = useState(false);

  async function processAndUpload(uri: string) {
    if (!session) return;
    const manipulated = await ImageManipulator.manipulateAsync(
      uri,
      [{ resize: { width: PHOTO_MAX_DIMENSION } }],
      { compress: PHOTO_COMPRESS, format: ImageManipulator.SaveFormat.JPEG, base64: true },
    );
    if (!manipulated.base64) throw new Error('Compression échouée');
    const path = photoStoragePath(session.user.id, randomUUID());
    const bytes = Uint8Array.from(atob(manipulated.base64), (c) => c.charCodeAt(0));
    const { error } = await supabase.storage.from('profile-photos').upload(path, bytes, { contentType: 'image/jpeg' });
    if (error) throw error;
    await insertPhoto(session.user.id, path, photos.length);
    setPhotos((prev) => [...prev, { uri: manipulated.uri, storagePath: path }]);
  }

  async function pick(fromCamera: boolean) {
    if (photos.length >= 6) return Alert.alert('Photos', 'Maximum 6 photos.');
    try {
      const perm = fromCamera
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) return Alert.alert('Permission', 'Accès refusé.');
      const result = fromCamera
        ? await ImagePicker.launchCameraAsync({ allowsEditing: true, aspect: [3, 4], quality: 1 })
        : await ImagePicker.launchImageLibraryAsync({ allowsEditing: true, aspect: [3, 4], quality: 1 });
      if (result.canceled) return;
      setBusy(true);
      await processAndUpload(result.assets[0].uri);
    } catch (e: any) {
      Alert.alert('Photos', authErrorMessage(e?.message));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={{ flex: 1, padding: 24, gap: 12 }}>
      <Text style={{ fontSize: 20, fontWeight: '700' }}>Tes photos (1 à 6)</Text>
      <ScrollView horizontal style={{ flexGrow: 0 }} contentContainerStyle={{ gap: 8 }}>
        {photos.map((p) => (
          <Image key={p.storagePath} source={{ uri: p.uri }} style={{ width: 90, height: 120, borderRadius: 8 }} />
        ))}
      </ScrollView>
      <Pressable onPress={() => pick(false)} disabled={busy}>
        <Text style={{ color: '#208AEF', padding: 8 }}>＋ Galerie</Text>
      </Pressable>
      <Pressable onPress={() => pick(true)} disabled={busy}>
        <Text style={{ color: '#208AEF', padding: 8 }}>＋ Appareil photo</Text>
      </Pressable>
      <Button title="Continuer" onPress={() => router.push('/(onboarding)/preferences')} disabled={photos.length < 1 || busy} />
    </View>
  );
}
```

- [ ] **Step 3: Installer la dépendance UUID**

Run : `npx expo install expo-crypto`
Expected : OK (fournit `randomUUID`).

- [ ] **Step 4: Vérifier**

Run : `npx tsc --noEmit`
Expected : 0 erreur. (Si TS se plaint de `atob`, il est fourni par le runtime RN/Hermes ; en cas d'erreur de type seulement, ajoute `declare const atob: (s: string) => string;` en haut du fichier — sans changer la logique.)

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(onboarding): étape photos (picker, compression, upload privé)"
```

---

## Task 14: Étape Préférences

**Files:**
- Create: `app/(onboarding)/preferences.tsx`

- [ ] **Step 1: Écran Préférences**

Create `app/(onboarding)/preferences.tsx` :
```tsx
import { useState } from 'react';
import { Alert, Button, Pressable, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSession } from '../../src/features/auth/session-provider';
import { useGenders } from '../../src/features/profile/use-profile';
import { validatePreferences } from '../../src/features/profile/validation';
import { upsertPreferences } from '../../src/features/profile/profile-api';
import { authErrorMessage } from '../../src/features/auth/errors';

export default function Preferences() {
  const router = useRouter();
  const { session } = useSession();
  const { data: genders } = useGenders();
  const [seeking, setSeeking] = useState<string[]>([]);
  const [ageMin, setAgeMin] = useState('18');
  const [ageMax, setAgeMax] = useState('40');
  const [distance, setDistance] = useState('50');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function toggle(id: string) {
    setSeeking((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function onNext() {
    if (!session) return;
    setError(null);
    const input = {
      age_min: parseInt(ageMin, 10),
      age_max: parseInt(ageMax, 10),
      max_distance_km: parseInt(distance, 10),
      seekingGenderCount: seeking.length,
    };
    const errs = validatePreferences(input);
    const first = errs.age_min || errs.age_max || errs.max_distance_km || errs.seekingGenders;
    if (first) return setError(first);
    setBusy(true);
    try {
      await upsertPreferences(
        session.user.id,
        { age_min: input.age_min, age_max: input.age_max, max_distance_km: input.max_distance_km },
        seeking,
      );
      router.push('/(onboarding)/location');
    } catch (e: any) {
      Alert.alert('Préférences', authErrorMessage(e?.message));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={{ flex: 1, padding: 24, gap: 12 }}>
      <Text style={{ fontSize: 20, fontWeight: '700' }}>Tu cherches…</Text>
      {(genders ?? []).map((g) => (
        <Pressable key={g.id} onPress={() => toggle(g.id)}
          style={{ padding: 14, borderRadius: 8, borderWidth: 1, borderColor: seeking.includes(g.id) ? '#208AEF' : '#ccc', backgroundColor: seeking.includes(g.id) ? '#E6F0FF' : 'white' }}>
          <Text>{g.label}</Text>
        </Pressable>
      ))}
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <TextInput placeholder="Âge min" value={ageMin} onChangeText={setAgeMin} keyboardType="number-pad"
          style={{ flex: 1, borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 12 }} />
        <TextInput placeholder="Âge max" value={ageMax} onChangeText={setAgeMax} keyboardType="number-pad"
          style={{ flex: 1, borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 12 }} />
      </View>
      <TextInput placeholder="Distance max (km)" value={distance} onChangeText={setDistance} keyboardType="number-pad"
        style={{ borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 12 }} />
      {error ? <Text style={{ color: 'red' }}>{error}</Text> : null}
      <Button title={busy ? '...' : 'Continuer'} onPress={onNext} disabled={busy} />
    </View>
  );
}
```

- [ ] **Step 2: Vérifier**

Run : `npx tsc --noEmit`
Expected : 0 erreur.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat(onboarding): étape préférences"
```

---

## Task 15: Étape Position (termine l'onboarding)

**Files:**
- Create: `app/(onboarding)/location.tsx`
- Modify: `package.json`

- [ ] **Step 1: Installer**

Run : `npx expo install expo-location` (`--legacy-peer-deps` si besoin).
Expected : OK.

- [ ] **Step 2: Écran Position**

Create `app/(onboarding)/location.tsx` :
```tsx
import { useState } from 'react';
import { Alert, Button, Text, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import * as Location from 'expo-location';
import { useSession } from '../../src/features/auth/session-provider';
import { setMyLocation } from '../../src/features/profile/profile-api';
import { authErrorMessage } from '../../src/features/auth/errors';

export default function LocationStep() {
  const { session } = useSession();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);

  async function onFinish() {
    if (!session) return;
    setBusy(true);
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Localisation', 'Permission refusée. Elle est nécessaire pour te proposer des profils proches.');
        return;
      }
      const pos = await Location.getCurrentPositionAsync({});
      await setMyLocation(pos.coords.longitude, pos.coords.latitude);
      // Profil désormais complet -> le routage bascule vers (tabs)
      await queryClient.invalidateQueries({ queryKey: ['my-profile', session.user.id] });
    } catch (e: any) {
      Alert.alert('Localisation', authErrorMessage(e?.message));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={{ flex: 1, padding: 24, gap: 12, justifyContent: 'center' }}>
      <Text style={{ fontSize: 20, fontWeight: '700' }}>Ta position</Text>
      <Text>On utilise ta position pour te proposer des profils proches. Elle n'est jamais partagée précisément.</Text>
      <Button title={busy ? '...' : 'Activer la localisation et terminer'} onPress={onFinish} disabled={busy} />
    </View>
  );
}
```

- [ ] **Step 3: Vérifier**

Run : `npx tsc --noEmit && npm test 2>&1 | tail -3`
Expected : 0 erreur ; tests verts.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat(onboarding): étape position + fin d'onboarding"
```

---

## Task 16: Onglet Profil en lecture seule + permissions natives

**Files:**
- Modify: `app/(tabs)/profile.tsx`, `app.json`

- [ ] **Step 1: Onglet Profil**

Replace `app/(tabs)/profile.tsx` par :
```tsx
import { Alert, Button, Image, Text, View } from 'react-native';
import { useEffect, useState } from 'react';
import { useSession } from '../../src/features/auth/session-provider';
import { useMyProfile } from '../../src/features/profile/use-profile';
import { signedPhotoUrl } from '../../src/features/profile/signed-url';
import { signOut } from '../../src/features/auth/auth-api';
import { authErrorMessage } from '../../src/features/auth/errors';

export default function Profile() {
  const { session } = useSession();
  const { data } = useMyProfile(session?.user.id);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);

  useEffect(() => {
    const first = data?.photos[0];
    if (first) signedPhotoUrl(first.storage_path).then(setPhotoUrl);
  }, [data]);

  async function onSignOut() {
    try {
      await signOut();
    } catch (e: any) {
      Alert.alert('Déconnexion', authErrorMessage(e?.message));
    }
  }

  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24 }}>
      {photoUrl ? <Image source={{ uri: photoUrl }} style={{ width: 120, height: 160, borderRadius: 12 }} /> : null}
      <Text style={{ fontSize: 20, fontWeight: '700' }}>{data?.profile?.display_name ?? 'Profil'}</Text>
      {data?.profile?.bio ? <Text style={{ textAlign: 'center' }}>{data.profile.bio}</Text> : null}
      <Button title="Se déconnecter" onPress={onSignOut} />
    </View>
  );
}
```

- [ ] **Step 2: Chaînes de permission iOS + plugins**

Modify `app.json` — dans `expo.plugins`, ajoute les entrées avec messages (fusionne avec les plugins existants `expo-router`, `expo-splash-screen`, `expo-secure-store`, `expo-apple-authentication`, `@react-native-google-signin/google-signin`) :
```json
[
  "expo-image-picker",
  {
    "photosPermission": "L'app accède à tes photos pour ton profil.",
    "cameraPermission": "L'app accède à l'appareil photo pour ajouter une photo de profil."
  }
],
[
  "expo-location",
  {
    "locationWhenInUsePermission": "On utilise ta position pour te proposer des profils proches."
  }
]
```

- [ ] **Step 3: Vérifier**

Run : `npx tsc --noEmit && npm test 2>&1 | tail -3`
Expected : 0 erreur ; tests verts.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat(profile): onglet profil lecture seule + permissions natives"
```

---

## Task 17: Application des migrations au cloud + régénération des types (développeur)

Pas exécutable en session (Docker indispo, action de compte). Procédure pour le développeur.

**Files:** `src/types/database.ts` (régénéré)

- [ ] **Step 1: Lier le projet cloud**

Run : `npx supabase link --project-ref <REF_DE_TON_PROJET>` (le `<REF>` est dans l'URL du dashboard / Project Settings).

- [ ] **Step 2: Pousser les migrations**

Run : `npx supabase db push`
Expected : la migration `20260615120000_plan2_profiles.sql` s'applique sans erreur. (Alternative : copier-coller le SQL dans l'éditeur SQL du dashboard.)

- [ ] **Step 3: Régénérer les types depuis le cloud**

Modify `package.json` script `db:types` en `"supabase gen types typescript --linked > src/types/database.ts"`, puis Run : `npm run db:types`.
Expected : `src/types/database.ts` régénéré (remplace le miroir manuel).

- [ ] **Step 4: Vérifier**

Run : `npx tsc --noEmit`
Expected : 0 erreur (le type généré doit couvrir les mêmes tables ; corriger tout écart mineur de nom de colonne le cas échéant).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "chore(types): types régénérés depuis le projet cloud"
```

---

## Task 18: Vérification e2e (développeur, sur device)

Pas de test automatisé (modules natifs + cloud). À dérouler sur le build de dev.

**Files:** aucun.

- [ ] **Step 1: Lancer**

Run : `npx expo start --dev-client` puis ouvrir l'app sur le téléphone (un nouveau build de dev est nécessaire si de nouveaux modules natifs ont été ajoutés — `eas build --profile development --platform android`).

- [ ] **Step 2: Parcours**

Expected :
- Un compte fraîchement créé (sans profil) atterrit sur **l'onboarding** (pas les onglets).
- Identité → Genre → Photos (ajout ≥ 1 photo depuis galerie ET caméra, recadrage/compression OK) → Préférences → Position.
- Après « Activer la localisation et terminer », bascule automatique vers les **onglets**.
- Onglet **Profil** : la photo (URL signée) et le nom s'affichent. Déconnexion → écran de connexion.
- Re-connexion : on revient directement aux onglets (profil complet).

- [ ] **Step 3: Vérifier la sécurité (rapide)**

Depuis le dashboard Supabase (SQL editor, en tant qu'utilisateur authentifié via l'app) : confirmer qu'un `select` direct sur `profiles` ne renvoie que sa propre ligne (RLS). Confirmer que le bucket `profile-photos` est privé (pas d'accès sans URL signée).

---

## Self-Review (couverture du spec)

- **§3 flux onboarding bloquant + 4 états de routage** : Tasks 10, 11–15. ✓
- **§4 modèle de données (5 tables, CHECK 18+, seed genres)** : Task 2 ; types Task 3. ✓
- **§5 stockage photos privé + URLs signées + compression** : Tasks 2 (bucket/policies), 6 (params), 7 (signed url), 13 (upload). ✓
- **§6 sécurité : RLS propre-ligne, pas de lecture globale, storage scopé, validation uploads, CHECK base** : Task 2 (RLS/policies/CHECK/trigger max 6), 13 (compression/contentType). CAPTCHA/HIBP/confirm-email/WAF = documentés différés (hors implémentation, conforme au spec). ✓
- **§7 architecture client (feature profile, hooks, routes)** : Tasks 1, 3–9, 11–15. ✓
- **§8 migrations & Docker** : Tasks 2 (écriture), 17 (application cloud + régénération types). ✓
- **§9 tests (logique pure TDD ; DB différé)** : Tasks 4, 5, 6 (TDD) ; vérif cloud/e2e Tasks 17–18. ✓
- **Étape Identité → Genre** : l'`upsert` complet (avec `gender_id`) est fait à l'étape Genre (Task 12) pour respecter le schéma ; cohérent avec `upsertIdentity` défini en Task 8.

Cohérence des noms vérifiée : `isProfileComplete`/`CompletenessInput` (T4), `isAdult`/`validatePreferences` (T5), `photoStoragePath`/`PHOTO_*` (T6), `signedPhotoUrl` (T7), `upsertIdentity`/`insertPhoto`/`upsertPreferences`/`setMyLocation`/`fetchMyProfile`/`fetchActiveGenders` (T8), `useGenders`/`useMyProfile`/`useProfileCompleteness` (T9) — utilisés tels quels dans les écrans T10–16.
```
