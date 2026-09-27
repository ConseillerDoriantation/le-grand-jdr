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

// Classe une action magique selon son effet RÉEL dans le VTT. Les compteurs
// peuvent se recouper (une affliction est aussi du contrôle), mais « tactique »
// exclut volontairement les attaques et les soins : ils disposent déjà de leurs
// propres mesures (dégâts/offense et soin/soutien).
export function classifySpellStatKinds(opt = {}) {
  const mods = opt.mods || {};
  const support = !!(
    opt.isCaSort
    || opt.isRegen
    || opt.isEnchant
    || mods.enchant
    || mods.regeneration
    || mods.enchantArmeDmg
    || mods.enchantPieds
    || mods.enchantGeneric
    || mods.enchantEtatId
    || mods.enchantToucher
    || mods.enchantMove
    || opt.enchantMode === 'etat'
    || opt.enchantEtatId
    || mods.rangeBuff
    || mods.hot
    || opt.category === 'support'
  );
  const affliction = !!(
    opt.isAffliction
    || mods.affliction
    || mods.laceration
    || opt.afflictionMode
    || opt.afflictionEtatId
  );
  const invocation = !!(
    opt.isInvocation
    || mods.invocation
    || mods.sentinelle
  );
  const movement = !!(
    mods.move
    || mods.push
    || mods.pull
    || mods.deplacement
    || opt.isDeplacement
  );
  const utility = !!(opt.isUtil || opt.isCaSort);
  const healing = !!(
    opt.isHeal
    || opt.isRegen
    || mods.regeneration
    || mods.hot
  );

  // Contrôle réel : entrave, déplacement imposé, invocation/sentinelle ou zone
  // purement utilitaire. Une AoE offensive ordinaire ne compte pas.
  const control = affliction || invocation || movement || !!(
    utility && (mods.zone || opt.zoneW > 0 || opt.zoneH > 0)
  );

  // Une zone ne suffit plus à rendre une attaque « tactique ». Il faut que
  // l'action soit une invocation, un déplacement ou un sort sans impact direct.
  const tactical = !healing && (invocation || movement || utility);
  return { tactical, support, affliction, control };
}
