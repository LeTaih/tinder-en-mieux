# Plan 6 — Push & Cron — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Notifier les utilisateurs hors application (Expo Push) pour un nouveau match, un nouveau message, et « 10 minutes restantes » avant l'expiration d'un match, avec deep-link au tap et badge sur l'icône.

**Architecture:** Déclenchement serveur-autoritaire : triggers `AFTER INSERT` sur `messages`/`matches` qui appellent une Edge Function `send-push` via `pg_net` ; un job `pg_cron` (chaque minute) gère le « 10 min restantes ». `send-push` (sécurisée par un secret interne) lit les tokens, incrémente le badge, et POST à l'API Expo Push. Le client enregistre son token, gère le deep-link et remet le badge à zéro à l'ouverture.

**Tech Stack:** Expo SDK 56 (RN 0.85.3, React 19.2.3, Expo Router 56), `expo-notifications`, `expo-device`, `expo-constants` ; Supabase (Postgres + RLS + Edge Functions + `pg_cron` + `pg_net` + Vault) ; @tanstack/react-query v5. Tests : jest-expo + @testing-library/react-native (tests dans `src/`, jamais `app/`).

**Spec :** `docs/superpowers/specs/2026-06-15-plan-6-push-cron-design.md`

---

## Contexte pour l'ingénieur (à lire avant de commencer)

- **Docker indisponible** : le SQL est appliqué par le développeur **via le SQL Editor** (pas `db push`). Les Edge Functions sont déployées avec `supabase functions deploy`. Les étapes « cloud » sont balisées comme **action développeur**.
- **`expo-notifications` est un module natif** : l'installer impose un **rebuild EAS**. Le push n'est testable que sur **device physique**.
- **Ref du projet Supabase** : `joiwgsupcgqlbpafyfnq`. URL de la fonction : `https://joiwgsupcgqlbpafyfnq.functions.supabase.co/send-push`.
- **`projectId` EAS** (pour les tokens Expo) : `7317478c-ada1-4209-8310-0a647afe031a`, déjà dans `app.json` (`extra.eas.projectId`) — on le lit via `expo-constants`.
- **Pattern Edge Function** (réf. `supabase/functions/get-matches/index.ts`) : `Deno.serve`, `createClient('jsr:@supabase/supabase-js@2')`, lecture d'env via `Deno.env.get`. `tsconfig` exclut déjà `supabase/functions` (code Deno hors tsc app).
- **Pattern fonction SQL de confiance** (réf. `record_swipe`, `send_message`) : `SECURITY DEFINER`, `search_path` figé, `revoke … from public` + `grant … to authenticated`/`service_role`.
- **Types** : `src/types/database.ts` est mis à jour à la main (Docker indispo) pour ce que le **client** utilise (`push_tokens`, `user_notification_state`, `clear_badge`, `matches.notified_expiring`). Les fonctions internes (`increment_badge`, `call_send_push`, `notify_*`) ne sont **pas** ajoutées (le client ne les appelle pas).
- **Commandes de test** : `npx jest <chemin>` ; `npx tsc --noEmit`.

---

## File Structure

**Config native**
- Modify `package.json` (via `npx expo install expo-notifications`) + `app.json` (plugin) — Task 1.

**Backend / types**
- Create `supabase/migrations/20260615160000_plan6_push.sql` — extensions, `push_tokens`, `user_notification_state`, `clear_badge`, `increment_badge`, `matches.notified_expiring`, `send_message` (replace + reset), `call_send_push`, `notify_new_message`/`notify_new_match`/`notify_expiring_matches` + triggers + cron — Task 2.
- Modify `src/types/database.ts` — Task 2.
- Create `supabase/functions/send-push/index.ts` — Task 3.

**Client `src/features/notifications/`**
- Create `notification-format.ts` (pur) + `notification-format.test.ts` — Task 4.
- Create `push-api.ts` (register token, clear badge) — Task 5.
- Create `use-push.ts` (hook : permission/token, deep-link, badge) — Task 5.
- Modify `app/_layout.tsx` (monter le hook dans la zone authentifiée) — Task 5.

---

## Task 1 : Installer `expo-notifications` + config plugin

**Files:**
- Modify: `package.json` (via CLI)
- Modify: `app.json`

- [ ] **Step 1 : Installer la dépendance (version compatible SDK 56)**

Run: `npx expo install expo-notifications`
Expected: `expo-notifications` ajouté à `package.json` (version `~56.x`). (Si offline : récupérer la version compatible SDK 56 et l'ajouter manuellement, puis `npm install --legacy-peer-deps`.)

- [ ] **Step 2 : Déclarer le plugin dans `app.json`**

Dans `app.json`, ajouter `"expo-notifications"` à la fin du tableau `plugins` (après le bloc `expo-location`). Le tableau se termine actuellement par :

```json
      [
        "expo-location",
        {
          "locationWhenInUsePermission": "On utilise ta position pour te proposer des profils proches."
        }
      ]
    ],
```
Le remplacer par :
```json
      [
        "expo-location",
        {
          "locationWhenInUsePermission": "On utilise ta position pour te proposer des profils proches."
        }
      ],
      "expo-notifications"
    ],
```

- [ ] **Step 3 : Vérifier la compilation**

Run: `npx tsc --noEmit`
Expected: aucune erreur (la dépendance résout ses types).

- [ ] **Step 4 : Commit**

```bash
git add package.json package-lock.json app.json
git commit -m "feat(plan-6): ajoute expo-notifications (module natif, rebuild requis)"
```

---

## Task 2 : Migration SQL `plan6` + types

**Files:**
- Create: `supabase/migrations/20260615160000_plan6_push.sql`
- Modify: `src/types/database.ts`

- [ ] **Step 1 : Écrire la migration**

Créer `supabase/migrations/20260615160000_plan6_push.sql` :

```sql
-- ============ Extensions ============
create extension if not exists pg_net;
create extension if not exists pg_cron;

-- ============ Tokens de push (RLS propre-ligne) ============
create table public.push_tokens (
  user_id uuid not null references public.profiles(id) on delete cascade,
  token text primary key,
  platform text,
  updated_at timestamptz not null default now()
);
create index push_tokens_user_idx on public.push_tokens (user_id);

alter table public.push_tokens enable row level security;
create policy "push_tokens: select own" on public.push_tokens
  for select to authenticated using (auth.uid() = user_id);
create policy "push_tokens: insert own" on public.push_tokens
  for insert to authenticated with check (auth.uid() = user_id);
create policy "push_tokens: update own" on public.push_tokens
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "push_tokens: delete own" on public.push_tokens
  for delete to authenticated using (auth.uid() = user_id);

-- ============ Badge (compteur serveur) ============
create table public.user_notification_state (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  badge_count int not null default 0
);
alter table public.user_notification_state enable row level security;
create policy "notif_state: select own" on public.user_notification_state
  for select to authenticated using (auth.uid() = user_id);
-- Pas d'insert/update/delete client : clear_badge (definer) remet à 0, send-push (service) incrémente.

create function public.clear_badge() returns void
language sql security definer set search_path = public as $$
  insert into public.user_notification_state (user_id, badge_count)
  values (auth.uid(), 0)
  on conflict (user_id) do update set badge_count = 0;
$$;
revoke execute on function public.clear_badge() from public;
grant execute on function public.clear_badge() to authenticated;

create function public.increment_badge(p_user uuid) returns int
language plpgsql security definer set search_path = public as $$
declare v int;
begin
  insert into public.user_notification_state (user_id, badge_count)
  values (p_user, 1)
  on conflict (user_id) do update set badge_count = public.user_notification_state.badge_count + 1
  returning badge_count into v;
  return v;
end;
$$;
revoke execute on function public.increment_badge(uuid) from public, authenticated;
grant execute on function public.increment_badge(uuid) to service_role;

-- ============ Anti-doublon du push « 10 min » ============
alter table public.matches add column if not exists notified_expiring boolean not null default false;

-- ============ send_message : reset notified_expiring quand le timer repart ============
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

-- ============ Appel générique de l'Edge Function send-push (via pg_net + Vault) ============
create function public.call_send_push(p_user_ids uuid[], p_title text, p_body text, p_data jsonb)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_url text;
  v_secret text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'push_function_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'push_internal_secret';
  if v_url is null or v_secret is null then return; end if; -- non configuré -> no-op silencieux
  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-internal-secret', v_secret),
    body := jsonb_build_object(
      'user_ids', to_jsonb(p_user_ids),
      'title', p_title,
      'body', p_body,
      'data', coalesce(p_data, '{}'::jsonb)
    )
  );
end;
$$;
revoke execute on function public.call_send_push(uuid[], text, text, jsonb) from public, authenticated;

-- ============ Trigger : nouveau message -> push au destinataire ============
create function public.notify_new_message() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_recipient uuid;
  v_sender_name text;
  v_body text;
begin
  select case when m.user_a = new.sender_id then m.user_b else m.user_a end
    into v_recipient from public.matches m where m.id = new.match_id;
  select display_name into v_sender_name from public.profiles where id = new.sender_id;
  v_body := case when new.image_path is not null then '📷 Photo' else left(new.body, 80) end;
  perform public.call_send_push(
    array[v_recipient],
    coalesce(v_sender_name, 'Nouveau message'),
    v_body,
    jsonb_build_object('type', 'message', 'matchId', new.match_id::text)
  );
  return new;
end;
$$;
create trigger trg_notify_new_message after insert on public.messages
  for each row execute function public.notify_new_message();

-- ============ Trigger : nouveau match -> push aux deux ============
create function public.notify_new_match() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.call_send_push(
    array[new.user_a, new.user_b],
    'C''est un match !',
    'Vous avez un nouveau match — vous avez 1 h pour discuter !',
    jsonb_build_object('type', 'match', 'matchId', new.id::text)
  );
  return new;
end;
$$;
create trigger trg_notify_new_match after insert on public.matches
  for each row execute function public.notify_new_match();

-- ============ Cron : « 10 min restantes » ============
create function public.notify_expiring_matches() returns void
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  for r in
    select id, user_a, user_b from public.matches
    where expires_at > now()
      and expires_at <= now() + interval '10 minutes'
      and notified_expiring = false
  loop
    perform public.call_send_push(
      array[r.user_a, r.user_b],
      '⏳ Plus que 10 minutes !',
      'Ton match expire bientôt — écris-lui pour le garder en vie !',
      jsonb_build_object('type', 'expiring', 'matchId', r.id::text)
    );
    update public.matches set notified_expiring = true where id = r.id;
  end loop;
end;
$$;
revoke execute on function public.notify_expiring_matches() from public, authenticated;

select cron.schedule('notify-expiring-matches', '* * * * *', $$select public.notify_expiring_matches()$$);
```

- [ ] **Step 2 : Types — colonne `notified_expiring` sur `matches`**

Dans `src/types/database.ts`, table `matches`, ajouter `notified_expiring` (ordre alphabétique : après `last_message_at`, avant `user_a`) dans `Row`/`Insert`/`Update` :
- Row: `          notified_expiring: boolean`
- Insert: `          notified_expiring?: boolean`
- Update: `          notified_expiring?: boolean`

- [ ] **Step 3 : Types — table `push_tokens`**

Dans `src/types/database.ts`, insérer après la table `profiles` et avant `swipes` :

```ts
      push_tokens: {
        Row: {
          platform: string | null
          token: string
          updated_at: string
          user_id: string
        }
        Insert: {
          platform?: string | null
          token: string
          updated_at?: string
          user_id: string
        }
        Update: {
          platform?: string | null
          token?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "push_tokens_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
```

- [ ] **Step 4 : Types — table `user_notification_state`**

Dans `src/types/database.ts`, insérer après la table `swipes` (dernière table, avant la fermeture de `Tables`) :

```ts
      user_notification_state: {
        Row: {
          badge_count: number
          user_id: string
        }
        Insert: {
          badge_count?: number
          user_id: string
        }
        Update: {
          badge_count?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_notification_state_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
```

- [ ] **Step 5 : Types — fonction `clear_badge`**

Dans `src/types/database.ts`, section `Functions`, insérer en tête (avant `deck_candidates`, ordre alphabétique) :

```ts
      clear_badge: { Args: never; Returns: undefined }
```

- [ ] **Step 6 : Vérifier la compilation**

Run: `npx tsc --noEmit`
Expected: aucune erreur.

- [ ] **Step 7 : Commit**

```bash
git add supabase/migrations/20260615160000_plan6_push.sql src/types/database.ts
git commit -m "feat(plan-6): schéma push (tokens, badge, triggers, cron, notified_expiring)"
```

- [ ] **Step 8 : APPLICATION CLOUD (action développeur)**

1. **Activer les extensions** dans *Database → Extensions* : **`pg_net`** et **`pg_cron`** (ou via le SQL ci-dessus si les droits le permettent).
2. **Créer les secrets Vault** (SQL Editor) — remplace `<SECRET>` par une valeur forte :
   ```sql
   select vault.create_secret('<SECRET>', 'push_internal_secret');
   select vault.create_secret('https://joiwgsupcgqlbpafyfnq.functions.supabase.co/send-push', 'push_function_url');
   ```
3. **Appliquer** `20260615160000_plan6_push.sql` via le SQL Editor.
4. Vérifier :
   ```sql
   select count(*) from public.push_tokens;                         -- 0
   select jobname from cron.job where jobname = 'notify-expiring-matches'; -- 1 ligne
   select prosecdef from pg_proc where proname = 'call_send_push';  -- t
   ```

---

## Task 3 : Edge Function `send-push`

**Files:**
- Create: `supabase/functions/send-push/index.ts`

- [ ] **Step 1 : Écrire la fonction**

Créer `supabase/functions/send-push/index.ts` :

```ts
import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const INTERNAL_SECRET = Deno.env.get('INTERNAL_PUSH_SECRET')!;
const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

Deno.serve(async (req) => {
  if (req.headers.get('x-internal-secret') !== INTERNAL_SECRET) {
    return new Response('Forbidden', { status: 403 });
  }

  const { user_ids, title, body, data } = await req.json();
  if (!Array.isArray(user_ids) || user_ids.length === 0) {
    return new Response(JSON.stringify({ sent: 0 }), { headers: { 'Content-Type': 'application/json' } });
  }

  const service = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const messages: Array<Record<string, unknown>> = [];
  for (const userId of user_ids) {
    const { data: tokens } = await service.from('push_tokens').select('token').eq('user_id', userId);
    if (!tokens || tokens.length === 0) continue;
    const { data: badge } = await service.rpc('increment_badge', { p_user: userId });
    for (const t of tokens) {
      messages.push({ to: t.token, title, body, data: data ?? {}, badge: badge ?? undefined, sound: 'default' });
    }
  }

  if (messages.length > 0) {
    await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(messages),
    });
  }

  return new Response(JSON.stringify({ sent: messages.length }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
```

- [ ] **Step 2 : Vérifier que tsc de l'app ignore bien ce fichier**

Run: `npx tsc --noEmit`
Expected: aucune erreur (le dossier `supabase/functions` est exclu du tsconfig app).

- [ ] **Step 3 : Commit**

```bash
git add supabase/functions/send-push/index.ts
git commit -m "feat(plan-6): Edge Function send-push (Expo Push, secret interne, badge)"
```

- [ ] **Step 4 : DÉPLOIEMENT CLOUD (action développeur)**

```bash
supabase functions deploy send-push --no-verify-jwt
supabase secrets set INTERNAL_PUSH_SECRET=<SECRET>   # MÊME valeur que le secret Vault 'push_internal_secret'
```

---

## Task 4 : `notification-format.ts` (logique pure, TDD)

**Files:**
- Create: `src/features/notifications/notification-format.ts`
- Test: `src/features/notifications/notification-format.test.ts`

- [ ] **Step 1 : Écrire le test qui échoue**

Créer `src/features/notifications/notification-format.test.ts` :

```ts
import { routeForNotification, type PushData } from './notification-format';

test('route vers le chat pour un message', () => {
  expect(routeForNotification({ type: 'message', matchId: 'm1' })).toBe('/match/m1');
});

test('route vers le chat pour un match', () => {
  expect(routeForNotification({ type: 'match', matchId: 'm2' })).toBe('/match/m2');
});

test('route vers le chat pour une expiration', () => {
  expect(routeForNotification({ type: 'expiring', matchId: 'm3' })).toBe('/match/m3');
});

test('null si données absentes ou incomplètes', () => {
  expect(routeForNotification(undefined)).toBeNull();
  expect(routeForNotification({} as PushData)).toBeNull();
  expect(routeForNotification({ type: 'message' })).toBeNull();
});
```

- [ ] **Step 2 : Lancer le test, vérifier qu'il échoue**

Run: `npx jest src/features/notifications/notification-format.test.ts`
Expected: FAIL — `Cannot find module './notification-format'`.

- [ ] **Step 3 : Implémenter**

Créer `src/features/notifications/notification-format.ts` :

```ts
export type PushData = { type?: 'message' | 'match' | 'expiring'; matchId?: string };

// Les 3 types de notif mènent au chat du match concerné.
export function routeForNotification(data: PushData | undefined): string | null {
  if (!data || !data.matchId) return null;
  if (data.type === 'message' || data.type === 'match' || data.type === 'expiring') {
    return `/match/${data.matchId}`;
  }
  return null;
}
```

- [ ] **Step 4 : Lancer le test, vérifier qu'il passe**

Run: `npx jest src/features/notifications/notification-format.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5 : Commit**

```bash
git add src/features/notifications/notification-format.ts src/features/notifications/notification-format.test.ts
git commit -m "feat(plan-6): mapping notif -> route (deep-link), testé"
```

---

## Task 5 : `push-api.ts` + `use-push.ts` + montage

**Files:**
- Create: `src/features/notifications/push-api.ts`
- Create: `src/features/notifications/use-push.ts`
- Modify: `app/_layout.tsx`

- [ ] **Step 1 : Écrire `push-api.ts`**

Créer `src/features/notifications/push-api.ts` :

```ts
import { supabase } from '../../lib/supabase';

export async function registerPushToken(userId: string, token: string, platform: string): Promise<void> {
  const { error } = await supabase.from('push_tokens').upsert(
    { user_id: userId, token, platform, updated_at: new Date().toISOString() },
    { onConflict: 'token' },
  );
  if (error) throw error;
}

export async function clearBadge(): Promise<void> {
  await supabase.rpc('clear_badge');
}
```

- [ ] **Step 2 : Écrire `use-push.ts`**

Créer `src/features/notifications/use-push.ts` :

```ts
import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { useRouter } from 'expo-router';
import { clearBadge, registerPushToken } from './push-api';
import { routeForNotification, type PushData } from './notification-format';

// Affiche aussi les notifs quand l'app est au premier plan.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

export function usePushNotifications(userId: string | undefined) {
  const router = useRouter();

  // Enregistrement du token (permission + device physique).
  useEffect(() => {
    if (!userId || !Device.isDevice) return;
    let cancelled = false;
    (async () => {
      const existing = await Notifications.getPermissionsAsync();
      let status = existing.status;
      if (status !== 'granted') {
        status = (await Notifications.requestPermissionsAsync()).status;
      }
      if (status !== 'granted' || cancelled) return;
      const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
      if (!projectId) return;
      const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
      if (!cancelled) await registerPushToken(userId, token, Platform.OS);
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  // Deep-link au tap (app au premier plan, en arrière-plan, ou tuée).
  useEffect(() => {
    function open(data: PushData | undefined) {
      const route = routeForNotification(data);
      if (route) router.push(route as never);
    }
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      open(response.notification.request.content.data as PushData);
    });
    Notifications.getLastNotificationResponseAsync().then((response) => {
      if (response) open(response.notification.request.content.data as PushData);
    });
    return () => sub.remove();
  }, [router]);

  // Remise à zéro du badge à l'ouverture / retour au premier plan.
  useEffect(() => {
    if (!userId) return;
    function reset() {
      clearBadge();
      Notifications.setBadgeCountAsync(0);
    }
    reset();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') reset();
    });
    return () => sub.remove();
  }, [userId]);
}
```

- [ ] **Step 3 : Monter le hook dans `app/_layout.tsx`**

Dans `app/_layout.tsx`, ajouter l'import en tête (avec les autres imports de features) :
```tsx
import { usePushNotifications } from '../src/features/notifications/use-push';
```
Dans `RootNavigator`, juste après la ligne `const { complete, isLoading: profileLoading } = useProfileCompleteness(userId);`, ajouter :
```tsx
  usePushNotifications(userId);
```
(`userId` y est déjà défini : `const userId = session?.user.id;`.)

- [ ] **Step 4 : Vérifier compilation + suite de tests**

Run: `npx tsc --noEmit && npx jest`
Expected: compilation OK ; tous les tests verts (existants + notification-format 4).

- [ ] **Step 5 : Commit**

```bash
git add src/features/notifications/push-api.ts src/features/notifications/use-push.ts app/_layout.tsx
git commit -m "feat(plan-6): enregistrement token + deep-link + badge (client)"
```

- [ ] **Step 6 : VÉRIFICATION DEVICE (action développeur)**

Pré-requis : Task 2 (SQL) appliqué, Task 3 (`send-push`) déployé + secret posé, extensions activées, secrets Vault créés. Puis :
1. **Rebuild EAS** (module natif) : `npx eas-cli build --profile development --platform android`, installer sur device physique.
2. Lancer l'app, **accepter** la permission notifications → vérifier qu'une ligne apparaît dans `push_tokens` (SQL Editor).
3. Avec 2 comptes sur 2 devices : envoyer un **message** → l'autre reçoit un push ; taper la notif → ouvre le chat. Créer un **match** → push aux deux.
4. **« 10 min »** : forcer un match proche de l'expiration et laisser le cron tourner :
   ```sql
   update public.matches set expires_at = now() + interval '9 minutes', notified_expiring = false
   where id = '<MATCH_ID>';
   ```
   Attendre ≤ 1 min → push « ⏳ Plus que 10 minutes ! » aux deux.
5. Vérifier le **badge** sur l'icône (incrémente à la réception, repart à 0 à l'ouverture de l'app).

---

## Self-Review

**1. Spec coverage** (spec §1–§12) :
- Expo Push, enregistrement token → Task 1 (install) + Task 5 (`use-push`/`push-api`). ✅
- Nouveau match / message / 10-min → Task 2 (triggers + cron + `call_send_push`) + Task 3 (`send-push`). ✅
- Deep-link → Task 4 (`routeForNotification`) + Task 5 (listener). ✅
- Badge (compteur serveur, reset ouverture) → Task 2 (`user_notification_state`, `increment_badge`, `clear_badge`) + Task 3 (incrément) + Task 5 (reset AppState). ✅
- Edge Function sécurisée par secret interne → Task 3 (`x-internal-secret`) + Task 2/Step 8 (Vault) + Task 3/Step 4 (`secrets set`). ✅
- `push_tokens` RLS propre-ligne ; `matches.notified_expiring` + reset dans `send_message` → Task 2. ✅
- Triggers + pg_net + pg_cron → Task 2. ✅
- Migrations/déploiement (extensions, Vault, deploy, rebuild) → Task 2/Step 8, Task 3/Step 4, Task 5/Step 6. ✅
- Tests (logique pure + cloud/device) → Task 4 + étapes de vérif. ✅
- Hors périmètre (suppression chat ouvert, heures calmes…) → non implémenté. ✅

**2. Placeholder scan** : pas de TBD/TODO ; `<SECRET>`/`<MATCH_ID>` sont des valeurs de déploiement/test à fournir par le dev (explicitées), pas des trous de plan. Tout le code est complet.

**3. Type consistency** : `PushData` défini en Task 4 et réutilisé en Task 5. `routeForNotification` (Task 4) consommé en Task 5. `registerPushToken(userId, token, platform)` / `clearBadge()` (Task 5 push-api) appelés par `use-push` (Task 5). `clear_badge` / `increment_badge` / `push_tokens` / `user_notification_state` / `notified_expiring` cohérents entre SQL (Task 2), types (Task 2) et usage (Task 3 service rpc `increment_badge` ; Task 5 client `clear_badge`/`push_tokens`). `call_send_push(uuid[], text, text, jsonb)` : signature identique à sa définition et à ses 3 appels (`notify_new_message`/`notify_new_match`/`notify_expiring_matches`). `data.type`/`matchId` cohérents entre les `jsonb_build_object` SQL et `PushData`. ✅
