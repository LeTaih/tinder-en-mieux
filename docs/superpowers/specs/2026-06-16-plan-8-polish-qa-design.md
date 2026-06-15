# Plan 8 — Polish & QA — Spec de conception

Date : 2026-06-16
Statut : validé en brainstorming (audit 4 zones), en attente de relecture utilisateur
Spec parent : `docs/superpowers/specs/2026-06-15-tinder-en-mieux-mvp-design.md`
Plan précédent : `docs/superpowers/specs/2026-06-15-plan-7-securite-block-report-design.md`

## 1. Objectif

Rendre la v1 **démo-ready** (présentation au boss) : cohérence visuelle, états vides/chargement/erreur
soignés, accessibilité de base, et polish de la **feature phare** (le compte à rebours). **Aucune
nouvelle fonctionnalité.** En prime, poser des **fondations UI réutilisables** (thème + quelques
composants partagés) sur lesquelles le Plan 9 (« Profils plus riches ») se construira directement.

Issu d'un audit en 4 zones (auth/onboarding, deck, matchs/chat, transverse) dont les constats récurrents
(tu/vous, couleurs en dur, labels d'accessibilité, états vides) ont été dédupliqués et priorisés.

## 2. Périmètre

### Inclus (P0 + P1, + P2 trivial)
- **Cohérence tu/vous** → tutoiement partout.
- **Thème centralisé** (`src/lib/theme.ts`) + remplacement des couleurs/espacements en dur.
- **Composants partagés** minimaux : `AppButton`, `EmptyState`, `ErrorText`.
- **États** vides/chargement/erreur harmonisés (deck, matchs, chat, listes).
- **Accessibilité** : labels/roles sur les boutons-icônes.
- **Compte à rebours `mm:ss`** (padding des minutes).
- **Icônes d'onglets** (Deck / Matchs / Profil).
- **SafeArea + StatusBar** au niveau racine.
- **Carrousel photo** : indicateur multi-photos + lisibilité du texte en surimpression.
- **Feedback de press** (opacité) sur les éléments tappables sans retour visuel.

### Hors périmètre
- Toute nouvelle feature (→ Plan 9 « Profils plus riches »).
- **Dark mode** complet, refonte visuelle, icônes/illustrations custom.
- Extraction `InputField`/`SelectButton` des formulaires (reportée — gain moindre, risque de régression ;
  les champs restent en l'état, juste re-couleurs via le thème).
- Conflit menu « ⋯ » ↔ geste de swipe sur la carte : **vérification manuelle sur device** (pas de
  changement de code à l'aveugle ; à ajuster seulement si reproduit).
- Remplacement des emojis par une police d'icônes dans le chat (📎 ➤) : conservés tels quels.

## 3. Décisions d'architecture

- **Thème = simple objet TypeScript** (`src/lib/theme.ts`), pas de lib de design-system (YAGNI). Exporte
  `Colors`, `Spacing`, `Radii`, `FontSizes`. Importé partout en remplacement des littéraux.
- **Composants partagés** dans **`src/components/`** (dossier nouveau), strictement limités à ce qui
  supprime le plus de duplication ou de bugs d'état : `AppButton` (action async avec spinner + état
  désactivé), `EmptyState` (icône + titre + message + action optionnelle), `ErrorText` (ligne d'erreur
  cohérente). On n'ajoute rien d'autre tant qu'un besoin réel n'apparaît pas.
- **Icônes** : `@expo/vector-icons` (Ionicons) via `npx expo install @expo/vector-icons`. Les polices
  d'icônes sont **chargées au runtime** dans le workflow managé → **pas de rebuild natif** nécessaire,
  fonctionne dans le build dev existant.
- **SafeArea** : `react-native-safe-area-context` (déjà installé) — `SafeAreaProvider` à la racine +
  `SafeAreaView` sur les écrans sans en-tête de navigation (auth, onboarding, écrans de chargement).
  **StatusBar** : `expo-status-bar` (déjà installé), style `dark` par défaut.
- **Tutoiement** : règle de rédaction = « tu » systématique. On corrige les écarts (« vous »).

## 4. Détail des lots

### P0 — impact démo, faible risque
1. **tu/vous** : `src/features/matches/MatchModal.tsx` (« vous êtes likés ») et
   `src/features/safety/SafetyMenu.tsx` (« …ne pourra plus vous contacter » → « …te contacter »).
   Balayer les autres chaînes au passage.
2. **Compte à rebours** : `src/features/matches/countdown.ts` — padder les minutes
   (`05:00` au lieu de `5:00`) ; mettre à jour `countdown.test.ts` (cas minutes < 10).
3. **Icônes d'onglets** : `app/(tabs)/_layout.tsx` — `tabBarIcon` Ionicons pour Deck / Matchs / Profil,
   `tabBarActiveTintColor = Colors.primary`.
4. **Boutons asynchrones** : `AppButton` affiche un `ActivityIndicator` + opacité réduite quand `loading`
   ou `disabled`. Remplacer les `<Button>`/Pressables d'action dans `app/(auth)/*` et `app/(onboarding)/*`
   (sign-in, sign-up, genre, localisation, photos). Like désactivé quand quota = 0 (`DeckCard`).
5. **Accessibilité** : `accessibilityLabel` + `accessibilityRole="button"` sur les boutons-icônes :
   `DeckCard` (↩️ « Revenir », ✕ « Passer », ♥ « Aimer »), `ChatInput` (📎 « Joindre une image »,
   ➤ « Envoyer »), boutons photos.

### P1 — cohérence & robustesse
6. **Thème** : créer `src/lib/theme.ts`. Remplacer les hex récurrents — `#208AEF` (primaire, ~9 fichiers),
   `#ccc`/`#ddd` (bordures), `#999`/`#777` (textes secondaires), `#E53935` (alerte), `#E9E9EB` (bulle),
   `#E6F0FF` (fond sélection), `#f2f2f2`/`#eee` (fonds) — par `Colors.*`. Espacements (`8/12/16/24`) et
   radii (`8/12/16`) via `Spacing`/`Radii` là où c'est direct.
7. **États** : `EmptyState` réutilisable. L'appliquer à : deck vide & erreur (`app/(tabs)/index.tsx`),
   matchs vides (`app/(tabs)/matches.tsx`), **chat vide** (`ListEmptyComponent` dans `app/match/[id].tsx`
   → « Aucun message. Lance la conversation ! »), liste des genres en chargement
   (`app/(onboarding)/gender.tsx` → spinner). Profil sans photo (`app/(tabs)/profile.tsx`) → message.
8. **SafeArea + StatusBar** : `app/_layout.tsx` — `SafeAreaProvider` autour du `RootNavigator`,
   `<StatusBar style="dark" />` ; `SafeAreaView` sur les conteneurs auth/onboarding/chargement.
9. **Carrousel photo** (`src/features/deck/DeckCard.tsx`) : indicateur de position (points ou « 1/3 »),
   cas 0 photo (placeholder explicite, pas un carré gris « cassé ») et 1 photo (pas de cyclage), légère
   ombre/dégradé derrière le texte (prénom/âge/bio) pour la lisibilité sur photo claire.

### P2 — confort (si trivial)
10. **Feedback de press** : opacité au press sur les lignes de matchs (`matches.tsx`) et les boutons de
    sélection (genre/préférences) via `style={({ pressed }) => …}`.

## 5. Architecture des fichiers

**Créés :**
- `src/lib/theme.ts` — `Colors`, `Spacing`, `Radii`, `FontSizes`.
- `src/components/AppButton.tsx` (+ test) — bouton d'action (label, `onPress`, `loading`, `disabled`,
  `variant?`).
- `src/components/EmptyState.tsx` (+ test) — `icon?`, `title`, `message?`, `action?`.
- `src/components/ErrorText.tsx` (+ test) — ligne d'erreur cohérente (`message?` → rien si vide).

**Modifiés (principaux) :**
- `app/_layout.tsx` (SafeArea + StatusBar), `app/(tabs)/_layout.tsx` (icônes).
- `app/(auth)/*`, `app/(onboarding)/*` (AppButton, ErrorText, SafeAreaView, thème).
- `app/(tabs)/index.tsx`, `app/(tabs)/matches.tsx`, `app/(tabs)/profile.tsx`, `app/match/[id].tsx`
  (EmptyState, thème, a11y, états).
- `src/features/deck/DeckCard.tsx` (a11y, carrousel, thème), `src/features/chat/*` (a11y, thème, chat
  vide), `src/features/matches/countdown.ts` (padding), `MatchModal.tsx`/`SafetyMenu.tsx` (tu).

## 6. Stratégie de test

- **`countdown.ts`** : adapter `countdown.test.ts` (minutes paddées ; ajouter un cas < 10 min, ex. `09:05`).
- **Composants partagés** (RNTL, hors `app/`) :
  - `AppButton` : rend le label ; affiche un spinner et n'appelle pas `onPress` quand `loading` ;
    `disabled` empêche l'appel.
  - `EmptyState` : rend titre + message ; déclenche l'action quand présente.
  - `ErrorText` : rend le message ; ne rend rien si `message` vide/undefined.
- **Non-régression** : toute la suite existante (49 tests) doit rester verte ; les tests qui rendent des
  écrans modifiés (deck-card, match-modal, identity/preferences) ne doivent pas casser (mocker
  `@expo/vector-icons` localement si besoin, comme on a isolé `SafetyMenu`).
- Rendu visuel / SafeArea / icônes : vérifiés **sur device** (le polish visuel ne se teste pas en unitaire).

## 7. Risques & points d'attention

- **`@expo/vector-icons`** : runtime-loaded → pas de rebuild ; mais dans les **tests** jest, il peut
  nécessiter un mock léger (comme `SafetyMenu` au Plan 7) pour les écrans qui l'importent.
- **Thème = gros diff peu risqué** : remplacement mécanique de littéraux ; revue attentive pour ne pas
  changer une valeur par erreur (ex. un `#999` de bordure vs de texte).
- **Tutoiement** : ne pas casser une chaîne en oubliant un accord (« likés » au pluriel, etc.).
- **`ListEmptyComponent` + `inverted`** : sur une FlatList inversée, l'empty component s'affiche
  correctement mais peut apparaître retourné selon les versions — vérifier le rendu.
- **Périmètre** : tenir la ligne « pas de nouvelle feature » — tout enrichissement de profil va au Plan 9.
