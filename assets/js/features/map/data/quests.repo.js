// ══════════════════════════════════════════════════════════════════════════════
// Quests repository — lecture seule des quêtes pour les afficher sur la carte.
// La gestion réelle des quêtes vit dans features/quests.js ; ici on ne fait que lister.
// ══════════════════════════════════════════════════════════════════════════════

import { loadCollection } from '../../../data/firestore.js';

export async function listLinkedQuests() {
  const quests = await loadCollection('quests').catch(() => []);
  return (quests || []).filter(q => q?.id);
}
