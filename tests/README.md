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

## Hors périmètre

Ces tests ne couvrent **pas** le DOM, Firebase, la délégation d'événements ni le VTT.
Le calcul de dégâts des sorts (`spells-calc.js`) est couplé à Firebase à l'import →
non testable tel quel ; il faudrait d'abord extraire ses cœurs purs (phase 2).
`node --check` reste utilisé en parallèle pour la validation syntaxique.
