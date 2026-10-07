// Adventure-scoped armor set bonuses.
// Firestore: world/armor_sets

const DOC_ID = 'armor_sets';

const EMPTY_MODIFIERS = Object.freeze({
  spellPmDelta: 0,
  toucherBonus: 0,
  damageReduction: 0,
});

const STAT_ROLL_TARGETS = Object.freeze([
  ['force', 'FOR'],
  ['dexterite', 'DEX'],
  ['constitution', 'CON'],
  ['intelligence', 'INT'],
  ['sagesse', 'SAG'],
  ['charisme', 'CHA'],
]);

const ROLL_MODE_LABELS = Object.freeze({
  advantage: 'Avantage',
  disadvantage: 'Desavantage',
});

const ROLL_MODE_VALUES = new Set(['advantage', 'disadvantage']);
const STAT_ROLL_ALIASES = Object.freeze({
  for: 'force',
  dex: 'dexterite',
  con: 'constitution',
  int: 'intelligence',
  sag: 'sagesse',
  cha: 'charisme',
});

export const LEGACY_ARMOR_SETS = Object.freeze([
  {
    id: 'leger',
    type: 'Légère',
    label: 'Léger',
    enabled: true,
    tone: 'light',
    color: '#22c38e',
    description: 'Réduit le coût des sorts de 2 PM.',
    modifiers: { spellPmDelta: -2, toucherBonus: 0, damageReduction: 0 },
  },
  {
    id: 'intermediaire',
    type: 'Intermédiaire',
    label: 'Intermédiaire',
    enabled: true,
    tone: 'medium',
    color: '#4f8cff',
    description: 'Ajoute +2 aux jets de toucher.',
    modifiers: { spellPmDelta: 0, toucherBonus: 2, damageReduction: 0 },
  },
  {
    id: 'lourd',
    type: 'Lourde',
    label: 'Lourd',
    enabled: true,
    tone: 'heavy',
    color: '#e8b84b',
    description: 'Réduit les dégâts subis de 2.',
    modifiers: { spellPmDelta: 0, toucherBonus: 0, damageReduction: 2 },
  },
]);

export const DEFAULT_ARMOR_SETS = Object.freeze([]);

let _settings = null;
let _baseSets = LEGACY_ARMOR_SETS;
let _loadPromise = null;
let _draft = [];
let _diceSkills = [];
let _adminUiPromise = null;
let _esc = value => String(value ?? '')
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
let openModal = null;
let closeModalDirect = null;
let confirmModal = null;
let showNotif = null;
let setModalCloseGuard = null;
let clearModalCloseGuard = null;

const _clone = value => JSON.parse(JSON.stringify(value));
const _num = value => {
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : 0;
};
// Variante flottante : le déplacement (« move ») se compte en pas de 1,5 m.
const _numF = value => {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : 0;
};
const _toneColor = tone => ({
  light: '#22c38e',
  medium: '#4f8cff',
  heavy: '#e8b84b',
  neutral: '#9ca3af',
})[tone] || '#9ca3af';
const ARMOR_SET_COLORS = Object.freeze([
  ['#22c38e', 'Vert'],
  ['#4f8cff', 'Bleu'],
  ['#e8b84b', 'Or'],
  ['#ff5a7e', 'Rouge'],
  ['#b47fff', 'Violet'],
  ['#2dd4bf', 'Turquoise'],
  ['#f97316', 'Orange'],
  ['#9ca3af', 'Neutre'],
]);
const _safeColor = (value, fallback = '#9ca3af') => {
  const raw = String(value || '').trim();
  return /^#[0-9a-f]{6}$/i.test(raw) ? raw : fallback;
};
const _renameKey = value => normalizeArmorSetKey(value);
const _textKey = value => String(value || '')
  .trim()
  .toLowerCase()
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/\s+/g, ' ');

function _emptyRollImpact() {
  return { statModes: {}, skillModes: [] };
}

function _emptyModifiers() {
  return {
    spellPmDelta: 0,
    toucherBonus: 0,
    damageReduction: 0,
    // Partie B — champs agrégés des nouveaux effets de palier. Présents dans le
    // modèle et calculés par getArmorSetData ; leur branchement combat se fait
    // effet par effet (certains sont encore masqués dans l'éditeur).
    caBonus: 0,
    damageBonus: 0,
    moveDelta: 0,
    saveBonus: {},
    resistances: [],
    rollImpact: _emptyRollImpact(),
  };
}

function _normalizeRollMode(value = '') {
  const mode = String(value || '').trim();
  if (mode === 'adv' || mode === 'avantage') return 'advantage';
  if (mode === 'dis' || mode === 'desavantage' || mode === 'disadvantage') return 'disadvantage';
  return ROLL_MODE_VALUES.has(mode) ? mode : '';
}

function _normalizeRollImpact(raw = {}) {
  const statModes = {};
  const sourceStats = raw?.statModes && typeof raw.statModes === 'object' ? raw.statModes : {};
  STAT_ROLL_TARGETS.forEach(([key]) => {
    const mode = _normalizeRollMode(sourceStats[key]);
    if (mode) statModes[key] = mode;
  });

  const seenSkills = new Set();
  const skillModes = (Array.isArray(raw?.skillModes) ? raw.skillModes : [])
    .map(rule => ({
      name: String(rule?.name || '').trim(),
      mode: _normalizeRollMode(rule?.mode),
    }))
    .filter(rule => {
      const key = _textKey(rule.name);
      if (!key || !rule.mode || seenSkills.has(key)) return false;
      seenSkills.add(key);
      return true;
    })
    .slice(0, 30);

  return { statModes, skillModes };
}

function _normalizeModifiers(modifiers = {}) {
  const normalized = _emptyModifiers();
  normalized.spellPmDelta = _num(modifiers.spellPmDelta);
  normalized.toucherBonus = _num(modifiers.toucherBonus);
  normalized.damageReduction = Math.max(0, _num(modifiers.damageReduction));
  normalized.caBonus = _num(modifiers.caBonus);
  normalized.damageBonus = _num(modifiers.damageBonus);
  normalized.moveDelta = Number((_numF(modifiers.moveDelta) || 0).toFixed(2));
  const sb = {};
  if (modifiers.saveBonus && typeof modifiers.saveBonus === 'object') {
    STAT_ROLL_TARGETS.forEach(([k]) => { const v = _num(modifiers.saveBonus[k]); if (v) sb[k] = v; });
  }
  normalized.saveBonus = sb;
  normalized.resistances = [...new Set((Array.isArray(modifiers.resistances) ? modifiers.resistances : []).map(x => String(x || '').trim()).filter(Boolean))];
  normalized.rollImpact = _normalizeRollImpact(modifiers.rollImpact || {});
  return normalized;
}

// ── Paliers (partie B) ────────────────────────────────────────────────────────
// Effet d'un palier : { kind, value?, mode?, target?, stat?, element? }.
const _TIER_KINDS = new Set(['toucher', 'pm', 'dr', 'roll', 'ca', 'dmg', 'save', 'resist', 'move']);
function _normalizeTierEffect(raw = {}) {
  const kind = _TIER_KINDS.has(raw.kind) ? raw.kind : null;
  if (!kind) return null;
  if (kind === 'roll') {
    const mode = _normalizeRollMode(raw.mode) || 'disadvantage';
    const target = String(raw.target || '').trim();
    if (!target) return { kind, mode, target: '' };
    return { kind, mode, target };
  }
  if (kind === 'save') return { kind, stat: String(raw.stat || 'constitution'), value: _num(raw.value) || 1 };
  if (kind === 'resist') return { kind, element: String(raw.element || raw.el || '').trim() || 'Feu' };
  const step = kind === 'move' ? 1.5 : 1;
  let v = kind === 'move' ? _numF(raw.value) : _num(raw.value);
  if (!v) v = kind === 'pm' ? -step : step;
  if (kind === 'dr' && v < 1) v = 1;
  return { kind, value: Number(v.toFixed(2)) };
}
// Effets dérivés de l'ancien `modifiers` (migration en lecture).
function _effectsFromModifiers(m = {}) {
  const out = [];
  if (_num(m.toucherBonus)) out.push({ kind: 'toucher', value: _num(m.toucherBonus) });
  if (_num(m.spellPmDelta)) out.push({ kind: 'pm', value: _num(m.spellPmDelta) });
  if (_num(m.damageReduction) > 0) out.push({ kind: 'dr', value: _num(m.damageReduction) });
  const im = _normalizeRollImpact(m.rollImpact || {});
  Object.entries(im.statModes).forEach(([k, mode]) => out.push({ kind: 'roll', mode, target: 'stat:' + k }));
  im.skillModes.forEach(r => out.push({ kind: 'roll', mode: r.mode, target: 'skill:' + r.name }));
  return out;
}
function _normalizeTiers(raw = {}, index = 0) {
  if (Array.isArray(raw.tiers)) {
    return raw.tiers.map(t => ({
      pieces: Math.max(1, parseInt(t?.pieces, 10) || 1),
      effects: (Array.isArray(t?.effects) ? t.effects : []).map(_normalizeTierEffect).filter(Boolean),
    }));
  }
  // Migration : ancien set tout-ou-rien → un palier « complet » (seuil élevé,
  // borné au nombre d'emplacements d'armure à la lecture). 99 = « set complet ».
  const effects = _effectsFromModifiers(raw.modifiers || {});
  return effects.length ? [{ pieces: 99, effects }] : [];
}
// Agrège une liste d'effets en un objet modifiers (champs existants + nouveaux).
function _aggregateTierEffects(effects = []) {
  const m = _emptyModifiers();
  const addRoll = (target, mode) => {
    if (!target || !mode) return;
    if (target.startsWith('stat:')) {
      const k = target.slice(5); const cur = m.rollImpact.statModes[k];
      m.rollImpact.statModes[k] = cur && cur !== mode ? 'normal' : mode;
    } else {
      const name = target.slice(6); const r = m.rollImpact.skillModes.find(x => x.name === name);
      if (r) r.mode = (r.mode !== mode ? 'normal' : mode); else m.rollImpact.skillModes.push({ name, mode });
    }
  };
  effects.forEach(e => {
    switch (e.kind) {
      case 'toucher': m.toucherBonus += _num(e.value); break;
      case 'pm': m.spellPmDelta += _num(e.value); break;
      case 'dr': m.damageReduction += _num(e.value); break;
      case 'ca': m.caBonus += _num(e.value); break;
      case 'dmg': m.damageBonus += _num(e.value); break;
      case 'move': m.moveDelta += _numF(e.value); break;
      case 'save': if (e.stat) m.saveBonus[e.stat] = (m.saveBonus[e.stat] || 0) + _num(e.value); break;
      case 'resist': if (e.element && !m.resistances.includes(e.element)) m.resistances.push(e.element); break;
      case 'roll': addRoll(e.target, e.mode); break;
    }
  });
  // Les modes 'normal' (avantage+désavantage annulés) sont retirés.
  Object.keys(m.rollImpact.statModes).forEach(k => { if (m.rollImpact.statModes[k] === 'normal') delete m.rollImpact.statModes[k]; });
  m.rollImpact.skillModes = m.rollImpact.skillModes.filter(r => r.mode && r.mode !== 'normal');
  m.moveDelta = Number(m.moveDelta.toFixed(2));
  return m;
}
// Paliers atteints à `count` pièces (seuils bornés à `maxPieces`), puis agrégés
// selon `cumulative`. Exporté pour getArmorSetData et l'éditeur.
export function armorSetAppliedTiers(set = {}, count = 0, maxPieces = Infinity) {
  const tiers = Array.isArray(set.tiers) ? set.tiers : [];
  const reached = tiers
    .map(t => ({ ...t, eff: Math.min(t.pieces, maxPieces) }))
    .filter(t => t.eff <= count)
    .sort((a, b) => a.eff - b.eff);
  return set.cumulative === false ? reached.slice(-1) : reached;
}
export function armorSetAggregateAtCount(set = {}, count = 0, maxPieces = Infinity) {
  return _aggregateTierEffects(armorSetAppliedTiers(set, count, maxPieces).flatMap(t => t.effects));
}

export function normalizeArmorSetKey(value = '') {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_-]/g, '');
}

function _normalizeSet(raw = {}, index = 0) {
  const type = String(raw.type || raw.label || '').trim();
  const key = normalizeArmorSetKey(type || raw.id || `set-${index + 1}`);
  const label = String(raw.label || type || raw.id || `Set ${index + 1}`).trim();
  const cumulative = raw.cumulative !== false;
  const tiers = _normalizeTiers(raw, index);
  const set = {
    id: normalizeArmorSetKey(raw.id || key) || `set-${index + 1}`,
    type,
    label,
    enabled: raw.enabled !== false,
    tone: raw.tone || 'neutral',   // conservé en lecture pour compat ; `color` fait foi
    color: _safeColor(raw.color, _toneColor(raw.tone || 'neutral')),
    description: String(raw.description || '').trim(),
    cumulative,
    tiers,
  };
  // `modifiers` reste présent (agrégat « set complet ») pour les lecteurs
  // historiques (formatArmorSetEffect, getArmorTypeMeta, getArmorSetRollModeFor).
  set.modifiers = _aggregateTierEffects(armorSetAppliedTiers(set, Infinity, Infinity).flatMap(t => t.effects));
  return set;
}

function _normalizeSettings(stored = {}, defaults = DEFAULT_ARMOR_SETS) {
  const source = Array.isArray(stored?.sets) ? stored.sets : defaults;
  const seen = new Set();
  const sets = source.map(_normalizeSet).filter(set => {
    const key = normalizeArmorSetKey(set.type || set.id);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { version: 1, sets };
}

export async function loadArmorSetSettings({ refresh = false } = {}) {
  if (_settings && !refresh) return _settings;
  if (_loadPromise && !refresh) return _loadPromise;
  _loadPromise = (async () => {
    let adventureId = '';
    try {
      const { getDocData, getCurrentAdventureId } = await import('../data/firestore.js');
      adventureId = getCurrentAdventureId();
      _baseSets = adventureId === 'le-grand-jdr'
        ? LEGACY_ARMOR_SETS
        : DEFAULT_ARMOR_SETS;
      _settings = _normalizeSettings(await getDocData('world', DOC_ID) || {}, _baseSets);
    } catch (_) {
      _baseSets = adventureId === 'le-grand-jdr' ? LEGACY_ARMOR_SETS : DEFAULT_ARMOR_SETS;
      _settings = _normalizeSettings({}, _baseSets);
    } finally {
      _loadPromise = null;
    }
    return _settings;
  })();
  return _loadPromise;
}

export function getArmorSetSettings() {
  return _settings || _normalizeSettings({}, _baseSets);
}

export function getArmorTypeOptions({ includeDisabled = false } = {}) {
  return (getArmorSetSettings().sets || [])
    .filter(set => includeDisabled || set.enabled !== false)
    .map(set => set.type)
    .filter(Boolean);
}

export function getArmorSetDefinition(type = '') {
  const key = normalizeArmorSetKey(type);
  if (!key) return null;
  return (getArmorSetSettings().sets || []).find(set =>
    set.enabled !== false && normalizeArmorSetKey(set.type) === key
  ) || null;
}

export function getEmptyArmorSetModifiers() {
  return _emptyModifiers();
}

function _formatArmorSetEffectLegacy(set = {}) {
  const mod = { ...EMPTY_MODIFIERS, ...(set.modifiers || {}) };
  const parts = [];
  if (mod.spellPmDelta) {
    parts.push(`Sorts ${mod.spellPmDelta > 0 ? '+' : '−'}${Math.abs(mod.spellPmDelta)} PM`);
  }
  if (mod.toucherBonus) {
    parts.push(`Toucher ${mod.toucherBonus > 0 ? '+' : '−'}${Math.abs(mod.toucherBonus)}`);
  }
  if (mod.damageReduction) {
    parts.push(`Dégâts subis −${mod.damageReduction}`);
  }
  return parts.join(' · ') || set.description || 'Aucun effet chiffré';
}

export function formatArmorSetEffect(set = {}) {
  const mod = _normalizeModifiers(set.modifiers || {});
  const parts = [];
  if (mod.spellPmDelta) {
    parts.push(`Sorts ${mod.spellPmDelta > 0 ? '+' : '-'}${Math.abs(mod.spellPmDelta)} PM`);
  }
  if (mod.toucherBonus) {
    parts.push(`Toucher ${mod.toucherBonus > 0 ? '+' : '-'}${Math.abs(mod.toucherBonus)}`);
  }
  if (mod.damageReduction) {
    parts.push(`Degats subis -${mod.damageReduction}`);
  }
  if (mod.caBonus) parts.push(`CA ${mod.caBonus > 0 ? '+' : '-'}${Math.abs(mod.caBonus)}`);
  if (mod.damageBonus) parts.push(`Degats ${mod.damageBonus > 0 ? '+' : '-'}${Math.abs(mod.damageBonus)}`);
  if (mod.moveDelta) parts.push(`Deplacement ${mod.moveDelta > 0 ? '+' : '-'}${String(Math.abs(mod.moveDelta)).replace('.', ',')} m`);
  Object.entries(mod.saveBonus || {}).forEach(([k, v]) => { if (v) parts.push(`Sauvegarde ${(_AT_STAT_NAMES[k] || k)} ${v > 0 ? '+' : '-'}${Math.abs(v)}`); });
  if (Array.isArray(mod.resistances) && mod.resistances.length) parts.push(`Resistance ${mod.resistances.join(', ')}`);
  const rollParts = formatArmorSetRollImpacts(mod.rollImpact);
  if (rollParts) parts.push(rollParts);
  return parts.join(' · ') || set.description || 'Aucun effet chiffre';
}

export function formatArmorSetRollImpacts(rollImpact = {}) {
  const impact = _normalizeRollImpact(rollImpact);
  const parts = [];
  STAT_ROLL_TARGETS.forEach(([key, label]) => {
    const mode = impact.statModes[key];
    if (mode) parts.push(`${label} ${ROLL_MODE_LABELS[mode]}`);
  });
  impact.skillModes.forEach(rule => {
    parts.push(`${rule.name} ${ROLL_MODE_LABELS[rule.mode]}`);
  });
  return parts.join(' · ');
}

export function getArmorSetRollModeFor(setOrModifiers = {}, { stat = '', skill = '' } = {}) {
  const raw = setOrModifiers?.modifiers?.rollImpact || setOrModifiers?.rollImpact || {};
  const impact = _normalizeRollImpact(raw);
  const rawStatKey = normalizeArmorSetKey(stat);
  const statKey = STAT_ROLL_ALIASES[rawStatKey] || rawStatKey;
  const skillKey = _textKey(skill);
  const skillRule = impact.skillModes.find(rule => _textKey(rule.name) === skillKey);
  if (skillRule?.mode) return skillRule.mode;
  return impact.statModes[statKey] || '';
}

export function combineArmorRollMode(baseMode = 'normal', armorMode = '') {
  const base = baseMode === 'adv' ? 'advantage'
    : baseMode === 'dis' ? 'disadvantage'
    : _normalizeRollMode(baseMode);
  const armor = _normalizeRollMode(armorMode);
  if (!armor) return baseMode || 'normal';
  if (!base) return armor;
  if (base !== armor) return 'normal';
  return armor;
}

export async function saveArmorSetSettings(sets) {
  const previous = getArmorSetSettings();
  const normalized = _normalizeSettings({ sets }, _baseSets);
  const { saveDoc } = await import('../data/firestore.js');
  await saveDoc('world', DOC_ID, normalized);
  _settings = normalized;
  const propagation = await _propagateArmorTypeRenames(_detectArmorTypeRenames(previous.sets, normalized.sets));
  return { ..._settings, propagation };
}

function _detectArmorTypeRenames(previousSets = [], nextSets = []) {
  const previousById = new Map(previousSets.map(set => [set.id, set]));
  const renames = new Map();
  nextSets.forEach(next => {
    const prev = previousById.get(next.id);
    const before = String(prev?.type || '').trim();
    const after = String(next?.type || '').trim();
    if (!before || !after || _renameKey(before) === _renameKey(after)) return;
    renames.set(_renameKey(before), after);
  });
  return renames;
}

function _renameArmorTypeValue(value, renames) {
  if (typeof value !== 'string') return value;
  return renames.get(_renameKey(value)) || value;
}

function _renameArmorTypesDeep(value, renames) {
  if (!value || !renames?.size) return { value, changed: false };
  if (Array.isArray(value)) {
    let changed = false;
    const next = value.map(entry => {
      const result = _renameArmorTypesDeep(entry, renames);
      changed ||= result.changed;
      return result.value;
    });
    return { value: changed ? next : value, changed };
  }
  if (typeof value !== 'object') return { value, changed: false };

  let changed = false;
  const next = { ...value };
  Object.entries(value).forEach(([key, entry]) => {
    if (key === 'typeArmure') {
      const renamed = _renameArmorTypeValue(entry, renames);
      if (renamed !== entry) {
        next[key] = renamed;
        changed = true;
      }
      return;
    }
    const result = _renameArmorTypesDeep(entry, renames);
    if (result.changed) {
      next[key] = result.value;
      changed = true;
    }
  });
  return { value: changed ? next : value, changed };
}

async function _propagateArmorTypeRenames(renames) {
  if (!renames?.size) return { updated: 0 };
  const { loadCollection, updateInCol } = await import('../data/firestore.js');
  const collections = ['shop', 'characters', 'recipes', 'bastion', 'npcs', 'bestiary', 'vtt'];
  let updated = 0;
  await Promise.all(collections.map(async col => {
    const docs = await loadCollection(col).catch(() => []);
    const writes = docs.map(doc => {
      const { id, ...data } = doc || {};
      if (!id) return null;
      const result = _renameArmorTypesDeep(data, renames);
      if (!result.changed) return null;
      updated++;
      return updateInCol(col, id, result.value);
    }).filter(Boolean);
    if (writes.length) await Promise.all(writes);
  }));
  return { updated };
}

export function invalidateArmorSetSettingsCache() {
  _settings = null;
  _loadPromise = null;
  _baseSets = LEGACY_ARMOR_SETS;
}

export function setArmorSetSettingsForTests(sets, { base = LEGACY_ARMOR_SETS } = {}) {
  _baseSets = base;
  _settings = _normalizeSettings({ sets: sets || base }, _baseSets);
}

function _toneOptions(selected) {
  return [
    ['light', 'Vert'],
    ['medium', 'Bleu'],
    ['heavy', 'Or'],
    ['neutral', 'Neutre'],
  ].map(([value, label]) => `<option value="${value}" ${selected === value ? 'selected' : ''}>${label}</option>`).join('');
}

function _rollModeOptions(selected = '', { emptyLabel = 'Aucun' } = {}) {
  return [
    ['', emptyLabel],
    ['advantage', 'Avantage'],
    ['disadvantage', 'Desavantage'],
  ].map(([value, label]) => `<option value="${value}" ${selected === value ? 'selected' : ''}>${label}</option>`).join('');
}

async function _loadDiceSkills() {
  try {
    const { getDocData } = await import('../data/firestore.js');
    const doc = await getDocData('world', 'dice_skills');
    if (Array.isArray(doc?.skills) && doc.skills.length) {
      _diceSkills = doc.skills
        .map(skill => ({ name: String(skill?.name || '').trim(), stat: String(skill?.stat || '').trim().toUpperCase() }))
        .filter(skill => skill.name);
      return _diceSkills;
    }
  } catch (_) {}
  try {
    const { DICE_SKILLS_DEFAULT } = await import('./dice-skills.js');
    _diceSkills = (DICE_SKILLS_DEFAULT || [])
      .map(skill => ({ name: String(skill?.name || '').trim(), stat: String(skill?.stat || '').trim().toUpperCase() }))
      .filter(skill => skill.name);
  } catch (_) {
    _diceSkills = [];
  }
  return _diceSkills;
}

function _skillOptions(selected = '', usedNames = new Set()) {
  const selectedKey = _textKey(selected);
  const options = [];
  if (selected && !_diceSkills.some(skill => _textKey(skill.name) === selectedKey)) {
    options.push({ name: selected, stat: '', legacy: true });
  }
  _diceSkills.forEach(skill => {
    const key = _textKey(skill.name);
    if (key !== selectedKey && usedNames.has(key)) return;
    options.push(skill);
  });
  return `<option value="">Choisir une competence...</option>` + options.map(skill => {
    const label = `${skill.name}${skill.stat ? ` (${skill.stat})` : ''}${skill.legacy ? ' - ancien nom' : ''}`;
    return `<option value="${_esc(skill.name)}" ${_textKey(skill.name) === selectedKey ? 'selected' : ''}>${_esc(label)}</option>`;
  }).join('');
}

function _rollModeButtons({ index, stat = '', rule = '', mode = '', action }) {
  const entries = [
    ['', 'Auc', 'Aucun impact'],
    ['advantage', 'Av', 'Avantage'],
    ['disadvantage', 'Des', 'Desavantage'],
  ];
  return `<span class="armor-roll-segment" role="group">${entries.map(([value, label, title]) => `
    <button type="button"
      class="${mode === value ? 'is-active' : ''}"
      data-action="${action}"
      data-index="${index}"
      ${stat ? `data-stat="${_esc(stat)}"` : ''}
      ${rule !== '' ? `data-rule="${_esc(rule)}"` : ''}
      data-mode="${_esc(value)}"
      title="${_esc(title)}">${label}</button>`).join('')}</span>`;
}

function _statRollControls(set, index) {
  const impact = _normalizeRollImpact(set.modifiers?.rollImpact || {});
  return STAT_ROLL_TARGETS.map(([key, label]) => `
    <div class="armor-roll-stat">
      <span>${label}</span>
      ${_rollModeButtons({ index, stat: key, mode: impact.statModes[key] || '', action: '_armorSetRollStat' })}
    </div>`).join('');
}

function _skillRollRulesHtmlLegacy(set, index) {
  const skills = _normalizeRollImpact(set.modifiers?.rollImpact || {}).skillModes;
  if (!skills.length) {
    return '<div class="armor-roll-empty">Aucun jet specifique. Ajoute une competence seulement si elle doit remplacer la regle de stat.</div>';
  }
  return skills.map((rule, ruleIndex) => `
    <div class="armor-roll-skill">
      <input class="input-field" value="${_esc(rule.name)}" data-input="_armorSetRollSkill" data-index="${index}" data-rule="${ruleIndex}" data-field="name" placeholder="Ex. Discretion">
      <select class="input-field" data-change="_armorSetRollSkill" data-index="${index}" data-rule="${ruleIndex}" data-field="mode">
        ${_rollModeOptions(rule.mode, { emptyLabel: 'Mode' })}
      </select>
      <button type="button" class="armor-icon-btn danger" data-action="_armorSetRollSkillDelete" data-index="${index}" data-rule="${ruleIndex}" title="Supprimer">×</button>
    </div>`).join('');
}

function _skillRollRulesHtml(set, index) {
  const skills = _normalizeRollImpact(set.modifiers?.rollImpact || {}).skillModes;
  if (!skills.length) {
    return '<div class="armor-roll-empty">Aucune competence specifique.</div>';
  }
  const used = new Set(skills.map(rule => _textKey(rule.name)).filter(Boolean));
  return skills.map((rule, ruleIndex) => `
    <div class="armor-roll-skill">
      <select class="input-field armor-skill-select" data-change="_armorSetRollSkill" data-index="${index}" data-rule="${ruleIndex}" data-field="name">
        ${_skillOptions(rule.name, used)}
      </select>
      ${_rollModeButtons({ index, rule: ruleIndex, mode: rule.mode, action: '_armorSetRollSkillMode' })}
      <button type="button" class="armor-icon-btn danger" data-action="_armorSetRollSkillDelete" data-index="${index}" data-rule="${ruleIndex}" title="Supprimer">x</button>
    </div>`).join('');
}

function _armorColorPicker(set, index) {
  const selected = _safeColor(set.color, _toneColor(set.tone)).toLowerCase();
  const known = ARMOR_SET_COLORS.some(([color]) => color.toLowerCase() === selected);
  return `<details class="armor-color-picker" aria-label="Couleur du set">
    <summary class="armor-color-current" title="Changer la couleur du set">
      <span style="--armor-choice:${_esc(selected)}"></span>
    </summary>
    <div class="armor-color-popover">
      <div class="armor-color-swatches">
        ${ARMOR_SET_COLORS.map(([color, label]) => `
          <button type="button"
            class="armor-color-swatch ${selected === color.toLowerCase() ? 'is-active' : ''}"
            style="--armor-choice:${color}"
            data-action="_armorSetColor"
            data-index="${index}"
            data-color="${color}"
            title="${_esc(label)}"></button>`).join('')}
      </div>
      <label class="armor-color-custom ${known ? '' : 'is-active'}" title="Couleur libre">
        <input type="color"
          value="${_esc(selected)}"
          data-change="_armorSetColor"
          data-index="${index}">
        <span></span>
      </label>
    </div>
  </details>`;
}

function _renderAdminLegacy() {
  const rows = _draft.map((set, index) => {
    const effect = formatArmorSetEffect(set);
    const active = set.enabled !== false;
    return `
      <article class="armor-type-card ${active ? '' : 'is-disabled'}" data-index="${index}">
        <div class="armor-type-main">
          <div class="armor-type-label-row">
            <span class="armor-type-section-title">Type boutique</span>
            <button type="button" class="btn btn-outline btn-sm" data-action="_armorSetToggle" data-index="${index}" title="${active ? 'Désactiver ce type' : 'Réactiver ce type'}">${active ? 'Actif' : 'Inactif'}</button>
          </div>
          <input class="input-field" value="${_esc(set.type)}" data-input="_armorSetField" data-index="${index}" data-field="type" placeholder="Ex. Légère, Runique, Tissu">
          <select class="input-field" data-change="_armorSetField" data-index="${index}" data-field="tone">${_toneOptions(set.tone)}</select>
          <div class="armor-type-help">Ce nom est celui qui apparaîtra dans la boutique et sur les objets.</div>
        </div>

        <div class="armor-type-bonus">
          <div class="armor-type-section-title">Bonus mécanique optionnel</div>
          <div class="armor-type-bonus-grid">
            <label><span class="sh-admin-row-lbl">PM sorts</span>
              <input type="number" class="input-field" value="${set.modifiers.spellPmDelta || 0}" data-input="_armorSetMod" data-index="${index}" data-field="spellPmDelta" title="Négatif = réduction, positif = surcoût">
            </label>
            <label><span class="sh-admin-row-lbl">Toucher</span>
              <input type="number" class="input-field" value="${set.modifiers.toucherBonus || 0}" data-input="_armorSetMod" data-index="${index}" data-field="toucherBonus">
            </label>
            <label><span class="sh-admin-row-lbl">Réduc. dégâts</span>
              <input type="number" min="0" class="input-field" value="${set.modifiers.damageReduction || 0}" data-input="_armorSetMod" data-index="${index}" data-field="damageReduction">
            </label>
          </div>
          <div class="armor-type-help">Aucune valeur obligatoire. Si tout reste à 0, le type existe pour la boutique mais ne donne pas de bonus chiffré.</div>
        </div>

        <div class="armor-type-preview">
          <div class="armor-type-section-title">Lecture joueur</div>
          <input class="input-field" value="${_esc(set.description)}" data-input="_armorSetField" data-index="${index}" data-field="description" placeholder="Description courte affichée sur la fiche">
          <div class="armor-type-effect-preview">
            <strong>Aperçu :</strong> ${_esc(effect)}
          </div>
        </div>

        <div class="armor-type-actions">
          <button type="button" class="btn btn-outline btn-sm" data-action="_armorSetMove" data-index="${index}" data-dir="-1" title="Monter" ${index === 0 ? 'disabled' : ''}>↑</button>
          <button type="button" class="btn btn-outline btn-sm" data-action="_armorSetMove" data-index="${index}" data-dir="1" title="Descendre" ${index === _draft.length - 1 ? 'disabled' : ''}>↓</button>
          <button type="button" class="btn btn-outline btn-sm" data-action="_armorSetDelete" data-index="${index}" title="Supprimer" style="color:#ff8ca7;border-color:rgba(255,90,126,.28)">×</button>
        </div>
      </article>`;
  }).join('');

  openModal('', `
    <div class="sh-admin-modal is-armor-sets">
      <div class="sh-admin-head">
        <div class="sh-admin-head-ico">🧩</div>
        <div class="sh-admin-head-title">
          <h2>Types d'armure & bonus de set</h2>
          <small>La boutique utilise ces types. Le bonus s'applique si tous les slots d'armure équipés partagent le même type.</small>
        </div>
        <button class="sh-admin-close" data-action="_armorSetsClose" aria-label="Fermer">×</button>
      </div>
      <div class="sh-admin-body armor-sets-body">
        <div class="armor-sets-guide">
          <div>
            <b>1. Crée les types</b>
            <small>Ils deviennent disponibles dans le sélecteur de la boutique.</small>
          </div>
          <div>
            <b>2. Bonus optionnel</b>
            <small>Un type peut exister sans aucun effet mécanique.</small>
          </div>
          <div>
            <b>3. Activation automatique</b>
            <small>Tous les slots d'armure doivent porter le même type.</small>
          </div>
        </div>
        <div class="armor-sets-list">${rows || '<div class="eqs-admin-empty">Aucun type d’armure. Ajoute un type pour l’utiliser dans la boutique.</div>'}</div>
        <div class="armor-sets-toolbar">
          <button class="btn btn-gold btn-sm" data-action="_armorSetAdd">+ Nouveau type d'armure</button>
        </div>
      </div>
      <div class="sh-admin-footer">
        <button class="btn btn-outline btn-sm" data-action="_armorSetsClose">Annuler</button>
        <button class="btn btn-gold btn-sm" data-action="_armorSetsSave">Enregistrer</button>
      </div>
    </div>`);
}

function _renderAdminPrevious() {
  const rows = _draft.map((set, index) => {
    set.modifiers = _normalizeModifiers(set.modifiers || {});
    const effect = formatArmorSetEffect(set);
    const active = set.enabled !== false;
    return `
      <article class="armor-type-card ${active ? '' : 'is-disabled'}" data-index="${index}">
        <header class="armor-type-header">
          <div class="armor-type-title">
            ${_armorColorPicker(set, index)}
            <input class="input-field armor-type-name" value="${_esc(set.type)}" data-input="_armorSetField" data-index="${index}" data-field="type" placeholder="Type d'armure">
          </div>
          <div class="armor-type-top-actions">
            <select class="input-field armor-tone-select" data-change="_armorSetField" data-index="${index}" data-field="tone" title="Couleur d'affichage">${_toneOptions(set.tone)}</select>
            <button type="button" class="armor-pill-toggle ${active ? 'is-on' : ''}" data-action="_armorSetToggle" data-index="${index}">${active ? 'Actif' : 'Inactif'}</button>
            <button type="button" class="armor-icon-btn" data-action="_armorSetMove" data-index="${index}" data-dir="-1" title="Monter" ${index === 0 ? 'disabled' : ''}>↑</button>
            <button type="button" class="armor-icon-btn" data-action="_armorSetMove" data-index="${index}" data-dir="1" title="Descendre" ${index === _draft.length - 1 ? 'disabled' : ''}>↓</button>
            <button type="button" class="armor-icon-btn danger" data-action="_armorSetDelete" data-index="${index}" title="Supprimer">×</button>
          </div>
        </header>

        <div class="armor-type-grid">
          <section class="armor-type-panel">
            <div class="armor-type-section-title">Bonus de set</div>
            <div class="armor-type-bonus-grid">
              <label><span class="sh-admin-row-lbl">PM sorts</span>
                <input type="number" class="input-field" value="${set.modifiers.spellPmDelta || 0}" data-input="_armorSetMod" data-index="${index}" data-field="spellPmDelta" title="Negatif = reduction, positif = surcout">
              </label>
              <label><span class="sh-admin-row-lbl">Toucher</span>
                <input type="number" class="input-field" value="${set.modifiers.toucherBonus || 0}" data-input="_armorSetMod" data-index="${index}" data-field="toucherBonus">
              </label>
              <label><span class="sh-admin-row-lbl">Reduc. degats</span>
                <input type="number" min="0" class="input-field" value="${set.modifiers.damageReduction || 0}" data-input="_armorSetMod" data-index="${index}" data-field="damageReduction">
              </label>
            </div>
          </section>

          <section class="armor-type-panel armor-roll-panel">
            <div class="armor-type-section-title">Jets impactes</div>
            <div class="armor-roll-stats">${_statRollControls(set, index)}</div>
            <div class="armor-roll-skills">
              ${_skillRollRulesHtml(set, index)}
              <button type="button" class="btn btn-outline btn-sm armor-roll-add" data-action="_armorSetRollSkillAdd" data-index="${index}">+ Jet specifique</button>
            </div>
          </section>

          <section class="armor-type-panel armor-desc-panel">
            <div class="armor-type-section-title">Lecture joueur</div>
            <input class="input-field" value="${_esc(set.description)}" data-input="_armorSetField" data-index="${index}" data-field="description" placeholder="Description courte">
            <div class="armor-type-effect-preview"><strong>Apercu</strong><span>${_esc(effect)}</span></div>
          </section>
        </div>
      </article>`;
  }).join('');

  openModal('', `
    <div class="sh-admin-modal is-armor-sets">
      <div class="sh-admin-head">
        <div class="sh-admin-head-ico">🛡</div>
        <div class="sh-admin-head-title">
          <h2>Types d'armure & bonus de set</h2>
          <small>Le bonus s'active quand tous les slots d'armure equipes partagent le meme type.</small>
        </div>
        <button class="sh-admin-close" data-action="_armorSetsClose" aria-label="Fermer">×</button>
      </div>
      <div class="sh-admin-body armor-sets-body">
        <div class="armor-sets-compact-note">
          <strong>Configuration d'aventure</strong>
          <span>Les types alimentent la boutique, la fiche personnage et le VTT. Les impacts de jets sont optionnels.</span>
        </div>
        <div class="armor-sets-list">${rows || '<div class="eqs-admin-empty">Aucun type d’armure. Ajoute un type pour l’utiliser dans la boutique.</div>'}</div>
        <div class="armor-sets-toolbar">
          <button class="btn btn-gold btn-sm" data-action="_armorSetAdd">+ Nouveau type d'armure</button>
        </div>
      </div>
      <div class="sh-admin-footer">
        <button class="btn btn-outline btn-sm" data-action="_armorSetsClose">Annuler</button>
        <button class="btn btn-gold btn-sm" data-action="_armorSetsSave">Enregistrer</button>
      </div>
    </div>`);
}

// ══════════════════════════════════════════════════════════════════════════════
// MODALE « TYPES D'ARMURE & SETS » v2 — UI maître/détail + PALIERS (partie B).
// Édite le modèle `tiers`/`cumulative`. Le moteur (armorSetAppliedTiers,
// getArmorSetData) et saveArmorSetSettings suivent le même format. Les neuf
// effets sont branchés en jeu : TCH/PM/RD/JET + CA (calcCA), DGT (dégâts d'arme),
// DEP (calcVitesse), SVG (jet de sauvegarde VTT), RES (profil de dégâts).
// ══════════════════════════════════════════════════════════════════════════════
const _AT_STAT_NAMES = { force: 'Force', dexterite: 'Dextérité', constitution: 'Constitution', intelligence: 'Intelligence', sagesse: 'Sagesse', charisme: 'Charisme' };
// Effets proposés dans l'éditeur (branchés). `multi` = ajoutable plusieurs fois.
const _AT_KINDS = {
  toucher: { b: 'TCH', n: 'Toucher', d: 'Bonus aux jets d’attaque', v: 1, good: e => e.value > 0 },
  dmg: { b: 'DGT', n: 'Dégâts d’arme', d: 'Ajoutés aux dégâts infligés', v: 1, good: e => e.value > 0 },
  ca: { b: 'CA', n: 'Classe d’armure', d: 'Bonus de CA', v: 1, good: e => e.value > 0 },
  dr: { b: 'RD', n: 'Réduction de dégâts', d: 'Soustraite aux dégâts subis', v: 1, min: 1, good: () => true },
  pm: { b: 'PM', n: 'Coût des sorts', d: 'PM ajoutés ou retirés', v: -1, good: e => e.value < 0 },
  move: { b: 'DEP', n: 'Déplacement', d: 'Vitesse ajoutée (mètres)', v: 1.5, step: 1.5, good: e => e.value > 0 },
  save: { b: 'SVG', n: 'Jet de sauvegarde', d: 'Bonus à une caractéristique', v: 1, multi: 1, good: e => e.value > 0 },
  resist: { b: 'RES', n: 'Résistance', d: 'À un type de dégâts', multi: 1, good: () => true },
  roll: { b: 'JET', n: 'Avantage / désavantage', d: 'Sur une carac ou compétence', multi: 1, good: e => e.mode === 'advantage' },
};
const _AT_BADGE = { toucher: 'TCH', pm: 'PM', dr: 'RD', roll: 'JET', ca: 'CA', dmg: 'DGT', save: 'SVG', resist: 'RES', move: 'DEP' };
const _AT_SPRITE = `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>
<symbol id="at-x" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></symbol>
<symbol id="at-up" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M6 11l6-6 6 6"/></symbol>
<symbol id="at-down" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M6 13l6 6 6-6"/></symbol>
<symbol id="at-dup" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></symbol>
<symbol id="at-trash" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></symbol>
<symbol id="at-plus" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></symbol>
<symbol id="at-undo" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-15-6.7L3 13"/></symbol>
</defs></svg>`;
const _atIc = id => `<svg class="at-ic"><use href="#at-${id}"></use></svg>`;

let _atSaved = [], _atSelId = null, _atAsk = null, _atColOpen = false, _atMenuTi = null, _atSim = [], _atCounts = null, _atSlotLabels = [], _atMax = 0, _atMounted = false, _atDmgTypes = [];

const _atSg = v => (v > 0 ? '+' : v < 0 ? '−' : '') + String(Math.abs(v)).replace('.', ',');
const _atCur = () => _draft.find(s => s.id === _atSelId) || _draft[0] || null;
const _atKey = s => normalizeArmorSetKey(s);
const _atDirty = s => { const o = _atSaved.find(x => x.id === s.id); return !o || JSON.stringify(_atCmp(o)) !== JSON.stringify(_atCmp(s)); };
const _atCmp = s => ({ type: s.type, color: s.color, enabled: s.enabled !== false, description: s.description, cumulative: s.cumulative !== false, tiers: s.tiers });
const _atOrderChanged = () => _draft.map(s => s.id).join('|') !== _atSaved.map(s => s.id).join('|');
const _atChanges = () => _draft.filter(_atDirty).length + _atSaved.filter(o => !_draft.some(s => s.id === o.id)).length;
const _atAnyDirty = () => _atChanges() > 0 || _atOrderChanged();
function _atErrs(s) {
  const e = [];
  if (!String(s.type || '').trim()) e.push('name');
  else if (_draft.some(o => o !== s && _atKey(o.type) === _atKey(s.type))) e.push('dupname');
  (s.tiers || []).forEach((t, i) => {
    if ((s.tiers || []).some((o, j) => j !== i && o.pieces === t.pieces)) e.push('tier' + i);
    if (t.effects.some(f => f.kind === 'roll' && !f.target)) e.push('tgt' + i);
  });
  return e;
}
const _atAllErr = () => _draft.filter(s => _atErrs(s).length);
const _atCount = s => (_atCounts == null ? null : (_atCounts[normalizeArmorSetKey(s.type)] || 0));
const _atFxCount = s => (s.tiers || []).reduce((a, t) => a + t.effects.length, 0);
const _atTgtL = t => !t ? '—' : t.startsWith('stat:') ? (_AT_STAT_NAMES[t.slice(5)] || t.slice(5)) : t.slice(6);
const _atBadgeCls = f => (_AT_KINDS[f.kind] ? (_AT_KINDS[f.kind].good(f) ? 'good' : 'bad') : '');
function _atEffTxt(f) {
  switch (f.kind) {
    case 'toucher': return `Toucher ${_atSg(f.value)}`;
    case 'pm': return `Sorts ${_atSg(f.value)} PM`;
    case 'dr': return `Dégâts subis −${f.value}`;
    case 'roll': return `${f.mode === 'advantage' ? 'Avantage' : 'Désavantage'} ${_atTgtL(f.target)}`;
    case 'ca': return `CA ${_atSg(f.value)}`;
    case 'dmg': return `Dégâts ${_atSg(f.value)}`;
    case 'save': return `Sauvegarde ${_AT_STAT_NAMES[f.stat] || f.stat} ${_atSg(f.value)}`;
    case 'resist': return `Résistance ${_atDmgTypes.find(t => t.id === f.element)?.label || f.element}`;
    case 'move': return `Déplacement ${_atSg(f.value)} m`;
  }
  return '';
}

/* ── Rendu ── */
function _atListHtml() {
  return `<span class="at-lbl">Types</span>` + _draft.map(s => {
    const err = _atErrs(s).length, dirty = _atDirty(s), cnt = _atCount(s), fx = _atFxCount(s), tiers = (s.tiers || []).length;
    const sub = s.enabled === false ? 'Inactif' : fx ? `${tiers} palier${tiers > 1 ? 's' : ''} · ${fx} effet${fx > 1 ? 's' : ''}` : 'Type boutique, sans effet';
    const mark = err ? '<span class="at-err" title="À corriger"></span>' : dirty ? '<span class="at-dirty" title="Modifié"></span>' : (cnt == null ? '' : `<span class="at-cnt" title="Objets boutique">${cnt}</span>`);
    return `<div class="at-row${s.id === _atSelId ? ' on' : ''}${s.enabled === false ? ' off' : ''}" style="--c:${_esc(s.color)}" role="button" tabindex="0" data-at-sel="${_esc(s.id)}"><span class="at-dot"></span><span style="min-width:0"><span class="at-nm">${_esc(s.type) || '<i style="color:var(--crimson)">Sans nom</i>'}</span><span class="at-sub">${_esc(sub)}</span></span>${mark}</div>`;
  }).join('')
    + `<button type="button" class="at-add" data-at-add>${_atIc('plus')}Nouveau type</button>`
    + `<div class="at-rule"><b>Règle du set</b>Chaque pièce portée dans un emplacement d'armure (${_esc(_atSlotLabels.join(', ') || 'armure')}) compte pour son type. Une pièce d'un autre type ne casse plus le set : elle ne compte simplement pas.</div>`;
}
function _atStpHtml(ti, fi, f) { return `<div class="at-stp"><button type="button" data-at-step="${ti}:${fi}:-1" aria-label="Moins">−</button><span>${_atSg(f.value)}</span><button type="button" data-at-step="${ti}:${fi}:1" aria-label="Plus">+</button></div>`; }
function _atCtlHtml(set, ti, fi, f) {
  if (f.kind === 'roll') {
    const opt = (val, label) => `<option value="${_esc(val)}"${f.target === val ? ' selected' : ''}>${_esc(label)}</option>`;
    return `<div class="at-seg"><button type="button" class="g${f.mode === 'advantage' ? ' on' : ''}" data-at-rollmode="${ti}:${fi}:advantage">Avantage</button><button type="button" class="b${f.mode === 'disadvantage' ? ' on' : ''}" data-at-rollmode="${ti}:${fi}:disadvantage">Désavantage</button></div>`
      + `<select class="at-sel${f.target ? '' : ' bad'}" data-at-rolltgt="${ti}:${fi}"><option value="">Cible…</option><optgroup label="Caractéristiques">${STAT_ROLL_TARGETS.map(([k]) => opt('stat:' + k, (_AT_STAT_NAMES[k] || k) + ' (tous les jets)')).join('')}</optgroup><optgroup label="Compétences">${(_diceSkills || []).map(sk => opt('skill:' + sk.name, sk.name + (sk.stat ? ` (${sk.stat})` : ''))).join('')}</optgroup></select>`;
  }
  if (f.kind === 'save') {
    const opts = STAT_ROLL_TARGETS.map(([k]) => `<option value="${k}"${f.stat === k ? ' selected' : ''}>${_esc(_AT_STAT_NAMES[k] || k)}</option>`).join('');
    return `<select class="at-sel" data-at-fxstat="${ti}:${fi}">${opts}</select>` + _atStpHtml(ti, fi, f);
  }
  if (f.kind === 'resist') {
    const list = _atDmgTypes.length ? _atDmgTypes : [{ id: f.element || 'feu', label: f.element || 'Feu', icon: '' }];
    const opts = list.map(t => `<option value="${_esc(t.id)}"${f.element === t.id ? ' selected' : ''}>${_esc(((t.icon ? t.icon + ' ' : '') + (t.label || t.id)))}</option>`).join('');
    return `<select class="at-sel" data-at-fxel="${ti}:${fi}">${opts}</select>`;
  }
  return _atStpHtml(ti, fi, f);
}
function _atKsub(f) {
  if (f.kind === 'roll') return f.target?.startsWith('skill:') ? 'Prioritaire sur la règle de carac' : 'Tous les jets de cette carac';
  if (f.kind === 'pm') return f.value < 0 ? 'Réduction' : 'Surcoût';
  if (f.kind === 'save') return 'Ajouté au jet de sauvegarde';
  if (f.kind === 'resist') return 'Dégâts de ce type réduits de moitié';
  return _AT_KINDS[f.kind]?.d || '';
}
function _atMainHtml() {
  const s = _atCur();
  if (!s) return `<div class="at-empty"><p>Aucun type d’armure.</p><button type="button" class="at-btn gh" data-at-add>Nouveau type</button></div>`;
  const e = _atErrs(s), i = _draft.indexOf(s), o = _atSaved.find(x => x.id === s.id), n = _atCount(s);
  const st = e.includes('name') ? ['ko', 'Donne un nom au type.']
    : e.includes('dupname') ? ['ko', 'Un autre type porte déjà ce nom.']
      : (o && o.type && _atKey(o.type) !== _atKey(s.type) && n) ? ['warn', `Renommage : ${n} objets, personnages et contenus seront mis à jour à l’enregistrement.`]
        : ['', n == null ? '' : n ? `Utilisé par ${n} objet${n > 1 ? 's' : ''} de la boutique` : 'Aucun objet de la boutique n’utilise encore ce type'];
  const simCount = _atSim.filter(x => x === 'me').length;
  const liveTiers = new Set(armorSetAppliedTiers(s, simCount, _atMax));
  let h = `<div class="at-eh" style="--c:${_esc(s.color)}"><div class="at-colr"><button type="button" class="at-colr-b" data-at-col aria-label="Couleur du type"><span></span></button><div class="at-colr-m"${_atColOpen ? '' : ' hidden'}>${ARMOR_SET_COLORS.map(([c]) => `<button type="button" style="--c:${c}" class="${c.toLowerCase() === String(s.color).toLowerCase() ? 'on' : ''}" data-at-color="${c}" aria-label="${c}"></button>`).join('')}<label class="at-colr-free" title="Couleur libre"><input type="color" value="${_esc(_safeColor(s.color))}" data-at-colorfree><span style="--c:${_esc(s.color)}"></span></label></div></div><div class="at-t"><input class="at-name${e.includes('name') || e.includes('dupname') ? ' bad' : ''}" id="at-fName" value="${_esc(s.type)}" placeholder="Ex. Légère, Runique, Tissu" aria-label="Nom du type"><small class="${st[0]}" id="at-nameSt">${_esc(st[1])}</small></div><div class="at-acts"><label class="at-mini"><button type="button" class="at-sw${s.enabled !== false ? ' on' : ''}" data-at-tog role="switch" aria-checked="${s.enabled !== false}" aria-label="Actif"></button>${s.enabled !== false ? 'Actif' : 'Inactif'}</label><button type="button" class="at-ib" data-at-mv="-1" title="Monter" ${i <= 0 ? 'disabled' : ''}>${_atIc('up')}</button><button type="button" class="at-ib" data-at-mv="1" title="Descendre" ${i >= _draft.length - 1 ? 'disabled' : ''}>${_atIc('down')}</button><button type="button" class="at-ib" data-at-dup title="Dupliquer">${_atIc('dup')}</button><button type="button" class="at-ib del" data-at-del title="Supprimer">${_atIc('trash')}</button></div></div>`;
  h += `<section class="at-sec"><div class="at-sec-h"><span class="at-lbl">Paliers de set</span><span class="at-sp"></span><label class="at-mini" title="Désactivé : seul le palier le plus haut atteint s’applique"><button type="button" class="at-sw${s.cumulative !== false ? ' on' : ''}" data-at-cumul role="switch" aria-checked="${s.cumulative !== false}" aria-label="Paliers cumulés"></button>Paliers cumulés</label></div><div class="at-tiers">`;
  const order = (s.tiers || []).map((t, ti) => [t, ti]).sort((a, b) => a[0].pieces - b[0].pieces);
  order.forEach(([t, ti]) => {
    const dup = e.includes('tier' + ti), used = new Set(t.effects.map(f => f.kind));
    const eff = Math.min(t.pieces, _atMax);
    h += `<div class="at-tier${liveTiers.has(t) ? ' live' : ''}${dup ? ' bad' : ''}" style="--c:${_esc(s.color)}"><div class="at-tier-h"><div class="at-pips" role="group" aria-label="Pièces requises">${_atSlotLabels.map((_, p) => `<button type="button" class="at-pip${p < eff ? ' on' : ''}" data-at-pip="${ti}:${p + 1}" title="${p + 1} pièce${p ? 's' : ''}">${p + 1}</button>`).join('')}</div><div><b>${eff === _atMax ? 'Set complet' : `${eff} pièce${eff > 1 ? 's' : ''}`}</b>${dup ? '<small class="ko">Deux paliers au même seuil</small>' : `<small>${eff}/${_atMax} pièces ${_esc(s.type) || ''}</small>`}</div><span class="at-sp"></span>${liveTiers.has(t) ? '<span class="at-live-tag">Actif dans la simulation</span>' : ''}<button type="button" class="at-rm" data-at-rmtier="${ti}" title="Supprimer le palier">${_atIc('x')}</button></div><div class="at-fx">`;
    h += t.effects.length ? t.effects.map((f, fi) => `<div class="at-e"><span class="at-badge ${_atBadgeCls(f)}">${_AT_BADGE[f.kind]}</span><span class="at-k">${_AT_KINDS[f.kind]?.n || f.kind}<small>${_esc(_atKsub(f))}</small></span><span class="at-ctl">${_atCtlHtml(s, ti, fi, f)}</span><button type="button" class="at-rm" data-at-rmfx="${ti}:${fi}" title="Retirer">${_atIc('x')}</button></div>`).join('') : '<div class="at-empty-fx">Aucun effet sur ce palier.</div>';
    h += `</div><div class="at-tier-f"><button type="button" class="at-addfx" data-at-menu="${ti}">${_atIc('plus')}Ajouter un effet</button>${_atMenuTi === ti ? `<div class="at-fxm">${Object.entries(_AT_KINDS).map(([k, v]) => `<button type="button" data-at-addfx="${ti}:${k}" ${!v.multi && used.has(k) ? 'disabled' : ''}><span class="at-badge">${v.b}</span><span><b>${v.n}</b><small>${_esc(v.d)}</small></span></button>`).join('')}</div>` : ''}</div></div>`;
  });
  const free = Array.from({ length: _atMax }, (_, k) => k + 1).filter(x => !(s.tiers || []).some(t => Math.min(t.pieces, _atMax) === x));
  h += `<button type="button" class="at-addtier" data-at-addtier ${free.length ? '' : 'disabled'}>${_atIc('plus')}${free.length ? `Ajouter un palier (${free[free.length - 1] === _atMax ? 'set complet' : free[free.length - 1] + ' pièces'})` : 'Tous les seuils sont utilisés'}</button></div>`;
  h += `<p class="at-hint">${(s.tiers || []).length ? (s.cumulative !== false ? 'Les paliers s’additionnent : à 3 pièces, les effets à 2 pièces restent actifs.' : 'Seul le palier le plus haut atteint s’applique.') : 'Sans palier, ce type sert uniquement à classer les objets dans la boutique.'}</p></section>`;
  h += `<section class="at-sec"><span class="at-lbl">Texte joueur</span><input class="at-inp" id="at-fDesc" value="${_esc(s.description)}" placeholder="${_esc(armorSetAppliedTiers(s, _atMax, _atMax).flatMap(t => t.effects).map(_atEffTxt).join(' · ') || 'Ex. Les runes s’éveillent au contact de la magie.')}"><p class="at-hint">Affiché dans l’infobulle du set. Laissé vide, la fiche affiche les effets générés.</p></section>`;
  return h;
}
function _atSimHtml() {
  const s = _atCur(); if (!s) return '';
  const count = _atSim.filter(x => x === 'me').length;
  const applied = armorSetAppliedTiers(s, count, _atMax);
  const fx = applied.flatMap(t => t.effects.map(f => [f, Math.min(t.pieces, _atMax)]));
  const next = (s.tiers || []).filter(t => Math.min(t.pieces, _atMax) > count).sort((a, b) => a.pieces - b.pieces)[0];
  const name = _esc(s.type) || 'ce type';
  let h = `<h2>Simulation</h2><p>Équipe un personnage fictif pour voir le set en jeu.</p><div class="at-pcs" style="--c:${_esc(s.color)}">${_atSlotLabels.map((sl, i) => `<div class="at-pc"><span>${_esc(sl)}</span><div class="at-seg">${[['me', _esc(s.type) || 'Ce type'], ['other', 'Autre'], ['none', 'Vide']].map(([v, l]) => `<button type="button" class="${_atSim[i] === v ? 'on' + (v === 'me' ? ' me' : '') : ''}" data-at-sim="${i}:${v}">${l}</button>`).join('')}</div></div>`).join('')}</div>`;
  h += `<div class="at-score${applied.length ? ' live' : ''}" style="--c:${_esc(s.color)}"><b>${count}/${_atMax}</b><span>${applied.length ? `${applied.length > 1 ? 'Paliers' : 'Palier'} ${applied.map(t => Math.min(t.pieces, _atMax) === _atMax ? 'complet' : Math.min(t.pieces, _atMax)).join(' + ')} actif${applied.length > 1 ? 's' : ''}` : next ? `Encore ${Math.min(next.pieces, _atMax) - count} pièce${Math.min(next.pieces, _atMax) - count > 1 ? 's' : ''} pour le premier palier` : 'Aucun palier défini'}</span></div>`;
  h += `<div class="at-sec"><span class="at-lbl">Effets appliqués</span><div class="at-res">${fx.length ? fx.map(([f, p]) => `<div class="at-ln"><span class="at-badge ${_atBadgeCls(f)}">${_AT_BADGE[f.kind]}</span><span>${_esc(_atEffTxt(f))}<em>${p === _atMax ? 'complet' : p + ' p.'}</em></span></div>`).join('') : '<span class="at-none">Aucun effet actif.</span>'}</div>${next && applied.length ? `<span class="at-none">Prochain palier à ${Math.min(next.pieces, _atMax)} pièces : ${next.effects.map(_atEffTxt).join(' · ') || 'aucun effet'}</span>` : ''}</div>`;
  const r = [];
  fx.map(x => x[0]).forEach(f => {
    if (f.kind === 'toucher') r.push(['Attaque', `1d20 + mod ${_atSg(f.value)}`]);
    if (f.kind === 'roll') r.push([_atTgtL(f.target) || 'Jet', f.mode === 'advantage' ? '2d20, garder le haut' : '2d20, garder le bas']);
    if (f.kind === 'pm') r.push(['Sort à 5 PM', `${Math.max(0, 5 + f.value)} PM`]);
    if (f.kind === 'dr') r.push(['Coup de 8 dégâts', `${Math.max(0, 8 - f.value)} subis`]);
  });
  if (r.length) h += `<div class="at-sec"><span class="at-lbl">Exemples de jets</span><div class="at-rolls">${r.map(([a, b]) => `<div class="at-roll"><span>${_esc(a)}</span><b>${_esc(b)}</b></div>`).join('')}</div></div>`;
  h += `<div class="at-sec"><span class="at-lbl">Sur la fiche</span><div class="at-chipline"><span class="at-pchip${applied.length ? '' : ' off'}" style="--c:${_esc(s.color)}" title="${_esc(s.description)}"><i>${_atSlotLabels.map((_, i) => `<u class="${i < count ? 'on' : ''}"></u>`).join('')}</i>${applied.length ? name : `Set ${count}/${_atMax}`}${applied.length ? `<span>${_esc(s.description || fx.map(x => _atEffTxt(x[0])).join(' · '))}</span>` : ''}</span></div></div>`;
  return h;
}
function _atFootHtml() {
  const bad = _atAllErr(), n = _atChanges(), dirty = _atAnyDirty();
  if (_atAsk === 'close') return `<span class="at-ask">Abandonner les modifications ?</span><span class="at-sp"></span><button type="button" class="at-btn tx" data-at-keep>Continuer l’édition</button><button type="button" class="at-btn gh" data-at-discard>Abandonner</button>`;
  if (_atAsk === 'del') { const s = _atCur(), c = _atCount(s); return `<span class="at-ask">Supprimer « ${_esc(s?.type) || 'Sans nom'} » ?<small>${c ? `${c} objet${c > 1 ? 's' : ''} garderont ce type, sans effet de set.` : (c === 0 ? 'Aucun objet n’utilise ce type.' : '')}</small></span><span class="at-sp"></span><button type="button" class="at-btn tx" data-at-keep>Annuler</button><button type="button" class="at-btn dg" data-at-delok>Supprimer</button>`; }
  const info = bad.length ? `<span class="at-info ko">${bad.length} type${bad.length > 1 ? 's' : ''} à corriger</span>` : dirty ? `<span class="at-info"><span class="at-dot"></span>${n ? `${n} type${n > 1 ? 's' : ''} modifié${n > 1 ? 's' : ''}` : 'Ordre modifié'}, non enregistré</span>` : '<span class="at-info">À jour</span>';
  return `${info}<span class="at-sp"></span><button type="button" class="at-btn tx" data-at-revert ${dirty ? '' : 'disabled'}>${_atIc('undo')}Annuler les modifications</button><button type="button" class="at-btn pri" data-at-save ${dirty && !bad.length ? '' : 'disabled'}>Enregistrer</button>`;
}
function _atRenderList() { const el = document.getElementById('at-list'); if (el) el.innerHTML = _atListHtml(); }
function _atRenderMain() { const el = document.getElementById('at-main'); if (el) el.innerHTML = _atMainHtml(); }
function _atRenderSim() { const el = document.getElementById('at-sim'); if (el) el.innerHTML = _atSimHtml(); }
function _atRenderFoot() { const el = document.getElementById('at-foot'); if (el) el.innerHTML = _atFootHtml(); }
function _atRender() { _atRenderList(); _atRenderMain(); _atRenderSim(); _atRenderFoot(); }

/* ── Actions ── */
function _atNewTierEffect(k) {
  // _normalizeTierEffect pose les bons défauts par genre (save→constitution+1,
  // resist→élément, move→+1.5, pm→-1, dr min 1…). Repli défensif si genre inconnu.
  if (k === 'resist') return { kind: 'resist', element: (_atDmgTypes[0]?.id) || 'feu' };
  return _normalizeTierEffect({ kind: k }) || { kind: k, value: _AT_KINDS[k]?.v ?? 1 };
}
async function _atSave() {
  if (_atAllErr().length || !_atAnyDirty()) return;
  try {
    const before = getArmorSetSettings().sets || [];
    const next = _draft.map(set => ({ ...set, label: set.type || set.label || '' }));
    const renames = _detectArmorTypeRenames(before, _normalizeSettings({ sets: next }, _baseSets).sets);
    if (renames.size) showNotif('Renommage détecté : propagation en cours…', 'info');
    const result = await saveArmorSetSettings(next);
    const updated = Number(result?.propagation?.updated || 0);
    _draft = _clone(getArmorSetSettings().sets || []);
    _atSaved = _clone(_draft);
    if (!_atCur()) _atSelId = _draft[0]?.id || null;
    showNotif(renames.size ? `Types enregistrés. ${renames.size} renommage${renames.size > 1 ? 's' : ''} propagé${renames.size > 1 ? 's' : ''} dans ${updated} document${updated > 1 ? 's' : ''}.` : 'Types et bonus de set enregistrés.', 'success');
    _atRender();
  } catch (error) { showNotif(error?.message || 'Erreur de sauvegarde.', 'error'); }
}
function _atCloseGuard() { if (_atAsk) return true; if (_atAnyDirty()) { _atAsk = 'close'; _atRenderFoot(); return true; } return false; }
function _atMount() {
  if (_atMounted) return; _atMounted = true;
  document.addEventListener('click', ev => {
    if (!document.querySelector('.at')) return;
    let soft = false;
    if (_atMenuTi !== null && !ev.target.closest('.at-tier-f')) { _atMenuTi = null; soft = true; }
    if (_atColOpen && !ev.target.closest('.at-colr')) { _atColOpen = false; soft = true; }
    const t = ev.target.closest('[data-at-sel],[data-at-add],[data-at-col],[data-at-color],[data-at-tog],[data-at-cumul],[data-at-mv],[data-at-dup],[data-at-del],[data-at-delok],[data-at-pip],[data-at-rmtier],[data-at-addtier],[data-at-menu],[data-at-addfx],[data-at-rmfx],[data-at-step],[data-at-rollmode],[data-at-sim],[data-at-revert],[data-at-save],[data-at-close],[data-at-keep],[data-at-discard]');
    if (!t) { if (soft) _atRenderMain(); return; }
    const d = t.dataset, s = _atCur();
    if (d.atSel != null) { _atSelId = d.atSel; _atMenuTi = null; _atColOpen = false; return _atRender(); }
    if ('atAdd' in d) { const id = `type-${Date.now()}`; _draft.push(_normalizeSet({ id, type: '', label: '', enabled: true, tone: 'neutral', description: '', color: ARMOR_SET_COLORS[_draft.length % ARMOR_SET_COLORS.length][0], cumulative: true, tiers: [{ pieces: _atMax, effects: [] }] }, _draft.length)); _atSelId = id; _atRender(); document.getElementById('at-fName')?.focus(); return; }
    if ('atCol' in d) { _atColOpen = !_atColOpen; return _atRenderMain(); }
    if (d.atColor) { if (s) s.color = _safeColor(d.atColor, s.color); _atColOpen = false; return _atRender(); }
    if ('atTog' in d) { if (s) s.enabled = s.enabled === false; return _atRender(); }
    if ('atCumul' in d) { if (s) s.cumulative = s.cumulative === false; return _atRender(); }
    if (d.atMv) { const i = _draft.indexOf(s), j = i + (+d.atMv); if (_draft[j]) { [_draft[i], _draft[j]] = [_draft[j], _draft[i]]; _atRender(); } return; }
    if ('atDup' in d) { if (!s) return; const id = `type-${Date.now()}`; _draft.splice(_draft.indexOf(s) + 1, 0, { ..._clone(s), id, type: s.type + ' (copie)' }); _atSelId = id; return _atRender(); }
    if ('atDel' in d) { _atAsk = 'del'; return _atRenderFoot(); }
    if ('atDelok' in d) { const i = _draft.indexOf(s); _draft.splice(i, 1); _atSelId = (_draft[i] || _draft[i - 1])?.id || null; _atAsk = null; return _atRender(); }
    if (d.atPip) { const [ti, nn] = d.atPip.split(':'); if (s?.tiers[ti]) s.tiers[ti].pieces = +nn; return _atRender(); }
    if (d.atRmtier != null) { if (s) s.tiers.splice(+d.atRmtier, 1); return _atRender(); }
    if ('atAddtier' in d) { if (s) { const free = Array.from({ length: _atMax }, (_, k) => k + 1).filter(x => !s.tiers.some(t => Math.min(t.pieces, _atMax) === x)); if (free.length) s.tiers.push({ pieces: free[free.length - 1], effects: [] }); } return _atRender(); }
    if (d.atMenu != null) { _atMenuTi = _atMenuTi === +d.atMenu ? null : +d.atMenu; return _atRenderMain(); }
    if (d.atAddfx) { const [ti, k] = d.atAddfx.split(':'); if (s?.tiers[ti]) s.tiers[ti].effects.push(_atNewTierEffect(k)); _atMenuTi = null; return _atRender(); }
    if (d.atRmfx) { const [ti, fi] = d.atRmfx.split(':'); if (s?.tiers[ti]) s.tiers[ti].effects.splice(+fi, 1); return _atRender(); }
    if (d.atStep) { const [ti, fi, dir] = d.atStep.split(':'); const f = s?.tiers[ti]?.effects[fi]; if (f) { const K = _AT_KINDS[f.kind], step = K.step || 1; let v = +((f.value || 0) + (+dir) * step).toFixed(1); if (v === 0) v = +((+dir) * step).toFixed(1); if (K.min && v < K.min) v = K.min; f.value = v; } return _atRender(); }
    if (d.atRollmode) { const [ti, fi, m] = d.atRollmode.split(':'); const f = s?.tiers[ti]?.effects[fi]; if (f) f.mode = m; return _atRender(); }
    if (d.atSim) { const [i, v] = d.atSim.split(':'); _atSim[+i] = v; _atRenderMain(); return _atRenderSim(); }
    if ('atRevert' in d) { _draft = _clone(_atSaved); if (!_atCur()) _atSelId = _draft[0]?.id || null; return _atRender(); }
    if ('atSave' in d) return _atSave();
    if ('atClose' in d) { if (_atAnyDirty()) { _atAsk = 'close'; _atRenderFoot(); } else { clearModalCloseGuard(); closeModalDirect(); } return; }
    if ('atKeep' in d) { _atAsk = null; return _atRenderFoot(); }
    if ('atDiscard' in d) { _atAsk = null; _draft = _clone(_atSaved); _atSelId = _draft[0]?.id || null; clearModalCloseGuard(); closeModalDirect(); return; }
  });
  document.addEventListener('input', ev => {
    if (!document.querySelector('.at')) return;
    const s = _atCur(); if (!s) return;
    if (ev.target.id === 'at-fName') {
      s.type = ev.target.value; s.label = ev.target.value;
      _atRenderList(); _atRenderSim(); _atRenderFoot();
      const e = _atErrs(s); ev.target.classList.toggle('bad', e.includes('name') || e.includes('dupname'));
      const stEl = document.getElementById('at-nameSt'), o = _atSaved.find(x => x.id === s.id), n = _atCount(s);
      const st = e.includes('name') ? ['ko', 'Donne un nom au type.'] : e.includes('dupname') ? ['ko', 'Un autre type porte déjà ce nom.'] : (o && _atKey(o.type) !== _atKey(s.type) && n) ? ['warn', `Renommage : ${n} objets, personnages et contenus seront mis à jour à l’enregistrement.`] : ['', n == null ? '' : n ? `Utilisé par ${n} objet${n > 1 ? 's' : ''} de la boutique` : 'Aucun objet de la boutique n’utilise encore ce type'];
      if (stEl) { stEl.className = st[0]; stEl.textContent = st[1]; }
    } else if (ev.target.id === 'at-fDesc') { s.description = ev.target.value; _atRenderList(); _atRenderFoot(); }
    else if (ev.target.hasAttribute('data-at-colorfree')) { s.color = _safeColor(ev.target.value, s.color); _atRenderList(); _atRenderSim(); document.querySelector('.at-eh')?.style.setProperty('--c', s.color); }
  });
  document.addEventListener('change', ev => {
    if (!document.querySelector('.at')) return;
    const s = _atCur(); if (!s) return;
    if (ev.target.hasAttribute('data-at-rolltgt')) { const [ti, fi] = ev.target.getAttribute('data-at-rolltgt').split(':'); const f = s.tiers[ti]?.effects[fi]; if (f) { f.target = ev.target.value; _atRender(); } }
    else if (ev.target.hasAttribute('data-at-fxstat')) { const [ti, fi] = ev.target.getAttribute('data-at-fxstat').split(':'); const f = s.tiers[ti]?.effects[fi]; if (f) { f.stat = ev.target.value; _atRender(); } }
    else if (ev.target.hasAttribute('data-at-fxel')) { const [ti, fi] = ev.target.getAttribute('data-at-fxel').split(':'); const f = s.tiers[ti]?.effects[fi]; if (f) { f.element = ev.target.value; _atRender(); } }
  });
  document.addEventListener('keydown', ev => {
    if (!document.querySelector('.at')) return;
    if (ev.key === 'Escape') { if (_atMenuTi !== null || _atColOpen) { ev.stopPropagation(); _atMenuTi = null; _atColOpen = false; _atRenderMain(); return; } if (_atAsk) { ev.stopPropagation(); ev.preventDefault(); _atAsk = null; _atRenderFoot(); return; } return; }
    if (ev.target.matches('input,select')) return;
    if ((ev.key === 'ArrowUp' || ev.key === 'ArrowDown') && ev.target.closest('.at-list')) { ev.preventDefault(); const i = _draft.indexOf(_atCur()), nx = _draft[i + (ev.key === 'ArrowUp' ? -1 : 1)]; if (nx) { _atSelId = nx.id; _atRender(); document.querySelector('.at-row.on')?.focus(); } }
    if (ev.key === 'Enter' && ev.target.dataset?.atSel) ev.target.click();
  }, true);
}

function _renderAdmin() {
  openModal('', `<div class="at">${_AT_SPRITE}
    <header class="at-head"><div><h1>Types d'armure & sets</h1><small>La boutique et la fiche personnage suivent cette configuration</small></div><span class="at-sp"></span><button type="button" class="at-x" data-at-close aria-label="Fermer">${_atIc('x')}</button></header>
    <div class="at-body"><nav class="at-list" id="at-list"></nav><div class="at-main" id="at-main"></div><aside class="at-simw" id="at-sim"></aside></div>
    <footer class="at-foot" id="at-foot"></footer>
  </div>`);
  _atAsk = null; _atMenuTi = null; _atColOpen = false;
  setModalCloseGuard(_atCloseGuard);
  _atMount();
  _atRender();
}

async function _ensureAdminUi() {
  if (_adminUiPromise) return _adminUiPromise;
  _adminUiPromise = Promise.all([import('./html.js'), import('./modal.js'), import('./notifications.js')]).then(([html, modal, notifications]) => {
    _esc = html._esc;
    openModal = modal.openModal;
    closeModalDirect = modal.closeModalDirect;
    confirmModal = modal.confirmModal;
    setModalCloseGuard = modal.setModalCloseGuard;
    clearModalCloseGuard = modal.clearModalCloseGuard;
    showNotif = notifications.showNotif;
  });
  return _adminUiPromise;
}

export async function openArmorSetsAdmin() {
  await _ensureAdminUi();
  await Promise.all([loadArmorSetSettings(), _loadDiceSkills()]);
  _atDmgTypes = [];
  try {
    const { loadDamageTypes } = await import('./damage-types.js');
    _atDmgTypes = (await loadDamageTypes() || []).map(t => ({ id: t.id, label: t.label || t.id, icon: t.icon || '' })).filter(t => t.id);
  } catch { _atDmgTypes = []; }
  _atSlotLabels = []; _atMax = 0; _atCounts = null;
  try {
    const { getEquipmentSlotsByKind } = await import('./equipment-slots.js');
    const slots = getEquipmentSlotsByKind('armor');
    _atSlotLabels = slots.map(sl => sl.label || sl.id);
    _atMax = _atSlotLabels.length;
  } catch { _atSlotLabels = ['Tête', 'Torse', 'Pieds']; _atMax = 3; }
  if (!_atMax) { _atSlotLabels = ['Armure']; _atMax = 1; }
  // Brouillon : paliers bornés au nombre d'emplacements (seuil « complet ») pour
  // l'édition, le moteur re-borne de son côté. _normalizeSet a déjà migré.
  _draft = _clone(getArmorSetSettings().sets || []);
  _draft.forEach(s => { (s.tiers || []).forEach(t => { t.pieces = Math.min(Math.max(1, t.pieces), _atMax); }); });
  _atSaved = _clone(_draft);
  _atSelId = _draft[0]?.id || null;
  _atSim = Array.from({ length: _atMax }, () => 'me');
  try {
    const { getCachedCollection, loadCollection } = await import('../data/firestore.js');
    const shop = getCachedCollection('shop') || await loadCollection('shop');
    const map = {};
    (shop || []).forEach(it => { const k = normalizeArmorSetKey(it?.typeArmure); if (k) map[k] = (map[k] || 0) + 1; });
    _atCounts = map;
  } catch { _atCounts = null; }
  _renderAdmin();
}