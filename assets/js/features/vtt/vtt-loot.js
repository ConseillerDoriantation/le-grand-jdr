// ══════════════════════════════════════════════════════════════════════════════
// VTT-LOOT.JS — Butin d'aventure (Table de Jeu Virtuelle)
// ══════════════════════════════════════════════════════════════════════════════
// Refonte « 2 colonnes » : Réserve MJ ⇄ Sur la table, bourse d'or dédiée, ajout
// rapide à suggestions, catalogue intégré (Récents / Créatures de la scène / shop)
// avec panier, vue joueur à personnage unique. Modèle Firestore inchangé :
// adventures/{id}/vtt/loot (stash, loot, voteClaims, +log optionnel). L'or reste
// une entrée { kind:'gold', amount } dans stash/loot.
// ══════════════════════════════════════════════════════════════════════════════

import { db, doc, onSnapshot, setDoc, updateDoc } from '../../config/firebase.js';
import { STATE } from '../../core/state.js';
import { VS, aid } from './vtt-state.js';
import { _esc, _norm, loadingHtml } from '../../shared/html.js';
import { showNotif } from '../../shared/notifications.js';
import { getShopItemById, loadShopData } from '../../shared/shop-picker.js';
import { getRarities, loadRarities } from '../../shared/rarity.js';
import { _getRareteNum } from '../shop-item-stats.js';
import { drawCreatureLoot, rollLootFormula } from '../../shared/loot-draw.js';
import { shopItemToInvEntry } from '../../shared/inventory-utils.js';
import { inventoryHistoryPayload, makeInventoryHistoryEntry } from '../../shared/inventory-history.js';
import { favoriteFirst } from '../../shared/char-stats.js';
import { canControlCharacter } from '../../shared/character-state.js';
import { useGold } from '../../shared/economy.js';
import { _showCtxMenu } from './vtt-utils.js';
import { _chrRef } from './vtt-refs.js';   // ref Firestore perso (leaf)
import { _shortRestPresentUids, _shortRestPresentNames } from './vtt-rest.js'; // quorum présence (réutilisé)

// Quantité « prenable » d'une entrée de butin : objets → qty, or → amount.
const _lootCount = (item) => item?.kind === 'gold' ? (item.amount || 0) : (item.qty || 0);

// Or lâché : nombre brut ("20") ou formule de dés ("5d4", "2d6+3"). Jet inclus.
const _rollGoldFormula = (str) => rollLootFormula(str);

// ── Rareté (système numérique par aventure, cf. shared/rarity.js) ───
// Les objets boutique stockent `rarete` en valeur numérique (1..N). On
// résout couleur + nom via les raretés chargées de l'aventure.
let _rarByVal = {};   // valeur numérique → { value, name, color }
function _refreshRarities() { _rarByVal = {}; for (const r of getRarities()) _rarByVal[r.value] = r; }
const _rarColor = (rareteVal) => _rarByVal[_getRareteNum(rareteVal)]?.color || 'var(--text-dim)';
const _rarLabel = (rareteVal) => _rarByVal[_getRareteNum(rareteVal)]?.name || '';
const _fmtPo = (n) => Number(n || 0).toLocaleString('fr-FR');

// ── Sprite SVG (préfixe `il-` pour ne pas entrer en collision avec la Régie) ──
const _LOOT_SPRITE = `<svg id="vtt-loot-sprite" width="0" height="0" style="position:absolute" aria-hidden="true"><defs>
<symbol id="il-x" viewBox="0 0 24 24"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></symbol>
<symbol id="il-search" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.6" y2="16.6"/></symbol>
<symbol id="il-plus" viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></symbol>
<symbol id="il-minus" viewBox="0 0 24 24"><line x1="5" y1="12" x2="19" y2="12"/></symbol>
<symbol id="il-more" viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/><circle cx="19" cy="12" r="1.3" fill="currentColor"/></symbol>
<symbol id="il-lock" viewBox="0 0 24 24"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></symbol>
<symbol id="il-eye" viewBox="0 0 24 24"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></symbol>
<symbol id="il-right" viewBox="0 0 24 24"><line x1="5" y1="12" x2="19" y2="12"/><path d="M13 6l6 6-6 6"/></symbol>
<symbol id="il-left" viewBox="0 0 24 24"><line x1="19" y1="12" x2="5" y2="12"/><path d="M11 6l-6 6 6 6"/></symbol>
<symbol id="il-back" viewBox="0 0 24 24"><path d="M15 6l-6 6 6 6"/></symbol>
<symbol id="il-trash" viewBox="0 0 24 24"><path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M6 7l1 13h10l1-13"/></symbol>
<symbol id="il-coin" viewBox="0 0 24 24"><ellipse cx="12" cy="7" rx="8" ry="3.5"/><path d="M4 7v5c0 1.9 3.6 3.5 8 3.5s8-1.6 8-3.5V7"/><path d="M4 12v5c0 1.9 3.6 3.5 8 3.5s8-1.6 8-3.5v-5"/></symbol>
<symbol id="il-scale" viewBox="0 0 24 24"><line x1="12" y1="3" x2="12" y2="21"/><line x1="7" y1="21" x2="17" y2="21"/><path d="M4 7h16"/><path d="M4 7l-2.5 6a3 3 0 0 0 5 0z"/><path d="M20 7l-2.5 6a3 3 0 0 0 5 0z"/></symbol>
<symbol id="il-dice" viewBox="0 0 24 24"><rect x="3.5" y="3.5" width="17" height="17" rx="3.5"/><circle cx="8.5" cy="8.5" r="1.2" fill="currentColor"/><circle cx="15.5" cy="15.5" r="1.2" fill="currentColor"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/></symbol>
<symbol id="il-swords" viewBox="0 0 24 24"><path d="M14.5 17.5L3 6V3h3l11.5 11.5"/><path d="M13 19l6-6"/><path d="M16 16l4 4"/><path d="M19 21l2-2"/><path d="M9.5 6.5L17 3h3v3l-3.5 7.5"/></symbol>
<symbol id="il-clock" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></symbol>
<symbol id="il-book" viewBox="0 0 24 24"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5z"/><path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5"/></symbol>
<symbol id="il-bag" viewBox="0 0 24 24"><path d="M6 8h12l-1 13H7z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/></symbol>
<symbol id="il-tag" viewBox="0 0 24 24"><path d="M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9z"/><circle cx="8" cy="8" r="1.4"/></symbol>
</defs></svg>`;
function _ensureLootSprite() {
  if (!document.getElementById('vtt-loot-sprite')) {
    const wrap = document.createElement('div');
    wrap.innerHTML = _LOOT_SPRITE;
    document.body.appendChild(wrap.firstElementChild);
  }
}
const _li = (n, cls = '') => `<svg class="vtt-loot-i ${cls}"><use href="#il-${n}"></use></svg>`;

// ── État local butin ────────────────────────────────────────────────
let _loot            = { stash: [], loot: [], voteClaims: {}, log: [] };
let _lootUnsub       = null;
let _lootLoading     = false;
let _lootReady       = null;
let _lootCloseOutside = null;
const _lootRef  = () => doc(db, `adventures/${aid()}/vtt/loot`);

// ── État UI (local, non persisté sauf mention) ──────────────────────
let _lootView   = 'main';     // 'main' | 'cata'
let _lootMe     = null;       // charId choisi une fois pour la vue joueur (sessionStorage)
let _qa         = '';         // texte d'ajout rapide
let _qaOpen     = false;
let _qaIdx      = 0;
let _goldEdit   = false;      // champ d'or inline ouvert (réserve)
let _goldVal    = '';
let _qtyEdit    = null;       // id d'entrée dont le stepper qty est ouvert
let _cSel       = 'recent';   // rail catalogue : 'recent' | 'crea' | 'all' | <categorieId>
let _cQ         = '';         // recherche catalogue
let _cRar       = '';         // filtre rareté catalogue
let _basket     = {};         // { itemId|'gold' : qty } — panier local (non sauvé)
let _creatureDraws = {};      // { beastId : "résumé du tirage" }
let _flash      = null;       // itemId (ou 'gold') à faire clignoter au prochain rendu

// ── Cache boutique (mutualisé avec shop-picker) ─────────────────────
let _shopItems  = [];
let _shopCatMap = {};
let _shopLoaded = false;
async function _ensureShopCache() {
  if (_shopLoaded) return;
  try {
    const [data] = await Promise.all([loadShopData(), loadRarities().catch(() => {})]);
    _shopItems  = data.items || [];
    _shopCatMap = data.catMap || {};
    _refreshRarities();
    _shopLoaded = true;
    _renderLootPanel();
  } catch { /* boutique indisponible → catalogue vide, le reste marche */ }
}
const _shopItem = (id) => _shopItems.find(i => i.id === id) || null;
const _catName  = (item) => item ? (_shopCatMap[item.categorieId]?.nom || '') : '';

// Raretés de l'aventure (couleurs/noms des pastilles) — MJ et joueurs.
let _raritiesReady = false;
async function _ensureRarities() {
  if (_raritiesReady) return;
  try { await loadRarities(); _refreshRarities(); _raritiesReady = true; _renderLootPanel(); }
  catch { /* raretés indisponibles → pastilles neutres */ }
}

// ── Récents (localStorage MJ) ───────────────────────────────────────
const _RECENT_KEY = () => `vtt:lootRecent:${aid() || '_'}`;
function _recentIds() {
  try { const v = JSON.parse(localStorage.getItem(_RECENT_KEY())); return Array.isArray(v) ? v : []; }
  catch { return []; }
}
function _pushRecent(itemId) {
  if (!itemId) return;
  try {
    const next = [itemId, ..._recentIds().filter(x => x !== itemId)].slice(0, 10);
    localStorage.setItem(_RECENT_KEY(), JSON.stringify(next));
  } catch { /* quota / mode privé */ }
}

// ── Journal (dans le doc loot, borné à 20, on en affiche 3) ─────────
function _logLoot(kind, txt) {
  if (!Array.isArray(_loot.log)) _loot.log = [];
  const t = new Date();
  const hhmm = `${t.getHours()}:${String(t.getMinutes()).padStart(2, '0')}`;
  _loot.log.unshift({ t: hhmm, kind, txt });
  _loot.log = _loot.log.slice(0, 20);
}

// ═══════════════════════════════════════════════════════════════════
// PERSISTANCE
// ═══════════════════════════════════════════════════════════════════

async function _saveLoot() {
  await _ensureLootListener();
  await setDoc(_lootRef(), {
    stash: _loot.stash, loot: _loot.loot,
    voteClaims: _loot.voteClaims || {},
    log: Array.isArray(_loot.log) ? _loot.log.slice(0, 20) : [],
  });
}

function _normalizeLoot(data) {
  _loot = data || {};
  if (!Array.isArray(_loot.stash)) _loot.stash = [];
  if (!Array.isArray(_loot.loot))  _loot.loot  = [];
  if (!Array.isArray(_loot.log))   _loot.log   = [];
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

// ═══════════════════════════════════════════════════════════════════
// DÉPLACEMENT RÉSERVE ⇄ TABLE (factorisé : DnD + boutons)
// ═══════════════════════════════════════════════════════════════════

// Déplace une entrée (ou une partie via `qty`) d'une colonne à l'autre, avec
// fusion par itemId (objets) ou cumul (or). Persiste.
function _lootMove(from, id, qty) {
  const to = from === 'stash' ? 'loot' : 'stash';
  const src = _loot[from]?.find(x => x.id === id);
  if (!src || src.vote?.open) return;
  const isGold = src.kind === 'gold';
  const have = isGold ? (src.amount || 0) : (src.qty || 0);
  const n = qty == null ? have : Math.min(Math.max(1, qty), have);
  if (n <= 0) return;

  if (isGold) { src.amount = have - n; if (src.amount <= 0) _loot[from] = _loot[from].filter(x => x !== src); }
  else        { src.qty    = have - n; if (src.qty    <= 0) _loot[from] = _loot[from].filter(x => x !== src); }

  const ex = isGold
    ? _loot[to].find(x => x.kind === 'gold')
    : _loot[to].find(x => x.itemId === src.itemId && !x.vote);
  if (ex) { if (isGold) ex.amount = (ex.amount || 0) + n; else ex.qty += n; }
  else {
    const copy = { ...src, id: crypto.randomUUID() };
    if (isGold) copy.amount = n; else copy.qty = n;
    delete copy.vote;
    _loot[to].push(copy);
  }
  _flash = isGold ? 'gold' : src.itemId;
  if (!isGold) _pushRecent(src.itemId);
  _saveLoot();
}

function _lootMoveGold(from) {
  const g = _loot[from]?.find(x => x.kind === 'gold');
  if (!g || !(g.amount > 0)) return;
  _lootMove(from, g.id);
}

// ═══════════════════════════════════════════════════════════════════
// AJOUT RAPIDE (recherche boutique + suggestions)
// ═══════════════════════════════════════════════════════════════════

// Extrait { q, n } de la saisie : « potion x3 », « potion ×3 » ou « 3 potion ».
function _parseQa(str) {
  const s = String(str || '');
  const m = s.match(/^(.*?)\s*[x×*]\s*(\d+)\s*$/i) || s.match(/^(\d+)\s*[x×]?\s+(.+)$/i);
  if (!m) return { q: s.trim(), n: 1 };
  return /^\d+$/.test(m[1]) ? { q: m[2].trim(), n: +m[1] } : { q: m[1].trim(), n: +m[2] };
}
function _qaResults() {
  const { q } = _parseQa(_qa);
  if (!q) return [];
  const nq = _norm(q);
  return _shopItems
    .filter(i => _norm(i.nom || '').includes(nq))
    .sort((a, b) => _norm(a.nom).indexOf(nq) - _norm(b.nom).indexOf(nq))
    .slice(0, 6);
}
function _hl(name, q) {
  const i = _norm(name).indexOf(_norm(q));
  if (i < 0) return _esc(name);
  return _esc(name.slice(0, i)) + '<mark>' + _esc(name.slice(i, i + q.length)) + '</mark>' + _esc(name.slice(i + q.length));
}

// ═══════════════════════════════════════════════════════════════════
// RENDU
// ═══════════════════════════════════════════════════════════════════

function _renderLootPanel() {
  const panel = document.getElementById('vtt-loot-panel');
  _updateLootTrigger();
  if (!panel || panel.dataset.open !== '1') return;
  _ensureLootSprite();
  const mj = STATE.isAdmin;
  panel.classList.toggle('player', !mj);

  if (_lootLoading) { panel.innerHTML = loadingHtml('Chargement du butin…', { compact: true }); return; }

  // Mémorise défilements + focus/caret des champs.
  const scrolls = {};
  panel.querySelectorAll('[data-sc]').forEach(l => { scrolls[l.dataset.sc] = l.scrollTop; });
  const active = document.activeElement;
  const focusId = active && panel.contains(active) ? active.id : null;
  const caret = focusId ? active.selectionStart : null;

  panel.innerHTML = _lootHeader(mj) + (mj ? (_lootView === 'cata' ? _lootCatalogue() : _lootMainMJ()) : _lootPlayer());

  // Restaure défilements + focus.
  panel.querySelectorAll('[data-sc]').forEach(l => { if (scrolls[l.dataset.sc] != null) l.scrollTop = scrolls[l.dataset.sc]; });
  if (focusId) { const el = document.getElementById(focusId); if (el) { el.focus(); try { el.setSelectionRange(caret, caret); } catch { /* noop */ } } }

  _bindLootInputs();
  if (mj && _lootView === 'main') _initLootSortable();
  // Votes ouverts : rendus dans leur emplacement dédié (logique inchangée).
  _loot.loot.forEach(i => { if (i.vote?.open) _renderLootVote(i.id); });
  _flash = null;
}

function _lootHeader(mj) {
  if (mj && _lootView === 'cata') {
    const bk = _basketCount();
    return `<header class="vtt-loot-hd">
      <button class="vtt-loot-back" data-vtt-fn="_vttLootCataBack">${_li('back')}Butin</button>
      <h2>Catalogue</h2><span class="vtt-loot-grow"></span>
      ${bk ? `<span class="vtt-loot-pill">${bk} dans le panier</span>` : ''}
      <button class="vtt-loot-ib" data-vtt-fn="_vttToggleLoot" data-tip="Fermer">${_li('x')}</button>
    </header>`;
  }
  const n = _loot.loot.length;
  const gold = _lootGold('loot');
  const live = mj && (n || gold)
    ? `<span class="vtt-loot-pill live"><i></i>${n} objet${n > 1 ? 's' : ''}${gold ? ` + ${_fmtPo(gold)} po` : ''} sur la table</span>` : '';
  return `<header class="vtt-loot-hd">
    <h2>${mj ? 'Butin' : 'Butin'}</h2>${live}<span class="vtt-loot-grow"></span>
    <button class="vtt-loot-ib" data-vtt-fn="_vttToggleLoot" data-tip="Fermer · Échap">${_li('x')}</button>
  </header>`;
}

// Or d'une colonne (extrait de l'entrée kind:'gold').
const _lootGold = (zone) => _loot[zone]?.find(e => e.kind === 'gold')?.amount || 0;
const _lootItems = (zone) => (_loot[zone] || []).filter(e => e.kind !== 'gold');
const _lootQtySum = (zone) => _lootItems(zone).reduce((s, e) => s + (e.qty || 0), 0);

function _lootPurse(zone) {
  const mj = STATE.isAdmin;
  const a = _lootGold(zone);
  // Champ d'ajout inline (réserve, MJ).
  if (mj && zone === 'stash' && _goldEdit) {
    const r = _goldVal ? _rollGoldFormula(_goldVal) : null;
    const info = _goldRange(_goldVal);
    return `<div class="vtt-loot-purse"><span class="vtt-loot-coin">${_li('coin')}</span>
      <div class="vtt-loot-gform"><input id="vtt-loot-gval" placeholder="200 ou 5d4+10" value="${_esc(_goldVal)}" autocomplete="off"><small>${info}</small></div>
      <button class="vtt-loot-btn sm" data-vtt-fn="_vttLootGoldOk" ${_goldVal && r != null ? '' : 'disabled'}>Ajouter</button>
      <button class="vtt-loot-ib sm" data-vtt-fn="_vttLootGoldCancel" data-tip="Annuler">${_li('x')}</button></div>`;
  }
  const amt = a
    ? `<b>${_fmtPo(a)}</b><span>pièces d'or</span>`
    : `<b>${zone === 'stash' ? 'Pas d\'or en réserve' : 'Pas d\'or sur la table'}</b>`;
  let acts = '';
  if (mj && zone === 'stash') acts = `<button class="vtt-loot-ib sm" data-vtt-fn="_vttLootGoldEdit" data-tip="Ajouter de l'or (nombre ou dés)">${_li('plus')}</button>${a ? `<button class="vtt-loot-ib sm" data-vtt-fn="_vttLootGoldMove" data-vtt-args="stash" data-tip="Tout poser sur la table">${_li('right')}</button>` : ''}`;
  else if (mj && zone === 'loot' && a) acts = `<button class="vtt-loot-ib sm" data-vtt-fn="_vttLootGoldMove" data-vtt-args="loot" data-tip="Remettre en réserve">${_li('left')}</button><button class="vtt-loot-ib sm" data-vtt-fn="_vttLootGoldSplit" data-tip="Partager en parts égales entre les présents">${_li('scale')}</button>`;
  else if (!mj && zone === 'loot' && a) {
    const g = _loot.loot.find(e => e.kind === 'gold');
    acts = g ? `<button class="vtt-loot-btn sm ghost" data-vtt-fn="_vttLootToggleTake" data-vtt-args="${g.id}">Prendre</button>` : '';
  }
  return `<div class="vtt-loot-purse${a ? '' : ' empty'}${_flash === 'gold' ? ' flash' : ''}"><span class="vtt-loot-coin">${_li('coin')}</span><div class="vtt-loot-amt">${amt}</div>${acts}</div>`;
}
// Fourchette min/max d'une formule d'or (avant validation).
function _goldRange(str) {
  const s = String(str || '').trim().toLowerCase().replace(/\s+/g, '');
  if (!s) return 'nombre ou dés';
  if (/^\d+$/.test(s)) return `${_fmtPo(+s)} po`;
  const m = s.match(/^(\d*)d(\d+)([+-]\d+)?$/);
  if (m) { const n = +(m[1] || 1), f = +m[2], b = m[3] ? +m[3] : 0; return `${n + b}–${n * f + b} po`; }
  const r = s.match(/^(\d+)-(\d+)$/);
  if (r) return `${Math.min(+r[1], +r[2])}–${Math.max(+r[1], +r[2])} po`;
  return 'format invalide';
}

// ── Ligne d'objet (réserve/table) ───────────────────────────────────
function _lootStepperQty(id, v, min, max) {
  return `<span class="vtt-loot-qstep"><button data-vtt-fn="_vttLootQtyStep" data-vtt-args="${id}|-1" ${v <= min ? 'disabled' : ''}>${_li('minus')}</button><span>${v}${max != null ? `<em>/${max}</em>` : ''}</span><button data-vtt-fn="_vttLootQtyStep" data-vtt-args="${id}|1" ${max != null && v >= max ? 'disabled' : ''}>${_li('plus')}</button></span>`;
}
function _lootRow(item, zone) {
  const mj = STATE.isAdmin;
  const voteOpen = zone === 'loot' && !!item.vote?.open;
  const color = _rarColor(item.rarete);
  const catL = _catName(item);
  const sub = [catL, _rarLabel(item.rarete)].filter(Boolean).join(' · ');
  let acts = '';
  if (zone === 'stash') {
    acts = `${item.qty > 1 ? `<button class="vtt-loot-ib sm one go" data-vtt-fn="_vttLootMove1" data-vtt-args="${item.id}" title="En poser un seul">1${_li('right')}</button>` : ''}<button class="vtt-loot-ib sm go" data-vtt-fn="_vttLootMove" data-vtt-args="${item.id}|stash" title="Poser sur la table">${_li('right')}</button><button class="vtt-loot-ib sm danger" data-vtt-fn="_vttLootRemoveStash" data-vtt-args="${item.id}" title="Supprimer">${_li('trash')}</button>`;
  } else if (!voteOpen) {
    acts = `<button class="vtt-loot-ib sm go" data-vtt-fn="_vttLootMove" data-vtt-args="${item.id}|loot" title="Remettre en réserve">${_li('left')}</button><button class="vtt-loot-ib sm go" data-vtt-fn="_vttLootOpenVote" data-vtt-args="${item.id}" title="Répartir (les joueurs demandent)">${_li('scale')}</button><button class="vtt-loot-ib sm danger" data-vtt-fn="_vttLootRemoveLoot" data-vtt-args="${item.id}" title="Supprimer">${_li('trash')}</button>`;
  }
  const qtyCell = voteOpen
    ? `<span class="vtt-loot-pill voting">${_li('scale')}×${item.qty}</span>`
    : (_qtyEdit === item.id && mj
      ? _lootStepperQty(item.id, item.qty, 1)
      : `<button class="vtt-loot-qb" data-vtt-fn="_vttLootQtyEdit" data-vtt-args="${item.id}" ${mj ? '' : 'disabled'} title="Modifier la quantité">×${item.qty}</button>`);
  const inline = zone === 'loot' && voteOpen
    ? `<div class="vtt-loot-vote" id="vtt-vote-inline-${item.id}"></div>`
    : (zone === 'loot' ? `<div class="vtt-loot-take-inline" id="vtt-take-inline-${item.id}" style="display:none"></div>` : '');
  return `<div class="vtt-loot-row-wrap${voteOpen ? ' voting' : ''}${_flash === item.itemId ? ' flash' : ''}" data-id="${item.id}">
    <div class="vtt-loot-row" data-id="${item.id}">
      <i class="vtt-loot-dot" style="background:${color}"></i>
      <span class="vtt-loot-name"><b>${_esc(item.nom)}</b>${sub ? `<small>${_esc(sub)}</small>` : ''}</span>
      <span class="vtt-loot-acts">${acts}</span>${qtyCell}
    </div>${inline}</div>`;
}

// ── Vue MJ principale (2 colonnes) ──────────────────────────────────
function _lootMainMJ() {
  const res = _qaOpen ? _qaResults() : [];
  const { q, n } = _parseQa(_qa);
  const drop = _qaOpen && q ? `<div class="vtt-loot-qa-res">${res.length
    ? res.map((i, k) => `<button class="vtt-loot-qa-row${k === _qaIdx ? ' hi' : ''}" data-vtt-fn="_vttLootQaPick" data-vtt-args="${i.id}"><i class="vtt-loot-dot" style="background:${_rarColor(i.rarete)}"></i><b>${_hl(i.nom, q)}</b><small>${_esc(_catName(i))}</small></button>`).join('')
    : `<div class="vtt-loot-empty" style="padding:14px">Rien dans la boutique pour « ${_esc(q)} »</div>`}
    <div class="vtt-loot-qa-foot"><span><kbd>↵</kbd> ajouter ×${n}</span><span>« potion x3 » pour la quantité</span><span class="vtt-loot-grow"></span><button data-vtt-fn="_vttLootOpenShop">Catalogue</button></div></div>` : '';

  const stashItems = _lootItems('stash');
  const lootItems  = _lootItems('loot');
  const stashHtml = stashItems.length ? stashItems.map(e => _lootRow(e, 'stash')).join('') : `<div class="vtt-loot-empty">${_li('bag')}Réserve vide. Tape un nom ci-dessus ou ouvre le catalogue.</div>`;
  const lootHtml  = lootItems.length ? lootItems.map(e => _lootRow(e, 'loot')).join('') : `<div class="vtt-loot-empty">${_li('eye')}Rien sur la table. Glisse des objets depuis la réserve pour que les joueurs les voient.</div>`;

  return `<div class="vtt-loot-cols">
    <div class="vtt-loot-col stash" data-dz="stash">
      <div class="vtt-loot-col-hd"><span class="ic">${_li('lock')}</span><span class="tt"><b>Réserve MJ</b><small>Invisible aux joueurs</small></span>
        <button class="vtt-loot-btn sm ghost" data-vtt-fn="_vttLootOpenShop">${_li('book')}Catalogue</button>
        <button class="vtt-loot-ib sm" data-vtt-fn="_vttLootStashMenu" data-vtt-args="$event" data-tip="Plus" aria-haspopup="menu">${_li('more')}</button></div>
      <div class="vtt-loot-qadd"><label class="vtt-loot-search">${_li('search')}<input id="vtt-loot-qa" type="search" placeholder="Ajouter un objet…" value="${_esc(_qa)}" autocomplete="off">${_qa && n > 1 ? `<span class="qn">×${n}</span>` : '<kbd>/</kbd>'}</label>${drop}</div>
      ${_lootPurse('stash')}
      <div class="vtt-loot-lbl">Objets · ${_lootQtySum('stash')}<span class="vtt-loot-grow"></span>${stashItems.length ? `<button class="vtt-loot-btn sm ghost xs" data-vtt-fn="_vttLootRevealAll">Tout poser ${_li('right')}</button>` : ''}</div>
      <div class="vtt-loot-list" id="vtt-stash-list" data-sc="stash">${stashHtml}</div>
    </div>
    <div class="vtt-loot-col loot" data-dz="loot">
      <div class="vtt-loot-col-hd"><span class="ic">${_li('eye')}</span><span class="tt"><b>Sur la table</b><small>Visible par les joueurs · ils se servent</small></span>
        <button class="vtt-loot-ib sm" data-vtt-fn="_vttLootTableMenu" data-vtt-args="$event" data-tip="Plus" aria-haspopup="menu">${_li('more')}</button></div>
      ${_lootPurse('loot')}
      <div class="vtt-loot-lbl">Objets · ${_lootQtySum('loot')}</div>
      <div class="vtt-loot-list" id="vtt-loot-list" data-sc="loot">${lootHtml}</div>
      ${_lootLog()}
    </div>
  </div>
  <footer class="vtt-loot-ft"><span><kbd>/</kbd>ajouter</span><span><kbd>Échap</kbd>fermer</span><span class="vtt-loot-grow"></span><span>Glisse un objet d'une colonne à l'autre pour le montrer ou le cacher</span></footer>`;
}

function _lootLog() {
  if (!_loot.log?.length) return '';
  return `<div class="vtt-loot-log"><div class="vtt-loot-lbl" style="padding:4px 6px 3px">Récemment</div>${_loot.log.slice(0, 3).map(l => `<div class="vtt-loot-log-row"><span>${l.txt}</span><time>${_esc(l.t || '')}</time></div>`).join('')}</div>`;
}

// ── Catalogue intégré (rail + liste + panier) ───────────────────────
function _basketCount() { return Object.entries(_basket).filter(([k]) => k !== 'gold').reduce((s, [, n]) => s + n, 0); }
function _inStash(itemId) { return _loot.stash.find(e => e.itemId === itemId)?.qty || 0; }

function _lootCreatures() {
  // Créatures = tokens avec beastId sur la page active, regroupés.
  const groups = {};
  for (const t of Object.values(VS.tokens || {})) {
    if (!t?.beastId) continue;
    const b = VS.bestiary[t.beastId];
    if (!b) continue;
    (groups[t.beastId] ||= { beastId: t.beastId, nom: b.nom || 'Créature', or: b.or || '', butins: b.butins || [], n: 0 }).n++;
  }
  return Object.values(groups);
}

function _lootCatItem(i) {
  const n = _basket[i.id] || 0, own = _inStash(i.id);
  return `<div class="vtt-loot-ci${n ? ' in' : ''}" data-vtt-fn="_vttLootCataAdd" data-vtt-args="${i.id}"><i class="vtt-loot-dot" style="background:${_rarColor(i.rarete)}"></i>
    <span class="vtt-loot-name"><b>${_esc(i.nom)}</b><small>${_esc([_catName(i), _rarLabel(i.rarete)].filter(Boolean).join(' · '))}</small></span>
    <span class="vtt-loot-ci-right">${own ? `<span class="vtt-loot-own" title="Déjà en réserve">×${own} en réserve</span>` : ''}<span class="vtt-loot-pr">${i.prix ? _fmtPo(i.prix) + ' po' : '—'}</span></span>
    ${n ? _lootStepperBk(i.id, n) : `<span class="vtt-loot-add">${_li('plus')}</span>`}</div>`;
}
function _lootStepperBk(id, v) {
  return `<span class="vtt-loot-qstep"><button data-vtt-fn="_vttLootBasketStep" data-vtt-args="${id}|-1">${_li('minus')}</button><span>${v}</span><button data-vtt-fn="_vttLootBasketStep" data-vtt-args="${id}|1">${_li('plus')}</button></span>`;
}
function _lootCreatureCard(c) {
  const d = _creatureDraws[c.beastId];
  const rows = (c.butins || []).map(b => {
    const it = _shopItem(b.itemId);
    const ch = String(b.chance || '100%').trim();
    return `<div class="vtt-loot-cr-row"><i class="vtt-loot-dot" style="background:${_rarColor(it?.rarete)}"></i><span>${_esc(it?.nom || b.nom || 'Objet')}</span><span class="ch${ch === '100%' ? ' sure' : ''}">${_esc(ch)}</span><span class="qq">${_esc(String(b.quantite || '1'))}${c.n > 1 ? ' ×' + c.n : ''}</span></div>`;
  }).join('');
  return `<div class="vtt-loot-cr"><div class="vtt-loot-cr-hd"><span class="av">${_esc((c.nom || '?')[0])}</span><span class="tt"><b>${_esc(c.nom)}${c.n > 1 ? ` ×${c.n}` : ''}</b><small>Sur la carte${c.or ? ` · or ${_esc(c.or)}` : ''}</small></span>
    <button class="vtt-loot-btn sm ghost" data-vtt-fn="_vttLootCreatureAll" data-vtt-args="${c.beastId}" title="Tout ajouter au panier, sans tirage">${_li('plus')}Tout</button>
    <button class="vtt-loot-btn sm" data-vtt-fn="_vttLootCreatureDraw" data-vtt-args="${c.beastId}">${_li('dice')}Tirer le butin</button></div>
    ${rows}${d ? `<div class="vtt-loot-cr-res">Tombé : <b>${_esc(d)}</b> → ajouté au panier</div>` : ''}</div>`;
}

function _lootCatalogue() {
  const q = _norm(_cQ.trim());
  let list = _shopItems, title = '', body;
  if (_cSel === 'crea' && !q) {
    const creatures = _lootCreatures();
    body = `<div class="vtt-loot-lbl">Créatures de la page active</div>` + (creatures.length
      ? creatures.map(_lootCreatureCard).join('')
      : `<div class="vtt-loot-empty">${_li('swords')}Aucune créature du bestiaire sur la page active.</div>`);
  } else {
    if (q) list = _shopItems.filter(i => _norm(i.nom || '').includes(q));
    else if (_cSel === 'recent') list = _recentIds().map(_shopItem).filter(Boolean);
    else if (_cSel !== 'all') list = _shopItems.filter(i => i.categorieId === _cSel);
    if (_cRar !== '' && _cRar != null) list = list.filter(i => _getRareteNum(i.rarete) === Number(_cRar));
    title = q ? `Résultats · ${list.length}` : _cSel === 'recent' ? 'Utilisés récemment' : _cSel === 'all' ? `Tout le catalogue · ${list.length}` : `${_esc(_shopCatMap[_cSel]?.nom || 'Catégorie')} · ${list.length}`;
    body = `<div class="vtt-loot-lbl">${title}</div>` + (list.length ? list.map(_lootCatItem).join('') : `<div class="vtt-loot-empty">Aucun objet ne correspond.</div>`);
  }

  const rp = (id, nm, count, icon) => `<button class="vtt-loot-pl${_cSel === id && !q ? ' sel' : ''}" data-vtt-fn="_vttLootCataSel" data-vtt-args="${id}">${_li(icon)}<span class="nm">${nm}</span><span class="ct">${count}</span></button>`;
  const cats = Object.values(_shopCatMap);
  const rail = `<aside class="vtt-loot-rail"><div class="vtt-loot-rail-hd">Sources</div><div class="vtt-loot-pls">
    ${rp('recent', 'Récents', _recentIds().length, 'clock')}${rp('crea', 'Créatures de la scène', _lootCreatures().length, 'swords')}<div class="vtt-loot-pl-sep"></div>${rp('all', 'Tout le catalogue', _shopItems.length, 'book')}
    ${cats.map(c => rp(c.id, _esc(c.nom || '?'), _shopItems.filter(i => i.categorieId === c.id).length, 'tag')).join('')}</div></aside>`;

  const rars = (_cSel === 'crea' && !q) ? '' : `<div class="vtt-loot-rars"><button class="vtt-loot-chip${!_cRar ? ' on' : ''}" data-vtt-fn="_vttLootCataRar" data-vtt-args="">Toutes raretés</button>${getRarities().map(r => `<button class="vtt-loot-chip${Number(_cRar) === r.value ? ' on' : ''}" data-vtt-fn="_vttLootCataRar" data-vtt-args="${r.value}"><i class="vtt-loot-dot" style="background:${r.color}"></i>${_esc(r.name)}</button>`).join('')}</div>`;

  const bk = Object.entries(_basket).filter(([, n]) => n > 0);
  const chips = bk.map(([k, n]) => `<span class="vtt-loot-bkc">${k === 'gold' ? `${_fmtPo(n)} po` : `${_esc(_shopItem(k)?.nom || 'Objet')} ×${n}`}<button data-vtt-fn="_vttLootBasketRemove" data-vtt-args="${k}" aria-label="Retirer">${_li('x')}</button></span>`).join('');
  const items = _basketCount();
  const basket = bk.length
    ? `<div class="vtt-loot-bk"><b>Panier</b><div class="vtt-loot-bk-chips">${chips}</div></div><button class="vtt-loot-ib sm" data-vtt-fn="_vttLootBasketClear" data-tip="Vider le panier">${_li('trash')}</button><button class="vtt-loot-btn ghost" data-vtt-fn="_vttLootBasketSend" data-vtt-args="loot">${_li('eye')}Poser sur la table</button><button class="vtt-loot-btn" data-vtt-fn="_vttLootBasketSend" data-vtt-args="stash">${_li('lock')}Mettre en réserve${items ? ` (${items})` : ''}</button>`
    : `<span class="vtt-loot-bk-hint">Clique sur les objets pour les ajouter au panier, puis envoie-les d'un coup dans la réserve ou sur la table.</span>`;

  return `<div class="vtt-loot-cata">${rail}
    <div class="vtt-loot-cm"><div class="vtt-loot-cm-hd"><label class="vtt-loot-search">${_li('search')}<input id="vtt-loot-cq" type="search" placeholder="Rechercher dans la boutique…" value="${_esc(_cQ)}" autocomplete="off"><kbd>/</kbd></label></div>
      ${rars}
      <div class="vtt-loot-list" id="vtt-loot-cata-list" data-sc="cata">${body}</div>
      <div class="vtt-loot-basket">${basket}</div>
    </div></div>`;
}

// ── Vue joueur ──────────────────────────────────────────────────────
function _lootPlayer() {
  const myChars = _myLootChars();
  if (_lootMe && !myChars.find(c => c.id === _lootMe)) _lootMe = null;
  if (!_lootMe) _lootMe = myChars[0]?.id || null;

  const who = myChars.length > 1
    ? `<div class="vtt-loot-who"><span>Pour</span><div class="vtt-loot-seg">${myChars.map(c => `<button class="${_lootMe === c.id ? 'on' : ''}" data-vtt-fn="_vttLootSetMe" data-vtt-args="${c.id}">${_esc(c.nom || c.pseudo || '?')}</button>`).join('')}</div></div>`
    : '';

  const gold = _lootGold('loot');
  const goldEntry = _loot.loot.find(e => e.kind === 'gold');
  const items = _lootItems('loot');
  const empty = !items.length && !gold;
  const goldBlock = gold && goldEntry
    ? _lootPurse('loot') + `<div class="vtt-loot-take-inline" id="vtt-take-inline-${goldEntry.id}" style="display:none"></div>`
    : '';
  const rows = items.map(e => {
    const voteOpen = !!e.vote?.open;
    const right = voteOpen
      ? `<span class="vtt-loot-pill voting">${_li('scale')}×${e.qty}</span>`
      : `<span class="vtt-loot-plq"><span class="vtt-loot-qb">×${e.qty}</span><button class="vtt-loot-ib sm" data-vtt-fn="_vttLootOpenVote" data-vtt-args="${e.id}" title="Répartir entre les joueurs">${_li('scale')}</button><button class="vtt-loot-btn sm ghost" data-vtt-fn="_vttLootToggleTake" data-vtt-args="${e.id}">Prendre</button></span>`;
    const inline = voteOpen ? `<div class="vtt-loot-vote" id="vtt-vote-inline-${e.id}"></div>` : `<div class="vtt-loot-take-inline" id="vtt-take-inline-${e.id}" style="display:none"></div>`;
    return `<div class="vtt-loot-row-wrap${voteOpen ? ' voting' : ''}" data-id="${e.id}"><div class="vtt-loot-row pl-it"><i class="vtt-loot-dot" style="background:${_rarColor(e.rarete)}"></i><span class="vtt-loot-name"><b>${_esc(e.nom)}</b><small>${_esc([_catName(e), _rarLabel(e.rarete)].filter(Boolean).join(' · '))}</small></span><span class="vtt-loot-acts"></span>${right}</div>${inline}</div>`;
  }).join('');

  const body = empty
    ? `<div class="vtt-loot-empty">${_li('bag')}Le MJ n'a encore rien posé sur la table.</div>`
    : goldBlock + rows;
  return `${who}<div class="vtt-loot-list" data-sc="ploot">${body}</div>${_lootLog()}`;
}

// ── Bouton de la barre de session (badge + violet si vote) ──────────
function _updateLootTrigger() {
  const trg = document.getElementById('vtt-loot-trigger');
  if (!trg) return;
  const voting = _loot.loot.some(i => i.vote?.open);
  trg.classList.toggle('vtt-loot-trigger--voting', voting);
  const n = _loot.loot.length;
  let badge = trg.querySelector('.vtt-loot-badge');
  if (n > 0) {
    if (!badge) { badge = document.createElement('span'); badge.className = 'vtt-loot-badge'; trg.appendChild(badge); }
    badge.textContent = n;
    badge.classList.toggle('vote', voting);
  } else if (badge) { badge.remove(); }
}

// ── Liaisons d'inputs (ajout rapide, or, recherche catalogue) ───────
function _bindLootInputs() {
  const qa = document.getElementById('vtt-loot-qa');
  if (qa) {
    qa.oninput = e => { _qa = e.target.value; _qaIdx = 0; _qaOpen = true; _renderLootPanel(); };
    qa.onfocus = () => { if (!_qaOpen && _qa) { _qaOpen = true; _renderLootPanel(); } };
    qa.onkeydown = e => {
      const r = _qaResults();
      if (e.key === 'ArrowDown') { e.preventDefault(); _qaIdx = Math.min(r.length - 1, _qaIdx + 1); _renderLootPanel(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); _qaIdx = Math.max(0, _qaIdx - 1); _renderLootPanel(); }
      else if (e.key === 'Enter' && r[_qaIdx]) { e.preventDefault(); _vttLootQaPick(r[_qaIdx].id); }
      else if (e.key === 'Escape') { _qaOpen = false; _qa = ''; _renderLootPanel(); e.stopPropagation(); }
    };
  }
  const g = document.getElementById('vtt-loot-gval');
  if (g) {
    g.oninput = e => { _goldVal = e.target.value; const s = document.querySelector('.vtt-loot-gform small'); if (s) s.textContent = _goldRange(_goldVal); const ok = document.querySelector('[data-vtt-fn="_vttLootGoldOk"]'); if (ok) ok.disabled = !(_goldVal && _rollGoldFormula(_goldVal) != null); };
    g.onkeydown = e => { if (e.key === 'Enter') _vttLootGoldOk(); else if (e.key === 'Escape') { e.stopPropagation(); _vttLootGoldCancel(); } };
  }
  const cq = document.getElementById('vtt-loot-cq');
  if (cq) cq.oninput = e => { _cQ = e.target.value; _renderLootPanel(); };
}

// ═══════════════════════════════════════════════════════════════════
// SORTABLE (glisser toute la ligne, réserve ⇄ table)
// ═══════════════════════════════════════════════════════════════════

let _lootSortables = [];
function _initLootSortable() {
  _lootSortables.forEach(s => { try { s.destroy(); } catch { /* noop */ } });
  _lootSortables = [];
  const stashEl = document.getElementById('vtt-stash-list');
  const lootEl  = document.getElementById('vtt-loot-list');
  if (!stashEl || !lootEl) return;
  import('../../vendor/sortable.esm.js').then(({ default: Sortable }) => {
    const opts = {
      group: 'vtt-loot', sort: false, animation: 150,
      forceFallback: true, fallbackOnBody: true,
      draggable: '.vtt-loot-row-wrap:not(.voting)',
      ghostClass: 'vtt-loot-ghost', fallbackClass: 'vtt-loot-drag-chip',
      onStart: () => document.getElementById('vtt-loot-panel')?.classList.add('dragging'),
      onEnd:   () => document.getElementById('vtt-loot-panel')?.classList.remove('dragging'),
    };
    _lootSortables.push(Sortable.create(stashEl, { ...opts, onAdd(evt) { const id = evt.item.dataset.id; evt.item.remove(); _lootMove('loot', id); } }));
    _lootSortables.push(Sortable.create(lootEl,  { ...opts, onAdd(evt) { const id = evt.item.dataset.id; evt.item.remove(); _lootMove('stash', id); } }));
  });
}

// ═══════════════════════════════════════════════════════════════════
// OUVERTURE / FERMETURE DU PANNEAU
// ═══════════════════════════════════════════════════════════════════

function _closeLootPanel() {
  const panel = document.getElementById('vtt-loot-panel');
  const btn   = document.getElementById('vtt-loot-trigger');
  if (panel) { panel.dataset.open = '0'; panel.style.display = 'none'; panel.setAttribute('aria-hidden', 'true'); }
  btn?.classList.remove('active');
  btn?.setAttribute('aria-expanded', 'false');
  if (_lootCloseOutside) { document.removeEventListener('mousedown', _lootCloseOutside, true); _lootCloseOutside = null; }
  _lootSortables.forEach(s => { try { s.destroy(); } catch { /* noop */ } });
  _lootSortables = [];
}

function _vttToggleLoot() {
  const panel = document.getElementById('vtt-loot-panel');
  if (!panel) return;
  if (panel.dataset.open === '1') { _closeLootPanel(); return; }
  panel.dataset.open = '1';
  panel.style.display = 'flex';
  panel.setAttribute('aria-hidden', 'false');
  const trigger = document.getElementById('vtt-loot-trigger');
  trigger?.classList.add('active');
  trigger?.setAttribute('aria-expanded', 'true');
  _lootView = 'main';
  void _ensureLootListener();
  void _ensureRarities();
  if (STATE.isAdmin) void _ensureShopCache();
  _renderLootPanel();
  _lootCloseOutside = (e) => {
    const float = document.querySelector('.vtt-loot-float');
    const ctx = document.getElementById('vtt-ctx-menu');
    if (float && !float.contains(e.target) && !ctx?.contains(e.target)) _closeLootPanel();
  };
  document.addEventListener('mousedown', _lootCloseOutside, true);
}

// ═══════════════════════════════════════════════════════════════════
// ACTIONS MJ — déplacements, quantité, or, menus
// ═══════════════════════════════════════════════════════════════════

function _vttLootMove(id, from) { _lootMove(from, id); }
function _vttLootMove1(id) { _lootMove('stash', id, 1); }

function _vttLootRemoveStash(id) { _loot.stash = _loot.stash.filter(i => i.id !== id); _saveLoot(); }
function _vttLootRemoveLoot(id)  { _loot.loot  = _loot.loot.filter(i => i.id !== id);  _saveLoot(); }
function _vttLootClear() { _loot.loot = []; _saveLoot(); }

function _vttLootQtyEdit(id) { _qtyEdit = _qtyEdit === id ? null : id; _renderLootPanel(); }
function _vttLootQtyStep(id, delta) {
  const e = _loot.stash.find(x => x.id === id) || _loot.loot.find(x => x.id === id);
  if (!e || e.kind === 'gold' || e.vote?.open) return;
  e.qty = Math.max(1, (e.qty || 1) + (+delta));
  _saveLoot();
}

function _vttLootRevealAll() {
  const items = _lootItems('stash');
  const gold = _loot.stash.find(e => e.kind === 'gold');
  [...items, ...(gold ? [gold] : [])].forEach(e => _lootMerge('loot', e));
  _loot.stash = [];
  _flash = null;
  _saveLoot();
}

// Fusionne une entrée dans une colonne (helper pour reveal/backall). Ne persiste pas.
function _lootMerge(to, src) {
  const isGold = src.kind === 'gold';
  const ex = isGold ? _loot[to].find(x => x.kind === 'gold') : _loot[to].find(x => x.itemId === src.itemId && !x.vote);
  if (ex) { if (isGold) ex.amount = (ex.amount || 0) + (src.amount || 0); else ex.qty += (src.qty || 0); }
  else { const copy = { ...src, id: crypto.randomUUID() }; delete copy.vote; _loot[to].push(copy); }
}

// ── Or : ajout inline, déplacement, partage ─────────────────────────
function _vttLootGoldEdit() { if (!STATE.isAdmin) return; _goldEdit = true; _goldVal = ''; _renderLootPanel(); setTimeout(() => document.getElementById('vtt-loot-gval')?.focus(), 20); }
function _vttLootGoldCancel() { _goldEdit = false; _goldVal = ''; _renderLootPanel(); }
function _vttLootGoldOk() {
  if (!STATE.isAdmin) return;
  const amt = _rollGoldFormula(_goldVal);
  if (!amt) { showNotif('Montant invalide', 'error'); return; }
  _goldEdit = false; _goldVal = '';
  _vttLootAddGoldToStash(amt);
  showNotif(`🪙 +${amt} or → réserve`, 'success');
}
function _vttLootGoldMove(from) { _lootMoveGold(from); }
async function _vttLootGoldSplit() {
  if (!STATE.isAdmin) return;
  const g = _loot.loot.find(e => e.kind === 'gold');
  const amount = g?.amount || 0;
  if (amount <= 0) { showNotif('Pas d\'or à partager', 'error'); return; }
  const present = _shortRestPresentUids();
  const chars = present.map(u => _presentCharForUid(u)).filter(Boolean);
  if (!chars.length) { showNotif('Aucun joueur présent (token sur la page)', 'error'); return; }
  const part = Math.floor(amount / chars.length);
  if (part <= 0) { showNotif('Trop peu d\'or pour partager', 'warning'); return; }
  const rest = amount - part * chars.length;
  const summary = [];
  for (const ch of chars) {
    const res = await useGold(ch.id, +part, 'Butin partagé (VTT)', { charObj: ch });
    if (res?.ok) summary.push(_esc(ch.nom || ch.pseudo || '?'));
  }
  g.amount = rest;
  if (g.amount <= 0) _loot.loot = _loot.loot.filter(e => e !== g);
  _logLoot('split', `<b>${part} po</b> chacun · ${summary.join(', ')}`);
  try { await _saveLoot(); showNotif(`${part} po chacun${rest ? ` · ${rest} po restent sur la table` : ''}`, 'success'); }
  catch { showNotif('Erreur lors du partage', 'error'); }
}
// Perso « présent » d'un uid (1er perso contrôlé avec un token sur la page).
function _presentCharForUid(uid) {
  const chars = Object.values(VS.characters).filter(c => canControlCharacter(c, uid));
  const withToken = chars.find(c => Object.values(VS.tokens || {}).some(t => t.characterId === c.id));
  return withToken || chars[0] || null;
}

// ── Menus contextuels (⋯) ───────────────────────────────────────────
function _vttLootStashMenu(e) {
  if (!STATE.isAdmin) return;
  _showCtxMenu(e.clientX, e.clientY, [
    { label: `${_li('trash')}Vider la réserve`, fn: () => { _loot.stash = []; _saveLoot(); } },
  ]);
}
function _vttLootTableMenu(e) {
  if (!STATE.isAdmin) return;
  _showCtxMenu(e.clientX, e.clientY, [
    { label: `${_li('left')}Tout remettre en réserve`, fn: () => {
      _loot.loot.filter(x => !x.vote?.open).forEach(x => { _loot.loot = _loot.loot.filter(y => y !== x); _lootMerge('stash', x); });
      _saveLoot();
    } },
    '---',
    { label: `<span style="color:var(--crimson)">${_li('trash')}Vider la table</span>`, fn: () => _vttLootClear() },
  ]);
}

// ── Ajout rapide ────────────────────────────────────────────────────
async function _vttLootQaPick(itemId) {
  const item = _shopItem(itemId);
  if (!item) return;
  const { n } = _parseQa(_qa);
  const catTemplate = _shopCatMap[item.categorieId]?.template || 'classique';
  await _vttLootAddItemToStash(item, Math.max(1, n), catTemplate);
  _pushRecent(itemId);
  _qa = ''; _qaOpen = false; _qaIdx = 0;
  _flash = itemId;
  _renderLootPanel();
  showNotif(`+${Math.max(1, n)} « ${item.nom} » → réserve`, 'success');
  setTimeout(() => document.getElementById('vtt-loot-qa')?.focus(), 20);
}

// ═══════════════════════════════════════════════════════════════════
// CATALOGUE (intégré au panneau — remplace la modale dans le VTT)
// ═══════════════════════════════════════════════════════════════════

function _vttLootOpenShop() {   // ← ouvre le catalogue intégré (plus de modale)
  if (!STATE.isAdmin) return;
  _lootView = 'cata';
  _qaOpen = false;
  if (_qa) { _cQ = _parseQa(_qa).q; _qa = ''; }
  void _ensureShopCache();
  _renderLootPanel();
}
function _vttLootCataBack() { _lootView = 'main'; _renderLootPanel(); }
function _vttLootCataSel(id) { _cSel = id; _cQ = ''; _cRar = ''; _renderLootPanel(); }
function _vttLootCataRar(id = '') { _cRar = id || ''; _renderLootPanel(); }
function _vttLootCataAdd(itemId) {
  // Le stepper interne a son propre data-vtt-fn (dispatcher = plus proche) :
  // ce handler ne se déclenche que sur le corps de la ligne.
  _basket[itemId] = (_basket[itemId] || 0) + 1;
  _renderLootPanel();
}
function _vttLootBasketStep(itemId, delta) {
  _basket[itemId] = Math.max(0, (_basket[itemId] || 0) + (+delta));
  if (!_basket[itemId]) delete _basket[itemId];
  _renderLootPanel();
}
function _vttLootBasketRemove(itemId) { delete _basket[itemId]; _renderLootPanel(); }
function _vttLootBasketClear() { _basket = {}; _renderLootPanel(); }

async function _vttLootBasketSend(zone) {
  if (!STATE.isAdmin) return;
  const entries = Object.entries(_basket).filter(([, n]) => n > 0);
  if (!entries.length) return;
  let added = 0;
  for (const [key, n] of entries) {
    if (key === 'gold') {
      if (zone === 'stash') await _vttLootAddGoldToStash(n);
      else { await _ensureLootListener(); const g = _loot.loot.find(e => e.kind === 'gold'); if (g) g.amount = (g.amount || 0) + n; else _loot.loot.push({ id: crypto.randomUUID(), kind: 'gold', nom: 'Or', amount: n }); }
      continue;
    }
    const item = _shopItem(key);
    if (!item) continue;
    const tpl = _shopCatMap[item.categorieId]?.template || 'classique';
    if (zone === 'stash') { await _vttLootAddItemToStash(item, n, tpl); }
    else {
      // Directement sur la table : construit l'entrée puis fusionne dans loot.
      await _ensureLootListener();
      const prixVente = Math.round((item.prix || 0) * 0.5);
      const base = shopItemToInvEntry(item, { source: 'butin', template: tpl, prixVente });
      const entry = { ...base, id: crypto.randomUUID(), qty: n };
      delete entry.qte; delete entry.source;
      _lootMerge('loot', entry);
      await _saveLoot();
    }
    _pushRecent(key);
    added += n;
  }
  _basket = {}; _creatureDraws = {}; _lootView = 'main';
  _renderLootPanel();
  showNotif(zone === 'loot' ? `Posé sur la table (${added} objet${added > 1 ? 's' : ''})` : `Ajouté à la réserve (${added} objet${added > 1 ? 's' : ''})`, 'success');
}

// ── Créatures de la scène → panier ──────────────────────────────────
function _vttLootCreatureAll(beastId) {
  const c = _lootCreatures().find(x => x.beastId === beastId);
  if (!c) return;
  const { items, gold } = drawCreatureLoot(c, { draw: false, count: c.n });
  items.forEach(it => { _basket[it.itemId] = (_basket[it.itemId] || 0) + it.qty; });
  if (gold) _basket.gold = (_basket.gold || 0) + gold;
  _renderLootPanel();
}
function _vttLootCreatureDraw(beastId) {
  const c = _lootCreatures().find(x => x.beastId === beastId);
  if (!c) return;
  const { items, gold } = drawCreatureLoot(c, { draw: true, count: c.n });
  items.forEach(it => { _basket[it.itemId] = (_basket[it.itemId] || 0) + it.qty; });
  if (gold) _basket.gold = (_basket.gold || 0) + gold;
  const parts = items.map(it => `${_esc(_shopItem(it.itemId)?.nom || it.nom || 'Objet')} ×${it.qty}`);
  if (gold) parts.push(`${gold} po`);
  _creatureDraws[beastId] = parts.length ? parts.join(', ') : 'rien';
  _renderLootPanel();
}

// ── Vue joueur : personnage unique ──────────────────────────────────
function _vttLootSetMe(charId) {
  _lootMe = charId;
  try { sessionStorage.setItem(`vtt:lootMe:${aid() || '_'}`, charId); } catch { /* noop */ }
  _renderLootPanel();
}

// ─────────────────────────────────────────────────────────────────────────────
// AJOUT D'OBJET / D'OR À LA RÉSERVE (helpers réutilisés, inchangés)
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

/** MJ : envoie un butin de créature (depuis le panneau token) vers la réserve. */
async function _vttCreatSendLootToStash(beastId, idx, btn) {
  if (!STATE.isAdmin) return;
  const beast = VS.bestiary[beastId];
  const b = beast?.butins?.[idx];
  if (!b?.itemId) { showNotif('Butin invalide', 'error'); return; }

  const { item, catMap } = await getShopItemById(b.itemId);
  if (!item) { showNotif('Objet introuvable en boutique', 'error'); return; }

  const qMatch = String(b.quantite || '').match(/\d+/);
  const qty = Math.max(1, qMatch ? parseInt(qMatch[0]) : 1);

  const template = catMap?.[item.categorieId]?.template || 'classique';
  await _vttLootAddItemToStash(item, qty, template);

  if (btn) {
    btn.textContent = '✓';
    btn.classList.add('vtt-creat-loot-add--ok');
    setTimeout(() => { btn.textContent = '＋'; btn.classList.remove('vtt-creat-loot-add--ok'); }, 800);
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

// ═══════════════════════════════════════════════════════════════════
// PRISE PAR LE JOUEUR (inline sur la ligne) — perso = bandeau « Pour »
// ═══════════════════════════════════════════════════════════════════

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
  const myChars = _myLootChars();
  if (!myChars.length) { showNotif('Aucun personnage trouvé', 'error'); return; }
  if (_lootMe && !myChars.find(c => c.id === _lootMe)) _lootMe = null;
  const charId = _lootMe || myChars[0].id;
  _lootMe = charId;

  _lootTakeState[id] = { qty: _lootCount(item), charId };
  _renderLootTake(id);
  el.style.display = 'block';
}

function _renderLootTake(id) {
  const el = document.getElementById(`vtt-take-inline-${id}`);
  const item = _loot.loot.find(i => i.id === id);
  const st = _lootTakeState[id];
  if (!el || !item || !st) return;
  const isGold = item.kind === 'gold';
  const max = _lootCount(item);
  st.qty = Math.max(1, Math.min(max, st.qty || 1));

  el.innerHTML = `
    <div class="vtt-loot-take-row">
      <div class="vtt-loot-stepper">
        <button class="vtt-loot-step" data-vtt-fn="_vttLootTakeStep" data-vtt-args="${id}|-1" ${st.qty <= 1 ? 'disabled' : ''}>−</button>
        <span class="vtt-loot-step-val">${st.qty}<span class="vtt-loot-step-max">/${max}</span></span>
        <button class="vtt-loot-step" data-vtt-fn="_vttLootTakeStep" data-vtt-args="${id}|1" ${st.qty >= max ? 'disabled' : ''}>+</button>
      </div>
      ${max > 1 ? `<button class="vtt-loot-step-all" data-vtt-fn="_vttLootTakeStep" data-vtt-args="${id}|max" ${st.qty >= max ? 'disabled' : ''}>Tout</button>` : ''}
      <span class="vtt-loot-grow"></span>
      <button class="vtt-loot-take-cancel" data-vtt-fn="_vttLootToggleTake" data-vtt-args="${id}" title="Annuler">✕</button>
      <button class="vtt-loot-take-go" data-vtt-fn="_vttLootConfirmTake" data-vtt-args="${id}">${isGold ? `Prendre ${st.qty} po` : `Prendre ×${st.qty}`}</button>
    </div>`;
}

function _vttLootTakeSetChar(id, charId) {
  if (!_lootTakeState[id]) return;
  _lootTakeState[id].charId = charId;
  _lootMe = charId;
  _renderLootTake(id);
}
function _vttLootTakeStep(id, delta) {
  const item = _loot.loot.find(i => i.id === id);
  const st = _lootTakeState[id];
  if (!item || !st) return;
  const max = _lootCount(item);
  if (delta === 'max') st.qty = max;
  else st.qty = Math.max(1, Math.min(max, (st.qty || 1) + (+delta)));
  _renderLootTake(id);
}

async function _vttLootConfirmTake(id) {
  const item    = _loot.loot.find(i => i.id === id);
  if (!item) return;
  const st      = _lootTakeState[id] || {};
  const charId  = st.charId || _lootMe;
  const qty     = Math.min(_lootCount(item), Math.max(1, st.qty || 1));
  const char    = VS.characters[charId];
  if (!char || !charId) { showNotif('Personnage introuvable', 'error'); return; }

  // ── Or : crédite le compte du perso (livre de compte) via la couche economy ──
  if (item.kind === 'gold') {
    const res = await useGold(charId, +qty, 'Butin (VTT)', { charObj: char });
    if (!res?.ok) { showNotif(res?.error || 'Erreur lors de la prise de l\'or', 'error'); return; }
    if ((item.amount || 0) - qty <= 0) _loot.loot = _loot.loot.filter(i => i.id !== id);
    else item.amount -= qty;
    _logLoot('take', `<b>${_esc(char.nom || char.pseudo || '?')}</b> a pris ${qty} po`);
    try {
      await _saveLoot();
      delete _lootTakeState[id];
      showNotif(`🪙 +${qty} or → ${_esc(char.nom || char.pseudo || '?')}`, 'success');
    } catch { showNotif('Erreur lors de la prise du butin', 'error'); }
    return;
  }

  const inv = Array.isArray(char.inventaire) ? [...char.inventaire] : [];
  const baseEntry = shopItemToInvEntry(item, { source: 'butin' });
  for (let k = 0; k < qty; k++) inv.push({ ...baseEntry });
  const historyPatch = inventoryHistoryPayload(char, makeInventoryHistoryEntry('add', baseEntry, qty, {
    actorUid: STATE.user?.uid || '',
    actorName: STATE.user?.pseudo || STATE.user?.displayName || STATE.user?.email || '',
    source: 'Butin VTT',
  }));

  if (item.qty - qty <= 0) _loot.loot = _loot.loot.filter(i => i.id !== id);
  else item.qty -= qty;
  _logLoot('take', `<b>${_esc(char.nom || char.pseudo || '?')}</b> a pris ${_esc(item.nom)} ×${qty}`);

  try {
    await Promise.all([
      updateDoc(_chrRef(charId), { inventaire: inv, ...historyPatch }),
      _saveLoot(),
    ]);
    char.inventaire = inv;
    char.inventoryHistory = historyPatch.inventoryHistory;
    delete _lootTakeState[id];
    showNotif(`×${qty} "${item.nom}" → ${_esc(char.nom || char.pseudo || '?')}`, 'success');
  } catch { showNotif('Erreur lors de la prise du butin', 'error'); }
}

// ═══════════════════════════════════════════════════════════════════
// RÉPARTITION DES DROPS — Vote des joueurs (INCHANGÉ)
// ═══════════════════════════════════════════════════════════════════

const _lootClaimState = {};
const _claimKey = (itemId, uid) => `${itemId}__${uid}`;

function _lootClaimsFor(itemId) {
  const pre = `${itemId}__`;
  const out = {};
  for (const [k, v] of Object.entries(_loot.voteClaims || {})) {
    if (v && k.startsWith(pre)) out[k.slice(pre.length)] = v;
  }
  return out;
}

function _clearItemClaims(itemId) {
  const pre = `${itemId}__`;
  for (const k of Object.keys(_loot.voteClaims || {})) if (k.startsWith(pre)) delete _loot.voteClaims[k];
}

function _myLootChars() {
  const uid = STATE.user?.uid;
  return favoriteFirst(Object.values(VS.characters).filter(c => canControlCharacter(c, uid)));
}

// Ouvrir une répartition : MJ, OU un joueur qui veut partager un objet contesté
// (les règles Firestore autorisent tous les membres à écrire vtt/loot). Le reste
// du vote (quorum, auto-application, forçage MJ) est inchangé.
async function _vttLootOpenVote(id) {
  const item = _loot.loot.find(i => i.id === id);
  if (!item) return;
  if (item.vote?.open) return;                 // déjà en répartition
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

function _vttLootClaimSetChar(id, charId) {
  const st = _lootClaimState[id] || (_lootClaimState[id] = { qty: 1, charId });
  st.charId = charId;
  _lootMe = charId;
  _renderLootVote(id);
}

function _vttLootClaimStep(id, delta) {
  const item = _loot.loot.find(i => i.id === id);
  if (!item) return;
  const dispo = _lootCount(item);
  const st = _lootClaimState[id] || (_lootClaimState[id] = { qty: 1, charId: _lootMe || _myLootChars()[0]?.id });
  if (delta === 'max') st.qty = dispo;
  else st.qty = Math.max(0, Math.min(dispo, (st.qty || 0) + (+delta)));
  _renderLootVote(id);
}

function _vttLootClaimEdit(id) {
  const claim = _lootClaimsFor(id)[STATE.user?.uid];
  const chars = _myLootChars();
  _lootClaimState[id] = { qty: claim?.qty ?? 1, charId: claim?.charId || _lootMe || chars[0]?.id };
  _renderLootVote(id);
}

async function _vttLootClaimSubmit(id) {
  const uid = STATE.user?.uid; if (!uid) return;
  const item = _loot.loot.find(i => i.id === id);
  if (!item?.vote?.open) return;
  const st = _lootClaimState[id];
  const dispo = _lootCount(item);
  const qty = Math.max(0, Math.min(dispo, Math.floor(st?.qty ?? 0)));
  const char = VS.characters[st?.charId || _lootMe];
  if (!char) { showNotif('Choisis un personnage', 'error'); return; }
  const key = _claimKey(id, uid);
  const claim = { qty, charId: char.id, name: char.nom || char.pseudo || '?' };
  if (!_loot.voteClaims) _loot.voteClaims = {};
  _loot.voteClaims[key] = claim;
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
  await setDoc(_lootRef(), { voteClaims: { [key]: null } }, { merge: true })
    .catch(() => showNotif('Erreur', 'error'));
}

// ── Rendu du bloc vote (inline sous la ligne) — perso = bandeau ─────
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
        charId: myClaim?.charId || _lootMe || myChars[0].id,
      });
      st.qty = Math.max(0, Math.min(dispo, st.qty || 0));
      mine = `<div class="vtt-loot-take-row">
          <div class="vtt-loot-stepper">
            <button class="vtt-loot-step" data-vtt-fn="_vttLootClaimStep" data-vtt-args="${id}|-1" ${st.qty <= 0 ? 'disabled' : ''}>−</button>
            <span class="vtt-loot-step-val">${st.qty}<span class="vtt-loot-step-max">/${dispo}</span></span>
            <button class="vtt-loot-step" data-vtt-fn="_vttLootClaimStep" data-vtt-args="${id}|1" ${st.qty >= dispo ? 'disabled' : ''}>+</button>
          </div>
          ${dispo > 1 ? `<button class="vtt-loot-step-all" data-vtt-fn="_vttLootClaimStep" data-vtt-args="${id}|max">Tout</button>` : ''}
          <span class="vtt-loot-grow"></span>
          <button class="vtt-loot-take-go" data-vtt-fn="_vttLootClaimSubmit" data-vtt-args="${id}">${st.qty > 0 ? (isGold ? `Demander ${st.qty} or` : `Demander ×${st.qty}`) : 'Passer mon tour'}</button>
        </div>`;
    }
  } else if (!onPage && !mj) {
    mine = `<div class="vtt-rest-help">Place un token sur la map pour participer à la répartition.</div>`;
  }

  const claimedCount = present.filter(u => claims[u]).length;
  host.innerHTML = `
    <div class="vtt-rest-vote-hd">${_li('scale')}Répartition · ${claimedCount}/${present.length || '?'} ont demandé</div>
    <div class="vtt-loot-claim-total${over ? ' over' : ''}">Total demandé <b>${total}</b> / ${dispo} dispo${over ? ' — trop, réduisez' : ''}</div>
    <div class="vtt-rest-voters">${voterList || '<div class="vtt-rest-help">Aucun joueur sur la map.</div>'}</div>
    ${mine}
    ${mj ? `<div class="vtt-loot-vote-mj">
      <button class="vtt-rest-btn vtt-rest-btn--force" data-vtt-fn="_vttLootForceDistribute" data-vtt-args="${id}">${_li('scale')}Forcer la répartition</button>
      <button class="vtt-rest-btn vtt-rest-btn--cancel" data-vtt-fn="_vttLootCloseVote" data-vtt-args="${id}">✕ Annuler</button>
    </div>` : ''}
  `;
}

// ── Résolution ──────────────────────────────────────────────────────
async function _vttLootForceDistribute(id) {
  if (!STATE.isAdmin) return;
  await _applyLootDistribution(id, { forced: true });
}

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

function _finishDistribution(id, item) {
  _clearItemClaims(id);
  delete _lootClaimState[id];
  if (_lootCount(item) <= 0) _loot.loot = _loot.loot.filter(i => i.id !== id);
  else delete item.vote;
}

let _lootDistributing = false;

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
        if (res?.ok) { summary.push(`${_esc(VS.characters[c.charId]?.nom || c.name)}: ${n}`); _logLoot('vote', `<b>${_esc(VS.characters[c.charId]?.nom || c.name)}</b> a reçu ${n} po`); }
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
      const historyPatch = inventoryHistoryPayload(char, makeInventoryHistoryEntry('add', baseEntry, n, {
        actorUid: STATE.user?.uid || '',
        actorName: STATE.user?.pseudo || STATE.user?.displayName || STATE.user?.email || '',
        source: 'Butin VTT',
      }));
      writes.push(updateDoc(_chrRef(c.charId), { inventaire: inv, ...historyPatch }).then(() => {
        char.inventaire = inv;
        char.inventoryHistory = historyPatch.inventoryHistory;
      }));
      summary.push(`${_esc(char.nom || c.name)}: ×${n}`);
      _logLoot('vote', `<b>${_esc(char.nom || c.name)}</b> a reçu ${_esc(item.nom)} ×${n}`);
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

function _checkLootVoteAutoApply() {
  if (!STATE.isAdmin) return;
  const present = _shortRestPresentUids();
  if (!present.length) return;
  for (const item of _loot.loot) {
    if (!item.vote?.open) continue;
    const claims = _lootClaimsFor(item.id);
    if (!present.every(u => claims[u])) continue;
    const total = Object.values(claims).reduce((s, c) => s + Math.max(0, c.qty || 0), 0);
    if (total <= 0) { _vttLootCloseVote(item.id); return; }
    if (total > _lootCount(item)) continue;
    _applyLootDistribution(item.id, { forced: false });
    return;
  }
}

// Reset complet de l'état butin au teardown de la VTT (appelé depuis vtt.js).
function _resetLootState() {
  if (_lootUnsub) { _lootUnsub(); _lootUnsub = null; }
  _lootLoading = false; _lootReady = null;
  if (_lootCloseOutside) { document.removeEventListener('mousedown', _lootCloseOutside, true); _lootCloseOutside = null; }
  _lootSortables.forEach(s => { try { s.destroy(); } catch { /* noop */ } });
  _lootSortables = [];
  for (const k of Object.keys(_lootClaimState)) delete _lootClaimState[k];
  for (const k of Object.keys(_lootTakeState)) delete _lootTakeState[k];
  _loot = { stash: [], loot: [], voteClaims: {}, log: [] };
  _lootView = 'main'; _qa = ''; _qaOpen = false; _qaIdx = 0;
  _goldEdit = false; _goldVal = ''; _qtyEdit = null;
  _cSel = 'recent'; _cQ = ''; _cRar = ''; _basket = {}; _creatureDraws = {};
  _flash = null;
  _shopLoaded = false; _raritiesReady = false; _rarByVal = {};
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
  // Nouveaux handlers (refonte)
  _vttLootMove,
  _vttLootMove1,
  _vttLootQtyEdit,
  _vttLootQtyStep,
  _vttLootRevealAll,
  _vttLootGoldEdit,
  _vttLootGoldCancel,
  _vttLootGoldOk,
  _vttLootGoldMove,
  _vttLootGoldSplit,
  _vttLootStashMenu,
  _vttLootTableMenu,
  _vttLootQaPick,
  _vttLootCataBack,
  _vttLootCataSel,
  _vttLootCataRar,
  _vttLootCataAdd,
  _vttLootBasketStep,
  _vttLootBasketRemove,
  _vttLootBasketClear,
  _vttLootBasketSend,
  _vttLootCreatureAll,
  _vttLootCreatureDraw,
  _vttLootSetMe,
};
