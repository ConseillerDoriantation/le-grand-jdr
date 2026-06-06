// ══════════════════════════════════════════════════════════════════════════════
// SHARED / SPELL-MIGRATIONS.JS — Migrations silencieuses du deck de sorts
//
// Lacération n'est plus une rune autonome : elle devient une BRANCHE d'Affliction
// (afflictionMode = 'laceration'). Cette migration convertit les sorts existants :
//   chaque rune « Lacération » → « Affliction », et afflictionMode = 'laceration'.
// Idempotente : ne touche que les sorts contenant encore la rune « Lacération ».
// ══════════════════════════════════════════════════════════════════════════════

/** Le deck contient-il au moins un sort avec la rune « Lacération » à migrer ? */
export function deckNeedsLacerationMigration(deck) {
  return Array.isArray(deck)
    && deck.some(s => Array.isArray(s?.runes) && s.runes.includes('Lacération'));
}

/** Migre un sort : rune Lacération → Affliction (branche Lacération). Pur. */
export function migrateSpellLaceration(s) {
  if (!s || !Array.isArray(s.runes) || !s.runes.includes('Lacération')) return s;
  const runes = s.runes.map(r => (r === 'Lacération' ? 'Affliction' : r));
  return { ...s, runes, afflictionMode: 'laceration' };
}

/** Migre un deck complet. Renvoie { changed, deck }. */
export function migrateDeckLaceration(deck) {
  if (!Array.isArray(deck)) return { changed: false, deck };
  let changed = false;
  const next = deck.map(s => {
    if (Array.isArray(s?.runes) && s.runes.includes('Lacération')) {
      changed = true;
      return migrateSpellLaceration(s);
    }
    return s;
  });
  return { changed, deck: changed ? next : deck };
}
