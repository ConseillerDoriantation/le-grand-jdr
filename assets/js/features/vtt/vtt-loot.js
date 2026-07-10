// ══════════════════════════════════════════════════════════════════════════════
// VTT-LOOT.JS — Butin d'aventure (Table de Jeu Virtuelle)
// ══════════════════════════════════════════════════════════════════════════════
// Extrait de vtt.js (Phase 1 du découpage, voir docs/vtt-decomposition.md).
// État local (réserve + butin partagés via adventures/{id}/vtt/loot).
// MJ gère le butin ; les joueurs prennent des objets (→ inventaire perso).
// ══════════════════════════════════════════════════════════════════════════════

import { db, doc, onSnapshot, setDoc, updateDoc } from '../../config/firebase.js';
import { STATE } from '../../core/state.js';
import { VS, aid } from './vtt-state.js';
import { _esc, loadingHtml } from '../../shared/html.js';
import { showNotif } from '../../shared/notifications.js';
import { openShopPicker, getShopItemById } from '../../shared/shop-picker.js';
import { promptModal } from '../../shared/modal.js';
import { shopItemToInvEntry } from '../../shared/inventory-utils.js';
import { favoriteFirst } from '../../shared/char-stats.js';
import { useGold } from '../../shared/economy.js';
import { _chrRef } from './vtt-refs.js';   // ref Firestore perso (leaf)
import { _shortRestPresentUids, _shortRestPresentNames } from './vtt-rest.js'; // quorum présence (réutilisé)

// Quantité « prenable » d'une entrée de butin : objets → qty, or → amount.
const _lootCount = (item) => item?.kind === 'gold' ? (item.amount || 0) : (item.qty || 0);

// Or lâché : nombre brut ("20") ou formule de dés ("5d4", "2d6+3"). Jet inclus.
function _rollGoldFormula(str) {
  const s = String(str ?? '').trim().toLowerCase().replace(/\s+/g, '');
  if (!s) return 0;
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  const m = s.match(/^(\d+)d(\d+)([+-]\d+)?$/);
  if (m) {
    const n = Math.min(100, parseInt(m[1], 10) || 0);
    const f = Math.max(1, parseInt(m[2], 10) || 1);
    const bonus = m[3] ? parseInt(m[3], 10) : 0;
    let total = 0;
    for (let i = 0; i < n; i++) total += 1 + Math.floor(Math.random() * f);
    return Math.max(0, total + bonus);
  }
  const f2 = s.match(/\d+/);
  return f2 ? parseInt(f2[0], 10) : 0;
}

// ── État local butin ────────────────────────────────────────────────
let _loot            = { stash: [], loot: [], voteClaims: {} };
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
  await setDoc(_lootRef(), { stash: _loot.stash, loot: _loot.loot, voteClaims: _loot.voteClaims || {} });
}

function _normalizeLoot(data) {
  _loot = data || {};
  if (!Array.isArray(_loot.stash)) _loot.stash = [];
  if (!Array.isArray(_loot.loot))  _loot.loot  = [];
  if (!_loot.voteClaims || typeof _loot.voteClaims !== 'object') _loot.voteClaims = {};
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
      _checkLootVoteAutoApply();
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
  // Cue sur le déclencheur même panneau fermé : répartition en cours.
  document.getElementById('vtt-loot-trigger')
    ?.classList.toggle('vtt-loot-trigger--voting', _loot.loot.some(i => i.vote?.open));
  if (!panel || panel.dataset.open !== '1') return;
  const mj = STATE.isAdmin;

  if (_lootLoading) {
    panel.innerHTML = loadingHtml('Chargement du butin…', { compact: true });
    return;
  }

  const uid = STATE.user?.uid;
  const myChars = favoriteFirst(Object.values(VS.characters).filter(c => c.uid === uid));
  const _itemRow = (item, zone) => {
    const isGold = item.kind === 'gold';
    const rarColor = { commune:'#9ca3af', peu_commune:'#22c38e', rare:'#4f8cff', tres_rare:'#b47fff', legendaire:'#f59e0b' }[item.rarete] || '#9ca3af';
    const voteOpen = zone === 'loot' && !!item.vote?.open;
    const removeBtn = (zone === 'stash' && mj) ? `<button class="vtt-icon-btn" data-vtt-fn="_vttLootRemoveStash" data-vtt-args="${item.id}" title="Retirer">✕</button>`
      : (zone === 'loot' && mj) ? `<button class="vtt-icon-btn" data-vtt-fn="_vttLootRemoveLoot" data-vtt-args="${item.id}" title="Retirer">✕</button>` : '';
    const takeBtn = (zone === 'loot' && !voteOpen && myChars.length) ? `<button class="vtt-loot-take-btn" data-vtt-fn="_vttLootToggleTake" data-vtt-args="${item.id}">Prendre</button>` : '';
    const distBtn = (zone === 'loot' && !voteOpen && mj && _lootCount(item) > 0) ? `<button class="vtt-loot-dist-btn" data-vtt-fn="_vttLootOpenVote" data-vtt-args="${item.id}" title="Répartir entre les joueurs (vote)">⚖</button>` : '';
    const voteBadge = voteOpen ? `<span class="vtt-loot-voting-badge" title="Répartition en cours">⚖</span>` : '';
    const dragHandle = (mj && !voteOpen) ? `<span class="vtt-loot-drag" title="${zone === 'stash' ? 'Glisser vers le butin' : 'Glisser vers la réserve'}">⠿</span>` : '';
    const inline = zone !== 'loot' ? ''
      : voteOpen ? `<div class="vtt-loot-vote" id="vtt-vote-inline-${item.id}"></div>`
      : `<div class="vtt-loot-take-inline" id="vtt-take-inline-${item.id}" style="display:none"></div>`;
    if (isGold) {
      return `<div class="vtt-loot-row-wrap" data-id="${item.id}">
        <div class="vtt-loot-row vtt-loot-row--gold" data-id="${item.id}">
          ${dragHandle}
          <span class="vtt-loot-gold-ic">🪙</span>
          <span class="vtt-loot-name">Or</span>
          <span class="vtt-loot-qty">${item.amount || 0}</span>
          ${voteBadge}${removeBtn}${distBtn}${takeBtn}
        </div>${inline}
      </div>`;
    }
    return `<div class="vtt-loot-row-wrap" data-id="${item.id}">
      <div class="vtt-loot-row" data-id="${item.id}">
        ${dragHandle}
        <span class="vtt-loot-dot" style="background:${rarColor}"></span>
        <span class="vtt-loot-name">${_esc(item.nom)}</span>
        <span class="vtt-loot-qty">×${item.qty}</span>
        ${voteBadge}${removeBtn}${distBtn}${takeBtn}
      </div>${inline}
    </div>`;
  };

  panel.innerHTML = `
    ${mj ? `
    <div class="vtt-loot-section">
      <div class="vtt-loot-sec-hd">
        <span>🔒 Réserve MJ</span>
        <span class="vtt-loot-sec-actions">
          <button class="vtt-btn-sm" data-vtt-fn="_vttLootAddGoldPrompt" title="Ajouter de l'or (nombre brut ou formule XdY)">🪙 Or</button>
          <button class="vtt-btn-sm" data-vtt-fn="_vttLootOpenShop">＋ Ajouter</button>
        </span>
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
  _loot.loot.forEach(i => { if (i.vote?.open) _renderLootVote(i.id); });
}

function _initLootSortable() {
  const stashEl = document.getElementById('vtt-stash-list');
  const lootEl  = document.getElementById('vtt-loot-list');
  if (!stashEl || !lootEl) return;
  import('../../vendor/sortable.esm.js').then(({ default: Sortable }) => {
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
        const existing = src.kind === 'gold'
          ? _loot.stash.find(i => i.kind === 'gold')
          : _loot.stash.find(i => i.itemId === src.itemId);
        if (existing) {
          if (src.kind === 'gold') existing.amount = (existing.amount || 0) + (src.amount || 0);
          else existing.qty += src.qty;
        } else { _loot.stash.push({ ...src, id: crypto.randomUUID() }); }
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
        const existing = src.kind === 'gold'
          ? _loot.loot.find(i => i.kind === 'gold')
          : _loot.loot.find(i => i.itemId === src.itemId);
        if (existing) {
          if (src.kind === 'gold') existing.amount = (existing.amount || 0) + (src.amount || 0);
          else existing.qty += src.qty;
        } else { _loot.loot.push({ ...src, id: crypto.randomUUID() }); }
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

/** Helper : ajoute de l'or à la réserve MJ (fusionne avec l'entrée or existante). */
async function _vttLootAddGoldToStash(amount) {
  await _ensureLootListener();
  const amt = Math.max(0, Math.floor(Number(amount) || 0));
  if (!amt) return;
  const g = _loot.stash.find(s => s.kind === 'gold');
  if (g) g.amount = (g.amount || 0) + amt;
  else _loot.stash.push({ id: crypto.randomUUID(), kind: 'gold', nom: 'Or', amount: amt });
  await _saveLoot();
}

/** MJ : ajoute de l'or à la réserve à la main (nombre brut ou formule XdY). */
async function _vttLootAddGoldPrompt() {
  if (!STATE.isAdmin) return;
  const val = (await promptModal('Or à ajouter — nombre brut (200) ou formule de dés (5d4, 2d6+10) :', { title: '🪙 Ajouter de l\'or', placeholder: 'ex : 200 ou 5d4' }))?.trim();
  if (!val) return;
  const amt = _rollGoldFormula(val);
  if (!amt) { showNotif('Montant invalide', 'error'); return; }
  await _vttLootAddGoldToStash(amt);
  showNotif(`🪙 +${amt} or → réserve MJ`, 'success');
}

/** MJ : lance l'or d'une créature (formule "5d4"/"20") → réserve MJ. */
async function _vttCreatSendGoldToStash(beastId, btn) {
  if (!STATE.isAdmin) return;
  const formula = VS.bestiary[beastId]?.or;
  if (!formula) { showNotif('Aucun or défini pour cette créature', 'error'); return; }
  const amt = _rollGoldFormula(formula);
  if (!amt) { showNotif('Or lancé = 0', 'warning'); return; }
  await _vttLootAddGoldToStash(amt);
  if (btn) {
    btn.textContent = '✓';
    btn.classList.add('vtt-creat-loot-add--ok');
    setTimeout(() => { btn.textContent = '＋'; btn.classList.remove('vtt-creat-loot-add--ok'); }, 800);
  }
  showNotif(`🪙 ${formula} → ${amt} or → réserve MJ`, 'success');
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
  const myChars = favoriteFirst(Object.values(VS.characters).filter(c => c.uid === uid));
  if (!myChars.length) { showNotif('Aucun personnage trouvé', 'error'); return; }

  _lootTakeState[id] = { qty: _lootCount(item), charId: myChars[0].id };
  _renderLootTake(id);
  el.style.display = 'block';
}

function _renderLootTake(id) {
  const el = document.getElementById(`vtt-take-inline-${id}`);
  const item = _loot.loot.find(i => i.id === id);
  const st = _lootTakeState[id];
  if (!el || !item || !st) return;
  const uid = STATE.user?.uid;
  const myChars = favoriteFirst(Object.values(VS.characters).filter(c => c.uid === uid));
  const isGold = item.kind === 'gold';
  const max = _lootCount(item);
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
    <button class="vtt-loot-take-go" data-vtt-fn="_vttLootConfirmTake" data-vtt-args="${id}">${isGold ? `Prendre ${st.qty} or` : `Prendre ×${st.qty}`}</button>
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
  const max = _lootCount(item);
  if (delta === 'max') st.qty = max;
  else st.qty = Math.max(1, Math.min(max, (st.qty || 1) + delta));
  _renderLootTake(id);
}

async function _vttLootConfirmTake(id) {
  const item    = _loot.loot.find(i => i.id === id);
  if (!item) return;
  const st      = _lootTakeState[id] || {};
  const charId  = st.charId;
  const qty     = Math.min(_lootCount(item), Math.max(1, st.qty || 1));
  const char    = VS.characters[charId];
  if (!char || !charId) { showNotif('Personnage introuvable', 'error'); return; }

  // ── Or : crédite le compte du perso (livre de compte) via la couche economy ──
  if (item.kind === 'gold') {
    const res = await useGold(charId, +qty, 'Butin (VTT)', { charObj: char });
    if (!res?.ok) { showNotif(res?.error || 'Erreur lors de la prise de l\'or', 'error'); return; }
    if ((item.amount || 0) - qty <= 0) _loot.loot = _loot.loot.filter(i => i.id !== id);
    else item.amount -= qty;
    try {
      await _saveLoot();
      delete _lootTakeState[id];
      showNotif(`🪙 +${qty} or → ${_esc(char.nom || char.pseudo || '?')}`, 'success');
    } catch { showNotif('Erreur lors de la prise du butin', 'error'); }
    return;
  }

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

// ═══════════════════════════════════════════════════════════════════
// RÉPARTITION DES DROPS — Vote des joueurs (montant demandé par perso)
// ───────────────────────────────────────────────────────────────────
// Le MJ met un drop « en répartition » (item.vote.open). Chaque joueur
// présent (en ligne + token sur la page active, même quorum que le court
// repos) dépose sa DEMANDE : { qty, charId }. Stockée dans loot.voteClaims
// sous la clé `${itemId}__${uid}` → setDoc(merge) par clé = pas de course
// entre joueurs (l'array `loot` ne porte que le flag open).
// Résolution (client MJ, comme le court repos) :
//   • total demandé ≤ dispo ET tous les présents ont demandé → distribution auto
//   • sur-souscrit (total > dispo) → reste ouvert, les joueurs réduisent ;
//     le MJ peut « Forcer » → partage round-robin équitable plafonné.
// ═══════════════════════════════════════════════════════════════════

const _lootClaimState = {}; // { [itemId]: { qty, charId } } — demande en cours d'édition (local)

const _claimKey = (itemId, uid) => `${itemId}__${uid}`;

// Demandes valides pour un item → { uid: { qty, charId, name } }.
function _lootClaimsFor(itemId) {
  const pre = `${itemId}__`;
  const out = {};
  for (const [k, v] of Object.entries(_loot.voteClaims || {})) {
    if (v && k.startsWith(pre)) out[k.slice(pre.length)] = v;
  }
  return out;
}

// Efface (localement) toutes les demandes d'un item — avant un _saveLoot MJ.
function _clearItemClaims(itemId) {
  const pre = `${itemId}__`;
  for (const k of Object.keys(_loot.voteClaims || {})) if (k.startsWith(pre)) delete _loot.voteClaims[k];
}

function _myLootChars() {
  const uid = STATE.user?.uid;
  // Favori en tête → présélectionné d'office dans les demandes de butin.
  return favoriteFirst(Object.values(VS.characters).filter(c => c.uid === uid));
}

// ── MJ : ouvrir / fermer une répartition ────────────────────────────
async function _vttLootOpenVote(id) {
  if (!STATE.isAdmin) return;
  const item = _loot.loot.find(i => i.id === id);
  if (!item) return;
  if (_lootCount(item) <= 0) { showNotif('Rien à répartir', 'error'); return; }
  _clearItemClaims(id);
  item.vote = { open: true };
  await _saveLoot();
}

async function _vttLootCloseVote(id) {
  if (!STATE.isAdmin) return;
  const item = _loot.loot.find(i => i.id === id);
  if (!item?.vote) return;
  delete item.vote;
  _clearItemClaims(id);
  delete _lootClaimState[id];
  await _saveLoot();
}

// ── Joueur : déposer / modifier / retirer sa demande ────────────────
function _vttLootClaimSetChar(id, charId) {
  const st = _lootClaimState[id] || (_lootClaimState[id] = { qty: 1, charId });
  st.charId = charId;
  _renderLootVote(id);
}

function _vttLootClaimStep(id, delta) {
  const item = _loot.loot.find(i => i.id === id);
  if (!item) return;
  const dispo = _lootCount(item);
  const st = _lootClaimState[id] || (_lootClaimState[id] = { qty: 1, charId: _myLootChars()[0]?.id });
  if (delta === 'max') st.qty = dispo;
  else st.qty = Math.max(0, Math.min(dispo, (st.qty || 0) + delta));
  _renderLootVote(id);
}

function _vttLootClaimEdit(id) {
  const claim = _lootClaimsFor(id)[STATE.user?.uid];
  const chars = _myLootChars();
  _lootClaimState[id] = { qty: claim?.qty ?? 1, charId: claim?.charId || chars[0]?.id };
  _renderLootVote(id);
}

async function _vttLootClaimSubmit(id) {
  const uid = STATE.user?.uid; if (!uid) return;
  const item = _loot.loot.find(i => i.id === id);
  if (!item?.vote?.open) return;
  const st = _lootClaimState[id];
  const dispo = _lootCount(item);
  const qty = Math.max(0, Math.min(dispo, Math.floor(st?.qty ?? 0)));
  const char = VS.characters[st?.charId];
  if (!char) { showNotif('Choisis un personnage', 'error'); return; }
  const key = _claimKey(id, uid);
  const claim = { qty, charId: st.charId, name: char.nom || char.pseudo || '?' };
  if (!_loot.voteClaims) _loot.voteClaims = {};
  _loot.voteClaims[key] = claim;       // optimiste
  delete _lootClaimState[id];
  _renderLootVote(id);
  await _ensureLootListener();
  await setDoc(_lootRef(), { voteClaims: { [key]: claim } }, { merge: true })
    .catch(() => showNotif('Erreur lors de la demande', 'error'));
}

async function _vttLootClaimWithdraw(id) {
  const uid = STATE.user?.uid; if (!uid) return;
  const key = _claimKey(id, uid);
  if (_loot.voteClaims) delete _loot.voteClaims[key];
  delete _lootClaimState[id];
  _renderLootVote(id);
  await _ensureLootListener();
  // merge ne supprime pas une clé → on la met à null (filtrée à la lecture).
  await setDoc(_lootRef(), { voteClaims: { [key]: null } }, { merge: true })
    .catch(() => showNotif('Erreur', 'error'));
}

// ── Rendu du bloc vote (inline sous la ligne de butin) ──────────────
function _renderLootVote(id) {
  const host = document.getElementById(`vtt-vote-inline-${id}`);
  const item = _loot.loot.find(i => i.id === id);
  if (!host || !item?.vote?.open) return;

  const mj      = STATE.isAdmin;
  const uid     = STATE.user?.uid;
  const isGold  = item.kind === 'gold';
  const dispo   = _lootCount(item);
  const present = _shortRestPresentUids();
  const names   = _shortRestPresentNames();
  const claims  = _lootClaimsFor(id);
  const total   = Object.values(claims).reduce((s, c) => s + Math.max(0, c.qty || 0), 0);
  const over    = total > dispo;
  const onPage  = present.includes(uid);
  const myChars = _myLootChars();
  const myClaim = claims[uid];

  const rowUids = [...new Set([...present, ...Object.keys(claims)])];
  const voterList = rowUids.map(u => {
    const c = claims[u];
    return `<div class="vtt-rest-voter">
      <span class="vtt-rest-voter-ic ${c ? 'on' : ''}">${c ? (isGold ? c.qty : `×${c.qty}`) : '⋯'}</span>
      <span class="vtt-rest-voter-name">${_esc(names[u] || c?.name || u.slice(0, 6))}</span>
    </div>`;
  }).join('');

  let mine = '';
  if (onPage && myChars.length) {
    const editing = !!_lootClaimState[id];
    if (myClaim && !editing) {
      mine = `<div class="vtt-loot-claim-done">
        <span>Tu demandes <b>${isGold ? `${myClaim.qty} or` : `×${myClaim.qty}`}</b></span>
        <button class="vtt-loot-step-all" data-vtt-fn="_vttLootClaimEdit" data-vtt-args="${id}">Modifier</button>
        <button class="vtt-loot-take-cancel" data-vtt-fn="_vttLootClaimWithdraw" data-vtt-args="${id}" title="Retirer ma demande">✕</button>
      </div>`;
    } else {
      const st = _lootClaimState[id] || (_lootClaimState[id] = {
        qty: myClaim ? myClaim.qty : Math.min(dispo, 1),
        charId: myClaim?.charId || myChars[0].id,
      });
      st.qty = Math.max(0, Math.min(dispo, st.qty || 0));
      const charBar = myChars.length > 1 ? `
        <div class="vtt-loot-take-chars">
          ${myChars.map(c => `<button class="vtt-loot-char-chip${st.charId === c.id ? ' active' : ''}"
            data-vtt-fn="_vttLootClaimSetChar" data-vtt-args="${id}|${c.id}">${_esc(c.nom || c.pseudo || '?')}</button>`).join('')}
        </div>` : '';
      mine = `${charBar}
        <div class="vtt-loot-take-row">
          <div class="vtt-loot-stepper">
            <button class="vtt-loot-step" data-vtt-fn="_vttLootClaimStep" data-vtt-args="${id}|-1" ${st.qty <= 0 ? 'disabled' : ''}>−</button>
            <span class="vtt-loot-step-val">${st.qty}<span class="vtt-loot-step-max">/${dispo}</span></span>
            <button class="vtt-loot-step" data-vtt-fn="_vttLootClaimStep" data-vtt-args="${id}|1" ${st.qty >= dispo ? 'disabled' : ''}>+</button>
          </div>
          ${dispo > 1 ? `<button class="vtt-loot-step-all" data-vtt-fn="_vttLootClaimStep" data-vtt-args="${id}|max">Tout</button>` : ''}
        </div>
        <button class="vtt-loot-take-go" data-vtt-fn="_vttLootClaimSubmit" data-vtt-args="${id}">${st.qty > 0 ? (isGold ? `Demander ${st.qty} or` : `Demander ×${st.qty}`) : 'Passer (0)'}</button>`;
    }
  } else if (!onPage && !mj) {
    mine = `<div class="vtt-rest-help">Place un token sur la map pour participer à la répartition.</div>`;
  }

  const claimedCount = present.filter(u => claims[u]).length;
  host.innerHTML = `
    <div class="vtt-rest-vote-hd">⚖ Répartition · ${claimedCount}/${present.length || '?'} ont demandé</div>
    <div class="vtt-loot-claim-total${over ? ' over' : ''}">Total demandé <b>${total}</b> / ${dispo} dispo${over ? ' — trop, réduisez' : ''}</div>
    <div class="vtt-rest-voters">${voterList || '<div class="vtt-rest-help">Aucun joueur sur la map.</div>'}</div>
    ${mine}
    ${mj ? `<div class="vtt-loot-vote-mj">
      <button class="vtt-rest-btn vtt-rest-btn--force" data-vtt-fn="_vttLootForceDistribute" data-vtt-args="${id}">⚖ Forcer la répartition</button>
      <button class="vtt-rest-btn vtt-rest-btn--cancel" data-vtt-fn="_vttLootCloseVote" data-vtt-args="${id}">✕ Annuler</button>
    </div>` : ''}
  `;
}

// ── Résolution ──────────────────────────────────────────────────────
async function _vttLootForceDistribute(id) {
  if (!STATE.isAdmin) return;
  await _applyLootDistribution(id, { forced: true });
}

// Round-robin équitable : 1 par 1, plafonné par la demande de chacun.
function _allotFair(entries, dispo) {
  const alloc = {};
  entries.forEach(([u]) => { alloc[u] = 0; });
  let remaining = dispo, progress = true;
  while (remaining > 0 && progress) {
    progress = false;
    for (const [u, c] of entries) {
      if (remaining <= 0) break;
      if (alloc[u] < (c.qty || 0)) { alloc[u]++; remaining--; progress = true; }
    }
  }
  return alloc;
}

// Clôt la répartition : retire l'item si épuisé, sinon nettoie juste le vote.
function _finishDistribution(id, item) {
  _clearItemClaims(id);
  delete _lootClaimState[id];
  if (_lootCount(item) <= 0) _loot.loot = _loot.loot.filter(i => i.id !== id);
  else delete item.vote;
}

let _lootDistributing = false; // verrou ré-entrant (client MJ) → pas de double distribution

async function _applyLootDistribution(id, { forced = false } = {}) {
  if (_lootDistributing) return;
  const item = _loot.loot.find(i => i.id === id);
  if (!item?.vote?.open) return;
  _lootDistributing = true;
  try {
    const dispo = _lootCount(item);
    const claims = _lootClaimsFor(id);
    const entries = Object.entries(claims).filter(([, c]) => (c.qty || 0) > 0 && VS.characters[c.charId]);
    if (!entries.length) { if (forced) await _vttLootCloseVote(id); return; }

    const total = entries.reduce((s, [, c]) => s + Math.max(0, c.qty || 0), 0);
    const alloc = total <= dispo
      ? Object.fromEntries(entries.map(([u, c]) => [u, Math.max(0, c.qty || 0)]))
      : _allotFair(entries, dispo);
    const allocated = Object.values(alloc).reduce((s, n) => s + n, 0);
    if (allocated <= 0) { if (forced) await _vttLootCloseVote(id); return; }

    const summary = [];

    if (item.kind === 'gold') {
      for (const [u, n] of Object.entries(alloc)) {
        if (n <= 0) continue;
        const c = claims[u];
        const res = await useGold(c.charId, +n, 'Butin réparti (VTT)', { charObj: VS.characters[c.charId] });
        if (res?.ok) summary.push(`${_esc(VS.characters[c.charId]?.nom || c.name)}: ${n}`);
      }
      item.amount = Math.max(0, (item.amount || 0) - allocated);
      _finishDistribution(id, item);
      try {
        await _saveLoot();
        showNotif(`🪙 Or réparti — ${summary.join(' · ')}`, 'success');
      } catch { showNotif('Erreur lors de la répartition', 'error'); }
      return;
    }

    const writes = [];
    for (const [u, n] of Object.entries(alloc)) {
      if (n <= 0) continue;
      const c = claims[u];
      const char = VS.characters[c.charId];
      if (!char) continue;
      const inv = Array.isArray(char.inventaire) ? [...char.inventaire] : [];
      const baseEntry = shopItemToInvEntry(item, { source: 'butin' });
      for (let k = 0; k < n; k++) inv.push({ ...baseEntry });
      writes.push(updateDoc(_chrRef(c.charId), { inventaire: inv }).then(() => { char.inventaire = inv; }));
      summary.push(`${_esc(char.nom || c.name)}: ×${n}`);
    }
    item.qty = Math.max(0, (item.qty || 0) - allocated);
    _finishDistribution(id, item);
    try {
      await Promise.all([...writes, _saveLoot()]);
      showNotif(`⚖ "${_esc(item.nom)}" réparti — ${summary.join(' · ')}`, 'success');
    } catch { showNotif('Erreur lors de la répartition', 'error'); }
  } finally {
    _lootDistributing = false;
  }
}

// MJ uniquement : applique dès que tous les présents ont demandé et que ça rentre.
function _checkLootVoteAutoApply() {
  if (!STATE.isAdmin) return;
  const present = _shortRestPresentUids();
  if (!present.length) return;
  for (const item of _loot.loot) {
    if (!item.vote?.open) continue;
    const claims = _lootClaimsFor(item.id);
    if (!present.every(u => claims[u])) continue;          // quorum : tous les présents
    const total = Object.values(claims).reduce((s, c) => s + Math.max(0, c.qty || 0), 0);
    if (total <= 0) { _vttLootCloseVote(item.id); return; } // tout le monde a passé
    if (total > _lootCount(item)) continue;                // sur-souscrit → reste ouvert (option A)
    _applyLootDistribution(item.id, { forced: false });
    return;                                                // une distribution par tick
  }
}

// Reset complet de l'état butin au teardown de la VTT (appelé depuis vtt.js).
function _resetLootState() {
  if (_lootUnsub) { _lootUnsub(); _lootUnsub = null; }
  _lootLoading = false; _lootReady = null;
  if (_lootCloseOutside) { document.removeEventListener('mousedown', _lootCloseOutside, true); _lootCloseOutside = null; }
  for (const k of Object.keys(_lootClaimState)) delete _lootClaimState[k];
  _loot = { stash: [], loot: [], voteClaims: {} };
}

export {
  _checkLootVoteAutoApply,
  _closeLootPanel,
  _ensureLootListener,
  _initLootSortable,
  _normalizeLoot,
  _renderLootPanel,
  _renderLootTake,
  _resetLootState,
  _saveLoot,
  _vttLootClaimEdit,
  _vttLootClaimSetChar,
  _vttLootClaimStep,
  _vttLootClaimSubmit,
  _vttLootClaimWithdraw,
  _vttLootCloseVote,
  _vttLootForceDistribute,
  _vttLootOpenVote,
  _vttCreatSendLootToStash,
  _vttCreatSendGoldToStash,
  _vttLootAddGoldPrompt,
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
