// ══════════════════════════════════════════════════════════════════════════════
// MAP — Point d'entrée (thin shim)
// La logique réelle vit dans features/map/. Ce fichier existe uniquement pour
// préserver l'import lazy de navigation.js (() => import('../features/map.js'))
// et maintenir la compat avec pages.js qui lit LIEU_TYPES pour la légende.
// ══════════════════════════════════════════════════════════════════════════════

export { initMap } from './map/index.js';

// Compat : pages.js lit `LIEU_TYPES` pour afficher la légende de la carte.
// Snapshot statique équivalent au fallback de data/types.repo.js — conservé
// ici pour rester synchrone (les anciens consommateurs faisaient `.map(...)`
// juste après l'import).
export const LIEU_TYPES = [
  { id: 'region',  label: 'Région',          color: '#8a7cbf', emoji: '🗺️' },
  { id: 'ville',   label: 'Ville',           color: '#4f8cff', emoji: '🏙️' },
  { id: 'village', label: 'Village',         color: '#22c38e', emoji: '🏘️' },
  { id: 'inn',     label: 'Auberge',         color: '#c19a5b', emoji: '🍺' },
  { id: 'temple',  label: 'Temple',          color: '#d4b05f', emoji: '⛩️' },
  { id: 'donjon',  label: 'Donjon',          color: '#ff6b6b', emoji: '⚔️' },
  { id: 'nature',  label: 'Nature',          color: '#90c46b', emoji: '🌿' },
  { id: 'ruines',  label: 'Ruines',          color: '#b0956a', emoji: '🏚️' },
  { id: 'special', label: "Point d'intérêt", color: '#e8b84b', emoji: '✨' },
];
