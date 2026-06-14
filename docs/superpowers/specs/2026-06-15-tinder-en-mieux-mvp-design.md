# tinder-en-mieux — Spec de conception (MVP / v1)

Date : 2026-06-15
Statut : validé en brainstorming, en attente de relecture utilisateur

## 1. Vision produit

App de rencontre type Tinder dont le **différenciateur central est l'expiration des matchs**.
Quand deux personnes matchent, elles ont **60 minutes** pour discuter, sinon le match
bascule en lecture seule. Le timer **se réinitialise à 60 min à chaque message** : tant
que la conversation vit, le match vit ; le silence le tue. Cette mécanique crée l'urgence
et l'identité du produit. **Le timer est autoritatif côté serveur**, pas un simple affichage
client.

### Objectif de cette v1

Produire une **v1 propre et démontrable** (présentation à un responsable) tout en posant des
**fondations saines pour une montée en charge à très grande échelle**. On évite la dette
qui bloquerait le scaling, sans sur-ingénierie prématurée.

## 2. Stack (décidée, non négociable pour cette v1)

- **Front** : React Native via **Expo**, navigation **Expo Router** (file-based).
- **Deck de swipe** : librairie maintenue **`rn-swiper-list`** (Reanimated 3). Ne pas réécrire à la main.
- **Backend** : **Supabase** managé — Postgres (+ **PostGIS**), Auth, Realtime, Storage, Edge Functions, **pg_cron**.
- **État serveur côté client** : **TanStack Query** + abonnements **Supabase Realtime**.
- **Stockage session** : `expo-secure-store`.
- **Typage** : génération auto des types TS depuis le schéma Supabase (`supabase gen types`).
- **Stratégie** : construction fraîche sur cette stack. **Ne pas forker** un clone Tinder existant
  (projets tutoriels Firebase, sans mécanique d'expiration). Inspiration visuelle seulement.

## 3. Principes d'architecture (orientés scale)

1. **Toute la logique métier vit dans Postgres** (triggers, fonctions RPC, RLS). Le client ne
   fait jamais autorité. → single source of truth, sécurité par défaut, front remplaçable.
2. **Jamais de coordonnées brutes exposées** au client. Le deck ne renvoie qu'une **distance
   calculée** côté serveur.
3. **Requêtes paginées** (curseur) pour le deck et les messages. **Index** sur tous les accès chauds.
4. **Edge Functions stateless et idempotentes** (flags anti-doublon pour les notifications).
5. **Types générés de bout en bout**, code organisé **par feature** (`auth/`, `onboarding/`,
   `deck/`, `matches/`, `chat/`, `safety/`).
6. **Aucun secret dans le client**, configuration par variables d'environnement.

## 4. Périmètre fonctionnel (MVP)

### Inclus

- **Auth** : email/mot de passe + **Apple Sign-In** + **Google Sign-In**, via Supabase Auth
  (aucune logique d'auth maison).
- **Onboarding / profil** : nom affiché, date de naissance (18+), genre (choisi dans une **liste
  de référence configurable**, jamais figée en dur), bio.
- **Photos** : **1 à 6**, **minimum 1 obligatoire** pour être visible, réordonnables, uploadées
  sur Supabase Storage.
- **Préférences de découverte** : genre recherché, tranche d'âge (min/max), distance max (km).
- **Deck à swiper** : géoloc + filtres (distance, âge, genre), tri par proximité.
- **Swipe** : like / pass, **quota de likes par jour**, **rewind** (annuler le dernier swipe).
  Pas de superlike.
- **Match** : sur **like mutuel**.
- **Chat temps réel** entre deux profils matchés.
- **Timer d'expiration 1h** : reset à chaque message, autoritatif serveur.
- **Expiration** : conversation **archivée en lecture seule** (verrouillée, marquée « expirée »).
  **Re-match possible** : un nouveau match repart à zéro (nouveau timer) ; l'ancienne conversation
  archivée reste consultable séparément.
- **Notifications push** : nouveau match, nouveau message reçu, **alerte « 10 min restantes »**.
- **Sécurité (block & report)** : présent dès la v1, **UI très discrète**.

### Hors périmètre v1 (YAGNI)

Paiements / abonnements, superlike, boosts, algo de matching avancé / ML, version web, vidéo,
dashboard de modération (les reports sont stockés mais non traités via UI).

## 5. Règles d'expiration (le cœur)

| Évènement | Effet sur `expires_at` |
|---|---|
| Création du match (like mutuel) | `now() + 60 min` |
| Message envoyé | `now() + 60 min` (reset) |
| `now() > expires_at` | match « expiré » : chat en lecture seule |

- **Lecture seule garantie par la base** : l'insertion d'un message est refusée (policy RLS +
  trigger) dès que `now() > expires_at`. Pas de course possible, indépendant du timing du cron.
- **Cron (~1 min)** → Edge Function idempotente :
  1. push **« 10 min restantes »** aux matchs expirant bientôt et non encore notifiés
     (`notified_expiring`),
  2. bascule `status = 'expired'` sur les matchs périmés + push **« match expiré »**
     (`notified_expired`).
- **Point clé** : la *correction de l'état* ne dépend jamais du cron. Le cron ne fait que des
  notifications et du nettoyage cosmétique de `status`.

## 6. Modèle de données (Postgres)

> Toutes les tables sont protégées par **RLS**. Les coordonnées précises ne sortent jamais via
> les API ; seule une distance calculée est exposée par la RPC du deck.

### `genders` (table de référence configurable)
- `id`, `key` (slug stable), `label`, `is_active`, `sort_order`.
- **La liste des genres n'est jamais figée dans le code ni dans un enum Postgres** : la faire
  évoluer = insérer/désactiver une ligne, sans migration de schéma. Le front charge la liste
  depuis cette table.

### `profiles` (1:1 avec `auth.users`)
- `id` (uuid, FK `auth.users`), `display_name`, `birthdate` (date, 18+), `gender_id` (FK `genders`),
  `bio` (text), `location` (`geography(Point)`), `last_active_at`, `created_at`.

### `profile_photos`
- `id`, `profile_id` (FK), `storage_path`, `position` (int 0–5), `created_at`.
- Au moins 1 photo requise pour qu'un profil soit servi dans le deck.

### `preferences`
- `profile_id` (PK, FK), `age_min`, `age_max`, `max_distance_km`.

### `preference_genders` (genres recherchés, M:N)
- `profile_id` (FK), `gender_id` (FK `genders`). PK composite.
- Permet de chercher plusieurs genres sans enum ni colonne figée.

### `swipes`
- `id`, `swiper_id` (FK), `swipee_id` (FK), `direction` (enum `like`/`pass`), `created_at`.
- Unique `(swiper_id, swipee_id)`. Sert au calcul de match et à l'exclusion du deck.

### `matches`
- `id`, `user_a` (FK), `user_b` (FK) — **paire ordonnée** (`user_a < user_b`) pour dédoublonner,
  `created_at`, **`expires_at`**, `last_message_at`, `status` (enum `active`/`expired`),
  `notified_expiring` (bool), `notified_expired` (bool).
- **Index unique partiel** sur `(user_a, user_b) WHERE status = 'active'` → un seul match actif
  par paire, re-match futur autorisé.

### `messages`
- `id`, `match_id` (FK), `sender_id` (FK), `body` (text), `created_at`.

### `push_tokens`
- `id`, `user_id` (FK), `expo_token`, `platform`, `updated_at`.

### `blocks`
- `id`, `blocker_id` (FK), `blocked_id` (FK), `created_at`.

### `reports`
- `id`, `reporter_id` (FK), `reported_id` (FK), `reason` (text), `match_id` (FK, nullable),
  `created_at`. Stockés pour modération ultérieure.

### Index chauds
- GIST sur `profiles.location` (PostGIS).
- `swipes (swiper_id, created_at)` pour le quota quotidien.
- partiel `matches (expires_at) WHERE status = 'active'` pour le cron.
- `messages (match_id, created_at)` pour la pagination du chat.

## 7. Logique métier (triggers / RPC)

- **Trigger** sur insert `swipes` (`direction = like`) : si le like réciproque existe, crée le
  match (`expires_at = now() + 60 min`). Atomique.
- **Trigger** sur insert `messages` : `expires_at = now() + 60 min`, `last_message_at = now()`.
- **Policy RLS + trigger** sur `messages` : refus d'insert si `now() > expires_at` ou match
  non `active`.
- **RPC `get_deck(limit, cursor)`** : profils correspondant à mes préférences (genre, âge), dans
  mon rayon (`ST_DWithin`), **filtrage bidirectionnel léger** (l'autre me cherche aussi), hors
  profils déjà swipés, hors moi-même, **hors paires bloquées (dans les deux sens)**, triés par
  proximité, paginés en curseur. Renvoie une **distance**, jamais les coordonnées.
- **Quota likes/jour** : compté depuis `swipes` (requête indexée). **Défaut : 20/jour**, valeur
  **configurable** (param serveur), non figée dans le code.
- **Rewind** : suppression du dernier swipe → le profil réapparaît dans le deck.
- **Block** : exclusion bidirectionnelle du deck + fin immédiate de tout match actif entre les
  deux (passage en archivé/verrouillé).
- **Report** : enregistre le report (+ option de bloquer dans la foulée). Aucune action
  automatique en v1.

## 8. Écrans (Expo Router)

- `(auth)` : login, inscription (email + Apple + Google).
- `(onboarding)` : profil → photos → préférences.
- `(tabs)` :
  - **Deck** (swipe via `rn-swiper-list`),
  - **Matchs** (liste : matchs actifs avec **timer en évidence** + matchs archivés),
  - **Profil / Réglages**.
- `match/[id]` : chat temps réel avec **compte à rebours visible** (calculé depuis `expires_at`).

### UI sécurité (discrète)
- Menu **« ⋯ »** dans l'en-tête du chat et sur le détail d'un profil → feuille d'action sobre
  *Bloquer / Signaler*. Rien sur la carte de swipe.

## 9. Temps réel

- Abonnement Realtime sur `messages` filtré par `match_id` (chat).
- Abonnement Realtime sur `matches` (apparition d'un nouveau match, passage en « expiré ») sans
  rafraîchissement manuel.

## 10. Notifications push

- **Expo Push Notifications**. Tokens stockés dans `push_tokens`.
- Déclenchées par : nouveau match, nouveau message, alerte « 10 min restantes » (via le cron).
- Envoi depuis une **Edge Function** appelant l'API push Expo.

## 11. Stratégie de test (TDD)

- **Priorité : le moteur d'expiration.** Tests SQL (**pgTAP**) sur les triggers, la RLS, le refus
  d'envoi après expiration, et l'**idempotence** des notifications.
- Logique front pure (formatage du timer, hooks de filtrage / quota) : **Jest + React Native
  Testing Library**.
- E2E (Maestro / Detox) : **post-MVP**.

## 12. Risques & points d'attention

- **Apple App Store** exige block/report pour publier du contenu généré par les utilisateurs :
  couvert dès la v1.
- **Précision géoloc / vie privée** : ne jamais exposer les coordonnées ; distance arrondie.
- **Permissions** : localisation et notifications à demander proprement (UX de permission).
- **Coût du cron** : 1 exécution/min ; requêtes indexées pour rester négligeable à grande échelle.
- **Apple Sign-In obligatoire** dès qu'on propose Google/Apple login sur iOS.
