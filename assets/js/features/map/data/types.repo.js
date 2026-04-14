// Types de lieux : collection Firestore optionnelle + fallback local.
// Permet d'ajouter des types via la DB sans redéployer.
import { loadCollection } from '../../../data/firestore.js';

const FALLBACK = [
  { id: 'region',   label: 'Région',            icon: '🗺️', color: '#8a7cbf', order: 5  },
  { id: 'ville',    label: 'Ville',             icon: '🏙️', color: '#4f8cff', order: 10 },
  { id: 'village',  label: 'Village',           icon: '🏘️', color: '#22c38e', order: 12 },
  { id: 'district', label: 'Quartier',          icon: '🏘️', color: '#6fa8dc', order: 15 },
  { id: 'inn',      label: 'Auberge',           icon: '🍺', color: '#c19a5b', order: 20 },
  { id: 'temple',   label: 'Temple',            icon: '⛩️', color: '#d4b05f', order: 30 },
  { id: 'donjon',   label: 'Donjon',            icon: '⚔️', color: '#ff6b6b', order: 40 },
  { id: 'nature',   label: 'Nature',            icon: '🌿', color: '#90c46b', order: 50 },
  { id: 'ruines',   label: 'Ruines',            icon: '🏚️', color: '#b0956a', order: 55 },
  { id: 'poi',      label: "Point d'intérêt",   icon: '✨', color: '#e8b84b', order: 61 },
];

export async function listPlaceTypes() {
  try {
    const remote = await loadCollection('place_types');
    if (remote && remote.length) {
      return [...remote].sort((a, b) => (a.order || 0) - (b.order || 0));
    }
  } catch (_) { /* fallback silencieux */ }
  return FALLBACK;
}
