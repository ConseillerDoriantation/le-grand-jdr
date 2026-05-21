// ══════════════════════════════════════════════════════════════════════════════
// shop-picker.js — Picker partagé d'objets boutique.
//
// Réutilisé par :
//  - VTT loot stash (réserve MJ)
//  - Bestiaire butin de créature
//  - (extensible : autre feature qui veut sélectionner un objet shop)
//
// Usage :
//   import { openShopPicker } from '../shared/shop-picker.js';
//   openShopPicker({
//     title: '🎒 Ajouter un butin',
//     modalMode: 'push',          // 'push' (stack) ou 'open' (remplace)
//     hint:  'Tu peux enchaîner les ajouts sans fermer cette fenêtre.',
//     onPick: async (item) => {   // ← callback par item cliqué
//       // ajoute à ta structure ; retourne false pour empêcher l'ajout
//     },
//     alreadyPicked: () => new Set(creature.butins.map(b => b.itemId)),
//     ownedBadgeTitle: 'Déjà dans le butin',
//     showQtyInput: false,        // true pour les pickers loot avec quantité
//   });
//
// Le composant gère seul : chargement boutique (cache), search, filtres cat,
// rendu, délégation événements, feedback visuel ✓ sur ajout.
// ══════════════════════════════════════════════════════════════════════════════

import { loadCollection } from '../data/firestore.js';
import { openModal, pushModal } from './modal.js';
import { _esc, _norm } from './html.js';

// Couleurs de rareté (cohérent avec le reste de l'app)
export const RARETE_COLOR = {
  commune:     '#9ca3af',
  peu_commune: '#22c38e',
  rare:        '#4f8cff',
  tres_rare:   '#b47fff',
  legendaire:  '#f59e0b',
};
export const getRareteColor = (rar) => RARETE_COLOR[rar] || '#9ca3af';

// ── Cache module (partagé entre tous les pickers) ───────────────────────────
let _cache = null;
let _loading = null;

/** Invalide le cache — à appeler après un add/edit/delete d'objet boutique. */
export function invalidateShopPickerCache() { _cache = null; }

/** Récupère un objet boutique par id (utilise le cache, le charge sinon).
 *  Utile pour les actions hors-picker qui ont juste un itemId
 *  (ex: envoi de butin de créature → réserve sans passer par la modal). */
export async function getShopItemById(itemId) {
  const data = await _loadShopData();
  return {
    item: data.items.find(i => i.id === itemId) || null,
    cat:  null,  // rempli si besoin via catMap
    catMap: data.catMap,
  };
}

async function _loadShopData() {
  if (_cache) return _cache;
  if (_loading) return _loading;
  _loading = Promise.all([
    loadCollection('shop').catch(() => []),
    loadCollection('shopCategories').catch(() => []),
  ]).then(([items, cats]) => {
    _cache = {
      items: (items || []).sort((a, b) => (a.nom || '').localeCompare(b.nom || '', 'fr', { sensitivity: 'base' })),
      cats:  cats || [],
      catMap: Object.fromEntries((cats || []).map(c => [c.id, c])),
    };
    return _cache;
  }).finally(() => { _loading = null; });
  return _loading;
}

// ── État du picker actif (singleton — un seul à la fois) ────────────────────
let _state = null;

// Limite de résultats affichés (perf + lisibilité)
const MAX_LIST = 80;

/** Ouvre le picker. Retourne une Promise qui résout quand la modal se ferme. */
export async function openShopPicker(opts = {}) {
  const {
    title           = '🎒 Sélectionner un objet',
    modalMode       = 'open',
    hint            = '',
    onPick,
    alreadyPicked   = null,    // () => Set<itemId>
    ownedBadgeTitle = 'Déjà sélectionné',
    showQtyInput    = false,
  } = opts;

  const data = await _loadShopData();
  _state = {
    items: data.items, cats: data.cats, catMap: data.catMap,
    activeCat: '', search: '',
    onPick, alreadyPicked, ownedBadgeTitle, showQtyInput,
  };

  const bodyHtml = `
    <input type="text" id="shop-picker-search" placeholder="🔍 Rechercher un objet…"
      class="input-field" style="width:100%;margin-bottom:.5rem"
      data-shop-picker="search" autofocus>
    <div id="shop-picker-cats" class="vtt-loot-cats"></div>
    <div id="shop-picker-list" class="vtt-loot-shop-list"></div>
    ${hint
      ? `<div style="font-size:.7rem;color:var(--text-dim);margin-top:.5rem;font-style:italic">ⓘ ${_esc(hint)}</div>`
      : ''}
  `;

  if (modalMode === 'push') pushModal(title, bodyHtml);
  else openModal(title, bodyHtml);

  _renderCats();
  _renderList();
  setTimeout(() => document.getElementById('shop-picker-search')?.focus(), 30);
}

function _renderCats() {
  if (!_state) return;
  const el = document.getElementById('shop-picker-cats');
  if (!el) return;
  const { cats, activeCat, items } = _state;
  const counts = {};
  items.forEach(it => { const k = it.categorieId || '_'; counts[k] = (counts[k] || 0) + 1; });
  const pill = (id, label, count) => `<button class="vtt-loot-cat-pill${activeCat === id ? ' active' : ''}"
      data-shop-picker="set-cat" data-cat="${_esc(id)}">${_esc(label)}${count != null ? ` <span class="vtt-loot-cat-count">${count}</span>` : ''}</button>`;
  el.innerHTML = pill('', 'Toutes', items.length) +
    cats.filter(c => counts[c.id]).map(c => pill(c.id, (c.emoji || '') + ' ' + c.nom, counts[c.id])).join('');
}

function _renderList() {
  if (!_state) return;
  const el = document.getElementById('shop-picker-list');
  if (!el) return;
  const { items, catMap, activeCat, search, alreadyPicked, ownedBadgeTitle, showQtyInput } = _state;
  const owned = alreadyPicked ? alreadyPicked() : new Set();

  let list = activeCat ? items.filter(i => i.categorieId === activeCat) : items;
  if (search) list = list.filter(i => _norm(i.nom || '').includes(_norm(search)));
  list = list.slice(0, MAX_LIST);
  if (!list.length) {
    el.innerHTML = '<div class="vtt-loot-empty-list">Aucun objet correspondant</div>';
    return;
  }
  el.innerHTML = list.map(item => {
    const cat = catMap[item.categorieId];
    const rarColor = getRareteColor(item.rarete);
    const inOwned = owned.has(item.id);
    // Pour la réserve VTT : badge "×N déjà dedans"
    const ownedBadge = inOwned
      ? `<span class="vtt-loot-instash" title="${_esc(ownedBadgeTitle)}">${typeof inOwned === 'number' ? `×${inOwned}` : '✓'}</span>`
      : '';
    const qtyInput = showQtyInput
      ? `<input type="number" min="1" value="1" class="vtt-loot-shop-qty" data-shop-picker-qty="${item.id}">`
      : '';
    return `<div class="vtt-loot-shop-row">
      <span class="vtt-loot-dot" style="background:${rarColor}"></span>
      <span class="vtt-loot-shop-name">${_esc(item.nom || '?')}</span>
      ${cat ? `<span class="vtt-loot-shop-cat">${_esc((cat.emoji || '') + ' ' + cat.nom)}</span>` : ''}
      ${ownedBadge}
      ${qtyInput}
      <button class="vtt-loot-shop-add" data-shop-picker="pick" data-item-id="${item.id}" title="Ajouter">＋</button>
    </div>`;
  }).join('');
}

async function _handlePick(itemId, btn) {
  if (!_state || !_state.onPick) return;
  const item = _state.items.find(i => i.id === itemId);
  if (!item) return;

  // Quantité optionnelle (mode loot)
  let qty = 1;
  if (_state.showQtyInput) {
    const qtyEl = document.querySelector(`[data-shop-picker-qty="${itemId}"]`);
    qty = Math.max(1, parseInt(qtyEl?.value) || 1);
    if (qtyEl) qtyEl.value = '1';
  }

  const result = await _state.onPick(item, { qty, btn });
  if (result === false) return;

  // Feedback visuel
  if (btn) {
    btn.textContent = '✓';
    btn.classList.add('vtt-loot-shop-add--ok');
    setTimeout(() => {
      btn.textContent = '＋';
      btn.classList.remove('vtt-loot-shop-add--ok');
    }, 800);
  }
  // Refresh pour MAJ des badges "déjà sélectionné"
  _renderList();
}

// ── Délégation (1 listener click + 1 input, attachés une seule fois) ────────
let _bound = false;
function _bind() {
  if (_bound) return;
  _bound = true;
  document.addEventListener('click', (e) => {
    if (!_state) return;
    const el = e.target.closest('[data-shop-picker]');
    if (!el) return;
    const action = el.dataset.shopPicker;
    if (action === 'set-cat') {
      const cat = el.dataset.cat || '';
      _state.activeCat = cat === _state.activeCat ? '' : cat;
      _renderCats();
      _renderList();
    } else if (action === 'pick') {
      _handlePick(el.dataset.itemId, el);
    }
  }, true);
  document.addEventListener('input', (e) => {
    if (!_state) return;
    if (e.target.matches?.('[data-shop-picker="search"]')) {
      _state.search = (e.target.value || '').toLowerCase().trim();
      _renderList();
    }
  }, true);
}
_bind();
