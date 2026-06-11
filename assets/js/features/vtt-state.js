// ══════════════════════════════════════════════════════════════════════════════
// VTT-STATE.JS — État mutable partagé de la Table de Jeu Virtuelle
// ══════════════════════════════════════════════════════════════════════════════
// Objectif : permettre le découpage de vtt.js (≈15k lignes) en modules.
// Problème : un module ES ne peut pas réassigner une variable `import`ée
// (binding en lecture seule). On regroupe donc l'état mutable de vtt.js dans
// CET objet unique `VS` (mutable par propriété), importé par vtt.js et ses
// futurs sous-modules — même patron que `features/map/map.state.js`.
//
// Migration incrémentale : les domaines sont déplacés ici un lot à la fois
// (rename `_x` → `VS.x`, sans changer le comportement). Voir
// docs/vtt-decomposition.md pour l'ordre des lots et le protocole de vérif.
// ══════════════════════════════════════════════════════════════════════════════

import { getCurrentAdventureId } from '../data/firestore.js';

// Id de l'aventure courante — contexte de scène partagé (utilisé par tous les
// helpers de refs Firestore de la VTT). Exporté pour que les sous-modules le
// résolvent sans dépendre de vtt.js (évite un import circulaire).
export const aid = () => getCurrentAdventureId();

export const VS = {
  unsubs: [],        // listeners Firestore actifs (détachés au teardown)
  // ── Cœur de scène (état partagé par la plupart des modules) ──
  session:    {},    // doc Firestore de la session VTT courante
  pages:      {},    // pageId → doc page (scènes de la table)
  tokens:     {},    // tokenId → doc token de la page active
  activePage: null,  // id de la page (scène) actuellement affichée
  stage:      null,  // Konva.Stage
  layers:     {},    // { bg, tokens, fx, ui… } → Konva.Layer
  characters: {},    // characterId → doc personnage (entités liées)
  npcs:       {},    // npcId → doc PNJ
  bestiary:   {},    // beastId → doc créature (bestiaire)
  selected:   null,  // id du token sélectionné
  tool:       'select', // outil d'interaction courant

  // ── Images de fond/avant-plan + édition de carte (futur vtt/map-images) ──
  imgTr:       null,   // Konva.Transformer pour les images BG (sous les tokens)
  imgTrFg:     null,   // Konva.Transformer pour les images FG (au-dessus des tokens)
  selImg:      null,   // id de l'image sélectionnée
  mapMode:     false,  // true = édition carte activée (images déplaçables)
  mapLib:      { folders: [], images: [] }, // bibliothèque de cartes (world/mapLibrary)
  mapLibUnsub: null,   // unsubscribe du listener de la bibliothèque
};
