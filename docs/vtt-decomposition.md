# Découpage de `vtt.js` (≈15 000 lignes)

`features/vtt/vtt.js` est le plus gros fichier de l'app (~23 % du JS), monolithe de la
feature la plus critique en séance live. Objectif : le découper en modules
cohérents **sans changer le comportement observable**. Campagne multi-PR, chaque
étape livrable et vérifiable isolément.

## Bilan (état final) — découpage à seams propres terminé

**vtt.js : 15034 → 12414 lignes (−2620, −17 %).** Extraits, chacun avec un couplage
faible (0–9 deps) et vérifié (audit → script → `node --check` → reverify → smoke-test) :

| Module | Lignes | Rôle |
|---|---|---|
| `features/vtt/vtt-state.js` | 55 | objet d'état partagé `VS` (le déverrouillage) |
| `vtt-mini-fiche.js` | 1001 | popup perso 4 onglets |
| `vtt-music.js` | 817 | sons & musique d'ambiance |
| `vtt-loot.js` | 404 | butin d'aventure |
| `vtt-rest.js` | 245 | court repos du groupe |
| `vtt-combat-tracker.js` | 153 | overlay d'ordre de combat |
| `vtt-dice.js` | 149 | lanceur de dés libre |
| `vtt-presence.js` | 148 | présence joueurs + heartbeat |
| `vtt-timer.js` | 109 | minuteur de session |
| (`vtt-fog.js` 938 — déjà séparé avant) | | fog / murs / lumière |

### Décision : on s'arrête là (volontairement)

Ce qui reste dans `vtt.js` — **canvas, rendu, tokens, combat/attaque, inspector, tray,
chat** — n'est PAS un assemblage de panneaux isolés : c'est **un moteur d'interaction
cohésif**. Mesuré : extraire le Tray exigerait **15 deps circulaires** (dont 7 fonctions
de rendu canvas) ; l'Inspector **42**. Les sortir transformerait `vtt.js` en **hub
d'imports circulaires bidirectionnels** — plus dur à raisonner qu'un cœur cohérent, et
risqué sur la feature live (cf. la régression `_miniTab`/`_damageTypes` sur la mini-fiche,
pourtant plus simple).

**Architecture cible (commerciale) : périphérie modulaire + cœur cohésif documenté.**
Pour aller plus loin proprement, il ne faut PAS des imports circulaires en plus, mais un
**vrai refactor du cœur de rendu** (extraire un `vtt-render.js` avec une interface nette :
grille, calques Konva, images, annotations) — gros chantier à part entière, à ne tenter
que sur une base de tests solide. Tant que ce n'est pas fait, le cœur reste ensemble.

## L'obstacle (pourquoi ce n'est pas un simple couper-coller)

1. **136 variables mutables au niveau module** (`_stage`, `_session`, `_tokens`,
   `_activePage`, `_aimOpt`…) partagées **en closure** par des centaines de fonctions.
2. **Pas de build** → chaque fichier est un **vrai module ES** chargé séparément.
   Un binding `import`é est **en lecture seule** : un sous-module ne peut pas
   réassigner une variable importée (`_stage = …` impossible depuis un autre fichier).

→ On ne peut déplacer une fonction tant qu'elle écrit dans ces variables. Il faut
d'abord les regrouper dans **un objet d'état partagé** `VS` (`features/vtt/vtt-state.js`),
muté par propriété (`VS.stage = …`) et importé par tous les modules. **Même patron
que `features/map/map.state.js`** — modèle de référence déjà éprouvé dans le repo.

Le registre `VTT_ACTIONS` (objet littéral, fin de `vtt.js`) résout les handlers
`data-vtt-fn`. À terme chaque sous-module enregistrera ses handlers dans ce registre.

## Le plan

### Phase 0 — `features/vtt/vtt-state.js` : migrer l'état **partagé**, **en place** (vtt.js reste un fichier)
Rename mécanique `_x` → `VS.x`, par **lots cohérents**. Zéro changement de comportement
(même objet, juste relocalisé). C'est le déverrouillage.

**Principe : seul l'état réellement partagé entre futurs modules va dans `VS`** — le
cœur de scène (`session, pages, tokens, activePage, stage, layers, characters, npcs,
bestiary, selected, tool`…) lu par beaucoup de domaines. L'état **local** à un domaine
(musique, dés, règle/annotations, loot, présence…) **reste en place** et déménagera
**dans son module** lors de son extraction (Phases 1+), pas dans `VS`. (Le lot pilote
« images/carte » a migré du local vers `VS` pour éprouver le protocole ; il pourra
rejoindre `vtt/map-images.js` plus tard — sans gravité.)

### Phases 1…n — carver un cluster par PR
Du **moins** couplé au **plus** couplé. Chaque PR : importe `VS`, déplace son cluster
+ ses handlers `VTT_ACTIONS` vers `features/vtt/<module>.js`, se teste isolément.

| Ordre | Cluster | Lignes (~, réf. initiale) | Cible |
|---|---|---|---|
| 1 | Chat & log de dés, émotes | 8996–10044 | `vtt/chat.js` |
| 2 | Court repos + vote groupe | 10089–10286 | `vtt/rest.js` |
| 3 | Outils règle MJ & annotations | 8088–8626 | `vtt/tools-ruler.js` |
| 4 | Conditions (états) + modal réglages | 10611–11446 | `vtt/conditions.js` |
| 5 | Tray MJ : pages/dossiers, placement tokens | 7563–8086, 10487–10610 | `vtt/tray.js` |
| 6 | Images BG/FG + édition carte | (migré Phase 0) | `vtt/map-images.js` |
| 7 | Combat : barre d'action + visée + émotes | 1941–2467 | `vtt/combat-bar.js` |
| 8 | Multi-ciblage + zones AoE | 5480–6971 | `vtt/targeting.js` |
| 9 | Rendu Konva (loader + shapes tokens) | 1030–1940 | `vtt/render/` |
| 10 | Sync Firestore + auto-sync tokens | 912–1029, 8627–8939 | `vtt/sync.js` |
| 11 | Fusion token↔entité (données effectives) | 468–910 | `vtt/effective-data.js` |
| 12 | **Attaque** (sélection, PM, multi-noyau, preview) | 2468–5479 | `vtt/attack/` (à re-subdiviser) |
| — | Core : dispatcher `data-vtt-fn` + `VTT_ACTIONS` | 52–344 | reste l'entrée `vtt.js` |

> Les n° de ligne sont la cartographie d'origine ; ils dérivent à chaque PR.
> Re-grep les bannières `// ═══` avant d'attaquer un cluster.

## Protocole de vérification (chaque lot / PR)

1. **Rename par limite de mot uniquement** : `\b_x\b` → `VS.x` (jamais un remplacement
   littéral — pièges de sous-chaîne : `_imgTr` ⊂ `_imgTrFg`, `_mapLib` ⊂ `_mapLibUnsub`).
   Variantes longues avant courtes. Outil : script Node jetable (le `\b` d'un
   `RegExp("\\b"+...)` passé via shell peut être mangé → préférer un **fichier** `.cjs`).
2. **Symétrie grep** : `\b_x\b` = 0 restant ; voisins non ciblés inchangés ; `VS.x` présent.
3. **Retirer** la déclaration `let _x` de `vtt.js` (vit désormais dans `features/vtt/vtt-state.js`).
4. **`node --check`** sur une copie `.mjs`.
5. **Smoke-test manuel** (impossible à automatiser ici : Konva + Firestore temps réel) —
   voir checklist ci-dessous.
6. Commit dédié, message `refactor(vtt): …`.

### Smoke-test manuel VTT (après chaque PR touchant un cluster actif)
- Entrer dans la table, charger une page avec tokens.
- Domaine migré du lot : pour **images/carte** → activer l'édition de carte (`mapMode`),
  déplacer/sélectionner une image BG et FG, ouvrir la bibliothèque de cartes.
- Pan/zoom, sélection de token, une attaque, un jet de dé, le chat.
- Vérifier la sync : une action visible chez un 2ᵉ client.

## Recette d'extraction d'un module (Phase 1) — exemple audité : musique

> ⚠️ **Limite de l'environnement** : `node --check` valide la *syntaxe*, **pas la
> résolution des imports**. Un identifiant oublié = `ReferenceError` au runtime,
> invisible ici. Toute extraction **doit être smoke-testée dans l'app avant merge**
> (le merge manuel des PR est la barrière de vérification).

**Audit du domaine musique/audio** (premier module recommandé, le plus isolé) :

- **Surface à déplacer vers `vtt-music.js`** :
  - 27 fonctions `~12530–13260` (`_vttPlaySound`, `_renderMusicPanel`, `_syncMusicPlayback`…)
  - ref-helpers Firestore `~453–457` (`_sonsCol, _sonRef, _playlistsCol, _playlistRef, _musicStateRef`)
  - `_vttPlColorSelect` (`~190`) + état local `~287–298` (`_sounds, _playlists, _musicState, _audioEl, _musicSearch, _musicSortables…`)
- **Couplages ENTRANTS** (restent dans vtt.js, appellent le module) :
  - sync Firestore `~8751` : `VS.unsubs.push(onSnapshot(_musicStateRef(), … _syncMusicPlayback(…)))`
  - teardown `~1001` : `_killAudio()`
  - registre `VTT_ACTIONS` : tous les `_vtt*` musique
- **Dépendances SORTANTES** :
  - réimporter d'autres modules : `Sortable, _esc, _norm, openModal, confirmModal, closeModalDirect, showNotif`, helpers Firestore (`onSnapshot, setDoc, updateDoc, deleteDoc, addDoc, getDoc, serverTimestamp`), `VS`, `aid`.
  - helpers transverses restants → **exporter de vtt.js** (petit import circulaire, OK car appelés au runtime) **ou** déplacer vers un futur `vtt-shared.js` : `_showCtxMenu` (3 appels), `_previewEl` (5), `_vttNoop` (3). *(`aid` et `_unsubs` déjà relocalisés dans vtt-state.js → plus de couplage.)*
- **Forme cible** : `vtt-music.js` exporte les handlers `_vtt*` + `_syncMusicPlayback` + `_killAudio` + `_closeMusicPanel` ; `vtt.js` les importe, les place dans le littéral `VTT_ACTIONS`, et les appelle aux points entrants `~8751`/`~1001`.
- **Vérif post-extraction** : `node --check` (les 2 fichiers) ; grep que plus aucun symbole musique n'est défini dans vtt.js ; **smoke-test musique** (lire un son, une playlist, pause/next/stop, sync chez un 2ᵉ client, supprimer/créer playlist).

## Avancement

- ✅ **Phase 0 — lot 1 (pilote, images/carte)** : `imgTr, imgTrFg, selImg, mapMode,
  mapLib, mapLibUnsub` → `VS.*`. `features/vtt/vtt-state.js` créé. (≈71 occurrences.)
- ✅ **Phase 0 — lot 2 (cœur de scène)** : `session, pages, tokens, activePage` →
  `VS.*`. (≈436 occurrences.) Smoke-test : pan/zoom, sélection token, attaque, sync
  multi-clients, changement de page/scène.
- ✅ **Phase 0 — lot 3 (reste du cœur partagé)** : `stage, layers, characters, npcs,
  bestiary, selected, tool` → `VS.*`. (≈348 occurrences.) **Cœur partagé complet.**
- ✅ **Phase 0 — lot 4 (helpers transverses pré-extraction)** : `_aid` → `aid` (export
  vtt-state.js, évite l'import circulaire) ; `_unsubs` → `VS.unsubs`. (≈45 occurrences.)
- ✅ **Phase 1 — extraction `vtt-music.js`** (817 l.) : 43 fonctions + état local +
  ref-helpers sortis de vtt.js (**15034 → 14303 l., ~730 retirées**). vtt.js importe
  25 symboles ; import circulaire `_showCtxMenu` (fonction hoisted, sûr) ; teardown
  via `_resetMusicState()`. Vérif statique : free-vars, orphelins, exports↔imports,
  doubles déclarations, `node --check` — tout vert. **⚠️ Reste à SMOKE-TESTER avant
  merge** (lecture son/playlist, pause/next/stop, sync 2ᵉ client, créer/suppr playlist).
- ✅ **Phase 1 — extraction `vtt-rest.js`** (245 l.) : court repos (15 fns, **aucun état
  local** — tout dans VS.session.shortRest). **14303 → 14098 l. (−205).** vtt.js importe
  10 symboles ; circulaire `_sesRef`/`_chrRef` (refs Firestore exportées de vtt.js).
  Vérif statique complète, `node --check` OK. **⚠️ smoke-test** : ouvrir 💤, voter le
  repos (multi-clients), MJ force/règle max/reset, vérifier régen ½ PV/PM.
- ✅ **Phase 1 — extraction `vtt-loot.js`** (404 l.) : butin d'aventure (19 fns, état
  local `_loot/_lootTakeState/…` + ref `_lootRef` déménagés ; teardown via
  `_resetLootState()`). **14098 → 13748 l. (−350).** Circulaire : `_chrRef` (déjà
  exporté). Le verify a attrapé un import oublié (`_closeLootPanel`) → corrigé.
  **⚠️ smoke-test** : ouvrir 💰, MJ ajoute objets (boutique/URL), déplacer réserve↔butin,
  un joueur prend un objet → inventaire perso ; vérifier sync 2ᵉ client.
- ✅ **Phase 1 — extraction `vtt-dice.js`** (149 l.) : lanceur de dés libre (10 fns,
  état local `_diceFormula/_diceFreeBonus/_diceFreeMode/_diceCloseOut`). **13748 →
  13634 l. (−114).** Circulaire : `_logCol` (le jet est diffusé dans vttLog). Pas de
  reset teardown. **⚠️ smoke-test** : 🎲 → composer une formule (dés + bonus), modes
  avantage/désavantage sur 1d20, lancer → résultat dans le log, visible par les autres.
- ✅ **Phase 1 — extraction `vtt-timer.js`** (109 l.) : minuteur de session (8 fns,
  état partagé VS.session.timer, seul l'intervalId `_timerTick` local). **13634 →
  13557 l. (−77).** Circulaire `_sesRef`. **⚠️ smoke-test** : démarrer/pause/reset le
  minuteur (MJ), éditer le libellé, vérifier qu'il tourne et est visible par tous.
- ✅ **Phase 1 — extraction `vtt-combat-tracker.js`** (153 l.) : overlay d'ordre de
  combat (6 fns, rendu d'après VS.tokens + données effectives ; état `_combatTab`).
  **13557 → 13433 l. (−124).** Circulaires : `_live` (données effectives) + `_select`
  (sélection token). **⚠️ smoke-test** : démarrer un combat → overlay haut-gauche,
  onglets alliés/ennemis, clic sur une ligne → focus token, tour suivant.
- ⚠️ **Régression attrapée (timer)** : `_timerStartTick` appelé par `_vttMountTable`
  n'était pas importé (classé « interne » à tort). Cause : l'ancien verify strippait
  les template-literals et avalait la zone. **Nouvelle vérif FIABLE** (`_reverify`,
  grep brut sans strip) intégrée → re-checke les 6 modules à chaque extraction.
- ✅ **Phase 0.x — état partagé des couplés → VS** : `presence, miniUid, miniCharId,
  bstTracker, selectedMulti, rollMode, rollBonus, rollHidden, diceSkills` (≈117 occ.).
  Débloque inspector/tray/mini-fiche/présence.
- ✅ **Phase 1 — extraction `vtt-presence.js`** (147 l.) : heartbeat + colonne joueurs
  (6 fns dont `_startPresence`/`_resetPresence` extraits **inline** de mount/teardown).
  **13433 → 13327 l. (−106).** Circulaires : `_sesRef, _pingRef, _renderMiniSheet,
  _renderTraySoon, _vttToggleMiniSheet`. Heartbeat quota-sensible préservé verbatim.
  **⚠️ smoke-test** : présence des joueurs (colonne, apparition/disparition), session
  live MJ, kick d'un joueur ; vérifier que le heartbeat tourne (pas de spam d'écritures).
- ✅ **Phase 1 — extraction `vtt-mini-fiche.js`** (999 l., la plus grosse) : popup
  perso 4 onglets (43 fns). **13327 → 12414 l. (−913).** Circulaires : `_chrRef,
  _MS_BONUS_BUFF, _STAT_COLOR` + 6 helpers d'affichage de sorts + `_renderPresenceCol`
  (mini↔présence). Import présence redirigé (`_renderMiniSheet/_vttToggleMiniSheet`
  viennent de mini-fiche). La vérif a attrapé 3 vrais bugs (duplicate export,
  `_STAT_COLOR`/`_renderPresenceCol` non importés) → corrigés. **⚠️ smoke-test** :
  clic sur un joueur → mini-fiche, onglets Combat/Équipement/Sorts/Inventaire/Notes,
  équiper/déséquiper, éditer une note, envoyer un objet.
- ✅ **Phase 1.x — leafs partagés `vtt-refs.js` + `vtt-constants.js`** (réduction du
  couplage circulaire, pas d'un cluster). Constat : aucun cluster *leaf* de taille ne
  reste (conditions/émotes sont tissés au combat/canvas → cf. décision « cœur cohésif »).
  À la place, on a sorti ce qui était **partagé sans état** :
  - `vtt-refs.js` (18 constructeurs de chemins Firestore, purs `aid()`+`db`) → **dice,
    loot, rest, timer n'importent plus RIEN de vtt.js** (leafs découplés) ; présence et
    mini-fiche réduits.
  - `vtt-constants.js` (`_STAT_KEY/_STAT_COLOR/_STAT_RGB`, `_VTT_RUNE_META`) → supprime la
    **duplication** de `_VTT_RUNE_META` (copié dans vtt.js ET mini-fiche) et l'import
    circulaire de `_STAT_COLOR`.
  Imports circulaires restants = uniquement de **vraies fonctions transverses** (`_live`/
  `_select`, `_showCtxMenu`, `_renderTraySoon`, helpers d'affichage de sorts), plus aucune
  donnée/ref. `node --check` + symétrie grep OK. **⚠️ smoke-test** : entrer dans la table,
  un jet de dé (log), ouvrir butin/court-repos/minuteur, présence joueurs, mini-fiche
  (runes affichées, couleurs de stats) — vérifier qu'aucun module ne casse au runtime.
- ✅ **Phase 1.x (suite) — `vtt-utils.js` + `_MS_BONUS_BUFF`** : `_vttPanelError`
  (frontière d'erreur de panneau, autonome : notifications + html) → leaf `vtt-utils.js` ;
  `_MS_BONUS_BUFF` (constante) → `vtt-constants.js`. Mini-fiche n'importe plus ces 2
  symboles depuis vtt.js. Reste circulaire mini-fiche↔vtt.js : `_damageTypes` (cache
  d'état) + 5 formules d'affichage de sorts (dont `_vttSortSoinFormula`, qui lit les
  caches `_damageTypes`/`_weaponFormats`). **Prochain vrai déblocage** = migrer ces 2
  caches vers `VS` (≈37 occ.) puis sortir un `vtt-spell-display.js` — mais ça touche tout
  le chemin combat/sorts → à faire avec smoke-test complet. `node --check` + grep OK.
- ✅ **Phase 1.x (suite) — leaf `vtt-spell-display.js`** (formules de sorts). Débloqué
  par la migration `damageTypes`/`weaponFormats`→VS : on sort les 10 symboles d'affichage
  de sorts (`_parseDice`, `_maxDice`, `_maxEffectDisplay`, `_effectDisplay`,
  `_vttSortDmgFormula`, `_vttSortSoinFormula`, `_vttAmpDispCircleSize`,
  `_vttSpellActionMode`, `_vttDisplayRunes`, `VTT_ACTION_RUNE`) vers un leaf pur
  (deps : equipment-utils, char-stats, VS). **Résultat : `vtt-mini-fiche.js` n'importe
  PLUS RIEN de vtt.js — totalement découplée.** vtt.js réimporte les 10 (tous utilisés).
  Vérif : aucune def restante dans vtt.js, def unique dans le leaf, aucun autre module
  concerné, `node --check` OK. **⚠️ smoke-test combat** : aperçu d'attaque (interaction
  résistance), formules dégâts/soin (mini-fiche + carte d'action), jets de dés (le roller
  réimporte `_parseDice`/`_maxDice`).
- ✅ **Phase 1.x (suite) — menu contextuel → `vtt-utils.js`** : le cluster générique
  `_showCtxMenu`/`_hideCtxMenu` (+`_CTX_ACTIONS`/`_ctxClose`, pur DOM) rejoint le leaf
  `vtt-utils.js`. **`vtt-music.js` n'importe plus rien de vtt.js → découplé.** (Le
  `_showCtxMenu(id)` de vtt-fog.js est une fonction homonyme distincte, non concernée.)
  Bilan : **6 sous-modules sur 8 totalement découplés** (dice, loot, rest, timer,
  mini-fiche, music). Restent couplés au cœur render/état : `vtt-combat-tracker`
  (`_live`/`_select`) et `vtt-presence` (`_renderTraySoon`).
- ⏳ **Phase 1 — reste** : Tray/Pages, Inspector (42 deps), `tools-ruler` (dessin/annot),
  Combat/attaque (gros), chat (couplage entrant massif). Les plus durs.
