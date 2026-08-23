/**
 * Résout le format et le type de dégâts réellement portés par une arme.
 * Les anciennes armes stockent le libellé du format, les plus récentes peuvent
 * en stocker l'id : les deux restent acceptés.
 *
 * Pour un format magique sans élément imposé, le lanceur peut choisir parmi
 * les types magiques configurés dans l'aventure. `preferredElements` permet de
 * placer ses affinités éventuelles en tête de liste sans masquer les autres.
 */
export function resolveWeaponDamageContext(formats = [], damageTypes = [], weapon = {}, preferredElements = []) {
  const formatRef = String(weapon?.formatId || weapon?.format || '').trim();
  const format = (formats || []).find(f => f?.id === formatRef || f?.label === formatRef) || null;
  const explicitTypeId = String(
    weapon?.damageTypeId || weapon?.elementId || weapon?.noyauTypeId || format?.damageType || ''
  ).trim();
  const explicitType = (damageTypes || []).find(type => type?.id === explicitTypeId) || null;
  const isMagic = format?.isMagic === true || explicitType?.isMagic === true;

  if (!isMagic) {
    return {
      format,
      isMagic: false,
      damageTypeId: explicitTypeId || 'physique',
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
