import { STATE } from '../../core/state.js';
import { charSession } from '../../shared/char-session.js';
import { registerActions } from '../../core/actions.js';
import { batchUpdateInCol, updateInCol, loadCollection, getCachedCollection, getDocDataSilent } from '../../data/firestore.js';
import { trySave } from '../../shared/crud.js';
import { openModal, pushModal, closeModal, modalSection } from '../../shared/modal.js';
import { showNotif, notifySaveError } from '../../shared/notifications.js';
import { _esc, _norm } from '../../shared/html.js';
import { lsJson } from '../../shared/local-storage.js';
import { RARETE_NAMES, _rareteColor, _rareteLabel } from '../../shared/rarity.js';
import { ITEM_STAT_META, statShort, getItemStatBonus, calcOr, getItemEffectText } from '../../shared/char-stats.js';
import { useGoldMulti } from '../../shared/economy.js';
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
import { characterAvatarHtml, characterPortraitContent } from '../../shared/portraits.js';
import { calcUpgradeRefund, getUpgradeTotalCost, hasUpgrades, getUpgradeSettings } from '../../shared/upgrade-settings.js';
import { characterBuildsForStorage, patchBuildLocally } from '../../shared/character-builds.js';
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
  resolveEquipmentSlotForItem,
} from '../../shared/equipment-slots.js';

import { canControlCharacter, getCharacterById } from '../../shared/character-state.js';
let _charInvSearch = '';
let _invCatOpen = {};
let _invCategoryFilter = 'all';
let _invSort = 'category';
let _invOnlyNew = false;
let _invSelected = '';
let _invZoneOpen = { worn: true, belt: true, bag: true };
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

const _inventoryStatChips = item => ITEM_STAT_META.flatMap(stat => {
  const value = getItemStatBonus(item, stat.full);
  return value ? [{ ...stat, value, cls: `stat-tone stat-${stat.full}` }] : [];
});

const _inventoryStatBadgesHtml = item => _inventoryStatChips(item)
  .map(stat => `<span class="badge-chip ${stat.cls}">${stat.short.toUpperCase()} ${stat.value > 0 ? '+' : ''}${stat.value}</span>`)
  .join('');

function _invLooksMechanicalEffect(text = '') {
  const raw = String(text || '').trim();
  if (!raw || raw.length > 90) return false;
  const n = _norm(raw);
  if (/[+\-]?\d/.test(raw)) return true;
  return /\b(pv|pm|ca|degat|degats|soin|vitesse|portee|toucher|critique|avantage|desavantage|relance|dd|etat|reaction|action bonus|resistance|immunite|mana)\b/.test(n);
}

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

export function getInventoryCatalogItem(itemId) {
  if (!itemId || !isInventoryCatalogReady()) return null;
  return _inventoryCatalogSnapshot().find(item => item.id === itemId) || null;
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
// INVENTAIRE BOUTIQUE (section dans renderCharSheet)
// ══════════════════════════════════════════════
export function _renderInventaireBoutique(char) {
  const invRaw = (char.inventaire || []).map((item, i) => ({ item, i })).filter(({ item }) => item.source === 'boutique');
  if (!invRaw.length) return '';

  const canEdit = charSession.getCanEditChar() ?? STATE.isAdmin;

  // ── Regrouper par itemId + nom ──────────────────────────────────────────
  const grouped = [];
  invRaw.forEach(({ item, i }) => {
    const key = (item.itemId||'') + '||' + (item.nom||'');
    const existing = grouped.find(g => g.key === key);
    if (existing) {
      existing.qte += parseInt(item.qte)||1;
      existing.indices.push(i);
    } else {
      grouped.push({ key, item: {...item}, qte: parseInt(item.qte)||1, indices: [i] });
    }
  });

  const cards = grouped.map(g => {
    const item = g.item;
    const indicesB64 = btoa(JSON.stringify(g.indices));
    const rareteN  = parseInt(item.rarete) || 0;
    const rareteL  = RARETE_NAMES[rareteN] || '';
    const rareteC  = _rareteColor(rareteL) || '#555';
    const prixAchat = parseFloat(item.prixAchat) || 0;
    const prixVente = parseFloat(item.prixVente) || Math.round(prixAchat * 0.6);

    const infos = [];
    const statBonuses = _inventoryStatChips(item);
    if (item.format)      infos.push({ label: 'Type d’arme', val: item.format });
    if (item.mains)       infos.push({ label: 'Maniement', val: item.mains });
    if (item.slotArmure)  infos.push({ label: 'Slot',      val: item.slotArmure });
    if (item.slotBijou)   infos.push({ label: 'Slot',      val: item.slotBijou });
    if (item.typeArmure)  infos.push({ label: 'Type',      val: item.typeArmure });
    if (item.degats) {
      const shs = _itemDegatsStatsShorts(item);
      infos.push({ label: '⚔️ Dégâts', val: `${item.degats}${shs.length ? ` + ${shs.join(' + ')}` : ''}`, color: '#ff6b6b' });
    }
    if (item.toucherStat) infos.push({ label: 'Toucher',    val: statShort(item.toucherStat), color: '#e8b84b' });
    else if (item.toucher) infos.push({ label: 'Toucher',   val: item.toucher, color: '#e8b84b' });
    {
      const caTot = (parseInt(item.ca)||0) + (parseInt(item.caBonus)||0);
      if (caTot || item.ca === 0 || item.caBonus === 0) infos.push({ label: '🛡️ CA', val: caTot });
    }
    _getTraits(item).forEach(t => infos.push({ label: 'Trait', val: t, color: '#b47fff', italic: true }));
    if (item.type)        infos.push({ label: 'Type',       val: item.type });
    { const eff = getItemEffectText(item); if (eff) infos.push({ label: 'Effet', val: eff }); }
    if (item.description) infos.push({ label: 'Desc.',      val: item.description, muted: true });
    statBonuses.forEach(stat => infos.push({
      label: 'Stat',
      val: `${stat.short.toUpperCase()} ${stat.value > 0 ? '+' : ''}${stat.value}`,
      cls: stat.cls,
    }));

    return `
    <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:12px;
      padding:.85rem 1rem;display:flex;flex-direction:column;gap:.5rem;border-left:3px solid ${rareteC}">

      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:.5rem">
        <div>
          <div style="font-family:'Cinzel',serif;font-size:.88rem;color:var(--text);font-weight:600;line-height:1.2">
            ${item.nom || '?'}
          </div>
          ${rareteL ? `<div style="font-size:.68rem;color:${rareteC};margin-top:1px">${_rareteLabel(rareteN)}</div>` : ''}
        </div>
        <span style="font-size:.72rem;background:var(--bg-elevated);border:1px solid var(--border);
          border-radius:999px;padding:2px 8px;color:var(--text-muted);flex-shrink:0">×${g.qte}</span>
      </div>

      ${infos.length ? `
      <div style="display:flex;flex-wrap:wrap;gap:.3rem .75rem">
        ${infos.map(info => `
          <div style="display:flex;align-items:baseline;gap:.3rem;font-size:.78rem">
            <span style="color:var(--text-dim);font-size:.68rem;text-transform:uppercase;letter-spacing:.5px">${info.label}</span>
            <span class="${info.cls || ''}" style="${info.color ? `color:${info.color};` : ''}${info.italic?'font-style:italic;':''}font-weight:${info.color || info.cls ?'700':'400'}">${info.val}</span>
          </div>`).join('')}
      </div>` : ''}

      <div style="display:flex;align-items:center;justify-content:space-between;margin-top:.25rem;
        padding-top:.5rem;border-top:1px solid var(--border)">
        <div style="font-size:.72rem;color:var(--text-dim)">
          <span title="Prix d'achat">💰 ${prixAchat} or</span>
          <span style="margin:0 .3rem;opacity:.4">·</span>
          <span title="Prix de revente" style="color:var(--gold)">🔄 ${prixVente} or/u</span>
        </div>
        ${canEdit ? `
        <div style="display:flex;gap:.4rem;align-items:center">
          <button data-action="openSellInvModal" data-id="${char.id}" data-indices="${indicesB64}" data-prix="${prixVente}" data-name="${_esc(item.nom||'')}"
            style="background:rgba(232,184,75,.08);border:1px solid rgba(232,184,75,.3);
            border-radius:999px;padding:3px 10px;cursor:pointer;font-size:.72rem;
            color:var(--gold);transition:all .15s"
            data-hov-bg="rgba(232,184,75,.15)">
            🔄 Vendre
          </button>
          <button data-action="openSendInvModal" data-id="${char.id}" data-indices="${indicesB64}" data-name="${_esc(item.nom||'')}"
            style="background:rgba(79,140,255,.08);border:1px solid rgba(79,140,255,.3);
            border-radius:999px;padding:3px 10px;cursor:pointer;font-size:.72rem;
            color:#4f8cff;transition:all .15s"
            data-hov-bg="rgba(79,140,255,.15)"
            title="Envoyer">
            📤 Envoyer
          </button>
        </div>` : ''}
      </div>
    </div>`;
  }).join('');

  return `
  <div style="margin-bottom:1.5rem">
    <div style="font-size:.72rem;color:var(--text-dim);letter-spacing:2px;text-transform:uppercase;
      margin-bottom:.75rem;padding-bottom:.4rem;border-bottom:1px solid var(--border)">
      🛒 Inventaire Boutique
      <span style="font-size:.65rem;background:var(--bg-elevated);border:1px solid var(--border);
        border-radius:999px;padding:1px 7px;margin-left:.4rem;color:var(--text-dim)">${grouped.reduce((s,g)=>s+g.qte,0)}</span>
    </div>
    <div style="display:flex;flex-direction:column;gap:.6rem">${cards}</div>
  </div>`;
}

// ══════════════════════════════════════════════
// INVENTAIRE PRINCIPAL
// ══════════════════════════════════════════════

// ── Catégorisation ────────────────────────────
// Catégorie d'un objet pour le filtre d'inventaire.
// • L'ÉQUIPEMENT est regroupé en 3 rubriques fixes : toutes les armes → Armes,
//   toutes les armures → Armures, bagues/amulettes → Bijoux (quel que soit leur
//   sous-type).
// • TOUT LE RESTE forme une rubrique par `type` d'objet (champ libre : « Potion »,
//   « Parchemin », « Pierre précieuse »…) → les rubriques affichées dépendent des
//   objets réellement possédés, pas d'une liste figée.
function _invCategory(item) {
  const tpl = (item.template || '').toLowerCase();
  const hay = _norm([item.type, item.categorie, item.nom, item.sousType, item.sousCategorie].filter(Boolean).join(' '));
  const has = (...keys) => keys.some(k => hay.includes(k));
  if (tpl === 'arme'   || item.degats || item.toucherStat || item.toucher) return { id: 'armes',   label: 'Armes',                icon: '⚔️' };
  if (tpl === 'armure' || item.slotArmure || item.typeArmure || (item.ca != null && item.ca !== '')) return { id: 'armures', label: 'Armures', icon: '🛡️' };
  if (tpl === 'bijou'  || item.slotBijou || has('anneau','amulette','bijou','talisman','pendentif','bague'))
    return { id: 'bijoux', label: 'Bijoux & Accessoires', icon: '💍' };
  // Sinon : rubrique dynamique d'après le type de l'objet.
  const type = (item.type || '').trim();
  if (type) return { id: 'type:' + _norm(type), label: type, icon: _typeIcon(type) };
  return { id: 'divers', label: 'Divers', icon: '📦' };
}

// Icône d'agrément d'une rubrique de type (cosmétique ; le libellé reste le type réel).
function _typeIcon(type) {
  const t = _norm(type);
  if (/potion|consommable|elixir|antidote|nourriture|herbe|ingredient|ressource|materiau/.test(t)) return '🧪';
  if (/parchemin|grimoire|rouleau|scroll|livre/.test(t)) return '📜';
  if (/precieux|gemme|joyau|pierre|tresor|lingot|diamant|rubis|saphir|emeraude|perle|cristal|pepite|relique|valeur/.test(t)) return '💎';
  if (/cle|clef|outil|kit|piege/.test(t)) return '🔧';
  return '📦';
}

// ── Chips compactes pour une ligne (max 3) ────
function _invRowChips(item) {
  const chips = [];
  const statChips = _inventoryStatChips(item).map(stat => ({
    val: `${stat.short.toUpperCase()} ${stat.value > 0 ? '+' : ''}${stat.value}`,
    cls: stat.cls,
  }));
  if (item.degats) {
    const shs = _itemDegatsStatsShorts(item);
    chips.push({ val: shs.length ? `${item.degats}+${shs.join('+')}` : item.degats, color: '#ff6b6b' });
  }
  if (item.toucherStat || (item.toucher && !item.degats))
    chips.push({ val: item.toucherStat ? statShort(item.toucherStat) : item.toucher, color: '#e8b84b' });
  {
    const caTot = (parseInt(item.ca)||0) + (parseInt(item.caBonus)||0);
    if (caTot !== 0 || (item.ca != null && item.ca !== ''))
      chips.push({ val: `CA+${caTot}`, color: '#4f8cff' });
  }
  if (item.slotArmure)       chips.push({ val: item.slotArmure, color: '#4f8cff' });
  else if (item.slotBijou)   chips.push({ val: item.slotBijou,  color: '#c084fc' });
  if (item.typeArmure) {
    const armorMeta = getArmorTypeMeta(item.typeArmure);
    chips.push({ val: armorMeta?.label || item.typeArmure, color: armorMeta?.color || '#22c38e' });
  }
  if (chips.length < 2 && item.sousType) chips.push({ val: item.sousType, color: '#a0aec0' });
  if (chips.length < 2 && item.format)   chips.push({ val: item.format,   color: '#a0aec0' });
  if (chips.length === 0 && item.effet)
    chips.push({ val: item.effet.length > 42 ? item.effet.slice(0,42)+'…' : item.effet, color: 'var(--text-muted)' });
  if (chips.length === 0 && item.type)
    chips.push({ val: item.type, color: 'var(--text-dim)' });
  if (!statChips.length) return chips.slice(0, 3);
  return [...chips.slice(0, 2), ...statChips.slice(0, 3)];
}

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

function _invKeyInfo(item = {}) {
  const chips = _invRowChips(item);
  if (chips[0]?.val) return String(chips[0].val);
  const readable = getInventoryReadableDocument(item, getInventoryCatalogItem(item.itemId));
  if (readable) return 'Lisible';
  const effect = String(getItemEffectText(item) || '').trim();
  if (effect) return effect.length > 54 ? `${effect.slice(0, 51).trim()}…` : effect;
  return item.type || item.categorie || 'Objet';
}

function _invSearchValue(item = {}) {
  return _norm(`${item.nom || ''} ${item.notePerso || ''} ${_invKeyInfo(item)} ${item.type || ''} ${item.categorie || ''}`);
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

function _invCategoryGroups(groups) {
  const map = new Map();
  groups.forEach(group => {
    const cat = _invIsQuestItem(group.item)
      ? { id: 'quest', label: 'Objets de quête', icon: '✦' }
      : _invCategory(group.item);
    if (!map.has(cat.id)) map.set(cat.id, { ...cat, items: [] });
    map.get(cat.id).items.push(group);
  });
  const fixed = ['quest', 'armes', 'armures', 'bijoux'];
  return [
    ...fixed.map(id => map.get(id)).filter(Boolean),
    ...[...map.values()].filter(cat => !fixed.includes(cat.id) && cat.id !== 'divers')
      .sort((a, b) => a.label.localeCompare(b.label, 'fr', { sensitivity: 'base' })),
    ...(map.get('divers') ? [map.get('divers')] : []),
  ];
}

function _invSortGroups(groups, recentMap) {
  const sorted = [...groups];
  if (_invSort === 'value') return sorted.sort((a, b) => getInventoryItemValue(b.item, getInventoryCatalogItem(b.item.itemId)) - getInventoryItemValue(a.item, getInventoryCatalogItem(a.item.itemId)));
  if (_invSort === 'recent') return sorted.sort((a, b) => _invRecentAt(b, recentMap) - _invRecentAt(a, recentMap));
  if (_invSort === 'az') return sorted.sort((a, b) => String(a.item.nom || '').localeCompare(String(b.item.nom || ''), 'fr', { sensitivity: 'base' }));
  return sorted;
}

function _invDetailHtml(c, group, canEdit, zone, categories, recentMap) {
  if (!group) {
    const total = categories.reduce((sum, cat) => sum + cat.items.reduce((n, g) => n + g.qte, 0), 0);
    const distributionData = categories.map(cat => {
      const count = cat.items.reduce((sum, g) => sum + g.qte, 0);
      const value = cat.items.reduce((sum, g) => sum + getInventoryItemValue(g.item, getInventoryCatalogItem(g.item.itemId)) * g.qte, 0);
      return { ...cat, count, value };
    }).filter(cat => cat.value > 0).sort((a, b) => b.value - a.value);
    const maxValue = Math.max(1, ...distributionData.map(cat => cat.value));
    const distribution = distributionData.map(cat => `<button class="inv5-distribution-row" data-action="_invSetCategory" data-cat="${_esc(cat.id)}">
      <span class="inv5-distribution-label"><i>${cat.icon}</i>${_esc(cat.label)}</span>
      <span class="inv5-distribution-track"><i style="--inv5-share:${Math.max(1, cat.value / maxValue * 100).toFixed(2)}%"></i></span>
      <em>${Number(cat.value).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} or</em>
    </button>`).join('');
    return `<aside class="inv5-detail inv5-value-panel" aria-label="Répartition de la valeur">
      <h3>Répartition de la valeur</h3>
      <p>Sélectionnez un objet pour voir sa fiche complète et ses actions.</p>
      <div class="inv5-distribution" aria-label="Valeur de ${total} objets par catégorie">${distribution || '<span class="inv5-muted">Aucun objet de valeur.</span>'}</div>
    </aside>`;
  }

  const item = group.item;
  const indicesB64 = btoa(JSON.stringify(group.indices));
  const catalogItem = getInventoryCatalogItem(item.itemId);
  const price = getInventoryItemValue(item, catalogItem);
  const resale = getInventoryItemResaleValue(item, catalogItem);
  const rarityIndex = Math.max(0, parseInt(item.rarete || item.rare || 0) || 0);
  const rarityName = RARETE_NAMES[rarityIndex] || 'Commun';
  const rarityColor = _rareteColor(rarityName) || '#7a8fa8';
  const imageUrl = getInventoryItemImage(item, catalogItem);
  const traits = _getTraits(item);
  const effect = String(getItemEffectText(item) || '').trim();
  const description = String(item.description || '').trim();
  const equippedSlots = [...new Set(group.indices.flatMap(index => getEquippedInventoryIndexMap(c).get(index) || []))];
  const compatibleSlots = getEquipmentSlots().filter(slot => equipmentSlotAcceptsItem(slot, item));
  const preferredSlotId = resolveEquipmentSlotForItem(item);
  const targetSlot = compatibleSlots.find(slot => !c.equipement?.[slot.id])
    || compatibleSlots.find(slot => slot.id === preferredSlotId)
    || null;
  const equipIndex = group.indices.find(index => !(getEquippedInventoryIndexMap(c).get(index) || []).length) ?? group.indices[0];
  const readable = getInventoryReadableDocument(item, catalogItem);
  const isQuest = _invIsQuestItem(item);
  const facts = [
    ['Catégorie', _invCategory(item).label],
    ['Maniement', item.mains],
    ['Toucher', item.toucher || (item.toucherStat ? statShort(item.toucherStat) : '')],
    ['Portée', item.portee],
    ['Quantité', `×${group.qte}`],
    ['Valeur', price ? `${price} or` : '—'],
    ['Revente', resale ? `${resale} or` : '—'],
  ].filter(([, value]) => value);

  const statusLabel = equippedSlots.length
    ? `Équipé · ${getEquipmentSlot(equippedSlots[0])?.label || equippedSlots[0]}`
    : zone === 'belt' ? 'Dans la ceinture' : 'Dans le sac';

  return `<aside class="inv5-detail is-selected" style="--inv5-accent:${rarityColor}" aria-label="Détail de ${_esc(item.nom || 'l’objet')}">
    <button class="inv5-detail-close" data-action="_invCloseDetail" aria-label="Fermer le détail">×</button>
    <header class="inv5-detail-hero${imageUrl ? ' has-image' : ''}">
      ${imageUrl ? `<div class="inv5-detail-image" aria-hidden="true"><img src="${_esc(imageUrl)}" alt="" loading="lazy"></div>` : ''}
      <div class="inv5-detail-hero-content">
        <div class="inv5-detail-rarity">${_rareteLabel(rarityIndex) || _esc(rarityName)}</div>
        <h3>${_esc(item.nom || 'Sans nom')}</h3>
        <div class="inv5-detail-status"><span class="${equippedSlots.length ? 'is-equipped' : ''}">${_esc(statusLabel)}</span>${_invRecentAt(group, recentMap) ? '<span class="is-new">Nouveau</span>' : ''}</div>
      </div>
    </header>
    <div class="inv5-detail-body">
      <section><h4>En bref</h4><strong class="inv5-detail-key">${_esc(_invKeyInfo(item))}</strong></section>
      <dl class="inv5-detail-facts">${facts.map(([label, value]) => `<div><dt>${_esc(label)}</dt><dd>${_esc(value)}</dd></div>`).join('')}</dl>
      ${_inventoryStatBadgesHtml(item) ? `<section><h4>Bonus</h4><div class="inv-detail-stat-badges">${_inventoryStatBadgesHtml(item)}</div></section>` : ''}
      ${effect && _norm(effect) !== _norm(description) ? `<section><h4>Effet</h4><p>${_esc(effect)}</p></section>` : ''}
      ${traits.length ? `<section><h4>Traits</h4><div class="inv5-traits">${traits.map(trait => `<span>${_esc(trait)}</span>`).join('')}</div></section>` : ''}
      ${description ? `<section class="inv5-detail-description"><h4>Description</h4><p>${_esc(description)}</p></section>` : ''}
      <section><h4>Note personnelle</h4>${renderInvPersonalLine(c, group.indices, indicesB64, 'row', canEdit)}</section>
    </div>
    <footer class="inv5-detail-actions">
      ${readable && canEdit ? `<button data-action="openInventoryReadableContent" data-id="${_esc(c.id)}" data-indices="${indicesB64}">📖 Lire</button>` : ''}
      ${canEdit && equippedSlots.length ? `<button data-action="clearEquipSlot" data-slot="${_esc(equippedSlots[0])}" data-render-tab="inventaire">Retirer</button>` : ''}
      ${canEdit && !equippedSlots.length && targetSlot ? `<button class="is-primary" data-action="equipInventoryItem" data-index="${equipIndex}" data-slot="${_esc(targetSlot.id)}" data-render-tab="inventaire">⚔️ Équiper · ${_esc(targetSlot.label)}</button>` : ''}
      ${canEdit && _invIsBeltItem({ ...item, belt: undefined }) ? `<button data-action="_invToggleBelt" data-id="${_esc(c.id)}" data-indices="${indicesB64}" data-belt="${zone !== 'belt'}">${zone === 'belt' ? 'Vers le sac' : 'À la ceinture'}</button>` : ''}
      ${canEdit && item.source === 'boutique' ? `<button class="is-sell" data-action="openSellInvModal" data-id="${_esc(c.id)}" data-indices="${indicesB64}" data-prix="${resale}" data-name="${_esc(item.nom || '')}">↻ Vendre</button>` : ''}
      ${canEdit ? `<button data-action="openSendInvModal" data-id="${_esc(c.id)}" data-indices="${indicesB64}" data-name="${_esc(item.nom || '')}">↗ Envoyer</button>` : ''}
      ${canEdit && !isQuest ? `<button class="is-danger" data-action="openDeleteInvModal" data-id="${_esc(c.id)}" data-indices="${indicesB64}" data-name="${_esc(item.nom || '')}" aria-label="Supprimer">×</button>` : ''}
    </footer>
  </aside>`;
}

export function renderCharInventaire(c, canEdit) {
  const inv = Array.isArray(c.inventaire) ? c.inventaire : [];
  const allIndices = inv.map((_, index) => index);
  const equippedMap = getEquippedInventoryIndexMap(c);
  const equippedIndices = new Set(equippedMap.keys());
  const beltIndices = allIndices.filter(index => !equippedIndices.has(index) && _invIsBeltItem(inv[index]));
  const bagIndices = allIndices.filter(index => !equippedIndices.has(index) && !beltIndices.includes(index));
  const recentMap = _invRecentAcquisitions(c);
  const isNew = group => !!_invRecentAt(group, recentMap);
  const beltGroups = _groupInventoryEntries(inv, beltIndices).filter(group => !_invOnlyNew || isNew(group));
  const bagGroupsAll = _groupInventoryEntries(inv, bagIndices);
  const categoriesAll = _invCategoryGroups(bagGroupsAll);
  const distributionCategories = _invCategoryGroups(_groupInventoryEntries(inv, allIndices));
  const availableCategories = new Set(categoriesAll.map(cat => cat.id));
  if (_invCategoryFilter !== 'all' && !availableCategories.has(_invCategoryFilter)) _invCategoryFilter = 'all';
  const categories = categoriesAll.map(cat => ({
    ...cat,
    items: _invSortGroups(cat.items.filter(group =>
      (_invCategoryFilter === 'all' || cat.id === _invCategoryFilter) && (!_invOnlyNew || isNew(group))), recentMap),
  })).filter(cat => cat.items.length);
  const allGroups = [
    ..._groupInventoryEntries(inv, [...equippedIndices]).map(group => ({ ...group, zone: 'worn' })),
    ...beltGroups.map(group => ({ ...group, zone: 'belt' })),
    ...bagGroupsAll.map(group => ({ ...group, zone: 'bag' })),
  ];
  let selected = allGroups.find(group => `${group.zone}::${group.key}` === _invSelected) || null;
  if (_invSelected && !selected) _invSelected = '';
  const totalItems = inv.reduce((sum, item) => sum + (parseInt(item.quantite || item.qte || 1) || 1), 0);
  const totalValue = inv.reduce((sum, item) => sum + getInventoryItemValue(item, getInventoryCatalogItem(item.itemId)) * (parseInt(item.quantite || item.qte || 1) || 1), 0);
  const newCount = allGroups.filter(group => isNew(group)).reduce((sum, group) => sum + group.qte, 0);

  const renderSelectAttrs = (group, zone) => {
    const indices = btoa(JSON.stringify(group.indices));
    return `data-action="_invSelectItem" data-key="${_esc(`${zone}::${group.key}`)}" data-zone="${zone}" data-indices="${indices}" data-search="${_esc(_invSearchValue(group.item))}"`;
  };
  const renderBeltRow = group => `<div class="inv5-belt-row inv5-filterable${`belt::${group.key}` === _invSelected ? ' is-selected' : ''}" ${renderSelectAttrs(group, 'belt')}>
    <button class="inv5-row-main" data-action="_invSelectItem" data-key="${_esc(`belt::${group.key}`)}" data-zone="belt">
      <span class="inv5-new-dot${isNew(group) ? '' : ' is-placeholder'}"${isNew(group) ? ' title="Nouveau"' : ''}></span><span class="inv5-searchable" data-plain="${_esc(group.item.nom || 'Sans nom')}">${_invHighlight(group.item.nom || 'Sans nom')}</span>
      <small class="inv5-searchable" data-plain="${_esc(_invKeyInfo(group.item))}">${_invHighlight(_invKeyInfo(group.item))}</small>
    </button><b>${group.qte}</b>
    ${canEdit ? `<button class="inv5-use" data-action="_invConsumeOne" data-id="${_esc(c.id)}" data-indices="${btoa(JSON.stringify(group.indices))}" title="Utiliser une unité">−1</button>` : ''}
  </div>`;
  const renderBagRow = group => {
    const item = group.item;
    const price = getInventoryItemValue(item, getInventoryCatalogItem(item.itemId));
    const isQuest = _invIsQuestItem(item);
    const rarityName = RARETE_NAMES[Math.max(0, parseInt(item.rarete || item.rare || 0) || 0)] || 'Commun';
    const rowAccent = isQuest ? '#facc15' : (_rareteColor(rarityName) || '#7a8fa8');
    const keyInfo = _invKeyInfo(item);
    const infoTone = /^\s*\+\d/.test(keyInfo) ? ' is-positive' : (isQuest || /\b(sort|fragment)/i.test(keyInfo) ? ' is-arcane' : '');
    return `<button class="inv5-item-row inv5-filterable${`bag::${group.key}` === _invSelected ? ' is-selected' : ''}" style="--inv5-row-accent:${rowAccent}" ${renderSelectAttrs(group, 'bag')}>
      <span class="inv5-item-name">${isNew(group) ? '<i class="inv5-item-new" title="Nouveau" aria-label="Nouveau"></i>' : ''}<strong class="inv5-searchable" data-plain="${_esc(item.nom || 'Sans nom')}">${_invHighlight(item.nom || 'Sans nom')}</strong>${isQuest ? '<span class="inv5-quest-tag">Quête</span>' : ''}${item.notePerso ? `<em class="inv5-searchable" data-plain="${_esc(item.notePerso)}">${_invHighlight(item.notePerso)}</em>` : ''}</span>
      <span class="inv5-item-info${infoTone} inv5-searchable" data-plain="${_esc(keyInfo)}">${_invHighlight(keyInfo)}</span><span class="inv5-item-qty${group.qte > 1 ? ' is-stack' : ''}">×${group.qte}</span><span class="inv5-item-value">${price ? `${price * group.qte} or` : '—'}</span>
    </button>`;
  };

  const slots = getEquipmentSlots();
  const wornHtml = slots.map(slot => {
    const index = [...equippedMap.entries()].find(([, slotIds]) => slotIds.includes(slot.id))?.[0];
    const item = Number.isInteger(index) ? inv[index] : null;
    if (item) {
      const group = { key: _invItemKey(item), item, indices: [index], qte: parseInt(item.quantite || item.qte || 1) || 1 };
      return `<button class="inv5-slot is-filled${`worn::${group.key}` === _invSelected ? ' is-selected' : ''}" ${renderSelectAttrs(group, 'worn')}><small>${_esc(slot.label)}</small><strong>${_esc(item.nom || 'Sans nom')}</strong><span>${_esc(_invKeyInfo(item))}</span></button>`;
    }
    const compatibles = bagGroupsAll.filter(group => group.indices.some(idx => equipmentSlotAcceptsItem(slot, inv[idx])));
    return `<button class="inv5-slot is-empty" ${compatibles.length ? `data-action="_invFocusCompatible" data-slot="${_esc(slot.id)}"` : 'disabled'}><small>${_esc(slot.label)}</small><strong>Vide</strong>${compatibles.length ? `<span>${compatibles.length} compatible${compatibles.length > 1 ? 's' : ''} dans le sac →</span>` : ''}</button>`;
  }).join('');

  const chips = [{ id: 'all', label: 'Tout', icon: '' }, ...categoriesAll].map(cat => {
    const count = cat.id === 'all' ? bagGroupsAll.reduce((sum, group) => sum + group.qte, 0) : cat.items.reduce((sum, group) => sum + group.qte, 0);
    return `<button class="inv5-chip${_invCategoryFilter === cat.id ? ' is-on' : ''}" data-action="_invSetCategory" data-cat="${_esc(cat.id)}">${cat.icon || ''} ${_esc(cat.label || 'Tout')} <b>${count}</b></button>`;
  }).join('');
  const bagHtml = categories.map(cat => {
    const count = cat.items.reduce((sum, group) => sum + group.qte, 0);
    const value = cat.items.reduce((sum, group) => sum + getInventoryItemValue(group.item, getInventoryCatalogItem(group.item.itemId)) * group.qte, 0);
    return `<details class="inv5-group inv5-filter-group" ${_invCatOpen[cat.id] !== false ? 'open' : ''}><summary data-action="_invCatToggle" data-cat="${_esc(cat.id)}"><span class="inv5-group-chevron">▸</span><span class="inv5-group-icon">${cat.icon}</span><strong>${_esc(cat.label)}</strong><b>${count}</b><em>${value ? `${Number(value).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} or` : '—'}</em></summary><div>${cat.items.map(renderBagRow).join('')}</div></details>`;
  }).join('');

  return `<div class="inv5-shell">
    <div class="inv5-layout">
      <div class="inv5-left">
        <header class="inv5-topbar">
          <div class="inv5-summary">
            <div><small>Bourse</small><strong>${calcOr(c).toLocaleString('fr-FR')} or</strong></div>
            <div><small>Valeur des objets</small><strong>${totalValue.toLocaleString('fr-FR')} or</strong></div>
            <div><small>Objets</small><strong>${totalItems}</strong></div>
          </div>
          <nav class="inv5-top-actions" aria-label="Actions de l’inventaire">
            ${canEdit ? `<button class="is-gold" data-action="openSendGoldModal" data-id="${_esc(c.id)}">↗ Or</button><button data-action="openCreateItemModal" data-id="${_esc(c.id)}">🛠️ Créer</button><button data-action="addInvItem">🎁 Butin</button>` : ''}
            ${inventoryHistoryButton(c)}
          </nav>
        </header>
        <div class="inv5-tools">
          <label><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6"></circle><path d="m16 16 4 4"></path></svg><input type="search" value="${_esc(_charInvSearch)}" placeholder="Rechercher un objet, une note…" data-input="_charInvSearch"></label>
          ${newCount ? `<button class="inv5-new-filter${_invOnlyNew ? ' is-on' : ''}" data-action="_invToggleNew"><i aria-hidden="true"></i><span>${newCount} nouveau${newCount > 1 ? 'x' : ''}</span></button>` : ''}
          <div class="inv5-sort" role="group" aria-label="Tri du sac">${[['category','Catégorie'],['value','Valeur'],['recent','Récents'],['az','A–Z']].map(([id,label]) => `<button class="${_invSort === id ? 'is-on' : ''}" data-action="_invSetSort" data-sort="${id}">${label}</button>`).join('')}</div>
        </div>
        <main class="inv5-content">
          <section class="inv5-zone inv5-zone--worn"><button class="inv5-zone-head" data-action="_invToggleZone" data-zone="worn"><span>${_invZoneOpen.worn ? '▾' : '▸'}</span><h3>🧍 Porté</h3><p>Ce que le personnage a sur lui</p><b>${equippedIndices.size} / ${slots.length} emplacements</b></button>${_invZoneOpen.worn ? `<div class="inv5-slots">${wornHtml}</div>` : ''}</section>
          <section class="inv5-zone inv5-zone--belt"><button class="inv5-zone-head" data-action="_invToggleZone" data-zone="belt"><span>${_invZoneOpen.belt ? '▾' : '▸'}</span><h3>🧪 Ceinture</h3><p>Consommables utilisables en un geste</p><b>${beltGroups.reduce((sum, group) => sum + group.qte, 0)} unités</b></button>${_invZoneOpen.belt ? `<div class="inv5-belt">${beltGroups.map(renderBeltRow).join('') || '<p class="inv5-empty">Aucun objet en accès rapide.</p>'}</div>` : ''}</section>
          <section class="inv5-zone inv5-zone--bag"><button class="inv5-zone-head" data-action="_invToggleZone" data-zone="bag"><span>${_invZoneOpen.bag ? '▾' : '▸'}</span><h3>🎒 Sac</h3><p>Tout le reste, rangé par catégorie</p><b>${bagGroupsAll.reduce((sum, group) => sum + group.qte, 0)} objets</b></button>${_invZoneOpen.bag ? `<div class="inv5-chips">${chips}</div><div class="inv5-table-head"><span>Objet</span><span>Info clé</span><span>Qté</span><span>Valeur</span></div>${bagHtml || '<p class="inv5-empty">Aucun objet ne correspond aux filtres.</p>'}` : ''}</section>
        </main>
      </div>
      ${_invDetailHtml(c, selected, canEdit, selected?.zone || 'bag', distributionCategories, recentMap)}
    </div>
    ${selected ? '<button class="inv5-sheet-backdrop" data-action="_invCloseDetail" aria-label="Fermer le détail"></button>' : ''}
  </div>`;
}

// ── Filtrage live par recherche ───────────────
export function filterInvRows(val) {
  const q = _norm(val || '');
  document.querySelectorAll('.inv5-filterable, .inv5-slot[data-search]').forEach(row => {
    row.classList.toggle('inv-row--hidden', !!(q && !(row.dataset.search || '').includes(q)));
  });
  document.querySelectorAll('.inv5-filter-group').forEach(group => {
    const anyVisible = [...group.querySelectorAll('.inv5-filterable')].some(row => !row.classList.contains('inv-row--hidden'));
    group.classList.toggle('inv-row--hidden', !anyVisible);
  });
  document.querySelectorAll('.inv5-searchable').forEach(node => {
    node.innerHTML = _invHighlight(node.dataset.plain || '', val);
  });
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

export async function openInventoryItemDetail(charId, indicesB64) {
  const c = getCharacterById(charId);
  const indices = _decodeIndices(indicesB64);
  const item = c?.inventaire?.[indices[0]];
  if (!c || !item || !indices.length) return;

  await ensureInventoryCatalog();
  const catalogItem = getInventoryCatalogItem(item.itemId);
  const readableDocument = getInventoryReadableDocument(item, catalogItem);
  const canReadDocument = !!readableDocument && canControlCharacter(c);
  const quantity = indices.reduce((sum, idx) =>
    sum + (parseInt(c.inventaire?.[idx]?.quantite || c.inventaire?.[idx]?.qte || 1) || 1), 0);
  const rarityIndex = Math.max(0, parseInt(item.rarete || item.rare || 0) || 0);
  const rarityName = RARETE_NAMES[rarityIndex] || '';
  const rarityColor = _rareteColor(rarityName) || '#7a8fa8';
  const equippedMap = getEquippedInventoryIndexMap(c);
  const equippedSlots = [...new Set(indices.flatMap(idx => equippedMap.get(idx) || []))];
  const equipSlotId = resolveEquipmentSlotForItem(item);
  const equipSlot = equipSlotId ? getEquipmentSlot(equipSlotId) : null;
  const equipIndex = indices.find(idx => !(equippedMap.get(idx) || []).length) ?? indices[0];
  const equippedInTarget = !!equipSlotId && indices.some(idx => (equippedMap.get(idx) || []).includes(equipSlotId));
  const canEquip = !!equipSlot && canControlCharacter(c);
  const replacedName = equipSlotId && !equippedInTarget ? c.equipement?.[equipSlotId]?.nom : '';
  const traits = _getTraits(item);
  const statBonusHtml = _inventoryStatBadgesHtml(item);
  const rawEffectText = String(getItemEffectText(item) || '').trim();
  const descriptionText = String(item.description || '').trim();
  const effectCandidateText = rawEffectText && _norm(rawEffectText) !== _norm(descriptionText)
    ? rawEffectText
    : '';
  const effectText = _invLooksMechanicalEffect(effectCandidateText) ? effectCandidateText : '';
  const detailDescription = descriptionText || (!effectText ? effectCandidateText : '');
  const personal = getInvPersonalLineForIndices(c.inventaire || [], indices);
  const price = getInventoryItemValue(item, catalogItem);
  const resale = getInventoryItemResaleValue(item, catalogItem);
  const image = getInventoryItemImage(item, catalogItem);
  // Seuls les objets FORGES sont modifiables : ceux issus de la boutique/du
  // catalogue sont partages, les retoucher ici serait trompeur.
  const canEditItem = item.source === 'custom'
    && canControlCharacter(c);

  const facts = [
    ['Catégorie', item.type || item.categorie],
    // Type d'arme = format : le sous-type n'est affiché que s'il apporte une info.
    ['Sous-type', [item.sousType, item.typeArme].find(v => v && v !== item.format) || ''],
    ['Type d’arme', item.format],
    ['Maniement', item.mains],
    ['Armure', item.typeArmure],
    ['Emplacement', item.slotArmure || item.slotBijou],
    ['Dégâts', item.degats],
    ['Toucher', item.toucher || (item.toucherStat ? statShort(item.toucherStat) : '')],
    ['Portée', item.portee],
    ['CA', (() => {
      const value = (parseInt(item.ca) || 0) + (parseInt(item.caBonus) || 0);
      return value ? (value > 0 ? `+${value}` : value) : '';
    })()],
    ['Valeur', price ? `${price} or` : ''],
    ['Revente', resale ? `${resale} or / unité` : ''],
    ['Quantité', quantity],
  ].filter(([, value]) => value !== '' && value !== undefined && value !== null);

  const factHtml = facts.map(([label, value]) => `
    <div class="inv-detail-fact">
      <span>${_esc(label)}</span>
      <strong>${_esc(String(value))}</strong>
    </div>`).join('');

  openModal(`ⓘ ${item.nom || 'Objet'}`, `
    <div class="inv-detail" style="--inv-detail-accent:${rarityColor}">
      <header class="inv-detail-hero">
        ${image
          ? `<img src="${_esc(image)}" alt="${_esc(item.nom || 'Objet')}">`
          : `<div class="inv-detail-placeholder" aria-hidden="true">◇</div>`}
        <div class="inv-detail-identity">
          <div class="inv-detail-kicker">${_esc(rarityName || 'Objet')}</div>
          <h3>${_esc(item.nom || 'Sans nom')}</h3>
          <div class="inv-detail-status">
            <span>×${quantity}</span>
            ${equippedSlots.length
              ? `<span class="is-equipped">Équipé sur ce build · ${_esc(equippedSlots.join(', '))}</span>`
              : '<span>Non équipé</span>'}
          </div>
        </div>
      </header>

      <div class="inv-detail-facts">${factHtml}</div>

      ${statBonusHtml || effectText ? `<section class="inv-detail-section">
        <h4>Effets</h4>
        ${statBonusHtml ? `<div class="inv-detail-stat-badges">${statBonusHtml}</div>` : ''}
        ${effectText ? `<p>${_esc(effectText)}</p>` : ''}
      </section>` : ''}

      ${traits.length ? `<section class="inv-detail-section">
        <h4>Traits</h4>
        <div class="inv-detail-traits">${traits.map(trait => `<span>${_esc(trait)}</span>`).join('')}</div>
      </section>` : ''}

      ${detailDescription ? `<section class="inv-detail-section">
        <h4>Description</h4>
        <p>${_esc(detailDescription)}</p>
      </section>` : ''}

      ${personal.text ? `<section class="inv-detail-section inv-detail-note">
        <h4>Note personnelle</h4>
        <p>${_esc(personal.text)}</p>
      </section>` : ''}

      <footer class="inv-detail-footer">
        ${canReadDocument ? `<button class="btn btn-outline inv-detail-read" data-action="openInventoryReadableContent"
          data-id="${_esc(c.id)}" data-indices="${_esc(indicesB64)}">
          📖 Lire
        </button>` : ''}
        ${canEquip ? `<button class="btn ${equippedInTarget ? 'btn-outline is-equipped' : 'btn-gold'}" data-action="equipInventoryItem"
          data-index="${equipIndex}" data-slot="${_esc(equipSlotId)}" data-close-modal="true" data-render-tab="inv"
          ${equippedInTarget ? 'disabled' : ''}
          title="${equippedInTarget
            ? `Déjà équipé dans ${_esc(equipSlot.label)}`
            : `Équiper dans ${_esc(equipSlot.label)}${replacedName ? ` et remplacer ${_esc(replacedName)}` : ''}`}">
          ${equippedInTarget ? '✓ Déjà équipé' : `⚔️ Équiper · ${_esc(equipSlot.label)}`}
        </button>` : ''}
        ${canEditItem ? `<button class="btn btn-outline" data-action="openCreateItemModal"
          data-id="${_esc(c.id)}" data-index="${indices[0]}"
          title="Modifier cet objet dans la forge">🛠️ Modifier</button>` : ''}
        <button class="btn btn-primary" data-action="close-modal">Fermer</button>
      </footer>
    </div>`, {
    subtitle: 'Fiche complète de l’objet',
    accent: rarityColor,
  });
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

export function renderInvPersonalLine(c, indices, indicesB64, variant = 'row', canEdit = false) {
  const { text, multiple } = getInvPersonalLineForIndices(c.inventaire || [], indices);
  const noteCls = variant === 'card' ? 'inv-card-note' : 'inv-row-note';

  if (!canEdit) {
    return text ? '<div class="' + noteCls + (multiple ? ' ' + noteCls + '--mixed' : '') + '">✎ ' + _esc(text) + '</div>' : '';
  }

  const placeholder = multiple ? 'Notes différentes : écrire ici remplacera tout le groupe.' : 'Ligne personnelle...';
  return [
    '<div class="' + noteCls + ' inv-note-editable' + (multiple ? ' ' + noteCls + '--mixed inv-note-editable--mixed' : '') + '">',
    '<span class="inv-note-prefix">✎</span>',
    '<textarea class="inv-note-field" data-change="saveInvPersonalLine"',
    ' data-id="' + c.id + '" data-indices="' + indicesB64 + '"',
    ' data-original-note="' + _esc(multiple ? '' : text) + '" rows="1" maxlength="180"',
    ' placeholder="' + _esc(placeholder) + '">',
    multiple ? '' : _esc(text),
    '</textarea>',
    '</div>',
  ].join('');
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
export function openSellInvModal(charId, indicesB64, prixVente, nom) {
  const indices = _decodeIndices(indicesB64);
  const maxQte  = indices.length;
  if (maxQte === 0) return;

  const c = getCharacterById(charId);
  const equippedMap = c ? getEquippedInventoryIndexMap(c) : new Map();
  const equippedSlots = [...new Set(indices.flatMap(idx => equippedMap.get(idx) || []))];
  const hasEquipped = equippedSlots.length > 0;

  // Reprise sur améliorations : par item, on peut rembourser un % du coût investi.
  const settings = getUpgradeSettings();
  const refundRatio = parseFloat(settings?.refundUpgradeRatio) || 0;
  const upgradedItems = c
    ? indices.map(idx => c.inventaire?.[idx]).filter(it => it && hasUpgrades(it))
    : [];
  const upgradedCount = upgradedItems.length;
  const refundPerItem = upgradedItems.map(it => calcUpgradeRefund(it, settings));
  const totalRefundAll = refundPerItem.reduce((s, n) => s + n, 0);
  const lostInvestmentAll = upgradedItems.reduce((s, it) => s + getUpgradeTotalCost(it), 0) - totalRefundAll;
  // Pour le calcul live (qty variable), on rembourse les `qty` premiers items améliorés.
  const refundsCum = refundPerItem.reduce((acc, v) => { acc.push((acc[acc.length-1]||0) + v); return acc; }, []);
  const refundForQty = (q) => refundsCum[Math.min(q, upgradedCount) - 1] || 0;
  // Expose le tableau cumulatif au handler inline pour live-update.
  _sellRefundsCum = refundsCum;

  const refundHintHtml = upgradedCount && refundRatio > 0
    ? ` <span id="sell-refund-hint" class="invm-hint">(dont +${refundForQty(1)} reprise)</span>`
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
          <b>Item${upgradedCount>1?'s':''} amélioré${upgradedCount>1?'s':''}</b>
          <span>${refundRatio > 0
            ? `Reprise ${Math.round(refundRatio * 100)}% des PO investies — jusqu'à <b style="color:var(--gold)">+${totalRefundAll} or</b>.`
            : `Les améliorations seront perdues sans remboursement (${lostInvestmentAll} PO investies).`}</span>
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
    const equippedMap = getEquippedInventoryIndexMap(c);
    const unequippedIndices = allIndices.filter(idx => !(equippedMap.get(idx) || []).length);
    const equippedIndices = allIndices.filter(idx => (equippedMap.get(idx) || []).length);
    const indicesToSell = [...unequippedIndices, ...equippedIndices].slice(0, qty);

    const inv      = Array.isArray(c.inventaire) ? [...c.inventaire] : [];
    const item     = inv[indicesToSell[0]];
    if (!item) return;
    const itemNom  = item.nom || 'objet';
    const totalPrix = prixVente * qty;

    // Reprise des améliorations : somme des refunds des items vendus.
    const settings = getUpgradeSettings();
    const refundTotal = indicesToSell.reduce((s, idx) => s + calcUpgradeRefund(inv[idx], settings), 0);

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

  const orDispo = calcOr(fromChar);
  if (orDispo < montant) { showNotif(`Fonds insuffisants (${orDispo} or disponibles).`, 'error'); return; }

  const now = new Date().toLocaleDateString('fr-FR');

  // Sender : dépense
  const fromCompte = { recettes: [], depenses: [], ...(fromChar.compte || {}) };
  fromCompte.depenses = [...fromCompte.depenses, {
    date: now,
    libelle: `Or envoyé à ${toChar.nom || 'joueur'}`,
    montant,
  }];

  // Recipient : recette
  const toCompte = { recettes: [], depenses: [], ...(toChar.compte || {}) };
  toCompte.recettes = [...toCompte.recettes, {
    date: now,
    libelle: `Or reçu de ${fromChar.nom || 'joueur'}`,
    montant,
  }];

  await Promise.all([
    updateInCol('characters', fromCharId, { compte: fromCompte }),
    updateInCol('characters', targetId,   { compte: toCompte }),
  ]);

  fromChar.compte = fromCompte;
  toChar.compte   = toCompte;

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

function _rerenderInventoryView({ focusSearch = false } = {}) {
  const c = charSession.getCurrentChar?.() || STATE.activeChar;
  if (!c) return;
  const scrollTop = document.scrollingElement?.scrollTop || window.scrollY || 0;
  const search = document.querySelector('.inv5-tools input[type="search"]');
  const caret = search?.selectionStart ?? String(_charInvSearch || '').length;
  _renderInventoryChar(c, charSession.getCurrentCharTab() || 'inventaire');
  requestAnimationFrame(() => {
    window.scrollTo(0, scrollTop);
    if (!focusSearch) return;
    const input = document.querySelector('.inv5-tools input[type="search"]');
    if (!input) return;
    input.focus({ preventScroll: true });
    try { input.setSelectionRange(caret, caret); } catch {}
  });
}

function _invSelectItem(key, zone = 'bag') {
  _invSelected = String(key || '');
  _patchInventorySelection();
  requestAnimationFrame(() => {
    const detail = document.querySelector('.inv5-detail.is-selected');
    if (detail && window.matchMedia('(max-width: 900px)').matches) detail.focus?.({ preventScroll: true });
  });
}

function _patchInventorySelection() {
  const c = charSession.getCurrentChar?.() || STATE.activeChar;
  const shell = document.querySelector('.inv5-shell');
  if (!c || !shell) return;

  // Une sélection ne change que l'inspecteur. Conserver le DOM de la liste évite
  // de relancer l'animation d'entrée de tout l'onglet à chaque clic.
  const template = document.createElement('template');
  template.innerHTML = renderCharInventaire(c, charSession.getCanEditChar());
  const nextShell = template.content.querySelector('.inv5-shell');
  const nextDetail = nextShell?.querySelector('.inv5-detail');
  const currentDetail = shell.querySelector('.inv5-detail');
  if (currentDetail && nextDetail) currentDetail.replaceWith(nextDetail);

  shell.querySelector('.inv5-sheet-backdrop')?.remove();
  const nextBackdrop = nextShell?.querySelector('.inv5-sheet-backdrop');
  if (nextBackdrop) shell.append(nextBackdrop);

  shell.querySelectorAll('.inv5-slot[data-key], .inv5-belt-row[data-key], .inv5-item-row[data-key]').forEach(row => {
    row.classList.toggle('is-selected', row.dataset.key === _invSelected);
  });
}

function _invFocusCompatible(slotId) {
  const c = charSession.getCurrentChar?.() || STATE.activeChar;
  const slot = getEquipmentSlot(slotId);
  if (!c || !slot) return;
  const equipped = new Set(getEquippedInventoryIndexMap(c).keys());
  const compatible = (c.inventaire || []).find((item, index) => !equipped.has(index) && equipmentSlotAcceptsItem(slot, item));
  if (!compatible) return;
  _invCategoryFilter = _invIsQuestItem(compatible) ? 'quest' : _invCategory(compatible).id;
  _invOnlyNew = false;
  _invZoneOpen.bag = true;
  _rerenderInventoryView();
  requestAnimationFrame(() => document.querySelector('.inv5-zone:last-of-type')?.scrollIntoView({ block: 'start', behavior: 'smooth' }));
}

async function _invToggleBelt(charId, indicesB64, belt) {
  const c = getCharacterById(charId);
  const indices = _decodeIndices(indicesB64);
  if (!c || !indices.length || !canControlCharacter(c)) return;
  const inv = (c.inventaire || []).map((item, index) => indices.includes(index) ? { ...item, belt } : item);
  if (!await trySave('characters', c.id, { inventaire: inv })) return;
  c.inventaire = inv;
  if (STATE.activeChar?.id === c.id) STATE.activeChar.inventaire = inv;
  _invSelected = '';
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
  _invSelected = '';
  showNotif(`${item.nom || 'Objet'} utilisé.`, 'success');
  _rerenderInventoryView();
}

registerActions({
  _charInvSearch:      (el)  => { _charInvSearch = el.value; filterInvRows(el.value); },
  _sendTargetFilter:   (el)  => _sendTargetFilter(el),
  _invCatToggle:       (btn) => { const d = btn.closest('details'); requestAnimationFrame(() => { if (d) _invCatOpen[btn.dataset.cat] = d.open; }); },
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
  _invSelectItem:      (btn) => _invSelectItem(btn.dataset.key, btn.dataset.zone),
  _invCloseDetail:     () => { _invSelected = ''; _patchInventorySelection(); },
  _invFocusCompatible:(btn) => _invFocusCompatible(btn.dataset.slot),
  _invSetCategory:     (btn) => { _invCategoryFilter = btn.dataset.cat || 'all'; if (_invCategoryFilter !== 'all') _invCatOpen[_invCategoryFilter] = true; _invSelected = ''; _rerenderInventoryView(); },
  _invSetSort:         (btn) => { _invSort = btn.dataset.sort || 'category'; _rerenderInventoryView(); },
  _invToggleNew:       () => { _invOnlyNew = !_invOnlyNew; _invSelected = ''; _rerenderInventoryView(); },
  _invToggleZone:      (btn) => { const zone = btn.dataset.zone; if (zone) _invZoneOpen[zone] = !_invZoneOpen[zone]; _rerenderInventoryView(); },
  _invToggleBelt:      (btn) => _invToggleBelt(btn.dataset.id, btn.dataset.indices, btn.dataset.belt === 'true'),
  _invConsumeOne:      (btn) => _invConsumeOne(btn.dataset.id, btn.dataset.indices),
});
