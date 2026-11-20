export const RELATION_LEVELS = [
  { key: 'ennemi', label: 'Hostile', color: '#ff4757', description: 'Cherche activement à nuire' },
  { key: 'mefiance', label: 'Méfiant', color: '#ff9f43', description: 'Prudent, peu coopératif' },
  { key: 'neutre', label: 'Neutre', color: '#a0aec0', description: 'Ni ami ni ennemi' },
  { key: 'allie', label: 'Amical', color: '#4f8cff', description: 'Bienveillant, prêt à aider' },
  { key: 'lien', label: 'Allié', color: '#22c38e', description: 'Loyal, se battra à vos côtés' },
];

export function normalizeRelationText(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

export function relationKind(rel, getChar = () => null) {
  if (rel?.charId && getChar(rel.charId, null)) return 'pc';
  if (rel?.npcId) return 'npc';
  return 'free';
}

export function relationLevel(sent) {
  const index = RELATION_LEVELS.findIndex(level => level.key === String(sent || ''));
  return index < 0 ? null : index;
}

export function cleanRelationLabel(sentiment, sent) {
  const label = String(sentiment || '').trim();
  const level = RELATION_LEVELS[relationLevel(sent)];
  return label && (!level || normalizeRelationText(label) !== normalizeRelationText(level.label)) ? label : '';
}

function _relationName(entry) {
  return String(entry?.name ?? entry?.nom ?? entry?.rel?.nom ?? '').trim();
}

function _relationSent(entry) {
  return entry?.sent ?? entry?.rel?.sent ?? '';
}

export function sortRelations(list, mode = 'proximity') {
  return [...(list || [])].sort((a, b) => {
    const byName = _relationName(a).localeCompare(_relationName(b), 'fr', { sensitivity: 'base' });
    if (mode === 'az') return byName;
    const aLevel = relationLevel(_relationSent(a));
    const bLevel = relationLevel(_relationSent(b));
    return ((bLevel ?? -1) - (aLevel ?? -1)) || byName;
  });
}

// Retourne le premier avis déclaré sur `char` envers l'un des personnages fournis.
// Le second argument accepte aussi un personnage unique : pratique pour la cellule
// « En retour », sans imposer de forme différente aux tests et au rendu.
export function reciprocalRelation(char, chars) {
  const targets = Array.isArray(chars) ? chars : [chars];
  const ids = new Set(targets.map(target => typeof target === 'string' ? target : target?.id).filter(Boolean));
  return (char?.relations || []).find(rel => rel?.charId && ids.has(rel.charId)) || null;
}

export function pendingRelations(char, chars) {
  if (!char?.id) return [];
  const existing = new Set((char.relations || []).map(rel => rel?.charId).filter(Boolean));
  return (chars || []).filter(other => other?.id && other.id !== char.id
    && !existing.has(other.id)
    && Boolean(reciprocalRelation(other, char)));
}

function _wholeWordsContains(haystack, needle) {
  if (!needle) return false;
  const words = value => ` ${value.replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim()} `;
  return words(haystack).includes(words(needle));
}

export function relationNameMatch(rel, candidates) {
  const name = normalizeRelationText(rel?.nom);
  if (name.length < 3) return null;
  return (candidates || []).find(candidate => {
    const candidateName = normalizeRelationText(candidate?.nom);
    return candidateName === name
      || _wholeWordsContains(candidateName, name)
      || _wholeWordsContains(name, candidateName);
  }) || null;
}
