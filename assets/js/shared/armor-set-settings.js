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

const _clone = value => JSON.parse(JSON.stringify(value));
const _num = value => {
  const n = parseInt(value, 10);
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
  normalized.rollImpact = _normalizeRollImpact(modifiers.rollImpact || {});
  return normalized;
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
  return {
    id: normalizeArmorSetKey(raw.id || key) || `set-${index + 1}`,
    type,
    label,
    enabled: raw.enabled !== false,
    tone: raw.tone || 'neutral',
    color: _safeColor(raw.color, _toneColor(raw.tone || 'neutral')),
    description: String(raw.description || '').trim(),
    modifiers: _normalizeModifiers(raw.modifiers || {}),
  };
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

function _renderAdmin() {
  const rows = _draft.map((set, index) => {
    set.modifiers = _normalizeModifiers(set.modifiers || {});
    const effect = formatArmorSetEffect(set);
    const active = set.enabled !== false;
    const statImpactCount = Object.keys(set.modifiers.rollImpact.statModes || {}).length;
    const skillImpactCount = (set.modifiers.rollImpact.skillModes || []).length;
    const impactCount = statImpactCount + skillImpactCount;
    return `
      <article class="armor-type-card ${active ? '' : 'is-disabled'}" data-index="${index}">
        <header class="armor-type-header">
          <div class="armor-type-title">
            ${_armorColorPicker(set, index)}
            <input class="input-field armor-type-name" value="${_esc(set.type)}" data-input="_armorSetField" data-index="${index}" data-field="type" placeholder="Type d'armure">
          </div>
          <div class="armor-type-top-actions">
            <button type="button" class="armor-pill-toggle ${active ? 'is-on' : ''}" data-action="_armorSetToggle" data-index="${index}">${active ? 'Actif' : 'Inactif'}</button>
            <button type="button" class="armor-icon-btn" data-action="_armorSetMove" data-index="${index}" data-dir="-1" title="Monter" ${index === 0 ? 'disabled' : ''}>↑</button>
            <button type="button" class="armor-icon-btn" data-action="_armorSetMove" data-index="${index}" data-dir="1" title="Descendre" ${index === _draft.length - 1 ? 'disabled' : ''}>↓</button>
            <button type="button" class="armor-icon-btn danger" data-action="_armorSetDelete" data-index="${index}" title="Supprimer">x</button>
          </div>
        </header>

        <div class="armor-set-summary-line">
          <span>${_esc(effect)}</span>
          <b>${impactCount ? `${impactCount} jet${impactCount > 1 ? 's' : ''} impacte${impactCount > 1 ? 's' : ''}` : 'Aucun jet impacte'}</b>
        </div>

        <div class="armor-type-grid">
          <section class="armor-type-panel armor-bonus-panel">
            <div class="armor-type-section-title">Effets mecaniques</div>
            <div class="armor-inline-metrics">
              <label><span>PM sorts</span><input type="number" class="input-field" value="${set.modifiers.spellPmDelta || 0}" data-input="_armorSetMod" data-index="${index}" data-field="spellPmDelta" title="Negatif = reduction, positif = surcout"></label>
              <label><span>Toucher</span><input type="number" class="input-field" value="${set.modifiers.toucherBonus || 0}" data-input="_armorSetMod" data-index="${index}" data-field="toucherBonus"></label>
              <label><span>Reduction</span><input type="number" min="0" class="input-field" value="${set.modifiers.damageReduction || 0}" data-input="_armorSetMod" data-index="${index}" data-field="damageReduction"></label>
            </div>
            <input class="input-field armor-description-input" value="${_esc(set.description)}" data-input="_armorSetField" data-index="${index}" data-field="description" placeholder="Lecture joueur, ex. Desavantage aux jets de discretion.">
          </section>

          <section class="armor-type-panel armor-roll-panel">
            <div class="armor-type-section-title">Caracteristiques impactees</div>
            <div class="armor-roll-stats">${_statRollControls(set, index)}</div>
          </section>

          <section class="armor-type-panel armor-skill-panel">
            <div class="armor-type-section-title">Competences specifiques</div>
            <div class="armor-roll-skills">
              ${_skillRollRulesHtml(set, index)}
              <button type="button" class="armor-add-line" data-action="_armorSetRollSkillAdd" data-index="${index}">+ Ajouter une competence</button>
            </div>
          </section>
        </div>
      </article>`;
  }).join('');

  openModal('', `
    <div class="sh-admin-modal is-armor-sets">
      <div class="sh-admin-head">
        <div class="sh-admin-head-ico">SET</div>
        <div class="sh-admin-head-title">
          <h2>Types d'armure & bonus de set</h2>
          <small>Un type alimente la boutique. Son bonus s'active quand tous les slots d'armure equipes partagent ce type.</small>
        </div>
        <button class="sh-admin-close" data-action="_armorSetsClose" aria-label="Fermer">x</button>
      </div>
      <div class="sh-admin-body armor-sets-body">
        <div class="armor-sets-compact-note">
          <strong>Configuration d'aventure</strong>
          <span>Les impacts de jets sont optionnels. Une competence specifique prend le dessus sur la regle de caracteristique.</span>
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

async function _ensureAdminUi() {
  if (_adminUiPromise) return _adminUiPromise;
  _adminUiPromise = Promise.all([
    import('../core/actions.js'), import('./html.js'), import('./modal.js'), import('./notifications.js'),
  ]).then(([actions, html, modal, notifications]) => {
    _esc = html._esc;
    openModal = modal.openModal;
    closeModalDirect = modal.closeModalDirect;
    confirmModal = modal.confirmModal;
    showNotif = notifications.showNotif;
    actions.registerActions({
      _armorSetsClose: () => closeModalDirect(),
      _armorSetField: el => {
        const set = _draft[Number(el.dataset.index)];
        if (!set) return;
        set[el.dataset.field] = el.value;
        if (el.dataset.field === 'type') set.label = el.value;
      },
      _armorSetColor: el => {
        const set = _draft[Number(el.dataset.index)];
        if (!set) return;
        set.color = _safeColor(el.dataset.color || el.value, _toneColor(set.tone));
        _renderAdmin();
      },
      _armorSetMod: el => {
        const set = _draft[Number(el.dataset.index)];
        if (!set) return;
        set.modifiers = _normalizeModifiers(set.modifiers || {});
        set.modifiers[el.dataset.field] = el.dataset.field === 'damageReduction'
          ? Math.max(0, _num(el.value))
          : _num(el.value);
      },
      _armorSetRollStat: el => {
        const set = _draft[Number(el.dataset.index)];
        if (!set) return;
        set.modifiers = _normalizeModifiers(set.modifiers || {});
        const stat = el.dataset.stat;
        const mode = _normalizeRollMode(el.dataset.mode ?? el.value);
        if (!stat) return;
        if (mode) set.modifiers.rollImpact.statModes[stat] = mode;
        else delete set.modifiers.rollImpact.statModes[stat];
        _renderAdmin();
      },
      _armorSetRollSkillAdd: button => {
        const set = _draft[Number(button.dataset.index)];
        if (!set) return;
        set.modifiers = _normalizeModifiers(set.modifiers || {});
        const used = new Set(set.modifiers.rollImpact.skillModes.map(rule => _textKey(rule.name)).filter(Boolean));
        const firstAvailable = (_diceSkills || []).find(skill => !used.has(_textKey(skill.name)))?.name || '';
        if (!firstAvailable) {
          showNotif?.('Toutes les competences disponibles sont deja utilisees pour ce set.', 'info');
          return;
        }
        set.modifiers.rollImpact.skillModes.push({ name: firstAvailable, mode: 'disadvantage' });
        _renderAdmin();
      },
      _armorSetRollSkill: el => {
        const set = _draft[Number(el.dataset.index)];
        const rule = set?.modifiers?.rollImpact?.skillModes?.[Number(el.dataset.rule)];
        if (!rule) return;
        if (el.dataset.field === 'mode') rule.mode = _normalizeRollMode(el.value) || 'disadvantage';
        else {
          rule.name = el.value;
          _renderAdmin();
        }
      },
      _armorSetRollSkillMode: button => {
        const set = _draft[Number(button.dataset.index)];
        const rule = set?.modifiers?.rollImpact?.skillModes?.[Number(button.dataset.rule)];
        if (!rule) return;
        rule.mode = _normalizeRollMode(button.dataset.mode);
        _renderAdmin();
      },
      _armorSetRollSkillDelete: button => {
        const set = _draft[Number(button.dataset.index)];
        if (!set) return;
        set.modifiers = _normalizeModifiers(set.modifiers || {});
        set.modifiers.rollImpact.skillModes.splice(Number(button.dataset.rule), 1);
        _renderAdmin();
      },
      _armorSetToggle: button => {
        const set = _draft[Number(button.dataset.index)];
        if (!set) return;
        set.enabled = set.enabled === false;
        _renderAdmin();
      },
      _armorSetMove: button => {
        const from = Number(button.dataset.index);
        const to = from + Number(button.dataset.dir);
        if (!_draft[from] || to < 0 || to >= _draft.length) return;
        [_draft[from], _draft[to]] = [_draft[to], _draft[from]];
        _renderAdmin();
      },
      _armorSetDelete: async button => {
        const index = Number(button.dataset.index);
        if (!_draft[index]) return;
        if (!await confirmModal('Supprimer ce bonus de set ?', { title: 'Confirmation' })) return;
        _draft.splice(index, 1);
        _renderAdmin();
      },
      _armorSetAdd: () => {
        _draft.push(_normalizeSet({
          id: `set-${Date.now()}`,
          type: '',
          label: 'Nouveau set',
          enabled: true,
          tone: 'neutral',
          description: '',
          modifiers: _emptyModifiers(),
        }, _draft.length));
        _renderAdmin();
      },
      _armorSetsSave: async (button) => {
        const missing = _draft.find(set => set.enabled !== false && !String(set.type || '').trim());
        if (missing) { showNotif("Chaque set actif doit avoir un type d'armure.", 'error'); return; }
        const oldText = button?.textContent || '';
        try {
          const before = getArmorSetSettings().sets || [];
          const next = _draft.map(set => ({ ...set, label: set.type || set.label || '' }));
          const renames = _detectArmorTypeRenames(before, _normalizeSettings({ sets: next }, _baseSets).sets);
          if (button) {
            button.disabled = true;
            button.textContent = renames.size ? 'Propagation...' : 'Enregistrement...';
          }
          if (renames.size) showNotif('Renommage détecté : propagation dans les objets, personnages et contenus liés...', 'info');
          const result = await saveArmorSetSettings(next);
          const updated = Number(result?.propagation?.updated || 0);
          showNotif(renames.size
            ? `Types enregistrés. ${renames.size} renommage${renames.size > 1 ? 's' : ''} propagé${renames.size > 1 ? 's' : ''} dans ${updated} document${updated > 1 ? 's' : ''}.`
            : 'Types et bonus de set enregistrés.', 'success');
          closeModalDirect();
          return result;
        } catch (error) {
          showNotif(error?.message || 'Erreur de sauvegarde.', 'error');
        } finally {
          if (button) {
            button.disabled = false;
            button.textContent = oldText || 'Enregistrer';
          }
        }
      },
    });
  });
  return _adminUiPromise;
}

export async function openArmorSetsAdmin() {
  await _ensureAdminUi();
  await Promise.all([loadArmorSetSettings(), _loadDiceSkills()]);
  _draft = _clone(getArmorSetSettings().sets || []);
  _renderAdmin();
}
