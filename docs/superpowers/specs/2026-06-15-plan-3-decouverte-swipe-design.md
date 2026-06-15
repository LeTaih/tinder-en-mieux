# Plan 3 — Découverte & Swipe — Spec de conception

Date : 2026-06-15
Statut : validé en brainstorming, en attente de relecture utilisateur
Spec parent : `docs/superpowers/specs/2026-06-15-tinder-en-mieux-mvp-design.md`

## 1. Objectif

Afficher un **deck de profils filtrés** (géolocalisation + préférences) que l'utilisateur swipe
(like/pass), en **enregistrant les swipes** côté serveur avec un **quota de likes autoritatif** et
un **rewind**. Exigence transverse maintenue : **sécurité / anti-scraping**. **Aucun match n'est
créé dans ce plan** — la détection de match mutuel, l'écran « It's a match », le timer 1h et le chat
arrivent au **Plan 4** (avec le moteur d'expiration, pour garder tout le cycle de vie au même endroit).

## 2. Périmètre

### Inclus
- Deck de cartes via **`rn-swiper-list`** (3.0.0, compatible reanimated 4 / worklets déjà installés).
- File de candidats filtrée : préférences (genre, âge, distance) + **filtrage bidirectionnel**,
  profil complet, hors profils déjà swipés, hors soi-même. Tri par proximité, pagination ~10.
- Swipe **like / pass** enregistré ; **quota de 20 likes/jour** (pass illimités), vérifié en base.
- **Rewind** : annuler le dernier swipe (1 pas, illimité).
- Compteur de likes restants ; état vide (« plus de profils »).

### Hors périmètre (plans suivants / YAGNI)
- Matchs, « It's a match », timer, chat (Plan 4).
- Superlike, plafond quotidien de profils servis, carrousel photo avancé, bloquer/signaler (Plan 7).

## 3. Architecture du deck (sécurisée)

Deux couches, pour que le deck soit l'**unique surface contrôlée** d'exposition des autres profils :

1. **Fonction SQL `deck_candidates(p_limit int, p_offset int)`** — `SECURITY DEFINER` (lit les
   profils d'autrui en contournant la RLS, de façon maîtrisée). Utilise `auth.uid()` (donc appelée
   avec le JWT de l'utilisateur). Logique :
   - lit mes `preferences` (genres recherchés, âge min/max, distance max) et ma `location` ;
   - sélectionne les `profiles` candidats : `id <> auth.uid()`, profil **complet** (location non
     nulle, ≥ 1 photo, préférences présentes), `gender_id` ∈ mes genres recherchés, **âge dans ma
     tranche**, **distance ≤ ma distance max** (`ST_DWithin` sur `geography`) ; **bidirectionnel** :
     mon `gender_id` ∈ les genres recherchés du candidat et mon âge dans sa tranche ; hors profils
     déjà présents dans `swipes` pour moi ;
   - tri par distance croissante, `limit/offset` ;
   - **renvoie** : `id`, `display_name`, **`age`** (calculé, jamais `birthdate`), **`distance_km`**
     (arrondi, jamais les coordonnées), `bio`, `photo_paths text[]` (ordonnés — usage interne, signés
     par l'Edge Function).

2. **Edge Function `get-deck`** (Deno) — porte d'entrée unique du deck :
   - client **scopé utilisateur** (forwarde l'`Authorization` reçu) pour appeler `deck_candidates`
     (donc `auth.uid()` est correct) ;
   - client **service** pour **signer** les `photo_paths` (`createSignedUrl`, TTL court) ;
   - renvoie les candidats avec **uniquement** : `id`, `display_name`, `age`, `distance_km`, `bio`,
     `photos: string[]` (URLs signées). **Jamais** de coordonnées, date de naissance, ni chemins.
   - paramètres `limit` (défaut 10) / `offset` (pagination).

## 4. Données & logique serveur (migrations SQL)

### `swipes`
- `id` uuid pk, `swiper_id` uuid fk → `profiles(id)` on delete cascade, `swipee_id` uuid fk →
  `profiles(id)` on delete cascade, `direction` text check in (`like`,`pass`), `created_at` timestamptz.
- Unique `(swiper_id, swipee_id)`. Index `(swiper_id, created_at)` (quota). RLS « propre ligne »
  (`auth.uid() = swiper_id`) en select/insert/update/delete.

### RPC `record_swipe(p_target uuid, p_direction text)` — `SECURITY INVOKER`
- Si `p_direction = 'like'` : **refuse** (`raise exception 'QUOTA_EXCEEDED'`) si l'utilisateur a déjà
  **≥ 20 likes** depuis `date_trunc('day', now())`.
- Insère le swipe ; `on conflict (swiper_id, swipee_id) do update` (re-swipe après rewind).
- Quota de 20 = constante dans la fonction (point unique de configuration ; documenté).

### RPC `rewind_last_swipe()` — `SECURITY INVOKER`
- Supprime le swipe le plus récent de l'utilisateur et **renvoie le `swipee_id`** (pour réafficher
  le profil côté client). RLS garantit qu'on n'agit que sur ses propres swipes.

### RPC `likes_remaining_today()` — `SECURITY INVOKER`
- Renvoie `20 - (likes du jour)` (≥ 0), pour le compteur client.

## 5. Client

Feature `src/features/deck/` :
- `deck-api.ts` : `fetchDeck(limit, offset)` (invoque l'Edge Function `get-deck`), `recordSwipe`,
  `rewindLastSwipe`, `likesRemaining` (RPC).
- Types : `DeckCandidate = { id; display_name; age; distance_km; bio; photos: string[] }`.
- Hooks : `useDeck` (chargement + pagination), `useSwipe` (mutation + invalidation du compteur),
  `useRewind`, `useLikesRemaining`.
- `deck-format.ts` (pur, testé) : libellés (« à 3 km », « 24 ans »), calcul du compteur restant.
- Écran **Deck** (`app/(tabs)/index.tsx`) : pile `rn-swiper-list` (carte = photo principale +
  **tap pour faire défiler les photos** + prénom/âge + distance + bio), boutons **like / pass /
  rewind**, **compteur de likes restants**, état vide, état « quota atteint ».

## 6. Sécurité / anti-scraping
- Deck servi **exclusivement** par l'Edge Function : URLs signées à TTL court, **aucune** coordonnée
  brute, date de naissance ni chemin de stockage renvoyés.
- **Quota likes en base** (`record_swipe`) → incontournable même si le client est trafiqué.
- `swipes` en RLS « propre ligne ». `deck_candidates` ne renvoie que des champs sûrs.
- Pagination par lots (~10). *Limite connue* : pas de plafond quotidien de profils servis dans ce
  plan (le quota de likes bride l'usage) — un plafond reste ajoutable ultérieurement (documenté).

## 7. Migrations & déploiement (contrainte Docker)
Docker indisponible en session → la migration (`swipes` + RPC) **et** l'Edge Function sont écrites,
non exécutées localement. Le développeur les déploie au cloud :
`supabase db push` puis `supabase functions deploy get-deck`, puis `npm run db:types`. Procédure
guidée à l'implémentation. `database.ts` reste cohérent (miroir manuel mis à jour, régénéré ensuite).

## 8. Stratégie de test
- **Logique pure en TDD** : `deck-format.ts` (libellés distance/âge, compteur restant), mapping des
  candidats. Réutilise `ageFromBirthdate` existant si utile côté tests.
- Tests de composants légers (RNTL) pour l'écran Deck : rendu d'une carte, bouton like désactivé
  quand quota atteint, état vide. **Hors `app/`** (les tests d'écran vivent dans `src/`, cf. leçon
  Plan 2 : Expo Router scanne `app/`).
- SQL (RLS, quota, rewind) et Edge Function vérifiés **côté cloud** (Docker indispo) ; pgTAP à
  automatiser quand un environnement Docker sera disponible.

## 9. Risques & points d'attention
- **`rn-swiper-list` 3.0.0** : compatible (peer deps `*` ; reanimated 4.3.1 / gesture-handler 2.31.1
  / worklets 0.8.3 déjà présents). Nécessite `GestureHandlerRootView` à la racine — à vérifier/poser.
- **Edge Function** : nouvelle techno (Deno) + déploiement ; secrets (URL, anon, service role) via
  les variables d'environnement de la fonction côté Supabase, jamais commitées.
- **Fuseau horaire du quota** : `date_trunc('day', now())` en UTC — acceptable pour le MVP.
- **Deck vide en test** : tant qu'il n'y a qu'un seul profil (le tien), le deck sera vide ; pour
  tester réellement il faudra ≥ 2 comptes avec profils complets et préférences compatibles, proches
  géographiquement.
