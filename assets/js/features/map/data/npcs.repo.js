// ══════════════════════════════════════════════════════════════════════════════
// NPCs repository — lecture seule des PNJ pour les afficher sur la carte.
// La gestion réelle des PNJ vit dans features/npcs.js ; ici on ne fait que lister.
// ══════════════════════════════════════════════════════════════════════════════

import { loadCollection } from '../../../data/firestore.js';

export async function listLinkedNpcs() {
  const npcs = await loadCollection('npcs').catch(() => []);
  return (npcs || []).filter(n => n?.id);
}
