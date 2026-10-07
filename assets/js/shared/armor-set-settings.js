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

// ══════════════════════════════════════════════════════════════════════════════
// MODALE « TYPES D'ARMURE & SETS » v2 — PARTIE A (UI maître/détail).
// Conserve le modèle actuel (modifiers / rollImpact) : getArmorSetData et
// saveArmorSetSettings sont inchangés (aucun risque combat). Un seul palier
// implicite = « set complet », effets existants (TCH/PM/RD/JET). Les paliers,
// la grille de pièces et les effets « Nouveau » (partie B) sont volontairement
// absents de cette version.
// ══════════════════════════════════════════════════════════════════════════════
const _AT_STAT_NAMES = { force: 'Force', dexterite: 'Dextérité', constitution: 'Constitution', intelligence: 'Intelligence', sagesse: 'Sagesse', charisme: 'Charisme' };
const _AT_KINDS = {
  toucher: { b: 'TCH', n: 'Toucher', d: 'Bonus aux jets d’attaque', v: 1, good: e => e.v > 0 },
  pm: { b: 'PM', n: 'Coût des sorts', d: 'PM ajoutés ou retirés', v: -1, good: e => e.v < 0 },
  dr: { b: 'RD', n: 'Réduction de dégâts', d: 'Soustraite aux dégâts subis', v: 1, min: 1, good: () => true },
  roll: { b: 'JET', n: 'Avantage / désavantage', d: 'Sur une carac ou compétence', multi: 1, good: e => e.mode === 'advantage' },
};
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

// Snapshot enregistré, type édité, confirmation du pied, palette ouverte, menu
// d'effets, état des pièces simulées, nb d'objets par type, emplacements d'armure.
let _atSaved = [];
let _atSelId = null;
let _atAsk = null;      // 'close' | 'del' | null
let _atColOpen = false;
let _atMenuOpen = false;
let _atSim = [];
let _atCounts = null;
let _atSlotLabels = [];
let _atMax = 0;
let _atMounted = false;

const _atSg = v => (v > 0 ? '+' : v < 0 ? '−' : '') + String(Math.abs(v)).replace('.', ',');
const _atCur = () => _draft.find(s => s.id === _atSelId) || _draft[0] || null;
const _atKey = s => normalizeArmorSetKey(s);
const _atDirty = s => { const o = _atSaved.find(x => x.id === s.id); return !o || JSON.stringify(o) !== JSON.stringify(s); };
const _atOrderChanged = () => _draft.map(s => s.id).join('|') !== _atSaved.map(s => s.id).join('|');
const _atChanges = () => _draft.filter(_atDirty).length + _atSaved.filter(o => !_draft.some(s => s.id === o.id)).length;
const _atAnyDirty = () => _atChanges() > 0 || _atOrderChanged();
function _atErrs(s) {
  const e = [];
  if (!String(s.type || '').trim()) e.push('name');
  else if (_draft.some(o => o !== s && _atKey(o.type) === _atKey(s.type))) e.push('dupname');
  return e;
}
const _atAllErr = () => _draft.filter(s => _atErrs(s).length);
const _atCount = s => (_atCounts == null ? null : (_atCounts[normalizeArmorSetKey(s.type)] || 0));
const _atTgtL = t => !t ? '—' : t.startsWith('stat:') ? (_AT_STAT_NAMES[t.slice(5)] || t.slice(5)) : t.slice(6);

function _atRolls(set) {
  const im = _normalizeRollImpact(set.modifiers?.rollImpact || {});
  const out = [];
  Object.entries(im.statModes).forEach(([k, m]) => { if (m) out.push({ target: 'stat:' + k, mode: m }); });
  im.skillModes.forEach(r => { if (r.name) out.push({ target: 'skill:' + r.name, mode: r.mode }); });
  return out;
}
function _atRollRemove(set, target) {
  set.modifiers = _normalizeModifiers(set.modifiers || {});
  if (target.startsWith('stat:')) delete set.modifiers.rollImpact.statModes[target.slice(5)];
  else { const name = target.slice(6); set.modifiers.rollImpact.skillModes = set.modifiers.rollImpact.skillModes.filter(r => r.name !== name); }
}
function _atRollSet(set, target, mode) {
  set.modifiers = _normalizeModifiers(set.modifiers || {});
  if (target.startsWith('stat:')) set.modifiers.rollImpact.statModes[target.slice(5)] = mode;
  else { const name = target.slice(6); const r = set.modifiers.rollImpact.skillModes.find(x => x.name === name); if (r) r.mode = mode; else set.modifiers.rollImpact.skillModes.push({ name, mode }); }
}
function _atRollRetarget(set, oldT, newT) {
  if (oldT === newT || !newT) return;
  const mode = _atRolls(set).find(r => r.target === oldT)?.mode || 'disadvantage';
  _atRollRemove(set, oldT); _atRollSet(set, newT, mode);
}
function _atEffects(set) {
  const m = set.modifiers || {}; const out = [];
  if ((m.toucherBonus || 0) !== 0) out.push({ k: 'toucher', v: m.toucherBonus });
  if ((m.spellPmDelta || 0) !== 0) out.push({ k: 'pm', v: m.spellPmDelta });
  if ((m.damageReduction || 0) > 0) out.push({ k: 'dr', v: m.damageReduction });
  _atRolls(set).forEach(r => out.push({ k: 'roll', mode: r.mode, target: r.target }));
  return out;
}
function _atAddEffect(set, k) {
  set.modifiers = _normalizeModifiers(set.modifiers || {}); const m = set.modifiers;
  if (k === 'toucher') { if (!m.toucherBonus) m.toucherBonus = 1; }
  else if (k === 'pm') { if (!m.spellPmDelta) m.spellPmDelta = -1; }
  else if (k === 'dr') { if (!(m.damageReduction > 0)) m.damageReduction = 1; }
  else if (k === 'roll') {
    const used = new Set(_atRolls(set).map(r => r.target));
    const target = (_diceSkills || []).map(s => 'skill:' + s.name).find(t => !used.has(t)) || STAT_ROLL_TARGETS.map(([s]) => 'stat:' + s).find(t => !used.has(t));
    if (target) _atRollSet(set, target, 'disadvantage');
  }
}
function _atRemoveEffect(set, k, target) {
  set.modifiers = _normalizeModifiers(set.modifiers || {}); const m = set.modifiers;
  if (k === 'toucher') m.toucherBonus = 0;
  else if (k === 'pm') m.spellPmDelta = 0;
  else if (k === 'dr') m.damageReduction = 0;
  else if (k === 'roll' && target) _atRollRemove(set, target);
}
function _atStep(set, k, target, dir) {
  set.modifiers = _normalizeModifiers(set.modifiers || {}); const m = set.modifiers;
  const K = _AT_KINDS[k], step = K.step || 1;
  const field = k === 'toucher' ? 'toucherBonus' : k === 'pm' ? 'spellPmDelta' : 'damageReduction';
  let v = +((m[field] || 0) + dir * step).toFixed(1);
  if (v === 0) v = +(dir * step).toFixed(1);
  if (K.min && v < K.min) v = K.min;
  m[field] = v;
}
const _atEffTxt = e => {
  switch (e.k) {
    case 'toucher': return `Toucher ${_atSg(e.v)}`;
    case 'pm': return `Sorts ${_atSg(e.v)} PM`;
    case 'dr': return `Dégâts subis −${e.v}`;
    case 'roll': return `${e.mode === 'advantage' ? 'Avantage' : 'Désavantage'} ${_atTgtL(e.target)}`;
  }
  return '';
};

/* ── Rendu ── */
function _atListHtml() {
  return `<span class="at-lbl">Types</span>` + _draft.map(s => {
    const err = _atErrs(s).length, dirty = _atDirty(s), cnt = _atCount(s), eff = _atEffects(s).length;
    const sub = s.enabled === false ? 'Inactif' : eff ? `Set complet · ${eff} effet${eff > 1 ? 's' : ''}` : 'Type boutique, sans effet';
    const mark = err ? '<span class="at-err" title="À corriger"></span>' : dirty ? '<span class="at-dirty" title="Modifié"></span>' : (cnt == null ? '' : `<span class="at-cnt" title="Objets boutique">${cnt}</span>`);
    return `<div class="at-row${s.id === _atSelId ? ' on' : ''}${s.enabled === false ? ' off' : ''}" style="--c:${_esc(s.color)}" role="button" tabindex="0" data-at-sel="${_esc(s.id)}"><span class="at-dot"></span><span style="min-width:0"><span class="at-nm">${_esc(s.type) || '<i style="color:var(--crimson)">Sans nom</i>'}</span><span class="at-sub">${_esc(sub)}</span></span>${mark}</div>`;
  }).join('')
    + `<button type="button" class="at-add" data-at-add>${_atIc('plus')}Nouveau type</button>`
    + `<div class="at-rule"><b>Règle du set</b>Le bonus s'active quand tous les emplacements d'armure (${_esc(_atSlotLabels.join(', ') || 'armure')}) portent ce type.</div>`;
}
function _atEffRowHtml(set, e) {
  const g = _AT_KINDS[e.k].good(e);
  let ctl;
  if (e.k === 'roll') {
    const used = new Set(_atRolls(set).map(r => r.target));
    const opt = (val, label) => `<option value="${_esc(val)}"${e.target === val ? ' selected' : ''}${used.has(val) && e.target !== val ? ' disabled' : ''}>${_esc(label)}</option>`;
    ctl = `<div class="at-seg"><button type="button" class="g${e.mode === 'advantage' ? ' on' : ''}" data-at-rollmode="${_esc(e.target)}:advantage">Avantage</button><button type="button" class="b${e.mode === 'disadvantage' ? ' on' : ''}" data-at-rollmode="${_esc(e.target)}:disadvantage">Désavantage</button></div>`
      + `<select class="at-sel" data-at-rolltgt="${_esc(e.target)}"><optgroup label="Caractéristiques">${STAT_ROLL_TARGETS.map(([k]) => opt('stat:' + k, (_AT_STAT_NAMES[k] || k) + ' (tous les jets)')).join('')}</optgroup><optgroup label="Compétences">${(_diceSkills || []).map(sk => opt('skill:' + sk.name, sk.name + (sk.stat ? ` (${sk.stat})` : ''))).join('')}</optgroup></select>`;
  } else {
    ctl = `<div class="at-stp"><button type="button" data-at-step="${e.k}::-1" aria-label="Moins">−</button><span>${_atSg(e.v)}</span><button type="button" data-at-step="${e.k}::1" aria-label="Plus">+</button></div>`;
  }
  const ksub = e.k === 'roll' ? (e.target?.startsWith('skill:') ? 'Prioritaire sur la règle de carac' : 'Tous les jets de cette carac') : e.k === 'pm' ? (e.v < 0 ? 'Réduction' : 'Surcoût') : _AT_KINDS[e.k].d;
  return `<div class="at-e"><span class="at-badge ${g ? 'good' : 'bad'}">${_AT_KINDS[e.k].b}</span><span class="at-k">${_AT_KINDS[e.k].n}<small>${_esc(ksub)}</small></span><span class="at-ctl">${ctl}</span><button type="button" class="at-rm" data-at-rmfx="${e.k}:${_esc(e.target || '')}" title="Retirer">${_atIc('x')}</button></div>`;
}
function _atMainHtml() {
  const s = _atCur();
  if (!s) return `<div class="at-empty"><p>Aucun type d’armure.</p><button type="button" class="at-btn gh" data-at-add>Nouveau type</button></div>`;
  const e = _atErrs(s), i = _draft.indexOf(s), o = _atSaved.find(x => x.id === s.id), n = _atCount(s);
  const st = e.includes('name') ? ['ko', 'Donne un nom au type.']
    : e.includes('dupname') ? ['ko', 'Un autre type porte déjà ce nom.']
      : (o && o.type && _atKey(o.type) !== _atKey(s.type) && n) ? ['warn', `Renommage : ${n} objets, personnages et contenus seront mis à jour à l’enregistrement.`]
        : ['', n == null ? '' : n ? `Utilisé par ${n} objet${n > 1 ? 's' : ''} de la boutique` : 'Aucun objet de la boutique n’utilise encore ce type'];
  const effs = _atEffects(s);
  const used = new Set(effs.map(x => x.k));
  let h = `<div class="at-eh" style="--c:${_esc(s.color)}"><div class="at-colr"><button type="button" class="at-colr-b" data-at-col aria-label="Couleur du type"><span></span></button><div class="at-colr-m"${_atColOpen ? '' : ' hidden'}>${ARMOR_SET_COLORS.map(([c]) => `<button type="button" style="--c:${c}" class="${c.toLowerCase() === String(s.color).toLowerCase() ? 'on' : ''}" data-at-color="${c}" aria-label="${c}"></button>`).join('')}<label class="at-colr-free" title="Couleur libre"><input type="color" value="${_esc(_safeColor(s.color))}" data-at-colorfree><span style="--c:${_esc(s.color)}"></span></label></div></div><div class="at-t"><input class="at-name${e.length ? ' bad' : ''}" id="at-fName" value="${_esc(s.type)}" placeholder="Ex. Légère, Runique, Tissu" aria-label="Nom du type"><small class="${st[0]}" id="at-nameSt">${_esc(st[1])}</small></div><div class="at-acts"><label class="at-mini"><button type="button" class="at-sw${s.enabled !== false ? ' on' : ''}" data-at-tog role="switch" aria-checked="${s.enabled !== false}" aria-label="Actif"></button>${s.enabled !== false ? 'Actif' : 'Inactif'}</label><button type="button" class="at-ib" data-at-mv="-1" title="Monter" ${i <= 0 ? 'disabled' : ''}>${_atIc('up')}</button><button type="button" class="at-ib" data-at-mv="1" title="Descendre" ${i >= _draft.length - 1 ? 'disabled' : ''}>${_atIc('down')}</button><button type="button" class="at-ib" data-at-dup title="Dupliquer">${_atIc('dup')}</button><button type="button" class="at-ib del" data-at-del title="Supprimer">${_atIc('trash')}</button></div></div>`;
  h += `<section class="at-sec"><div class="at-sec-h"><span class="at-lbl">Effets du set complet</span></div><div class="at-fx">${effs.length ? effs.map(x => _atEffRowHtml(s, x)).join('') : '<div class="at-empty-fx">Aucun effet. Le set sert seulement à classer les objets de la boutique.</div>'}</div><div class="at-sec-f"><button type="button" class="at-addfx" data-at-menu>${_atIc('plus')}Ajouter un effet</button>${_atMenuOpen ? `<div class="at-fxm">${Object.entries(_AT_KINDS).map(([k, v]) => `<button type="button" data-at-addfx="${k}" ${!v.multi && used.has(k) ? 'disabled' : ''}><span class="at-badge">${v.b}</span><span><b>${v.n}</b><small>${_esc(v.d)}</small></span></button>`).join('')}</div>` : ''}</div><p class="at-hint">Le bonus s'applique quand les ${_atMax} emplacements d'armure portent ce type.</p></section>`;
  h += `<section class="at-sec"><span class="at-lbl">Texte joueur</span><input class="at-inp" id="at-fDesc" value="${_esc(s.description)}" placeholder="${_esc(effs.map(_atEffTxt).join(' · ') || 'Ex. Les runes s’éveillent au contact de la magie.')}"><p class="at-hint">Affiché dans l’infobulle du set. Laissé vide, la fiche affiche les effets générés.</p></section>`;
  return h;
}
function _atSimHtml() {
  const s = _atCur();
  if (!s) return '';
  const count = _atSim.filter(x => x === 'me').length;
  const active = _atMax > 0 && count === _atMax;
  const effs = active ? _atEffects(s) : [];
  const name = _esc(s.type) || 'ce type';
  let h = `<h2>Simulation</h2><p>Équipe un personnage fictif pour voir le set en jeu.</p><div class="at-pcs" style="--c:${_esc(s.color)}">${_atSlotLabels.map((sl, i) => `<div class="at-pc"><span>${_esc(sl)}</span><div class="at-seg">${[['me', _esc(s.type) || 'Ce type'], ['other', 'Autre'], ['none', 'Vide']].map(([v, l]) => `<button type="button" class="${_atSim[i] === v ? 'on' + (v === 'me' ? ' me' : '') : ''}" data-at-sim="${i}:${v}">${l}</button>`).join('')}</div></div>`).join('')}</div>`;
  h += `<div class="at-score${active ? ' live' : ''}" style="--c:${_esc(s.color)}"><b>${count}/${_atMax}</b><span>${active ? 'Set complet actif' : `Encore ${_atMax - count} pièce${_atMax - count > 1 ? 's' : ''} pour le set complet`}</span></div>`;
  h += `<div class="at-sec"><span class="at-lbl">Effets appliqués</span><div class="at-res">${effs.length ? effs.map(f => `<div class="at-ln"><span class="at-badge ${_AT_KINDS[f.k].good(f) ? 'good' : 'bad'}">${_AT_KINDS[f.k].b}</span><span>${_esc(_atEffTxt(f))}<em>complet</em></span></div>`).join('') : '<span class="at-none">Aucun effet actif.</span>'}</div></div>`;
  if (active) {
    const r = [];
    effs.forEach(f => {
      if (f.k === 'toucher') r.push(['Attaque', `1d20 + mod ${_atSg(f.v)}`]);
      if (f.k === 'roll') r.push([_atTgtL(f.target) || 'Jet', f.mode === 'advantage' ? '2d20, garder le haut' : '2d20, garder le bas']);
      if (f.k === 'pm') r.push(['Sort à 5 PM', `${Math.max(0, 5 + f.v)} PM`]);
      if (f.k === 'dr') r.push(['Coup de 8 dégâts', `${Math.max(0, 8 - f.v)} subis`]);
    });
    if (r.length) h += `<div class="at-sec"><span class="at-lbl">Exemples de jets</span><div class="at-rolls">${r.map(([a, b]) => `<div class="at-roll"><span>${_esc(a)}</span><b>${_esc(b)}</b></div>`).join('')}</div></div>`;
  }
  h += `<div class="at-sec"><span class="at-lbl">Sur la fiche</span><div class="at-chipline"><span class="at-pchip${active ? '' : ' off'}" style="--c:${_esc(s.color)}" title="${_esc(s.description)}"><i>${_atSlotLabels.map((_, i) => `<u class="${i < count ? 'on' : ''}"></u>`).join('')}</i>${active ? name : `Set ${count}/${_atMax}`}${active ? `<span>${_esc(s.description || effs.map(_atEffTxt).join(' · '))}</span>` : ''}</span></div></div>`;
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
function _atCloseGuard() {
  if (_atAsk) return true;
  if (_atAnyDirty()) { _atAsk = 'close'; _atRenderFoot(); return true; }
  return false;
}
function _atMount() {
  if (_atMounted) return; _atMounted = true;
  document.addEventListener('click', ev => {
    if (!document.querySelector('.at')) return;
    let soft = false;
    if (_atMenuOpen && !ev.target.closest('.at-sec-f')) { _atMenuOpen = false; soft = true; }
    if (_atColOpen && !ev.target.closest('.at-colr')) { _atColOpen = false; soft = true; }
    const t = ev.target.closest('[data-at-sel],[data-at-add],[data-at-col],[data-at-color],[data-at-tog],[data-at-mv],[data-at-dup],[data-at-del],[data-at-delok],[data-at-menu],[data-at-addfx],[data-at-rmfx],[data-at-step],[data-at-rollmode],[data-at-sim],[data-at-revert],[data-at-save],[data-at-close],[data-at-keep],[data-at-discard]');
    if (!t) { if (soft) _atRenderMain(); return; }
    const d = t.dataset, s = _atCur();
    if (d.atSel != null) { _atSelId = d.atSel; _atMenuOpen = false; _atColOpen = false; return _atRender(); }
    if ('atAdd' in d) { const id = `type-${Date.now()}`; _draft.push(_normalizeSet({ id, type: '', label: '', enabled: true, tone: 'neutral', description: '', color: ARMOR_SET_COLORS[_draft.length % ARMOR_SET_COLORS.length][0], modifiers: _emptyModifiers() }, _draft.length)); _atSelId = id; _atRender(); document.getElementById('at-fName')?.focus(); return; }
    if ('atCol' in d) { _atColOpen = !_atColOpen; return _atRenderMain(); }
    if (d.atColor) { if (s) s.color = _safeColor(d.atColor, s.color); _atColOpen = false; return _atRender(); }
    if ('atTog' in d) { if (s) s.enabled = s.enabled === false; return _atRender(); }
    if ('atCumul' in d) return;
    if (d.atMv) { const i = _draft.indexOf(s), j = i + (+d.atMv); if (_draft[j]) { [_draft[i], _draft[j]] = [_draft[j], _draft[i]]; _atRender(); } return; }
    if ('atDup' in d) { if (!s) return; const id = `type-${Date.now()}`; _draft.splice(_draft.indexOf(s) + 1, 0, { ..._clone(s), id, type: s.type + ' (copie)' }); _atSelId = id; return _atRender(); }
    if ('atDel' in d) { _atAsk = 'del'; return _atRenderFoot(); }
    if ('atDelok' in d) { const i = _draft.indexOf(s); _draft.splice(i, 1); _atSelId = (_draft[i] || _draft[i - 1])?.id || null; _atAsk = null; return _atRender(); }
    if ('atMenu' in d) { _atMenuOpen = !_atMenuOpen; return _atRenderMain(); }
    if (d.atAddfx) { if (s) _atAddEffect(s, d.atAddfx); _atMenuOpen = false; return _atRender(); }
    if (d.atRmfx) { if (s) { const [k, ...rest] = d.atRmfx.split(':'); _atRemoveEffect(s, k, rest.join(':')); } return _atRender(); }
    if (d.atStep) { if (s) { const p = d.atStep.split(':'); _atStep(s, p[0], p[1], +p[2]); } return _atRender(); }
    if (d.atRollmode) { if (s) { const idx = d.atRollmode.lastIndexOf(':'); _atRollSet(s, d.atRollmode.slice(0, idx), d.atRollmode.slice(idx + 1)); } return _atRender(); }
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
      const e = _atErrs(s); ev.target.classList.toggle('bad', e.length);
      const stEl = document.getElementById('at-nameSt'), o = _atSaved.find(x => x.id === s.id), n = _atCount(s);
      const st = e.includes('name') ? ['ko', 'Donne un nom au type.'] : e.includes('dupname') ? ['ko', 'Un autre type porte déjà ce nom.'] : (o && _atKey(o.type) !== _atKey(s.type) && n) ? ['warn', `Renommage : ${n} objets, personnages et contenus seront mis à jour à l’enregistrement.`] : ['', n == null ? '' : n ? `Utilisé par ${n} objet${n > 1 ? 's' : ''} de la boutique` : 'Aucun objet de la boutique n’utilise encore ce type'];
      if (stEl) { stEl.className = st[0]; stEl.textContent = st[1]; }
    } else if (ev.target.id === 'at-fDesc') { s.description = ev.target.value; _atRenderList(); _atRenderFoot(); }
    else if (ev.target.hasAttribute('data-at-colorfree')) { s.color = _safeColor(ev.target.value, s.color); _atRenderList(); _atRenderSim(); document.querySelector('.at-eh')?.style.setProperty('--c', s.color); }
  });
  document.addEventListener('change', ev => {
    if (!document.querySelector('.at')) return;
    const s = _atCur(); if (!s) return;
    if (ev.target.hasAttribute('data-at-rolltgt')) { _atRollRetarget(s, ev.target.getAttribute('data-at-rolltgt'), ev.target.value); _atRender(); }
  });
  document.addEventListener('keydown', ev => {
    if (!document.querySelector('.at')) return;
    if (ev.key === 'Escape') { if (_atMenuOpen || _atColOpen) { ev.stopPropagation(); _atMenuOpen = false; _atColOpen = false; _atRenderMain(); return; } if (_atAsk) { ev.stopPropagation(); ev.preventDefault(); _atAsk = null; _atRenderFoot(); return; } return; }
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
  _atAsk = null; _atMenuOpen = false; _atColOpen = false;
  setModalCloseGuard(_atCloseGuard);
  _atMount();
  _atRender();
}

async function _ensureAdminUi() {
  if (_adminUiPromise) return _adminUiPromise;
  _adminUiPromise = Promise.all([
    import('./html.js'), import('./modal.js'), import('./notifications.js'),
  ]).then(([html, modal, notifications]) => {
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
  _draft = _clone(getArmorSetSettings().sets || []);
  _draft.forEach(s => { s.modifiers = _normalizeModifiers(s.modifiers || {}); });
  _atSaved = _clone(_draft);
  _atSelId = _draft[0]?.id || null;
  // Emplacements d'armure (pour la simulation) + compteurs boutique.
  _atSlotLabels = []; _atMax = 0; _atCounts = null;
  try {
    const { getEquipmentSlotsByKind } = await import('./equipment-slots.js');
    const slots = getEquipmentSlotsByKind('armor');
    _atSlotLabels = slots.map(sl => sl.label || sl.id);
    _atMax = _atSlotLabels.length;
  } catch { _atSlotLabels = ['Tête', 'Torse', 'Pieds']; _atMax = 3; }
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
