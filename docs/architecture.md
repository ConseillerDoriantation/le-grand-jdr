# Architecture

## Principes

Le Grand JDR reste une app statique sans build. L'architecture cherche donc a garder des modules ES natifs simples, deployables tels quels, avec des frontieres claires plutot qu'une surcouche framework.

Regles de base :

- `core/` cable l'app : auth, navigation, etat global, layout.
- `data/firestore.js` est la couche d'acces Firestore par defaut.
- `shared/` contient les helpers et regles metier reutilisables.
- `features/` contient les pages lazy et leur orchestration UI.
- Les CSS de pages sont chargees en lazy par `FEATURE_CSS` dans `core/navigation.js`.

## Decoupage actuel

### `assets/js/config`

Initialisation Firebase et exports SDK necessaires au runtime. Les imports directs depuis une feature doivent rester exceptionnels et justifies par du temps reel tactique ou de l'auth.

### `assets/js/core`

Source de verite applicative : `STATE`, routeur lazy, delegation globale `data-action`, auth, selection d'aventure, layout.

### `assets/js/data`

Acces Firestore centralise : scope aventure, cache session-live, cache TTL, coalescing in-flight, patch du cache apres ecriture.

### `assets/js/shared`

Briques reutilisables : HTML/echappement, modal, notifications, rich-text, presence, economie, stats perso, inventaire, equipement, sorts, conditions, types de degats, helpers de tri/drag.

Une regle utilisee par plusieurs features doit vivre ici ou dans un sous-module metier dedie, pas dans une feature voisine.

### `assets/js/features`

Chaque page orchestre son rendu, ses listeners et ses appels aux helpers. Les domaines complexes ont leurs sous-dossiers :

- `features/characters/` : sous-modules de fiche personnage.
- `features/map/` : modele propre avec `map.state.js`, repos data, rendu et UI.
- `features/vtt/` : coeur VTT `vtt.js` + modules peripheriques (fog, musique, butin, des, presence, mini-fiche, timer, tracker combat).
- `features/chat.js` + `features/chat/` : messagerie flottante toutes pages (aventure/groupes/DM). La logique pure (linkify, emotes, mentions, des) vit dans `chat/chat-format.js`, testee par `tests/chat-format.test.js` ; les images vivent dans la collection `chatImages` (le message ne porte qu'un id).

## Patterns UI

- Global : `data-action`, `data-change`, `data-input` + `registerActions`.
- Scope local : `bindScopedActions(prefix, handlers)` pour les domaines type boutique/bestiaire/players.
- VTT : `data-vtt-fn` resolu par le registre `VTT_ACTIONS` du coeur VTT.
- Legacy : conserver uniquement quand les donnees ou le HTML genere l'exigent encore. Migrer par petites passes verifiables.

## Performance

Le routeur charge les modules et CSS a la premiere navigation. Ne pas remettre les grosses feuilles de page dans `index.html`. Si une feature reutilise un widget visuel d'une autre page, extraire ou dupliquer le petit widget necessaire plutot que charger toute la CSS voisine.

Cache des assets : version unique `ASSET_VERSION` (`core/version.js`) appliquee a tous les CSS (liens eager d'index.html + chargement lazy). Bump via `node tools/bump-assets.mjs` a chaque modif CSS. Ne jamais versionner un import JS (`?v=`) : deux URLs = module charge en double.

## Securite

Le client ne porte pas la securite. `STATE.isAdmin` masque/affiche des actions, mais seules les regles Firestore protegent les donnees. Toute nouvelle collection ou permission doit etre refletee dans `docs/firestore-rules.md` puis dans les regles deployees.

## Refactor recommande

1. Garder le coeur VTT coherent tant que les dependances canvas/combat restent fortement couplees.
2. Continuer a retirer les ponts applicatifs `window.*` restants, sans toucher aux usages navigateur natifs.
3. Ajouter des tests purs avant d'extraire de la logique metier risquee.
4. Nettoyer le legacy seulement apres verification ou migration des donnees reelles.
