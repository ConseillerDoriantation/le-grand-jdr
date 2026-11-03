// ══════════════════════════════════════════════════════════════════════════════
// BASTION-MARKET-UI — Vente d'objets sur le mur du Bastion
// ──────────────────────────────────────────────────────────────────────────────
// Une vente est une annonce « Offre » du mur qui porte l'objet en dépôt (règles
// pures : shared/bastion-market.js). Ce module rend l'objet joint dans le fil, sa
// fiche (modale « Voir l'objet ») et la modale de mise en vente — ouvrable aussi
// depuis la fiche objet de l'Inventaire, sans que le Bastion soit chargé.
// bastion.js injecte son contexte (initBastionMarket).
// Chaque opération = UNE transaction (annonce + fiches) : tout ou rien.
// ══════════════════════════════════════════════════════════════════════════════
import { STATE } from '../core/state.js';
import { registerActions } from '../core/actions.js';
import { _ensureFeatureCss } from '../core/navigation.js';
import { addToCol, getCachedCollection } from '../data/firestore.js';
import { newDocId, runDocsTransaction } from '../data/firestore-transactions.js';
import { showNotif, notifySaveError } from '../shared/notifications.js';
import { openModal, closeModalDirect, confirmModal, promptModal, updateModalContent } from '../shared/modal.js';
import { _esc } from '../shared/html.js';
import { timeAgo } from '../shared/relative-time.js';
import { calcOr, getDefaultCharForUser, getItemEffectText, statShort } from '../shared/char-stats.js';
import { RARETE_NAMES, _rareteColor } from '../shared/rarity.js';
import { getInventoryItemImage, getInventoryItemResaleValue, getInventoryItemValue } from '../shared/inventory-utils.js';
import { getItemTraits, resolveEquippedInventoryIndices } from '../shared/equipment-utils.js';
import { characterBuildsForStorage, patchBuildLocally } from '../shared/character-builds.js';
import { getVisibleCharacters } from '../shared/character-state.js';
import { charSession } from '../shared/char-session.js';
import { touchBastionWallActivity } from '../shared/bastion-signal.js';
import { weaponHandsLabel } from '../shared/weapon-family.js';
import {
  isArmorItem, isQuestItem, isWeaponItem, itemBonuses, itemChips, itemCompareRows,
  itemCompareSlot, itemDamageText, itemKind, itemRarity, itemSigned,
} from '../shared/item-facts.js';
import {
  MARKET_PRICE_MAX, MarketError, buildMarketListing, isMarketListing, marketItemKey, marketListingView,
  normalizeMarketPrice, planMarketListing, planMarketPrice, planMarketPurchase, planMarketWithdraw,
} from '../shared/bastion-market.js';

export { isMarketListing };

const COL = 'bastionAnnonces';
const MK = {
  // Contexte injecté par bastion.js ; valeurs neutres hors de la page Bastion.
  ctx: {
    posts: () => [],
    scopeChar: () => null,
    rerender: () => {},
    patchPost: () => {},
    onPosted: () => {},
    draftText: () => '',
    clearDraft: () => {},
  },
  busy: false,
  sell: null,      // état de la modale de mise en vente
};

export function initBastionMarket(ctx = {}) {
  MK.ctx = { ...MK.ctx, ...ctx };
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
const _post = id => (MK.ctx.posts() || []).find(post => post.id === id && isMarketListing(post)) || null;
const _isMine = view => !!view && view.sellerUid === _uid();
const _canManage = view => _isMine(view) || !!STATE.isAdmin;

// Acheteur = personnage « Je joue » du Bastion (sinon le personnage principal).
function _buyer() {
  const scoped = MK.ctx.scopeChar();
  if (scoped) return scoped;
  const chars = getVisibleCharacters({ sorted: true });
  return getDefaultCharForUser(chars, _uid()) || chars[0] || null;
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

function _txError(error, fallback) {
  if (error instanceof MarketError || error?.name === 'MarketError') {
    showNotif(error.message, 'error');
    return;
  }
  if (error?.code === 'permission-denied') {
    console.warn('[vente] refusé par les règles Firestore (voir docs/firestore-rules.md)', error);
    showNotif('Refusé par Firestore : le MJ doit déployer les règles de vente du Bastion.', 'error');
    return;
  }
  notifySaveError(error, fallback);
}

// Fin d'opération : la modale « Voir l'objet » se ferme, le fil se redessine.
function _afterWrite() {
  if (document.querySelector('#modal-overlay.show #modal-body > .bs-mk-sheet')) closeModalDirect();
  _rerender();
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

function _stateLine(view) {
  if (view.state === 'sold') return `✓ Vendu à ${_esc(view.buyerName || '?')}${view.soldAt ? ` · ${_ago(view.soldAt)}` : ''}`;
  if (view.state === 'withdrawn') return 'Retirée de la vente';
  return `Vendu par ${_esc(view.sellerName)}${view.ts ? ` · ${_ago(view.ts)}` : ''}`;
}

// Bouton d'achat : désactivé (avec la raison) plutôt qu'une erreur au clic.
function _buyButton(view, cls = '') {
  const buyer = _buyer();
  if (!buyer) return '';
  const missing = view.price - calcOr(buyer);
  return missing > 0
    ? `<button type="button" class="bs-w-btn bs-w-go ${cls}" disabled title="Il manque ${_esc(_gold(missing))} à ${_esc(buyer.nom || 'ce personnage')}">Acheter</button>`
    : `<button type="button" class="bs-w-btn bs-w-go ${cls}" data-action="_mkBuy" data-id="${_esc(view.id)}" data-price="${view.price}" title="Acheter avec ${_esc(buyer.nom || 'ce personnage')}">Acheter</button>`;
}

// ══════════════════════════════════════════════
// FIL DU MUR — l'objet joint à l'annonce
// ══════════════════════════════════════════════
export function marketWallBlockHtml(post) {
  const view = marketListingView(post);
  const item = view.item;
  const chips = itemChips(item).slice(0, 3).map(_chipHtml).join('');
  let actions = '';
  if (view.state === 'open') {
    actions = _isMine(view)
      ? `<button type="button" class="bs-w-btn bs-w-sm" data-action="_mkPrice" data-id="${_esc(view.id)}">Modifier le prix</button><button type="button" class="bs-w-btn bs-w-sm" data-action="_mkWithdraw" data-id="${_esc(view.id)}">Retirer</button>`
      : _buyButton(view, 'bs-w-sm');
  } else {
    actions = `<span class="bs-mk-state is-${view.state}">${_stateLine(view)}</span>`;
  }
  return `<div class="bs-mk-lot${view.state !== 'open' ? ' is-closed' : ''}"${_rareAttrs(view.rarity)}>
    <button type="button" class="bs-mk-lot-item" data-action="_mkView" data-id="${_esc(view.id)}" title="Voir l’objet">
      ${_icon(item)}
      <span class="bs-mk-txt"><span class="bs-mk-name"><b>${_esc(view.name)}</b>${view.qty > 1 ? `<em>×${view.qty}</em>` : ''}</span><span class="bs-mk-line">${_esc(_rareName(view.rarity))} · ${_esc(itemKind(item))}</span></span>
      ${chips ? `<span class="bs-mk-chips">${chips}</span>` : ''}
    </button>
    <div class="bs-mk-lot-ft">
      <span class="bs-mk-price">${_esc(_gold(view.price))}${view.qty > 1 ? `<small>${_esc(_gold(view.unitPrice))} / u.</small>` : ''}</span>
      <span class="bs-mk-lot-acts">${actions}</span>
    </div>
  </div>`;
}

// Ligne courte de la colonne « Offres & demandes ».
export function marketSideLabel(post) {
  const view = marketListingView(post);
  return `${_lot(view)} · ${_gold(view.price)}`;
}

// ══════════════════════════════════════════════
// FICHE DE L'OBJET — modale « Voir l'objet »
// ══════════════════════════════════════════════
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
  if (view.state !== 'open') return '';
  const buyer = _buyer();
  let main = '';
  let hint = '';
  if (_isMine(view)) {
    main = `<button type="button" class="bs-w-btn" data-action="_mkPrice" data-id="${_esc(view.id)}">Modifier le prix</button><button type="button" class="bs-w-btn" data-action="_mkWithdraw" data-id="${_esc(view.id)}">Retirer de la vente</button>`;
    hint = 'Ta vente : l’objet est en dépôt jusqu’à l’achat ou au retrait.';
  } else if (buyer) {
    const missing = view.price - calcOr(buyer);
    main = _buyButton(view, 'bs-mk-buy');
    hint = missing > 0
      ? `Il manque ${_esc(_gold(missing))} à ${_esc(buyer.nom || 'ce personnage')}.`
      : `${_esc(buyer.nom || 'Ton personnage')} : ${_esc(_gold(calcOr(buyer)))} → ${_esc(_gold(calcOr(buyer) - view.price))}`;
  } else {
    hint = 'Il faut un personnage de cette aventure pour acheter.';
  }
  const moderate = !_isMine(view) && STATE.isAdmin
    ? `<div class="bs-mk-acts-row"><button type="button" class="bs-w-btn bs-w-sm bs-mk-ghost" data-action="_mkWithdraw" data-id="${_esc(view.id)}">Retirer (MJ)</button></div>` : '';
  return `<footer class="bs-mk-acts">
    <div class="bs-mk-acts-price"><b>${_esc(_gold(view.price))}</b>${view.qty > 1 ? `<small>${_esc(_gold(view.unitPrice))} / u.</small>` : ''}</div>
    ${main ? `<div class="bs-mk-acts-main">${main}</div>` : ''}
    ${hint ? `<p class="bs-mk-hint">${hint}</p>` : ''}
    ${moderate}
  </footer>`;
}

function _sheetHtml(view) {
  const item = view.item;
  const cat = _catalog(item);
  const bonuses = itemBonuses(item);
  const armor = isArmorItem(item);
  const traits = getItemTraits(item);
  const effect = String(getItemEffectText(item) || '').trim();
  const description = String(item.description || '').trim();
  const value = getInventoryItemValue(item, cat);
  const resale = getInventoryItemResaleValue(item, cat);
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
    _fact('Revente', resale ? _gold(resale) + per : ''),
  ].join('');
  const bonusHtml = bonuses.filter(b => b.v && !(armor && b.k === 'CA'))
    .map(b => _chipHtml({ t: `${b.k} ${itemSigned(b.v)}`, cls: b.cls })).join('');
  return `<div class="bs-mk-sheet"${_rareAttrs(view.rarity)} aria-label="Fiche de ${_esc(view.name)}">
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
  </div>`;
}

function _openView(id) {
  const post = _post(id);
  if (!post) return;
  openModal('🪙 Objet en vente', _sheetHtml(marketListingView(post)), { subtitle: 'Annonce du mur du Bastion', accent: '#22c38e' });
}

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
  const balance = calcOr(buyer);
  const expectedPrice = Number.isFinite(Number(shownPrice)) ? Number(shownPrice) : view.price;
  const ok = await confirmModal(`<b>${_esc(_lot(view))}</b> vendu par <b>${_esc(view.sellerName)}</b><br>
    <span style="display:inline-block;margin-top:.45rem">Bourse de ${_esc(buyer.nom || '?')} : ${_esc(_gold(balance))} → <b>${_esc(_gold(balance - expectedPrice))}</b></span>`, {
    title: 'Acheter',
    confirmLabel: `Acheter · ${_gold(expectedPrice)}`,
    danger: false,
    icon: '🪙',
  }).catch(() => false);
  if (!ok) return;
  MK.busy = true;
  const now = Date.now();
  try {
    const result = await runDocsTransaction([
      { col: COL, id },
      { col: 'characters', id: buyer.id },
      { col: 'characters', id: view.sellerCharId },
    ], ([freshPost, freshBuyer, freshSeller]) => {
      const plan = planMarketPurchase({
        post: freshPost, buyer: freshBuyer, seller: freshSeller, buyerUid: _uid(),
        expectedPrice, now, date: _today(), actor: _actor(),
      });
      return {
        writes: [
          { col: 'characters', id: buyer.id, data: plan.buyerPatch },
          { col: 'characters', id: view.sellerCharId, data: plan.sellerPatch },
          { col: COL, id, data: plan.postPatch },
        ],
        result: { ...plan, sellerOwnerUid: String(freshSeller?.uid || '') },
      };
    });
    _patchLocalChar(buyer.id, result.buyerPatch);
    _patchLocalChar(view.sellerCharId, result.sellerPatch);
    MK.ctx.patchPost(id, result.postPatch);
    void _notifySale(result.view, buyer, id, result.sellerOwnerUid || result.view.sellerUid);
    showNotif(`🪙 ${_lot(result.view)} rejoint l’inventaire de ${buyer.nom || '?'} · −${_gold(result.view.price)}`, 'success');
  } catch (error) {
    _txError(error, 'L’achat n’a pas abouti.');
  } finally {
    MK.busy = false;
    _afterWrite();
  }
}

// Le propriétaire du personnage vendeur est prévenu par la cloche du mur.
async function _notifySale(view, buyer, postId, targetUid) {
  if (!targetUid || targetUid === _uid()) return;
  await addToCol('bastionWallNotifications', {
    targetUid,
    actorUid: _uid(),
    actorCharId: buyer.id || '',
    actorName: buyer.nom || 'Personnage',
    postId,
    kind: 'sale',
    text: `${_lot(view)} · ${_gold(view.price)}`.slice(0, 180),
    ts: Date.now(),
  }, { silent: true }).catch(error => console.debug('[vente] notification indisponible', error?.code || error));
}

// Rend l'objet au vendeur. `confirm: false` : appelant qui a déjà demandé
// (suppression de l'annonce). Renvoie true si l'objet est bien revenu.
export async function withdrawMarketListing(id, { confirm = true } = {}) {
  if (MK.busy) return false;
  const post = _post(id);
  const view = post ? marketListingView(post) : null;
  if (!view || view.state !== 'open') return false;
  if (!_canManage(view)) { showNotif('Seul le vendeur (ou le MJ) peut retirer cette vente.', 'error'); return false; }
  if (confirm) {
    const ok = await confirmModal(`Retirer <b>${_esc(_lot(view))}</b> de la vente ?<br>L’objet revient dans l’inventaire de ${_esc(view.sellerName)}.`, {
      title: 'Retirer de la vente', confirmLabel: 'Retirer', danger: true, icon: '↩️',
    }).catch(() => false);
    if (!ok) return false;
  }
  MK.busy = true;
  try {
    const plan = await runDocsTransaction([
      { col: COL, id },
      { col: 'characters', id: view.sellerCharId },
    ], ([freshPost, freshSeller]) => {
      const result = planMarketWithdraw({ post: freshPost, seller: freshSeller, now: Date.now(), actor: _actor() });
      return {
        writes: [
          { col: 'characters', id: view.sellerCharId, data: result.sellerPatch },
          { col: COL, id, data: result.postPatch },
        ],
        result,
      };
    });
    _patchLocalChar(view.sellerCharId, plan.sellerPatch);
    MK.ctx.patchPost(id, plan.postPatch);
    showNotif(`↩️ ${_lot(plan.view)} est revenu dans l’inventaire de ${view.sellerName}.`, 'success');
    return true;
  } catch (error) {
    _txError(error, 'Le retrait n’a pas abouti.');
    return false;
  } finally {
    MK.busy = false;
    _afterWrite();
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
    MK.ctx.patchPost(id, plan.postPatch);
    showNotif(`Nouveau prix : ${_gold(plan.price)}.`, 'success');
  } catch (error) {
    _txError(error, 'Le prix n’a pas été modifié.');
  } finally {
    MK.busy = false;
    _afterWrite();
  }
}

// ══════════════════════════════════════════════
// MISE EN VENTE — modale (composeur du mur ou fiche Inventaire)
// ══════════════════════════════════════════════
function _sellGroups(char) {
  const inventory = Array.isArray(char?.inventaire) ? char.inventaire : [];
  const worn = new Set(resolveEquippedInventoryIndices(char || {}).values());
  const groups = new Map();
  inventory.forEach((item, index) => {
    if (!item || typeof item !== 'object' || isQuestItem(item)) return;
    const key = marketItemKey(item);
    const group = groups.get(key) || { key, item, count: 0, worn: 0 };
    group.count += 1;
    if (worn.has(index)) group.worn += 1;
    groups.set(key, group);
  });
  return [...groups.values()].sort((a, b) => itemRarity(b.item) - itemRarity(a.item)
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
  const resale = group ? getInventoryItemResaleValue(group.item, cat) : 0;
  const refs = [value ? `valeur ${_gold(value)}` : '', resale ? `revente boutique ${_gold(resale)}` : ''].filter(Boolean).join(' · ');
  const wornTaken = group ? Math.max(0, s.qty - (group.count - group.worn)) : 0;
  const canSubmit = !!group && !!normalizeMarketPrice(s.price);
  return `<div class="bs-mk-sell">
    ${chars.length > 1 ? `<label class="bs-mk-field"><span>Vendeur</span><select class="input-field" data-change="_mkSellChar">${chars.map(c => `<option value="${_esc(c.id)}"${c.id === char?.id ? ' selected' : ''}>${_esc(c.nom || '?')} · ${_esc(_gold(calcOr(c)))}</option>`).join('')}</select></label>` : ''}
    <div class="bs-mk-field"><span>Objet à vendre</span>
      <div class="bs-mk-pick" role="listbox" aria-label="Objet à vendre">
        ${groups.map(g => `<button type="button" role="option" aria-selected="${g.key === s.key}" class="bs-mk-pick-row${g.key === s.key ? ' on' : ''}"${_rareAttrs(itemRarity(g.item))} data-action="_mkSellItem" data-key="${_esc(g.key)}">
          <span class="bs-mk-gem"></span>
          <span class="bs-mk-txt"><span class="bs-mk-name"><b>${_esc(g.item.nom || 'Sans nom')}</b></span><span class="bs-mk-line">${_esc(itemKind(g.item))}${g.worn ? ' · porté' : ''}</span></span>
          <span class="bs-mk-pick-q">×${g.count}</span>
        </button>`).join('') || `<p class="bs-mk-empty">Rien à vendre dans l’inventaire de ${_esc(char?.nom || 'ce personnage')} (les objets de quête ne se vendent pas).</p>`}
      </div>
    </div>
    ${group ? `<div class="bs-mk-sell-row">
      <div class="bs-mk-field"><span>Quantité</span>
        <span class="bs-mk-qty"><span class="bs-v-step"><button type="button" data-action="_mkSellQty" data-delta="-1" aria-label="Moins"${s.qty <= 1 ? ' disabled' : ''}>−</button><span>${s.qty}</span><button type="button" data-action="_mkSellQty" data-delta="1" aria-label="Plus"${s.qty >= group.count ? ' disabled' : ''}>+</button></span><small>sur ${group.count}</small></span>
      </div>
      <label class="bs-mk-field"><span>Prix du lot</span>
        <span class="bs-mk-price-in"><input id="bs-mk-sell-price" type="number" min="1" max="${MARKET_PRICE_MAX}" step="1" inputmode="numeric" value="${_esc(s.price)}" placeholder="${value || resale || ''}" data-input="_mkSellPrice" data-modal-initial-focus><b>or</b></span>
        ${refs ? `<small>${_esc(refs)}${s.qty > 1 ? ' (par unité)' : ''}</small>` : ''}
      </label>
    </div>
    <label class="bs-mk-field"><span>Message <em>facultatif</em></span><textarea class="input-field" rows="2" maxlength="1000" data-input="_mkSellText" placeholder="Parfait pour un guerrier, à débattre en réponse…">${_esc(s.text)}</textarea></label>
    <p class="bs-mk-note">ⓘ L’objet part <b>en dépôt</b> : il quitte l’inventaire de ${_esc(char?.nom || '?')}${wornTaken ? ' et <b>sera déséquipé</b>' : ''}, puis revient si tu retires la vente. Vendu, l’or arrive directement dans sa bourse.</p>` : ''}
    <div class="bs-mk-sell-ft">
      <button type="button" class="bs-w-btn" data-action="close-modal">Annuler</button>
      <button type="button" class="bs-w-btn bs-w-go" id="bs-mk-sell-go" data-action="_mkSellSubmit"${canSubmit ? '' : ' disabled'}>Mettre en vente</button>
    </div>
  </div>`;
}

const _SELL_TITLE = '🪙 Mettre en vente au Bastion';
const _SELL_OPTS = { subtitle: 'L’annonce paraît sur le mur du Bastion', accent: '#22c38e' };
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
    text: fromComposer ? String(MK.ctx.draftText() || '') : '',
    fromComposer,
  };
  _paintSell({ open: true });
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
      const plan = planMarketListing({ seller: fresh, key: s.key, qty: s.qty, price, now, actor: _actor() });
      const payload = { inventaire: plan.inventaire, inventoryHistory: plan.inventoryHistory };
      if (plan.equipSync.changed) {
        // Même séquence que « Donner » : équipement réindexé + build actif à jour.
        const copy = { ...fresh };
        payload.equipement = plan.equipSync.equipement;
        payload.statsBonus = plan.equipSync.statsBonus;
        patchBuildLocally(copy, { equipement: plan.equipSync.equipement, statsBonus: plan.equipSync.statsBonus });
        payload.builds = characterBuildsForStorage(copy);
        payload.activeBuildId = copy.activeBuildId;
      }
      const post = {
        kind: 'post', ...identity, type: 'offre', text: String(s.text || '').trim().slice(0, 4000),
        mediaId: '', imageCount: 0, imagePreview: '',
        status: 'active', pinned: false, commentCount: 0, reactions: {}, ts: now,
        listing: buildMarketListing({ items: plan.items, price: plan.price, sellerUid: identity.uid, sellerCharId: char.id }),
      };
      return {
        writes: [
          { col: 'characters', id: char.id, data: payload },
          { col: COL, id, data: post, op: 'set' },
        ],
        result: { post, payload, plan },
      };
    });
    _patchLocalChar(char.id, result.payload);
    MK.ctx.onPosted({ id, ...result.post });
    touchBastionWallActivity();
    if (s.fromComposer) MK.ctx.clearDraft();
    MK.sell = null;
    closeModalDirect();
    const lot = `${result.plan.items[0]?.nom || 'Objet'}${result.plan.qty > 1 ? ` ×${result.plan.qty}` : ''}`;
    showNotif(`🪙 ${lot} mis en vente au Bastion · ${_gold(result.plan.price)}${result.plan.unequipped ? ' (déséquipé)' : ''}`, 'success');
    if (STATE.currentPage === 'characters') {
      charSession.renderSheet?.(_char(char.id) || char, charSession.getCurrentCharTab() || 'inventaire');
    }
    _rerender();
  } catch (error) {
    _txError(error, 'La mise en vente n’a pas abouti.');
    _refreshSellSubmit();
  } finally {
    MK.busy = false;
  }
}

registerActions({
  _mkView:        (btn) => _openView(btn.dataset.id || ''),
  _mkBuy:         (btn) => _buy(btn.dataset.id || '', btn.dataset.price),
  _mkWithdraw:    (btn) => withdrawMarketListing(btn.dataset.id || ''),
  _mkPrice:       (btn) => _editPrice(btn.dataset.id || ''),
  _mkOpenSell:    (btn) => openMarketSellModal({ fromComposer: btn?.dataset?.from === 'composer' }),
  _mkSellChar:    (el) => { if (MK.sell) { MK.sell = { ...MK.sell, charId: el.value, key: '', qty: 1 }; _paintSell(); } },
  _mkSellItem:    (btn) => { if (MK.sell) { MK.sell.key = btn.dataset.key || ''; MK.sell.qty = 1; _paintSell(); } },
  _mkSellQty:     (btn) => { if (MK.sell) { MK.sell.qty = Math.max(1, MK.sell.qty + (Number(btn.dataset.delta) || 0)); _paintSell(); } },
  _mkSellPrice:   (el) => { if (MK.sell) { MK.sell.price = el.value; _refreshSellSubmit(); } },
  _mkSellText:    (el) => { if (MK.sell) MK.sell.text = el.value || ''; },
  _mkSellSubmit:  () => _submitSell(),
});
