// ══════════════════════════════════════════════════════════════════════════════
// BASTION-MARKET-UI — Marché du Bastion : mise en vente, achat, retrait, onglet
// ──────────────────────────────────────────────────────────────────────────────
// Une vente est une annonce « Offre » du mur qui porte l'objet vendu ; il reste
// dans l'inventaire du vendeur jusqu'à l'achat (règles pures :
// shared/bastion-market.js). Ce module rend sa carte dans le fil,
// l'onglet Marché (une liste + une fiche, comme l'Inventaire v11) et la modale de
// mise en vente — ouvrable aussi depuis la fiche objet de l'Inventaire, sans que
// le Bastion soit chargé. bastion.js injecte son contexte (initBastionMarket).
// Chaque opération = UNE transaction (annonce + fiches) : tout ou rien.
// ══════════════════════════════════════════════════════════════════════════════
import { STATE } from '../core/state.js';
import { registerActions } from '../core/actions.js';
import { _ensureFeatureCss } from '../core/navigation.js';
import { addToCol, getCachedCollection, loadCollectionWhere } from '../data/firestore.js';
import { newDocId, runDocsTransaction, subscribeWhereEquals } from '../data/firestore-transactions.js';
import { showNotif, notifySaveError } from '../shared/notifications.js';
import { openModal, closeModalDirect, confirmModal, promptModal, updateModalContent } from '../shared/modal.js';
import { _esc, _searchIncludes } from '../shared/html.js';
import { timeAgo } from '../shared/relative-time.js';
import { calcOr, getDefaultCharForUser, getItemEffectText, statShort } from '../shared/char-stats.js';
import { RARETE_NAMES, _rareteColor } from '../shared/rarity.js';
import {
  getInventoryItemImage, getInventoryItemResaleValue, getInventoryItemValue, getInventoryReadableDocument,
} from '../shared/inventory-utils.js';
import { getItemTraits, resolveEquippedInventoryIndices } from '../shared/equipment-utils.js';
import { getVisibleCharacters } from '../shared/character-state.js';
import { charSession } from '../shared/char-session.js';
import { touchBastionWallActivity } from '../shared/bastion-signal.js';
import { normalizeBastionWallPost } from '../shared/bastion-wall.js';
import { weaponHandsLabel } from '../shared/weapon-family.js';
import { getUpgradeSettings, hasUpgrades, loadUpgradeSettings } from '../shared/upgrade-settings.js';
import { upgradeResaleBonus, upgradeTariffValue } from '../shared/upgrade-value.js';
import {
  ITEM_FAMILIES, isArmorItem, isQuestItem, isWeaponItem, itemBonuses, itemChips, itemCompareRows,
  itemCompareSlot, itemDamageText, itemFamily, itemKind, itemRarity, itemSigned,
} from '../shared/item-facts.js';
import {
  AUCTION_DURATIONS, MARKET_PRICE_MAX, MarketError, auctionEnded, buildMarketListing, isMarketListing, marketAvailability,
  marketItemKey, marketListingView, marketMinBid, planMarketBid, planMarketClose,
  mergeMarketPosts, normalizeMarketPrice, planMarketListing, planMarketPrice, planMarketPurchase,
  planMarketWithdraw, sortMarketViews,
} from '../shared/bastion-market.js';

export { isMarketListing };

// Vente v1 : objet déjà sorti de l'inventaire (dépôt) → à rendre si on supprime.
export const isEscrowListing = post => isMarketListing(post) && marketListingView(post).escrow;

const COL = 'bastionAnnonces';
const MK = {
  // Contexte injecté par bastion.js ; valeurs neutres hors de la page Bastion.
  ctx: {
    posts: () => [],
    scopeChar: () => null,
    rerender: () => {},
    patchPost: () => {},
    onPosted: () => {},
    openPost: () => {},
    openTab: () => {},
    draftText: () => '',
    clearDraft: () => {},
  },
  offers: [],      // ventes ouvertes (flux dédié, page Bastion seulement)
  stopFeed: null,
  ui: { family: 'all', query: '', sort: 'recent', sel: '', sheetOpen: false, history: false },
  busy: false,
  sell: null,      // état de la modale de mise en vente
  ownPosts: new Map(), // charId → ses annonces (modale ouverte hors Bastion)
};

export function initBastionMarket(ctx = {}) {
  MK.ctx = { ...MK.ctx, ...ctx };
}

// Changement d'aventure : rien ne doit survivre d'une table à l'autre.
export function resetBastionMarket() {
  MK.stopFeed?.();
  MK.offers = [];
  MK.ui = { family: 'all', query: '', sort: 'recent', sel: '', sheetOpen: false, history: false };
  MK.ownPosts = new Map();
  _upgradeLoad = null;
}

// Le mur ne garde que ses 80 posts récents : ce flux borné aux ventes OUVERTES
// garantit qu'une vieille vente ne quitte jamais le Marché (ni ne reste
// ouverte sans bouton Retirer). Deux égalités, aucun tri → index
// mono-champ fusionnés, rien à créer. Coupé à la navigation suivante.
export function startMarketFeed() {
  MK.stopFeed?.();
  const stop = subscribeWhereEquals(COL, { type: 'offre', status: 'active' }, { max: 100 }, docs => {
    MK.offers = (docs || []).map(normalizeBastionWallPost).filter(isMarketListing);
    _rerender();
    void _closeDueAuctions();
  }, { onUnavailable: () => { MK.offers = []; } });
  // Toutes les 30 s (onglet visible) : comptes à rebours à jour, enchères échues
  // clôturées par ce client s'il est le premier à les voir.
  const tick = setInterval(() => {
    if (document.hidden || STATE.currentPage !== 'bastion') return;
    document.querySelectorAll('[data-mk-ends]').forEach(el => { el.textContent = _countdown(Number(el.dataset.mkEnds)); });
    void _closeDueAuctions();
  }, 30_000);
  const own = () => {
    stop();
    clearInterval(tick);
    if (MK.stopFeed === own) MK.stopFeed = null;
  };
  MK.stopFeed = own;
  document.addEventListener('app:page-changed', own, { once: true });
}

// ── Données ───────────────────────────────────
const _uid = () => STATE.user?.uid || '';
const _gold = n => `${Number(n || 0).toLocaleString('fr-FR')} or`;
const _today = () => new Date().toLocaleDateString('fr-FR');
const _actor = () => ({
  actorUid: _uid(),
  actorName: STATE.user?.pseudo || STATE.user?.displayName || STATE.user?.email || '',
});
const _rerender = () => { if (STATE.currentPage === 'bastion') MK.ctx.rerender(); };
const _char = id => (STATE.characters || []).find(c => c.id === id) || null;
const _catalog = item => (item?.itemId ? (getCachedCollection('shop') || []).find(entry => entry.id === item.itemId) : null) || null;
const _lot = view => `${view.name}${view.qty > 1 ? ` ×${view.qty}` : ''}`;

// Vente v2 ouverte : l'objet montré est l'exemplaire ACTUEL du vendeur (celui
// que l'achat prendra : rangé d'abord), améliorations comprises — pas la copie
// faite à la mise en vente. Vente close ou v1 : la copie de l'annonce.
function _liveItem(view) {
  if (view.escrow || view.state !== 'open') return view.item;
  const seller = _char(view.sellerCharId);
  const inventory = Array.isArray(seller?.inventaire) ? seller.inventaire : [];
  const key = marketItemKey(view.item);
  const worn = new Set(resolveEquippedInventoryIndices(seller || {}).values());
  const matching = inventory.map((item, index) => ({ item, index }))
    .filter(({ item }) => item && typeof item === 'object' && marketItemKey(item) === key);
  return (matching.find(m => !worn.has(m.index)) || matching[0])?.item || view.item;
}
function _view(post) {
  const view = marketListingView(post);
  const item = _liveItem(view);
  return item === view.item ? view : { ...view, item, rarity: itemRarity(item) };
}

// Revente d'un exemplaire : même calcul que l'Inventaire (prix de reprise +
// part de ses améliorations au tarif actuel) ; valeur de ses améliorations.
const _resale = item => getInventoryItemResaleValue(item, _catalog(item)) + upgradeResaleBonus(item, getUpgradeSettings());
const _upgradesValue = item => upgradeTariffValue(item, getUpgradeSettings());
// Tarifs d'amélioration (world/upgrade_settings) lus une fois, seulement si un
// objet affiché est amélioré ; `onLoaded` redessine si les tarifs ont changé.
let _upgradeLoad = null;
function _ensureUpgradeSettings(items, onLoaded = _rerender) {
  if (!items.some(item => hasUpgrades(item))) return;
  const shown = getUpgradeSettings();
  _upgradeLoad ||= loadUpgradeSettings().catch(() => shown);
  _upgradeLoad.then(settings => { if (settings !== shown) onLoaded(); });
}

function _posts() {
  return mergeMarketPosts(MK.offers, (MK.ctx.posts() || []).filter(isMarketListing)).filter(isMarketListing);
}
const _post = id => _posts().find(post => post.id === id) || null;
function _views() {
  return _posts().map(_view);
}
const _isMine = view => !!view && view.sellerUid === _uid();
const _canManage = view => _isMine(view) || !!STATE.isAdmin;

// Acheteur = personnage « Je joue » du Bastion (sinon le personnage principal).
function _buyer() {
  const scoped = MK.ctx.scopeChar();
  if (scoped) return scoped;
  const chars = getVisibleCharacters({ sorted: true });
  return getDefaultCharForUser(chars, _uid()) || chars[0] || null;
}

function _familyOf(item) {
  return itemFamily(item, { readable: !!getInventoryReadableDocument(item, _catalog(item)) });
}

// Mise à jour locale immédiate (les listeners confirment ensuite).
function _patchLocalChar(id, patch) {
  const current = charSession.getCurrentChar?.();
  new Set([
    _char(id),
    STATE.activeChar?.id === id ? STATE.activeChar : null,
    current?.id === id ? current : null,
  ].filter(Boolean)).forEach(c => Object.assign(c, patch));
}
function _patchLocalPost(id, patch) {
  MK.offers = MK.offers.map(post => (post.id === id ? normalizeBastionWallPost({ ...post, ...patch }) : post));
  MK.ctx.patchPost(id, patch);
}

function _txError(error, fallback) {
  if (error instanceof MarketError || error?.name === 'MarketError') {
    showNotif(error.message, 'error');
    return;
  }
  if (error?.code === 'permission-denied') {
    console.warn('[marché] refusé par les règles Firestore (voir docs/firestore-rules.md)', error);
    showNotif('Refusé par Firestore : le MJ doit déployer les règles du Marché du Bastion.', 'error');
    return;
  }
  notifySaveError(error, fallback);
}

// ── Petits rendus partagés ────────────────────
const _notable = rare => rare >= 2 && !!RARETE_NAMES[rare];
const _rareName = rare => (_notable(rare) ? RARETE_NAMES[rare] : (RARETE_NAMES[1] || 'Commun'));
const _rareAttrs = rare => (_notable(rare) ? ` data-r="${rare}" style="--mk-rc:${_rareteColor(RARETE_NAMES[rare]) || '#7a8fa8'}"` : '');
const _chipHtml = chip => `<i class="bs-mk-chip ${chip.cls}">${_esc(chip.t)}</i>`;
const _fact = (label, value) => ((value === '' || value == null) ? '' : `<div><span>${_esc(label)}</span><b>${_esc(String(value))}</b></div>`);
const _icon = item => {
  const image = getInventoryItemImage(item, _catalog(item));
  return `<span class="bs-mk-ic">${image ? `<img src="${_esc(image)}" alt="" loading="lazy">` : '<i class="bs-mk-gem"></i>'}</span>`;
};
const _ago = ts => timeAgo(ts, { invalid: '', prefix: 'il y a ' });

// Prix affiché : offre en cours (ou départ) pour une enchère.
const _shown = view => (view.auction && view.bid ? view.bid.amount : view.price);
function _countdown(endsAt) {
  const left = endsAt - Date.now();
  if (left <= 0) return 'terminée';
  const min = Math.ceil(left / 60_000);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  return h < 24 ? `${h} h ${String(min % 60).padStart(2, '0')}` : `${Math.floor(h / 24)} j ${h % 24} h`;
}
function _auctionLine(view) {
  if (!view.auction || view.state !== 'open') return '';
  const offer = view.bid ? `Offre ${_esc(_gold(view.bid.amount))} · ${_esc(view.bid.name)}` : `Départ ${_esc(_gold(view.price))} · aucune offre`;
  const count = view.bidCount ? ` · ${view.bidCount} offre${view.bidCount > 1 ? 's' : ''}` : '';
  const end = auctionEnded(view) ? 'terminée, clôture en cours…' : `fin dans <span data-mk-ends="${view.endsAt}">${_countdown(view.endsAt)}</span>`;
  return `<span class="bs-mk-auc">⚖ ${offer}${count} · ⏳ ${end}</span>`;
}

function _stateLine(view) {
  if (view.auction && view.state === 'sold') return `✓ Adjugée à ${_esc(view.buyerName || '?')} · ${_esc(_gold(view.bid?.amount || view.price))}`;
  if (view.auction && view.state === 'withdrawn') return view.unsold ? 'Enchère sans offre' : view.failed ? 'Enchère annulée : objet indisponible' : 'Enchère annulée';
  if (view.state === 'sold') return `✓ Vendu à ${_esc(view.buyerName || '?')}${view.soldAt ? ` · ${_ago(view.soldAt)}` : ''}`;
  if (view.state === 'withdrawn') return 'Retirée de la vente';
  const who = _isMine(view) ? (view.auction ? 'Ton enchère' : 'Ta vente') : `Vendu par ${_esc(view.sellerName)}`;
  return `${who}${view.ts ? ` · ${_ago(view.ts)}` : ''}`;
}

// L'objet est-il encore achetable (présent et rangé chez le vendeur) ? Lu sur la
// fiche locale ; la transaction d'achat revérifie sur la fiche fraîche.
const _avail = view => marketAvailability(view, _char(view.sellerCharId));
function _availWarn(view) {
  if (view.state !== 'open') return '';
  const { ok, reason } = _avail(view);
  if (ok) return '';
  const mine = _isMine(view);
  if (reason === 'worn' && view.auction) return mine ? 'Tu portes cet objet : range-le avant la fin, sinon l’enchère sera annulée.' : `${view.sellerName} porte encore cet objet : il doit le ranger avant la fin de l’enchère.`;
  if (reason === 'worn') return mine ? 'Tu portes cet objet : déséquipe-le pour qu’il puisse être acheté.' : `${view.sellerName} porte encore cet objet : achat possible quand il l’aura rangé.`;
  return mine ? 'Cet objet n’est plus dans ton inventaire : retire la vente.' : `${view.sellerName} n’a plus cet objet.`;
}

// Bouton d'achat : désactivé (avec la raison) plutôt qu'une erreur au clic.
function _buyButton(view, cls = '') {
  const buyer = _buyer();
  if (!buyer) return '';
  const price = view.auction ? view.buyNow : view.price;
  const label = view.auction ? `Achat immédiat · ${_esc(_gold(price))}` : 'Acheter';
  const ownBid = view.bid && view.bid.charId === buyer.id ? view.bid.amount : 0;
  const missing = price - calcOr(buyer) - ownBid;
  const warn = _availWarn(view);
  if (warn) return `<button type="button" class="bs-w-btn bs-w-go ${cls}" disabled title="${_esc(warn)}">${label}</button>`;
  return missing > 0
    ? `<button type="button" class="bs-w-btn bs-w-go ${cls}" disabled title="Il manque ${_esc(_gold(missing))} à ${_esc(buyer.nom || 'ce personnage')}">${label}</button>`
    : `<button type="button" class="bs-w-btn bs-w-go ${cls}" data-action="_mkBuy" data-id="${_esc(view.id)}" data-price="${price}" title="Acheter avec ${_esc(buyer.nom || 'ce personnage')}">${label}</button>`;
}

// Enchère : bouton « Enchérir » (offre minimale proposée) + achat immédiat.
function _bidButtons(view, cls = '') {
  const buyer = _buyer();
  if (!buyer || view.state !== 'open' || auctionEnded(view)) return '';
  const min = marketMinBid(view);
  const self = view.bid && view.bid.charId === buyer.id;
  const missing = min - calcOr(buyer) - (self ? view.bid.amount : 0);
  const bid = missing > 0
    ? `<button type="button" class="bs-w-btn ${cls}" disabled title="Il manque ${_esc(_gold(missing))} à ${_esc(buyer.nom || 'ce personnage')}">Enchérir</button>`
    : `<button type="button" class="bs-w-btn bs-mk-bid ${cls}" data-action="_mkBid" data-id="${_esc(view.id)}" data-min="${min}" title="${self ? 'Relever ta propre offre' : `Enchérir avec ${_esc(buyer.nom || 'ce personnage')}`}">${self ? 'Relever' : 'Enchérir'} · ${_esc(_gold(min))}</button>`;
  const lead = self ? '<span class="bs-mk-lead">✓ Tu mènes</span>' : '';
  return lead + bid + (view.buyNow > _shown(view) ? _buyButton(view, cls) : '');
}

// Actions du vendeur : une enchère avec offres ne se retire plus (MJ seulement).
function _sellerButtons(view, cls = '') {
  if (view.auction) {
    return view.bid ? '' : `<button type="button" class="bs-w-btn ${cls}" data-action="_mkWithdraw" data-id="${_esc(view.id)}">Retirer</button>`;
  }
  return `<button type="button" class="bs-w-btn ${cls}" data-action="_mkPrice" data-id="${_esc(view.id)}">Modifier le prix</button><button type="button" class="bs-w-btn ${cls}" data-action="_mkWithdraw" data-id="${_esc(view.id)}">Retirer</button>`;
}

// ══════════════════════════════════════════════
// FIL DU MUR — l'objet joint à l'annonce
// ══════════════════════════════════════════════
export function marketWallBlockHtml(post) {
  const view = _view(post);
  const item = view.item;
  _ensureUpgradeSettings([item]);
  const chips = itemChips(item).map(_chipHtml).join('');
  let actions = '';
  if (view.state === 'open') {
    actions = _isMine(view) ? _sellerButtons(view, 'bs-w-sm') : view.auction ? _bidButtons(view, 'bs-w-sm') : _buyButton(view, 'bs-w-sm');
  } else {
    actions = `<span class="bs-mk-state is-${view.state}">${_stateLine(view)}</span>`;
  }
  return `<div class="bs-mk-lot${view.state !== 'open' ? ' is-closed' : ''}"${_rareAttrs(view.rarity)}>
    <button type="button" class="bs-mk-lot-item" data-action="_mkOpenListing" data-id="${_esc(view.id)}" title="Voir la fiche au Marché">
      ${_icon(item)}
      <span class="bs-mk-txt"><span class="bs-mk-name"><b>${_esc(view.name)}</b>${view.qty > 1 ? `<em>×${view.qty}</em>` : ''}</span><span class="bs-mk-line">${_esc(_rareName(view.rarity))} · ${_esc(itemKind(item))}</span></span>
      ${chips ? `<span class="bs-mk-chips">${chips}</span>` : ''}
    </button>
    <div class="bs-mk-lot-ft">
      <span class="bs-mk-price">${_esc(_gold(_shown(view)))}${view.qty > 1 && !view.auction ? `<small>${_esc(_gold(view.unitPrice))} / u.</small>` : ''}</span>
      <span class="bs-mk-lot-acts">${actions}</span>
    </div>
    ${_auctionLine(view) ? `<p class="bs-mk-auc-row">${_auctionLine(view)}</p>` : ''}
    ${_availWarn(view) ? `<p class="bs-mk-warn">⚠ ${_esc(_availWarn(view))}</p>` : ''}
  </div>`;
}

// Ligne courte de la colonne « Offres & demandes ».
export function marketSideLabel(post) {
  const view = _view(post);
  return view.auction ? `${_lot(view)} · enchère ${_gold(_shown(view))}` : `${_lot(view)} · ${_gold(view.price)}`;
}

export function marketOpenCount() {
  return _views().filter(view => view.state === 'open').length;
}

// ══════════════════════════════════════════════
// ONGLET MARCHÉ — une liste + une fiche
// ══════════════════════════════════════════════
function _matches(view) {
  if (MK.ui.family === 'auction') { if (!view.auction) return false; }
  else if (MK.ui.family !== 'all' && _familyOf(view.item) !== MK.ui.family) return false;
  return _searchIncludes(`${view.name} ${itemKind(view.item)} ${view.item.type || ''} ${view.sellerName}`, MK.ui.query);
}

function _rowHtml(view) {
  const sel = MK.ui.sel === view.id;
  const chips = itemChips(view.item).map(_chipHtml).join('');
  const avail = view.state === 'open' && _isMine(view) ? _avail(view) : { ok: true };
  const warn = avail.ok ? '' : ` · <em class="bs-mk-row-warn">⚠ ${avail.reason === 'worn' ? 'porté' : 'plus dans l’inventaire'}</em>`;
  const who = view.state !== 'open' ? _stateLine(view)
    : view.auction ? `${_esc(_isMine(view) ? 'Ton enchère' : view.sellerName)} · ⏳ <span data-mk-ends="${view.endsAt}">${_countdown(view.endsAt)}</span>${view.bidCount ? ` · ${view.bidCount} offre${view.bidCount > 1 ? 's' : ''}` : ''}`
      : `${_esc(_isMine(view) ? 'Ta vente' : view.sellerName)}${view.ts ? ` · ${_ago(view.ts)}` : ''}`;
  const line = `${_esc(itemKind(view.item))} · ${who}${warn}`;
  return `<button type="button" class="bs-mk-row${sel ? ' is-sel' : ''}${view.state !== 'open' ? ' is-closed' : ''}"${_rareAttrs(view.rarity)} data-action="_mkSelect" data-id="${_esc(view.id)}" aria-pressed="${sel}">
    <span class="bs-mk-gem"></span>
    <span class="bs-mk-txt"><span class="bs-mk-name"><b>${_esc(view.name)}</b>${view.qty > 1 ? `<em>×${view.qty}</em>` : ''}</span><span class="bs-mk-line">${line}</span></span>
    ${chips ? `<span class="bs-mk-chips">${chips}</span>` : ''}
    <span class="bs-mk-price">${view.auction ? '<i class="bs-mk-auc-ic" title="Enchère">⚖</i>' : ''}${_esc(_gold(_shown(view)))}</span>
  </button>`;
}

function _section(title, views, empty = '') {
  if (!views.length && !empty) return '';
  return `<section class="bs-mk-sec"><h3 class="bs-mk-sh">${title}<span>${views.length}</span></h3>
    ${views.length ? `<div class="bs-mk-rows">${views.map(_rowHtml).join('')}</div>` : `<p class="bs-mk-empty">${empty}</p>`}
  </section>`;
}

function _listHtml(all) {
  const open = sortMarketViews(all.filter(view => view.state === 'open' && _matches(view)), MK.ui.sort);
  const closed = all.filter(view => view.state !== 'open' && _matches(view))
    .sort((a, b) => (b.soldAt || b.ts) - (a.soldAt || a.ts)).slice(0, 30);
  const filtering = MK.ui.family !== 'all' || !!MK.ui.query;
  const forSale = open.filter(view => !_isMine(view));
  const mine = open.filter(_isMine);
  const emptyForSale = all.some(view => view.state === 'open')
    ? (filtering ? 'Aucune vente ne correspond.' : 'Aucune vente d’un autre aventurier pour l’instant.')
    : 'Le marché est vide. Mets un objet en vente : il apparaîtra ici et sur le mur.';
  return `${_section('En vente', forSale, emptyForSale)}
    ${_section('Mes ventes', mine)}
    ${closed.length ? `<section class="bs-mk-sec">
      <button type="button" class="bs-mk-sh bs-mk-hist-toggle" data-action="_mkHistory" aria-expanded="${MK.ui.history}">◷ Historique<span>${closed.length}</span><i aria-hidden="true">${MK.ui.history ? '▾' : '▸'}</i></button>
      ${MK.ui.history ? `<div class="bs-mk-rows">${closed.map(_rowHtml).join('')}</div>` : ''}
    </section>` : ''}`;
}

function _compareHtml(buyer, item) {
  const slot = itemCompareSlot(buyer, item);
  if (!slot) return '';
  const occupant = buyer.equipement?.[slot.id] || null;
  const rows = itemCompareRows(item, occupant);
  const fmt = v => (typeof v === 'number' ? itemSigned(v) : v);
  return `<section class="bs-mk-part bs-mk-cmp"><h4>Si ${_esc(buyer.nom || 'ton personnage')} l’équipe</h4>
    <p>${occupant ? `Remplace <b>${_esc(occupant.nom || 'objet')}</b> <small>(${_esc(slot.label)})</small>` : `Emplacement libre <small>(${_esc(slot.label)})</small>`}</p>
    ${rows.length ? `<ul>${rows.map(([k, a, b]) => {
      const dir = typeof a === 'number' ? (b > a ? 'up' : 'down') : '';
      return `<li${dir ? ` class="is-${dir}"` : ''}><span>${_esc(k)}</span><s>${_esc(fmt(a))}</s><i>→</i><b>${_esc(fmt(b))}</b>${dir ? `<em>${dir === 'up' ? '▲' : '▼'}</em>` : ''}</li>`;
    }).join('')}</ul>` : '<p class="bs-mk-dim">Aucun changement de bonus.</p>'}
  </section>`;
}

function _sheetActions(view) {
  const jump = `<button type="button" class="bs-w-btn bs-w-sm bs-mk-ghost" data-action="_mkJumpPost" data-id="${_esc(view.id)}">Voir l’annonce</button>`;
  if (view.state !== 'open') return `<footer class="bs-mk-acts"><div class="bs-mk-acts-row">${jump}</div></footer>`;
  const buyer = _buyer();
  let main = '';
  let hint = '';
  if (_isMine(view)) {
    main = _sellerButtons(view);
    hint = _availWarn(view) || (view.auction && view.bid ? 'Des offres ont été faites : l’enchère ira à son terme.' : 'Ta vente : l’objet reste dans ton inventaire jusqu’à l’achat.');
  } else if (buyer && view.auction) {
    main = _bidButtons(view, 'bs-mk-buy');
    hint = _availWarn(view) || (auctionEnded(view) ? 'Enchère terminée : clôture en cours.'
      : 'Ton or est bloqué tant que ton offre est la meilleure ; il te revient si quelqu’un surenchérit.');
  } else if (buyer) {
    const missing = view.price - calcOr(buyer);
    main = _buyButton(view, 'bs-mk-buy');
    hint = _availWarn(view) || (missing > 0
      ? `Il manque ${_esc(_gold(missing))} à ${_esc(buyer.nom || 'ce personnage')}.`
      : `${_esc(buyer.nom || 'Ton personnage')} : ${_esc(_gold(calcOr(buyer)))} → ${_esc(_gold(calcOr(buyer) - view.price))}`);
  } else {
    hint = 'Il faut un personnage de cette aventure pour acheter.';
  }
  const moderate = !_isMine(view) && STATE.isAdmin
    ? `<button type="button" class="bs-w-btn bs-w-sm bs-mk-ghost" data-action="_mkWithdraw" data-id="${_esc(view.id)}">${view.auction && view.bid ? 'Annuler l’enchère (MJ)' : 'Retirer (MJ)'}</button>` : '';
  return `<footer class="bs-mk-acts">
    <div class="bs-mk-acts-price"><b>${_esc(_gold(_shown(view)))}</b>${view.qty > 1 && !view.auction ? `<small>${_esc(_gold(view.unitPrice))} / u.</small>` : ''}</div>
    ${_auctionLine(view)}
    ${main ? `<div class="bs-mk-acts-main">${main}</div>` : ''}
    ${hint ? `<p class="bs-mk-hint">${hint}</p>` : ''}
    <div class="bs-mk-acts-row">${jump}${moderate}</div>
  </footer>`;
}

const _SHEET_X = '<button type="button" class="bs-mk-sheet-x" data-action="_mkCloseSheet" aria-label="Fermer la fiche" title="Fermer (Échap)">✕</button>';

function _sheetHtml(view) {
  const item = view.item;
  const cat = _catalog(item);
  const bonuses = itemBonuses(item);
  const armor = isArmorItem(item);
  const traits = getItemTraits(item);
  const effect = String(getItemEffectText(item) || '').trim();
  const description = String(item.description || '').trim();
  const value = getInventoryItemValue(item, cat);
  const resale = _resale(item);
  const upgrades = _upgradesValue(item);
  const buyer = view.state === 'open' && !_isMine(view) ? _buyer() : null;
  const per = view.qty > 1 ? ' / u.' : '';
  const facts = [
    _fact('Dégâts', item.degats ? itemDamageText(item) : ''),
    _fact('Toucher', item.toucher || (item.toucherStat ? statShort(item.toucherStat) : '')),
    _fact('Portée', item.portee),
    _fact('Maniement', isWeaponItem(item) ? weaponHandsLabel(item) : ''),
    _fact('CA', armor ? itemSigned(bonuses[0].v) : ''),
    _fact('Set', item.set),
    _fact('Valeur', value ? _gold(value) + per : ''),
    _fact('Améliorations', upgrades ? _gold(upgrades) + per : ''),
    _fact('Revente', resale ? _gold(resale) + per : ''),
  ].join('');
  const bonusHtml = bonuses.filter(b => b.v && !(armor && b.k === 'CA'))
    .map(b => _chipHtml({ t: `${b.k} ${itemSigned(b.v)}`, cls: b.cls })).join('');
  return `<aside class="bs-mk-sheet"${_rareAttrs(view.rarity)} id="bs-mk-sheet" aria-label="Fiche de ${_esc(view.name)}">
    ${_SHEET_X}
    <header class="bs-mk-head">
      ${_icon(item)}
      <div class="bs-mk-id">
        <span class="bs-mk-kicker"><b>${_esc(_rareName(view.rarity))}</b> · ${_esc(itemKind(item))}</span>
        <h3>${_esc(view.name)}${view.qty > 1 ? ` <em>×${view.qty}</em>` : ''}</h3>
        <span class="bs-mk-status is-${view.state}">${_stateLine(view)}</span>
      </div>
    </header>
    ${view.text ? `<blockquote class="bs-mk-quote">${_esc(view.text.length > 280 ? `${view.text.slice(0, 278)}…` : view.text)}</blockquote>` : ''}
    ${facts ? `<div class="bs-mk-facts">${facts}</div>` : ''}
    ${bonusHtml ? `<section class="bs-mk-part"><h4>Bonus</h4><div class="bs-mk-tags">${bonusHtml}</div></section>` : ''}
    ${traits.length ? `<section class="bs-mk-part"><h4>Traits</h4><div class="bs-mk-tags">${traits.map(trait => `<span class="bs-mk-tag">${_esc(trait)}</span>`).join('')}</div></section>` : ''}
    ${effect ? `<section class="bs-mk-part"><h4>Effet</h4><p>${_esc(effect)}</p></section>` : ''}
    ${description && description !== effect ? `<section class="bs-mk-part"><h4>Description</h4><p class="is-edito">${_esc(description)}</p></section>` : ''}
    ${buyer ? _compareHtml(buyer, item) : ''}
    ${_sheetActions(view)}
  </aside>`;
}

function _summarySheetHtml(all) {
  const buyer = _buyer();
  const open = all.filter(view => view.state === 'open');
  const sold = all.filter(view => view.state === 'sold');
  return `<aside class="bs-mk-sheet is-summary" id="bs-mk-sheet" aria-label="Le Marché du Bastion">
    <header class="bs-mk-id">
      <span class="bs-mk-kicker">Marché du Bastion</span>
      <h3>Achat immédiat entre aventuriers</h3>
      <span class="bs-mk-status">Sélectionne un objet pour voir sa fiche et le comparer à ton équipement.</span>
    </header>
    <div class="bs-mk-facts">
      ${_fact('En vente', open.filter(view => !_isMine(view)).length)}
      ${_fact('Mes ventes', open.filter(_isMine).length)}
      ${_fact('Ventes conclues', sold.length)}
      ${buyer ? _fact(`Bourse de ${buyer.nom || '?'}`, _gold(calcOr(buyer))) : ''}
    </div>
    <section class="bs-mk-part"><h4>Comment ça marche</h4>
      <p>L’objet mis en vente reste dans l’inventaire du vendeur jusqu’à l’achat. À l’achat, l’or et l’objet changent de main en une seule opération, et le vendeur est prévenu. Un objet porté doit être rangé pour être acheté.</p>
      <p>Enchère : chaque offre bloque l’or de son auteur (rendu s’il est surenchéri) ; à la fin, l’objet part au meilleur enchérisseur.</p>
    </section>
    ${buyer ? `<footer class="bs-mk-acts"><div class="bs-mk-acts-main"><button type="button" class="bs-w-btn bs-w-go" data-action="_mkOpenSell">＋ Mettre un objet en vente</button></div></footer>` : ''}
  </aside>`;
}

export function renderMarketTab() {
  const all = _views();
  _ensureUpgradeSettings(all.map(view => view.item));
  const sel = all.find(view => view.id === MK.ui.sel) || null;
  if (!sel) MK.ui.sel = '';
  const open = all.filter(view => view.state === 'open');
  const counts = { all: open.length };
  open.forEach(view => { const f = _familyOf(view.item); counts[f] = (counts[f] || 0) + 1; });
  const families = ITEM_FAMILIES.filter(f => counts[f.id] || MK.ui.family === f.id);
  const sorts = [['recent', 'Récent'], ['ending', 'Fin proche'], ['price-asc', 'Prix ↑'], ['price-desc', 'Prix ↓'], ['rarity', 'Rareté']];
  const auctions = open.filter(view => view.auction).length;
  return `<div class="bs-mk${sel && MK.ui.sheetOpen ? ' is-sheet-open' : ''}">
    <div class="bs-v-tools bs-mk-tools">
      <label class="bs-v-search">🔍<input id="bs-mk-q" type="search" placeholder="Objet ou vendeur…" value="${_esc(MK.ui.query)}" data-input="_mkSearch" autocomplete="off" aria-label="Rechercher au Marché"></label>
      <div class="bs-w-fchips" role="group" aria-label="Filtrer par famille">
        <button type="button" class="bs-w-fchip${MK.ui.family === 'all' ? ' on' : ''}" data-action="_mkFamily" data-family="all" aria-pressed="${MK.ui.family === 'all'}">Tout<span>${counts.all}</span></button>
        ${auctions || MK.ui.family === 'auction' ? `<button type="button" class="bs-w-fchip${MK.ui.family === 'auction' ? ' on' : ''}" data-action="_mkFamily" data-family="auction" aria-pressed="${MK.ui.family === 'auction'}">⚖ Enchères<span>${auctions}</span></button>` : ''}
        ${families.map(f => `<button type="button" class="bs-w-fchip${MK.ui.family === f.id ? ' on' : ''}" data-action="_mkFamily" data-family="${f.id}" aria-pressed="${MK.ui.family === f.id}">${_esc(f.label)}<span>${counts[f.id] || 0}</span></button>`).join('')}
      </div>
      <label class="bs-mk-sort"><span>Trier</span><select data-change="_mkSort" aria-label="Trier les ventes">${sorts.map(([id, label]) => `<option value="${id}"${MK.ui.sort === id ? ' selected' : ''}>${label}</option>`).join('')}</select></label>
      ${_buyer() ? '<button type="button" class="bs-w-btn bs-w-go bs-v-deposit" data-action="_mkOpenSell">＋ Mettre en vente</button>' : ''}
    </div>
    <div class="bs-mk-body">
      <div class="bs-mk-list" id="bs-mk-list">${_listHtml(all)}</div>
      ${sel ? _sheetHtml(sel) : _summarySheetHtml(all)}
    </div>
  </div>`;
}

function _select(id) {
  MK.ui.sel = id;
  MK.ui.sheetOpen = true;
  _rerender();
}
function _closeSheet() {
  MK.ui.sel = '';
  MK.ui.sheetOpen = false;
  _rerender();
}

// Depuis le fil : l'onglet Marché s'ouvre sur la fiche de l'objet.
function _openListing(id) {
  const view = _views().find(entry => entry.id === id);
  if (view && view.state !== 'open') MK.ui.history = true;
  MK.ui.family = 'all';
  MK.ui.query = '';
  MK.ui.sel = id;
  MK.ui.sheetOpen = true;
  MK.ctx.openTab('marche');
}

document.addEventListener('keydown', event => {
  if (event.key !== 'Escape' || STATE.currentPage !== 'bastion' || !document.querySelector('.bs-mk.is-sheet-open')) return;
  if (document.getElementById('modal-overlay')?.classList.contains('show')) return;
  _closeSheet();
});

// ══════════════════════════════════════════════
// TRANSACTIONS — achat, retrait, prix
// ══════════════════════════════════════════════
async function _buy(id, shownPrice) {
  if (MK.busy) return;
  const post = _post(id);
  const view = post ? marketListingView(post) : null;
  const buyer = _buyer();
  if (!view || view.state !== 'open') { showNotif('Cette vente n’est plus disponible.', 'error'); return; }
  if (!buyer) { showNotif('Choisis le personnage qui achète (« Je joue »).', 'error'); return; }
  const expectedPrice = Number.isFinite(Number(shownPrice)) ? Number(shownPrice) : (view.auction ? view.buyNow : view.price);
  const balance = calcOr(buyer) + (view.bid && view.bid.charId === buyer.id ? view.bid.amount : 0);
  const ok = await confirmModal(`<b>${_esc(_lot(view))}</b> vendu par <b>${_esc(view.sellerName)}</b><br>
    <span style="display:inline-block;margin-top:.45rem">Bourse de ${_esc(buyer.nom || '?')} : ${_esc(_gold(balance))} → <b>${_esc(_gold(balance - expectedPrice))}</b></span>`, {
    title: 'Acheter au Marché',
    confirmLabel: `Acheter · ${_gold(expectedPrice)}`,
    danger: false,
    icon: '🪙',
  }).catch(() => false);
  if (!ok) return;
  MK.busy = true;
  const now = Date.now();
  try {
    const prevId = view.bid && view.bid.charId !== buyer.id ? view.bid.charId : '';
    const result = await runDocsTransaction([
      { col: COL, id },
      { col: 'characters', id: buyer.id },
      { col: 'characters', id: view.sellerCharId },
      ...(prevId ? [{ col: 'characters', id: prevId }] : []),
    ], ([freshPost, freshBuyer, freshSeller, freshPrev]) => {
      const plan = planMarketPurchase({
        post: freshPost, buyer: freshBuyer, seller: freshSeller, prevBidder: freshPrev || null, buyerUid: _uid(),
        expectedPrice, now, date: _today(), actor: _actor(),
      });
      return {
        writes: [
          { col: 'characters', id: buyer.id, data: plan.buyerPatch },
          { col: 'characters', id: view.sellerCharId, data: plan.sellerPatch },
          ...(plan.refund ? [{ col: 'characters', id: plan.refund.charId, data: plan.refund.patch }] : []),
          { col: COL, id, data: plan.postPatch },
        ],
        result: { ...plan, sellerOwnerUid: String(freshSeller?.uid || '') },
      };
    });
    _patchLocalChar(buyer.id, result.buyerPatch);
    _patchLocalChar(view.sellerCharId, result.sellerPatch);
    if (result.refund) {
      _patchLocalChar(result.refund.charId, result.refund.patch);
      void _notify(result.refund.uid, { actor: buyer, postId: id, kind: 'outbid', text: `${_lot(result.view)} · acheté immédiatement, ton offre t’est rendue` });
    }
    _patchLocalPost(id, result.postPatch);
    void _notifySale(result.view, buyer, id, result.sellerOwnerUid || result.view.sellerUid);
    showNotif(`🪙 ${_lot(result.view)} rejoint l’inventaire de ${buyer.nom || '?'} · −${_gold(result.view.price)}`, 'success');
  } catch (error) {
    _txError(error, 'L’achat n’a pas abouti.');
  } finally {
    MK.busy = false;
    _rerender();
  }
}

// Cloche du mur : `actor` = personnage affiché comme auteur de l'événement.
async function _notify(targetUid, { actor, postId, kind, text }) {
  if (!targetUid || targetUid === _uid()) return;
  await addToCol('bastionWallNotifications', {
    targetUid,
    actorUid: _uid(),
    actorCharId: actor?.id || actor?.charId || '',
    actorName: actor?.nom || actor?.name || 'Personnage',
    postId,
    kind,
    text: String(text || '').slice(0, 180),
    ts: Date.now(),
  }, { silent: true }).catch(error => console.debug('[marché] notification indisponible', error?.code || error));
}
// Le propriétaire du personnage vendeur est prévenu par la cloche du mur.
const _notifySale = (view, buyer, postId, targetUid) =>
  _notify(targetUid, { actor: buyer, postId, kind: 'sale', text: `${_lot(view)} · ${_gold(view.price)}` });

// Enchérir : l'or est bloqué, l'enchérisseur battu remboursé (même transaction).
async function _bid(id, minShown) {
  if (MK.busy) return;
  const post = _post(id);
  const view = post ? marketListingView(post) : null;
  const bidder = _buyer();
  if (!view || view.state !== 'open' || auctionEnded(view)) { showNotif('Cette enchère est terminée.', 'error'); return; }
  if (!bidder) { showNotif('Choisis le personnage qui enchérit (« Je joue »).', 'error'); return; }
  const min = Math.max(marketMinBid(view), Number(minShown) || 0);
  const value = await promptModal(`<b>${_esc(_lot(view))}</b> — ${view.bid ? `offre actuelle ${_esc(_gold(view.bid.amount))} (${_esc(view.bid.name)})` : `départ ${_esc(_gold(view.price))}`}.<br>Ton offre, en or (minimum ${_esc(_gold(min))}). L’or de ${_esc(bidder.nom || '?')} est bloqué tant que l’offre est la meilleure.`, {
    title: 'Enchérir', default: String(min), confirmLabel: 'Enchérir', required: true,
  }).catch(() => null);
  if (value == null) return;
  MK.busy = true;
  const now = Date.now();
  try {
    const prevId = view.bid && view.bid.charId !== bidder.id ? view.bid.charId : '';
    const plan = await runDocsTransaction([
      { col: COL, id },
      { col: 'characters', id: bidder.id },
      ...(prevId ? [{ col: 'characters', id: prevId }] : []),
    ], ([freshPost, freshBidder, freshPrev]) => {
      const result = planMarketBid({ post: freshPost, bidder: freshBidder, prevBidder: freshPrev || null, amount: value, buyerUid: _uid(), now, date: _today() });
      return {
        writes: [
          { col: 'characters', id: bidder.id, data: result.bidderPatch },
          ...(result.refund ? [{ col: 'characters', id: result.refund.charId, data: result.refund.patch }] : []),
          { col: COL, id, data: result.postPatch },
        ],
        result,
      };
    });
    _patchLocalChar(bidder.id, plan.bidderPatch);
    if (plan.refund) _patchLocalChar(plan.refund.charId, plan.refund.patch);
    _patchLocalPost(id, plan.postPatch);
    if (plan.outbid) void _notify(plan.outbid.uid, { actor: bidder, postId: id, kind: 'outbid', text: `${_lot(plan.view)} · ${_gold(plan.amount)} (ton offre t’est rendue)` });
    void _notify(plan.view.sellerUid, { actor: bidder, postId: id, kind: 'bid', text: `${_lot(plan.view)} · ${_gold(plan.amount)}` });
    showNotif(`⚖ Offre de ${_gold(plan.amount)} sur ${_lot(plan.view)}${plan.extended ? ' · enchère prolongée de 2 min' : ''}`, 'success');
  } catch (error) {
    _txError(error, 'L’offre n’a pas abouti.');
  } finally {
    MK.busy = false;
    _rerender();
  }
}

// Clôture des enchères échues : faite par le premier client qui les voit
// (aucun serveur). Une transaction par enchère ; si un autre client l'a déjà
// close, la transaction relit le post et abandonne sans rien écrire.
const _closing = new Set();
async function _closeDueAuctions() {
  if (!STATE.user?.uid) return;
  const due = _views().filter(view => view.state === 'open' && auctionEnded(view) && !_closing.has(view.id));
  for (const view of due) {
    _closing.add(view.id);
    try {
      const winnerId = view.bid?.charId || '';
      const plan = await runDocsTransaction([
        { col: COL, id: view.id },
        { col: 'characters', id: view.sellerCharId },
        ...(winnerId ? [{ col: 'characters', id: winnerId }] : []),
      ], ([freshPost, freshSeller, freshWinner]) => {
        const result = planMarketClose({ post: freshPost, seller: freshSeller, winner: freshWinner || null, now: Date.now(), date: _today(), actor: _actor() });
        return {
          writes: [
            ...(result.sellerPatch ? [{ col: 'characters', id: view.sellerCharId, data: result.sellerPatch }] : []),
            ...(result.winnerPatch ? [{ col: 'characters', id: winnerId, data: result.winnerPatch }] : []),
            ...(result.refund ? [{ col: 'characters', id: result.refund.charId, data: result.refund.patch }] : []),
            { col: COL, id: view.id, data: result.postPatch },
          ],
          result: { ...result, sellerOwnerUid: String(freshSeller?.uid || view.sellerUid) },
        };
      });
      if (plan.sellerPatch) _patchLocalChar(view.sellerCharId, plan.sellerPatch);
      if (plan.winnerPatch) _patchLocalChar(winnerId, plan.winnerPatch);
      if (plan.refund) _patchLocalChar(plan.refund.charId, plan.refund.patch);
      _patchLocalPost(view.id, plan.postPatch);
      const lot = _lot(plan.view);
      const seller = { id: view.sellerCharId, nom: view.sellerName };
      if (plan.outcome === 'sold') {
        void _notify(plan.sellerOwnerUid, { actor: plan.view.bid, postId: view.id, kind: 'sale', text: `${lot} · ${_gold(plan.view.bid.amount)} (enchère)` });
        void _notify(plan.view.bid.uid, { actor: seller, postId: view.id, kind: 'won', text: `${lot} · ${_gold(plan.view.bid.amount)}` });
      } else if (plan.outcome === 'failed') {
        void _notify(plan.view.bid.uid, { actor: seller, postId: view.id, kind: 'auction-failed', text: `${lot} : objet indisponible, ton or t’est rendu` });
      } else {
        void _notify(plan.sellerOwnerUid, { actor: seller, postId: view.id, kind: 'auction-unsold', text: `${lot} : aucune offre` });
      }
    } catch (error) {
      // Déjà close par un autre client, ou règles non déployées : rien à faire ici.
      if (!(error instanceof MarketError)) console.debug('[marché] clôture d’enchère reportée', error?.code || error);
    }
  }
  if (due.length) _rerender();
}

// Retire la vente (l'objet n'a pas bougé ; une vente v1 rend son dépôt).
// `confirm: false` : appelant qui a déjà demandé. Renvoie true si c'est fait.
export async function withdrawMarketListing(id, { confirm = true } = {}) {
  if (MK.busy) return false;
  const post = _post(id);
  const view = post ? marketListingView(post) : null;
  if (!view || view.state !== 'open') return false;
  if (!_canManage(view)) { showNotif('Seul le vendeur (ou le MJ) peut retirer cette vente.', 'error'); return false; }
  if (confirm) {
    const ok = await confirmModal(`Retirer <b>${_esc(_lot(view))}</b> de la vente ?<br>${view.auction && view.bid ? `L’offre de ${_esc(view.bid.name)} (${_esc(_gold(view.bid.amount))}) lui est remboursée.` : view.escrow ? `L’objet revient dans l’inventaire de ${_esc(view.sellerName)}.` : 'L’objet reste dans l’inventaire, rien ne change sur la fiche.'}`, {
      title: 'Retirer de la vente', confirmLabel: 'Retirer', danger: true, icon: '↩️',
    }).catch(() => false);
    if (!ok) return false;
  }
  MK.busy = true;
  try {
    const bidderId = view.auction && view.bid ? view.bid.charId : '';
    const reads = [
      { col: COL, id },
      { col: 'characters', id: view.escrow ? view.sellerCharId : (bidderId || view.sellerCharId) },
    ];
    const plan = await runDocsTransaction(reads, ([freshPost, freshChar]) => {
      const result = planMarketWithdraw({
        post: freshPost, seller: view.escrow ? freshChar : null, bidder: bidderId ? freshChar : null,
        force: !!STATE.isAdmin, now: Date.now(), date: _today(), actor: _actor(),
      });
      return {
        writes: [
          ...(result.sellerPatch ? [{ col: 'characters', id: view.sellerCharId, data: result.sellerPatch }] : []),
          ...(result.refund ? [{ col: 'characters', id: result.refund.charId, data: result.refund.patch }] : []),
          { col: COL, id, data: result.postPatch },
        ],
        result,
      };
    });
    if (plan.sellerPatch) _patchLocalChar(view.sellerCharId, plan.sellerPatch);
    if (plan.refund) {
      _patchLocalChar(plan.refund.charId, plan.refund.patch);
      void _notify(plan.refund.uid, { actor: { nom: 'Le MJ' }, postId: id, kind: 'auction-failed', text: `${_lot(plan.view)} : enchère annulée, ton or t’est rendu` });
    }
    _patchLocalPost(id, plan.postPatch);
    showNotif(plan.sellerPatch ? `↩️ ${_lot(plan.view)} est revenu dans l’inventaire de ${view.sellerName}.` : `Vente de ${_lot(plan.view)} retirée.`, 'success');
    return true;
  } catch (error) {
    _txError(error, 'Le retrait n’a pas abouti.');
    return false;
  } finally {
    MK.busy = false;
    _rerender();
  }
}

async function _editPrice(id) {
  if (MK.busy) return;
  const post = _post(id);
  const view = post ? marketListingView(post) : null;
  if (!view || view.state !== 'open' || !_canManage(view)) return;
  const value = await promptModal(`Nouveau prix de <b>${_esc(_lot(view))}</b>, en or :`, {
    title: 'Modifier le prix', default: String(view.price), confirmLabel: 'Enregistrer', required: true,
  }).catch(() => null);
  if (value == null) return;
  const price = normalizeMarketPrice(value);
  if (!price) { showNotif(`Indique un prix entre 1 et ${_gold(MARKET_PRICE_MAX)}.`, 'error'); return; }
  if (price === view.price) return;
  MK.busy = true;
  try {
    const plan = await runDocsTransaction([{ col: COL, id }], ([fresh]) => {
      const result = planMarketPrice({ post: fresh, price, now: Date.now() });
      return { writes: [{ col: COL, id, data: result.postPatch }], result };
    });
    _patchLocalPost(id, plan.postPatch);
    showNotif(`Nouveau prix : ${_gold(plan.price)}.`, 'success');
  } catch (error) {
    _txError(error, 'Le prix n’a pas été modifié.');
  } finally {
    MK.busy = false;
    _rerender();
  }
}

// ══════════════════════════════════════════════
// MISE EN VENTE — modale (Bastion, composeur du mur ou fiche Inventaire)
// ══════════════════════════════════════════════
// Exemplaires de chaque lot déjà proposés dans les ventes ouvertes (v2) du perso.
function _reserved(charId) {
  const out = new Map();
  const loaded = (MK.ownPosts.get(charId) || []).map(normalizeBastionWallPost).filter(isMarketListing);
  mergeMarketPosts(loaded, _posts()).map(marketListingView)
    .filter(v => v.state === 'open' && !v.escrow && v.sellerCharId === charId)
    .forEach(v => { const key = marketItemKey(v.item); out.set(key, (out.get(key) || 0) + v.qty); });
  return out;
}

// Hors du Bastion (fiche Inventaire), ses ventes ouvertes ne sont pas en
// mémoire : on les lit une fois pour ne pas proposer deux fois un exemplaire.
async function _loadOwnPosts(charId) {
  if (!charId || STATE.currentPage === 'bastion' || MK.ownPosts.has(charId)) return;
  const docs = await loadCollectionWhere(COL, 'charId', '==', charId).catch(() => []);
  MK.ownPosts.set(charId, docs || []);
  if (MK.sell?.charId === charId && _sellOpen()) _paintSell();
}

function _sellGroups(char) {
  const inventory = Array.isArray(char?.inventaire) ? char.inventaire : [];
  const worn = new Set(resolveEquippedInventoryIndices(char || {}).values());
  const reserved = _reserved(char?.id);
  const groups = new Map();
  inventory.forEach((item, index) => {
    if (!item || typeof item !== 'object' || isQuestItem(item)) return;
    const key = marketItemKey(item);
    const group = groups.get(key) || { key, item, count: 0, worn: 0 };
    group.count += 1;
    if (worn.has(index)) group.worn += 1;
    groups.set(key, group);
  });
  return [...groups.values()]
    .map(g => ({ ...g, reserved: reserved.get(g.key) || 0, count: g.count - (reserved.get(g.key) || 0) }))
    .filter(g => g.count > 0)
    .sort((a, b) => itemRarity(b.item) - itemRarity(a.item)
    || String(a.item.nom || '').localeCompare(String(b.item.nom || ''), 'fr', { sensitivity: 'base' }));
}

function _sellHtml() {
  const s = MK.sell;
  const chars = getVisibleCharacters({ sorted: true });
  const char = _char(s.charId) || chars[0];
  const groups = _sellGroups(char);
  const group = groups.find(g => g.key === s.key) || null;
  if (group) s.qty = Math.max(1, Math.min(group.count, s.qty));
  const cat = group ? _catalog(group.item) : null;
  const value = group ? getInventoryItemValue(group.item, cat) : 0;
  const resale = group ? _resale(group.item) : 0;
  const upgrades = group ? _upgradesValue(group.item) : 0;
  if (group) _ensureUpgradeSettings([group.item], () => { if (MK.sell && _sellOpen()) _paintSell(); });
  const refs = [value ? `valeur ${_gold(value)}` : '', upgrades ? `améliorations ${_gold(upgrades)}` : '', resale ? `revente boutique ${_gold(resale)}` : ''].filter(Boolean).join(' · ');
  const wornTaken = group ? Math.max(0, s.qty - (group.count - group.worn)) : 0;
  const canSubmit = !!group && !!normalizeMarketPrice(s.price);
  const auction = s.mode === 'auction';
  const modeBtn = (id, label) => `<button type="button" class="bs-mk-seg-btn${s.mode === id ? ' on' : ''}" data-action="_mkSellMode" data-mode="${id}" aria-pressed="${s.mode === id}">${label}</button>`;
  return `<div class="bs-mk-sell">
    <div class="bs-mk-seg" role="group" aria-label="Type de vente">${modeBtn('fixed', '🪙 Prix fixe')}${modeBtn('auction', '⚖ Enchère')}</div>
    ${chars.length > 1 ? `<label class="bs-mk-field"><span>Vendeur</span><select class="input-field" data-change="_mkSellChar">${chars.map(c => `<option value="${_esc(c.id)}"${c.id === char?.id ? ' selected' : ''}>${_esc(c.nom || '?')} · ${_esc(_gold(calcOr(c)))}</option>`).join('')}</select></label>` : ''}
    <div class="bs-mk-field"><span>Objet à vendre</span>
      <div class="bs-mk-pick" role="listbox" aria-label="Objet à vendre">
        ${groups.map(g => `<button type="button" role="option" aria-selected="${g.key === s.key}" class="bs-mk-pick-row${g.key === s.key ? ' on' : ''}"${_rareAttrs(itemRarity(g.item))} data-action="_mkSellItem" data-key="${_esc(g.key)}">
          <span class="bs-mk-gem"></span>
          <span class="bs-mk-txt"><span class="bs-mk-name"><b>${_esc(g.item.nom || 'Sans nom')}</b></span><span class="bs-mk-line">${_esc(itemKind(g.item))}${g.worn ? ' · porté' : ''}</span></span>
          <span class="bs-mk-pick-q">×${g.count}</span>
        </button>`).join('') || `<p class="bs-mk-empty">${_reserved(char?.id).size
          ? `Tout ce que ${_esc(char?.nom || 'ce personnage')} peut vendre est déjà en vente.`
          : `Rien à vendre dans l’inventaire de ${_esc(char?.nom || 'ce personnage')} (les objets de quête ne se vendent pas).`}</p>`}
      </div>
    </div>
    ${group ? `<div class="bs-mk-sell-row">
      <div class="bs-mk-field"><span>Quantité</span>
        <span class="bs-mk-qty"><span class="bs-v-step"><button type="button" data-action="_mkSellQty" data-delta="-1" aria-label="Moins"${s.qty <= 1 ? ' disabled' : ''}>−</button><span>${s.qty}</span><button type="button" data-action="_mkSellQty" data-delta="1" aria-label="Plus"${s.qty >= group.count ? ' disabled' : ''}>+</button></span><small>sur ${group.count}</small></span>
      </div>
      <label class="bs-mk-field"><span>${auction ? 'Prix de départ' : 'Prix du lot'}</span>
        <span class="bs-mk-price-in"><input id="bs-mk-sell-price" type="number" min="1" max="${MARKET_PRICE_MAX}" step="1" inputmode="numeric" value="${_esc(s.price)}" placeholder="${(value + upgrades) || resale || ''}" data-input="_mkSellPrice" data-modal-initial-focus><b>or</b></span>
        ${refs ? `<small>${_esc(refs)}${s.qty > 1 ? ' (par unité)' : ''}</small>` : ''}
      </label>
    </div>
    ${auction ? `<div class="bs-mk-sell-row">
      <label class="bs-mk-field"><span>Durée</span><select class="input-field" data-change="_mkSellDuration">${AUCTION_DURATIONS.map(d => `<option value="${d.id}"${s.duration === d.id ? ' selected' : ''}>${d.label}</option>`).join('')}</select></label>
      <label class="bs-mk-field"><span>Achat immédiat <em>facultatif</em></span>
        <span class="bs-mk-price-in"><input type="number" min="1" max="${MARKET_PRICE_MAX}" step="1" inputmode="numeric" value="${_esc(s.buyNow)}" placeholder="—" data-input="_mkSellBuyNow"><b>or</b></span>
        <small>Doit dépasser le prix de départ.</small>
      </label>
    </div>` : ''}
    <label class="bs-mk-field"><span>Message <em>facultatif</em></span><textarea class="input-field" rows="2" maxlength="1000" data-input="_mkSellText" placeholder="Parfait pour un guerrier, à débattre en réponse…">${_esc(s.text)}</textarea></label>
    <p class="bs-mk-note">ⓘ L’objet <b>reste dans l’inventaire</b> de ${_esc(char?.nom || '?')} jusqu’à ${auction ? 'la fin de l’enchère : il passe alors au meilleur enchérisseur, et son or (bloqué pendant l’enchère) arrive dans sa bourse. Une offre dans les 2 dernières minutes prolonge de 2 min ; dès la première offre, l’enchère ne se retire plus' : 'l’achat : c’est seulement là qu’il passe à l’acheteur, et l’or arrive dans sa bourse'}.${wornTaken ? ' <b>Il est porté</b> : déséquipe-le pour qu’il puisse être acheté.' : ''}${group.reserved ? ` (${group.reserved} déjà en vente.)` : ''}</p>` : ''}
    <div class="bs-mk-sell-ft">
      <button type="button" class="bs-w-btn" data-action="close-modal">Annuler</button>
      <button type="button" class="bs-w-btn bs-w-go" id="bs-mk-sell-go" data-action="_mkSellSubmit"${canSubmit ? '' : ' disabled'}>${auction ? 'Lancer l’enchère' : 'Mettre en vente'}</button>
    </div>
  </div>`;
}

const _SELL_TITLE = '🪙 Mettre en vente au Bastion';
const _SELL_OPTS = { subtitle: 'L’annonce paraît sur le mur et au Marché', accent: '#22c38e' };
// Modale de mise en vente encore affichée (repeinte après un chargement async).
const _sellOpen = () => !!document.querySelector('#modal-overlay.show #modal-body .bs-mk-sell');
function _paintSell({ open = false } = {}) {
  if (open) openModal(_SELL_TITLE, _sellHtml(), _SELL_OPTS);
  else updateModalContent(_SELL_TITLE, _sellHtml(), _SELL_OPTS);
}

// `charId` + `indices` : depuis la fiche Inventaire (objet présélectionné).
// `fromComposer` : le texte du composeur du mur devient le message.
export async function openMarketSellModal({ charId = '', indices = [], fromComposer = false } = {}) {
  const chars = getVisibleCharacters({ sorted: true });
  if (!chars.length) { showNotif('Il faut un personnage de cette aventure pour vendre.', 'error'); return; }
  const char = chars.find(c => c.id === charId)
    || (fromComposer || !charId ? MK.ctx.scopeChar() : null)
    || getDefaultCharForUser(chars, _uid()) || chars[0];
  const first = Array.isArray(indices) && indices.length ? char.inventaire?.[indices[0]] : null;
  await _ensureFeatureCss('bastion').catch(() => {});
  MK.sell = {
    charId: char.id,
    key: first ? marketItemKey(first) : '',
    qty: 1,
    price: '',
    mode: 'fixed',
    duration: '24h',
    buyNow: '',
    text: fromComposer ? String(MK.ctx.draftText() || '') : '',
    fromComposer,
  };
  _paintSell({ open: true });
  void _loadOwnPosts(char.id);
}

function _refreshSellSubmit() {
  const go = document.getElementById('bs-mk-sell-go');
  if (go) go.disabled = !MK.sell?.key || !normalizeMarketPrice(MK.sell?.price);
}

async function _submitSell() {
  const s = MK.sell;
  if (!s || MK.busy) return;
  const char = _char(s.charId);
  const price = normalizeMarketPrice(s.price);
  if (!char || !s.key) { showNotif('Choisis l’objet à vendre.', 'error'); return; }
  if (!price) { showNotif(`Indique un prix entre 1 et ${_gold(MARKET_PRICE_MAX)}.`, 'error'); return; }
  const identity = {
    uid: _uid(),
    charId: char.id,
    charName: char.nom || 'Personnage',
    // Un portrait base64 alourdirait l'annonce : URL courte seulement (comme le mur).
    charImage: /^https?:/i.test(char.photo || char.image || '') ? (char.photo || char.image) : '',
  };
  const id = newDocId(COL);
  const now = Date.now();
  const go = document.getElementById('bs-mk-sell-go');
  if (go) go.disabled = true;
  MK.busy = true;
  try {
    const result = await runDocsTransaction([{ col: 'characters', id: char.id }], ([fresh]) => {
      if (!fresh) throw new MarketError('seller', 'Personnage introuvable.');
      // Rien ne quitte la fiche : on vérifie seulement qu'il reste assez d'exemplaires.
      const plan = planMarketListing({ seller: fresh, key: s.key, qty: s.qty, price, reserved: _reserved(char.id).get(s.key) || 0 });
      const post = {
        kind: 'post', ...identity, type: 'offre', text: String(s.text || '').trim().slice(0, 4000),
        mediaId: '', imageCount: 0, imagePreview: '',
        status: 'active', pinned: false, commentCount: 0, reactions: {}, ts: now,
        listing: buildMarketListing({
          items: plan.items, price: plan.price, sellerUid: identity.uid, sellerCharId: char.id,
          auction: s.mode === 'auction'
            ? { endsAt: now + (AUCTION_DURATIONS.find(d => d.id === s.duration) || AUCTION_DURATIONS[1]).ms, buyNow: s.buyNow }
            : null,
        }),
      };
      return {
        writes: [{ col: COL, id, data: post, op: 'set' }],
        result: { post, plan },
      };
    });
    const created = { id, ...result.post };
    MK.offers = mergeMarketPosts(MK.offers, [normalizeBastionWallPost(created)]);
    MK.ctx.onPosted(created);
    touchBastionWallActivity();
    if (s.fromComposer) MK.ctx.clearDraft();
    MK.sell = null;
    closeModalDirect();
    MK.ui.sel = id;
    MK.ui.sheetOpen = false;
    const lot = `${result.plan.items[0]?.nom || 'Objet'}${result.plan.qty > 1 ? ` ×${result.plan.qty}` : ''}`;
    showNotif(`🪙 ${lot} mis en vente au Bastion · ${_gold(result.plan.price)}${result.plan.worn ? ' — pense à le déséquiper avant l’achat' : ''}`, 'success');
    _rerender();
  } catch (error) {
    _txError(error, 'La mise en vente n’a pas abouti.');
    _refreshSellSubmit();
  } finally {
    MK.busy = false;
  }
}

registerActions({
  _mkSelect:      (btn) => _select(btn.dataset.id || ''),
  _mkCloseSheet:  () => _closeSheet(),
  _mkOpenListing: (btn) => _openListing(btn.dataset.id || ''),
  _mkJumpPost:    (btn) => MK.ctx.openPost(btn.dataset.id || ''),
  _mkFamily:      (btn) => { MK.ui.family = btn.dataset.family || 'all'; _rerender(); },
  _mkSort:        (el) => { MK.ui.sort = el.value || 'recent'; _rerender(); },
  _mkHistory:     () => { MK.ui.history = !MK.ui.history; _rerender(); },
  // Saisie : seule la liste est redessinée (le champ garde le focus).
  _mkSearch:      (el) => {
    MK.ui.query = el.value || '';
    const list = document.getElementById('bs-mk-list');
    if (list) list.innerHTML = _listHtml(_views());
  },
  _mkBuy:         (btn) => _buy(btn.dataset.id || '', btn.dataset.price),
  _mkBid:         (btn) => _bid(btn.dataset.id || '', btn.dataset.min),
  _mkWithdraw:    (btn) => withdrawMarketListing(btn.dataset.id || ''),
  _mkPrice:       (btn) => _editPrice(btn.dataset.id || ''),
  _mkOpenSell:    (btn) => openMarketSellModal({ fromComposer: btn?.dataset?.from === 'composer' }),
  _mkSellChar:    (el) => { if (MK.sell) { MK.sell = { ...MK.sell, charId: el.value, key: '', qty: 1 }; _paintSell(); void _loadOwnPosts(el.value); } },
  _mkSellItem:    (btn) => { if (MK.sell) { MK.sell.key = btn.dataset.key || ''; MK.sell.qty = 1; _paintSell(); } },
  _mkSellQty:     (btn) => { if (MK.sell) { MK.sell.qty = Math.max(1, MK.sell.qty + (Number(btn.dataset.delta) || 0)); _paintSell(); } },
  _mkSellPrice:   (el) => { if (MK.sell) { MK.sell.price = el.value; _refreshSellSubmit(); } },
  _mkSellText:    (el) => { if (MK.sell) MK.sell.text = el.value || ''; },
  _mkSellMode:    (btn) => { if (MK.sell) { MK.sell.mode = btn.dataset.mode === 'auction' ? 'auction' : 'fixed'; _paintSell(); } },
  _mkSellDuration:(el) => { if (MK.sell) MK.sell.duration = el.value || '24h'; },
  _mkSellBuyNow:  (el) => { if (MK.sell) MK.sell.buyNow = el.value || ''; },
  _mkSellSubmit:  () => _submitSell(),
});
