// ══════════════════════════════════════════════════════════════════════════════
// DASHBOARD-SUMMARY — Résumé compact du tableau de bord (pur, sans Firebase)
// ──────────────────────────────────────────────────────────────────────────────
// De la Trame, des Hauts-faits et de la Collection, le dashboard n'affiche que
// quelques titres et compteurs. Les relire en entier à chaque ouverture (base64
// compris) coûtait des centaines de lectures par joueur. Le client MJ tient à
// jour `settings/dashboardSummary` ; les joueurs ne lisent plus que ce document.
//
// Les MÊMES helpers servent au rendu complet (MJ, ou repli joueur sans résumé)
// et à la construction du résumé : les deux chemins affichent la même chose par
// construction. Firestore refuse `undefined` → les projections l'omettent.
// ══════════════════════════════════════════════════════════════════════════════

export const DASHBOARD_SUMMARY_VERSION = 1;
const ACHIEVEMENT_TOP = 5;
// Une URL (Cloudinary…) tient dans le résumé ; une image base64 non (seul
// `hasImage` la signale). La carte « Mission active » n'est de toute façon plus
// rendue au dashboard (`_missionCardV2` inutilisée) : rien n'est relu pour elle.
const INLINE_IMAGE_MAX = 4096;

const STORY_FIELDS = ['id', 'type', 'titre', 'nom', 'statut', 'acte', 'lieu', 'ordre'];
const ACHIEVEMENT_FIELDS = ['id', 'titre', 'nom', 'description', 'icone', 'xp', 'date'];

function _pick(source, keys) {
  const out = {};
  for (const key of keys) if (source?.[key] !== undefined) out[key] = source[key];
  return out;
}

const _list = value => (Array.isArray(value) ? value : []);

// ── Trame ────────────────────────────────────────────────────────────────────
export function pickActiveMission(items = []) {
  return _list(items)
    .filter(i => i?.type === 'mission' && i.statut === 'En cours')
    .sort((a, b) => (b.ordre || 0) - (a.ordre || 0))[0] || null;
}

export function compactStoryItems(items = []) {
  return _list(items).map(item => _pick(item, STORY_FIELDS));
}

// Détails propres à la mission active (texte + image), absents des items compacts.
export function activeMissionDetails(items = []) {
  const mission = pickActiveMission(items);
  if (!mission) return null;
  const image = typeof mission.imageUrl === 'string' ? mission.imageUrl : '';
  const inline = !!image && !image.startsWith('data:') && image.length <= INLINE_IMAGE_MAX;
  return {
    ..._pick(mission, ['id', 'description']),
    ...(inline ? { imageUrl: image } : {}),
    hasImage: !!image && !inline,
  };
}

// Items de Trame reconstitués côté joueur : compacts, la mission active enrichie.
export function storyItemsFromSummary(summary) {
  const items = _list(summary?.story?.items);
  const active = summary?.story?.active;
  return items.map(item => (active?.id && item.id === active.id
    ? { ...item, ..._pick(active, ['description', 'imageUrl']) }
    : { ...item }));
}

// ── Hauts-faits ──────────────────────────────────────────────────────────────
// 'jj/mm/aaaa' → 'aaaammjj'. Comparateur repris À L'IDENTIQUE de l'ancien rendu
// du dashboard (jamais 0) pour conserver exactement le même ordre affiché.
function _dateKey(d) {
  const [j, m, y] = String(d || '').split('/');
  return y && m && j ? `${y}${m.padStart(2, '0')}${j.padStart(2, '0')}` : '';
}

export function compareAchievementsByDateDesc(a, b) {
  return _dateKey(b?.date) > _dateKey(a?.date) ? 1 : -1;
}

// Hauts-faits secrets : invisibles des joueurs partout.
export function summarizeAchievements(list = [], { isAdmin = false } = {}) {
  const visible = isAdmin ? _list(list) : _list(list).filter(a => !a?.secret);
  const top = [...visible]
    .sort(compareAchievementsByDateDesc)
    .slice(0, ACHIEVEMENT_TOP)
    .map(a => _pick(a, ACHIEVEMENT_FIELDS));
  return { count: visible.length, top };
}

// ── Collection ───────────────────────────────────────────────────────────────
export function summarizeCollection(items = []) {
  const list = _list(items);
  return { total: list.length, unlocked: list.filter(c => c?.unlocked).length };
}

// ── Résumé complet ───────────────────────────────────────────────────────────
// Une source non fournie (non chargée côté MJ) garde la partie déjà stockée.
export function buildDashboardSummary({ story, achievements, collection } = {}, previous = null) {
  const keep = key => (previous?.[key] ? { [key]: previous[key] } : {});
  return {
    v: DASHBOARD_SUMMARY_VERSION,
    ...(Array.isArray(story)
      ? { story: { items: compactStoryItems(story), active: activeMissionDetails(story) } }
      : keep('story')),
    ...(Array.isArray(achievements)
      ? { achievements: summarizeAchievements(achievements, { isAdmin: false }) }
      : keep('achievements')),
    ...(Array.isArray(collection)
      ? { collection: summarizeCollection(collection) }
      : keep('collection')),
  };
}

const _validStory = s => !!s && Array.isArray(s.items) && (s.active === null || typeof s.active === 'object');
const _validAchievements = a => !!a && Number.isFinite(a.count) && Array.isArray(a.top);
const _validCollection = c => !!c && Number.isFinite(c.total) && Number.isFinite(c.unlocked);

// Utilisable si la Trame est présente, et chaque partie EXIGÉE aussi. Une partie
// non exigée (fonction premium non accessible) vaut « vide », comme aujourd'hui
// quand sa lecture est refusée. Sinon : repli sur la lecture complète.
export function isUsableSummary(doc, { achievements = true, collection = true } = {}) {
  if (!doc || doc.v !== DASHBOARD_SUMMARY_VERSION || !_validStory(doc.story)) return false;
  if (doc.achievements ? !_validAchievements(doc.achievements) : achievements) return false;
  if (doc.collection ? !_validCollection(doc.collection) : collection) return false;
  return true;
}

// Comparaison de contenu, hors horodatage (évite toute écriture inutile).
export function sameSummary(a, b) {
  const strip = value => {
    if (!value) return null;
    const { updatedAt: _ignored, id: _id, ...rest } = value;
    return rest;
  };
  return _stableJson(strip(a)) === _stableJson(strip(b));
}

function _stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(_stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${_stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}
