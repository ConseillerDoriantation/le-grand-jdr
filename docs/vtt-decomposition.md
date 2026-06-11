# Découpage de `vtt.js` (≈15 000 lignes)

`features/vtt.js` est le plus gros fichier de l'app (~23 % du JS), monolithe de la
feature la plus critique en séance live. Objectif : le découper en modules
cohérents **sans changer le comportement observable**. Campagne multi-PR, chaque
étape livrable et vérifiable isolément.

## L'obstacle (pourquoi ce n'est pas un simple couper-coller)

1. **136 variables mutables au niveau module** (`_stage`, `_session`, `_tokens`,
   `_activePage`, `_aimOpt`…) partagées **en closure** par des centaines de fonctions.
2. **Pas de build** → chaque fichier est un **vrai module ES** chargé séparément.
   Un binding `import`é est **en lecture seule** : un sous-module ne peut pas
   réassigner une variable importée (`_stage = …` impossible depuis un autre fichier).

→ On ne peut déplacer une fonction tant qu'elle écrit dans ces variables. Il faut
d'abord les regrouper dans **un objet d'état partagé** `VS` (`features/vtt-state.js`),
muté par propriété (`VS.stage = …`) et importé par tous les modules. **Même patron
que `features/map/map.state.js`** — modèle de référence déjà éprouvé dans le repo.

Le registre `VTT_ACTIONS` (objet littéral, fin de `vtt.js`) résout les handlers
`data-vtt-fn`. À terme chaque sous-module enregistrera ses handlers dans ce registre.

## Le plan

### Phase 0 — `vtt-state.js` : migrer l'état **partagé**, **en place** (vtt.js reste un fichier)
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
3. **Retirer** la déclaration `let _x` de `vtt.js` (vit désormais dans `vtt-state.js`).
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

## Avancement

- ✅ **Phase 0 — lot 1 (pilote, images/carte)** : `imgTr, imgTrFg, selImg, mapMode,
  mapLib, mapLibUnsub` → `VS.*`. `vtt-state.js` créé. (≈71 occurrences.)
- ✅ **Phase 0 — lot 2 (cœur de scène)** : `session, pages, tokens, activePage` →
  `VS.*`. (≈436 occurrences.) Smoke-test : pan/zoom, sélection token, attaque, sync
  multi-clients, changement de page/scène.
- ✅ **Phase 0 — lot 3 (reste du cœur partagé)** : `stage, layers, characters, npcs,
  bestiary, selected, tool` → `VS.*`. (≈348 occurrences.) **Cœur partagé complet.**
- ⏳ **Phase 1+ — extractions** : le cœur partagé étant dans `VS`, on peut sortir les
  modules un à un. Prochain : `vtt/chat.js` (état local `emotes/chatMsgs/chatReplyTo`
  déménage DANS le module ; lectures partagées via `VS`). Puis rest, tools-ruler, etc.
  selon le tableau. Borderline (`unsubs, resizeObs, attackSrc, moveHL, bstTracker`) :
  migrer vers `VS` seulement si une extraction le réclame.
