import { resolveWeaponFamily } from './weapon-family.js';

/**
 * Résout le type d'arme (ex-format) et le type de dégâts réellement portés par
 * une arme. Id ou libellé du format acceptés ; une arme dont l'ancien format
 * n'existe plus se rattache à son type saisi (voir weapon-family.js).
 *
 * Pour un format magique sans élément imposé, le lanceur peut choisir parmi
 * les types magiques configurés dans l'aventure. `preferredElements` permet de
 * placer ses affinités éventuelles en tête de liste sans masquer les autres.
 *
 * La NATURE (physique / magique) est découplée de la FAMILLE (Épée, Lance…) :
 * `weapon.nature` ('physique' | 'magique') prime sur `format.isMagic`. Ainsi une
 * même famille « Lance » (une seule maîtrise, un seul jeu de techniques) porte des
 * armes physiques ET magiques, la nature étant fixée sur CHAQUE arme (pas sur le
 * porteur). Sans `nature`, on retombe sur l'ancienne logique (famille magique ou
 * type imposé) → compat ascendante.
 */
export function resolveWeaponDamageContext(formats = [], damageTypes = [], weapon = {}, preferredElements = []) {
  const format = resolveWeaponFamily(formats, weapon);
  const explicitTypeId = String(
    weapon?.damageTypeId || weapon?.elementId || weapon?.noyauTypeId || format?.damageType || ''
  ).trim();
  const explicitType = (damageTypes || []).find(type => type?.id === explicitTypeId) || null;

  const nature = String(weapon?.nature || '').trim().toLowerCase();
  const isMagic = nature === 'magique' ? true
    : nature === 'physique' ? false
    : (format?.isMagic === true || explicitType?.isMagic === true);

  if (!isMagic) {
    // On conserve un type physique explicite (ex. « tranchant ») ; un éventuel
    // élément magique résiduel est ignoré car la nature physique prime.
    const physicalId = (explicitType && explicitType.isMagic !== true && explicitTypeId) ? explicitTypeId : 'physique';
    return {
      format,
      isMagic: false,
      damageTypeId: physicalId,
      elementIds: [],
    };
  }

  const magicIds = new Set((damageTypes || []).filter(type => type?.isMagic === true).map(type => type.id));
  const elementIds = [];
  [explicitTypeId, ...(preferredElements || []), ...magicIds].forEach(id => {
    if (magicIds.has(id) && !elementIds.includes(id)) elementIds.push(id);
  });
  return {
    format,
    isMagic: true,
    damageTypeId: elementIds[0] || null,
    elementIds,
  };
}
