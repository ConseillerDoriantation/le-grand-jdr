// ══════════════════════════════════════════════════════════════════════════════
// SPELL-ZONES.JS — modèle « zones » v2 (fonctions PURES, aucune dépendance)
// ══════════════════════════════════════════════════════════════════════════════
// Source unique de vérité pour la géométrie des zones de sort, partagée entre la
// forge (spells-calc/spells) et le VTT (rendu de grille). Testée dans
// tests/spell-zones.test.js.
//
// Principe :
//   • Amplification = TAILLE d'UNE zone (croissance symétrique selon la forme).
//   • Dispersion    = NOMBRE de poses de cette zone (répète l'effet). count = 1 + nDisp.
// Formes pilotées par les runes : rect (Carré), cross (Croix), cone (Cône), ring (Anneau).
// Le losange ('diamond') reste un override MJ manuel (non produit par les runes).
// ══════════════════════════════════════════════════════════════════════════════

/** Formes de zone valides pilotées par les runes. */
export const ZONE_SHAPES = ['rect', 'cross', 'cone', 'ring', 'line'];

/** Nombre de poses de la zone / de l'effet (Dispersion = répétitions). 0 Disp = 1. */
export function _zoneCount(nbDisp) {
  return 1 + Math.max(0, parseInt(nbDisp) || 0);
}

/**
 * Le choix de FORME n'est possible qu'à partir de 2 Amplification (voir _zoneDims).
 * À 1 Amplification, la zone est toujours la ligne de base 1×3.
 */
export function _zoneShapeUnlocked(nbAmp) { return (parseInt(nbAmp) || 0) >= 2; }

/**
 * Dimensions (bounding-box) d'UNE zone selon la forme, pilotées par Amplification.
 * À 1 Amp, toute forme = la ligne de base 3×1 (le choix de forme se débloque à ≥2).
 *  - rect  (Carré pur) : 2→3×3, 3→5×5, 4→7×7 (2N−1)².
 *  - cross (Croix)     : plus symétrique d'envergure 2N+1 (2→5, 3→7), bras larges de 1 ;
 *                        même budget de cases que le carré au palier 2, mais +1 de portée.
 *  - cone  (Cône)      : depuis le lanceur, profondeur N+1, base 2·prof−1 (2→prof 3, base 5).
 *  - ring  (Anneau)    : couronne de rayon N (centre épargné), envergure 2N+1 (2→rayon 2, 5×5).
 *  - line  (Ligne)     : rayon droit large de 1 ; +2 cases par Amplification → longueur 2N+1
 *                        (1→3, 2→5, 3→7, 4→9). Peu de cases mais portée maximale en ligne
 *                        (pivote H/V avec R). Idéale pour percer une rangée / un couloir.
 * @returns {{w:number,h:number,shape:string,depth?:number,radius?:number}|null}
 */
/**
 * Prédicat de couverture EN CASES — source unique pour le rendu (cases surlignées)
 * ET le ciblage (un token est touché si sa case est couverte). (ci,ri) = index de
 * case dans la bounding-box de la zone (0..cols-1, 0..rows-1). `dir` = sens
 * d'ouverture du cône ('down' par défaut : apex en haut). Les cases se comptent en
 * ENTIER → aucune ambiguïté sur la grille.
 *  - rect  : toute la boîte.
 *  - cross : la colonne et la ligne centrales (un +).
 *  - ring  : la couronne en losange (distance de Manhattan = rayon) → centre épargné.
 *  - cone  : apex à un bord, +1 case de large par rang (1, 3, 5, …).
 */
export function _cellInShape(shape, ci, ri, cols, rows, dir = 'down') {
  const cc = (cols - 1) / 2, rc = (rows - 1) / 2;
  switch (shape) {
    case 'cross':   return ci === cc || ri === rc;
    case 'ring':    return (Math.abs(ci - cc) + Math.abs(ri - rc)) === Math.max(cc, rc);
    case 'diamond': return (Math.abs(ci - cc) + Math.abs(ri - rc)) <= Math.max(cc, rc);   // losange plein (override MJ)
    case 'cone':
      if (dir === 'up')    return Math.abs(ci - cc) <= (rows - 1 - ri);
      if (dir === 'left')  return Math.abs(ri - rc) <= (cols - 1 - ci);
      if (dir === 'right') return Math.abs(ri - rc) <= ci;
      return Math.abs(ci - cc) <= ri;   // down : apex en haut, s'ouvre vers le bas
    case 'line':   // boîte 1×L → toutes les cases de la boîte SONT la ligne (comme rect)
    case 'rect':
    default:      return true;
  }
}

/** Nombre de cases réellement couvertes par une forme (pour l'affichage forge/VTT). */
export function _zoneCellCount(shape, cols, rows, dir = 'down') {
  let n = 0;
  for (let ri = 0; ri < rows; ri += 1) {
    for (let ci = 0; ci < cols; ci += 1) {
      if (_cellInShape(shape, ci, ri, cols, rows, dir)) n += 1;
    }
  }
  return n;
}

export function _zoneDims(shape, nbAmp) {
  const n = parseInt(nbAmp) || 0;
  if (n < 1) return null;
  if (n === 1) return { w: 3, h: 1, shape: 'rect' };   // ligne de base — forme non débloquée
  switch (shape) {
    case 'cross': { const span = 2 * n + 1; return { w: span, h: span, shape: 'cross' }; }
    case 'cone':  { const depth = n + 1; return { w: 2 * depth - 1, h: depth, shape: 'cone', depth }; }
    case 'ring':  { const radius = n; const span = 2 * n + 1; return { w: span, h: span, shape: 'ring', radius }; }
    case 'line':  { const len = 2 * n + 1; return { w: len, h: 1, shape: 'line' }; }   // rayon droit (+2 cases / Amp)
    case 'rect':
    default:      { const s = 2 * n - 1; return { w: s, h: s, shape: 'rect' }; }
  }
}
