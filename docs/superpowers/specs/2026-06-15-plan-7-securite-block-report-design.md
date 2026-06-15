# Plan 7 — Sécurité (blocage & signalement) — Spec de conception

Date : 2026-06-15
Statut : validé en brainstorming, en attente de relecture utilisateur
Spec parent : `docs/superpowers/specs/2026-06-15-tinder-en-mieux-mvp-design.md`
Plan précédent : `docs/superpowers/specs/2026-06-15-plan-6-push-cron-design.md`

## 1. Objectif

Permettre à un utilisateur de **bloquer** ou **signaler** une autre personne, de façon **très discrète**
et **silencieuse** (l'autre n'est jamais averti). Le blocage fait disparaître l'autre de partout
(deck, matchs, chat) **dans les deux sens**. Le signalement **bloque aussi** et conserve un motif pour
la modération côté back-office.

## 2. Périmètre

### Inclus
- **Bloquer** depuis la carte du deck et depuis l'écran de chat.
- **Signaler** (même points d'entrée) avec un **motif prédéfini** ; le signalement **bloque** dans la foulée.
- **Exclusion bidirectionnelle** des paires bloquées dans `deck_candidates`, `record_swipe`, `my_matches`,
  `send_message`.
- **Gestion gracieuse** côté chat quand un match disparaît (plus de spinner infini).

### Hors périmètre (YAGNI v1)
- **Écran de déblocage / liste des bloqués** (décision : pas en v1 ; la ligne `blocks` reste supprimable
  côté base si besoin).
- File de modération in-app, tableau de bord, notifications de modération.
- Signalement d'un **message** précis (on signale une **personne**).
- Anti-récidive avancé (re-création de compte, empreinte device, etc.).

## 3. Décision d'architecture : la ligne `block` est l'unique source de vérité

Bloquer = **insérer une ligne** `blocks(blocker_id, blocked_id)`. Toutes les requêtes excluent les paires
pour lesquelles **une ligne existe dans un sens ou l'autre**. Débloquer (hors v1) = supprimer la ligne.

> **Alternatives écartées** :
> - **Suppression destructive** (supprimer le match et les swipes au blocage) → irréversible, perd le
>   contexte du signalement, complexifie un éventuel re-match. Rejeté.
> - **Colonne de statut** (`matches.blocked`) basculée au blocage → état dérivé à maintenir et à
>   synchroniser ; on a déjà choisi de **dériver de la donnée** ailleurs (ex. `expires_at`). Rejeté.

Avantages retenus : réversible, non destructif, conserve le contexte de signalement, un seul invariant
(« la paire est bloquée ssi une ligne `blocks` existe ») vérifié partout.

## 4. Modèle de données (migration `plan7`)

### `blocks`
```
blocker_id  uuid  not null  references profiles(id) on delete cascade
blocked_id  uuid  not null  references profiles(id) on delete cascade
created_at  timestamptz not null default now()
primary key (blocker_id, blocked_id)
check (blocker_id <> blocked_id)
```
Index sur `blocked_id` (pour les recherches « qui m'a bloqué »).
**RLS propre-ligne** (`blocker_id = auth.uid()`) : select / insert / delete de **ses propres** blocages.
L'insert passe en pratique par la RPC (voir §5), mais la policy insert reste cantonnée à `auth.uid()`.

### `reports`
```
id           uuid primary key default gen_random_uuid()
reporter_id  uuid not null references profiles(id) on delete cascade
reported_id  uuid not null references profiles(id) on delete cascade
reason       text not null check (reason in ('spam','inapproprie','harcelement','faux_profil','autre'))
created_at   timestamptz not null default now()
check (reporter_id <> reported_id)
```
Index sur `reported_id`.
**RLS** : **insert propre-ligne uniquement** (`reporter_id = auth.uid()`). **Aucune policy select** pour
`authenticated` → un client **ne peut pas lire** les signalements (modération via dashboard / service role).

## 5. RPC (toutes `SECURITY DEFINER`, `search_path` figé, cantonnées à `auth.uid()`)

### `block_user(p_target uuid) returns void`
- `v_me := auth.uid()` ; si `null` → `raise 'NOT_AUTHENTICATED'`.
- Si `p_target = v_me` → `raise 'CANNOT_BLOCK_SELF'`.
- `insert into blocks (blocker_id, blocked_id) values (v_me, p_target) on conflict do nothing`.
- `revoke execute from public ; grant execute to authenticated`.

### `report_user(p_target uuid, p_reason text) returns void`
- Mêmes gardes (`NOT_AUTHENTICATED`, `p_target = v_me` → `CANNOT_REPORT_SELF`).
- Si `p_reason` n'est pas dans la liste autorisée → `raise 'INVALID_REASON'` (défense en profondeur, en
  plus du `check` de colonne).
- `insert into reports (reporter_id, reported_id, reason) values (v_me, p_target, p_reason)`.
- **Bloque aussi** : `insert into blocks (blocker_id, blocked_id) values (v_me, p_target) on conflict do nothing`.
- `revoke execute from public ; grant execute to authenticated`.

## 6. Intégration serveur — `create or replace` des fonctions existantes

Un **prédicat de blocage** réutilisé partout (existence d'une ligne dans un sens **ou** l'autre entre
`me` et l'autre profil) :
```
not exists (
  select 1 from public.blocks b
  where (b.blocker_id = <me> and b.blocked_id = <other>)
     or (b.blocker_id = <other> and b.blocked_id = <me>)
)
```

- **`deck_candidates`** (migration plan3 — à côté du `not exists (swipes …)`) : ajouter l'exclusion de
  blocage entre l'appelant et chaque candidat `c`. Les profils bloqués (dans un sens ou l'autre) ne sont
  **jamais** présentés.
- **`record_swipe`** (migration plan4, version `SECURITY DEFINER` qui renvoie du JSON) : **ne pas créer de
  match** si un blocage existe entre les deux. Défense en profondeur : un bloqué n'apparaît déjà plus dans
  le deck, mais on garde le garde côté écriture (le like a pu partir avant la prise d'effet).
- **`my_matches`** (migration plan4) : ajouter l'exclusion de blocage → le match **disparaît des deux
  listes** dès qu'un côté bloque.
- **`send_message`** (dernière version, migration plan6) : après le contrôle « participant + match actif »,
  si un blocage existe entre l'expéditeur et l'autre participant → `raise 'MATCH_UNAVAILABLE'`. Lecture
  seule effective + plus aucun message ne part.

## 7. UI — très discrète

### Carte du deck (`src/features/deck/DeckCard.tsx`)
- Un **petit « ⋯ »** discret en **haut à droite** de la carte (faible opacité, sur l'image). Au tap →
  `SafetyMenu` pour le candidat courant.

### En-tête du chat (`app/match/[id].tsx`)
- Le `headerRight` actuel n'affiche que le compte à rebours. Il devient une **petite rangée**
  `[compte à rebours] [⋯]`. Au tap du « ⋯ » → `SafetyMenu` pour l'autre participant du match.

### `SafetyMenu` (composant partagé)
- Une feuille/modale légère avec deux actions : **Bloquer** et **Signaler**.
- **Bloquer** → confirmation légère (« Bloquer cette personne ? Elle disparaîtra et ne pourra plus vous
  contacter. ») → `block_user`.
- **Signaler** → sous-choix de **motif prédéfini** (voir §8) → `report_user` (qui bloque aussi).
- **Silencieux** : aucun message n'est envoyé à l'autre ; côté UI un simple toast/Alert de confirmation.

### Gestion gracieuse à la disparition d'un match (`app/match/[id].tsx`)
- Aujourd'hui : `if (!match || …) return <ActivityIndicator />` → **spinner infini** si le match a disparu
  (blocage). Correctif : distinguer **« en cours de chargement »** de **« matchs chargés mais match
  absent »**. Si `matches` est chargé (succès) et que le match est introuvable → afficher
  **« Conversation indisponible. »** au lieu du spinner. (Couvre aussi l'expiration/suppression.)

## 8. Motifs de signalement (liste prédéfinie)

`src/features/safety/report-reasons.ts` (**pur, testé**) — `value` = ce qui part en base, `label` = FR :

| value          | label                  |
|----------------|------------------------|
| `spam`         | Spam                   |
| `inapproprie`  | Contenu inapproprié    |
| `harcelement`  | Harcèlement            |
| `faux_profil`  | Faux profil            |
| `autre`        | Autre                  |

Expose `REPORT_REASONS` (tableau ordonné `{ value, label }`), `isValidReason(value)`,
`labelForReason(value)`. La validation côté client double celle du `check` SQL et de la RPC.

## 9. Architecture client — feature `src/features/safety/`

- **`report-reasons.ts`** (pur, **testé**) : la liste + helpers ci-dessus.
- **`safety-api.ts`** : `blockUser(targetId)` (rpc `block_user`), `reportUser(targetId, reason)` (rpc
  `report_user`). N'importe que `supabase`.
- **`use-safety.ts`** : `useBlockUser()` et `useReportUser()` (mutations React Query). En `onSuccess` :
  `invalidateQueries(['deck'])` et `invalidateQueries(['matches'])` ; depuis le chat, **fermer l'écran**
  (`router.back()`). `onError` → `Alert` avec un message FR générique.
- **`SafetyMenu.tsx`** : le menu discret (Bloquer / Signaler + picker de motifs), réutilisé par le deck et
  le chat. Reçoit `targetId` et un éventuel callback `onDone` (pour le `router.back()` côté chat).

## 10. Sécurité / anti-abus

- **RLS propre-ligne** sur `blocks` ; `reports` **non lisibles** côté client (insert-own uniquement).
- RPC `block_user` / `report_user` **`SECURITY DEFINER`**, `search_path` **figé**, cantonnées à
  `auth.uid()` (on ne peut bloquer/signaler **qu'en son propre nom**, jamais pour autrui).
- **Blocage bidirectionnel** appliqué dans **toutes** les surfaces serveur (deck, swipe, matchs, message) →
  pas de fuite via une route oubliée.
- **Silencieux** : aucune notification ni signal n'est émis vers la personne bloquée/signalée.
- `check` de colonne sur `reason` + garde `INVALID_REASON` dans la RPC (défense en profondeur).

## 11. Migrations & déploiement (contrainte Docker)

Tout par le dev, **via le SQL Editor** + CLI :
1. Appliquer la migration `plan7` : tables `blocks` et `reports` (+ RLS), RPC `block_user` / `report_user`,
   et les `create or replace` de `deck_candidates`, `record_swipe`, `my_matches`, `send_message`
   (ajout du prédicat de blocage).
2. **Régénérer les types** (`npm run db:types`). Vérifier qu'aucun type de RPC existant n'est cassé (cf.
   l'incident `send_message` au Plan 5 → garder/ajouter un cast si besoin).
3. **Pas de nouvelle Edge Function, pas de nouveau secret Vault, pas de rebuild EAS** (aucun module natif).

## 12. Stratégie de test

- **TDD** sur `report-reasons.ts` (liste ordonnée, `isValidReason`, `labelForReason`).
- **`SafetyMenu`** : test RNTL léger (affiche Bloquer/Signaler ; « Signaler » ouvre les motifs ; un tap
  appelle le bon handler) — **hors `app/`**.
- RLS / RPC / exclusions serveur (deck, swipe, matchs, message) vérifiés **côté cloud** (Docker indispo).

## 13. Risques & points d'attention

- **Match déjà ouvert au moment du blocage** : `my_matches` l'exclut → l'écran de chat doit gérer
  l'absence (§7, gestion gracieuse) sinon spinner infini.
- **Course like ↔ blocage** : le garde dans `record_swipe` empêche un match de naître malgré un blocage
  parti juste avant.
- **`send_message` après blocage** : lève `MATCH_UNAVAILABLE` ; le client traite cette erreur comme une
  conversation indisponible (pas un crash).
- **Pas d'écran de déblocage en v1** : assumé ; un déblocage exceptionnel se fait en base. À documenter
  comme amélioration ultérieure.
- **`reason` libre côté `autre`** : on ne collecte **pas** de texte libre en v1 (juste la catégorie) →
  pas de surface d'injection / de modération de texte. Amélioration ultérieure possible.
- **Régénération des types** : surveiller un éventuel re-typage des params de RPC nullable (incident connu
  au Plan 5).
