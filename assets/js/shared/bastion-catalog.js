// Détermine si un document Bastion doit récupérer l'ancien catalogue de salles.
// Pur et sans dépendance Firebase afin de couvrir la migration par des tests Node.
export function shouldRestoreLegacyBastionCatalog(source = {}, {
  isLegacyAdventure = false,
  legacySlugs = [],
} = {}) {
  if (!source || typeof source !== 'object') return false;

  // Un catalogue stocké et non vide reste toujours prioritaire.
  if (Array.isArray(source.roomCatalog) && source.roomCatalog.length > 0) return false;
  if (isLegacyAdventure) return true;

  // Les anciens champs prouvent que cette aventure utilisait déjà le Bastion.
  if (Array.isArray(source.customRooms) && source.customRooms.length > 0) return true;
  if (source.catalogOverrides && typeof source.catalogOverrides === 'object'
      && Object.values(source.catalogOverrides).some(Boolean)) return true;

  const known = new Set(legacySlugs);
  if (source.salles && typeof source.salles === 'object'
      && Object.keys(source.salles).some(slug => known.has(slug))) return true;

  return Array.isArray(source.personnel)
    && source.personnel.some(employee => known.has(employee?.roomSlug));
}
