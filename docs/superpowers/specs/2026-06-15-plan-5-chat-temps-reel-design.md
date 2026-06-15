# Plan 5 — Chat temps réel — Spec de conception

Date : 2026-06-15
Statut : validé en brainstorming, en attente de relecture utilisateur
Spec parent : `docs/superpowers/specs/2026-06-15-tinder-en-mieux-mvp-design.md`
Plan précédent : `docs/superpowers/specs/2026-06-15-plan-4-matching-expiration-design.md`

## 1. Objectif

Permettre à deux personnes matchées d'échanger des **messages texte et photo en temps réel**, avec
**reset du timer 1 h à chaque message** (le cœur du produit), **lecture seule à l'expiration**
(conversation archivée consultable) et un **compte à rebours vivant** dans l'écran de chat.

## 2. Périmètre

### Inclus
- Écran de chat (`app/match/[id].tsx`) atteint en tapant un match.
- Messages **texte** et **photo** (un message est soit du texte, soit une image).
- **Reset du timer** : chaque message ramène `expires_at` à `now() + 60 min`.
- **Temps réel** : les nouveaux messages apparaissent en direct chez les deux participants.
- **Compte à rebours vivant** : remonte visiblement à 60:00 quand l'un écrit.
- **Lecture seule à l'expiration** imposée côté serveur ; conversation **archivée consultable**.

### Hors périmètre
- Indicateurs de frappe, accusés de lecture → exclus (YAGNI, choix utilisateur).
- Push « 10 min restantes » + cron + bascule de statut stockée → **Plan 6**.
- Bloquer / signaler → **Plan 7**.
- Vocaux, GIF, réactions, édition / suppression de message.

## 3. Décision build-vs-buy (pourquoi pas un module de chat clé en main)

- **Backend de chat SaaS (Stream / Sendbird / Firebase) : écarté.** Héberger les messages hors de
  Postgres briserait le différenciateur (le timer 1 h est un mécanisme Postgres), sortirait les
  messages de notre RLS (perte du modèle anti-scrap et de la lecture-seule-à-l'expiration imposée en
  base) et ajouterait un coût au MAU + un 2ᵉ fournisseur + une synchro des comptes. Le **chat éphémère
  EST le produit**, pas une fonctionnalité annexe.
- **Kit d'UI clé en main (`react-native-gifted-chat`) : écarté pour la v1.** Pertinent sur le principe
  (couche visuelle branchée sur notre Realtime), mais grosse dépendance avec un **risque de compat non
  confirmé** sur Expo SDK 56 / RN 0.85 / React 19 / New Architecture. Notre chat minimal (texte+photo,
  sans typing/accusés) tient en 1 écran + 2 petits composants.
- **Retenu : backend Supabase + UI custom légère.** Tout le temps réel et la sécurité restent dans
  notre stack ; l'UI est petite, sans nouvelle dépendance, sans risque de compat.

## 4. Modèle de données

### Table `messages`
- `id uuid pk`, `match_id uuid not null` (fk `matches(id)` `on delete cascade`),
  `sender_id uuid not null` (fk `profiles(id)`), `body text` (nullable), `image_path text` (nullable),
  `created_at timestamptz not null default now()`.
- Contrainte **XOR** : exactement un de `body` / `image_path` renseigné.
- Index `(match_id, created_at)` pour charger l'historique trié et filtrer le temps réel.
- **RLS** : `select` réservé aux **participants** du match (actif **ou** expiré → archive consultable).
  **Aucune** policy `insert` / `update` / `delete` pour `authenticated` → les messages ne sont écrits
  **que** par la fonction de confiance `send_message` (cf. §5). Messages **immuables**.

### Table `matches` (existante) — ajout
- `last_message_at timestamptz` (nullable) : horodatage du dernier message, pour trier les matchs par
  activité récente. (`status` / `notified_*` restent au Plan 6.)

## 5. Envoi de message (sécurisé, serveur-autoritaire)

Conforme au pattern du projet (toutes les écritures passent par des fonctions de confiance :
`record_swipe`, `set_my_location`, `set_my_preferences`).

**RPC `send_message(p_match_id uuid, p_body text, p_image_path text)` — `SECURITY DEFINER`,
`search_path` figé (`set search_path = public, pg_temp`) :**
1. Vérifie que `auth.uid()` est **participant** du `p_match_id`.
2. Vérifie que le match est **actif** (`expires_at > now()`) — sinon lève `MATCH_EXPIRED` ⇒ **lecture
   seule à l'expiration garantie en base**.
3. Vérifie le **XOR** texte/image (exactement un fourni) ; si image, valide que `p_image_path` est bien
   sous le dossier `p_match_id/`.
4. **Insère** le message (`sender_id = auth.uid()`).
5. **Reset du timer** : `update matches set expires_at = now() + interval '60 minutes',
   last_message_at = now() where id = p_match_id`.
6. Renvoie la ligne insérée (`id, match_id, sender_id, body, image_path, created_at`) pour un **rendu
   optimiste** côté émetteur.

`revoke execute … from public/anon`, `grant execute to authenticated`. La fonction est **cantonnée à
`auth.uid()`** (jamais d'envoi pour autrui).

> **Alternative considérée** : insert client direct (policy RLS `with check` participant + actif +
> `sender_id = auth.uid()`) + trigger `AFTER INSERT` `SECURITY DEFINER` qui reset le timer. Rejetée au
> profit de la RPC pour rester homogène avec le reste du code (écritures via fonctions de confiance) et
> centraliser insert + reset de façon atomique dans une seule fonction de confiance.

## 6. Photos du chat (bucket privé `chat-media`)
- Bucket **privé** `chat-media`, chemin `{match_id}/{uuid}.jpg`.
- **RLS Storage par participation** :
  - `select` (lire / signer) si **participant** du match du dossier (`(storage.foldername(name))[1]` =
    `match_id`, et l'utilisateur est `user_a` ou `user_b` de ce match).
  - `insert` (upload) si **participant ET match actif** (`expires_at > now()`).
  - pas d'`update` / `delete` (médias non modifiables).
- **Le client signe lui-même** les URLs (URL courte ~120 s) — **pas d'Edge Function** : contrairement
  au deck, ici **les deux** participants ont légitimement le droit de lire, donc la RLS Storage suffit.
- Flux d'envoi d'image : choisir (galerie/caméra) → compresser (`expo-image-manipulator`) → upload dans
  `chat-media/{match_id}/…` → `send_message(p_match_id, null, p_image_path)`.

## 7. Temps réel
- **Supabase Realtime `postgres_changes`** (event `INSERT`, table `public.messages`,
  `filter: match_id=eq.<id>`). La table est ajoutée à la publication `supabase_realtime`.
- La **RLS `select`** gouverne la diffusion : seuls les participants reçoivent les événements.
- À réception d'un `INSERT`, le client **ajoute** le message à la liste (**dé-dupliqué par `id`** pour
  ne pas doubler le rendu optimiste de l'émetteur) et **recale** le compte à rebours.
- Recommandé vs Broadcast : plus simple, déjà RLS-aware, source unique = la table `messages`.

## 8. Compte à rebours vivant
- Réutilise `formatCountdown(expiresAtISO, now)` / `isExpired` (déjà testés,
  `src/features/matches/countdown.ts`).
- L'écran initialise `expires_at` depuis le match, puis **à chaque message reçu**, recale
  `expires_at = created_at_du_message + 60 min` (exactement ce que fait la RPC) → le compteur **remonte
  à 60:00** visiblement quand l'un écrit.
- Un tick à la seconde rafraîchit l'affichage. Sous 10 min : compteur en **rouge** (le push viendra au
  Plan 6).
- À l'expiration (`isExpired`), bascule en **lecture seule** : barre de saisie remplacée par un bandeau
  « Ce match a expiré ».

## 9. Écran de chat `app/match/[id].tsx`
- **En-tête** : prénom de l'autre + **compte à rebours** (ou « Expiré »).
- **Liste** : `FlatList` inversée de bulles ; bulle **texte** (alignée selon `sender_id == moi`) ou
  bulle **image** (rendue via URL signée `chat-media`). Tri par `created_at`.
- **Saisie** (si actif) : champ texte + bouton **📎** (galerie/caméra) + **Envoyer**. Désactivée
  pendant l'envoi.
- **Expiré** : pas de saisie, bandeau « Ce match a expiré » ; messages consultables.
- **Navigation** : tap sur un match dans l'onglet Matchs (`app/(tabs)/matches.tsx`) et bouton « Voir le
  match » de `MatchModal` → `router.push('/match/<id>')`. Route racine (hors `(tabs)`) empilée par-dessus
  les onglets.

## 10. Architecture client
Feature `src/features/chat/` :
- `chat-api.ts` : `fetchMessages(matchId)` (SELECT participant), `sendText(matchId, body)` /
  `sendImage(matchId, localUri)` (upload + `send_message`), `signedChatImageUrl(path)`. Type
  `Message = { id; match_id; sender_id; body: string | null; image_path: string | null; created_at }`.
- `use-chat.ts` : `useMessages(matchId)` (query + abonnement Realtime qui append + dédupe),
  `useSendMessage(matchId)` (mutation, rendu optimiste), dérivation d'`expires_at` vivant.
- `chat-format.ts` (pur, testé) : `expiresAtFromMessage(createdAtISO)`, classification XOR
  texte/image, tri + dé-duplication par `id` de la liste.
- `MessageBubble.tsx` : bulle texte / image (signe l'image à l'affichage).
- `ChatInput.tsx` : barre de saisie (texte + photo).
- `app/match/[id].tsx` : écran (compose les ci-dessus, en-tête compte à rebours, bandeau expiré).
- Navigation depuis `matches.tsx` + `MatchModal.tsx`.

## 11. Sécurité / anti-abus
- **Aucune écriture client directe** sur `messages` (comme `matches`) : tout passe par `send_message`
  (`SECURITY DEFINER`, cantonnée à `auth.uid()`, match actif vérifié).
- **Lecture seule à l'expiration** garantie en base (la RPC refuse après `expires_at`).
- **RLS `select` participants** sur `messages` (pas de lecture globale) ; gouverne aussi la diffusion
  temps réel.
- **`chat-media` privé**, RLS par participation, **URLs signées courtes**, jamais de chemin durable
  exposé ; upload restreint au dossier du match et au match actif.
- `messages` **immuables** (pas d'`update` / `delete`) ; XOR texte/image et appartenance du chemin
  image validés côté serveur.

## 12. Migrations & déploiement (contrainte Docker)
Docker indisponible → tout le SQL est écrit en migration et **appliqué par le dev via le SQL Editor**
(le projet ayant été initialisé ainsi) :
1. `alter table public.matches add column last_message_at timestamptz`.
2. Table `messages` + index `(match_id, created_at)` + RLS (`select` participant ; **pas** d'insert /
   update / delete).
3. RPC `send_message` (`SECURITY DEFINER`, search_path figé) + `revoke` public/anon + `grant` execute à
   `authenticated`.
4. Bucket `chat-media` (privé) + policies Storage (participation, + match actif à l'upload).
5. `alter publication supabase_realtime add table public.messages` + s'assurer que Realtime est activé
   pour la table dans le dashboard.

Puis **régénérer les types** (`npm run db:types`) — `send_message` sera typée `Json` côté retour, à
mapper côté client. **Aucune nouvelle Edge Function.**

## 13. Stratégie de test
- **TDD** sur la logique pure (`chat-format.ts`) :
  - `expiresAtFromMessage(createdAtISO)` = `created_at + 60 min` ;
  - classification / validation XOR texte-image ;
  - tri par `created_at` + **dé-duplication par `id`** de la liste de messages.
- `formatCountdown` / `isExpired` déjà couverts (réutilisés).
- Composants légers (`MessageBubble` texte/image, `ChatInput`) en RNTL, **hors `app/`** (les tests
  vivent dans `src/`, sinon Expo Router les scanne comme routes et casse le bundle).
- RLS, `send_message` (participant / actif / XOR), Storage et temps réel **vérifiés côté cloud** (Docker
  indispo) ; pgTAP envisagé plus tard.

## 14. Risques & points d'attention
- **Deux profils matchés** nécessaires pour tester (créés aux Plans 3-4) ; pour tester la lecture seule
  sans attendre 1 h, forcer `expires_at` dans le passé via SQL (documenté à l'impl) puis vérifier que
  `send_message` lève `MATCH_EXPIRED`.
- **Réception temps réel** : bien filtrer par `match_id` et **dédupliquer par `id`** (rendu optimiste de
  l'émetteur + écho Realtime).
- **Image orpheline** : si l'upload réussit mais `send_message` échoue (match expiré entre-temps),
  l'image reste dans le bucket sans message — bénin ; nettoyage différé (plan ultérieur).
- **Re-match** : un nouveau match = un nouveau `matches.id` → nouvelle conversation ; l'ancienne reste
  consultable séparément (archive, déjà prévu par le modèle de données).
- **`send_message` en `SECURITY DEFINER`** : garder toutes les écritures cantonnées à `auth.uid()` et au
  match actif vérifié ; ne pas introduire de chemin agissant pour autrui.
- **Realtime + RLS** : la table DOIT être dans `supabase_realtime` ET avoir la RLS activée pour que la
  diffusion soit restreinte aux participants.
