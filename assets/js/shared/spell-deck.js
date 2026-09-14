/** Un sort « Toujours prêt » reste dans le Deck sans utiliser sa capacité. */
export function isAlwaysPreparedSpell(spell) {
  return spell?.alwaysPrepared === true;
}

/** Indique si un sort actif consomme réellement un emplacement du Deck. */
export function spellUsesDeckSlot(spell) {
  return !!spell?.actif && !isAlwaysPreparedSpell(spell);
}

/** Résumé canonique du Deck : sorts disponibles, capacité utilisée et exceptions. */
export function getDeckUsage(spells = []) {
  return (Array.isArray(spells) ? spells : []).reduce((usage, spell) => {
    if (!spell?.actif) return usage;
    usage.active += 1;
    if (isAlwaysPreparedSpell(spell)) usage.free += 1;
    else usage.used += 1;
    return usage;
  }, { active: 0, used: 0, free: 0 });
}

/** Un sort gratuit peut entrer dans le Deck même si sa capacité est pleine. */
export function deckHasRoomFor(spell, spells, deckMax) {
  if (spell?.actif || isAlwaysPreparedSpell(spell)) return true;
  if (!Number.isFinite(deckMax)) return true;
  return getDeckUsage(spells).used < Math.max(0, deckMax);
}
