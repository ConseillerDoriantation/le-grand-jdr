# CLAUDE.md — Le Grand JDR

App web de gestion de campagne JDR multi-joueurs. Réponses **directement exploitables**, signal max, bruit min.

## Stack & déploiement
- Web statique **sans build**, HTML/CSS/JS en ES modules, données **Firebase Firestore**, hébergé sur **GitHub Pages**.
- Doit rester déployable tel quel : pas de build, framework ou dépendance lourde sans demande explicite.
- Issu d'un refactor monolithe → modulaire. Reste du legacy de données et quelques ponts de compat ; cible = `data-action`/`bindScopedActions`/registre VTT. Le fonctionnement prime sur la pureté archi.
- Droits admin côté client (`STATE.isAdmin`) = **confort UI, jamais une sécurité**. La vraie protection = règles Firestore.

## Carte du repo
- `index.html` — entrée · `assets/js/app.js` — entrée JS · `assets/css/` — styles globaux + par domaine
- `assets/js/config/` — Firebase · `assets/js/data/firestore.js` — **toute** la couche d'accès Firestore
- `assets/js/core/` — état global + câblage · `assets/js/shared/` — helpers · `assets/js/features/` — métier (découplés)
- `docs/` — `architecture.md`, `migration-plan.md`, `firestore-rules.md`, `security.md`, `vtt-decomposition.md`, `window-globals-inventory.md`

## Index — où chercher directement (ne pas re-explorer)

### core/ (câblage)
`state.js` source unique de vérité (`STATE`, `setPage`) · `navigation.js` router + `FEATURE_MAP` (page→import lazy) + délégation d'événements · `actions.js` registry `data-action` · `auth.js` connexion · `adventure.js` sélection d'aventure (démarre présence/session) · `init.js` bootstrap · `layout.js` rendu app/auth/aventure.

### Page → module feature (lazy via `FEATURE_MAP` dans navigation.js)
La plupart : id = fichier. Exceptions : `recettes`→`recipes.js`, `bestiaire`→`bestiary.js`, `map`→`map.js` (shim vers `features/map/`), `vtt`→`features/vtt/vtt.js`. Importé une fois puis caché par le navigateur.

### Feature → fichier (`assets/js/features/`)
Personnages `characters.js` (+ sous-dossier `characters/`) · Boutique `shop.js` + `shop-export.js` (export/import JSON/CSV/MD, module leaf recevant un contexte injecté depuis shop.js) · PNJ & affinités `npcs.js` · Trame/narration `story.js` (écriture) + `histoire.js` (éditeur mission, lecture via `shared/histoire-ctx.js`) · Bastion `bastion.js` · Monde/règles `world.js` · Hauts-faits `achievements.js` · Collection `collection.js` · Roster `players.js` · Recettes/craft `recipes.js` · Bestiaire `bestiary.js` · Compte `account.js` · Carte `map/` · Aventures (admin) `aventures.js` · VTT — `features/vtt/vtt.js` (coeur canvas/tokens/combat/inspector/tray/chat, cohésif) + modules périphériques dans `features/vtt/` : fog/murs/lumière `vtt-fog.js`, état partagé `vtt-state.js` (objet `VS`), musique `vtt-music.js`, butin `vtt-loot.js`, court repos `vtt-rest.js`, overlay combat `vtt-combat-tracker.js`, dés libres `vtt-dice.js`, présence `vtt-presence.js`, minuteur `vtt-timer.js`, mini-fiche perso `vtt-mini-fiche.js` (déc. `docs/vtt-decomposition.md`) · Groupes/quêtes via `story.js` + dashboard · Agenda/dispos `agenda.js` · Artisanat `artisan.js` · Dashboard/accueil `pages.js` · Recherche Ctrl+K `command-palette.js`.

### Sous-modules
`features/characters/` : `combat.js`, `equipment.js`, `inventory.js`, `spells.js` + `spells-calc.js` (calcul pur), `forms.js`, `tabs.js`, `inline-edit.js`, `quick-view.js`, `data.js`, `export.js` + onglets de fiche V3 extraits de `characters.js` : `ledger.js` (Compte), `journal.js` (Notes/Quêtes/Relations), `profil.js` (radar/identité/bio). Ces onglets re-render via le seam `charSession.renderTab(tab,…)` et sont câblés dans le registre de `characters.js` (le sous-module exporte, `characters.js` importe).
`features/map/` : `index.js` (expose `initMap`), `map.controller.js` (orchestrateur), `map.state.js` (pub/sub), `render/` (markers, fog, viewport), `ui/` (formulaires, sidepanel, settings), `data/*.repo.js` (accès Firestore par entité).

### Helpers partagés (`assets/js/shared/`) — réutiliser avant de recoder
HTML/chaînes `html.js` · Toast `notifications.js` (`showNotif`) · Modale `modal.js` · CRUD récurrent `crud.js` · Rendu de liste `list-renderer.js` · Abonnements `realtime.js` · Or des persos `economy.js` · Stats perso `char-stats.js` · Contexte fiche courante `char-session.js` · Inventaire (normalisation "1 entrée=1 unité") `inventory-utils.js` · Équipement `equipment-utils.js` · Éditeurs contenteditable `rich-text.js` · Image `image-upload.js`/`image-crop.js`/`upload-cloudinary.js` · Sorts `spell-matrices.js`/`spell-runes.js`/`spell-action-card.js` · Règles `conditions.js`/`damage-types.js`/`weapon-formats.js` · Présence `presence.js` · Thème `theme.js` · localStorage `local-storage.js` · Sortable `sortable-helper.js` · Délégation scopée `scoped-actions.js`.

## Câblage UI → code (4 systèmes coexistants — savoir lequel s'applique)
1. **Global (cible propre)** : HTML `data-action="x"` / `data-change` / `data-input` → la feature fait `registerActions({ x: (btn, event) => … })` ; dispatch dans `navigation.js`.
2. **Scopé par préfixe** (shop, bestiary, players) : `bindScopedActions('sh', handlers)` + HTML `data-sh-action="open"` (option `data-sh-on="input"`). Voir `shared/scoped-actions.js`.
3. **VTT** : dispatcher propre `data-vtt-fn` + registre local `VTT_ACTIONS` dans `features/vtt/vtt.js` ; quelques fallbacks `window.*` subsistent uniquement pour compat ciblée.
4. **Legacy** : compat de données + quelques ponts applicatifs `window.*` suivis dans `docs/window-globals-inventory.md`. Les usages navigateur natifs (`scrollTo`, `getSelection`, `addEventListener`, `Konva`) ne sont pas une dette à supprimer.

## Méthode de travail
1. Lire l'existant et les fichiers liés avant de conclure.
2. Réutiliser helpers / patterns / conventions déjà présents (ne pas re-créer).
3. Choisir l'option **la plus simple compatible avec l'existant** : patch local, pas refonte ; pas d'archi "enterprise" ni de sur-abstraction pour un besoin simple.
4. Respecter le style du fichier modifié, imports minimaux.
5. Signaler les **vrais** risques et les tests manuels utiles.

En cas d'hésitation : robuste > élégant, patch net > grande réorganisation, une seule recommandation > trois pistes.

## Refactor (quand demandé)
But : réduire taille/duplication/verbosité **sans changer le comportement observable**.
- Privilégier : extraction de helpers locaux, factorisation de logique répétée, clarification des flux verbeux, suppression de branches mortes sûres.
- Éviter : refactors transverses durs à vérifier, renommages massifs sans gain, mélange structure+style+comportement, optimisation "maligne" fragile.
- Ne jamais sacrifier la fiabilité pour alléger.

## QUOTA Firestore — priorité absolue (lectures/écritures facturées)

**Toujours passer par `assets/js/data/firestore.js`.** Ne jamais importer `config/firebase.js` dans une feature pour lire/écrire. API : `loadCollection`, `getDocData`, `subscribeCollection`, `saveDoc`, `addToCol`, `updateInCol`, `deleteFromCol`, ou `shared/realtime.js` (`watch`/`watchDoc`/`watchPageCollection`/`watchPageDoc`). Seules exceptions assumées : `features/vtt/vtt.js` / `features/vtt/vtt-fog.js` et petits modules VTT temps réel tactique.

Cache déjà en place (ne pas réinventer) :
1. **Session-live** : un `onSnapshot` unique par collection/doc vivant toute la session → page qui le consomme = **0 lecture en plus**. Couvre `story`, `achievements`, `quests`, `characters`, `collection` + lazy (`shop`, `shopCategories`, `npcs`, `organizations`, `players`) + docs (`bastion/main`, `world/main`, `agenda_session/next`…).
2. **Cache TTL mémoire** (`_CACHE_TTL`/`_DOC_CACHE_TTL`) pour le page-scoped.
3. **Cache IndexedDB Firestore** à froid. + coalescing in-flight + patch chirurgical du cache après écriture.

Réflexes avant tout accès :
- S'abonner via `watchPageCollection`/`watchPageDoc` : si session-live, zéro nouveau listener.
- Écriture pendant drag/slider/saisie → commit au `dragend`/`change`/blur ou debounce, **jamais par frame/keystroke** (réf. tokens VTT).
- Timer/heartbeat/autosave → **suspendre quand `document.hidden`** (réf. `shared/presence.js`). La présence expire à 120 s côté lecture.
- Collection abonnée = bornée ; éphémères (pings, reactions) keyées par uid (1 doc/joueur).
- Filtrer côté client sur le cache live (`loadCollectionWhere`) plutôt que multiplier les `where` serveur.
- Une modif de données/permissions peut nécessiter une MAJ des règles Firestore → le rappeler.

## UI / UX
- Lisible immédiatement ; densité OK si la hiérarchie reste nette ; actions principales évidentes.
- Cartes/panneaux/modales/fiches : structure stable. Couleurs = hiérarchiser l'info, pas décorer.
- Sur écran chargé : simplifier la lecture avant d'ajouter. Pas de redesign ni d'effets gratuits qui nuisent à la clarté ou à la rapidité ; ne pas casser l'identité du projet.
- Desktop prioritaire sans casser mobile.

## Debug
Repro probable → flux de données → listeners/imports/exports → effets de bord DOM → accès Firestore & permissions.

## Format de réponse (sauf demande contraire)
Aller droit au but, pas de blabla. Structure : **Résumé** (objectif 1-2 lignes) · **Plan** · **Fichiers** (lus/modifiés) · **Patch** (localisé) · **Tests** (manuels utiles) · **Risques** (réels uniquement).
