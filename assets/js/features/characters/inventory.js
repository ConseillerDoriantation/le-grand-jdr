import { STATE } from '../../core/state.js';
import { charSession } from '../../shared/char-session.js';
import { registerActions } from '../../core/actions.js';
import { updateInCol, loadCollection } from '../../data/firestore.js';
import { trySave } from '../../shared/crud.js';
import { openModal, closeModal, modalSection } from '../../shared/modal.js';
import { showNotif, notifySaveError } from '../../shared/notifications.js';
import { _esc, _norm } from '../../shared/html.js';
import { lsJson } from '../../shared/local-storage.js';
import { RARETE_NAMES, _rareteColor } from '../../shared/rarity.js';
import { statShort, formatItemBonusText, calcOr, getItemEffectText } from '../../shared/char-stats.js';
import { useGoldMulti } from '../../shared/economy.js';
import {
  shopItemToInvEntry,
  getInventoryItemValue,
  getInventoryItemResaleValue,
  getInventoryItemImage,
} from '../../shared/inventory-utils.js';
import { getWeaponDamageStatKeys } from '../../shared/equipment-utils.js';
import { characterAvatarHtml, characterPortraitContent } from '../../shared/portraits.js';
import { calcUpgradeRefund, getUpgradeTotalCost, hasUpgrades, getUpgradeSettings } from '../../shared/upgrade-settings.js';
import {
  _getTraits,
  getEquippedInventoryIndexMap,
  syncEquipmentAfterInventoryMutation,
} from './data.js';

import { getCharacterById } from '../../shared/character-state.js';
let _charInvSearch = '';
let _invCatOpen = {};
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

export function isInventoryCatalogReady() {
  return Array.isArray(_shopItemsCache);
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
  return _shopItemsCache.find(item => item.id === itemId) || null;
}

function _renderInventoryChar(c, tab = 'inventaire') {
  charSession.renderSheet?.(c, tab || charSession.getCurrentCharTab() || 'inventaire');
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
    const bonusText = formatItemBonusText(item);
    if (item.format)      infos.push({ label: 'Format',    val: item.format });
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
    if (bonusText)        infos.push({ label: 'Stats',      val: bonusText,   color: '#4f8cff' });

    return `
    <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:12px;
      padding:.85rem 1rem;display:flex;flex-direction:column;gap:.5rem;border-left:3px solid ${rareteC}">

      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:.5rem">
        <div>
          <div style="font-family:'Cinzel',serif;font-size:.88rem;color:var(--text);font-weight:600;line-height:1.2">
            ${item.nom || '?'}
          </div>
          ${rareteL ? `<div style="font-size:.68rem;color:${rareteC};margin-top:1px">${'★'.repeat(rareteN)+'☆'.repeat(5-rareteN)} ${rareteL}</div>` : ''}
        </div>
        <span style="font-size:.72rem;background:var(--bg-elevated);border:1px solid var(--border);
          border-radius:999px;padding:2px 8px;color:var(--text-muted);flex-shrink:0">×${g.qte}</span>
      </div>

      ${infos.length ? `
      <div style="display:flex;flex-wrap:wrap;gap:.3rem .75rem">
        ${infos.map(info => `
          <div style="display:flex;align-items:baseline;gap:.3rem;font-size:.78rem">
            <span style="color:var(--text-dim);font-size:.68rem;text-transform:uppercase;letter-spacing:.5px">${info.label}</span>
            <span style="color:${info.color||'var(--text-muted)'};${info.italic?'font-style:italic':''};font-weight:${info.color?'600':'400'}">${info.val}</span>
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
  const bonus = formatItemBonusText(item);
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
  if (item.typeArmure)       chips.push({ val: item.typeArmure, color: '#22c38e' });
  if (chips.length < 2 && item.sousType) chips.push({ val: item.sousType, color: '#a0aec0' });
  if (chips.length < 2 && item.format)   chips.push({ val: item.format,   color: '#a0aec0' });
  if (chips.length === 0 && item.effet)
    chips.push({ val: item.effet.length > 42 ? item.effet.slice(0,42)+'…' : item.effet, color: 'var(--text-muted)' });
  if (chips.length === 0 && item.type)
    chips.push({ val: item.type, color: 'var(--text-dim)' });
  if (!bonus) return chips.slice(0, 3);
  return [...chips.slice(0, 2), { val: bonus, color: '#4f8cff' }];
}

export function renderCharInventaire(c, canEdit) {
  const invRaw = c.inventaire || [];
  const q = _norm(_charInvSearch || '');   // minuscules + sans accents

  // ── Regrouper par itemId + nom ──
  const grouped = [];
  invRaw.forEach((item, realIdx) => {
    const key = (item.itemId || '') + '||' + (item.nom || '');
    const existing = grouped.find(g => g.key === key);
    if (existing) {
      existing.qte += parseInt(item.qte) || 1;
      existing.indices.push(realIdx);
    } else {
      grouped.push({ key, item: { ...item }, qte: parseInt(item.qte) || 1, indices: [realIdx] });
    }
  });

  const equippedMap = getEquippedInventoryIndexMap(c);

  // ── Rubriques : 3 fixes (équipement) + une par type d'objet possédé ──
  // L'ordre : Armes, Armures, Bijoux, puis les types présents (alpha), Divers en dernier.
  const FIXED_ORDER = ['armes', 'armures', 'bijoux'];
  const catMap = new Map();
  grouped.forEach(g => {
    const cat = _invCategory(g.item);
    let c = catMap.get(cat.id);
    if (!c) { c = { id: cat.id, label: cat.label, icon: cat.icon, items: [] }; catMap.set(cat.id, c); }
    c.items.push(g);
  });
  const CATS = [
    ...FIXED_ORDER.map(id => catMap.get(id)).filter(Boolean),
    ...[...catMap.values()]
      .filter(c => !FIXED_ORDER.includes(c.id) && c.id !== 'divers')
      .sort((a, b) => a.label.localeCompare(b.label, 'fr', { sensitivity: 'base' })),
    ...(catMap.get('divers') ? [catMap.get('divers')] : []),
  ];

  // ── Rendu d'une ligne compacte ──
  const _renderRow = (g) => {
    const item = g.item;
    const nomNorm = _norm(item.nom || '');   // pour la recherche (sans accents/casse)
    const hidden = q && !nomNorm.includes(q);
    const rareteN = parseInt(item.rarete) || 0;
    const rareteL = RARETE_NAMES[rareteN] || '';
    const rareteC = _rareteColor(rareteL) || 'var(--border)';
    const pv = parseFloat(item.prixVente) || Math.round((parseFloat(item.prixAchat)||0)*0.6);
    const indicesB64 = btoa(JSON.stringify(g.indices));
    const equippedSlots = [...new Set(g.indices.flatMap(idx => equippedMap.get(idx)||[]))];
    const isEquipped = equippedSlots.length > 0;
    const chips = _invRowChips(item);
    const nomEsc = _esc(item.nom || '?');

    return `<div class="inv-row${hidden ? ' inv-row--hidden' : ''}" data-nom="${_esc(nomNorm)}" style="--rc:${rareteC}">
      <div class="inv-row-body">
        <span class="inv-row-nom">${nomEsc}</span>
        ${isEquipped ? `<span class="inv-row-eq" title="${equippedSlots.join(', ')}">✓ Équipé</span>` : ''}
        ${chips.length ? `<div class="inv-row-chips">${chips.map(ch => `<span class="inv-row-chip" style="color:${ch.color}">${_esc(ch.val)}</span>`).join('')}</div>` : ''}
        ${renderInvPersonalLine(c, g.indices, indicesB64, 'row', canEdit)}
      </div>
      <div class="inv-row-aside">
        ${g.qte > 1 ? `<span class="inv-row-qte">×${g.qte}</span>` : ''}
        <div class="inv-row-btns">
          ${canEdit && item.source === 'boutique' ? `<button class="inv-rbtn inv-rbtn--sell" title="Vendre" data-action="openSellInvModal" data-id="${c.id}" data-indices="${indicesB64}" data-prix="${pv}" data-name="${_esc(item.nom||'')}">🔄</button>` : ''}
          <button class="inv-rbtn inv-rbtn--send" title="Envoyer" data-action="openSendInvModal" data-id="${c.id}" data-indices="${indicesB64}" data-name="${_esc(item.nom||'')}">↗</button>
          ${canEdit ? `<button class="inv-rbtn inv-rbtn--del" title="Supprimer" data-action="openDeleteInvModal" data-id="${c.id}" data-indices="${indicesB64}" data-name="${_esc(item.nom||'')}">✕</button>` : ''}
        </div>
      </div>
    </div>`;
  };

  const totalItems = invRaw.length;

  const otherCharsGold = (STATE.characters || []).filter(x => x.id !== c.id && x.nom);

  let html = `<div class="cs-section cs-section--compact">
    <div class="cs-section-hdr">
      <span class="cs-section-title">🎒 Inventaire</span>
      <span class="cs-hint">${totalItems} objet${totalItems !== 1 ? 's' : ''}</span>
      <div style="display:flex;gap:.4rem;margin-left:auto;align-items:center">
        <button class="cs-inv-action-btn cs-inv-action-btn--gold" data-action="openSendGoldModal" data-id="${c.id}" title="Envoyer de l'or à un autre personnage">↗ Or</button>
        ${canEdit ? `<button class="cs-inv-action-btn" data-action="addInvItem">🎁 Butin</button>` : ''}
      </div>
    </div>`;

  if (grouped.length === 0) {
    html += `<div class="cs-empty-state">
      <div class="cs-empty-icon">🎒</div>
      <div class="cs-empty-msg">Inventaire vide.</div>
      <div class="cs-empty-sub">Achetez des objets depuis la Boutique.</div>
    </div>`;
  } else {
    // Barre de recherche
    html += `<div class="inv-search-wrap">
      <span class="inv-search-icon">🔍</span>
      <input class="inv-search-input" type="text" placeholder="Rechercher un objet…"
        value="${_esc(_charInvSearch || '')}"
        data-input="_charInvSearch">
      ${q ? `<button class="inv-search-clear" data-action="filterInvClear">✕</button>` : ''}
    </div>`;

    // Groupes par catégorie
    for (const cat of CATS) {
      if (!cat.items.length) continue;
      const allHidden = q && cat.items.every(g => !_norm(g.item.nom || '').includes(q));
      const openState = _invCatOpen[cat.id] !== false;
      html += `<details class="inv-cat${allHidden ? ' inv-cat--hidden' : ''}" id="inv-cat-${_esc(cat.id)}"
        ${openState ? 'open' : ''}>
        <summary class="inv-cat-head" data-action="_invCatToggle" data-cat="${_esc(cat.id)}">
          <div class="inv-cat-title-row">
            <span class="inv-cat-icon">${cat.icon}</span>
            <span class="inv-cat-title">${_esc(cat.label)}</span>
          </div>
          <div class="inv-cat-right">
            <span class="inv-cat-count">${cat.items.reduce((s, g) => s + (parseInt(g.qte) || 0), 0)}</span>
            <span class="inv-cat-chev">▶</span>
          </div>
        </summary>
        <div class="inv-cat-body">
          ${cat.items.map(_renderRow).join('')}
        </div>
      </details>`;
    }
  }

  html += `</div>`;
  return html;
}

// ── Filtrage live par recherche ───────────────
export function filterInvRows(val) {
  const q = _norm(val || '');   // minuscules + sans accents (data-nom est déjà normalisé)
  document.querySelectorAll('.inv-row').forEach(r => {
    r.classList.toggle('inv-row--hidden', !!(q && !(r.dataset.nom || '').includes(q)));
  });
  document.querySelectorAll('.inv-cat').forEach(cat => {
    const anyVisible = [...cat.querySelectorAll('.inv-row')].some(r => !r.classList.contains('inv-row--hidden'));
    cat.classList.toggle('inv-cat--hidden', !anyVisible);
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
  const quantity = indices.reduce((sum, idx) =>
    sum + (parseInt(c.inventaire?.[idx]?.quantite || c.inventaire?.[idx]?.qte || 1) || 1), 0);
  const rarityIndex = Math.max(0, Math.min(5, parseInt(item.rarete || item.rare || 0) || 0));
  const rarityName = RARETE_NAMES[rarityIndex] || '';
  const rarityColor = _rareteColor(rarityName) || '#7a8fa8';
  const equippedMap = getEquippedInventoryIndexMap(c);
  const equippedSlots = [...new Set(indices.flatMap(idx => equippedMap.get(idx) || []))];
  const traits = _getTraits(item);
  const bonusText = formatItemBonusText(item);
  const effectText = getItemEffectText(item);
  const personal = getInvPersonalLineForIndices(c.inventaire || [], indices);
  const price = getInventoryItemValue(item, catalogItem);
  const resale = getInventoryItemResaleValue(item, catalogItem);
  const image = getInventoryItemImage(item, catalogItem);

  const facts = [
    ['Catégorie', item.type || item.categorie],
    ['Sous-type', item.sousType || item.typeArme],
    ['Format', item.format],
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
              ? `<span class="is-equipped">Équipé · ${_esc(equippedSlots.join(', '))}</span>`
              : '<span>Non équipé</span>'}
          </div>
        </div>
      </header>

      <div class="inv-detail-facts">${factHtml}</div>

      ${bonusText || effectText ? `<section class="inv-detail-section">
        <h4>Effets</h4>
        ${bonusText ? `<p class="inv-detail-bonus">${_esc(bonusText)}</p>` : ''}
        ${effectText ? `<p>${_esc(effectText)}</p>` : ''}
      </section>` : ''}

      ${traits.length ? `<section class="inv-detail-section">
        <h4>Traits</h4>
        <div class="inv-detail-traits">${traits.map(trait => `<span>${_esc(trait)}</span>`).join('')}</div>
      </section>` : ''}

      ${item.description ? `<section class="inv-detail-section">
        <h4>Description</h4>
        <p>${_esc(item.description)}</p>
      </section>` : ''}

      ${personal.text ? `<section class="inv-detail-section inv-detail-note">
        <h4>Note personnelle</h4>
        <p>${_esc(personal.text)}</p>
      </section>` : ''}

      <footer class="inv-detail-footer">
        ${charSession.getCanEditChar()
          ? `<button class="btn btn-outline" data-action="editInvItem" data-idx="${indices[0]}">✎ Modifier</button>`
          : ''}
        <button class="btn btn-primary" data-action="close-modal">Fermer</button>
      </footer>
    </div>`, {
    subtitle: 'Fiche complète de l’objet',
    accent: rarityColor,
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
    const extraPayload = { inventaire: inv };
    if (equipSync.changed) {
      extraPayload.equipement = equipSync.equipement;
      extraPayload.statsBonus = equipSync.statsBonus;
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
  const sorted = [...removedIndices].sort((a,b)=>b-a);
  sorted.forEach(idx => inv.splice(idx, 1));
  const equipSync = syncEquipmentAfterInventoryMutation(c, removedIndices);
  const payload = { inventaire: inv };
  if (equipSync.changed) {
    payload.equipement = equipSync.equipement;
    payload.statsBonus = equipSync.statsBonus;
  }
  if (await trySave('characters', charId, payload)) {
    c.inventaire = inv;
    if (equipSync.changed) {
      c.equipement = equipSync.equipement;
      c.statsBonus = equipSync.statsBonus;
    }
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

  let otherChars = STATE.characters?.filter(x => x.id !== charId) || [];
  if (!otherChars.length) {
    try {
      const all = await loadCollection('characters');
      otherChars = all.filter(x => x.id !== charId);
      _modalCharTargets = all;
    } catch(e) { console.error('[sendInv] load chars:', e); }
  }
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
  const fromPayload = { inventaire: fromInv };
  if (equipSync.changed) {
    fromPayload.equipement = equipSync.equipement;
    fromPayload.statsBonus = equipSync.statsBonus;
  }

  await Promise.all([
    updateInCol('characters', fromCharId, fromPayload),
    updateInCol('characters', targetId,   { inventaire: toInv }),
  ]);
  fromChar.inventaire = fromInv;
  if (equipSync.changed) {
    fromChar.equipement = equipSync.equipement;
    fromChar.statsBonus = equipSync.statsBonus;
  }
  toChar.inventaire   = toInv;

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
  let targets = (STATE.characters || []).filter(x => x.id !== charId && x.nom);

  if (!targets.length) {
    try {
      const all = await loadCollection('characters');
      targets = all.filter(x => x.id !== charId && x.nom);
      _modalCharTargets = all;
    } catch(e) { console.error('[sendGold] load chars:', e); }
  }

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
  c.inventaire = inv;
  if (STATE.activeChar?.id === c.id) STATE.activeChar.inventaire = inv;
  const stChar = (STATE.characters || []).find(x => x.id === c.id);
  if (stChar) stChar.inventaire = inv;
  if (await trySave('characters', c.id, { inventaire: inv })) {
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
  c.inventaire = inv;
  if (await trySave('characters',c.id,{inventaire:inv})) {
    closeModal();
    showNotif('Inventaire mis à jour !','success');
  }
  _renderInventoryChar(c, 'inventaire');
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
  saveInvItem:         (btn) => saveInvItem(Number(btn.dataset.idx)),
  _lootSelect:         (btn) => _lootSelect(btn.dataset.id),
  _lootSetCat:         (btn) => _lootSetCat(btn.dataset.cat),
  _lootQte:            (btn) => { const i = document.getElementById('loot-qte'); if (i) i.value = Math.max(1, parseInt(i.value || 1) + Number(btn.dataset.delta)); },
});
