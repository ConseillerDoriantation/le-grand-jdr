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

export const VS = {
  // ── Images de fond/avant-plan + édition de carte (futur vtt/map-images) ──
  imgTr:       null,   // Konva.Transformer pour les images BG (sous les tokens)
  imgTrFg:     null,   // Konva.Transformer pour les images FG (au-dessus des tokens)
  selImg:      null,   // id de l'image sélectionnée
  mapMode:     false,  // true = édition carte activée (images déplaçables)
  mapLib:      { folders: [], images: [] }, // bibliothèque de cartes (world/mapLibrary)
  mapLibUnsub: null,   // unsubscribe du listener de la bibliothèque
};
