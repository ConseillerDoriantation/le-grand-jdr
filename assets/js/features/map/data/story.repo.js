// ══════════════════════════════════════════════════════════════════════════════
// Story repository — lecture seule des missions pour les afficher sur la carte.
// Une mission (collection `story`) a son texte dans `story_histories/{id}`, où
// les @lieu sont des <span class="htag htag--lieu" data-id="..."> (histoire.js).
// On en extrait les ids de lieux mentionnés. Réservé au MJ (contenu privé).
// ══════════════════════════════════════════════════════════════════════════════

import { loadCollection } from '../../../data/firestore.js';

export async function listMissionsWithPlaces() {
  const [missions, histories] = await Promise.all([
    loadCollection('story').catch(() => []),
    loadCollection('story_histories').catch(() => []),
  ]);
  const contentById = new Map((histories || []).map(h => [h.id, h.content || '']));
  return (missions || [])
    .filter(m => m?.id)
    .map(m => ({
      id: m.id,
      titre: m.titre || 'Mission',
      acte: m.acte || '',
      ordre: m.ordre || 0,
      placeIds: extractPlaceIds(contentById.get(m.id) || ''),
    }))
    .filter(m => m.placeIds.length)
    .sort((a, b) => a.ordre - b.ordre);
}

// Extrait les ids de lieux mentionnés dans le HTML rich-text d'une mission.
function extractPlaceIds(html) {
  if (!html) return [];
  const ids = new Set();
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    doc.querySelectorAll('.htag--lieu[data-id]').forEach(el => {
      if (el.dataset.id) ids.add(el.dataset.id);
    });
  } catch (_) { /* HTML invalide → ignoré */ }
  return [...ids];
}
