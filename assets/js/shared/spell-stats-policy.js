// Politique de contribution d'un sort aux statistiques de campagne.
//
// Les anciennes actions d'objet ne portaient aucune provenance statistique :
// elles sont exclues par défaut pour que potions, parchemins et consommables ne
// transforment pas leur utilisateur en soigneur/lanceur de sorts. Un réglage MJ
// explicite garde néanmoins la possibilité de compter une action d'objet rare.

export function shouldTrackSpellStats(spell = {}, { source = 'spell' } = {}) {
  if (typeof spell?.countInStats === 'boolean') return spell.countInStats;
  // Alias de lecture pour d'éventuels documents expérimentaux/anciens.
  if (typeof spell?.excludeFromStats === 'boolean') return !spell.excludeFromStats;
  return source !== 'item';
}
