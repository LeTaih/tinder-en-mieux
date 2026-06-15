# Plan 2 — Profil & Onboarding — Spec de conception

Date : 2026-06-15
Statut : validé en brainstorming, en attente de relecture utilisateur
Spec parent : `docs/superpowers/specs/2026-06-15-tinder-en-mieux-mvp-design.md`

## 1. Objectif

Permettre à un utilisateur authentifié (Plan 1) de **créer son profil** via un parcours
d'**onboarding bloquant**, et préparer toutes les données nécessaires au deck du Plan 3 (profil,
photos, préférences, position). Exigence transverse : **sécurité forte, anti-bot, anti-scraping**.

## 2. Périmètre

### Inclus
- Parcours d'**onboarding bloquant** : tant que le profil n'est pas complet, l'utilisateur ne peut
  pas atteindre les onglets.
- Profil : nom affiché, date de naissance (**18+**), genre (liste de référence configurable), bio.
- **Photos** : 1 à 6 (min 1), depuis **galerie ou appareil photo**, recadrées + **compressées côté
  client**, uploadées dans un **bucket privé**.
- **Préférences** : genre(s) recherché(s), tranche d'âge (min/max), distance max.
- **Position** : capture des coordonnées (permission de localisation) pendant l'onboarding.
- Onglet **Profil** : résumé **lecture seule** du profil + déconnexion.
- Sécurité : RLS stricte, stockage privé, validation des uploads (voir §6).

### Hors périmètre (YAGNI / plans suivants)
- **Édition** du profil après l'onboarding (post-Plan 2).
- Modération / vérification de photos.
- Deck & découverte (Plan 3).
- CAPTCHA, protection mots de passe compromis, WAF : **documentés en §6** comme durcissement à
  activer avant la mise en ligne publique, non implémentés dans ce plan.

## 3. Flux d'onboarding (bloquant)

Le layout racine gère désormais **quatre états** :

| État | Destination |
|---|---|
| Session en cours de chargement | écran de chargement |
| Non authentifié | `(auth)` |
| Authentifié + profil **incomplet** | **`(onboarding)`** |
| Authentifié + profil **complet** | `(tabs)` |

La **complétude** est calculée côté client à partir du profil chargé (TanStack Query). Un profil
est **complet** quand : `display_name` non vide, `birthdate` valide (18+), `gender_id` défini,
**≥ 1 photo**, `location` capturée, et une ligne `preferences` avec **≥ 1 genre recherché**,
`age_min ≤ age_max`, `max_distance_km` défini.

> La complétude côté client ne sert qu'au **routage (UX)**. La règle « seuls les profils complets
> sont découvrables » sera **garantie côté serveur** par la RPC du deck (Plan 3), pas par le client.

Étapes, en séquence (chacune un écran sous `app/(onboarding)/`) :
1. **Identité** — `display_name`, `birthdate` (sélecteur de date ; refus si < 18 ans).
2. **Genre** — choix unique dans la liste `genders` chargée depuis la base.
3. **Photos** — ajout de 1 à 6 photos (galerie/caméra → recadrage → compression → upload).
4. **Préférences** — genres recherchés (multi-sélection depuis `genders`), tranche d'âge, distance.
5. **Position** — demande de permission de localisation, capture et enregistrement des coordonnées.

Le bouton « Terminer » n'est actif que lorsque le minimum requis est satisfait. À la fin, la requête
de profil est invalidée → le routage bascule vers `(tabs)`.

## 4. Modèle de données (migrations SQL)

Le Plan 1 n'utilisait que `auth.users`. Le Plan 2 crée les tables suivantes (toutes en **RLS
activée**, voir §6 pour les policies) :

### `genders`
- `id` (uuid, pk), `key` (text unique, slug stable), `label` (text), `is_active` (bool, défaut true),
  `sort_order` (int).
- **Seed initial** : `('homme','Homme',1)`, `('femme','Femme',2)`. Liste **configurable** (ajout/
  désactivation sans migration de schéma).

### `profiles` (1:1 avec `auth.users`)
- `id` (uuid, pk, fk → `auth.users` on delete cascade), `display_name` (text),
  `birthdate` (date), `gender_id` (uuid, fk → `genders`), `bio` (text, nullable),
  `location` (`geography(Point,4326)`, nullable), `created_at`, `updated_at`.
- **CHECK 18+** : `birthdate <= (current_date - interval '18 years')`.

### `profile_photos`
- `id` (uuid, pk), `profile_id` (uuid, fk → `profiles` on delete cascade), `storage_path` (text),
  `position` (int, 0–5), `created_at`.
- Unique `(profile_id, position)`. Max 6 par profil (vérifié à l'écriture côté API + garde-fou).

### `preferences`
- `profile_id` (uuid, pk, fk → `profiles` on delete cascade), `age_min` (int), `age_max` (int),
  `max_distance_km` (int).
- CHECK `age_min >= 18`, `age_max >= age_min`, `max_distance_km > 0`.

### `preference_genders` (M:N — genres recherchés)
- `profile_id` (uuid, fk → `profiles` on delete cascade), `gender_id` (uuid, fk → `genders`).
- PK composite `(profile_id, gender_id)`.

## 5. Stockage des photos

- Bucket **privé** `profile-photos` (non public).
- Convention de chemin : `{auth.uid}/{uuid}.jpg` (dossier par utilisateur).
- **Upload** : après recadrage + compression client (`expo-image-manipulator` : redimension max ~1080px,
  JPEG qualité ~0.7). Type forcé JPEG, taille bornée par la compression.
- **Affichage** : via **URL signée à TTL court** (`createSignedUrl`, ~60 s, régénérée à l'affichage).
  Jamais d'URL publique.
- `profile_photos.storage_path` stocke le chemin (pas l'URL).

## 6. Sécurité & anti-abus

### Implémenté dans ce plan
- **RLS « propre ligne uniquement »** sur `profiles`, `profile_photos`, `preferences`,
  `preference_genders` : un utilisateur ne peut `select/insert/update/delete` que les lignes liées à
  son `auth.uid()`. **Aucune policy de lecture globale** → impossible d'aspirer les profils via une
  requête directe. `genders` est en lecture seule pour tous les utilisateurs authentifiés (table de
  référence non sensible), écriture réservée au rôle service.
- **Storage privé + policies scopées** : insertion/lecture/suppression d'objets limitées au préfixe
  `({auth.uid}/...)`. Lecture des photos d'autrui impossible en direct ; elle passera par la RPC du
  deck (Plan 3) qui fournira des URLs signées contrôlées.
- **URLs signées à TTL court** pour tout affichage de photo → pas d'images publiques énumérables ni
  hotlinkables.
- **Validation des uploads** : MIME image uniquement, recadrage/compression imposés, nombre de
  photos plafonné à 6 côté API.
- **Validation d'entrées** côté client ET contraintes **CHECK** en base (18+, bornes d'âge, distance)
  → la base reste la source de vérité même si un client est contourné.

### Principe posé pour le Plan 3 (surface anti-scraping principale)
- Le deck sera une **RPC `SECURITY DEFINER` contrôlée** : **paginée**, **champs limités**, **sans
  coordonnées brutes** (distance arrondie uniquement), **rate-limitée** (quota de profils servis par
  fenêtre temporelle, en complément du quota de 20 likes/jour). Jamais une lecture de table brute.

### Durcissement documenté, différé (à activer avant mise en ligne publique)
- **CAPTCHA anti-bot** à l'inscription/connexion (Cloudflare Turnstile ou hCaptcha, nativement
  supporté par Supabase Auth). Différé car nécessite un composant webview sur React Native (friction
  + complexité) inutile pour une démo interne ; activation simple le jour J.
- **Protection des mots de passe compromis** (HaveIBeenPwned) — toggle Supabase.
- **Réactivation de « Confirm email »** (désactivée temporairement pour la démo).
- **WAF / Cloudflare** devant l'API Supabase — niveau infra.

## 7. Architecture client

Feature `src/features/profile/` :
- `profile-api.ts` : `upsertProfile`, `setGender`, `uploadPhoto`, `deletePhoto`, `reorderPhotos`,
  `upsertPreferences`, `setLocation` (fines délégations Supabase ; pas de logique métier cachée).
- Hooks : `useGenders` (liste de référence), `useMyProfile` (profil + photos + préférences),
  `useProfileCompleteness` (dérive le booléen de complétude depuis `useMyProfile`).
- `completeness.ts` (pur, testé) : `isProfileComplete(profile, photos, preferences)`.
- `validation.ts` (pur, testé) : âge 18+, cohérence `age_min ≤ age_max`, distance > 0, ≥ 1 photo,
  ≥ 1 genre recherché.
- `image.ts` : paramètres de recadrage/compression (`expo-image-manipulator`).

Routes : groupe `app/(onboarding)/` avec un layout en pile et un écran par étape. Le layout racine
(`app/_layout.tsx`) ajoute la garde `Stack.Protected` pour `(onboarding)` vs `(tabs)` selon la
complétude.

Dépendances natives : `expo-image-picker` (galerie + caméra), `expo-image-manipulator`
(recadrage/compression), `expo-location` (position).

## 8. Migrations & contrainte Docker

Le Plan 2 introduit du **schéma SQL réel**. **Docker étant indisponible** dans la session de dev,
la base ne tourne pas en local : les **migrations SQL** sont écrites dans `supabase/migrations/`, puis
**appliquées par le développeur au projet Supabase cloud** (`supabase link` + `supabase db push`, ou
l'éditeur SQL du dashboard). Ensuite `npm run db:types` (adapté `--linked`/`--project-id`) régénère
les types depuis le cloud. Procédure guidée pas à pas au moment de l'implémentation.

## 9. Stratégie de test

- **Logique client pure en TDD** : `completeness.ts`, `validation.ts`, paramètres de `image.ts`.
- Tests de composants légers (RNTL) pour les écrans d'étape clés (activation du bouton « Terminer »,
  affichage des erreurs de validation).
- **Tests RLS/SQL au niveau base différés** (besoin de Docker) → vérification du comportement RLS et
  des contraintes sur le projet cloud lors de l'application des migrations. À automatiser (pgTAP)
  quand un environnement avec Docker sera disponible.

## 10. Risques & points d'attention
- **Permissions** (photos, caméra, localisation) : UX de demande claire, gestion du refus (l'app
  reste utilisable, l'utilisateur peut réessayer).
- **iOS** exige des chaînes de description (`NSPhotoLibraryUsageDescription`,
  `NSCameraUsageDescription`, `NSLocationWhenInUseUsageDescription`) → déclarées via les config
  plugins Expo.
- **Cohérence des URLs signées** : TTL court → régénérer à l'affichage, ne pas les stocker.
- **Suppression de compte** : `on delete cascade` depuis `auth.users` nettoie profil/photos/préférences
  (le nettoyage des objets Storage orphelins est noté pour un plan ultérieur).
