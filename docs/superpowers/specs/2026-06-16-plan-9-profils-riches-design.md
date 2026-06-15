# Plan 9 — Profils plus riches — Spec de conception

Date : 2026-06-16
Statut : validé en brainstorming, en attente de relecture utilisateur
Spec parent : `docs/superpowers/specs/2026-06-15-tinder-en-mieux-mvp-design.md`
Plan précédent : `docs/superpowers/specs/2026-06-16-plan-8-polish-qa-design.md`

## 1. Objectif

Enrichir les profils pour des matchs plus qualitatifs et une carte/vue de profil plus vivante :
**centres d'intérêt (tags)**, **champs structurés** (métier, études, taille), **prompts façon Hinge**
(question prédéfinie + réponse courte), et une **vue détaillée du profil**. Saisie à la fois pendant
l'onboarding (étape légère et optionnelle) et via un nouvel **écran d'édition du profil**.

## 2. Périmètre

### Inclus
- **Centres d'intérêt** : catalogue prédéfini, l'utilisateur en choisit jusqu'à 5.
- **Champs structurés** : `métier`, `études`, `taille` (tous optionnels).
- **Prompts** : catalogue de questions prédéfinies, l'utilisateur en choisit jusqu'à 3 et y répond.
- **Vue détaillée du profil** : toutes les photos + toutes les infos riches.
- **Écran « Éditer le profil »** (depuis l'onglet Profil).
- **Étape onboarding optionnelle** : choix des intérêts (skippable).
- Diffusion des champs riches d'autrui via `deck_candidates` / `my_matches` (modèle definer existant).

### Hors périmètre (YAGNI v1)
- Filtrage/recherche par intérêt (les données sont posées pour plus tard, mais pas de filtre).
- Modération in-app des textes libres (réponses de prompts) — différée, cohérent avec les reports.
- Tags en texte libre, langues parlées, signe astro, etc. (écartés au brainstorming).
- Réorganisation des photos par glisser-déposer (la gestion actuelle add/suppr suffit).

## 3. Décision d'architecture : diffusion inline (Approche A)

`profiles` est en **lecture propre-ligne** ; les champs riches d'autrui ne sortent que par des fonctions
`SECURITY DEFINER`. On **enrichit `deck_candidates` et `my_matches`** pour renvoyer les champs riches
**avec** chaque candidat/match. La vue détaillée s'affiche depuis l'objet **déjà chargé** (cache deck ou
matchs) — aucun nouvel appel, aucune nouvelle surface d'autorisation.

> **Alternatives écartées** : RPC `profile_detail(target)` à la demande (oblige à réimplémenter
> l'autorisation « candidat légitime ? » → risque d'énumération) ; assouplir la RLS pour lire des champs
> publics de tous (viole l'anti-scrap : on ne doit pas pouvoir énumérer les profils).

## 4. Modèle de données (migration `plan9`)

### Catalogues (lecture authentifiée, comme `genders`)
- **`interests`** : `id uuid pk`, `key text unique`, `label text`, `is_active bool default true`,
  `sort_order int`. Seed ~20 entrées (Sport, Musique, Voyage, Cuisine, Cinéma, Jeux vidéo, Lecture, Art,
  Nature, Animaux, Sorties, Fitness, Photographie, Danse, Tech, Mode, Café, Vin, Yoga, Festivals). RLS
  select `authenticated`.
- **`prompts`** : `id uuid pk`, `key text unique`, `question text`, `is_active bool default true`,
  `sort_order int`. Seed ~10 questions (ex. « Le dimanche idéal… », « On matche si… », « Ma passion
  inavouable… »). RLS select `authenticated`.

### Données de profil (écriture propre-ligne)
- **`profile_interests`** : `profile_id uuid fk profiles`, `interest_id uuid fk interests`,
  `primary key (profile_id, interest_id)`. RLS own-row (select/insert/delete où `profile_id = auth.uid()`).
  Limite « ≤ 5 » garantie côté RPC (et trigger de garde).
- **`profile_prompts`** : `id uuid pk`, `profile_id uuid fk profiles`, `prompt_id uuid fk prompts`,
  `answer text` (check `length(btrim(answer)) between 1 and 200`), `position int check (position between
  0 and 2)`, `unique (profile_id, position)`, `unique (profile_id, prompt_id)`. RLS own-row.
- **Colonnes ajoutées à `profiles`** : `job text` (check `length ≤ 50`), `education text` (`≤ 50`),
  `height_cm int` (check `between 120 and 230`). Toutes nullable.

## 5. Écritures (cantonnées à `auth.uid()`)

- **`set_my_interests(p_interest_ids uuid[])`** (`SECURITY DEFINER`, `search_path` figé) : si
  `array_length > 5` → `raise 'TOO_MANY_INTERESTS'` ; remplacement atomique (delete + insert), façon
  `set_my_preferences`. Ignore les ids inconnus (join sur `interests`).
- **`set_my_prompts(p_prompt_ids uuid[], p_answers text[])`** (`SECURITY DEFINER`) : longueurs des deux
  tableaux égales et ≤ 3 (sinon `INVALID_PROMPTS`) ; chaque réponse non vide ≤ 200 (`INVALID_ANSWER`) ;
  remplacement atomique ; `position` = index dans le tableau ; refuse les `prompt_id` en double.
- **Champs scalaires** (`job`, `education`, `height_cm`) : **mise à jour directe** de la ligne `profiles`
  via le client (RLS update-own existante), intégrée à `upsertIdentity` / un `updateMyProfile`. Validation
  côté base (checks) + côté client (longueurs/plage).

## 6. Diffusion (extension des fonctions definer)

- **`deck_candidates`** (`create or replace`) : ajoute au retour `interests text[]` (labels triés),
  `job text`, `education text`, `height_cm int`, `prompts jsonb` (tableau d'objets
  `{question, answer}` ordonnés par `position`). Agrégation par sous-requêtes `array()/jsonb_agg`.
- **`my_matches`** (`create or replace`) : ajoute les mêmes champs riches pour l'autre participant.
- **Edge Function `get-deck`** : passe-plat (renvoie les candidats tels quels) — vérifier qu'elle ne
  filtre pas les colonnes.
- **Types** : `DeckCandidate`, `Match`, et `src/types/database.ts` (régénération `db:types` côté dev ;
  cast localisé si besoin, comme l'incident `send_message`).

## 7. UI

### Catalogues côté client
- Feature `src/features/profile-rich/` (ou réutilise `profile/`) : hooks `useInterests()` /
  `usePrompts()` (lecture des catalogues, cache React Query `['interests']` / `['prompts']`).

### Carte deck (`DeckCard`)
- Sous la bio : **jusqu'à 3 puces** d'intérêts (chips). Affordance **« ⓘ Voir le profil »** (bouton
  discret, accessible) → ouvre `ProfileDetailModal` avec le candidat courant.

### Vue détaillée `ProfileDetailModal`
- Composant présentational recevant un objet riche (candidat **ou** match) : carrousel/scroll des photos,
  prénom + âge, distance, bio, puces (métier/études/taille), puces intérêts, **cartes prompts**
  (question en gras + réponse). Bouton fermer. Réutilisé depuis le deck et depuis un match (en-tête du
  chat → « Voir le profil », et/ou ligne de match).

### Écran « Éditer le profil » (`app/(tabs)/profile-edit` ou route dédiée)
- Accessible via un bouton « Éditer mon profil » sur l'onglet Profil.
- Sections : bio, métier, études, taille ; **intérêts** (multi-select catalogue, max 5) ; **prompts**
  (choisir jusqu'à 3 questions + saisir les réponses) ; **photos** (réutilise la logique d'ajout/suppr
  existante). Boutons via `AppButton` ; champs via le thème ; états via `EmptyState`/`ErrorText`
  (composants du Plan 8). Tutoiement.

### Onboarding — étape intérêts (optionnelle)
- Une étape **skippable** (« Tes centres d'intérêt » + « Passer ») insérée dans le flux onboarding,
  réutilisant le sélecteur d'intérêts. Le reste des champs riches se remplit dans l'écran d'édition.

## 8. Sécurité / anti-abus

- Nouvelles tables de données (`profile_interests`, `profile_prompts`) en **RLS propre-ligne** (écriture
  réservée à `auth.uid()`). Catalogues (`interests`, `prompts`) en **lecture authentifiée** seulement.
- Champs riches d'autrui exposés **uniquement** via `deck_candidates`/`my_matches` (definer, `search_path`
  figé) — pas de lecture globale, conforme à l'anti-scrap.
- RPC d'écriture `SECURITY DEFINER` cantonnées à `auth.uid()` ; validations (compte, longueurs, plages)
  côté base **et** client (défense en profondeur).
- Réponses de prompts = **texte libre plafonné** (≤200) ; pas de modération in-app v1 (différée).

## 9. Stratégie de test

- **TDD** sur la logique pure : helpers catalogue (tri/labels), validation `≤5 intérêts`, `≤3 prompts` +
  longueur réponse, plage `height_cm`. (`src/features/.../*-format.ts` ou `*-validation.ts`.)
- **Composants** légers en RNTL (hors `app/`) : `ProfileDetailModal` (rend infos + prompts), sélecteur
  d'intérêts (sélection/désélection + plafond), éditeur de prompts.
- **Non-régression** : suite existante verte ; mocks locaux pour les écrans tirant `@expo/vector-icons` /
  `SafetyMenu` si besoin (patterns Plan 7/8).
- Schéma / RLS / RPC / agrégations definer vérifiés **côté cloud** (Docker indispo).

## 10. Migrations & déploiement (contrainte Docker)

1. Appliquer la migration `plan9` via le SQL Editor : catalogues + seeds, `profile_interests`,
   `profile_prompts`, colonnes `profiles`, RPC `set_my_interests`/`set_my_prompts`, et `create or replace`
   de `deck_candidates`/`my_matches`.
2. `npm run db:types` puis `npx tsc --noEmit` (surveiller le re-typage des RPC/colonnes ; cast localisé si
   nécessaire).
3. Pas de nouvelle Edge Function (get-deck inchangée), **pas de rebuild** (aucun module natif).

## 11. Découpage en 2 phases (même plan)

- **Phase 1 — données + diffusion + affichage** : migration (catalogues/tables/colonnes/RPC), extension
  `deck_candidates`/`my_matches`, types, `ProfileDetailModal`, puces sur la carte deck, hooks catalogues.
- **Phase 2 — édition** : écran « Éditer le profil » (intérêts, prompts, scalaires, photos) + étape
  intérêts optionnelle dans l'onboarding.

## 12. Risques & points d'attention

- **Payload deck plus lourd** : intérêts + prompts par candidat ; reste petit (~10 candidats) — acceptable.
- **Régénération des types** : `deck_candidates`/`my_matches` changent de forme → bien régénérer et
  réaligner `DeckCandidate`/`Match` ; risque de cast (incident Plan 5).
- **`jsonb` des prompts** : typer proprement côté client (`{ question: string; answer: string }[]`).
- **Limites (≤5, ≤3)** : garanties côté RPC ET reflétées dans l'UI (désactiver l'ajout au plafond).
- **Onboarding** : ne pas rallonger inutilement → une seule étape optionnelle, skippable, sans blocage.
- **Profil sans données riches** : la vue détaillée et la carte doivent bien rendre les sections vides
  (ne rien afficher plutôt qu'un trou) — réutiliser le pattern « masquer si vide ».
