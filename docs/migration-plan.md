# Plan de migration - Le Grand JDR

Ce document resume l'etat courant du refactor. L'historique detaille de la dette `window.*` reste dans `docs/window-globals-inventory.md`.

## Etat actuel

### Fait

- Entree unique : `index.html` + `assets/js/app.js`.
- Modules ES natifs, sans build obligatoire.
- Router lazy dans `core/navigation.js` via `FEATURE_MAP`.
- CSS par page en lazy via `FEATURE_CSS`.
- Couche Firestore centralisee dans `data/firestore.js` avec cache session-live, TTL et coalescing.
- Delegation globale `data-action` et delegation scopee `bindScopedActions`.
- CSP stricte preparee dans `docs/security.md`, non activee par defaut.
- VTT deplace dans `features/vtt/` : coeur `vtt.js` + modules peripheriques.
- Tests Node sur helpers purs dans `tests/`.

### Legacy conserve volontairement

- Compatibilites de donnees anciennes dans personnages, sorts, carte, agenda, boutique et VTT.
- Quelques ponts applicatifs `window.*` encore suivis dans `docs/window-globals-inventory.md`.
- Usages navigateur natifs de `window` (`getSelection`, `scrollTo`, `addEventListener`, `Konva`) a ne pas compter comme dette applicative.

Ne pas supprimer ces branches sans migration ou verification des donnees de production.

## Prochaines priorites

### 1. Securite Firestore

- Transformer `docs/firestore-rules.md` en source deployable ou le synchroniser explicitement avec les regles deployees.
- Resserrer les collections larges champ par champ quand le gameplay le permet.
- Super-admin par email hardcode supprime : role `users/{uid}.isAdmin` verrouille par les regles.

### 2. Performance / taille

- Continuer a verifier `FEATURE_CSS` lors de chaque nouvelle page.
- Eviter de charger une grosse feuille voisine pour un petit widget reutilise.
- Surveiller `characters.css`, `shop.css` et `vtt.css`, qui restent les feuilles les plus lourdes.

### 3. VTT

- Garder le coeur canvas/combat/tokens dans `features/vtt/vtt.js` tant que l'interface de rendu n'est pas extraite proprement.
- Deplacer seulement les modules a faible couplage et toujours avec smoke-test navigateur.
- A moyen terme, extraire un vrai module de rendu VTT avant de toucher au Tray ou a l'Inspector.

### 4. Tests / qualite

- Ajouter un script de check qui combine `node --test`, `node --check` sur les fichiers touches et `git diff --check`.
- Extraire davantage de logique pure testable (sorts, ciblage, degats, permissions token).
- Ajouter des tests de regles Firestore avec l'emulator quand les regles deviennent source de verite versionnee.

### 5. Docs / dette

- Garder `README.md`, `docs/architecture.md`, `.claude/CLAUDE.md` et ce plan alignes sur les chemins reels.
- Ignorer les worktrees locaux `.claude/worktrees/` plutot que les versionner.
- Continuer la reduction `window.*`, mais sans en faire une priorite devant securite, performance et tests.
