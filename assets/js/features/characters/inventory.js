import { STATE } from '../../core/state.js';
import { charSession } from '../../shared/char-session.js';
import { registerActions } from '../../core/actions.js';
import { batchUpdateInCol, updateInCol, loadCollection, getCachedCollection, getDocDataSilent } from '../../data/firestore.js';
import { trySave } from '../../shared/crud.js';
import { openModal, pushModal, closeModal, modalSection } from '../../shared/modal.js';
import { showNotif, notifySaveError } from '../../shared/notifications.js';
import { _esc, _norm } from '../../shared/html.js';
import { lsJson } from '../../shared/local-storage.js';
import { RARETE_NAMES, _rareteColor } from '../../shared/rarity.js';
import {
  ITEM_STAT_META, statShort, getItemStatBonus, calcOr, getItemEffectText,
  computeEquipDerivedBonus, computeEquipAllSkillBonuses,
} from '../../shared/char-stats.js';
import { useGold, useGoldMulti } from '../../shared/economy.js';
import {
  shopItemToInvEntry,
  getInventoryItemValue,
  getInventoryItemResaleValue,
  getInventoryItemImage,
  getInventoryReadableDocument,
} from '../../shared/inventory-utils.js';
import { richTextContentHtml } from '../../shared/rich-text.js';
import {
  inventoryHistoryPayload,
  inventoryHistoryTypeMeta,
  makeInventoryHistoryEntry,
} from '../../shared/inventory-history.js';
import { getArmorTypeMeta, getWeaponDamageStatKeys } from '../../shared/equipment-utils.js';
import { isFeatureEnabled } from '../../shared/features.js';
import { recipeBookButton } from '../recipes.js';
import { characterAvatarHtml, characterPortraitContent } from '../../shared/portraits.js';
import { hasUpgrades, getUpgradeSettings, loadUpgradeSettings } from '../../shared/upgrade-settings.js';
import { upgradeResaleBonus, upgradeTariffValue } from '../../shared/upgrade-value.js';
import { characterBuildsForStorage, getActiveBuild, patchBuildLocally } from '../../shared/character-builds.js';
import { mergeCharacterTransferTargets } from '../../shared/character-transfer-targets.js';
import {
  _getTraits,
  getEquippedInventoryIndexMap,
  syncEquipmentAfterInventoryMutation,
} from './data.js';
import {
  equipmentSlotAcceptsItem,
  getEquipmentSlot,
  getEquipmentSlots,
  getPrimaryWeaponSlotId,
  getSecondaryWeaponSlotId,
  resolveEquipmentSlotForItem,
} from '../../shared/equipment-slots.js';
import { weaponHands, weaponHandsLabel } from '../../shared/weapon-family.js';

import { canControlCharacter, getCharacterById } from '../../shared/character-state.js';
let _charInvSearch = '';
let _invSelected = '';
let _invSheetOpen = false; // panneau de la fiche ouvert (écran étroit)
let _invSelCharId = '';
let _invLastCanEdit = false; // droits du dernier rendu (fiche re-rendue seule)
let _sellRefundsCum = [];
let _modalCharTargets = [];
let _shopItemsCache = null;
let _shopItemsLoading = null;
let _shopCatsCache = null;
let _lootItems = [];
let _lootSelId = null;
let _lootCurCat = null;
let _lootSetCat = () => {};
let _lootFilter = () => {};
let _lootSelect = () => {};
let _lootSaveRecent = null;
let _lootRenderGrid = null;

function _inventoryCatalogSnapshot() {
  const live = getCachedCollection('shop');
  if (Array.isArray(live)) _shopItemsCache = live;
  return _shopItemsCache;
}

export function isInventoryCatalogReady() {
  return Array.isArray(_inventoryCatalogSnapshot());
}

export async function ensureInventoryCatalog() {
  if (isInventoryCatalogReady()) return _shopItemsCache;
  if (!_shopItemsLoading) {
    _shopItemsLoading = loadCollection('shop')
      .then(items => {
        _shopItemsCache = Array.isArray(items) ? items : [];
        return _shopItemsCache;
      })
      .catch(() => {
        _shopItemsCache = [];
        return _shopItemsCache;
      })
      .finally(() => { _shopItemsLoading = null; });
  }
  return _shopItemsLoading;
}

// Index id→item du catalogue, reconstruit uniquement quand le snapshot change
// (le cache session-live remplace le tableau à chaque modif boutique). Évite un
// .find linéaire PAR objet d'inventaire → O(n×m) sur le rendu d'un gros sac.
let _catIndexCache = null; // { snap, map }
export function getInventoryCatalogItem(itemId) {
  if (!itemId || !isInventoryCatalogReady()) return null;
  const snap = _inventoryCatalogSnapshot();
  if (_catIndexCache?.snap !== snap) {
    const map = new Map();
    for (const it of snap) { if (it?.id != null) map.set(it.id, it); }
    _catIndexCache = { snap, map };
  }
  return _catIndexCache.map.get(itemId) || null;
}

function _renderInventoryChar(c, tab = 'inventaire') {
  charSession.renderSheet?.(c, tab || charSession.getCurrentCharTab() || 'inventaire');
}

function _inventoryHistoryActor() {
  return {
    actorUid: STATE.user?.uid || '',
    actorName: STATE.user?.pseudo || STATE.user?.displayName || STATE.user?.email || '',
  };
}

function _patchInventoryHistoryLocal(c, history) {
  if (!c || !Array.isArray(history)) return;
  c.inventoryHistory = history;
  if (STATE.activeChar?.id === c.id) STATE.activeChar.inventoryHistory = history;
  const stChar = (STATE.characters || []).find(x => x.id === c.id);
  if (stChar) stChar.inventoryHistory = history;
}

function _historyDateLabel(at) {
  const date = new Date(Number(at) || Date.now());
  return date.toLocaleString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function renderInventoryHistory(c, opts = {}) {
  const compact = !!opts.compact;
  const history = Array.isArray(c?.inventoryHistory) ? c.inventoryHistory : [];
  const latest = history.slice(0, compact ? 6 : 100);
  const body = latest.length
    ? latest.map(entry => {
      const meta = inventoryHistoryTypeMeta(entry.type);
      const actor = entry.actorName ? ` par ${entry.actorName}` : '';
      const target = entry.targetName ? ` · ${entry.targetName}` : '';
      const source = entry.source ? ` · ${entry.source}` : '';
      const note = entry.note ? `<span class="inv-history-note">${_esc(entry.note)}</span>` : '';
      return `<div class="inv-history-row inv-history-row--${meta.tone}">
        <div class="inv-history-media">
          ${entry.image
            ? `<img src="${_esc(entry.image)}" alt="">`
            : `<span>${_esc(entry.icon || meta.icon)}</span>`}
        </div>
        <div class="inv-history-main">
          <div class="inv-history-title">
            <strong>${_esc(entry.name || 'Objet')}</strong>
            <span>×${Math.max(1, parseInt(entry.qty) || 1)}</span>
          </div>
          <div class="inv-history-meta">
            <b>${_esc(entry.label || meta.label)}</b>
            <span>${_esc(_historyDateLabel(entry.at))}${_esc(actor)}${_esc(target)}${_esc(source)}</span>
          </div>
          ${note}
        </div>
      </div>`;
    }).join('')
    : `<div class="inv-history-empty">
      Aucun mouvement pour le moment. Les prochains ajouts, suppressions et objets consommés apparaîtront ici.
    </div>`;

  const tag = compact ? 'div' : 'section';
  return `<${tag} class="${compact ? 'inv-history inv-history--compact' : 'inv-history inv-history--modal'}">
    <div class="cs-section-hdr">
      <span class="cs-section-title">Historique des objets</span>
      <span class="cs-hint">${history.length} mouvement${history.length !== 1 ? 's' : ''}${history.length > latest.length ? ` - ${latest.length} derniers affiches` : ''}</span>
    </div>
    <div class="inv-history-list">${body}</div>
  </${tag}>`;
}

export function inventoryHistoryButton(c) {
  const count = Array.isArray(c?.inventoryHistory) ? c.inventoryHistory.length : 0;
  return `<button class="inv-history-trigger" data-action="openInventoryHistoryModal" data-id="${_esc(c?.id || '')}" title="Voir les ajouts, suppressions et objets consommés">
    <span aria-hidden="true">↺</span>
    <b>Historique</b>
    <em>${count}</em>
  </button>`;
}

export function openInventoryHistoryModal(charId) {
  const c = getCharacterById(charId) || charSession.getCurrentChar?.();
  if (!c) return;
  const history = Array.isArray(c.inventoryHistory) ? c.inventoryHistory : [];
  const counts = history.reduce((acc, entry) => {
    const meta = inventoryHistoryTypeMeta(entry.type);
    const key = entry.type || 'move';
    if (!acc[key]) acc[key] = { label: entry.label || meta.label, icon: entry.icon || meta.icon, count: 0, tone: meta.tone };
    acc[key].count += Math.max(1, parseInt(entry.qty) || 1);
    return acc;
  }, {});
  const countBadges = Object.values(counts).length
    ? Object.values(counts).map(it => `<span class="inv-history-stat inv-history-row--${it.tone}">
      <i>${_esc(it.icon)}</i><b>${it.count}</b><small>${_esc(it.label)}</small>
    </span>`).join('')
    : `<span class="inv-history-stat is-empty"><i>0</i><b>0</b><small>Mouvement</small></span>`;
  openModal('Historique des objets', `
    <div class="inv-history-modal-shell">
      <div class="inv-history-modal-head">
        <div>
          <span>Inventaire</span>
          <strong>${_esc(c.nom || 'Personnage')}</strong>
        </div>
        <small>${history.length ? `${history.length} mouvement${history.length > 1 ? 's' : ''} enregistre${history.length > 1 ? 's' : ''}` : 'Aucun mouvement enregistre'}</small>
      </div>
      <div class="inv-history-stats">${countBadges}</div>
      ${renderInventoryHistory(c)}
      <div class="inv-history-modal-foot">
        <button class="btn btn-outline btn-sm" data-action="close-modal">Fermer</button>
      </div>
    </div>
  `, {
    icon: '↺',
    subtitle: 'Journal des mouvements d’inventaire',
    accent: '#60a5fa',
  });
}

function _itemDegatsStatsShorts(item) {
  return getWeaponDamageStatKeys(item).map(statShort).filter(Boolean);
}

// ══════════════════════════════════════════════
// INVENTAIRE PRINCIPAL — v11 « une liste + une fiche »
// ══════════════════════════════════════════════
// Une liste dans un ordre fixe (Équipé · À portée de main · Sac en 5 familles)
// et la fiche complète de l'objet sélectionné, même grammaire que l'onglet
// Sorts. Une ligne = nom / ce que c'est / nombres. La sélection reste locale
// (aucune lecture Firestore) ; les actions sont celles de l'inventaire.

function _invItemKey(item = {}) {
  return `${item.itemId || ''}||${item.nom || ''}||${item.template || item.type || ''}`;
}

function _groupInventoryEntries(inv, indices) {
  const groups = new Map();
  indices.forEach(index => {
    const item = inv[index];
    if (!item) return;
    const key = _invItemKey(item);
    const current = groups.get(key);
    const qte = parseInt(item.quantite || item.qte || 1) || 1;
    if (current) {
      current.indices.push(index);
      current.qte += qte;
    } else {
      groups.set(key, { key, item: { ...item }, indices: [index], qte });
    }
  });
  return [...groups.values()];
}

function _invIsQuestItem(item = {}) {
  const hay = _norm(`${item.type || ''} ${item.categorie || ''} ${item.template || ''} ${item.tags || ''}`);
  return item.isQuest === true || item.quest === true || /\bquete\b|objet de quete|mission/.test(hay);
}

function _invIsBeltItem(item = {}) {
  if (item.belt === false) return false;
  if (item.belt === true) return true;
  const hay = _norm(`${item.type || ''} ${item.categorie || ''} ${item.template || ''} ${item.sousType || ''}`);
  return /potion|consommable|elixir|antidote|parchemin|scroll|munition|fleche|carreau/.test(hay);
}

function _invHighlight(text, query = _charInvSearch) {
  const raw = String(text || '');
  const q = _norm(query || '');
  if (!q) return _esc(raw);
  const chars = [];
  const sourceOffsets = [];
  [...raw].forEach((char, sourceIndex) => {
    const normalized = _norm(char);
    [...normalized].forEach(part => { chars.push(part); sourceOffsets.push(sourceIndex); });
  });
  const at = chars.join('').indexOf(q);
  if (at < 0) return _esc(raw);
  const start = sourceOffsets[at];
  const end = (sourceOffsets[at + q.length - 1] ?? start) + 1;
  return `${_esc(raw.slice(0, start))}<mark>${_esc(raw.slice(start, end))}</mark>${_esc(raw.slice(end))}`;
}

function _invRecentAcquisitions(c) {
  const cutoff = Date.now() - 14 * 24 * 60 * 60 * 1000;
  const map = new Map();
  (c.inventoryHistory || []).forEach(entry => {
    if (!['add', 'receive'].includes(entry?.type) || Number(entry.at) < cutoff) return;
    const keys = [entry.itemId ? `id:${entry.itemId}` : '', entry.name ? `name:${_norm(entry.name)}` : ''].filter(Boolean);
    keys.forEach(key => map.set(key, Math.max(map.get(key) || 0, Number(entry.at) || 0)));
  });
  return map;
}

function _invRecentAt(group, recentMap) {
  return recentMap.get(`id:${group.item.itemId}`) || recentMap.get(`name:${_norm(group.item.nom)}`) || 0;
}

const _IV_RAR = item => Math.max(0, parseInt(item?.rarete ?? item?.rare ?? 0) || 0);
// Barème réel 1-indexé (Commun = 1). « Notable » = au-dessus du commun → marque
// + couleur ; 0/1 = aucune marque (volontaire, pour ne pas charger la liste).
const _IV_NOTABLE = rare => rare >= 2 && !!RARETE_NAMES[rare];
const _ivRareColor = rare => _IV_NOTABLE(rare) ? (_rareteColor(RARETE_NAMES[rare]) || '#7a8fa8') : '';
const _ivRareAttrs = rare => _IV_NOTABLE(rare) ? ` data-r="${rare}" style="--iv-rc:${_ivRareColor(rare)}"` : '';
function _ivOrder(recentMap) {
  return (a, b) => (_invRecentAt(b, recentMap) ? 1 : 0) - (_invRecentAt(a, recentMap) ? 1 : 0)
    || _IV_RAR(b.item) - _IV_RAR(a.item)
    || String(a.item.nom || '').localeCompare(String(b.item.nom || ''), 'fr', { sensitivity: 'base' });
}

const _ivQty = item => parseInt(item?.quantite || item?.qte || 1) || 1;
const _ivSigned = n => `${n > 0 ? '+' : ''}${n}`;
const _ivGold = n => `${Number(n || 0).toLocaleString('fr-FR')} or`;
const _ivB64 = indices => btoa(JSON.stringify(indices));
const _ivCatalog = item => getInventoryCatalogItem(item?.itemId);
// Revente d'un exemplaire : prix de reprise + part de ses améliorations au tarif actuel.
const _ivResale = item => getInventoryItemResaleValue(item, _ivCatalog(item)) + upgradeResaleBonus(item, getUpgradeSettings());
const _ivReadable = item => !!getInventoryReadableDocument(item, _ivCatalog(item));

// ── Nature de l'objet ─────────────────────────
const _ivTpl = item => String(item?.template || '').toLowerCase();
const _ivIsWeapon = item => _ivTpl(item) === 'arme' || !!(item.degats || item.toucher || item.toucherStat);
const _ivIsArmor = item => _ivTpl(item) === 'armure' || !!(item.slotArmure || item.typeArmure) || (item.ca != null && item.ca !== '');
const _ivIsJewel = item => _ivTpl(item) === 'bijou' || !!item.slotBijou;
const _ivLooksJewel = item => /\b(bijou|bijoux|anneau|bague|amulette|collier|pendentif|talisman)\b/.test(_norm(`${item.nom || ''} ${item.type || ''}`));

// Familles du sac : 5 rubriques FIXES (le type libre reste lu sur la ligne).
// Signaux d'équipement d'abord, puis matériaux, puis noms de bijoux : une
// armure de cuir reste une armure, « Mat. bijou » est un matériau.
const _IV_FAMILIES = [
  { id: 'equip', label: 'Équipement' },
  { id: 'conso', label: 'Consommables' },
  { id: 'mat',   label: 'Matériaux' },
  { id: 'quest', label: 'Quête & clés' },
  { id: 'misc',  label: 'Divers' },
];
function _ivFamily(item) {
  const hay = _norm(`${item.type || ''} ${item.categorie || ''} ${item.sousType || ''} ${item.template || ''}`);
  if (_invIsQuestItem(item) || _ivReadable(item) || /\b(cle|clef|cles|clefs|document|lettre|missive)\b/.test(hay)) return 'quest';
  if (_ivIsWeapon(item) || _ivIsArmor(item) || _ivIsJewel(item)) return 'equip';
  if (/\bmat\b|materiau|composant|ressource|ingredient|reactif|plante|herbe|minerai|lingot|cuir|bois|tissu|metal/.test(hay)) return 'mat';
  if (_ivLooksJewel(item)) return 'equip';
  if (/potion|consommable|elixir|antidote|parchemin|scroll|munition|fleche|carreau|nourriture|ration|repas|boisson|poison/.test(hay)) return 'conso';
  return 'misc';
}

// « Ce que c'est » : une ligne courte et constante selon la nature de l'objet.
function _ivKind(item) {
  if (_ivIsWeapon(item)) {
    return [item.format || item.sousType || 'Arme', weaponHands(item) === 2 ? weaponHandsLabel(item) : '',
      item.portee && !/contact/i.test(item.portee) ? `portée ${item.portee}` : ''].filter(Boolean).join(' · ');
  }
  if (_ivIsArmor(item)) {
    const type = item.typeArmure ? (getArmorTypeMeta(item.typeArmure)?.label || item.typeArmure) : '';
    return [type ? `Armure ${String(type).toLowerCase()}` : 'Armure', item.slotArmure].filter(Boolean).join(' · ');
  }
  if (_ivIsJewel(item) || _ivLooksJewel(item)) return item.slotBijou || item.type || 'Bijou';
  return item.type || item.categorie || 'Objet';
}

// « Ce que ça fait » : uniquement des nombres. Mêmes calculs que la fiche
// (paliers d'amélioration compris) ; zéros inclus, ordre fixe pour comparer.
const _IV_DERIVED = [
  ['pvMaxBonus', 'PV', 'derived-pv'],
  ['pmMaxBonus', 'PM', 'derived-pm'],
  ['vitesseBonus', 'Vit.', 'derived-speed'],
  ['initiativeBonus', 'Init.', 'derived-init'],
];
function _ivBonuses(item = {}) {
  const derived = computeEquipDerivedBonus({ item });
  return [
    { k: 'CA', v: (parseInt(item.ca) || 0) + derived.caBonus, cls: 'derived-tone derived-ca' },
    ...ITEM_STAT_META.map(s => ({ k: s.short.toUpperCase(), v: getItemStatBonus(item, s.full), cls: `stat-tone stat-${s.full}` })),
    ..._IV_DERIVED.map(([key, k, tone]) => ({ k, v: derived[key], cls: `derived-tone ${tone}` })),
    ...Object.entries(computeEquipAllSkillBonuses({ item })).map(([k, v]) => ({ k, v, cls: '' })),
  ];
}
function _ivDamage(item) {
  const stats = _itemDegatsStatsShorts(item);
  return stats.length ? `${item.degats} + ${stats.join(' + ')}` : String(item.degats);
}
const _ivChips = item => [
  ...(item.degats ? [{ t: _ivDamage(item), cls: 'is-dmg' }] : []),
  ..._ivBonuses(item).filter(b => b.v).map(b => ({ t: `${b.k} ${_ivSigned(b.v)}`, cls: b.cls })),
];
const _ivChipHtml = chip => `<i class="iv-chip ${chip.cls}">${_esc(chip.t)}</i>`;
// Main secondaire « prise » par une arme à 2 mains : jamais une cible d'équipement.
const _ivSlotTaken = (c, slot) => !!c.equipement?.[slot.id]
  || (slot.id === getSecondaryWeaponSlotId() && weaponHands(c.equipement?.[getPrimaryWeaponSlotId()]) === 2);

// ── Modèle de l'onglet (la liste et la fiche lisent la même chose) ──
function _ivModel(c) {
  const inv = Array.isArray(c.inventaire) ? c.inventaire : [];
  const eqMap = getEquippedInventoryIndexMap(c);
  const loose = inv.map((_, index) => index).filter(index => !eqMap.has(index));
  const belt = new Set(loose.filter(index => _invIsBeltItem(inv[index])));
  const recent = _invRecentAcquisitions(c);
  const order = _ivOrder(recent);
  const slots = getEquipmentSlots().map(slot => {
    const index = [...eqMap.entries()].find(([, ids]) => ids.includes(slot.id))?.[0];
    const item = Number.isInteger(index) ? inv[index] : null;
    return { slot, group: item ? { key: _invItemKey(item), item, indices: [index], qte: _ivQty(item) } : null };
  });
  return {
    inv, eqMap, recent, slots,
    beltGroups: _groupInventoryEntries(inv, [...belt]).sort(order),
    bagGroups: _groupInventoryEntries(inv, loose.filter(index => !belt.has(index))).sort(order),
  };
}

// ── Sélection ─────────────────────────────────
// Clés : « worn::<emplacement>::<objet> », « belt::<objet> », « bag::<objet> »
// ou « slot::<emplacement> » (emplacement libre). Si la clé n'existe plus
// (objet équipé, rangé, consommé…), la fiche suit l'objet là où il se trouve.
const _ivWornKey = entry => `worn::${entry.slot.id}::${entry.group.key}`;
function _ivResolveSel(m, sel) {
  if (!sel) return null;
  const [zone, head = '', ...rest] = sel.split('::');
  const worn = entry => entry?.group ? { zone: 'worn', slot: entry.slot, group: entry.group, key: _ivWornKey(entry) } : null;
  const loose = (id, groups, itemKey) => {
    const group = groups.find(g => g.key === itemKey);
    return group ? { zone: id, group, key: `${id}::${group.key}` } : null;
  };
  if (zone === 'slot') {
    const entry = m.slots.find(e => e.slot.id === head);
    return entry ? (worn(entry) || { zone: 'slot', slot: entry.slot, key: sel }) : null;
  }
  const itemKey = zone === 'worn' ? rest.join('::') : [head, ...rest].join('::');
  const exact = zone === 'worn' ? worn(m.slots.find(e => e.slot.id === head && e.group?.key === itemKey))
    : zone === 'belt' ? loose('belt', m.beltGroups, itemKey)
      : zone === 'bag' ? loose('bag', m.bagGroups, itemKey) : null;
  return exact || worn(m.slots.find(e => e.group?.key === itemKey))
    || loose('belt', m.beltGroups, itemKey) || loose('bag', m.bagGroups, itemKey);
}

// ── Liste ─────────────────────────────────────
const _ivSearchValue = item => _norm(`${item.nom || ''} ${item.notePerso || ''} ${_ivKind(item)} ${item.type || ''} ${item.categorie || ''}`);

function _ivRowHtml(c, m, group, zone, canEdit, slot = null) {
  const item = group.item;
  const rare = _IV_RAR(item);
  const key = slot ? _ivWornKey({ slot, group }) : `${zone}::${group.key}`;
  const sel = _invSelected === key;
  const chips = _ivChips(item).slice(0, 3);
  const effect = !slot && _ivFamily(item) !== 'equip' ? String(getItemEffectText(item) || item.description || '').trim() : '';
  return `<div class="iv-row${sel ? ' is-sel' : ''}"${_ivRareAttrs(rare)}>
    <button type="button" class="iv-pick" data-action="_invSelect" data-key="${_esc(key)}" aria-pressed="${sel}">
      ${slot ? `<span class="iv-slot">${_esc(slot.label)}</span>` : ''}
      <span class="iv-gem"${_IV_NOTABLE(rare) ? ` title="${_esc(RARETE_NAMES[rare])}"` : ''}></span>
      <span class="iv-txt">
        <span class="iv-name"><b>${_invHighlight(item.nom || 'Sans nom')}</b>${_invRecentAt(group, m.recent) ? '<em class="iv-new">Nouveau</em>' : ''}</span>
        <span class="iv-line">${_invHighlight(_ivKind(item))}${_ivReadable(item) ? ' · lisible' : ''}${effect ? `<span class="iv-eff"> — ${_esc(effect)}</span>` : ''}</span>
      </span>
      <span class="iv-side">${chips.map(_ivChipHtml).join('')}${slot ? '' : `<span class="iv-qty">${group.qte > 1 ? `×${group.qte}` : ''}</span>`}</span>
    </button>
    ${zone === 'belt' && canEdit ? `<button type="button" class="iv-use" data-action="_invConsumeOne" data-id="${_esc(c.id)}" data-indices="${_ivB64(group.indices)}" title="Consommer 1 ${_esc(item.nom || 'objet')}">Utiliser</button>` : ''}
  </div>`;
}

function _ivFreeRowHtml(c, m, slot) {
  const head = `<span class="iv-slot">${_esc(slot.label)}</span><span class="iv-gem"></span>`;
  const primary = slot.id === getSecondaryWeaponSlotId() ? c.equipement?.[getPrimaryWeaponSlotId()] : null;
  if (primary && weaponHands(primary) === 2) {
    return `<div class="iv-row is-free"><div class="iv-pick is-static">${head}
      <span class="iv-txt"><span class="iv-name"><em>Prise</em></span><span class="iv-line">${_esc(primary.nom || 'Arme')} se manie à 2 mains</span></span>
    </div></div>`;
  }
  const n = m.bagGroups.filter(g => equipmentSlotAcceptsItem(slot, g.item)).length;
  const key = `slot::${slot.id}`;
  const sel = _invSelected === key;
  return `<div class="iv-row is-free${sel ? ' is-sel' : ''}">
    <button type="button" class="iv-pick" data-action="_invSelect" data-key="${_esc(key)}" aria-pressed="${sel}">${head}
      <span class="iv-txt"><span class="iv-name"><em>Libre</em></span><span class="iv-line">${n ? `${n} objet${n > 1 ? 's' : ''} compatible${n > 1 ? 's' : ''} dans le sac` : 'Aucun objet compatible dans le sac'}</span></span>
    </button>
  </div>`;
}

function _ivListHtml(c, m, canEdit) {
  const q = _norm(_charInvSearch || '');
  const matches = group => !q || _ivSearchValue(group.item).includes(q);
  const qty = groups => groups.reduce((sum, group) => sum + group.qte, 0);
  const head = (title, count, note = '') => `<header class="iv-sh"><h3>${title}</h3><span>${count}</span>${note ? `<small>${note}</small>` : ''}</header>`;
  const build = Array.isArray(c.builds) && c.builds.length > 1 ? getActiveBuild(c)?.name : '';
  const wornRows = m.slots.map(({ slot, group }) => group
    ? (matches(group) ? _ivRowHtml(c, m, group, 'worn', canEdit, slot) : '')
    : (q ? '' : _ivFreeRowHtml(c, m, slot))).join('');
  const belt = m.beltGroups.filter(matches);
  const fams = _IV_FAMILIES
    .map(fam => ({ ...fam, items: m.bagGroups.filter(group => matches(group) && _ivFamily(group.item) === fam.id) }))
    .filter(fam => fam.items.length);
  const bagHtml = fams.length
    ? fams.map(fam => `<div class="iv-fam"><div class="iv-fh">${fam.label}<span>${qty(fam.items)}</span></div>${fam.items.map(group => _ivRowHtml(c, m, group, 'bag', canEdit)).join('')}</div>`).join('')
    : (!q && !m.bagGroups.length ? '<p class="iv-empty">Sac vide.</p>' : '');
  const html = [
    wornRows ? `<section class="iv-sec">${head('Équipé', `${m.slots.filter(e => e.group).length} / ${m.slots.length}`, build ? `Build ${_esc(build)}` : '')}${wornRows}</section>` : '',
    belt.length ? `<section class="iv-sec">${head('À portée de main', qty(m.beltGroups), 'consommables prêts à l’emploi')}${belt.map(group => _ivRowHtml(c, m, group, 'belt', canEdit)).join('')}</section>` : '',
    bagHtml ? `<section class="iv-sec">${head('Sac', qty(m.bagGroups))}${bagHtml}</section>` : '',
  ].join('');
  return html || `<p class="iv-empty">${q ? `Rien ne correspond à « ${_esc(_charInvSearch)} ».` : 'Inventaire vide.'}</p>`;
}

// ── Fiches ────────────────────────────────────
const _ivFact = (label, value) => (value === '' || value == null) ? '' : `<div><span>${_esc(label)}</span><b>${_esc(String(value))}</b></div>`;
const _ivBtn = (label, action, attrs = '', cls = '') => `<button type="button" class="cs-grim-btn ${cls}" data-action="${action}" ${attrs}>${label}</button>`;
const _ivTagsHtml = (title, html) => html ? `<section class="iv-part"><h4>${title}</h4><div class="iv-tags">${html}</div></section>` : '';
const _IV_SHEET_X = '<button type="button" class="iv-sheet-x" data-action="_invCloseSheet" aria-label="Fermer la fiche" title="Fermer (Échap)">✕</button>';

// « Si tu l'équipes » : seuls les nombres qui changent (▲ gain, ▼ perte).
function _ivCompareHtml(item, occupant, slotLabel) {
  if (!occupant) return '';
  const before = new Map(_ivBonuses(occupant).map(b => [b.k, b.v]));
  const rows = [];
  _ivBonuses(item).forEach(b => {
    const was = before.get(b.k) || 0;
    before.delete(b.k);
    if (was !== b.v) rows.push([b.k, was, b.v]);
  });
  before.forEach((was, k) => { if (was) rows.push([k, was, 0]); });
  const dmgBefore = occupant.degats ? _ivDamage(occupant) : '—';
  const dmgAfter = item.degats ? _ivDamage(item) : '—';
  if (dmgBefore !== dmgAfter) rows.unshift(['Dégâts', dmgBefore, dmgAfter]);
  const fmt = v => typeof v === 'number' ? _ivSigned(v) : v;
  return `<section class="iv-part iv-cmp"><h4>Si tu l'équipes</h4>
    <p>Remplace <b>${_esc(occupant.nom || 'objet')}</b> <small>(${_esc(slotLabel)})</small></p>
    ${rows.length ? `<ul>${rows.map(([k, a, b]) => {
      const dir = typeof a === 'number' ? (b > a ? 'up' : 'down') : '';
      return `<li${dir ? ` class="is-${dir}"` : ''}><span>${_esc(k)}</span><s>${_esc(fmt(a))}</s><i>→</i><b>${_esc(fmt(b))}</b>${dir ? `<em>${dir === 'up' ? '▲' : '▼'}</em>` : ''}</li>`;
    }).join('')}</ul>` : '<p class="iv-dim">Aucun changement de bonus.</p>'}
  </section>`;
}

function _ivItemSheetHtml(c, m, sel, canEdit) {
  const { zone, group } = sel;
  const item = group.item;
  const cat = _ivCatalog(item);
  const rare = _IV_RAR(item);
  const ids = `data-id="${_esc(c.id)}" data-indices="${_ivB64(group.indices)}"`;
  const named = `${ids} data-name="${_esc(item.nom || '')}"`;
  const worn = [...new Set(group.indices.flatMap(index => m.eqMap.get(index) || []))];
  const per = group.qte > 1 ? ' / u.' : '';
  const price = getInventoryItemValue(item, cat);
  const resaleBase = getInventoryItemResaleValue(item, cat);
  const resale = _ivResale(item); // + reprise de ses améliorations
  const image = getInventoryItemImage(item, cat);
  const readable = !!getInventoryReadableDocument(item, cat);
  const quest = _invIsQuestItem(item);
  const armor = _ivIsArmor(item);
  const bonuses = _ivBonuses(item);
  const traits = _getTraits(item);
  const effect = String(getItemEffectText(item) || '').trim();
  const description = String(item.description || '').trim();
  const note = getInvPersonalLineForIndices(c.inventaire || [], group.indices);
  // Emplacement visé : le premier libre parmi les compatibles, sinon le préféré.
  const compatible = worn.length ? [] : getEquipmentSlots().filter(slot => equipmentSlotAcceptsItem(slot, item));
  const preferred = resolveEquipmentSlotForItem(item);
  const target = compatible.find(slot => !_ivSlotTaken(c, slot)) || compatible.find(slot => slot.id === preferred) || compatible[0] || null;
  const facts = [
    _ivFact('Dégâts', item.degats ? _ivDamage(item) : ''),
    _ivFact('Toucher', item.toucher || (item.toucherStat ? statShort(item.toucherStat) : '')),
    _ivFact('Portée', item.portee),
    _ivFact('Maniement', _ivIsWeapon(item) ? weaponHandsLabel(item) : ''),
    _ivFact('CA', armor ? _ivSigned(bonuses[0].v) : ''),
    _ivFact('Set', item.set),
    _ivFact('Valeur', price ? _ivGold(price) + per : ''),
    _ivFact('Revente', resale ? _ivGold(resale) + per : ''),
  ].join('');
  // CA d'une armure : déjà dans les faits, pas répétée dans les bonus.
  const bonusHtml = bonuses.filter(b => b.v && !(armor && b.k === 'CA'))
    .map(b => _ivChipHtml({ t: `${b.k} ${_ivSigned(b.v)}`, cls: b.cls })).join('');
  const status = worn.length
    ? `<span class="iv-status is-worn">✓ Équipé · ${_esc(worn.map(id => getEquipmentSlot(id)?.label || id).join(', '))}</span>`
    : `<span class="iv-status">${zone === 'belt' ? 'À portée de main' : 'Dans le sac'}${group.qte > 1 ? ` · ×${group.qte}` : ''}</span>`;
  const noteHtml = canEdit
    ? `<label class="iv-part iv-note"><span class="iv-h">Note perso</span><textarea data-change="saveInvPersonalLine" ${ids} data-original-note="${_esc(note.multiple ? '' : note.text)}" rows="2" maxlength="180" placeholder="${note.multiple ? 'Notes différentes : écrire ici remplacera tout le groupe.' : 'Ajouter une note…'}">${note.multiple ? '' : _esc(note.text)}</textarea></label>`
    : (note.text ? `<section class="iv-part"><h4>Note perso</h4><p>${_esc(note.text)}</p></section>` : '');
  const main = [
    zone === 'belt' ? _ivBtn(`Utiliser${group.qte > 1 ? ` <small>reste ${group.qte}</small>` : ''}`, '_invConsumeOne', ids, 'is-primary') : '',
    readable ? _ivBtn('Lire', 'openInventoryReadableContent', ids, 'is-primary') : '',
    worn.length ? _ivBtn('Retirer', 'clearEquipSlot', `data-slot="${_esc(worn[0])}" data-render-tab="inv"`)
      : target ? _ivBtn(`Équiper · ${_esc(target.label)}`, 'equipInventoryItem', `data-index="${group.indices[0]}" data-slot="${_esc(target.id)}" data-render-tab="inv"`, zone === 'belt' || readable ? '' : 'is-primary') : '',
    !worn.length && _invIsBeltItem({ ...item, belt: undefined })
      ? _ivBtn(zone === 'belt' ? 'Ranger dans le sac' : 'Mettre à portée de main', '_invToggleBelt', `${ids} data-belt="${zone !== 'belt'}"`) : '',
  ].join('');
  const more = [
    !quest && resale ? _ivBtn(`Vendre <small>${_ivGold(resale)}</small>`, 'openSellInvModal', `${named} data-prix="${resaleBase}"`, 'is-ghost') : '',
    _ivBtn('Donner', 'openSendInvModal', named, 'is-ghost'),
    item.source === 'custom' ? _ivBtn('Modifier', 'openCreateItemModal', `data-id="${_esc(c.id)}" data-index="${group.indices[0]}"`, 'is-ghost') : '',
    !quest ? _ivBtn('Jeter', 'openDeleteInvModal', named, 'is-ghost is-danger') : '',
  ].join('');
  return `<aside class="iv-sheet"${_ivRareAttrs(rare)} aria-label="Fiche de ${_esc(item.nom || 'l’objet')}">
    ${_IV_SHEET_X}
    <header class="iv-sheet-head">
      <div class="iv-sheet-ic">${image ? `<img src="${_esc(image)}" alt="" loading="lazy">` : '<i></i>'}</div>
      <div class="iv-sheet-id">
        <span class="iv-kicker"><b>${_esc(_IV_NOTABLE(rare) ? RARETE_NAMES[rare] : (RARETE_NAMES[1] || 'Commun'))}</b> · ${_esc(_ivKind(item))}</span>
        <h3>${_esc(item.nom || 'Sans nom')}</h3>
        ${status}
      </div>
    </header>
    ${facts ? `<div class="iv-facts">${facts}</div>` : ''}
    ${_ivTagsHtml('Bonus', bonusHtml)}
    ${_ivTagsHtml('Traits', traits.map(trait => `<span class="iv-tag">${_esc(trait)}</span>`).join(''))}
    ${effect ? `<section class="iv-part"><h4>Effet</h4><p>${_esc(effect)}</p></section>` : ''}
    ${description && description !== effect ? `<section class="iv-part"><h4>Description</h4><p class="is-edito">${_esc(description)}</p></section>` : ''}
    ${target ? _ivCompareHtml(item, c.equipement?.[target.id], target.label) : ''}
    ${noteHtml}
    ${canEdit ? `<footer class="iv-acts">${main ? `<div class="iv-acts-main">${main}</div>` : ''}<div class="iv-acts-more">${more}</div></footer>` : ''}
  </aside>`;
}

function _ivSlotSheetHtml(c, m, slot, canEdit) {
  const options = m.bagGroups.filter(group => equipmentSlotAcceptsItem(slot, group.item));
  return `<aside class="iv-sheet" aria-label="Emplacement ${_esc(slot.label)}">
    ${_IV_SHEET_X}
    <header class="iv-sheet-head">
      <div class="iv-sheet-ic is-empty"><i></i></div>
      <div class="iv-sheet-id">
        <span class="iv-kicker">Emplacement libre</span>
        <h3>${_esc(slot.label)}</h3>
        <span class="iv-status">${options.length ? 'Choisis un objet du sac à équiper.' : 'Rien de compatible dans le sac pour l’instant.'}</span>
      </div>
    </header>
    ${options.length ? `<section class="iv-part"><h4>Compatibles</h4><div class="iv-opts">${options.map(group => `<div class="iv-opt"${_ivRareAttrs(_IV_RAR(group.item))}>
      <button type="button" class="iv-opt-pick" data-action="_invSelect" data-key="${_esc(`bag::${group.key}`)}" title="Voir la fiche">
        <span class="iv-gem"></span>
        <span class="iv-txt"><b>${_esc(group.item.nom || 'Sans nom')}</b><small>${_esc(_ivKind(group.item))}</small></span>
        <span class="iv-side">${_ivChips(group.item).slice(0, 2).map(_ivChipHtml).join('')}</span>
      </button>
      ${canEdit ? _ivBtn('Équiper', 'equipInventoryItem', `data-index="${group.indices[0]}" data-slot="${_esc(slot.id)}" data-render-tab="inv"`, 'is-primary cbx-sm') : ''}
    </div>`).join('')}</div></section>` : ''}
  </aside>`;
}

// Sans sélection : vue d'ensemble (totaux, bonus portés, nouveautés, légende).
function _ivSummarySheetHtml(c, m) {
  const total = fn => m.inv.reduce((sum, item) => sum + fn(item) * _ivQty(item), 0);
  const worn = m.slots.filter(entry => entry.group);
  const sums = new Map();
  worn.forEach(entry => _ivBonuses(entry.group.item).forEach(b => {
    if (b.v) sums.set(b.k, { ...b, v: (sums.get(b.k)?.v || 0) + b.v });
  }));
  const fresh = [
    ...worn.map(entry => [_ivWornKey(entry), entry.group]),
    ...m.beltGroups.map(group => [`belt::${group.key}`, group]),
    ...m.bagGroups.map(group => [`bag::${group.key}`, group]),
  ].map(([key, group]) => ({ key, group, at: _invRecentAt(group, m.recent) }))
    .filter(entry => entry.at).sort((a, b) => b.at - a.at);
  const tiers = RARETE_NAMES.map((name, index) => [name, index]).filter(([name, index]) => index >= 2 && name);
  return `<aside class="iv-sheet is-summary" aria-label="Vue d'ensemble de l'inventaire">
    ${_IV_SHEET_X}
    <header class="iv-sheet-id">
      <span class="iv-kicker">Vue d'ensemble</span>
      <h3>Inventaire de ${_esc(c.nom || 'ce personnage')}</h3>
      <span class="iv-status">Sélectionne un objet pour voir sa fiche complète.</span>
    </header>
    <div class="iv-facts">
      ${_ivFact('Objets', total(() => 1))}
      ${_ivFact('Emplacements', `${worn.length} / ${m.slots.length}`)}
      ${_ivFact('Valeur', _ivGold(total(item => getInventoryItemValue(item, _ivCatalog(item)))))}
      ${_ivFact('Revente', _ivGold(total(_ivResale)))}
    </div>
    ${_ivTagsHtml('Bonus de l’équipement', [...sums.values()].filter(b => b.v).map(b => _ivChipHtml({ t: `${b.k} ${_ivSigned(b.v)}`, cls: b.cls })).join(''))}
    ${fresh.length ? `<section class="iv-part"><h4>Nouveautés · 14 jours</h4><div class="iv-fresh">${fresh.map(({ key, group }) =>
      `<button type="button" data-action="_invSelect" data-key="${_esc(key)}"${_ivRareAttrs(_IV_RAR(group.item))}><span class="iv-gem"></span>${_esc(group.item.nom || 'Sans nom')}${group.qte > 1 ? ` <small>×${group.qte}</small>` : ''}</button>`).join('')}</div></section>` : ''}
    ${tiers.length ? `<section class="iv-part"><h4>Rareté</h4><div class="iv-legend">${tiers.map(([name]) =>
      `<span style="--iv-rc:${_rareteColor(name) || '#7a8fa8'}"><i class="iv-gem"></i>${_esc(name)}</span>`).join('')}<span class="is-common">${_esc(RARETE_NAMES[1] || 'Commun')} : sans marque</span></div></section>` : ''}
  </aside>`;
}

function _ivSheetHtml(c, m, sel, canEdit) {
  if (!sel) return _ivSummarySheetHtml(c, m);
  return sel.zone === 'slot' ? _ivSlotSheetHtml(c, m, sel.slot, canEdit) : _ivItemSheetHtml(c, m, sel, canEdit);
}

// ── Montage ───────────────────────────────────
let _ivKeysBound = false;
function _ivBindInventoryKeys() {
  if (_ivKeysBound) return; _ivKeysBound = true;
  document.addEventListener('keydown', e => {
    if (!document.querySelector('.iv')) return;
    if (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) {
      const input = document.querySelector('.iv-search input');
      if (input) { e.preventDefault(); input.focus(); }
    } else if (e.key === 'Escape' && (_invSelected || _invSheetOpen) && e.target.tagName !== 'TEXTAREA'
      && !document.getElementById('modal-overlay')?.classList.contains('show')) {
      _invCloseSheet();
    }
  });
}

// Largeur RÉELLE de l'onglet (barre latérale ouverte, portable…) : en dessous,
// la fiche quitte la colonne et s'ouvre en panneau. Classe posée par
// ResizeObserver plutôt que @container : elle sert aussi hors de l'onglet
// (boutons flottants masqués via body:has).
const _IV_NARROW = 820;
let _ivResizeObs = null;
function _ivWatchWidth() {
  const root = document.querySelector('#char-tab-content .iv');
  if (!root || typeof ResizeObserver === 'undefined') return;
  if (!_ivResizeObs) {
    _ivResizeObs = new ResizeObserver(entries => entries.forEach(({ target, contentRect }) => {
      if (contentRect.width) target.classList.toggle('is-narrow', contentRect.width < _IV_NARROW);
    }));
  }
  _ivResizeObs.disconnect();
  _ivResizeObs.observe(root);
}

// Tarifs d'amélioration (world/upgrade_settings) : lus seulement si l'inventaire
// porte un objet amélioré, pour que la revente affichée inclue la reprise ; la
// fiche est rafraîchie si les tarifs chargés ne sont pas ceux du rendu.
function _ivEnsureUpgradeSettings(c) {
  if (!Array.isArray(c.inventaire) || !c.inventaire.some(hasUpgrades)) return;
  const shown = getUpgradeSettings();
  loadUpgradeSettings().then(settings => {
    if (settings === shown || !document.querySelector('.iv')) return;
    if ((charSession.getCurrentChar?.() || STATE.activeChar)?.id === c.id) _invSelect(_invSelected, { open: false });
  });
}

export function renderCharInventaire(c, canEdit) {
  if (_invSelCharId !== c.id) { _invSelCharId = c.id; _invSelected = ''; _invSheetOpen = false; }
  _invLastCanEdit = !!canEdit;
  const m = _ivModel(c);
  const sel = _ivResolveSel(m, _invSelected);
  if (_invSelected && !sel) _invSheetOpen = false; // objet parti (vendu, consommé…)
  _invSelected = sel?.key || '';
  const width = document.getElementById('char-tab-content')?.clientWidth || 0;
  setTimeout(_ivBindInventoryKeys, 0);
  queueMicrotask(_ivWatchWidth);
  _ivEnsureUpgradeSettings(c);
  return `<div class="iv${width && width < _IV_NARROW ? ' is-narrow' : ''}${_invSheetOpen ? ' is-sheet-open' : ''}">
    <div class="iv-bar">
      <label class="iv-search"><span aria-hidden="true">🔍</span><input type="search" value="${_esc(_charInvSearch)}" placeholder="Chercher un objet…  ( / )" data-input="_charInvSearch" autocomplete="off" aria-label="Rechercher dans l’inventaire"></label>
      ${canEdit ? `<button class="iv-btn" data-action="addInvItem" data-id="${_esc(c.id)}">+ Ajouter</button>` : ''}
      ${isFeatureEnabled('recettes') ? recipeBookButton(c) : ''}
      ${inventoryHistoryButton(c)}
      <button type="button" class="iv-btn iv-sum" data-action="_invSelect" data-key="">Résumé</button>
    </div>
    <div class="iv-body">
      <div class="iv-list">${_ivListHtml(c, m, canEdit)}</div>
      ${_ivSheetHtml(c, m, sel, canEdit)}
    </div>
  </div>`;
}

// Sélection : mise à jour CIBLÉE (fiche + surbrillance), sans re-rendre la
// liste → ni saut de défilement ni perte de focus.
function _invSelect(key, { open = true } = {}) {
  const c = charSession.getCurrentChar?.() || STATE.activeChar;
  const root = document.querySelector('.iv');
  if (open) _invSheetOpen = true;
  if (!c || !root) { _invSelected = key; _rerenderInventoryView(); return; }
  const m = _ivModel(c);
  const sel = _ivResolveSel(m, key);
  _invSelected = sel?.key || '';
  const sheet = root.querySelector('.iv-sheet');
  if (sheet) sheet.outerHTML = _ivSheetHtml(c, m, sel, _invLastCanEdit);
  root.querySelectorAll('.iv-row.is-sel').forEach(row => {
    row.classList.remove('is-sel');
    row.querySelector('.iv-pick')?.setAttribute('aria-pressed', 'false');
  });
  const pick = _invSelected ? root.querySelector(`.iv-pick[data-key="${CSS.escape(_invSelected)}"]`) : null;
  pick?.setAttribute('aria-pressed', 'true');
  pick?.closest('.iv-row')?.classList.add('is-sel');
  root.classList.toggle('is-sheet-open', _invSheetOpen);
}

// ✕ / Échap : referme le panneau (écran étroit) et revient à la vue d'ensemble.
function _invCloseSheet() {
  _invSheetOpen = false;
  _invSelect('', { open: false });
}

// ══════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════
function _decodeIndices(b64) {
  try { return JSON.parse(atob(b64)); } catch { return []; }
}

function getInvPersonalLineForIndices(inv, indices) {
  const notes = [...new Set(indices
    .map(idx => String(inv?.[idx]?.notePerso || '').trim())
    .filter(Boolean))];
  if (notes.length === 0) return { text: '', multiple: false };
  if (notes.length === 1) return { text: notes[0], multiple: false };
  return { text: 'Notes différentes selon les exemplaires.', multiple: true };
}

/** Ouvre le texte privé d'un objet uniquement depuis l'inventaire qui le possède. */
export async function openInventoryReadableContent(charId, indicesB64) {
  const c = getCharacterById(charId);
  const indices = _decodeIndices(indicesB64);
  const item = c?.inventaire?.[indices[0]];
  if (!c || !item || !indices.length || !canControlCharacter(c)) {
    showNotif("Ce document n'est pas accessible.", 'error');
    return;
  }

  await ensureInventoryCatalog();
  const catalogItem = getInventoryCatalogItem(item.itemId);
  const metadata = getInventoryReadableDocument(item, catalogItem);
  const stored = item.itemId ? await getDocDataSilent('shopContent', item.itemId) : null;
  const documentData = stored?.html
    ? {
        title: String(stored.title || metadata?.title || item.nom || 'Document'),
        html: String(stored.html || ''),
      }
    : metadata;
  if (!documentData) {
    showNotif("Cet objet ne contient aucun texte à lire.", 'info');
    return;
  }

  pushModal(`📖 ${documentData.title}`, `
    <article class="inv-reader">
      <header class="inv-reader-head">
        <span class="inv-reader-kicker">Document possédé par ${_esc(c.nom || 'ce personnage')}</span>
        <h2>${_esc(documentData.title)}</h2>
        <p>${_esc(item.nom || 'Objet')}</p>
      </header>
      ${richTextContentHtml({ html: documentData.html, className: 'inv-reader-content' })}
      <footer class="inv-reader-footer">
        <button class="btn btn-primary" data-action="closeInventoryReader">Retour à l'objet</button>
      </footer>
    </article>
  `, null, {
    subtitle: item.nom || 'Lecture',
    accent: '#9d6fff',
  });
}

export async function saveInvPersonalLine(charId, indicesB64, sourceEl = null) {
  const c = getCharacterById(charId);
  if (!c || !sourceEl) return;
  const indices = _decodeIndices(indicesB64);
  if (!indices.length) return;

  const note = String(sourceEl.value || '').trim().slice(0, 180);
  const original = String(sourceEl.dataset.originalNote || '').trim();
  if (note === original) return;

  const inv = Array.isArray(c.inventaire) ? [...c.inventaire] : [];
  indices.forEach(idx => {
    if (!inv[idx]) return;
    const next = { ...inv[idx] };
    if (note) next.notePerso = note;
    else delete next.notePerso;
    inv[idx] = next;
  });

  c.inventaire = inv;
  if (STATE.activeChar?.id === c.id) STATE.activeChar.inventaire = inv;
  const stChar = (STATE.characters || []).find(x => x.id === c.id);
  if (stChar) stChar.inventaire = inv;
  const feedbackEl = sourceEl.closest?.('.inv-note-editable') || sourceEl;
  feedbackEl.classList.add('is-saving');
  if (await trySave('characters', charId, { inventaire: inv })) {
    sourceEl.dataset.originalNote = note;
    feedbackEl.classList.remove('is-saving');
    feedbackEl.classList.add('is-saved');
    setTimeout(() => feedbackEl.classList.remove('is-saved'), 900);
    showNotif(note ? 'Ligne personnelle enregistrée.' : 'Ligne personnelle supprimée.', 'success');
  } else {
    feedbackEl.classList.remove('is-saving');
  }
}
// ══════════════════════════════════════════════
// VENTE
// ══════════════════════════════════════════════
// Ordre de vente d'un groupe : exemplaires rangés d'abord, équipés ensuite.
function _sellOrder(c, indices) {
  const equippedMap = getEquippedInventoryIndexMap(c);
  const worn = idx => !!(equippedMap.get(idx) || []).length;
  return [...indices.filter(idx => !worn(idx)), ...indices.filter(worn)];
}

export async function openSellInvModal(charId, indicesB64, prixVente, nom) {
  const indices = _decodeIndices(indicesB64);
  const maxQte  = indices.length;
  if (maxQte === 0) return;

  const c = getCharacterById(charId);
  const equippedMap = c ? getEquippedInventoryIndexMap(c) : new Map();
  const equippedSlots = [...new Set(indices.flatMap(idx => equippedMap.get(idx) || []))];
  const hasEquipped = equippedSlots.length > 0;

  // Reprise des améliorations : X % de leur tarif actuel, par exemplaire, dans
  // l'ordre où sellInvItemBulk les vend.
  const items = c ? _sellOrder(c, indices).map(idx => c.inventaire?.[idx]) : [];
  const upgradedItems = items.filter(it => it && hasUpgrades(it));
  const upgradedCount = upgradedItems.length;
  const settings = upgradedCount ? await loadUpgradeSettings() : getUpgradeSettings();
  const refundRatio = Math.min(1, parseFloat(settings?.refundUpgradeRatio) || 0);
  const tariffAll = upgradedItems.reduce((s, it) => s + upgradeTariffValue(it, settings), 0);
  // Cumul par quantité vendue, exposé au handler de saisie pour le total live.
  const refundsCum = items.reduce((acc, it) => { acc.push((acc[acc.length-1]||0) + upgradeResaleBonus(it, settings)); return acc; }, []);
  const refundForQty = (q) => refundsCum[Math.min(q, refundsCum.length) - 1] || 0;
  const totalRefundAll = refundForQty(maxQte);
  _sellRefundsCum = refundsCum;

  const refundHintHtml = totalRefundAll > 0
    ? ` <span id="sell-refund-hint" class="invm-hint">${refundForQty(1) > 0 ? `(dont +${refundForQty(1)} reprise)` : ''}</span>`
    : '';

  openModal(`💰 Vendre`, `
    <div class="invm">
      <header class="invm-header">
        <div class="invm-icon">💰</div>
        <div class="invm-title">
          <h3>${nom}</h3>
          <span class="invm-subtitle">${prixVente} or par unité · ${maxQte} en stock</span>
        </div>
      </header>

      ${hasEquipped ? `
      <div class="invm-warn">
        <span class="invm-warn-ico">⚠️</span>
        <div>
          <b>Objet actuellement équipé</b>
          <span>Slot${equippedSlots.length>1?'s':''} : ${equippedSlots.join(', ')}. Il sera automatiquement déséquipé.</span>
        </div>
      </div>` : ''}

      ${upgradedCount > 0 ? `
      <div class="invm-info">
        <span class="invm-info-ico">✨</span>
        <div>
          <b>Objet${upgradedCount>1?'s':''} amélioré${upgradedCount>1?'s':''}</b>
          <span>${refundRatio > 0
            ? `Améliorations reprises à ${Math.round(refundRatio * 100)} % de leur tarif (${tariffAll} PO) : ${maxQte > 1 ? 'jusqu’à ' : ''}<b style="color:var(--gold)">+${totalRefundAll} or</b>.`
            : `Les améliorations (${tariffAll} PO au tarif actuel) sont perdues à la revente.`}</span>
        </div>
      </div>` : ''}

      <div class="invm-qty">
        <label>Quantité</label>
        <div class="invm-stepper">
          <button type="button" class="invm-step" data-action="_invmStep" data-input="sell-qty" data-delta="-1" data-max="${maxQte}" data-context="sell">−</button>
          <input type="number" id="sell-qty" min="1" max="${maxQte}" value="1"
            data-input="_sellRefreshTotal" data-prix="${prixVente}" data-max="${maxQte}">
          <button type="button" class="invm-step" data-action="_invmStep" data-input="sell-qty" data-delta="1" data-max="${maxQte}" data-context="sell">+</button>
        </div>
        <div class="invm-total">
          <span class="invm-total-lbl">Total</span>
          <span class="invm-total-val" id="sell-total">${prixVente + refundForQty(1)} <small>or</small></span>
          ${refundHintHtml}
        </div>
      </div>

      <footer class="invm-actions">
        <button class="invm-btn invm-btn-primary invm-btn-gold" data-action="sellInvItemBulk" data-id="${charId}" data-indices="${indicesB64}" data-prix="${prixVente}">
          💰 Vendre${hasEquipped?' (déséquiper)':''}
        </button>
        <button class="invm-btn invm-btn-outline" data-action="close-modal">Annuler</button>
      </footer>
    </div>
  `);
}

// Bouton stepper réutilisable
function _invmStep(id, delta, max, kind) {
  const inp = document.getElementById(id);
  if (!inp) return;
  const next = Math.max(1, Math.min(max, (parseInt(inp.value) || 1) + delta));
  inp.value = next;
  // bubbles:true → le listener délégué sur document (data-input) capte bien
  // l'événement, sinon le total ne se met pas à jour via les boutons +/−.
  inp.dispatchEvent(new Event('input', { bubbles: true }));
}

// Live-update du total dans la modale de vente (qty × prix + reprise upgrades).
function _sellRefreshTotal(input, prixVente, maxQte) {
  const q = Math.min(Math.max(1, parseInt(input.value) || 1), maxQte);
  const cum = Array.isArray(_sellRefundsCum) ? _sellRefundsCum : [];
  const refund = cum[Math.min(q, cum.length) - 1] || 0;
  const total = q * prixVente + refund;
  const totalEl = document.getElementById('sell-total');
  if (totalEl) totalEl.textContent = `${total} or`;
  const hintEl = document.getElementById('sell-refund-hint');
  if (hintEl) hintEl.textContent = refund > 0 ? `(dont +${refund} reprise)` : '';
}

export async function sellInvItemBulk(charId, indicesB64, prixVente) {
  try {
    const c = getCharacterById(charId);
    if (!c) return;

    const allIndices = _decodeIndices(indicesB64);
    const qty = Math.min(Math.max(1, parseInt(document.getElementById('sell-qty')?.value)||1), allIndices.length);
    const indicesToSell = _sellOrder(c, allIndices).slice(0, qty);

    const inv      = Array.isArray(c.inventaire) ? [...c.inventaire] : [];
    const item     = inv[indicesToSell[0]];
    if (!item) return;
    const itemNom  = item.nom || 'objet';
    const totalPrix = prixVente * qty;

    // Reprise des améliorations : X % du tarif actuel de celles des exemplaires vendus.
    const settings = indicesToSell.some(idx => hasUpgrades(inv[idx])) ? await loadUpgradeSettings() : getUpgradeSettings();
    const refundTotal = indicesToSell.reduce((s, idx) => s + upgradeResaleBonus(inv[idx], settings), 0);

    const sorted = [...indicesToSell].sort((a,b)=>b-a);
    sorted.forEach(idx => inv.splice(idx, 1));

    if (item.itemId) {
      const { restockShopItem } = await import('../shop.js');
      for (let i = 0; i < qty; i++) {
        await restockShopItem(item.itemId);
      }
    }

    const equipSync = syncEquipmentAfterInventoryMutation(c, indicesToSell);
    const historyPatch = inventoryHistoryPayload(c, makeInventoryHistoryEntry('sell', item, qty, {
      ..._inventoryHistoryActor(),
      source: 'Inventaire',
      note: `${totalPrix + refundTotal} or`,
    }));
    const extraPayload = { inventaire: inv, ...historyPatch };
    if (equipSync.changed) {
      extraPayload.equipement = equipSync.equipement;
      extraPayload.statsBonus = equipSync.statsBonus;
      patchBuildLocally(c, { equipement: equipSync.equipement, statsBonus: equipSync.statsBonus });
      extraPayload.builds = characterBuildsForStorage(c);
      extraPayload.activeBuildId = c.activeBuildId;
    }

    // Une ligne par produit financier : vente + reprise (si > 0), une seule écriture
    const entries = [{
      delta: +totalPrix,
      reason: qty > 1 ? `Vente ×${qty} : ${itemNom}` : `Vente : ${itemNom}`,
    }];
    if (refundTotal > 0) {
      entries.push({ delta: +refundTotal, reason: `Reprise améliorations : ${itemNom}` });
    }

    const res = await useGoldMulti(charId, entries, { charObj: c, extraPayload });
    if (!res.ok) { showNotif(res.error || 'Erreur vente', 'error'); return; }
    _patchInventoryHistoryLocal(c, historyPatch.inventoryHistory);

    closeModal();
    const unequipMsg = equipSync.removedSlots.length
      ? ` ${equipSync.removedSlots.length > 1 ? 'Objets déséquipés automatiquement.' : 'Objet déséquipé automatiquement.'}`
      : '';
    const refundMsg = refundTotal > 0 ? ` (+${refundTotal} or de reprise)` : '';
    showNotif(`💰 ×${qty} "${itemNom}" vendu${qty>1?'s':''} pour ${totalPrix} or${refundMsg} !${unequipMsg}`, 'success');
    charSession.refresh?.(c);
    _renderInventoryChar(c, charSession.getCurrentCharTab() || 'inventaire');
  } catch (e) { notifySaveError(e); }
}

export async function sellInvItem(charId, invIndex) {
  const b64 = btoa(JSON.stringify([invIndex]));
  const c = getCharacterById(charId);
  const item = (c?.inventaire||[])[invIndex];
  const pv = parseFloat(item?.prixVente) || Math.round((parseFloat(item?.prixAchat)||0)*0.6);
  openSellInvModal(charId, b64, pv, item?.nom||'objet');
}

// ══════════════════════════════════════════════
// SUPPRESSION
// ══════════════════════════════════════════════
export function openDeleteInvModal(charId, indicesB64, nom) {
  const indices = _decodeIndices(indicesB64);
  const c = getCharacterById(charId);
  if (_invIsQuestItem(c?.inventaire?.[indices[0]] || {})) {
    showNotif("Un objet de quête ne peut pas être supprimé depuis l’inventaire.", 'error');
    return;
  }
  const maxQte  = indices.length;
  openModal(`🗑️ Supprimer`, `
    <div class="invm">
      <header class="invm-header invm-header-danger">
        <div class="invm-icon">🗑️</div>
        <div class="invm-title">
          <h3>${nom}</h3>
          <span class="invm-subtitle">${maxQte} exemplaire${maxQte>1?'s':''} dans l'inventaire</span>
        </div>
      </header>

      <div class="invm-warn invm-warn-danger">
        <span class="invm-warn-ico">⚠️</span>
        <div>
          <b>Suppression définitive</b>
          <span>L'objet sera retiré de l'inventaire. Action irréversible.</span>
        </div>
      </div>

      <div class="invm-qty">
        <label>Quantité</label>
        <div class="invm-stepper">
          <button type="button" class="invm-step" data-action="_invmStep" data-input="del-qty" data-delta="-1" data-max="${maxQte}">−</button>
          <input type="number" id="del-qty" min="1" max="${maxQte}" value="1">
          <button type="button" class="invm-step" data-action="_invmStep" data-input="del-qty" data-delta="1" data-max="${maxQte}">+</button>
        </div>
      </div>

      <footer class="invm-actions">
        <button class="invm-btn invm-btn-primary invm-btn-danger"
          data-action="deleteInvItemBulk" data-id="${charId}" data-indices="${indicesB64}">🗑️ Supprimer</button>
        <button class="invm-btn invm-btn-outline" data-action="close-modal">Annuler</button>
      </footer>
    </div>
  `);
}

export async function deleteInvItemBulk(charId, indicesB64) {
  const c = getCharacterById(charId);
  if (!c) return;
  const allIndices = _decodeIndices(indicesB64);
  const qty = Math.min(Math.max(1, parseInt(document.getElementById('del-qty')?.value)||1), allIndices.length);
  const inv = Array.isArray(c.inventaire) ? [...c.inventaire] : [];
  const removedIndices = allIndices.slice(0, qty);
  const removedItem = inv[removedIndices[0]];
  const sorted = [...removedIndices].sort((a,b)=>b-a);
  sorted.forEach(idx => inv.splice(idx, 1));
  const equipSync = syncEquipmentAfterInventoryMutation(c, removedIndices);
  const historyPatch = inventoryHistoryPayload(c, makeInventoryHistoryEntry('delete', removedItem, qty, {
    ..._inventoryHistoryActor(),
    source: 'Inventaire',
  }));
  const payload = { inventaire: inv, ...historyPatch };
  if (equipSync.changed) {
    payload.equipement = equipSync.equipement;
    payload.statsBonus = equipSync.statsBonus;
    patchBuildLocally(c, { equipement: equipSync.equipement, statsBonus: equipSync.statsBonus });
    payload.builds = characterBuildsForStorage(c);
    payload.activeBuildId = c.activeBuildId;
  }
  if (await trySave('characters', charId, payload)) {
    c.inventaire = inv;
    if (equipSync.changed) {
      c.equipement = equipSync.equipement;
      c.statsBonus = equipSync.statsBonus;
    }
    _patchInventoryHistoryLocal(c, historyPatch.inventoryHistory);
    closeModal();
    const deleteMsg = equipSync.removedSlots.length
      ? ` ${equipSync.removedSlots.length > 1 ? 'Objets déséquipés automatiquement.' : 'Objet déséquipé automatiquement.'}`
      : '';
    showNotif(`Objet(s) supprimé(s).${deleteMsg}`, 'success');
  }
  _renderInventoryChar(c, charSession.getCurrentCharTab() || 'inventaire');
}

// ══════════════════════════════════════════════
// ENVOI
// ══════════════════════════════════════════════
// Filtre live des cartes destinataires (envoi objet/or) : beaucoup de joueurs →
// on tape pour filtrer par nom / pseudo. Commun aux deux modales.
function _sendTargetFilter(el) {
  const q = _norm(el.value || '');
  const list = document.getElementById('send-target-list');
  if (!list) return;
  let shown = 0;
  list.querySelectorAll('[data-search]').forEach(card => {
    const ok = !q || card.dataset.search.includes(q);
    // Classe plutôt que style.display='' : sinon on efface le display:flex inline
    // des cartes (la modale d'or) → mise en forme cassée.
    card.classList.toggle('send-target-hidden', !ok);
    if (ok) shown++;
  });
  const empty = document.getElementById('send-target-empty');
  if (empty) empty.style.display = shown ? 'none' : '';
}

async function _loadTransferTargets(fromCharId) {
  let sessionCharacters = [];
  try {
    // `characters` est alimentée par le cache session-live : cette lecture récupère
    // toute l'aventure, même si STATE.characters est limité aux personnages du joueur.
    sessionCharacters = await loadCollection('characters');
  } catch (error) {
    console.error('[inventory] load transfer targets:', error);
  }

  const targets = mergeCharacterTransferTargets(
    fromCharId,
    sessionCharacters,
    STATE.characters || [],
  );
  _modalCharTargets = targets;
  return targets;
}

export async function openSendInvModal(charId, indicesB64OrIndex, nomOrUnused) {
  const c = getCharacterById(charId);
  if (!c) return;

  let indices;
  if (typeof indicesB64OrIndex === 'number') {
    indices = [indicesB64OrIndex];
  } else {
    indices = _decodeIndices(indicesB64OrIndex);
  }
  if (!indices.length) return;

  const item    = (c.inventaire||[])[indices[0]];
  if (!item) return;
  const nom     = nomOrUnused || item.nom || 'Objet';
  const maxQte  = indices.length;
  const b64     = btoa(JSON.stringify(indices));

  const otherChars = await _loadTransferTargets(charId);
  if (!otherChars.length) { showNotif('Aucun autre personnage disponible.','error'); return; }

  const rareteN   = parseInt(item.rarete) || 0;
  const itemColor = _rareteColor(RARETE_NAMES[rareteN]) || 'var(--border)';

  const targetCards = otherChars.map(target => {
    const colors    = ['#4f8cff','#22c38e','#e8b84b','#ff6b6b','#b47fff','#f59e0b'];
    const couleur   = colors[(target.nom||'').charCodeAt(0) % colors.length];
    return `<label class="invm-target" data-search="${_esc(_norm((target.nom||'')+' '+(target.ownerPseudo||'')))}" style="--tc:${couleur}">
      <input type="radio" name="send-target" value="${target.id}">
      <div class="invm-target-av">
        ${characterPortraitContent(target)}
      </div>
      <div class="invm-target-body">
        <div class="invm-target-name">${target.nom||'?'}</div>
        ${target.ownerPseudo ? `<div class="invm-target-sub">${target.ownerPseudo}</div>` : ''}
      </div>
      <span class="invm-target-check">✓</span>
    </label>`;
  }).join('');

  openModal(`📤 Envoyer`, `
    <div class="invm">
      <header class="invm-header invm-header-arcane">
        <div class="invm-icon">📤</div>
        <div class="invm-title">
          <h3>${nom}</h3>
          <span class="invm-subtitle">${item.format||item.slotArmure||item.type||'Objet'} · ${maxQte} disponible${maxQte>1?'s':''}</span>
        </div>
      </header>

      ${maxQte > 1 ? `
      <div class="invm-qty">
        <label>Quantité à envoyer</label>
        <div class="invm-stepper">
          <button type="button" class="invm-step" data-action="_invmStep" data-input="send-qty" data-delta="-1" data-max="${maxQte}">−</button>
          <input type="number" id="send-qty" min="1" max="${maxQte}" value="1">
          <button type="button" class="invm-step" data-action="_invmStep" data-input="send-qty" data-delta="1" data-max="${maxQte}">+</button>
        </div>
      </div>` : ''}

      <div class="invm-section-lbl">Destinataire</div>
      ${otherChars.length > 4 ? `<input type="text" class="input-field" data-input="_sendTargetFilter" placeholder="🔍 Filtrer un personnage…" autocomplete="off" style="width:100%;margin-bottom:.45rem">` : ''}
      <div class="invm-targets" id="send-target-list">${targetCards}
        <div id="send-target-empty" style="display:none;padding:.6rem;text-align:center;color:var(--text-dim);font-size:.78rem">Aucun personnage trouvé</div>
      </div>

      <footer class="invm-actions">
        <button class="invm-btn invm-btn-primary invm-btn-arcane" data-action="sendInvItem" data-id="${charId}" data-indices="${b64}">📤 Envoyer</button>
        <button class="invm-btn invm-btn-outline" data-action="close-modal">Annuler</button>
      </footer>
    </div>
  `);
}

export async function sendInvItem(fromCharId, indicesB64) {
  const fromChar = STATE.characters?.find(x => x.id === fromCharId) || STATE.activeChar;
  if (!fromChar) return;

  const targetId = document.querySelector('input[name="send-target"]:checked')?.value;
  if (!targetId) { showNotif('Sélectionne un personnage cible.','error'); return; }

  const toChar = STATE.characters?.find(x => x.id === targetId)
    || (_modalCharTargets || []).find(x => x.id === targetId);
  if (!toChar) { showNotif('Personnage introuvable.','error'); return; }

  const allIndices = _decodeIndices(indicesB64);
  const maxQte  = allIndices.length;
  const qtyEl   = document.getElementById('send-qty');
  const qty     = qtyEl ? Math.min(Math.max(1, parseInt(qtyEl.value)||1), maxQte) : 1;
  const equippedMap = getEquippedInventoryIndexMap(fromChar);
  const unequippedIndices = allIndices.filter(idx => !(equippedMap.get(idx) || []).length);
  const equippedIndices = allIndices.filter(idx => (equippedMap.get(idx) || []).length);
  const toSend  = [...unequippedIndices, ...equippedIndices].slice(0, qty);

  const fromInv = Array.isArray(fromChar.inventaire) ? [...fromChar.inventaire] : [];
  const firstItem = fromInv[toSend[0]];
  if (!firstItem) return;

  const itemsToTransfer = toSend.map(idx => ({...fromInv[idx]}));
  [...toSend].sort((a,b)=>b-a).forEach(idx => fromInv.splice(idx, 1));

  const toInv = Array.isArray(toChar.inventaire) ? [...toChar.inventaire] : [];
  itemsToTransfer.forEach(it => toInv.push(it));

  const equipSync = syncEquipmentAfterInventoryMutation(fromChar, toSend);
  const fromHistoryPatch = inventoryHistoryPayload(fromChar, makeInventoryHistoryEntry('send', firstItem, qty, {
    ..._inventoryHistoryActor(),
    source: 'Inventaire',
    targetName: toChar.nom || '',
  }));
  const toHistoryPatch = inventoryHistoryPayload(toChar, makeInventoryHistoryEntry('receive', firstItem, qty, {
    ..._inventoryHistoryActor(),
    source: fromChar.nom || 'Inventaire',
    targetName: fromChar.nom || '',
  }));
  const fromPayload = { inventaire: fromInv, ...fromHistoryPatch };
  if (equipSync.changed) {
    fromPayload.equipement = equipSync.equipement;
    fromPayload.statsBonus = equipSync.statsBonus;
    patchBuildLocally(fromChar, { equipement: equipSync.equipement, statsBonus: equipSync.statsBonus });
    fromPayload.builds = characterBuildsForStorage(fromChar);
    fromPayload.activeBuildId = fromChar.activeBuildId;
  }

  try {
    await batchUpdateInCol([
      { col: 'characters', id: fromCharId, data: fromPayload },
      { col: 'characters', id: targetId, data: { inventaire: toInv, ...toHistoryPatch } },
    ]);
  } catch (e) {
    // Le lot est atomique : l'inventaire local reste intact si Firestore refuse.
    console.error('[inventory] item transfer failed', e);
    return;
  }
  fromChar.inventaire = fromInv;
  if (equipSync.changed) {
    fromChar.equipement = equipSync.equipement;
    fromChar.statsBonus = equipSync.statsBonus;
  }
  toChar.inventaire   = toInv;
  _patchInventoryHistoryLocal(fromChar, fromHistoryPatch.inventoryHistory);
  _patchInventoryHistoryLocal(toChar, toHistoryPatch.inventoryHistory);

  closeModal();
  const sendMsg = equipSync.removedSlots.length
    ? ` ${equipSync.removedSlots.length > 1 ? 'Objets déséquipés automatiquement.' : 'Objet déséquipé automatiquement.'}`
    : '';
  showNotif(`📤 ×${qty} "${firstItem.nom||'objet'}" envoyé${qty>1?'s':''} à ${toChar.nom||'?'} !${sendMsg}`, 'success');
  _renderInventoryChar(fromChar, charSession.getCurrentCharTab() || 'inventaire');
}

// ══════════════════════════════════════════════
// ENVOI D'OR
// ══════════════════════════════════════════════

export async function openSendGoldModal(charId) {
  const fromChar = getCharacterById(charId);
  if (!fromChar) return;

  const orDispo = calcOr(fromChar);
  const targets = await _loadTransferTargets(charId);

  if (!targets.length) {
    showNotif('Aucun autre personnage disponible.', 'info');
    return;
  }

  const targetCards = targets.map(t => {
    const initiale  = (t.nom || '?')[0].toUpperCase();
    const couleur   = '#e8b84b';
    return `<label data-search="${_esc(_norm((t.nom||'')+' '+(t.ownerPseudo||'')))}" style="display:flex;align-items:center;gap:.7rem;padding:.55rem .7rem;
      border-radius:8px;cursor:pointer;border:2px solid var(--border);background:var(--bg-elevated);
      transition:border-color .15s" data-hov-border="var(--gold)">
      <input type="radio" name="gold-target" value="${t.id}" style="accent-color:var(--gold)">
      ${characterAvatarHtml(t, {
        size: 30,
        border: `2px solid ${couleur}`,
        background: `${couleur}22`,
        color: couleur,
        fallbackStyle: `font-size:.9rem;font-weight:700;color:${couleur}`,
      })}
      <div style="flex:1;min-width:0">
        <div style="font-size:.84rem;font-weight:600;color:var(--text)">${t.nom}</div>
        ${t.ownerPseudo ? `<div style="font-size:.68rem;color:var(--text-dim)">${t.ownerPseudo}</div>` : ''}
      </div>
    </label>`;
  }).join('');

  openModal('💰 Envoyer de l\'or', `
    <div style="display:flex;align-items:center;gap:.5rem;margin-bottom:.85rem;
      padding:.5rem .75rem;background:color-mix(in srgb,var(--gold) 10%,transparent);
      border:1px solid color-mix(in srgb,var(--gold) 25%,transparent);border-radius:8px">
      <span style="font-size:1.1rem">💰</span>
      <span style="font-size:.84rem;color:var(--text)">Ton solde : <strong style="color:var(--gold)">${orDispo} or</strong></span>
    </div>
    ${modalSection('👤 Destinataire', `
      ${targets.length > 4 ? `<input type="text" class="input-field" data-input="_sendTargetFilter" placeholder="🔍 Filtrer un personnage…" autocomplete="off" style="width:100%;margin-bottom:.45rem">` : ''}
      <div id="send-target-list" style="display:flex;flex-direction:column;gap:.35rem;max-height:220px;overflow-y:auto">
        ${targetCards}
        <div id="send-target-empty" style="display:none;padding:.5rem;text-align:center;color:var(--text-dim);font-size:.76rem">Aucun personnage trouvé</div>
      </div>`)}
    ${modalSection(`💰 Montant <span style="color:var(--text-dim);font-weight:400;font-size:.72rem">(max ${orDispo} or)</span>`, `
      <input type="number" class="input-field" id="gold-amount" min="1" max="${orDispo}" value="1"
        placeholder="Montant en or" style="max-width:140px">`)}
    <div style="display:flex;gap:.5rem">
      <button class="btn btn-gold" style="flex:1" data-action="sendGold" data-id="${charId}">💰 Envoyer</button>
      <button class="btn btn-outline btn-sm" data-action="close-modal">Annuler</button>
    </div>
  `, { subtitle: 'Transférer de l\'or à un autre personnage', accent: '#f4c430' });
}

export async function sendGold(fromCharId) {
  const fromChar = STATE.characters?.find(x => x.id === fromCharId) || STATE.activeChar;
  if (!fromChar) return;

  const targetId = document.querySelector('input[name="gold-target"]:checked')?.value;
  if (!targetId) { showNotif('Sélectionne un destinataire.', 'error'); return; }

  const toChar = STATE.characters?.find(x => x.id === targetId)
    || (_modalCharTargets || []).find(x => x.id === targetId);
  if (!toChar) { showNotif('Personnage introuvable.', 'error'); return; }

  const montant = parseInt(document.getElementById('gold-amount')?.value) || 0;
  if (montant < 1) { showNotif('Montant invalide.', 'error'); return; }

  // Débit puis crédit SÉQUENTIELS avec rollback, via la couche économie (écriture
  // immuable + vérification de solde). L'ancien Promise.all écrivait les deux
  // comptes EN PARALLÈLE sans compensation : si une seule écriture échouait, de
  // l'or était créé ou détruit. `charObj` permet de créditer une cible hors
  // STATE.characters (autre session).
  const debit = await useGold(fromCharId, -montant, `Or envoyé à ${toChar.nom || 'joueur'}`, { charObj: fromChar, refreshUI: false });
  if (!debit.ok) { showNotif(debit.error || 'Transfert impossible.', 'error'); return; }
  const credit = await useGold(targetId, +montant, `Or reçu de ${fromChar.nom || 'joueur'}`, { charObj: toChar, refreshUI: false });
  if (!credit.ok) {
    await useGold(fromCharId, +montant, '↻ Rollback transfert échoué', { charObj: fromChar, refreshUI: false });
    showNotif(credit.error || 'Transfert échoué — débit annulé.', 'error');
    return;
  }

  closeModal();
  showNotif(`💰 ${montant} or envoyé à ${toChar.nom || 'joueur'} !`, 'success');
  _renderInventoryChar(fromChar, charSession.getCurrentCharTab() || 'inventaire');
}

// ══════════════════════════════════════════════
// BUTIN — Picker
// ══════════════════════════════════════════════
export async function addInvItem() {
  const c = STATE.activeChar; if (!c) return;

  const { loadCollection: _lc } = await import('../../data/firestore.js');
  let shopItems = _shopItemsCache;
  let shopCats  = _shopCatsCache;
  try {
    const toLoad = [];
    if (!shopItems) toLoad.push(_lc('shop').then(r => { shopItems = r; _shopItemsCache = r; }));
    if (!shopCats)  toLoad.push(_lc('shopCategories').then(r => { shopCats = r; _shopCatsCache = r; }));
    if (toLoad.length) await Promise.all(toLoad);
  } catch(e) { /* silent */ }
  shopItems = (shopItems || []).filter(i => i.nom);
  shopCats  = [...(shopCats || [])].sort((a,b) => (a.ordre||0)-(b.ordre||0));

  _lootItems  = shopItems;
  _lootSelId  = null;
  _lootCurCat = null;

  const RC = ['','#9ca3af','#4f8cff','#b47fff','#e8b84b'];

  const getRecents = () => lsJson.get('jdr_loot_recent', []);
  _lootSaveRecent = (id) => {
    const r = getRecents().filter(x => x !== id);
    r.unshift(id);
    lsJson.set('jdr_loot_recent', r.slice(0, 8));
  };

  const renderItems = (catId, search) => {
    const q = _norm(search || '');   // minuscules + sans accents
    let items;
    if (q) {
      items = shopItems.filter(i =>
        _norm(i.nom || '').includes(q) ||
        _norm(i.description || i.effet || '').includes(q)
      );
    } else if (catId === '__recent__') {
      items = getRecents().map(id => shopItems.find(i => i.id === id)).filter(Boolean);
    } else if (catId) {
      items = shopItems.filter(i => i.categorieId === catId);
    } else {
      const recentItems = getRecents().map(id => shopItems.find(i => i.id === id)).filter(Boolean);
      if (recentItems.length) return _lootRenderSection('⏱️ Récents', recentItems, RC);
      return `<div style="text-align:center;padding:2rem;color:var(--text-dim);font-style:italic;font-size:.82rem">
        Sélectionne une catégorie ou tape un nom pour rechercher
      </div>`;
    }
    if (!items.length) return `<div style="text-align:center;padding:1.5rem;color:var(--text-dim);font-style:italic">Aucun résultat.</div>`;
    return items.map(item => _lootItemCard(item, RC, q ? shopCats.find(cat => cat.id === item.categorieId)?.nom : null)).join('');
  };

  const _lootItemCard = (item, rc_arr, catLabel) => {
    const r  = parseInt(item.rarete) || 0;
    const rc = rc_arr[r] || 'var(--border)';
    const sel = _lootSelId === item.id;
    const desc = item.description || item.effet || '';
    return `<button data-action="_lootSelect" data-id="${item.id}" id="loot-card-${item.id}"
      style="display:flex;flex-direction:column;gap:2px;text-align:left;padding:.5rem .65rem;
        border-radius:8px;border:1px solid ${sel ? rc : 'var(--border)'};
        background:${sel ? `${rc}20` : 'var(--bg-elevated)'};cursor:pointer;transition:all .12s;width:100%">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:.4rem">
        <span style="font-size:.82rem;font-weight:600;color:var(--text);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${_esc(item.nom)}</span>
        <div style="display:flex;align-items:center;gap:.3rem;flex-shrink:0">
          ${catLabel ? `<span style="font-size:.62rem;color:var(--text-dim);background:var(--bg-card);border:1px solid var(--border);border-radius:4px;padding:1px 5px;white-space:nowrap">${_esc(catLabel)}</span>` : ''}
          ${r ? `<span style="color:${rc};font-size:.7rem">${'★'.repeat(r)}</span>` : ''}
        </div>
      </div>
      ${desc ? `<span style="font-size:.68rem;color:var(--text-dim);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%">${desc.slice(0,70)}${desc.length>70?'…':''}</span>` : ''}
    </button>`;
  };

  const _lootRenderSection = (title, items, rc_arr) =>
    `<div style="font-size:.68rem;font-weight:700;color:var(--text-dim);text-transform:uppercase;letter-spacing:.6px;padding:.2rem .1rem .35rem">${title}</div>` +
    items.map(item => _lootItemCard(item, rc_arr, null)).join('');

  _lootRenderGrid = (catId, search) => {
    const grid = document.getElementById('loot-grid');
    if (grid) grid.innerHTML = renderItems(catId, search || '');
  };

  const hasRecents = getRecents().some(id => shopItems.find(i => i.id === id));
  const pillStyle = (active) =>
    `font-size:.72rem;padding:3px 11px;border-radius:999px;cursor:pointer;white-space:nowrap;flex-shrink:0;transition:all .12s;
     border:1px solid ${active ? 'var(--gold)' : 'var(--border)'};
     background:${active ? 'rgba(232,184,75,.14)' : 'var(--bg-elevated)'};
     color:${active ? 'var(--gold)' : 'var(--text-muted)'}`;

  const recentPill = hasRecents
    ? `<button id="loot-pill-__recent__" data-action="_lootSetCat" data-cat="__recent__" style="${pillStyle(false)}">⏱️ Récents</button>`
    : '';
  const catPills = shopCats
    .filter(cat => shopItems.some(i => i.categorieId === cat.id))
    .map(cat => `<button id="loot-pill-${cat.id}" data-action="_lootSetCat" data-cat="${cat.id}" style="${pillStyle(false)}">${_esc(cat.nom)}</button>`)
    .join('');

  openModal('🎁 Butin — Ajouter un objet', `
    <input class="input-field" id="loot-search" placeholder="🔍 Rechercher dans tous les objets…"
      data-input="_lootFilter" style="margin-bottom:.45rem">
    <div style="display:flex;gap:.3rem;flex-wrap:wrap;margin-bottom:.45rem">
      ${recentPill}${catPills}
    </div>
    <div id="loot-grid" style="display:flex;flex-direction:column;gap:.28rem;
      max-height:38vh;overflow-y:auto;padding-right:2px;margin-bottom:.5rem">
      ${renderItems(null, '')}
    </div>
    <div id="loot-qty-panel" style="display:none;background:var(--bg-elevated);
      border:1px solid var(--gold);border-radius:10px;padding:.55rem .85rem;margin-bottom:.5rem">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:.75rem">
        <div id="loot-sel-nom" style="font-weight:700;font-size:.86rem;color:var(--text);
          min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"></div>
        <div style="display:flex;align-items:center;gap:.3rem;flex-shrink:0">
          <button data-action="_lootQte" data-delta="-1"
            style="width:28px;height:28px;border-radius:6px;border:1px solid var(--border);background:var(--bg-card);cursor:pointer;font-size:1.1rem;color:var(--text);line-height:1">−</button>
          <input type="number" id="loot-qte" value="1" min="1"
            style="width:48px;text-align:center;font-size:.9rem;font-weight:700;background:var(--bg-card);border:1px solid var(--border);border-radius:6px;color:var(--text);padding:4px 0">
          <button data-action="_lootQte" data-delta="1"
            style="width:28px;height:28px;border-radius:6px;border:1px solid var(--border);background:var(--bg-card);cursor:pointer;font-size:1.1rem;color:var(--text);line-height:1">+</button>
        </div>
      </div>
    </div>
    <div style="display:flex;gap:.4rem">
      <button class="btn btn-gold" style="flex:1" data-action="saveInvItemFromShop">✓ Ajouter</button>
      <button class="btn btn-outline btn-sm" data-action="close-modal">Fermer</button>
    </div>
  `, { subtitle: 'Choisis un objet de la boutique à ajouter', accent: '#f4c430' });
  setTimeout(() => document.getElementById('loot-search')?.focus(), 60);

  _lootSetCat = function(catId) {
    const next = _lootCurCat === catId ? null : catId;
    _lootCurCat = next;
    _lootSelId  = null;
    if (hasRecents) _lootPillStyle('__recent__', next === '__recent__');
    shopCats.forEach(cat => _lootPillStyle(cat.id, next === cat.id));
    const searchEl = document.getElementById('loot-search');
    if (searchEl) searchEl.value = '';
    const panel = document.getElementById('loot-qty-panel');
    if (panel) panel.style.display = 'none';
    _lootRenderGrid(next, '');
  }

  _lootFilter = function() {
    const q = document.getElementById('loot-search')?.value || '';
    if (q) {
      if (hasRecents) _lootPillStyle('__recent__', false);
      shopCats.forEach(cat => _lootPillStyle(cat.id, false));
    } else {
      if (hasRecents) _lootPillStyle('__recent__', _lootCurCat === '__recent__');
      shopCats.forEach(cat => _lootPillStyle(cat.id, _lootCurCat === cat.id));
    }
    _lootRenderGrid(q ? null : _lootCurCat, q);
  }

  _lootSelect = function(id) {
    if (_lootSelId && _lootSelId !== id) {
      const old = document.getElementById(`loot-card-${_lootSelId}`);
      if (old) { old.style.background = 'var(--bg-elevated)'; old.style.borderColor = 'var(--border)'; }
    }
    _lootSelId = id;
    const item = shopItems.find(i => i.id === id);
    if (!item) return;
    const r  = parseInt(item.rarete) || 0;
    const rc = RC[r] || 'var(--gold)';
    const card = document.getElementById(`loot-card-${id}`);
    if (card) { card.style.background = `${rc}20`; card.style.borderColor = rc; }
    const panel = document.getElementById('loot-qty-panel');
    if (panel) panel.style.display = 'block';
    const nomEl = document.getElementById('loot-sel-nom');
    if (nomEl) nomEl.textContent = item.nom;
    const qteEl = document.getElementById('loot-qte');
    if (qteEl) { qteEl.value = '1'; qteEl.focus(); }
  }
}

export function _lootPillStyle(id, active) {
  const el = document.getElementById(`loot-pill-${id}`);
  if (!el) return;
  el.style.borderColor = active ? 'var(--gold)' : 'var(--border)';
  el.style.background  = active ? 'rgba(232,184,75,.14)' : 'var(--bg-elevated)';
  el.style.color       = active ? 'var(--gold)' : 'var(--text-muted)';
}

export async function saveInvItemFromShop() {
  const c = STATE.activeChar; if (!c) return;
  const selId = _lootSelId;
  if (!selId) { showNotif('Sélectionne un objet.', 'error'); return; }
  const item = (_lootItems || []).find(i => i.id === selId);
  if (!item) { showNotif('Objet introuvable.', 'error'); return; }
  const qte = Math.max(1, parseInt(document.getElementById('loot-qte')?.value) || 1);
  const inv = Array.isArray(c.inventaire) ? [...c.inventaire] : [];
  // Utilise le helper canonique : strip image base64, dispo, recipeMeta, etc.
  // → évite de dépasser la limite Firestore de 1 MiB par doc personnage.
  const baseEntry = shopItemToInvEntry(item, { source: 'boutique' });
  if (!baseEntry) { showNotif('Objet invalide.', 'error'); return; }
  for (let i = 0; i < qte; i++) {
    inv.push({ ...baseEntry, quantite: 1 });
  }
  const historyPatch = inventoryHistoryPayload(c, makeInventoryHistoryEntry('add', baseEntry, qte, {
    ..._inventoryHistoryActor(),
    source: 'Butin',
  }));
  c.inventaire = inv;
  _patchInventoryHistoryLocal(c, historyPatch.inventoryHistory);
  if (STATE.activeChar?.id === c.id) STATE.activeChar.inventaire = inv;
  const stChar = (STATE.characters || []).find(x => x.id === c.id);
  if (stChar) stChar.inventaire = inv;
  if (await trySave('characters', c.id, { inventaire: inv, ...historyPatch })) {
    if (_lootSaveRecent) _lootSaveRecent(item.id);
    _lootSelId = null;
    showNotif(`${item.nom} ×${qte} ajouté !`, 'success');
  }
  _renderInventoryChar(c, 'inventaire');
  const panel = document.getElementById('loot-qty-panel');
  if (panel) panel.style.display = 'none';
  _lootRenderGrid?.(_lootCurCat, document.getElementById('loot-search')?.value || '');
}

export function editInvItem(idx) {
  const c = STATE.activeChar; if(!c) return;
  const item = (c.inventaire||[])[idx];
  openModal('✏️ Modifier', `
    <div class="form-group"><label>Nom</label><input class="input-field" id="inv-nom" value="${item.nom||''}"></div>
    <div class="grid-2" style="gap:0.8rem">
      <div class="form-group"><label>Type</label><input class="input-field" id="inv-type" value="${item.type||''}"></div>
      <div class="form-group"><label>Quantité</label><input class="input-field" id="inv-qte" value="${item.qte||1}"></div>
    </div>
    <div class="form-group"><label>Description</label><textarea class="input-field" id="inv-desc" rows="3">${item.description||''}</textarea></div>
    <button class="btn btn-gold" style="width:100%;margin-top:1rem" data-action="saveInvItem" data-idx="${idx}">Enregistrer</button>
  `);
}

export async function saveInvItem(idx) {
  const c = STATE.activeChar; if(!c) return;
  const inv = [...(c.inventaire || [])];
  // Convention "1 entrée = 1 unité" : on respecte la qté saisie en N entrées
  const qte = Math.max(1, parseInt(document.getElementById('inv-qte')?.value) || 1);
  const baseItem = {
    nom: document.getElementById('inv-nom')?.value||'?',
    type: document.getElementById('inv-type')?.value||'',
    qte: '1',
    description: document.getElementById('inv-desc')?.value||'',
  };
  if (idx >= 0) {
    // Édition : remplace l'entrée idx, puis push qte-1 copies supplémentaires
    inv[idx] = { ...baseItem };
    for (let i = 1; i < qte; i++) inv.push({ ...baseItem });
  } else {
    for (let i = 0; i < qte; i++) inv.push({ ...baseItem });
  }
  const historyPatch = idx < 0
    ? inventoryHistoryPayload(c, makeInventoryHistoryEntry('add', baseItem, qte, {
      ..._inventoryHistoryActor(),
      source: 'Creation manuelle',
    }))
    : {};
  c.inventaire = inv;
  if (historyPatch.inventoryHistory) _patchInventoryHistoryLocal(c, historyPatch.inventoryHistory);
  if (await trySave('characters',c.id,{inventaire:inv, ...historyPatch})) {
    closeModal();
    showNotif('Inventaire mis à jour !','success');
  }
  _renderInventoryChar(c, 'inventaire');
}

// Mise à jour CIBLÉE de la liste : ne reconstruit que .iv-list, laisse la barre
// de recherche (et son input focalisé) et la fiche intactes. Utilisée à la frappe.
function _ivUpdateList() {
  const c = charSession.getCurrentChar?.() || STATE.activeChar;
  const list = document.querySelector('.iv .iv-list');
  if (!c || !list) return;
  list.innerHTML = _ivListHtml(c, _ivModel(c), _invLastCanEdit);
}
// Débounce : coalesce les reconstructions pendant une frappe rapide. L'input
// reste vivant et réactif ; seule la liste filtrée se met à jour après la pause.
let _ivSearchTimer = null;
function _ivDebouncedListUpdate() {
  clearTimeout(_ivSearchTimer);
  _ivSearchTimer = setTimeout(() => { _ivSearchTimer = null; _ivUpdateList(); }, 120);
}

function _rerenderInventoryView({ focusSearch = false } = {}) {
  const c = charSession.getCurrentChar?.() || STATE.activeChar;
  if (!c) return;
  const scrollTop = document.scrollingElement?.scrollTop || window.scrollY || 0;
  const search = document.querySelector('.iv-search input[type="search"]');
  const caret = search?.selectionStart ?? String(_charInvSearch || '').length;
  _renderInventoryChar(c, charSession.getCurrentCharTab() || 'inventaire');
  requestAnimationFrame(() => {
    window.scrollTo(0, scrollTop);
    if (!focusSearch) return;
    const input = document.querySelector('.iv-search input[type="search"]');
    if (!input) return;
    input.focus({ preventScroll: true });
    try { input.setSelectionRange(caret, caret); } catch {}
  });
}


async function _invToggleBelt(charId, indicesB64, belt) {
  const c = getCharacterById(charId);
  const indices = _decodeIndices(indicesB64);
  if (!c || !indices.length || !canControlCharacter(c)) return;
  const inv = (c.inventaire || []).map((item, index) => indices.includes(index) ? { ...item, belt } : item);
  if (!await trySave('characters', c.id, { inventaire: inv })) return;
  c.inventaire = inv;
  if (STATE.activeChar?.id === c.id) STATE.activeChar.inventaire = inv;
  showNotif(belt ? 'Objet placé dans la ceinture.' : 'Objet rangé dans le sac.', 'success');
  _rerenderInventoryView();
}

async function _invConsumeOne(charId, indicesB64) {
  const c = getCharacterById(charId);
  const indices = _decodeIndices(indicesB64);
  if (!c || !indices.length || !canControlCharacter(c)) return;
  const index = indices.find(i => c.inventaire?.[i]);
  const item = c.inventaire?.[index];
  if (!item) return;
  const inv = [...c.inventaire];
  const storedQty = parseInt(item.quantite || item.qte || 1) || 1;
  let equipSync = { changed: false, removedSlots: [] };
  if (storedQty > 1) {
    const next = { ...item };
    if (Object.prototype.hasOwnProperty.call(next, 'quantite')) next.quantite = storedQty - 1;
    else next.qte = storedQty - 1;
    inv[index] = next;
  } else {
    inv.splice(index, 1);
    equipSync = syncEquipmentAfterInventoryMutation(c, [index]);
  }
  const historyPatch = inventoryHistoryPayload(c, makeInventoryHistoryEntry('consume', item, 1, {
    ..._inventoryHistoryActor(),
    source: 'Ceinture',
  }));
  const payload = { inventaire: inv, ...historyPatch };
  if (equipSync.changed) {
    payload.equipement = equipSync.equipement;
    payload.statsBonus = equipSync.statsBonus;
    patchBuildLocally(c, { equipement: equipSync.equipement, statsBonus: equipSync.statsBonus });
    payload.builds = characterBuildsForStorage(c);
    payload.activeBuildId = c.activeBuildId;
  }
  if (!await trySave('characters', c.id, payload)) return;
  c.inventaire = inv;
  if (equipSync.changed) {
    c.equipement = equipSync.equipement;
    c.statsBonus = equipSync.statsBonus;
  }
  if (STATE.activeChar?.id === c.id) STATE.activeChar.inventaire = inv;
  _patchInventoryHistoryLocal(c, historyPatch.inventoryHistory);
  showNotif(`${item.nom || 'Objet'} utilisé.`, 'success');
  _rerenderInventoryView();
}

registerActions({
  _charInvSearch:      (el)  => { _charInvSearch = el.value; _ivDebouncedListUpdate(); },
  _invSelect:          (btn) => _invSelect(btn.dataset.key || ''),
  _invCloseSheet:      ()    => _invCloseSheet(),
  _sendTargetFilter:   (el)  => _sendTargetFilter(el),
  _sellRefreshTotal:   (el)  => _sellRefreshTotal(el, Number(el.dataset.prix), Number(el.dataset.max)),
  _invmStep:          (btn) => _invmStep(btn.dataset.input, Number(btn.dataset.delta), Number(btn.dataset.max), btn.dataset.context),
  _lootFilter:         ()    => _lootFilter(),
  sendGold:            (btn) => sendGold(btn.dataset.id),
  saveInvItemFromShop: ()    => saveInvItemFromShop(),
  saveInvPersonalLine: (el) => saveInvPersonalLine(el.dataset.id, el.dataset.indices, el),
  openInventoryReadableContent: (el) => openInventoryReadableContent(el.dataset.id, el.dataset.indices),
  closeInventoryReader: () => closeModal(),
  saveInvItem:         (btn) => saveInvItem(Number(btn.dataset.idx)),
  _lootSelect:         (btn) => _lootSelect(btn.dataset.id),
  _lootSetCat:         (btn) => _lootSetCat(btn.dataset.cat),
  _lootQte:            (btn) => { const i = document.getElementById('loot-qte'); if (i) i.value = Math.max(1, parseInt(i.value || 1) + Number(btn.dataset.delta)); },
  _invToggleBelt:      (btn) => _invToggleBelt(btn.dataset.id, btn.dataset.indices, btn.dataset.belt === 'true'),
  _invConsumeOne:      (btn) => _invConsumeOne(btn.dataset.id, btn.dataset.indices),
});
