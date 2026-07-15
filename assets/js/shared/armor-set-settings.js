// Adventure-scoped armor set bonuses.
// Firestore: world/armor_sets

const DOC_ID = 'armor_sets';

const EMPTY_MODIFIERS = Object.freeze({
  spellPmDelta: 0,
  toucherBonus: 0,
  damageReduction: 0,
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
const _renameKey = value => normalizeArmorSetKey(value);

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
  const modifiers = raw.modifiers || {};
  return {
    id: normalizeArmorSetKey(raw.id || key) || `set-${index + 1}`,
    type,
    label,
    enabled: raw.enabled !== false,
    tone: raw.tone || 'neutral',
    color: raw.color || '',
    description: String(raw.description || '').trim(),
    modifiers: {
      spellPmDelta: _num(modifiers.spellPmDelta),
      toucherBonus: _num(modifiers.toucherBonus),
      damageReduction: Math.max(0, _num(modifiers.damageReduction)),
    },
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
  return { ...EMPTY_MODIFIERS };
}

export function formatArmorSetEffect(set = {}) {
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

export async function saveArmorSetSettings(sets) {
  const previous = getArmorSetSettings();
  const normalized = _normalizeSettings({ sets }, _baseSets);
  const { saveDoc } = await import('../data/firestore.js');
  await saveDoc('world', DOC_ID, normalized);
  _settings = normalized;
  await _propagateArmorTypeRenames(_detectArmorTypeRenames(previous.sets, normalized.sets));
  return _settings;
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

function _renderAdmin() {
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
      _armorSetMod: el => {
        const set = _draft[Number(el.dataset.index)];
        if (set) set.modifiers[el.dataset.field] = _num(el.value);
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
          modifiers: { ...EMPTY_MODIFIERS },
        }, _draft.length));
        _renderAdmin();
      },
      _armorSetsSave: async () => {
        const missing = _draft.find(set => set.enabled !== false && !String(set.type || '').trim());
        if (missing) { showNotif("Chaque set actif doit avoir un type d'armure.", 'error'); return; }
        try {
          const before = getArmorSetSettings().sets || [];
          const next = _draft.map(set => ({ ...set, label: set.type || set.label || '' }));
          const renames = _detectArmorTypeRenames(before, _normalizeSettings({ sets: next }, _baseSets).sets);
          const result = await saveArmorSetSettings(next);
          showNotif(renames.size
            ? `Types enregistrés. ${renames.size} renommage${renames.size > 1 ? 's' : ''} propagé${renames.size > 1 ? 's' : ''}.`
            : 'Types et bonus de set enregistrés.', 'success');
          closeModalDirect();
          return result;
        } catch (error) {
          showNotif(error?.message || 'Erreur de sauvegarde.', 'error');
        }
      },
    });
  });
  return _adminUiPromise;
}

export async function openArmorSetsAdmin() {
  await _ensureAdminUi();
  await loadArmorSetSettings();
  _draft = _clone(getArmorSetSettings().sets || []);
  _renderAdmin();
}
