# Suivi dette `window.*`

Date : 2026-05-31

Objectif : reduire les globals applicatifs exposes sur `window` sans casser les
flux encore bases sur `data-action`, les modules lazy et les anciens handlers.

## Versionning

### v0 - Baseline audit

- Mesure initiale : 1 631 occurrences de `window.` dans le JS applicatif hors vendor.
- Risque principal : couplage implicite entre features lazy, handlers inline et etat module partage via globals.

### v1 - Nettoyage modules compatibles actions

- Apres passe : 1 527 occurrences.
- Reduction : 104 occurrences.
- Modules traites : `aventures`, `agenda`, `quests`, `informations`, `recipes`, `characters/quick-view`, ponts associes dans `app`, `init`, `pages` et `command-palette`.
- Raison : ces modules avaient deja une structure compatible `registerActions` ou pouvaient appeler des exports ES par import dynamique. Le gain etait fort avec un risque limite.

### v2 - Boutique sans API globale publique

- Apres passe : 1 462 occurrences.
- Reduction cumulee : 169 occurrences.
- `features/shop.js` : 52 -> 0 occurrence de `window.`.
- Ajout de `shared/shop-session.js` pour partager le personnage actif entre boutique et artisan sans `window._shopCharId`.
- Exports ES ajoutes cote boutique : `renderShop`, `restockShopItem`, `sellInvItemFromShop`, `shopGoCat`, `shopFilterSearch`.
- Consommateurs migres : `artisan`, `characters/inventory`, `pages`, `command-palette`.
- Raison : la boutique etait devenue pilotable par `bindScopedActions`; garder une API globale large augmentait le risque de collisions et rendait les dependances lazy invisibles.

### v3 - Conditions partagees hors VTT global

- Ajout de `shared/conditions.js` comme lecture cachee de `world/conditions`.
- `shop` et `characters/spells` utilisent cette API au lieu de lire `window._vttGetConditionLibrary`.
- `vtt.js` conserve sa librairie interne, mais n'expose plus `_vttGetConditionLibrary` puisque plus aucun consommateur applicatif ne l'appelle.
- Raison : les sorts et les actions de items ont besoin des etats, mais ne doivent pas importer ni supposer que le VTT est charge. La source Firestore est plus stable pour des modules lazy independants.

### v4 - Hauts-Faits sans etat global

- Apres passe : 1 384 occurrences.
- Reduction cumulee : 247 occurrences.
- `features/achievements.js` : 71 -> 1 occurrence de `window.`. Le reste est `window.innerWidth`, usage navigateur natif pour le layout responsive.
- Etat des hauts-faits (`_achItems`, filtres, recherche, vue, lightbox) maintenant module-local.
- `pages.js` lit le shell via `getAchievementsShellState()` au lieu de `window._ach*`.
- Raison : la page etait deja pilotee par `registerActions`; les globals servaient surtout de cache implicite entre le shell `pages.js` et le module lazy. Un export ES rend cette dependance explicite.

### v5 - Bestiaire sans API globale

- Apres passe : 1 299 occurrences.
- Reduction cumulee : 332 occurrences.
- `features/bestiary.js` : 83 -> 0 occurrence de `window.`.
- Handlers bestiaire (`_bst*`) convertis en fonctions locales pilotees par `bindScopedActions('bst', ...)`.
- `pages.js` charge `renderBestiary()` par import dynamique au lieu de lire `window.renderBestiary`.
- `command-palette.js` ouvre une entree via `openBestiaryEntry()` exporte par le module au lieu de `window._bstOpen`.
- Suppression du pont qui copiait des handlers de sorts sur `window` depuis le bestiaire.
- Raison : le bestiaire etait un module lazy autonome avec son scope d'actions. Garder ses handlers sur `window` rendait les dependances avec `pages`, la command palette et les sorts implicites, alors qu'un export ES garde le chargement paresseux et clarifie le contrat public.

### v6 - PNJ sans API globale

- Apres passe : 1 211 occurrences.
- Reduction cumulee : 420 occurrences.
- `features/npcs.js` : 84 -> 0 occurrence de `window.`.
- Handlers PNJ, stats MJ, affinites groupe, affinites specifiques et historique convertis en fonctions locales ou exports ES.
- Etats temporaires de modales (`_afgDelta`, `_histEditDelta`, `_aftFormState`, `_selectedAfpTypeId`, `_currentAffinitePersoContext`) sortis de `window`.
- `command-palette.js` ouvre un PNJ via `selectNpc()` exporte par le module.
- `pages.js` charge `openNpcModal()` / `deleteNpc()` par import dynamique pour les anciens boutons du shell PNJ.
- Raison : le module PNJ concentrait beaucoup de handlers d'UI et d'etats de formulaire sur `window`, alors qu'ils ne sont utilises que dans le scope `npcs`. Les exports gardent les vrais points d'entree publics sans exposer tous les details des modales.

### v7 - Sorts : etat edition local

- Apres passe : 1 046 occurrences.
- Reduction cumulee : 585 occurrences.
- `features/characters/spells.js` : 174 -> 6 occurrences de `window.`.
- Etats de filtres (`_sortsSearch`, `_sortsView`, `_sortsTypeFilter`, `_sortsCatCollapsed`) sortis de `window`.
- Etats de modal (`_runeCountsEdit`, `_sortTypesEdit`, `_sortActionEdit`, `_deplModeEdit`, `_sortAllowedNoyauIds`) sortis de `window`.
- Caches matrices/types de degats (`_spellMatricesCache`, `_damageTypesCache`) devenus module-locaux.
- Handlers UI de sort (`_toggleSortType`, actions, modes, picker icone, suggestions, custom auto-values) convertis en fonctions locales appelees par `registerActions`.
- Suppression des exports historiques `window.editItemSpell` / `window.addItemSpell`; les consommateurs passent deja par import ES.
- Restent 6 `window.` volontairement conserves comme pont vers le rendu de `characters.js` (`_currentChar`, `_currentCharTab`, `_renderTab`, `renderCharSheet`).
- Raison : les filtres et la construction de sort etaient des etats purement locaux au module. Les conserver sur `window` exposait un etat transitoire fragile, notamment entre edition de sort personnage et edition d action objet.

### v8 - Dashboard/pages sans caches globaux

- Apres passe : 1 004 occurrences.
- Reduction cumulee : 627 occurrences.
- `features/pages.js` : 59 -> 23 occurrences de `window.`.
- Ajout de `shared/dashboard-session.js` pour partager les membres du groupe et les quetes dashboard sans `window._partyCharsCache` ni `window._dashQuestData`.
- Ajout de `shared/character-navigation.js` pour remplacer `window._targetCharId`.
- `characters/quick-view.js` lit le groupe dashboard et cible la fiche complete via modules partages.
- `pages.js` utilise les exports `char-stats` au lieu de `window.calcPVMax/calcPMMax/calcCA/calcOr`.
- `players.js` exporte `renderPlayersPage()` ; `pages.js` le charge par import dynamique au lieu de `window.renderPlayersPage`.
- Raison : le dashboard etait le dernier gros producteur de caches transverses sur `window`. Les modules partages rendent le contrat explicite et evitent de polluer l espace global pour une navigation ou une quick-view.

### v9 - Inventaire personnage : etats UI locaux

- Apres passe : 952 occurrences.
- Reduction cumulee : 679 occurrences.
- `features/characters/inventory.js` : 60 -> 7 occurrences de `window.`.
- Recherche inventaire, etat des categories ouvertes, calcul de reprise de vente, cibles de modal et caches du picker butin sortis de `window`.
- Handlers de stepper vente et picker butin (`_invmStep`, `_sellRefreshTotal`, `_loot*`) convertis en fonctions locales appelees par `registerActions`.
- Restent uniquement les ponts avec le shell `characters.js` : `renderCharSheet`, `_currentCharTab`, `_canEditChar`, `refreshOrDisplay`.
- Raison : l inventaire avait des etats temporaires de modale qui pouvaient survivre hors contexte personnage. Les garder module-locaux limite les collisions entre edition, vente, envoi, butin et navigation.

### v10 - Donnees personnage : admins config sans handlers globaux

- Apres passe : 905 occurrences.
- Reduction cumulee : 726 occurrences.
- `features/characters/data.js` : 45 -> 0 occurrence de `window.`.
- `features/characters.js` : 185 -> 183 occurrences, via appels directs aux exports admin data dans `registerActions`.
- Admins styles de combat, formats d armes, types de degats et matrices de sorts convertis en fonctions locales pilotees par `registerActions`.
- Suppression des handlers historiques `_addCombatStyle`, `_editCombatStyle`, `_backToStylesList`, `_addWeaponFormat`, `_deleteWeaponFormat`, `_addDmgType`, `_deleteDmgType`, `_switchSpellMatrixTab`, etc. exposes sur `window`.
- Raison : `characters/data.js` est un module de configuration appele depuis la fiche personnage. Ses modales n ont pas besoin d exposer leurs etats et handlers transitoires globalement ; garder uniquement des exports ES explicites reduit le risque de collision avec les autres sous-domaines personnage.

### v11 - Fiche personnage V3 : compte, journal, profil et inventaire locaux

- Apres passe : 805 occurrences.
- Reduction cumulee : 826 occurrences.
- `features/characters.js` : 183 -> 83 occurrences de `window.`.
- Onglet compte : filtres, mode recette/depense, ajout, suppression, pagination et edition inline sortis de `window._csV3Ledger*`.
- Onglet journal : sub-tab courant, note ouverte, edition de titre et actions relations sortis de `window._csV3*`.
- Onglet profil : tags, citation, identite, bio rich-text, visibilite joueur et cache presence branches sur fonctions locales et `getProfilCacheRef`.
- Onglet inventaire V3 : filtre categorie/recherche sorti de `window._csV3InvFilter`.
- Ajout d un mini-dispatch local `data-blur` dans `characters.js` pour remplacer les derniers `onblur=window._csV3...` sans etendre le dispatcher global.
- Raison : ces etats appartiennent a la fiche personnage chargee, pas a l objet global navigateur. Les garder locaux reduit fortement les collisions entre onglets, preserve les re-renders V3 et rend les dependances avec `characters/tabs.js` explicites.

### v12 - Personnage legacy : actions inventaire et tabs sans ponts morts

- Apres passe : 788 occurrences.
- Reduction cumulee : 843 occurrences.
- `features/characters.js` : 83 -> 77 occurrences de `window.`.
- `features/characters/tabs.js` : 34 -> 26 occurrences de `window.`.
- Correction d une collision d actions : `characters.js` n ecrase plus les handlers locaux `_invmStep`, `_lootSelect`, `_lootSetCat` et `_lootQte` de `characters/inventory.js`.
- `characters/inventory.js` enregistre maintenant directement `_invmStep`, comme les autres handlers de modale inventaire.
- `characters/tabs.js` exporte `allocStatPoint`, `addXpFromInput` et `toggleCompteHist` au lieu de les exposer via `window._allocStatPoint`, `window._csAddXp` et `window._toggleCompteHist`.
- Etat legacy de note ouverte et cache profil retires de `window` ; `characters.js` lit le cache via `getProfilCacheRef`.
- Raison : cette passe retire des ponts morts qui pouvaient masquer les handlers locaux deja corriges, et reduit le risque de regression sur les modales inventaire et les onglets legacy.

### v13 - Passe large modules moyens : artisan, equipement, forms, histoire

- Apres passe : 700 occurrences.
- Reduction cumulee : 931 occurrences.
- `features/artisan.js` : 30 -> 0 occurrence de `window.`.
- `features/characters/equipment.js` : 24 -> 1 occurrence de `window.`.
- `features/characters/forms.js` : 23 -> 4 occurrences de `window.`.
- `features/histoire.js` : 39 -> 23 occurrences de `window.`.
- Artisan : handlers `_artisan*` convertis en fonctions locales appelees directement par `registerActions`; le point d entree public reste l export ES `openArtisanModal`, deja consomme par la boutique.
- Equipement : etat de modale `_equipCompatibles` / `_equipSelectedMeta` sorti de `window`; reste seulement le pont de rendu vers la fiche personnage.
- Forms personnage : etats de creation MJ et edition des titres sortis de `window`; `confirmNewChar` devient un handler local.
- Histoire : handlers data-action sur sidebar, missions, handout et gestion de competences convertis en fonctions locales. Les handlers inline sensibles du picker/drag restent volontairement en compatibilite.
- Raison : ces modules etaient des gains moyens a faible couplage. Les traiter ensemble retire beaucoup de ponts morts sans toucher aux gros domaines plus risqués `vtt`, `bastion` et `story`.

### v14 - Trame sans API globale large

- Apres passe : 652 occurrences.
- Reduction cumulee : 979 occurrences.
- `features/story.js` : 51 -> 4 occurrences de `window.`.
- `features/command-palette.js` : le resultat Trame admin ouvre maintenant `editStory()` par import ES dynamique au lieu de passer par `window._stEditGroup`.
- `features/characters/combat.js` : `_toggleCharElement` devient l export ES `toggleCharElement`, appele directement par `characters.js`.
- Trame : etat d acte, preferences, zoom/pan carte, edition de liens, creation d acte et handlers de groupes convertis en fonctions module-locales appelees par `registerActions`.
- Reste volontaire dans `story.js` : pont navigateur `closeModalDirect`, contexte transversal `_histoireCtx` et navigation vers la page histoire.
- Raison : `story.js` etait le meilleur prochain ratio gain/risque. Ses handlers etaient deja declares via `data-action`; remplacer les exports globaux par des fonctions locales et exports ES rend le module lazy plus explicite et retire les collisions possibles avec les autres pages narratives.

### v15 - Bastion et World sans API globale

- Apres passe : 507 occurrences.
- Reduction cumulee : 1 124 occurrences.
- `features/bastion.js` : 90 -> 0 occurrence de `window.`.
- `features/world.js` : 13 -> 0 occurrence de `window.`.
- `features/command-palette.js` : 4 -> 1 occurrence (navigate importe directement).
- `features/story.js` : 4 -> 3 occurrences (navigate importe directement).
- Bastion : 44 handlers `_bastion*` convertis en fonctions locales par script de migration automatique ; `registerActions` appelle desormais directement sans intermediaire `window.*`.
- World : meme pattern, `Object.assign(window, {...})` supprime car aucun consommateur externe n appelait ces fonctions par `window.*`.
- Raison : `bastion.js` et `world.js` etaient deux modules autonomes sans sous-composants. Leur migration est mecanique et sans risque de regression croisee.

### v16 - Module de session personnage partagé

- Apres passe : 435 occurrences.
- Reduction cumulee : 1 196 occurrences.
- Ajout de `shared/char-session.js` : stocke le contexte courant de fiche (`currentChar`, `canEditChar`, `currentCharTab`) et les callbacks de rendu (`renderTab`, `renderSheet`, `refresh`).
- `features/characters.js` : 56 -> 14 occurrences. Appelle `charSession.set()` et `charSession.bindRender()` au rendu de fiche.
- `features/characters/spells.js` : 6 -> 0.
- `features/characters/inventory.js` : 7 -> 0.
- `features/characters/tabs.js` : 14 -> 0.
- `features/characters/combat.js` : 3 -> 0.
- `features/characters/inline-edit.js` : 3 -> 0.
- Raison : les 5 sous-modules etaient tous bloqués sur les memes 4 globals de shell (`_currentChar`, `_currentCharTab`, `_canEditChar`, `_renderTab`). Un module de session partagé evite d'importer le shell lourd `characters.js` depuis les sous-modules et rompt les dependances circulaires implicites.

### v17 - characters.js : notifications et filtres admin locaux

- Apres passe : 416 occurrences.
- Reduction cumulee : 1 215 occurrences.
- `features/characters.js` : 14 -> 3 occurrences (window.scrollTo/scrollY browser natif).
- `showNotif` et `notifySaveError` importes depuis `shared/notifications.js` au lieu de `window.showNotif`.
- `_charAdminFilter` et `_currentTopTab` convertis en variables module-locales.
- `Object.assign(window, {...})` reduit de ~70 entrees a 4 (charNavCardHtml, selectChar, filterAdminChars, showCharTab) — ponts lazy encore necessaires.

### v18 - players.js sans globals UI

- Apres passe : 409 occurrences.
- Reduction cumulee : 1 222 occurrences.
- `features/players.js` : 14 -> 2 occurrences (window.scrollTo browser natif).
- `__ppEditingPlayer`, `_ppUpdateVisiblePill`, `_ppRefreshVisCount` convertis en variables/fonctions module-locales.
- `confirmModal` importe depuis `shared/modal.js`.
- `navigate` importe depuis `core/navigation.js`.
- `window.STATE.characters` remplace par import direct de `STATE`.
- `window.renderCharSheet` remplace par `charSession.renderSheet`.

### v19 - pages.js : imports bastion directs et charSession

- Apres passe : 399 occurrences (apres v20 inclus).
- Reduction cumulee : 1 232 occurrences.
- `features/pages.js` : 23 -> 18 occurrences.
- `window.renderCharSheet` remplace par `charSession.renderSheet`.
- `window.getDefaultBastion`, `window.BASTION_EVENTS`, `window.calculerRevenuBastion` remplaces par imports ES directs depuis `features/bastion.js`.
- `window._showRPGToast` devient une variable module-locale.
- Restent 18 delegations `window.xxx?.()` vers des fonctions de modules lazy non encore exportes (bastion dashboard, recettes, world editing) — a traiter lors du refactor de ces modules.

### v20 - Petits fichiers : forms, equipment, character-photo, economy, command-palette

- `features/characters/forms.js` : 2 -> 0.
- `features/characters/equipment.js` : 1 -> 0.
- `features/character-photo.js` : 2 -> 0.
- `shared/economy.js` : `window.refreshOrDisplay` remplace par `charSession.refresh`.
- `features/command-palette.js` : `window.renderCharSheet` remplace par `charSession.renderSheet`.
- Ajout de 2 nouveaux fichiers de tests : `char-session.test.js` (9 tests) et `migrations.test.js` (8 tests).
- Total tests : 92 (7 fichiers → 9 fichiers).

### v21 - Passe finale hors VTT : core, shared et histoire-ctx

- Apres passe : 366 occurrences.
- Reduction cumulee : 1 265 occurrences.
- Ajout de `shared/histoire-ctx.js` : remplace `window._histoireCtx` entre `story.js` et `histoire.js`.
- `features/histoire.js` : 23 -> 21 (2 occurrences `_histoireCtx` remplacees par le module partage).
- `features/story.js` : 3 -> 2 (idem, reste `closeModalDirect` bridge pour `vtt.js`).
- `core/layout.js` : 3 -> 0. `openAdventureSwitcher` converti en export ES ; `navigate` importe depuis `navigation.js`. Fin des globals core/layout.
- `core/navigation.js` : 5 -> 0. `doLogin`, `doLogout`, `doRegister`, `switchAuthTab` importes depuis `auth.js` ; `showNotif` importe depuis `notifications.js`.
- `core/auth.js` : 4 -> 0. `showNotif` importe directement ; `_authUiBound` devient variable module-locale.
- `core/init.js` : 3 -> 1. `window.STATE` supprime (aucun consommateur externe) ; `window._runMigrationFromPicker` supprime (dead code — le bouton HTML correspondant n'existe pas).
- `shared/upgrade-settings.js` : 10 -> 0. Handlers `_upg*` convertis en fonctions locales appelees par `registerActions` ; `closeModal` importe directement.
- `shared/modal.js` : `window.confirmModal` supprime (aucun consommateur externe).
- `shared/upload-cloudinary.js` : `window._cloudinaryConfigure` / `window._cloudinaryHasConfig` supprimes (dead code).
- `app.js` : `openAdventureSwitcher` importe depuis `layout.js` au lieu de `window.*`.
- `features/pages.js` : 18 -> 15. `openAdventureSwitcher` importe directement ; entrees `filterAdminChars` et `editWorldContent` retirees du `registerActions` (redondant / dead code).
- Raison : cette passe cloture la migration de tous les modules accessibles sans Sprint 2 ni refactor VTT. Les restes sont soit browser natif, soit bloques par les inline handlers de `histoire.js`, soit des delegations lazy vers des fonctionnalites pas encore implementees dans leur module cible.

### v22 - VTT : fonctions locales + Object.assign centralisé

- Apres passe : 136 occurrences.
- Reduction cumulee : 1 495 occurrences.
- `features/vtt.js` : 262 -> 32 occurrences.
- 181 fonctions `window._vttXxx = ...` converties en `function _vttXxx(...)` locales.
- Un seul `Object.assign(window, { _vttXxx, ... })` centralise les 206 exports necessaires au dispatcher `data-vtt-fn` (qui lit via `window[fn]`).
- Variable etat `window._vttDelegSearch` convertie en variable module-locale.
- 4 fonctions closures (definies a l interieur d une autre fonction, capturant des variables locales) conservees comme assignments `window.*` : `_vttDeleteEmote`, `_vttEditEmote`, `_vttAddEmote`, `_vttSaveEmote`.
- `registerActions` passe de delegations `window.*?.()` a appels directs.
- `closeModalDirect` importe depuis `shared/modal.js` au lieu de `window.closeModalDirect`.
- Raison : le VTT a son propre dispatcher `data-vtt-fn` qui lit depuis `window`. Convertir les definitions en fonctions locales et centraliser les exports dans un bloc Object.assign rend le contrat public explicite, au lieu de 181 assignments disperses. Le dispatcher lui-meme peut etre migre vers un registre local lors d une prochaine passe.

## Restes principaux

Top fichiers restants apres v22 (total : 136) :

- `features/vtt.js` : 32 — Object.assign centralisé (dispatcher) + 4 closures + browser natif
- `features/histoire.js` : 21 — bloque par inline `onmousedown`/drag handlers (Sprint 2)
- `features/pages.js` : 15 — delegations lazy vers bastion dashboard, recettes, world editing
- `shared/rich-text.js` : 11 — tout `window.getSelection()` browser natif
- `features/vtt-fog.js` : 6 — Konva (`window.Konva`) + browser natif
- `features/map/render/viewport.js` : 4 — `window.addEventListener` browser natif
- `features/characters/export.js` : 4 — `window.open/print/close` browser natif
- `features/story.js` : 2 — `closeModalDirect` bridge pour `vtt.js`
- `shared/presence.js` : 2 — `window.addEventListener('beforeunload')` browser natif

Occurrences browser natif (ne pas toucher) : `scrollTo`, `scrollY`, `getSelection`, `addEventListener/removeEventListener`, `open`, `print`, `close`, `innerWidth/innerHeight`, `Konva`.

## Ordre recommande

1. `vtt.js` (32) : migrer le dispatcher `data-vtt-fn` de `window[fn]` vers un registre local (`VTT_ACTIONS`). Elimine le besoin de l `Object.assign` et des 4 closures. Supprime aussi le `closeModalDirect` bridge dans `story.js`.
2. `pages.js` (15) : se resorbe au fur et a mesure que les modules cibles (bastion dashboard, recettes) exportent leurs fonctions.
3. `histoire.js` (21) : necessite Sprint 2 — migration `onmousedown`/`ondragstart` → `data-action`.


## Garde-fous

- Ne pas remplacer un global si un handler inline le consomme encore.
- Preferer `registerActions` ou `bindScopedActions` quand le HTML porte deja des attributs `data-action` ou `data-*-action`.
- Preferer un export ES + import dynamique quand un autre module a besoin de appeler une feature lazy.
- Eviter de importer un module lourd pour lire un petit etat partage ; creer un module `shared/*` dedie quand la dependance est transversale.
- Apres chaque passe : verifier la syntaxe ES module, `git diff --check` et recompter `window.`.
