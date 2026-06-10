# Tests

Harnais minimal sur les **helpers purs** (sans DOM ni Firebase). Aucune dépendance :
le runner intégré de Node (`node:test`). Le navigateur et GitHub Pages ignorent
`package.json` — **le déploiement n'est pas touché**.

## Lancer

```bash
node --test          # auto-découverte des tests/*.test.js
# ou
npm test
```

Nécessite Node ≥ 18 (testé sur Node 24).

## Couverture (Phase 1)

| Fichier | Helper testé | Pourquoi |
|---|---|---|
| `spell-runes.test.js` | `calcSpellTargets`, `calcSpellDuration`, `runeCount` | Cibles/durée des sorts — logique recâblée plusieurs fois |
| `char-stats.test.js` | `getMod`, `calcCA/PVMax/PMMax`, `calcPalier`, `getItemStatBonus`, `getDefaultCharForUser`… | Maths de base + perso favori |
| `inventory-utils.test.js` | `normalizeInventaire`, `inventaireNeedsNorm` | Convention « 1 entrée = 1 unité » (migration silencieuse) |
| `participants.test.js` | `toggleQuestParticipant`, `dedupeQuestParticipants` | Groupes/participants (rejoindre, dédup, partenaires) |
| `spell-math.test.js` | `_calcAfflictionDot`, `_calcLaceration`, `_calcChance`, `_calcDrainPct`, `_calcConcentrationDD`, `_calcEnchantDegats`, `_hasLaceration` | Cœurs purs des sorts (DoT, lacération, crit, drain, concentration) |

## Phase 2 — cœurs purs des sorts

`spells-calc.js` est couplé à Firebase à l'import → non testable tel quel. Les
fonctions de calcul **purement basées sur l'objet sort** (DoT, lacération,
chance, drain, concentration, dégâts d'enchantement) ont donc été extraites dans
`assets/js/shared/spell-math.js` (zéro dépendance) et **ré-exportées** par
`spells-calc.js` → API publique inchangée, et maintenant testables.

## Hors périmètre

Ces tests ne couvrent **pas** le DOM, Firebase, la délégation d'événements ni le VTT.
Les calculs encore couplés à un perso/arme (`_calcSortDegats`, `_getSortCA`,
matrices MJ) restent hors-jeu. `node --check` reste utilisé en parallèle pour la
validation syntaxique.
