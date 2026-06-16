// ══════════════════════════════════════════════════════════════════════════════
// VTT — Constantes d'affichage pures (aucune dépendance d'état/canvas/Firestore)
// ──────────────────────────────────────────────────────────────────────────────
// Module LEAF partagé par vtt.js et ses sous-modules → évite la duplication
// (ex. _VTT_RUNE_META était copié dans vtt.js ET vtt-mini-fiche.js) et les
// imports circulaires (mini-fiche importait _STAT_COLOR depuis vtt.js).
// ══════════════════════════════════════════════════════════════════════════════

// Taille d'une case de la grille en pixels monde (référence pour tous les
// calculs de position token/image/zone, et le rendu de la grille).
export const CELL = 70;

// Mapping abréviation compétence → clé getMod / couleurs associées.
export const _STAT_KEY   = { FOR:'force', DEX:'dexterite', CON:'constitution', INT:'intelligence', SAG:'sagesse', CHA:'charisme' };
export const _STAT_COLOR = { FOR:'#ef4444', DEX:'#22c38e', CON:'#f59e0b', INT:'#4f8cff', SAG:'#b47fff', CHA:'#fd6c9e' };
export const _STAT_RGB   = { FOR:'239,68,68', DEX:'34,195,142', CON:'245,158,11', INT:'79,140,255', SAG:'180,127,255', CHA:'253,108,158' };

// Types de buff manuels posables sur un token (mini-fiche / inspecteur).
export const _MS_BONUS_BUFF = {
  vitesse: { type: 'move_bonus',  icon: '👢' },
  ca:      { type: 'ca',          icon: '🛡' },
  portee:  { type: 'range_bonus', icon: '🏹' },
};

// Métadonnées d'affichage des runes de sort (icône + couleur).
export const _VTT_RUNE_META = {
  'Puissance':{icon:'⚔️',color:'#ef4444'}, 'Protection':{icon:'💚',color:'#22c38e'},
  'Amplification':{icon:'🌐',color:'#4f8cff'}, 'Dispersion':{icon:'🎯',color:'#a855f7'},
  'Enchantement':{icon:'✨',color:'#e8b84b'}, 'Affliction':{icon:'💀',color:'#8b5cf6'},
  'Invocation':{icon:'🐾',color:'#a16207'}, 'Lacération':{icon:'🩸',color:'#dc2626'},
  'Chance':{icon:'🍀',color:'#facc15'}, 'Durée':{icon:'⏱️',color:'#06b6d4'},
  'Concentration':{icon:'🧠',color:'#6366f1'}, 'Réaction':{icon:'🔄',color:'#ec4899'},
  'Action Bonus':{icon:'✴️',color:'#f97316'},
  'Déclenchement':{icon:'⚡',color:'#f97316'},
};
