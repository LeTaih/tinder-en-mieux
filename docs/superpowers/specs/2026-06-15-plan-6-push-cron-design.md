# Plan 6 — Push & Cron — Spec de conception

Date : 2026-06-15
Statut : validé en brainstorming, en attente de relecture utilisateur
Spec parent : `docs/superpowers/specs/2026-06-15-tinder-en-mieux-mvp-design.md`
Plan précédent : `docs/superpowers/specs/2026-06-15-plan-5-chat-temps-reel-design.md`

## 1. Objectif

Notifier les utilisateurs **hors application** (push) pour les 3 moments clés du produit :
**nouveau match**, **nouveau message**, et **« 10 minutes restantes »** avant l'expiration d'un match
(le nudge qui pousse à réagir avant de perdre la conversation). Inclut le **deep-link** (le tap ouvre
l'écran concerné) et un **badge** sur l'icône de l'app.

## 2. Périmètre

### Inclus
- **Expo Push Notifications** : enregistrement du token, envoi serveur, réception.
- **3 déclencheurs** : nouveau match, nouveau message, « 10 min restantes ».
- **Deep-link** : tap → `/match/[id]` (message/match) ou l'onglet Matchs.
- **Badge** sur l'icône (compteur serveur, remis à zéro à l'ouverture).

### Hors périmètre
- Suppression « chat déjà ouvert », heures calmes, regroupement de notifs, notifs marketing,
  centre de notifications in-app → exclus (YAGNI v1).
- Bloquer / signaler → **Plan 7**.

## 3. Décision d'architecture : déclenchement

**Événements → triggers DB + `pg_net` ; temporel → `pg_cron`.**
- **Nouveau message / nouveau match** : trigger `AFTER INSERT` qui appelle l'Edge Function d'envoi via
  **`pg_net`** (HTTP POST depuis Postgres) → serveur-autoritaire, indépendant du client, impossible à
  forger côté client.
- **« 10 min restantes »** : c'est **temporel**, donc un job **`pg_cron`** qui balaie chaque minute les
  matchs proches de l'expiration.

> **Alternatives écartées** : déclenchement **côté client** (peu fiable ; le destinataire doit être
> notifié même app fermée) ; **tout en cron** (latence d'1 min sur les messages — inacceptable pour un
> chat temps réel).

## 4. Provider & client

- **`expo-notifications`** (nouveau module natif → **rebuild EAS requis** ; test sur **device
  physique**). `expo-device` (déjà installé) sert au garde `Device.isDevice`. `projectId` EAS déjà
  présent (`7317478c-…`), requis par `getExpoPushTokenAsync`.
- **Enregistrement du token** : au démarrage (session active), après permission accordée, le client
  récupère l'**Expo push token** et l'**upsert** dans `push_tokens` (son propre `user_id`).
- **Handler de premier plan** : `setNotificationHandler` pour afficher la notif même app au premier plan
  (pas de suppression demandée).
- **Deep-link** : `addNotificationResponseReceivedListener` (+ `getLastNotificationResponseAsync` pour
  le cas app tuée) lit `data.type` / `data.matchId` → `router.push('/match/<id>')` ou onglet Matchs.
- **Badge** : à chaque retour au premier plan (AppState `active`), le client appelle la RPC
  `clear_badge()` puis `Notifications.setBadgeCountAsync(0)`.

## 5. Edge Function `send-push`

Une **seule** fonction d'envoi, **serveur-à-serveur** :
- **Entrée** : `{ user_ids: string[], title: string, body: string, data?: object }`.
- Lit les **tokens** des destinataires (`push_tokens`), **incrémente** le badge de chaque destinataire
  (`user_notification_state`), et **POST** à l'**API Expo Push** (`https://exp.host/--/api/v2/push/send`),
  un message par token avec le `badge` à jour et `data` (pour le deep-link).
- **Sécurité** : vérifie un **secret interne** (header `x-internal-secret` == variable d'env
  `INTERNAL_PUSH_SECRET`). Déployée **`--no-verify-jwt`** (appelée par les triggers/cron, pas par un
  utilisateur). **Aucun client ne peut l'appeler** (il n'a pas le secret) → anti-spam/anti-abus.
- Utilise la **clé service role** (env auto-injecté) pour lire `push_tokens` / écrire le badge.

## 6. Modèle de données (migration `plan6`)

- **`push_tokens`** : `user_id uuid` (fk `profiles`), `token text`, `platform text`, `updated_at`.
  Clé/unicité sur `token` (un token = un device) ; index sur `user_id`. **RLS propre-ligne** : le client
  ne lit/écrit que ses propres tokens (`auth.uid() = user_id`).
- **`matches`** += **`notified_expiring boolean not null default false`** : anti-doublon du push
  « 10 min ». **`send_message` (Plan 5) le remet à `false`** quand le timer repart (on pourra
  re-prévenir au prochain creux). *(C'est la seule modif d'un objet existant.)*
- **`user_notification_state`** : `user_id uuid pk` (fk `profiles`), `badge_count int not null default 0`.
  **RLS** : lecture propre-ligne. RPC **`clear_badge()`** (`SECURITY DEFINER`, cantonnée à `auth.uid()`)
  remet `badge_count = 0`. L'écriture/incrément se fait **uniquement** via `send-push` (service role).

## 7. Déclencheurs serveur

- **Trigger `AFTER INSERT` sur `messages`** → `notify_new_message()` (`SECURITY DEFINER`) : destinataire
  = le participant du match **≠ `sender_id`**. Titre = prénom de l'expéditeur, corps = aperçu texte
  (tronqué) ou « 📷 Photo ». `data = { type: 'message', matchId }`. Appel `net.http_post` vers
  `send-push`.
- **Trigger `AFTER INSERT` sur `matches`** → `notify_new_match()` (`SECURITY DEFINER`) : destinataires =
  **les deux** participants. Titre « C'est un match ! », corps générique. `data = { type: 'match',
  matchId }`.
- **Cron `pg_cron` (chaque minute)** → `notify_expiring_matches()` (`SECURITY DEFINER`) : matchs **actifs**
  (`expires_at > now()`) dont `expires_at <= now() + interval '10 minutes'` et `notified_expiring =
  false` → push aux **deux** participants (« ⏳ Il te reste 10 min avec X ! »), puis `notified_expiring =
  true`. `data = { type: 'expiring', matchId }`.

Les 3 fonctions lisent l'**URL de `send-push`** et le **secret interne** depuis **Supabase Vault**
(`vault.decrypted_secrets`) et appellent `net.http_post`.

## 8. Sécurité / anti-abus

- **Aucun client ne déclenche d'envoi** : `send-push` exige le secret interne (détenu uniquement par la
  base/Vault). Les pushs ne naissent que des triggers/cron de confiance.
- `push_tokens` et `clear_badge()` **cantonnés à `auth.uid()`** ; l'incrément de badge est réservé au
  service role (via `send-push`).
- Les triggers passent des **`user_id`** à `send-push` ; **aucun token** n'est jamais renvoyé au client.
- Fonctions `SECURITY DEFINER` à **`search_path` figé**.

## 9. Architecture client

Feature `src/features/notifications/` :
- `notification-format.ts` (**pur, testé**) : `messagePreview(body, hasImage)` (aperçu tronqué ou
  « 📷 Photo ») ; `routeForNotification(data)` → chemin de deep-link (`/match/<id>` ou `/(tabs)/matches`).
- `push-api.ts` : `registerPushToken(userId)` (upsert), `clearBadge()` (RPC).
- `use-push.ts` (ou `notifications-provider.tsx`) : enregistrement du token (permission + `isDevice` +
  `getExpoPushTokenAsync`), `setNotificationHandler`, listener de réponse (deep-link), remise à zéro du
  badge sur AppState `active`.
- Montée dans `app/_layout.tsx` (dans la zone authentifiée) ; type `PushData = { type: 'message' |
  'match' | 'expiring'; matchId: string }`.

## 10. Migrations & déploiement (contrainte Docker)

Tout par le dev, **via le SQL Editor** + CLI :
1. Activer **`pg_cron`** et **`pg_net`** (dashboard *Database → Extensions* ou `create extension`).
2. Stocker dans **Vault** : `push_internal_secret` (secret partagé) et `push_function_url`
   (`https://<ref>.functions.supabase.co/send-push`).
3. Appliquer la migration `plan6` : `push_tokens`, `user_notification_state`, `clear_badge`,
   `matches.notified_expiring`, reset dans `send_message`, fonctions `notify_*`, triggers, job
   `cron.schedule`.
4. `supabase functions deploy send-push --no-verify-jwt` + `supabase secrets set INTERNAL_PUSH_SECRET=…`
   (**même valeur** que le secret Vault).
5. **Rebuild EAS** (module natif `expo-notifications`) + régénérer les types.

## 11. Stratégie de test

- **TDD** sur `notification-format.ts` (aperçu texte/photo, troncature ; mapping `data` → route).
- Triggers / cron / Edge Function / deep-link / badge vérifiés **côté cloud + device** (Docker indispo).
- Composants éventuels légers en RNTL **hors `app/`**.

## 12. Risques & points d'attention

- **Rebuild obligatoire** (module natif) ; push **non testable en émulateur** → device physique.
- **Cohérence du secret** : Vault (`push_internal_secret`) **==** env de la fonction
  (`INTERNAL_PUSH_SECRET`), sinon tous les envois échouent en 401.
- **`pg_net` asynchrone** : `net.http_post` met la requête en file (table `net.http_request_queue`) ; un
  échec d'envoi n'est pas remonté au trigger (vérifier via `net._http_response` en debug).
- **Badge serveur** : approximation (compte les notifs envoyées, pas les messages « non lus » — on n'a
  pas d'accusés de lecture). Remis à 0 à l'ouverture de l'app. Assumé pour v1.
- **Reset `notified_expiring`** dans `send_message` : indispensable, sinon un match re-animé ne
  re-préviendrait jamais.
- **Permission refusée** : si l'utilisateur refuse les notifs, pas de token enregistré → pas de push
  (dégradation propre, aucune erreur).
- **Token périmé / `DeviceNotRegistered`** : l'API Expo peut renvoyer des reçus d'erreur ; en v1 on
  ignore (nettoyage des tokens morts = amélioration ultérieure, à noter).
