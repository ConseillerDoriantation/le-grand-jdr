// Adventure-scoped equipment slots.
// Firestore: world/equipment_slots

const DOC_ID = 'equipment_slots';

export const LEGACY_EQUIPMENT_SLOTS = Object.freeze([
  { id: 'Main principale', label: 'Main principale', icon: '⚔️', kind: 'weapon', role: 'primaryWeapon' },
  { id: 'Main secondaire', label: 'Main secondaire', icon: '🗡️', kind: 'weapon', role: 'secondaryWeapon' },
  { id: 'Tête', label: 'Tête', icon: '🪖', kind: 'armor', itemField: 'slotArmure', itemValue: 'Tête', role: 'armorHead' },
  { id: 'Torse', label: 'Torse', icon: '🛡️', kind: 'armor', itemField: 'slotArmure', itemValue: 'Torse', role: 'armorTorso' },
  { id: 'Bottes', label: 'Bottes', icon: '🥾', kind: 'armor', itemField: 'slotArmure', itemValue: 'Pieds', role: 'armorFeet' },
  { id: 'Anneau', label: 'Anneau', icon: '💍', kind: 'accessory', itemField: 'slotBijou', itemValue: 'Anneau' },
  { id: 'Amulette', label: 'Amulette', icon: '📿', kind: 'accessory', itemField: 'slotBijou', itemValue: 'Amulette' },
  { id: 'Objet magique', label: 'Objet magique', icon: '🔮', kind: 'accessory', itemField: 'slotBijou', itemValue: 'Objet magique' },
]);

// D&D 5e has one worn armor, hands for weapons/shields and three attunement slots.
export const DEFAULT_EQUIPMENT_SLOTS = Object.freeze([
  { id: 'Main principale', label: 'Arme principale', icon: '⚔️', kind: 'weapon', role: 'primaryWeapon' },
  { id: 'Main secondaire', label: 'Main secondaire', icon: '🛡️', kind: 'weapon', role: 'secondaryWeapon' },
  { id: 'Armure', label: 'Armure portée', icon: '🥋', kind: 'armor', itemField: 'slotArmure', itemValue: 'Armure', role: 'armorTorso' },
  { id: 'Objet harmonisé 1', label: 'Objet harmonisé I', icon: '✦', kind: 'accessory', itemField: 'slotBijou', itemValue: 'Objet harmonisé' },
  { id: 'Objet harmonisé 2', label: 'Objet harmonisé II', icon: '✦', kind: 'accessory', itemField: 'slotBijou', itemValue: 'Objet harmonisé' },
  { id: 'Objet harmonisé 3', label: 'Objet harmonisé III', icon: '✦', kind: 'accessory', itemField: 'slotBijou', itemValue: 'Objet harmonisé' },
]);

const ROLE_LABELS = {
  '': 'Aucun rôle de calcul',
  primaryWeapon: 'Arme principale',
  secondaryWeapon: 'Main secondaire / bouclier',
  armorHead: "Pièce de set : tête",
  armorTorso: "Armure principale (CA)",
  armorFeet: "Pièce de set : pieds",
};

let _slots = null;
// Keep historical behavior until an adventure has explicitly been selected.
let _baseSlots = LEGACY_EQUIPMENT_SLOTS;
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

function _cleanId(value, fallback = 'slot') {
  const cleaned = String(value || '').trim().replace(/[/.#\[\]]/g, '-');
  return cleaned || fallback;
}

function _normalizeSlot(raw = {}, index = 0) {
  const kind = ['weapon', 'armor', 'accessory'].includes(raw.kind) ? raw.kind : 'accessory';
  const id = _cleanId(raw.id || raw.label, `slot-${index + 1}`);
  const field = kind === 'armor' ? 'slotArmure' : kind === 'accessory' ? 'slotBijou' : '';
  return {
    id,
    enabled: raw.enabled !== false,
    label: String(raw.label || id).trim() || id,
    icon: String(raw.icon || (kind === 'weapon' ? '⚔️' : kind === 'armor' ? '🛡️' : '✦')).trim(),
    kind,
    ...(kind === 'weapon' ? {} : {
      itemField: field,
      itemValue: String(raw.itemValue || raw[field] || raw.label || id).trim(),
    }),
    role: Object.prototype.hasOwnProperty.call(ROLE_LABELS, raw.role || '') ? (raw.role || '') : '',
  };
}

function _normalizeSlots(stored, defaults = DEFAULT_EQUIPMENT_SLOTS) {
  const source = Array.isArray(stored?.slots) && stored.slots.length ? stored.slots : defaults;
  const seen = new Set();
  return source.map(_normalizeSlot).filter(slot => {
    if (seen.has(slot.id)) return false;
    seen.add(slot.id);
    return true;
  });
}

export function getEquipmentSlots() {
  return (_slots || _baseSlots).filter(slot => slot.enabled !== false);
}

export function getAllEquipmentSlots() {
  return _slots || _baseSlots;
}

export function getEquipmentSlot(id) {
  return getEquipmentSlots().find(slot => slot.id === id) || null;
}

export function getEquipmentSlotsByKind(kind) {
  return getEquipmentSlots().filter(slot => slot.kind === kind);
}

export function getEquipmentSlotIdByRole(role, fallback = '') {
  return getEquipmentSlots().find(slot => slot.role === role)?.id || fallback;
}

export function getPrimaryWeaponSlotId() {
  return getEquipmentSlotIdByRole('primaryWeapon', getEquipmentSlotsByKind('weapon')[0]?.id || 'Main principale');
}

export function getSecondaryWeaponSlotId() {
  return getEquipmentSlotIdByRole('secondaryWeapon', getEquipmentSlotsByKind('weapon')[1]?.id || 'Main secondaire');
}

export function getArmorTorsoSlotId() {
  return getEquipmentSlotIdByRole('armorTorso', getEquipmentSlotsByKind('armor')[0]?.id || 'Torse');
}

export function getArmorSetSlotIds() {
  return ['armorHead', 'armorTorso', 'armorFeet']
    .map(role => getEquipmentSlotIdByRole(role))
    .filter(Boolean);
}

export function getEquipmentItemOptions(kind) {
  const field = kind === 'armor' ? 'slotArmure' : 'slotBijou';
  return [...new Set(getEquipmentSlots()
    .filter(slot => slot.itemField === field && slot.itemValue)
    .map(slot => slot.itemValue))];
}

export function isWeaponItem(item = {}) {
  const tpl = String(item.template || '').toLowerCase();
  return tpl === 'arme' || Boolean(item.degats || item.toucher || item.toucherStat || item.degatsStat || item.sousType || String(item.format || '').startsWith('Arme'));
}

export function equipmentSlotAcceptsItem(slotOrId, item = {}) {
  const slot = typeof slotOrId === 'string' ? getEquipmentSlot(slotOrId) : slotOrId;
  if (!slot || !item?.nom) return false;
  if (slot.kind === 'weapon') return isWeaponItem(item);
  if (slot.itemField && slot.itemValue && item[slot.itemField] === slot.itemValue) return true;
  if (item[slot.itemField]) return false;
  // Legacy objects created before structured equipment categories existed.
  const haystack = `${item.type || ''} ${item.nom || ''}`.toLowerCase();
  const keywords = {
    armorHead: ['casque', 'heaume', 'chapeau', 'coiffe', 'capuche', 'tête', 'tete', 'tiare', 'couronne'],
    armorTorso: ['torse', 'cuirasse', 'plastron', 'armure', 'armor', 'robe', 'cotte', 'harnois', 'tunique', 'mailles'],
    armorFeet: ['botte', 'chausse', 'soleret', 'jambière', 'jambiere', 'grève', 'greve', 'sandale', 'pied'],
  }[slot.role] || [];
  return keywords.some(keyword => haystack.includes(keyword));
}

export function resolveEquipmentSlotForItem(item = {}) {
  if (isWeaponItem(item)) return getPrimaryWeaponSlotId();
  return getEquipmentSlots().find(slot => equipmentSlotAcceptsItem(slot, item))?.id || null;
}

export async function loadEquipmentSlots({ refresh = false } = {}) {
  if (_slots && !refresh) return _slots;
  if (_loadPromise && !refresh) return _loadPromise;
  _loadPromise = (async () => {
    try {
      const { getDocData, getCurrentAdventureId } = await import('../data/firestore.js');
      _baseSlots = getCurrentAdventureId() === 'le-grand-jdr'
        ? LEGACY_EQUIPMENT_SLOTS
        : DEFAULT_EQUIPMENT_SLOTS;
      _slots = _normalizeSlots(await getDocData('world', DOC_ID) || {}, _baseSlots);
    } catch {
      _slots = _normalizeSlots({}, _baseSlots);
    } finally {
      _loadPromise = null;
    }
    return _slots;
  })();
  return _loadPromise;
}

export function invalidateEquipmentSlotsCache() {
  _slots = null;
  _loadPromise = null;
  _baseSlots = LEGACY_EQUIPMENT_SLOTS;
}

export function setEquipmentSlotsForTests(slots) {
  _baseSlots = slots || LEGACY_EQUIPMENT_SLOTS;
  _slots = _normalizeSlots({ slots: slots || LEGACY_EQUIPMENT_SLOTS }, _baseSlots);
}

export async function saveEquipmentSlots(slots) {
  const normalized = _normalizeSlots({ slots }, _baseSlots);
  const { saveDoc } = await import('../data/firestore.js');
  await saveDoc('world', DOC_ID, { version: 1, slots: normalized });
  _slots = normalized;
  return getEquipmentSlots();
}

function _slotKindOptions(selected) {
  return [
    ['weapon', 'Arme ou bouclier'],
    ['armor', 'Armure'],
    ['accessory', 'Accessoire / objet magique'],
  ].map(([value, label]) => `<option value="${value}" ${selected === value ? 'selected' : ''}>${label}</option>`).join('');
}

function _roleOptions(selected, kind) {
  const allowed = kind === 'weapon' ? new Set(['', 'primaryWeapon', 'secondaryWeapon'])
    : kind === 'armor' ? new Set(['', 'armorHead', 'armorTorso', 'armorFeet'])
      : new Set(['']);
  return Object.entries(ROLE_LABELS).filter(([value]) => allowed.has(value))
    .map(([value, label]) => `<option value="${value}" ${selected === value ? 'selected' : ''}>${label}</option>`)
    .join('');
}

function _renderAdmin() {
  const rows = _draft.map((slot, index) => `
    <div class="eqs-admin-row ${slot.enabled === false ? 'is-disabled' : ''}" data-slot-index="${index}">
      <input class="eqs-admin-icon" value="${_esc(slot.icon)}" maxlength="4" aria-label="Icône"
        data-input="_equipmentSlotField" data-index="${index}" data-field="icon">
      <label class="eqs-admin-field"><span>Nom affiché</span>
        <input value="${_esc(slot.label)}" data-input="_equipmentSlotField" data-index="${index}" data-field="label">
      </label>
      <label class="eqs-admin-field"><span>Type d'objet</span>
        <select data-change="_equipmentSlotKind" data-index="${index}">${_slotKindOptions(slot.kind)}</select>
      </label>
      ${slot.kind === 'weapon' ? '' : `<label class="eqs-admin-field"><span>Catégorie compatible</span>
        <input value="${_esc(slot.itemValue)}" data-input="_equipmentSlotField" data-index="${index}" data-field="itemValue"
          list="eqs-${slot.kind}-categories"
          placeholder="Ex. Anneau, Armure, Pieds">
      </label>`}
      <label class="eqs-admin-field"><span>Rôle de calcul</span>
        <select data-change="_equipmentSlotField" data-index="${index}" data-field="role">${_roleOptions(slot.role, slot.kind)}</select>
      </label>
      <div class="eqs-admin-actions">
        <button type="button" data-action="_equipmentSlotMove" data-index="${index}" data-dir="-1" title="Monter" ${index === 0 ? 'disabled' : ''}>↑</button>
        <button type="button" data-action="_equipmentSlotMove" data-index="${index}" data-dir="1" title="Descendre" ${index === _draft.length - 1 ? 'disabled' : ''}>↓</button>
        <button type="button" class="${slot.enabled === false ? 'is-restore' : 'is-danger'}" data-action="_equipmentSlotToggle" data-index="${index}"
          title="${slot.enabled === false ? 'Réactiver ce slot' : 'Masquer ce slot'}">${slot.enabled === false ? '↻' : '×'}</button>
      </div>
    </div>`).join('');

  openModal('', `
    <div class="sh-admin-modal is-equipment-slots">
      <div class="sh-admin-head">
        <div class="sh-admin-head-ico">🎒</div>
        <div class="sh-admin-head-title">
          <h2>Emplacements d'équipement</h2>
          <small>La fiche personnage et la boutique s'adaptent à cette aventure.</small>
        </div>
        <button class="sh-admin-close" data-action="_equipmentSlotsClose" aria-label="Fermer">×</button>
      </div>
      <div class="sh-admin-body">
        <div class="eqs-admin-presets">
          <div><strong>Configuration de l'aventure</strong><small>Un slot retiré est seulement masqué. Les objets déjà équipés restent conservés dans les builds.</small></div>
          <button class="btn btn-outline btn-sm" data-action="_equipmentSlotsPreset" data-preset="legacy">Grimorium</button>
          <button class="btn btn-outline btn-sm" data-action="_equipmentSlotsPreset" data-preset="dnd">D&amp;D</button>
        </div>
        <datalist id="eqs-armor-categories">
          ${['Armure', 'Tête', 'Torse', 'Mains', 'Pieds'].map(value => `<option value="${value}">`).join('')}
        </datalist>
        <datalist id="eqs-accessory-categories">
          ${['Objet harmonisé', 'Anneau', 'Amulette', 'Dos', 'Ceinture', 'Objet magique'].map(value => `<option value="${value}">`).join('')}
        </datalist>
        <div class="eqs-admin-list">${rows || '<div class="eqs-admin-empty">Aucun emplacement. Ajoute au moins une arme ou une armure.</div>'}</div>
        <button class="eqs-admin-add" data-action="_equipmentSlotAdd">＋ Ajouter un emplacement</button>
      </div>
      <div class="sh-admin-footer">
        <button class="btn btn-outline btn-sm" data-action="_equipmentSlotsClose">Annuler</button>
        <button class="btn btn-gold btn-sm" data-action="_equipmentSlotsSave">Enregistrer</button>
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
      _equipmentSlotsClose: () => closeModalDirect(),
      _equipmentSlotField: el => {
        const slot = _draft[Number(el.dataset.index)];
        if (slot) slot[el.dataset.field] = el.value;
      },
      _equipmentSlotKind: el => {
        const slot = _draft[Number(el.dataset.index)];
        if (!slot) return;
        slot.kind = el.value;
        slot.icon = slot.kind === 'weapon' ? '⚔️' : slot.kind === 'armor' ? '🛡️' : '✦';
        slot.itemField = slot.kind === 'armor' ? 'slotArmure' : slot.kind === 'accessory' ? 'slotBijou' : '';
        slot.itemValue = slot.kind === 'weapon' ? '' : slot.label;
        slot.role = '';
        _renderAdmin();
      },
      _equipmentSlotMove: button => {
        const from = Number(button.dataset.index);
        const to = from + Number(button.dataset.dir);
        if (!_draft[from] || to < 0 || to >= _draft.length) return;
        [_draft[from], _draft[to]] = [_draft[to], _draft[from]];
        _renderAdmin();
      },
      _equipmentSlotToggle: async button => {
        const index = Number(button.dataset.index);
        const slot = _draft[index];
        if (!slot) return;
        slot.enabled = slot.enabled === false;
        _renderAdmin();
      },
      _equipmentSlotAdd: () => {
        _draft.push({ id: `slot-${Date.now()}`, enabled: true, label: 'Nouvel emplacement', icon: '✦', kind: 'accessory', itemField: 'slotBijou', itemValue: 'Nouvel emplacement', role: '' });
        _renderAdmin();
      },
      _equipmentSlotsPreset: async button => {
        const preset = button.dataset.preset === 'legacy' ? LEGACY_EQUIPMENT_SLOTS : DEFAULT_EQUIPMENT_SLOTS;
        const ok = await confirmModal("Remplacer le brouillon par ce préréglage ?<br><small>La modification ne sera enregistrée qu'en cliquant sur Enregistrer.</small>", {
          title: button.dataset.preset === 'legacy' ? 'Préréglage Grimorium' : 'Préréglage D&D',
          confirmLabel: 'Appliquer', danger: false,
        });
        if (!ok) return;
        _draft = _clone(preset);
        _renderAdmin();
      },
      _equipmentSlotsSave: async () => {
        if (!_draft.some(slot => slot.enabled !== false)) { showNotif('Active au moins un emplacement.', 'error'); return; }
        const missing = _draft.find(slot => !String(slot.label || '').trim() || (slot.kind !== 'weapon' && !String(slot.itemValue || '').trim()));
        if (missing) { showNotif('Chaque emplacement doit avoir un nom et une catégorie compatible.', 'error'); return; }
        const usedRoles = new Set();
        for (const slot of _draft) {
          if (slot.enabled === false) continue;
          if (slot.role && usedRoles.has(slot.role)) { showNotif(`Le rôle « ${ROLE_LABELS[slot.role]} » ne peut être attribué qu'une fois.`, 'error'); return; }
          if (slot.role) usedRoles.add(slot.role);
        }
        try {
          await saveEquipmentSlots(_draft);
          showNotif("Emplacements d'équipement enregistrés.", 'success');
          closeModalDirect();
        } catch (error) {
          showNotif(error?.message || 'Erreur de sauvegarde.', 'error');
        }
      },
    });
  });
  return _adminUiPromise;
}

export async function openEquipmentSlotsAdmin() {
  await _ensureAdminUi();
  await loadEquipmentSlots();
  _draft = _clone(getAllEquipmentSlots());
  _renderAdmin();
}
