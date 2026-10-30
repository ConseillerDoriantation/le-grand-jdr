// Projection compacte des builds dans le document personnage.
// Helper pur : aucune dépendance Firebase/DOM, afin de garder la règle testable.

const ACTIVE_BUILD_ROOT_FIELDS = [
  'photo', 'photoOriginal', 'photoZoom', 'photoX', 'photoY',
  'equipement', 'statsBonus',
  'stats', 'statsBase', 'statsLevelUps',
  'pvBase', 'pmBase',
];

const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));

// Un ancien build pouvait conserver un `photoOriginal` proche de 1 Mo. Comme
// les builds vivent tous dans le même document personnage, quelques portraits
// suffisaient à dépasser la limite Firestore. Les nouvelles images sont déjà
// compressées sous ce seuil ; les anciennes sont ramenées à leur portrait
// cadré lors de la prochaine écriture, sans casser leur affichage.
export const MAX_BUILD_ORIGINAL_CHARS = 180_000;

function compactInactiveBuildMedia(build) {
  const original = build?.photoOriginal;
  if (typeof original !== 'string' || !original.startsWith('data:image/') || original.length <= MAX_BUILD_ORIGINAL_CHARS) {
    return build;
  }
  if (build.photo) build.photoOriginal = build.photo;
  else delete build.photoOriginal;
  return build;
}

export function compactActiveBuildForStorage(builds = [], activeBuildId = '') {
  return (Array.isArray(builds) ? builds : []).map(build => {
    const compact = clone(build);
    if (compact?.id === activeBuildId) {
      ACTIVE_BUILD_ROOT_FIELDS.forEach(field => { delete compact[field]; });
    } else {
      compactInactiveBuildMedia(compact);
    }
    return compact;
  });
}
