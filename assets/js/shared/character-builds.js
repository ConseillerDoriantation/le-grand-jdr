import { updateInCol } from '../data/firestore.js';
import { computeEquipStatsBonus } from './char-stats.js';

export const BUILD_FIELDS = [
  'photo', 'photoZoom', 'photoX', 'photoY',
  'equipement', 'statsBonus',
  'stats', 'statsBase', 'statsLevelUps',
  'pvBase', 'pmBase',
];

const DEFAULT_BUILD_ID = 'main';
const clone = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)));
const nowId = () => `b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const pick = (obj, key, fallback) => Object.prototype.hasOwnProperty.call(obj || {}, key) ? obj[key] : fallback;

export function snapshotBuildFromChar(c = {}, overrides = {}) {
  const equipement = clone(pick(overrides, 'equipement', c.equipement ?? {}));
  return {
    photo: pick(overrides, 'photo', c.photo ?? null),
    photoZoom: pick(overrides, 'photoZoom', c.photoZoom ?? 1),
    photoX: pick(overrides, 'photoX', c.photoX ?? 0),
    photoY: pick(overrides, 'photoY', c.photoY ?? 0),
    equipement,
    statsBonus: clone(pick(overrides, 'statsBonus', computeEquipStatsBonus(equipement))),
    stats: clone(pick(overrides, 'stats', c.stats ?? {})),
    statsBase: clone(pick(overrides, 'statsBase', c.statsBase ?? {})),
    statsLevelUps: clone(pick(overrides, 'statsLevelUps', c.statsLevelUps ?? {})),
    pvBase: Number(pick(overrides, 'pvBase', c.pvBase ?? 10)),
    pmBase: Number(pick(overrides, 'pmBase', c.pmBase ?? 10)),
  };
}

export function normalizeCharacterBuilds(c = {}) {
  const raw = Array.isArray(c.builds) ? c.builds.filter(Boolean) : [];
  let builds = raw.map((b, idx) => ({
    id: String(b.id || (idx === 0 ? DEFAULT_BUILD_ID : nowId())),
    name: String(b.name || b.nom || (idx === 0 ? 'Principal' : `Build ${idx + 1}`)),
    ...snapshotBuildFromChar(c, b),
  }));

  if (!builds.length) {
    builds = [{
      id: DEFAULT_BUILD_ID,
      name: 'Principal',
      ...snapshotBuildFromChar(c),
    }];
  }

  const ids = new Set();
  builds = builds.map((b, idx) => {
    const id = ids.has(b.id) ? nowId() : b.id;
    ids.add(id);
    return { ...b, id, name: b.name || (idx === 0 ? 'Principal' : `Build ${idx + 1}`) };
  });

  const activeBuildId = builds.some(b => b.id === c.activeBuildId) ? c.activeBuildId : builds[0].id;
  return { builds, activeBuildId };
}

export function getActiveBuild(c = {}) {
  const { builds, activeBuildId } = normalizeCharacterBuilds(c);
  return builds.find(b => b.id === activeBuildId) || builds[0];
}

export function applyActiveBuild(c = {}) {
  const { builds, activeBuildId } = normalizeCharacterBuilds(c);
  const active = builds.find(b => b.id === activeBuildId) || builds[0];
  if (!active) return c;
  BUILD_FIELDS.forEach(field => {
    if (Object.prototype.hasOwnProperty.call(active, field)) c[field] = clone(active[field]);
  });
  c.builds = builds;
  c.activeBuildId = active.id;
  return c;
}

export function patchBuildLocally(c = {}, patch = {}) {
  const { builds, activeBuildId } = normalizeCharacterBuilds(c);
  const idx = builds.findIndex(b => b.id === activeBuildId);
  if (idx < 0) return { builds, activeBuildId, active: null };
  const next = { ...builds[idx] };
  Object.entries(patch).forEach(([key, value]) => {
    if (BUILD_FIELDS.includes(key)) next[key] = clone(value);
  });
  if (patch.equipement && !patch.statsBonus) next.statsBonus = computeEquipStatsBonus(patch.equipement);
  builds[idx] = next;
  c.builds = builds;
  c.activeBuildId = activeBuildId;
  BUILD_FIELDS.forEach(field => {
    if (Object.prototype.hasOwnProperty.call(next, field)) c[field] = clone(next[field]);
  });
  return { builds, activeBuildId, active: next };
}

export function buildProjectionPatch(c = {}, build = null) {
  const active = build || getActiveBuild(c);
  const patch = { activeBuildId: active?.id || DEFAULT_BUILD_ID, builds: normalizeCharacterBuilds(c).builds };
  if (!active) return patch;
  BUILD_FIELDS.forEach(field => {
    if (Object.prototype.hasOwnProperty.call(active, field)) patch[field] = clone(active[field]);
  });
  return patch;
}

export async function saveBuildPatch(charId, c, patch = {}) {
  const { builds } = patchBuildLocally(c, patch);
  const active = getActiveBuild(c);
  const payload = buildProjectionPatch(c, active);
  payload.builds = builds;
  await updateInCol('characters', charId, payload);
  return payload;
}

export function createBuild(c = {}, { name = '', fromActive = true } = {}) {
  const { builds, activeBuildId } = normalizeCharacterBuilds(c);
  const source = fromActive ? builds.find(b => b.id === activeBuildId) || builds[0] : null;
  const build = {
    id: nowId(),
    name: name || `Build ${builds.length + 1}`,
    ...snapshotBuildFromChar(c, source || {}),
  };
  builds.push(build);
  c.builds = builds;
  c.activeBuildId = build.id;
  applyActiveBuild(c);
  return build;
}

export function renameBuild(c = {}, buildId, name = '') {
  const { builds, activeBuildId } = normalizeCharacterBuilds(c);
  const idx = builds.findIndex(b => b.id === buildId);
  if (idx >= 0) builds[idx] = { ...builds[idx], name: name.trim() || builds[idx].name };
  c.builds = builds;
  c.activeBuildId = activeBuildId;
  return builds[idx] || null;
}

export function deleteBuild(c = {}, buildId) {
  const { builds, activeBuildId } = normalizeCharacterBuilds(c);
  if (builds.length <= 1) return null;
  const next = builds.filter(b => b.id !== buildId);
  if (next.length === builds.length) return null;
  c.builds = next;
  c.activeBuildId = activeBuildId === buildId ? next[0].id : activeBuildId;
  applyActiveBuild(c);
  return getActiveBuild(c);
}

export function switchBuild(c = {}, buildId) {
  const { builds } = normalizeCharacterBuilds(c);
  const target = builds.find(b => b.id === buildId);
  if (!target) return null;
  c.builds = builds;
  c.activeBuildId = target.id;
  applyActiveBuild(c);
  return target;
}
