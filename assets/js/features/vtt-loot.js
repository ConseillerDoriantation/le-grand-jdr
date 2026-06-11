// ══════════════════════════════════════════════════════════════════════════════
// VTT-LOOT.JS — Butin d'aventure (Table de Jeu Virtuelle)
// ══════════════════════════════════════════════════════════════════════════════
// Extrait de vtt.js (Phase 1 du découpage, voir docs/vtt-decomposition.md).
// État local (réserve + butin partagés via adventures/{id}/vtt/loot).
// MJ gère le butin ; les joueurs prennent des objets (→ inventaire perso).
// ══════════════════════════════════════════════════════════════════════════════

import { db, doc, onSnapshot, setDoc, updateDoc } from '../config/firebase.js';
import { STATE } from '../core/state.js';
import { VS, aid } from './vtt-state.js';
import { _esc } from '../shared/html.js';
import { showNotif } from '../shared/notifications.js';
import { openShopPicker, getShopItemById } from '../shared/shop-picker.js';
import { shopItemToInvEntry } from '../shared/inventory-utils.js';
import { sortCharactersForDisplay } from '../shared/char-stats.js';
import { _chrRef } from './vtt.js';   // ref Firestore perso (transverse)

// ── État local butin ────────────────────────────────────────────────
let _loot            = { stash: [], loot: [] };
let _lootUnsub       = null;
let _lootLoading     = false;
let _lootReady       = null;
let _lootCloseOutside = null;
const _lootRef  = () => doc(db, `adventures/${aid()}/vtt/loot`);

// ═══════════════════════════════════════════════════════════════════
// BUTIN D'AVENTURE
// ═══════════════════════════════════════════════════════════════════

async function _saveLoot() {
  await _ensureLootListener();
  await setDoc(_lootRef(), { stash: _loot.stash, loot: _loot.loot });
}

function _normalizeLoot(data) {
  _loot = data || {};
  if (!Array.isArray(_loot.stash)) _loot.stash = [];
  if (!Array.isArray(_loot.loot))  _loot.loot  = [];
}

function _ensureLootListener() {
  if (_lootUnsub) return _lootReady || Promise.resolve(_loot);
  _lootLoading = true;
  _lootReady = new Promise(resolve => {
    let resolved = false;
    const finish = () => {
      _lootLoading = false;
      _renderLootPanel();
      if (!resolved) { resolved = true; resolve(_loot); }
    };
    _lootUnsub = onSnapshot(_lootRef(), snap => {
      _normalizeLoot(snap.exists() ? snap.data() : {});
      finish();
    }, () => {
      _normalizeLoot(_loot);
      finish();
    });
  });
  return _lootReady;
}

function _renderLootPanel() {
  const panel = document.getElementById('vtt-loot-panel');
  if (!panel || panel.dataset.open !== '1') return;
  const mj = STATE.isAdmin;

  if (_lootLoading) {
    panel.innerHTML = '<div class="vtt-loot-empty">Chargement du butin…</div>';
    return;
  }

  const uid = STATE.user?.uid;
  const myChars = sortCharactersForDisplay(Object.values(VS.characters).filter(c => c.uid === uid));
  const _itemRow = (item, zone) => {
    const rarColor = { commune:'#9ca3af', peu_commune:'#22c38e', rare:'#4f8cff', tres_rare:'#b47fff', legendaire:'#f59e0b' }[item.rarete] || '#9ca3af';
    return `<div class="vtt-loot-row-wrap" data-id="${item.id}">
      <div class="vtt-loot-row" data-id="${item.id}">
        ${mj ? `<span class="vtt-loot-drag" title="${zone === 'stash' ? 'Glisser vers le butin' : 'Glisser vers la réserve'}">⠿</span>` : ''}
        <span class="vtt-loot-dot" style="background:${rarColor}"></span>
        <span class="vtt-loot-name">${_esc(item.nom)}</span>
        <span class="vtt-loot-qty">×${item.qty}</span>
        ${zone === 'stash' && mj ? `<button class="vtt-icon-btn" data-vtt-fn="_vttLootRemoveStash" data-vtt-args="${item.id}" title="Retirer">✕</button>` : ''}
        ${zone === 'loot'  && mj ? `<button class="vtt-icon-btn" data-vtt-fn="_vttLootRemoveLoot" data-vtt-args="${item.id}" title="Retirer">✕</button>` : ''}
        ${zone === 'loot' && myChars.length ? `<button class="vtt-loot-take-btn" data-vtt-fn="_vttLootToggleTake" data-vtt-args="${item.id}">Prendre</button>` : ''}
      </div>
      ${zone === 'loot' ? `<div class="vtt-loot-take-inline" id="vtt-take-inline-${item.id}" style="display:none"></div>` : ''}
    </div>`;
  };

  panel.innerHTML = `
    ${mj ? `
    <div class="vtt-loot-section">
      <div class="vtt-loot-sec-hd">
        <span>🔒 Réserve MJ</span>
        <button class="vtt-btn-sm" data-vtt-fn="_vttLootOpenShop">＋ Ajouter</button>
      </div>
      <div class="vtt-loot-list" id="vtt-stash-list">
        ${_loot.stash.length ? _loot.stash.map(i => _itemRow(i, 'stash')).join('') : '<div class="vtt-loot-empty">Vide — ajoutez des objets</div>'}
      </div>
    </div>
    <div class="vtt-loot-divider">↕ Glisser entre réserve et butin</div>
    ` : ''}
    <div class="vtt-loot-section">
      <div class="vtt-loot-sec-hd">
        <span>💰 Butin disponible</span>
        ${mj ? `<button class="vtt-btn-sm vtt-btn-danger" data-vtt-fn="_vttLootClear">🗑</button>` : ''}
      </div>
      <div class="vtt-loot-list" id="vtt-loot-list">
        ${_loot.loot.length ? _loot.loot.map(i => _itemRow(i, 'loot')).join('') : '<div class="vtt-loot-empty">Aucun butin</div>'}
      </div>
    </div>`;

  if (mj) _initLootSortable();
}

function _initLootSortable() {
  const stashEl = document.getElementById('vtt-stash-list');
  const lootEl  = document.getElementById('vtt-loot-list');
  if (!stashEl || !lootEl) return;
  import('../vendor/sortable.esm.js').then(({ default: Sortable }) => {
    Sortable.create(stashEl, {
      group: { name: 'vtt-loot', pull: 'clone', put: true },
      animation: 150,
      handle: '.vtt-loot-drag',
      sort: false,
      ghostClass: 'vtt-loot-ghost',
      onAdd(evt) {
        // Item glissé depuis le butin vers la réserve
        const id = evt.item.dataset.id;
        evt.item.remove();
        const src = _loot.loot.find(i => i.id === id);
        if (!src) return;
        const existing = _loot.stash.find(i => i.itemId === src.itemId);
        if (existing) { existing.qty += src.qty; }
        else { _loot.stash.push({ ...src, id: crypto.randomUUID() }); }
        _loot.loot = _loot.loot.filter(i => i.id !== id);
        _saveLoot();
      },
    });
    Sortable.create(lootEl, {
      group: { name: 'vtt-loot', pull: true, put: true },
      animation: 150,
      handle: '.vtt-loot-drag',
      sort: false,
      ghostClass: 'vtt-loot-ghost',
      onAdd(evt) {
        // Item glissé depuis la réserve vers le butin
        const id = evt.item.dataset.id;
        evt.item.remove();
        const src = _loot.stash.find(i => i.id === id);
        if (!src) return;
        const existing = _loot.loot.find(i => i.itemId === src.itemId);
        if (existing) { existing.qty += src.qty; }
        else { _loot.loot.push({ ...src, id: crypto.randomUUID() }); }
        _loot.stash = _loot.stash.filter(i => i.id !== id);
        _saveLoot();
      },
    });
  });
}

function _closeLootPanel() {
  const panel = document.getElementById('vtt-loot-panel');
  const btn   = document.getElementById('vtt-loot-trigger');
  if (panel) { panel.dataset.open = '0'; panel.style.display = 'none'; }
  btn?.classList.remove('active');
  if (_lootCloseOutside) {
    document.removeEventListener('mousedown', _lootCloseOutside, true);
    _lootCloseOutside = null;
  }
}

function _vttToggleLoot() {
  const panel = document.getElementById('vtt-loot-panel');
  if (!panel) return;
  const open = panel.dataset.open === '1';
  if (open) { _closeLootPanel(); return; }
  panel.dataset.open = '1';
  panel.style.display = 'flex';
  document.getElementById('vtt-loot-trigger')?.classList.add('active');
  void _ensureLootListener();
  _renderLootPanel();
  _lootCloseOutside = (e) => {
    const float = document.querySelector('.vtt-loot-float');
    if (float && !float.contains(e.target)) _closeLootPanel();
  };
  document.addEventListener('mousedown', _lootCloseOutside, true);
}

function _vttLootRemoveStash(id) {
  _loot.stash = _loot.stash.filter(i => i.id !== id);
  _saveLoot();
}

function _vttLootRemoveLoot(id) {
  _loot.loot = _loot.loot.filter(i => i.id !== id);
  _saveLoot();
}

function _vttLootClear() {
  _loot.loot = [];
  _saveLoot();
}

// ─────────────────────────────────────────────────────────────────────────────
// PICKER OBJET BOUTIQUE — utilise le composant partagé shared/shop-picker.js
// ─────────────────────────────────────────────────────────────────────────────

/** Helper interne : ajoute un objet boutique au stash (avec fusion). */
async function _vttLootAddItemToStash(item, qty, catTemplate) {
  await _ensureLootListener();
  const template = catTemplate || 'classique';
  const prixVente = Math.round((item.prix || 0) * 0.5);
  const base = shopItemToInvEntry(item, { source: 'butin', template, prixVente });
  const entry = { ...base, id: crypto.randomUUID(), qty };
  delete entry.qte;
  delete entry.source;
  const existing = _loot.stash.find(s => s.itemId === item.id);
  if (existing) { existing.qty += qty; } else { _loot.stash.push(entry); }
  await _saveLoot();
}

function _vttLootOpenShop() { openShopPicker({
  title: '🎒 Ajouter à la réserve MJ',
  hint: 'Tu peux enchaîner les ajouts sans fermer cette fenêtre.',
  showQtyInput: true,
  // Map<itemId, qty> exposé en mode "has-like" pour le badge "×N déjà dedans"
  alreadyPicked: () => {
    const map = new Map();
    (_loot.stash || []).forEach(s => { if (s.itemId) map.set(s.itemId, s.qty); });
    // L'API attend un Set#has — on adapte avec un proxy : `has(id)` retourne la qty (truthy)
    return { has: (id) => map.get(id) || false };
  },
  ownedBadgeTitle: 'Déjà dans la réserve',
  onPick: async (item, { qty }) => {
    const { catMap } = await getShopItemById(item.id);
    const template = catMap?.[item.categorieId]?.template || 'classique';
    await _vttLootAddItemToStash(item, qty, template);
    showNotif(`+${qty} "${item.nom}"`, 'success');
  },
}); }

/** MJ : envoie un butin de créature (depuis le panneau token) vers la réserve. */
async function _vttCreatSendLootToStash(beastId, idx, btn) {
  if (!STATE.isAdmin) return;
  const beast = VS.bestiary[beastId];
  const b = beast?.butins?.[idx];
  if (!b?.itemId) { showNotif('Butin invalide', 'error'); return; }

  const { item, catMap } = await getShopItemById(b.itemId);
  if (!item) { showNotif('Objet introuvable en boutique', 'error'); return; }

  // Quantité : extrait le 1er entier du champ libre ("1", "1-3", "2d4"…), défaut 1
  const qMatch = String(b.quantite || '').match(/\d+/);
  const qty = Math.max(1, qMatch ? parseInt(qMatch[0]) : 1);

  const template = catMap?.[item.categorieId]?.template || 'classique';
  await _vttLootAddItemToStash(item, qty, template);

  if (btn) {
    btn.textContent = '✓';
    btn.classList.add('vtt-creat-loot-add--ok');
    setTimeout(() => {
      btn.textContent = '＋';
      btn.classList.remove('vtt-creat-loot-add--ok');
    }, 800);
  }
  showNotif(`+${qty} "${item.nom}" → réserve MJ`, 'success');
}

// Joueur : expand inline sur la ligne pour choisir perso + quantité (pas de 2e modal)
// État courant par item : qty choisie + perso sélectionné (chip)
const _lootTakeState = {}; // { [itemId]: { qty, charId } }

function _vttLootToggleTake(id) {
  const el = document.getElementById(`vtt-take-inline-${id}`);
  if (!el) return;
  document.querySelectorAll('.vtt-loot-take-inline').forEach(o => {
    if (o !== el) { o.style.display = 'none'; o.innerHTML = ''; }
  });
  if (el.style.display === 'block') { el.style.display = 'none'; el.innerHTML = ''; delete _lootTakeState[id]; return; }

  const item = _loot.loot.find(i => i.id === id);
  if (!item) return;
  const uid = STATE.user?.uid;
  const myChars = sortCharactersForDisplay(Object.values(VS.characters).filter(c => c.uid === uid));
  if (!myChars.length) { showNotif('Aucun personnage trouvé', 'error'); return; }

  _lootTakeState[id] = { qty: item.qty, charId: myChars[0].id };
  _renderLootTake(id);
  el.style.display = 'block';
}

function _renderLootTake(id) {
  const el = document.getElementById(`vtt-take-inline-${id}`);
  const item = _loot.loot.find(i => i.id === id);
  const st = _lootTakeState[id];
  if (!el || !item || !st) return;
  const uid = STATE.user?.uid;
  const myChars = sortCharactersForDisplay(Object.values(VS.characters).filter(c => c.uid === uid));
  const max = item.qty;
  st.qty = Math.max(1, Math.min(max, st.qty || 1));

  const charBar = myChars.length > 1 ? `
    <div class="vtt-loot-take-chars">
      ${myChars.map(c => `
        <button class="vtt-loot-char-chip${st.charId === c.id ? ' active' : ''}"
          data-vtt-fn="_vttLootTakeSetChar" data-vtt-args="${id}|${c.id}"
          title="${_esc(c.nom || c.pseudo || '?')}">
          ${_esc(c.nom || c.pseudo || '?')}
        </button>`).join('')}
    </div>` : '';

  el.innerHTML = `
    ${charBar}
    <div class="vtt-loot-take-row">
      <div class="vtt-loot-stepper">
        <button class="vtt-loot-step" data-vtt-fn="_vttLootTakeStep" data-vtt-args="${id}|-1" ${st.qty<=1?'disabled':''}>−</button>
        <span class="vtt-loot-step-val">${st.qty}<span class="vtt-loot-step-max">/${max}</span></span>
        <button class="vtt-loot-step" data-vtt-fn="_vttLootTakeStep" data-vtt-args="${id}|1" ${st.qty>=max?'disabled':''}>+</button>
      </div>
      ${max > 1 ? `<button class="vtt-loot-step-all" data-vtt-fn="_vttLootTakeStep" data-vtt-args="${id}|max" ${st.qty>=max?'disabled':''}>Tout</button>` : ''}
      <button class="vtt-loot-take-cancel" data-vtt-fn="_vttLootToggleTake" data-vtt-args="${id}" title="Annuler">✕</button>
    </div>
    <button class="vtt-loot-take-go" data-vtt-fn="_vttLootConfirmTake" data-vtt-args="${id}">Prendre ×${st.qty}</button>
  `;
}

function _vttLootTakeSetChar(id, charId) {
  if (!_lootTakeState[id]) return;
  _lootTakeState[id].charId = charId;
  _renderLootTake(id);
}
function _vttLootTakeStep(id, delta) {
  const item = _loot.loot.find(i => i.id === id);
  const st = _lootTakeState[id];
  if (!item || !st) return;
  if (delta === 'max') st.qty = item.qty;
  else st.qty = Math.max(1, Math.min(item.qty, (st.qty || 1) + delta));
  _renderLootTake(id);
}

async function _vttLootConfirmTake(id) {
  const item    = _loot.loot.find(i => i.id === id);
  if (!item) return;
  const st      = _lootTakeState[id] || {};
  const charId  = st.charId;
  const qty     = Math.min(item.qty, Math.max(1, st.qty || 1));
  const char    = VS.characters[charId];
  if (!char || !charId) { showNotif('Personnage introuvable', 'error'); return; }

  const inv = Array.isArray(char.inventaire) ? [...char.inventaire] : [];
  // Snapshot canonique loot → inventaire (préserve tous les champs présents et futurs)
  const baseEntry = shopItemToInvEntry(item, { source: 'butin' });
  for (let k = 0; k < qty; k++) inv.push({ ...baseEntry });

  // Réduire ou retirer du butin
  if (item.qty - qty <= 0) {
    _loot.loot = _loot.loot.filter(i => i.id !== id);
  } else {
    item.qty -= qty;
  }

  try {
    await Promise.all([
      updateDoc(_chrRef(charId), { inventaire: inv }),
      _saveLoot(),
    ]);
    char.inventaire = inv;
    delete _lootTakeState[id];
    showNotif(`×${qty} "${item.nom}" → ${_esc(char.nom || char.pseudo || '?')}`, 'success');
  } catch { showNotif('Erreur lors de la prise du butin', 'error'); }
}

// Reset complet de l'état butin au teardown de la VTT (appelé depuis vtt.js).
function _resetLootState() {
  if (_lootUnsub) { _lootUnsub(); _lootUnsub = null; }
  _lootLoading = false; _lootReady = null;
  if (_lootCloseOutside) { document.removeEventListener('mousedown', _lootCloseOutside, true); _lootCloseOutside = null; }
  _loot = { stash: [], loot: [] };
}

export {
  _closeLootPanel,
  _ensureLootListener,
  _initLootSortable,
  _normalizeLoot,
  _renderLootPanel,
  _renderLootTake,
  _resetLootState,
  _saveLoot,
  _vttCreatSendLootToStash,
  _vttLootAddItemToStash,
  _vttLootClear,
  _vttLootConfirmTake,
  _vttLootOpenShop,
  _vttLootRemoveLoot,
  _vttLootRemoveStash,
  _vttLootTakeSetChar,
  _vttLootTakeStep,
  _vttLootToggleTake,
  _vttToggleLoot,
};
