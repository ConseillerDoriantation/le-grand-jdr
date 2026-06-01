export const DAMAGE_INTERACTIONS = {
  'Résistance': { key: 'resistances', label: 'Résistances', short: '½', shortLabel: '½ dégâts', icon: '🛡️', color: '#4f8cff' },
  'Immunité':   { key: 'immunites',   label: 'Immunités',   short: 'Imm.', shortLabel: 'Aucun dégât', icon: '🚫', color: '#94a3b8' },
  'Absorption': { key: 'absorptions', label: 'Absorptions', short: 'Abs.', shortLabel: 'Soin', icon: '💚', color: '#b47fff' },
  'Faiblesse':  { key: 'faiblesses',  label: 'Faiblesses',  short: '×2', shortLabel: '×2 dégâts', icon: '💢', color: '#f59e0b' },
};

export const DAMAGE_RELATIONS = ['Absorption', 'Immunité', 'Résistance', 'Faiblesse']
  .map(name => ({ name, ...DAMAGE_INTERACTIONS[name] }));

export function previewDamageInteraction(typeId, beast) {
  if (!beast) return null;
  const id = typeId || 'physique';
  if (Array.isArray(beast.immunites)   && beast.immunites.includes(id))   return 'Immunité';
  if (Array.isArray(beast.absorptions) && beast.absorptions.includes(id)) return 'Absorption';
  if (Array.isArray(beast.faiblesses)  && beast.faiblesses.includes(id))  return 'Faiblesse';
  if (Array.isArray(beast.resistances) && beast.resistances.includes(id)) return 'Résistance';
  return null;
}

export function applyDamageTypeInteraction(dmgTotal, typeId, beast) {
  if (!beast) return { dmgTotal, interaction: null };
  const interaction = previewDamageInteraction(typeId, beast);
  if (interaction === 'Immunité') return { dmgTotal: 0, interaction };
  if (dmgTotal <= 0) return { dmgTotal, interaction: null };
  if (interaction === 'Absorption') return { dmgTotal: -dmgTotal, interaction };
  if (interaction === 'Faiblesse') return { dmgTotal: dmgTotal * 2, interaction };
  if (interaction === 'Résistance') return { dmgTotal: Math.max(1, Math.floor(dmgTotal / 2)), interaction };
  return { dmgTotal, interaction: null };
}
