# Plan 4 — Matching & Moteur d'expiration — Spec de conception

Date : 2026-06-15
Statut : validé en brainstorming, en attente de relecture utilisateur
Spec parent : `docs/superpowers/specs/2026-06-15-tinder-en-mieux-mvp-design.md`

## 1. Objectif

Implémenter **le différenciateur du produit** : sur un **like mutuel**, créer un **match** doté d'un
**timer d'1 heure autoritatif côté serveur** ; annoncer le match (modale « It's a match »), lister les
matchs avec un **compte à rebours**, et faire passer un match en **archivé** à l'expiration.

## 2. Périmètre

### Inclus
- Détection du **like mutuel** et **création du match** côté serveur (fonction de confiance).
- **Timer 1h** : `expires_at = now() + 60 min` à la création ; autorité = `expires_at` en base.
- **Modale « It's a match »** instantanée pour celui qui déclenche le match.
- **Onglet Matchs** : matchs **actifs** (photo, prénom, **compte à rebours**) + matchs **archivés**.
- **Re-match** : après expiration, un nouveau match peut être créé pour la même paire.

### Hors périmètre (plans suivants)
- **Messages, reset du timer à chaque message, lecture seule du chat, chat temps réel** → **Plan 5**.
- **Cron + push « 10 min restantes » + bascule de `status` stockée** → **Plan 6**.
- Bloquer / signaler → Plan 7.

## 3. Création du match (sécurisée)

La RPC existante **`record_swipe`** (Plan 3) évolue : elle passe en **`SECURITY DEFINER`** et, en plus
d'enregistrer le swipe et de gérer le quota, **crée le match** quand un `like` rend le like réciproque.

- À la création : `expires_at = now() + interval '60 minutes'`. Paire stockée **ordonnée**
  (`user_a` = plus petit uuid, `user_b` = plus grand) pour dédoublonner et conserver l'historique.
- **Garde re-match** : la création est refusée s'il existe déjà un match **actif** (`expires_at >
  now()`) pour la paire. Après expiration, un nouveau match repart (nouveau timer).
- **Retour enrichi** (JSON) : `{ likes_remaining: int, matched: boolean, match_id: uuid | null }`.
- **Sécurité** : les matchs ne sont **jamais insérables directement par le client** (aucune policy
  d'insert sur `matches`). Ils ne naissent que via cette fonction de confiance, après vérification du
  like mutuel → **impossible de fabriquer de faux matchs**. `record_swipe` reste cantonnée à
  `auth.uid()` (le swiper) même en `SECURITY DEFINER`.

## 4. Modèle de données

### `matches`
- `id` uuid pk, `user_a` uuid (fk `profiles`), `user_b` uuid (fk `profiles`), `created_at` timestamptz,
  **`expires_at` timestamptz**. Contrainte `user_a <> user_b` et `user_a < user_b` (paire ordonnée).
- Index sur `(user_a)` et `(user_b)` pour les recherches de matchs d'un utilisateur ; index partiel
  utile sur `expires_at`.
- **RLS** : `select` réservé aux participants (`auth.uid() = user_a OR auth.uid() = user_b`).
  **Aucune** policy `insert`/`update`/`delete` pour `authenticated` → écriture exclusivement via la
  fonction `SECURITY DEFINER`.

> `status`/`notified_*` (Plan 6) et `last_message_at` (Plan 5) ne sont **pas** créés ici : en Plan 4,
> `expires_at` est l'unique source de vérité.

## 5. Modèle d'expiration

**Source de vérité unique = `expires_at`.** Un match est **actif** si `expires_at > now()`,
**archivé** sinon — **dérivé à la lecture**, sans cron en Plan 4. Le compte à rebours client est
**cosmétique** (affichage) ; toute décision d'autorité s'appuie sur `expires_at` côté serveur.
(La lecture seule effective du chat à l'expiration sera imposée au Plan 5 ; le cron du push « 10 min »
au Plan 6.)

## 6. Liste des matchs (sécurisée)

La photo de l'autre participant est dans le **bucket privé** → même schéma que le deck :
- **Fonction SQL `my_matches(p_user uuid)`** (`SECURITY DEFINER`, réservée au rôle service) : renvoie,
  pour chaque match de l'utilisateur, `match_id`, l'**autre** participant (`other_id`, `display_name`,
  **1ʳᵉ photo `photo_path`**), `expires_at`, et un booléen `is_active` (`expires_at > now()`).
- **Edge Function `get-matches`** : vérifie le JWT (`getUser`), appelle `my_matches`, **signe** la
  photo (URL courte), ne renvoie que des champs sûrs (jamais de chemin ni de coordonnée).
- **Onglet Matchs** : section « Actifs » (photo, prénom, **compte à rebours**, tri par expiration la
  plus proche) + section « Expirés » (archivés, grisés). Tap sur un match → écran chat (Plan 5 ;
  placeholder d'ici là).

## 7. Modale « It's a match »

Déclenchée côté client quand `record_swipe` renvoie `matched = true` : modale plein écran (les deux
photos, « Voir le match » → onglet Matchs, « Continuer à swiper »). Invalide la requête des matchs.
L'autre utilisateur découvre le match dans sa liste (push au Plan 6). La photo de l'autre pour la
modale provient de la liste des matchs (`get-matches`) rafraîchie.

## 8. Compte à rebours

Helper **pur, testé** `formatCountdown(expiresAtISO, now)` → `"59:32"`, et état `"Expiré"` si
`expires_at <= now`. Côté écran, un tick à la seconde recalcule l'affichage à partir de `expires_at`
(jamais de compteur dérivant indépendamment de la base).

## 9. Architecture client

Feature `src/features/matches/` :
- `matches-api.ts` : `fetchMatches()` (invoque `get-matches`) ; type `Match = { match_id; other_id;
  display_name; photo: string | null; expires_at: string; is_active: boolean }`.
- `countdown.ts` (pur) : `formatCountdown`, `isExpired`.
- `use-matches.ts` : `useMatches` (TanStack Query).
- `MatchModal.tsx` : modale « It's a match ».
- Écran : `app/(tabs)/matches.tsx` (remplace le placeholder) — sections actifs/expirés + compte à
  rebours qui ticke.
- Déclenchement de la modale : `app/(tabs)/index.tsx` (deck) consomme le retour enrichi de
  `record_swipe` (`matched`, `match_id`) via `useSwipe`.

## 10. Sécurité / anti-abus
- **Aucune écriture client sur `matches`** ; création uniquement par `record_swipe` (`SECURITY
  DEFINER`) après vérification du like mutuel → pas de faux matchs.
- **RLS participants** en lecture sur `matches`.
- **Photos via Edge Function signée** (URL courte), jamais de chemin exposé. `my_matches` réservée au
  rôle service (`revoke … from authenticated`).
- `record_swipe` conserve le quota de likes autoritatif et n'agit que pour `auth.uid()`.

## 11. Migrations & déploiement (contrainte Docker)
Docker indisponible → SQL (table `matches`, `record_swipe` remplacée, `my_matches`) écrit en
migration et **appliqué par le développeur via le SQL Editor** (le projet ayant été initialisé ainsi),
puis **déploiement de l'Edge Function `get-matches`** et régénération des types (`npm run db:types`).
Procédure guidée à l'implémentation.

## 12. Stratégie de test
- **TDD** sur `countdown.ts` (formatage mm:ss, état expiré, bornes).
- Logique pure de détection / mapping testée si extractible.
- SQL (création de match, garde re-match, RLS) et Edge Function vérifiés **côté cloud** (Docker
  indispo). Idéalement pgTAP plus tard.
- Tests de composants légers (RNTL) pour `MatchModal` (rendu) si faisable hors `app/`.

## 13. Risques & points d'attention
- **Deux profils de test** nécessaires pour matcher (déjà créés au Plan 3) ; pour tester l'expiration
  sans attendre 1 h, prévoir une requête SQL de dev pour avancer `expires_at` (documentée à l'impl).
- **Découverte du match par le 2ᵉ utilisateur** : sans temps réel ni push en Plan 4, il le voit au
  prochain rafraîchissement de sa liste (temps réel/push aux Plans 5/6).
- **`record_swipe` en `SECURITY DEFINER`** : bien garder toutes les écritures cantonnées à
  `auth.uid()` et au like mutuel vérifié ; ne pas introduire de chemin permettant d'agir pour autrui.
- **Re-match** : la garde « match actif existant » doit s'appuyer sur `expires_at > now()`, pas sur un
  statut stocké (absent en Plan 4).
