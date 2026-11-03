// ══════════════════════════════════════════════════════════════════════════════
// BASTION-MARKET — Marché du Bastion : logique pure (ni DOM ni Firebase)
// ──────────────────────────────────────────────────────────────────────────────
// Une vente = une publication `offre` du mur qui porte `listing` : les unités
// MISES EN DÉPÔT (retirées de l'inventaire du vendeur à la publication), le prix
// du lot et, une fois vendue, l'acheteur. Le statut du post EST l'état de la
// vente : active = en vente · resolved = vendue · cancelled = retirée (objet
// rendu). Une vente close ne se rouvre jamais : l'objet a déjà changé de main.
//
// Les plans calculent les écritures exactes d'une transaction à partir des
// documents FRAIS qu'elle a lus ; ils lèvent MarketError (message prêt pour le
// joueur) quand la vente n'est plus possible — la transaction n'écrit alors rien.
// ══════════════════════════════════════════════════════════════════════════════
import { calcOr } from './char-stats.js';
import { resolveEquippedInventoryIndices, syncEquipmentAfterInventoryMutation } from './equipment-utils.js';
import { inventoryHistoryPayload, makeInventoryHistoryEntry } from './inventory-history.js';
import { isQuestItem, itemGroupKey, itemRarity } from './item-facts.js';

export const MARKET_PRICE_MAX = 1_000_000;
export const MARKET_QTY_MAX = 50;
export const MARKET_SOURCE = 'Marché du Bastion';

export class MarketError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'MarketError';
    this.code = code;
  }
}

const _gold = n => `${Number(n || 0).toLocaleString('fr-FR')} or`;

// Même clé de regroupement que l'Inventaire v11 : une ligne du sac = un lot.
export const marketItemKey = itemGroupKey;

// Prix entier en or, 0 si invalide (vide, ≤ 0 ou au-delà du plafond).
export function normalizeMarketPrice(value) {
  const n = Math.round(Number(value));
  return Number.isFinite(n) && n >= 1 && n <= MARKET_PRICE_MAX ? n : 0;
}

export function isMarketListing(post) {
  return post?.type === 'offre' && !!post.listing && typeof post.listing === 'object'
    && Array.isArray(post.listing.items) && post.listing.items.length > 0;
}

export function marketListingState(post) {
  if (post?.status === 'resolved') return 'sold';
  if (post?.status === 'cancelled') return 'withdrawn';
  return 'open';
}

// Vue normalisée d'une vente (lecture seule) : ce que montrent le mur et le Marché.
export function marketListingView(post = {}) {
  const listing = post.listing || {};
  const items = (Array.isArray(listing.items) ? listing.items : []).filter(item => item && typeof item === 'object');
  const item = items[0] || {};
  const qty = Math.max(1, items.length);
  const price = Math.max(0, Math.round(Number(listing.price) || 0));
  return {
    id: String(post.id || ''),
    state: marketListingState(post),
    item, items, qty, price,
    unitPrice: Math.round(price / qty * 100) / 100,
    name: String(item.nom || listing.name || 'Objet'),
    rarity: itemRarity(item),
    sellerUid: String(listing.sellerUid || post.uid || ''),
    sellerCharId: String(listing.sellerCharId || post.charId || ''),
    sellerName: String(post.charName || post.author || 'Personnage'),
    buyerUid: String(listing.buyerUid || ''),
    buyerCharId: String(listing.buyerCharId || ''),
    buyerName: String(listing.buyerName || ''),
    soldAt: Number(listing.soldAt) || 0,
    ts: Number(post.ts) || 0,
    text: String(post.text || ''),
  };
}

// Un même post peut arriver par deux flux (mur récent + ventes ouvertes) :
// la version la plus récemment modifiée l'emporte.
export function mergeMarketPosts(...lists) {
  const byId = new Map();
  lists.flat().forEach(post => {
    if (!post?.id) return;
    const known = byId.get(post.id);
    const at = p => Math.max(Number(p?.updatedAt) || 0, Number(p?.ts) || 0);
    if (!known || at(post) >= at(known)) byId.set(post.id, post);
  });
  return [...byId.values()];
}

export function sortMarketViews(views = [], sort = 'recent') {
  const list = [...views];
  if (sort === 'price-asc') return list.sort((a, b) => a.price - b.price || b.ts - a.ts);
  if (sort === 'price-desc') return list.sort((a, b) => b.price - a.price || b.ts - a.ts);
  if (sort === 'rarity') return list.sort((a, b) => b.rarity - a.rarity || b.ts - a.ts);
  return list.sort((a, b) => b.ts - a.ts);
}

// Livre de compte après une ligne de marché. Très anciennes fiches à champ `or`
// seul : sans le report du solde initial, la première ligne ferait disparaître
// leur argent (calcOr bascule alors sur le livre de compte).
export function marketLedgerPayload(character, delta, libelle, date) {
  const compte = { recettes: [], depenses: [], ...(character?.compte || {}) };
  const recettes = [...(compte.recettes || [])];
  const depenses = [...(compte.depenses || [])];
  if (!recettes.length && !depenses.length && calcOr(character) > 0) {
    recettes.push({ date, libelle: 'Solde initial', montant: calcOr(character) });
  }
  const montant = Math.abs(Math.round(Number(delta) || 0));
  if (montant) (delta < 0 ? depenses : recettes).push({ date, libelle: String(libelle || 'Marché').slice(0, 100), montant });
  return { ...compte, recettes, depenses };
}

const _lotLabel = view => `${view.name}${view.qty > 1 ? ` ×${view.qty}` : ''}`;
const _copies = items => items.map(item => JSON.parse(JSON.stringify(item)));

// Mise en vente : prend `qty` unités du lot `key` (rangées d'abord, équipées
// ensuite) dans l'inventaire FRAIS du vendeur. `equipSync` indique s'il faut
// réécrire l'équipement (objet porté retiré, index décalés).
export function planMarketListing({ seller, key, qty = 1, price, now = Date.now(), actor = {} } = {}) {
  const amount = normalizeMarketPrice(price);
  if (!amount) throw new MarketError('price', `Indique un prix entre 1 et ${_gold(MARKET_PRICE_MAX)}.`);
  const wanted = Math.max(1, Math.min(MARKET_QTY_MAX, Math.floor(Number(qty) || 1)));
  const inventory = Array.isArray(seller?.inventaire) ? seller.inventaire : [];
  const matching = inventory.map((item, index) => ({ item, index }))
    .filter(({ item }) => item && typeof item === 'object' && marketItemKey(item) === key);
  if (matching.some(({ item }) => isQuestItem(item))) throw new MarketError('quest', 'Un objet de quête ne se vend pas.');
  const worn = new Set(resolveEquippedInventoryIndices(seller || {}).values());
  const ordered = [...matching.filter(m => !worn.has(m.index)), ...matching.filter(m => worn.has(m.index))];
  if (!ordered.length) throw new MarketError('missing', 'Cet objet n’est plus dans l’inventaire.');
  if (ordered.length < wanted) throw new MarketError('missing', `Il ne reste que ${ordered.length} exemplaire${ordered.length > 1 ? 's' : ''} dans l’inventaire.`);
  const taken = ordered.slice(0, wanted).map(m => m.index);
  const takenSet = new Set(taken);
  const items = _copies(taken.map(index => inventory[index]));
  return {
    items,
    qty: wanted,
    price: amount,
    removedIndices: taken,
    unequipped: taken.some(index => worn.has(index)),
    inventaire: inventory.filter((_, index) => !takenSet.has(index)),
    equipSync: syncEquipmentAfterInventoryMutation(seller, taken),
    ...inventoryHistoryPayload(seller, [makeInventoryHistoryEntry('send', items[0], wanted, {
      ...actor, at: now, source: MARKET_SOURCE, targetName: 'Mise en vente', note: _gold(amount),
    })]),
  };
}

// Champs `listing` d'une nouvelle vente (les champs acheteur arrivent à la vente).
export function buildMarketListing({ items, price, sellerUid, sellerCharId }) {
  return {
    v: 1,
    items: _copies(items),
    price: normalizeMarketPrice(price),
    name: String(items[0]?.nom || 'Objet').slice(0, 90),
    sellerUid: String(sellerUid || ''),
    sellerCharId: String(sellerCharId || ''),
  };
}

function _assertOpen(post, { sold, withdrawn }) {
  if (!post || !isMarketListing(post)) throw new MarketError('gone', 'Cette vente n’existe plus.');
  const view = marketListingView(post);
  if (view.state === 'sold') throw new MarketError('sold', sold(view));
  if (view.state === 'withdrawn') throw new MarketError('withdrawn', withdrawn(view));
  return view;
}

// Achat : écritures acheteur (objet + paiement), vendeur (encaissement) et
// post (vendu). `expectedPrice` = prix affiché au clic : un prix modifié
// entre-temps annule l'achat au lieu de débiter un autre montant.
export function planMarketPurchase({ post, buyer, seller, buyerUid = '', expectedPrice = null, now = Date.now(), date = '', actor = {} } = {}) {
  const view = _assertOpen(post, {
    sold: v => (v.buyerName ? `Déjà vendu à ${v.buyerName}.` : 'Déjà vendu.'),
    withdrawn: () => 'Le vendeur a retiré cette vente.',
  });
  if (!buyer) throw new MarketError('buyer', 'Choisis le personnage qui achète.');
  if (buyer.id === view.sellerCharId || (buyerUid && buyerUid === view.sellerUid)) {
    throw new MarketError('own', 'Tu ne peux pas acheter ta propre vente.');
  }
  if (expectedPrice != null && Number(expectedPrice) !== view.price) {
    throw new MarketError('price', `Le prix vient de changer : ${_gold(view.price)}. Vérifie avant d’acheter.`);
  }
  if (!seller) throw new MarketError('seller', 'Le personnage vendeur n’existe plus.');
  const balance = calcOr(buyer);
  if (balance < view.price) throw new MarketError('funds', `Il manque ${_gold(view.price - balance)} à ${buyer.nom || 'ce personnage'}.`);

  const lot = _lotLabel(view);
  const buyerName = String(buyer.nom || 'Personnage').slice(0, 80);
  const sellerName = String(seller.nom || view.sellerName).slice(0, 80);
  return {
    view,
    buyerPatch: {
      inventaire: [...(Array.isArray(buyer.inventaire) ? buyer.inventaire : []), ..._copies(view.items)],
      compte: marketLedgerPayload(buyer, -view.price, `Marché · ${lot} (${sellerName})`, date),
      ...inventoryHistoryPayload(buyer, [makeInventoryHistoryEntry('receive', view.item, view.qty, {
        ...actor, at: now, source: MARKET_SOURCE, targetName: sellerName, note: _gold(view.price),
      })]),
    },
    sellerPatch: {
      compte: marketLedgerPayload(seller, view.price, `Marché · ${lot} → ${buyerName}`, date),
      ...inventoryHistoryPayload(seller, [makeInventoryHistoryEntry('sell', view.item, view.qty, {
        ...actor, at: now, source: MARKET_SOURCE, targetName: buyerName, note: `+${_gold(view.price)}`,
      })]),
    },
    // Seuls les champs acheteur changent dans `listing` (contrôlé par les règles).
    postPatch: {
      status: 'resolved',
      listing: { ...post.listing, buyerUid, buyerCharId: String(buyer.id || ''), buyerName, soldAt: now },
      updatedAt: now,
    },
  };
}

// Retrait : les unités en dépôt reviennent au vendeur, le post passe « retirée ».
export function planMarketWithdraw({ post, seller, now = Date.now(), actor = {} } = {}) {
  const view = _assertOpen(post, {
    sold: v => `Déjà vendu${v.buyerName ? ` à ${v.buyerName}` : ''} : l’objet a changé de main.`,
    withdrawn: () => 'Cette vente est déjà retirée.',
  });
  if (!seller) throw new MarketError('seller', 'Le personnage vendeur n’existe plus.');
  return {
    view,
    sellerPatch: {
      inventaire: [...(Array.isArray(seller.inventaire) ? seller.inventaire : []), ..._copies(view.items)],
      ...inventoryHistoryPayload(seller, [makeInventoryHistoryEntry('receive', view.item, view.qty, {
        ...actor, at: now, source: MARKET_SOURCE, note: 'Retiré de la vente',
      })]),
    },
    postPatch: { status: 'cancelled', updatedAt: now },
  };
}

export function planMarketPrice({ post, price, now = Date.now() } = {}) {
  const view = _assertOpen(post, {
    sold: () => 'Déjà vendu : le prix ne peut plus changer.',
    withdrawn: () => 'Cette vente est retirée.',
  });
  const amount = normalizeMarketPrice(price);
  if (!amount) throw new MarketError('price', `Indique un prix entre 1 et ${_gold(MARKET_PRICE_MAX)}.`);
  return { view, price: amount, postPatch: { listing: { ...post.listing, price: amount }, updatedAt: now } };
}
