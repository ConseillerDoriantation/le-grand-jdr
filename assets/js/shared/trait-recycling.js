// Métadonnées de recyclage portées par les traits d'un objet.
// Les traits restent des chaînes pour préserver tous les consommateurs actuels ;
// `nonRecyclableTraits` ne contient que les noms explicitement verrouillés.

const normalize = value => String(value || '')
  .trim()
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLocaleLowerCase('fr');

export function nonRecyclableTraitNames(item = {}) {
  const traits = Array.isArray(item.traits) ? item.traits.map(String).filter(Boolean) : [];
  const explicit = Array.isArray(item.nonRecyclableTraits)
    ? item.nonRecyclableTraits.map(String).filter(Boolean)
    : [];
  // Migration douce : les anciens objets « signature » verrouillaient tous les
  // traits. Dès leur prochaine sauvegarde, ils recevront la nouvelle liste.
  return (explicit.length || !item.noRecycle)
    ? cleanNonRecyclableTraits(traits, explicit)
    : traits;
}

export function isTraitRecyclable(item = {}, traitName = '') {
  const locked = new Set(nonRecyclableTraitNames(item).map(normalize));
  return !locked.has(normalize(traitName));
}

export function recyclableTraits(item = {}, traits = item?.traits) {
  return (Array.isArray(traits) ? traits : []).filter(trait => trait && isTraitRecyclable(item, trait));
}

export function cleanNonRecyclableTraits(traits = [], locked = []) {
  const byName = new Map((Array.isArray(traits) ? traits : []).filter(Boolean).map(name => [normalize(name), String(name).trim()]));
  return [...new Set((Array.isArray(locked) ? locked : []).map(normalize))]
    .map(key => byName.get(key))
    .filter(Boolean);
}
