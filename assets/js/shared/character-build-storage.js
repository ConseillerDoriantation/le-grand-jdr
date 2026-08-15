// Projection compacte des builds dans le document personnage.
// Helper pur : aucune dépendance Firebase/DOM, afin de garder la règle testable.

const ACTIVE_BUILD_ROOT_FIELDS = [
  'photo', 'photoZoom', 'photoX', 'photoY',
  'equipement', 'statsBonus',
  'stats', 'statsBase', 'statsLevelUps',
  'pvBase', 'pmBase',
];

const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));

export function compactActiveBuildForStorage(builds = [], activeBuildId = '') {
  return (Array.isArray(builds) ? builds : []).map(build => {
    const compact = clone(build);
    if (compact?.id === activeBuildId) {
      ACTIVE_BUILD_ROOT_FIELDS.forEach(field => { delete compact[field]; });
    }
    return compact;
  });
}
