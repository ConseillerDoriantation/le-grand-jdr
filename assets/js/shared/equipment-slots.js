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
let setModalCloseGuard = null;
let clearModalCloseGuard = null;

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

function _normalizedCategory(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

export function equipmentSlotAcceptsItem(slotOrId, item = {}) {
  const slot = typeof slotOrId === 'string' ? getEquipmentSlot(slotOrId) : slotOrId;
  if (!slot || !item?.nom) return false;
  if (slot.kind === 'weapon') return isWeaponItem(item);
  if (!slot.itemField || !slot.itemValue) return false;
  return _normalizedCategory(item[slot.itemField]) === _normalizedCategory(slot.itemValue);
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

// ══════════════════════════════════════════════════════════════════════════════
// MODALE « EMPLACEMENTS D'ÉQUIPEMENT » v2 — maître / détail, validation continue.
// Rendu + actions uniquement ; l'API et le moteur (_normalizeSlot, presets,
// saveEquipmentSlots, schéma Firestore) restent inchangés.
// ══════════════════════════════════════════════════════════════════════════════
const EQS_KINDS = {
  weapon: { t: 'Armes', l: 'Arme ou bouclier', d: 'Toute arme de l’inventaire', ic: '⚔️' },
  armor: { t: 'Armures', l: 'Armure', d: 'Filtrée par catégorie', ic: '🛡️' },
  accessory: { t: 'Accessoires', l: 'Accessoire', d: 'Bijou, objet magique…', ic: '✦' },
};
const EQS_ROLES = {
  weapon: [['primaryWeapon', 'Arme principale', 'Attaque et dégâts par défaut'], ['secondaryWeapon', 'Main secondaire / bouclier', 'Seconde attaque, bonus de bouclier']],
  armor: [['armorTorso', 'Armure principale', 'Sert au calcul de la CA'], ['armorHead', 'Pièce de set : tête', 'Compte pour les bonus de set'], ['armorFeet', 'Pièce de set : pieds', 'Compte pour les bonus de set']],
  accessory: [],
};
const EQS_CATS = { armor: ['Armure', 'Tête', 'Torse', 'Mains', 'Pieds'], accessory: ['Objet harmonisé', 'Anneau', 'Amulette', 'Dos', 'Ceinture', 'Objet magique'] };
const _EQS_SPRITE = `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>
<symbol id="eqs-x" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></symbol>
<symbol id="eqs-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></symbol>
<symbol id="eqs-up" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M6 11l6-6 6 6"/></symbol>
<symbol id="eqs-down" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M6 13l6 6 6-6"/></symbol>
<symbol id="eqs-dup" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></symbol>
<symbol id="eqs-plus" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></symbol>
<symbol id="eqs-undo" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-15-6.7L3 13"/></symbol>
</defs></svg>`;
const _eqsIc = id => `<svg class="eqs-ic"><use href="#eqs-${id}"></use></svg>`;

// Snapshot enregistré (clone à l'ouverture et après chaque save), slot édité,
// pied en mode confirmation, nombres d'objets par (champ|catégorie), menu préréglage.
let _eqsSaved = [];
let _eqsSelId = null;
let _eqsAsk = false;
let _eqsCounts = null;
let _eqsPresetLabel = 'Préréglage D&D';
let _eqsMounted = false;

const _eqsCur = () => _draft.find(s => s.id === _eqsSelId) || _draft[0] || null;
const _eqsSig = s => JSON.stringify([s.label, s.icon, s.kind, s.itemValue || '', s.role || '', s.enabled !== false]);
const _eqsDirty = s => { const o = _eqsSaved.find(x => x.id === s.id); return !o || _eqsSig(o) !== _eqsSig(s); };
const _eqsOrderChanged = () => _draft.map(s => s.id).join('|') !== _eqsSaved.map(s => s.id).join('|') || _draft.length !== _eqsSaved.length;
const _eqsChanges = () => _draft.filter(_eqsDirty).length + _eqsSaved.filter(o => !_draft.some(s => s.id === o.id)).length;
const _eqsAnyDirty = () => _eqsChanges() > 0 || _eqsOrderChanged();
function _eqsErrs(s) {
  const e = [];
  if (!String(s.label || '').trim()) e.push('name');
  if (s.kind !== 'weapon' && !String(s.itemValue || '').trim()) e.push('cat');
  if (s.role && s.enabled !== false && _draft.some(o => o !== s && o.enabled !== false && o.role === s.role)) e.push('role');
  return e;
}
const _eqsAllErr = () => _draft.filter(s => _eqsErrs(s).length);
function _eqsSub(s) {
  if (s.enabled === false) return 'Masqué';
  const r = s.role ? ROLE_LABELS[s.role] : '';
  return s.kind === 'weapon' ? (r || 'Toute arme') : [s.itemValue || '—', r].filter(Boolean).join(' · ');
}
// Nombre d'objets de la boutique pour une catégorie (null = donnée indisponible).
function _eqsCount(kind, cat) {
  if (_eqsCounts === null) return null;
  const field = kind === 'armor' ? 'slotArmure' : 'slotBijou';
  return _eqsCounts[`${field}|${_normalizedCategory(cat)}`] || 0;
}
function _eqsBuildCounts(items) {
  const map = {};
  (items || []).forEach(it => {
    ['slotArmure', 'slotBijou'].forEach(field => {
      const nc = _normalizedCategory(it?.[field]);
      if (nc) map[`${field}|${nc}`] = (map[`${field}|${nc}`] || 0) + 1;
    });
  });
  _eqsCounts = map;
}
function _eqsSortByKind() {
  const ord = Object.keys(EQS_KINDS);
  _draft = _draft.map((s, i) => [s, i]).sort((a, b) => (ord.indexOf(a[0].kind) - ord.indexOf(b[0].kind)) || (a[1] - b[1])).map(x => x[0]);
}

/* ── Rendu ── */
function _eqsListHtml() {
  let h = '';
  for (const k of Object.keys(EQS_KINDS)) {
    const g = _draft.filter(s => s.kind === k);
    h += `<div class="eqs-grp"><div class="eqs-grp-h"><span class="eqs-lbl">${_esc(EQS_KINDS[k].t)}</span><b>${g.filter(s => s.enabled !== false).length}</b></div>`;
    h += g.map(s => `<div class="eqs-row${s.id === _eqsSelId ? ' on' : ''}${s.enabled === false ? ' off' : ''}" role="button" tabindex="0" data-eqs-sel="${_esc(s.id)}"><span class="eqs-glyph">${_esc(s.icon) || '·'}</span><span style="min-width:0"><span class="eqs-nm">${_esc(s.label) || '<i style="color:var(--crimson)">Sans nom</i>'}</span><span class="eqs-sub">${_esc(_eqsSub(s))}</span></span><span class="eqs-marks">${_eqsErrs(s).length ? '<span class="eqs-err" title="À corriger"></span>' : _eqsDirty(s) ? '<span class="eqs-dirty" title="Modifié"></span>' : ''}</span></div>`).join('') || '<div class="eqs-sub" style="padding:4px 10px">Aucun</div>';
    h += '</div>';
  }
  h += `<button type="button" class="eqs-add" data-eqs-add>${_eqsIc('plus')}Ajouter un emplacement</button>`;
  h += `<div class="eqs-keys"><span><kbd>Alt</kbd><kbd>↑</kbd><kbd>↓</kbd> réordonner</span><span><kbd>↑</kbd><kbd>↓</kbd> naviguer</span></div>`;
  return h;
}
function _eqsMainHtml() {
  const s = _eqsCur();
  if (!s) return `<div class="eqs-empty"><p>Aucun emplacement.</p><button type="button" class="eqs-btn gh" data-eqs-add>Ajouter un emplacement</button></div>`;
  const e = _eqsErrs(s), same = _draft.filter(o => o.kind === s.kind), i = same.indexOf(s);
  const roleList = EQS_ROLES[s.kind];
  let h = `<div class="eqs-eh"><input class="eqs-big" id="eqs-fIcon" value="${_esc(s.icon)}" maxlength="4" aria-label="Icône"><div class="eqs-t"><input class="eqs-name${e.includes('name') ? ' bad' : ''}" id="eqs-fName" value="${_esc(s.label)}" placeholder="Nom affiché" aria-label="Nom affiché"><small>${s.enabled === false ? 'Masqué — les objets déjà équipés sont conservés' : 'Visible sur les fiches'}</small></div><div class="eqs-acts"><button type="button" class="eqs-ib" data-eqs-mv="-1" title="Monter (Alt+↑)" ${i <= 0 ? 'disabled' : ''}>${_eqsIc('up')}</button><button type="button" class="eqs-ib" data-eqs-mv="1" title="Descendre (Alt+↓)" ${i >= same.length - 1 ? 'disabled' : ''}>${_eqsIc('down')}</button><button type="button" class="eqs-ib" data-eqs-dup title="Dupliquer">${_eqsIc('dup')}</button></div></div>`;
  h += `<div class="eqs-fld"><span class="eqs-lbl">Accepte</span><div><div class="eqs-seg2">${Object.entries(EQS_KINDS).map(([k, v]) => `<button type="button" class="eqs-opt${s.kind === k ? ' on' : ''}" data-eqs-kind="${k}"><b>${_esc(v.l)}</b><small>${_esc(v.d)}</small></button>`).join('')}</div></div></div>`;
  if (s.kind !== 'weapon') {
    const n = _eqsCount(s.kind, s.itemValue);
    const hint = e.includes('cat') ? 'Choisis la catégorie d’objet que ce slot accepte.'
      : n == null ? ''
        : n > 0 ? `${n} objet${n > 1 ? 's' : ''} de la boutique ${n > 1 ? 'correspondent' : 'correspond'} à « ${_esc(s.itemValue)} ».`
          : `Aucun objet n’a encore la catégorie « ${_esc(s.itemValue)} ». Les objets créés avec cette catégorie iront ici.`;
    h += `<div class="eqs-fld"><span class="eqs-lbl">Catégorie</span><div><input class="eqs-inp${e.includes('cat') ? ' bad' : ''}" id="eqs-fCat" value="${_esc(s.itemValue)}" placeholder="Ex. ${_esc(EQS_CATS[s.kind][0])}"><div class="eqs-chips">${EQS_CATS[s.kind].map(c => { const cc = _eqsCount(s.kind, c); return `<button type="button" class="eqs-chip${c === s.itemValue ? ' on' : ''}" data-eqs-cat="${_esc(c)}">${_esc(c)}${cc == null ? '' : `<i>${cc}</i>`}</button>`; }).join('')}</div>${hint ? `<p class="eqs-hint${e.includes('cat') ? ' ko' : ''}">${hint}</p>` : (e.includes('cat') ? '<p class="eqs-hint ko">Choisis la catégorie d’objet que ce slot accepte.</p>' : '')}</div></div>`;
  }
  if (roleList.length) {
    const used = r => _draft.find(o => o !== s && o.enabled !== false && o.role === r);
    h += `<div class="eqs-fld"><span class="eqs-lbl">Rôle de calcul</span><div><div class="eqs-roles"><button type="button" class="eqs-role${!s.role ? ' on' : ''}" data-eqs-role=""><span class="eqs-rd"></span><b>Aucun<small>Affiché, sans effet sur les calculs</small></b><em></em></button>${roleList.map(([r, l, d]) => { const u = used(r), on = s.role === r; return `<button type="button" class="eqs-role${on ? ' on' : ''}${on && u ? ' clash' : ''}" data-eqs-role="${r}"><span class="eqs-rd"></span><b>${_esc(l)}<small>${_esc(d)}</small></b><em>${u ? (on ? 'Doublon : ' : 'Pris par ') + _esc(u.label) : ''}</em></button>`; }).join('')}</div>${e.includes('role') ? '<p class="eqs-hint ko">Un rôle ne peut être attribué qu’à un seul emplacement visible.</p>' : '<p class="eqs-hint">Choisir un rôle déjà pris le retire de l’autre emplacement.</p>'}</div></div>`;
  }
  h += `<div class="eqs-fld"><span class="eqs-lbl">Visibilité</span><div class="eqs-vis"><button type="button" class="eqs-sw${s.enabled !== false ? ' on' : ''}" data-eqs-tog role="switch" aria-checked="${s.enabled !== false}" aria-label="Visible"></button><span>${s.enabled !== false ? 'Visible sur les fiches et dans la boutique' : 'Masqué (réactivable à tout moment)'}</span></div></div>`;
  const vis = _draft.filter(o => o.enabled !== false);
  h += `<div class="eqs-sep"></div><div class="eqs-prev"><div class="eqs-prev-h"><span class="eqs-lbl">Aperçu sur la fiche</span><small>${vis.length} emplacement${vis.length > 1 ? 's' : ''} visible${vis.length > 1 ? 's' : ''}</small></div><div class="eqs-sheet">${vis.map(o => `<div class="eqs-tile${o === s ? ' on' : ''}" data-eqs-sel="${_esc(o.id)}"><span class="eqs-g">${_esc(o.icon)}</span><span>${_esc(o.label) || 'Sans nom'}</span></div>`).join('') || '<div class="eqs-none">Aucun emplacement visible : la fiche n’aurait pas d’équipement.</div>'}</div></div>`;
  return h;
}
function _eqsFootHtml() {
  const bad = _eqsAllErr(), n = _eqsChanges(), dirty = _eqsAnyDirty(), noVis = !_draft.some(s => s.enabled !== false);
  if (_eqsAsk) return `<span class="eqs-ask">Abandonner les modifications ?</span><span class="eqs-sp"></span><button type="button" class="eqs-btn tx" data-eqs-keep>Continuer l’édition</button><button type="button" class="eqs-btn gh" data-eqs-discard>Abandonner</button>`;
  let info;
  if (noVis) info = '<span class="eqs-info ko">Active au moins un emplacement.</span>';
  else if (bad.length) info = `<span class="eqs-info ko">${bad.length} emplacement${bad.length > 1 ? 's' : ''} à corriger</span>`;
  else if (dirty) info = `<span class="eqs-info"><span class="eqs-dot"></span>${n ? `${n} modification${n > 1 ? 's' : ''}` : 'Ordre modifié'} non enregistrée${n > 1 ? 's' : ''}</span>`;
  else info = '<span class="eqs-info">À jour</span>';
  return `${info}<span class="eqs-sp"></span><button type="button" class="eqs-btn tx" data-eqs-revert ${dirty ? '' : 'disabled'}>${_eqsIc('undo')}Annuler les modifications</button><button type="button" class="eqs-btn pri" data-eqs-save ${dirty && !bad.length && !noVis ? '' : 'disabled'}>Enregistrer</button>`;
}
function _eqsRenderList() { const el = document.getElementById('eqs-list'); if (el) el.innerHTML = _eqsListHtml(); }
function _eqsRenderMain() { const el = document.getElementById('eqs-main'); if (el) el.innerHTML = _eqsMainHtml(); }
function _eqsRenderFoot() { const el = document.getElementById('eqs-foot'); if (el) el.innerHTML = _eqsFootHtml(); }
function _eqsRender() { _eqsRenderList(); _eqsRenderMain(); _eqsRenderFoot(); }
function _eqsSoft() { _eqsRenderList(); _eqsRenderFoot(); }

/* ── Actions ── */
function _eqsMove(dir) {
  const s = _eqsCur(); if (!s) return;
  const same = _draft.filter(o => o.kind === s.kind), i = same.indexOf(s), t = same[i + dir];
  if (!t) return;
  const a = _draft.indexOf(s), b = _draft.indexOf(t);
  [_draft[a], _draft[b]] = [_draft[b], _draft[a]];
  _eqsRender();
}
function _eqsSetKind(k) {
  const s = _eqsCur(); if (!s || s.kind === k) return;
  s.kind = k;
  s.icon = EQS_KINDS[k].ic;
  s.itemField = k === 'armor' ? 'slotArmure' : k === 'accessory' ? 'slotBijou' : '';
  s.itemValue = k === 'weapon' ? '' : (EQS_CATS[k].includes(s.label) ? s.label : EQS_CATS[k][0]);
  s.role = '';
  _eqsSortByKind();
  _eqsRender();
}
function _eqsApplyPreset(which) {
  const preset = which === 'legacy' ? LEGACY_EQUIPMENT_SLOTS : DEFAULT_EQUIPMENT_SLOTS;
  _draft = preset.map((slot, i) => _normalizeSlot(slot, i));
  _eqsSortByKind();
  _eqsSelId = _draft[0]?.id || null;
  _eqsPresetLabel = which === 'legacy' ? 'Préréglage Grimorium' : 'Préréglage D&D';
  const lbl = document.getElementById('eqs-preL'); if (lbl) lbl.textContent = _eqsPresetLabel;
  _eqsRender();
  showNotif('Préréglage appliqué au brouillon.', 'info');
}
async function _eqsSave() {
  const bad = _eqsAllErr(), noVis = !_draft.some(s => s.enabled !== false);
  if (bad.length || noVis || !_eqsAnyDirty()) return;
  try {
    await saveEquipmentSlots(_draft);
    _draft = _clone(getAllEquipmentSlots());
    _eqsSortByKind();
    _eqsSaved = _clone(_draft);
    if (!_eqsCur()) _eqsSelId = _draft[0]?.id || null;
    showNotif("Emplacements d'équipement enregistrés.", 'success');
    _eqsRender();
  } catch (error) { showNotif(error?.message || 'Erreur de sauvegarde.', 'error'); }
}
function _eqsCloseGuard() {
  if (_eqsAsk) return true;
  if (_eqsAnyDirty()) { _eqsAsk = true; _eqsRenderFoot(); return true; }
  return false;
}
function _eqsMount() {
  if (_eqsMounted) return; _eqsMounted = true;
  document.addEventListener('click', ev => {
    if (!document.querySelector('.eqs')) return;
    const menu = document.getElementById('eqs-preM');
    if (menu && !ev.target.closest('.eqs-pre')) menu.hidden = true;
    const t = ev.target.closest('[data-eqs-preb],[data-eqs-preset],[data-eqs-sel],[data-eqs-add],[data-eqs-dup],[data-eqs-mv],[data-eqs-kind],[data-eqs-cat],[data-eqs-role],[data-eqs-tog],[data-eqs-revert],[data-eqs-save],[data-eqs-close],[data-eqs-keep],[data-eqs-discard]');
    if (!t) return; const d = t.dataset;
    if ('eqsPreb' in d) { if (menu) menu.hidden = !menu.hidden; return; }
    if (d.eqsPreset) { _eqsApplyPreset(d.eqsPreset); if (menu) menu.hidden = true; return; }
    if (d.eqsSel != null) { _eqsSelId = d.eqsSel; return _eqsRender(); }
    if ('eqsAdd' in d) { const id = `slot-${Date.now()}`; _draft.push({ id, enabled: true, label: 'Nouvel emplacement', icon: '✦', kind: 'accessory', itemField: 'slotBijou', itemValue: 'Objet magique', role: '' }); _eqsSortByKind(); _eqsSelId = id; _eqsRender(); document.getElementById('eqs-fName')?.select(); return; }
    if ('eqsDup' in d) { const s = _eqsCur(); if (!s) return; const id = `slot-${Date.now()}`; const c = { ..._clone(s), id, label: s.label + ' (copie)', role: '' }; _draft.splice(_draft.indexOf(s) + 1, 0, c); _eqsSelId = id; _eqsRender(); return; }
    if (d.eqsMv) return _eqsMove(+d.eqsMv);
    if (d.eqsKind) return _eqsSetKind(d.eqsKind);
    if (d.eqsCat) { const s = _eqsCur(); if (s) s.itemValue = d.eqsCat; return _eqsRender(); }
    if (d.eqsRole != null) { const s = _eqsCur(); if (!s) return; if (d.eqsRole) _draft.forEach(o => { if (o !== s && o.role === d.eqsRole) { o.role = ''; showNotif(`Rôle retiré de « ${o.label} »`, 'info'); } }); s.role = d.eqsRole; return _eqsRender(); }
    if ('eqsTog' in d) { const s = _eqsCur(); if (s) s.enabled = s.enabled === false; return _eqsRender(); }
    if ('eqsRevert' in d) { _draft = _clone(_eqsSaved); if (!_eqsCur()) _eqsSelId = _draft[0]?.id || null; return _eqsRender(); }
    if ('eqsSave' in d) return _eqsSave();
    if ('eqsClose' in d) { if (_eqsAnyDirty()) { _eqsAsk = true; _eqsRenderFoot(); } else { clearModalCloseGuard(); closeModalDirect(); } return; }
    if ('eqsKeep' in d) { _eqsAsk = false; return _eqsRenderFoot(); }
    if ('eqsDiscard' in d) { _eqsAsk = false; _draft = _clone(_eqsSaved); _eqsSelId = _draft[0]?.id || null; clearModalCloseGuard(); closeModalDirect(); return; }
  });
  document.addEventListener('input', ev => {
    if (!document.querySelector('.eqs')) return;
    const s = _eqsCur(); if (!s) return; const id = ev.target.id;
    if (id === 'eqs-fName') { s.label = ev.target.value; ev.target.classList.toggle('bad', !s.label.trim()); _eqsSoft(); document.querySelectorAll('.eqs-tile.on span:last-child').forEach(e => { e.textContent = s.label || 'Sans nom'; }); }
    else if (id === 'eqs-fIcon') { s.icon = ev.target.value; _eqsSoft(); }
    else if (id === 'eqs-fCat') { s.itemValue = ev.target.value; _eqsSoft(); }
  });
  document.addEventListener('change', ev => { if (document.querySelector('.eqs') && ev.target.id === 'eqs-fCat') _eqsRenderMain(); });
  document.addEventListener('keydown', ev => {
    if (!document.querySelector('.eqs')) return;
    const menu = document.getElementById('eqs-preM');
    if (ev.key === 'Escape') { if (menu && !menu.hidden) { ev.stopPropagation(); menu.hidden = true; return; } if (_eqsAsk) { ev.stopPropagation(); ev.preventDefault(); _eqsAsk = false; _eqsRenderFoot(); return; } return; }
    if (ev.target.matches('input')) return;
    if (ev.key === 'ArrowUp' || ev.key === 'ArrowDown') {
      const dir = ev.key === 'ArrowUp' ? -1 : 1; ev.preventDefault();
      if (ev.altKey) return _eqsMove(dir);
      const i = _draft.indexOf(_eqsCur()), nx = _draft[i + dir];
      if (nx) { _eqsSelId = nx.id; _eqsRender(); document.querySelector('.eqs-row.on')?.focus(); }
    }
    if (ev.key === 'Enter' && ev.target.dataset?.eqsSel) ev.target.click();
  }, true);
}

function _renderAdmin() {
  openModal('', `<div class="eqs">${_EQS_SPRITE}
    <header class="eqs-head"><div><h1>Emplacements d'équipement</h1><small>La fiche personnage et la boutique suivent cette configuration</small></div><span class="eqs-sp"></span>
      <div class="eqs-pre"><button type="button" class="eqs-pre-b" data-eqs-preb><span id="eqs-preL">${_esc(_eqsPresetLabel)}</span>${_eqsIc('chev')}</button>
        <div class="eqs-pre-m" id="eqs-preM" hidden><button type="button" data-eqs-preset="dnd"><b>D&D 5e</b><small>2 armes, 1 armure, 3 objets harmonisés</small></button><button type="button" data-eqs-preset="legacy"><b>Grimorium</b><small>2 armes, 3 armures de set, 3 accessoires</small></button><p>Remplace le brouillon. Rien n'est enregistré avant « Enregistrer ».</p></div></div>
      <button type="button" class="eqs-x" data-eqs-close aria-label="Fermer">${_eqsIc('x')}</button></header>
    <div class="eqs-body"><nav class="eqs-list" id="eqs-list"></nav><div class="eqs-main" id="eqs-main"></div></div>
    <footer class="eqs-foot" id="eqs-foot"></footer>
  </div>`);
  _eqsAsk = false;
  setModalCloseGuard(_eqsCloseGuard);
  _eqsMount();
  _eqsRender();
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

export async function openEquipmentSlotsAdmin() {
  await _ensureAdminUi();
  await loadEquipmentSlots();
  _draft = _clone(getAllEquipmentSlots());
  _eqsSortByKind();
  _eqsSaved = _clone(_draft);
  _eqsSelId = _draft[0]?.id || null;
  _eqsPresetLabel = _baseSlots === LEGACY_EQUIPMENT_SLOTS ? 'Préréglage Grimorium' : 'Préréglage D&D';
  _eqsCounts = null;
  try {
    const { getCachedCollection, loadCollection } = await import('../data/firestore.js');
    const shop = getCachedCollection('shop') || await loadCollection('shop');
    _eqsBuildCounts(shop);
  } catch { _eqsCounts = null; }
  _renderAdmin();
}
