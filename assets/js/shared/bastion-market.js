// ══════════════════════════════════════════════════════════════════════════════
// BASTION-MARKET — Marché du Bastion : logique pure (ni DOM ni Firebase)
// ──────────────────────────────────────────────────────────────────────────────
// Une vente = une publication `offre` du mur qui porte `listing` : l'objet vendu
// (copie pour l'affichage), le prix du lot et, une fois vendue, l'acheteur.
// L'objet RESTE dans l'inventaire du vendeur tant qu'il n'est pas vendu (v2) :
// c'est l'achat qui le retire de sa fiche et le donne à l'acheteur. S'il l'a
// vendu, donné ou jeté entre-temps, la vente n'est simplement plus achetable.
// Les ventes v1 (avant le 2026-11-04) ont mis l'objet en dépôt : on les honore
// telles quelles (l'achat ne touche pas l'inventaire du vendeur, le retrait le rend).
// Statut du post = état de la vente : active = en vente · resolved = vendue ·
// cancelled = retirée. Une vente close ne se rouvre jamais.
//
// Enchère (`listing.mode = 'auction'`) : `price` = prix de départ, `buyNow`
// facultatif, `bid` = meilleure offre { uid, charId, name, amount, at }. Pas
// d'échéance : le vendeur l'adjuge quand l'offre lui convient (objet au meilleur
// enchérisseur, or au vendeur) ou la retire. L'or de la meilleure offre est
// BLOQUÉ (débité) ; il est rendu, dans la même transaction, à l'enchérisseur
// battu ou si l'enchère est retirée. (Le `endsAt` des enchères du 2026-11-04
// est ignoré.)
//
// Les plans calculent les écritures exactes d'une transaction à partir des
// documents FRAIS qu'elle a lus ; ils lèvent MarketError (message prêt pour le
// joueur) quand la vente n'est plus possible — la transaction n'écrit alors rien.
// ══════════════════════════════════════════════════════════════════════════════
import { calcOr } from './char-stats.js';
import { resolveEquippedInventoryIndices } from './equipment-utils.js';
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
    // v1 : unités déjà retirées de l'inventaire à la publication (dépôt).
    escrow: (Number(listing.v) || 1) < 2,
    auction: listing.mode === 'auction',
    buyNow: Math.max(0, Math.round(Number(listing.buyNow) || 0)),
    bid: listing.bid && typeof listing.bid === 'object' && Number(listing.bid.amount) > 0 ? {
      uid: String(listing.bid.uid || ''),
      charId: String(listing.bid.charId || ''),
      name: String(listing.bid.name || 'Personnage'),
      amount: Math.round(Number(listing.bid.amount) || 0),
      at: Number(listing.bid.at) || 0,
    } : null,
    bidCount: Math.max(0, Math.round(Number(listing.bidCount) || 0)),
    // Enchères closes par l'ancienne échéance : affichage seulement.
    unsold: listing.unsold === true,
    failed: String(listing.failed || ''),
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

// Unités du lot `key` dans l'inventaire du vendeur : rangées puis portées.
function _units(seller, key) {
  const inventory = Array.isArray(seller?.inventaire) ? seller.inventaire : [];
  const worn = new Set(resolveEquippedInventoryIndices(seller || {}).values());
  const matching = inventory.map((item, index) => ({ item, index }))
    .filter(({ item }) => item && typeof item === 'object' && marketItemKey(item) === key);
  return {
    inventory,
    matching,
    free: matching.filter(m => !worn.has(m.index)),
    worn: matching.filter(m => worn.has(m.index)),
  };
}

// La vente est-elle achetable avec l'inventaire actuel du vendeur ? Un objet
// porté doit être déséquipé avant (l'acheteur ne peut pas toucher l'équipement
// d'un autre). `reason` : 'missing' (plus assez d'exemplaires) ou 'worn'.
export function marketAvailability(view, seller) {
  if (view.escrow) return { ok: true, free: view.qty, worn: 0, reason: '' };
  const { free, worn } = _units(seller, marketItemKey(view.item));
  const ok = free.length >= view.qty;
  const reason = ok ? '' : (free.length + worn.length >= view.qty ? 'worn' : 'missing');
  return { ok, free: free.length, worn: worn.length, reason };
}

// Mise en vente : rien ne quitte l'inventaire. On vérifie seulement que le
// vendeur possède `qty` exemplaires non déjà proposés (`reserved` = unités du
// même lot dans ses autres ventes ouvertes) ; la copie sert à l'affichage.
export function planMarketListing({ seller, key, qty = 1, price, reserved = 0 } = {}) {
  const amount = normalizeMarketPrice(price);
  if (!amount) throw new MarketError('price', `Indique un prix entre 1 et ${_gold(MARKET_PRICE_MAX)}.`);
  const wanted = Math.max(1, Math.min(MARKET_QTY_MAX, Math.floor(Number(qty) || 1)));
  const { matching, free, worn } = _units(seller, key);
  if (matching.some(({ item }) => isQuestItem(item))) throw new MarketError('quest', 'Un objet de quête ne se vend pas.');
  if (!matching.length) throw new MarketError('missing', 'Cet objet n’est plus dans l’inventaire.');
  const left = matching.length - Math.max(0, Number(reserved) || 0);
  if (left < wanted) {
    throw new MarketError('missing', left > 0
      ? `Il ne reste que ${left} exemplaire${left > 1 ? 's' : ''} à proposer (les autres sont déjà en vente).`
      : 'Tous tes exemplaires sont déjà en vente.');
  }
  const ordered = [...free, ...worn].slice(0, wanted);
  return {
    items: _copies(ordered.map(m => m.item)),
    qty: wanted,
    price: amount,
    worn: Math.max(0, wanted - free.length),
  };
}

// Champs `listing` d'une nouvelle vente (les champs acheteur arrivent à la vente).
export function buildMarketListing({ items, price, sellerUid, sellerCharId, auction = null }) {
  const listing = {
    v: 2,
    items: _copies(items),
    price: normalizeMarketPrice(price),
    name: String(items[0]?.nom || 'Objet').slice(0, 90),
    sellerUid: String(sellerUid || ''),
    sellerCharId: String(sellerCharId || ''),
  };
  if (!auction) return listing;
  const buyNow = normalizeMarketPrice(auction.buyNow);
  return {
    ...listing,
    mode: 'auction',
    ...(buyNow > listing.price ? { buyNow } : {}),
    bid: null,
    bidCount: 0,
  };
}

// Offre minimale suivante : le départ, puis +5 % (au moins +1 or).
export function marketMinBid(view) {
  if (!view.bid) return Math.max(1, view.price);
  return Math.max(view.bid.amount + 1, Math.ceil(view.bid.amount * 1.05));
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
export function planMarketPurchase({ post, buyer, seller, prevBidder, buyerUid = '', expectedPrice = null, now = Date.now(), date = '', actor = {} } = {}) {
  const base = _assertOpen(post, {
    sold: v => (v.buyerName ? `Déjà vendu à ${v.buyerName}.` : 'Déjà vendu.'),
    withdrawn: () => 'Le vendeur a retiré cette vente.',
  });
  // Enchère : seul l'achat immédiat passe ici, tant qu'aucune offre ne l'a
  // atteint ; le prix payé est celui d'achat immédiat et la meilleure offre en
  // cours est remboursée.
  if (base.auction && !base.buyNow) throw new MarketError('auction', 'Pas d’achat immédiat sur cette enchère.');
  if (base.auction && base.bid && base.bid.amount >= base.buyNow) {
    throw new MarketError('auction', 'Les offres ont dépassé le prix d’achat immédiat.');
  }
  const view = base.auction ? { ...base, price: base.buyNow } : base;
  if (!buyer) throw new MarketError('buyer', 'Choisis le personnage qui achète.');
  if (buyer.id === view.sellerCharId || (buyerUid && buyerUid === view.sellerUid)) {
    throw new MarketError('own', 'Tu ne peux pas acheter ta propre vente.');
  }
  if (expectedPrice != null && Number(expectedPrice) !== view.price) {
    throw new MarketError('price', `Le prix vient de changer : ${_gold(view.price)}. Vérifie avant d’acheter.`);
  }
  if (!seller) throw new MarketError('seller', 'Le personnage vendeur n’existe plus.');
  // Si l'acheteur détient la meilleure offre, son or bloqué compte dans le paiement.
  const ownBid = view.bid && view.bid.charId === buyer.id ? view.bid.amount : 0;
  const balance = calcOr(buyer) + ownBid;
  if (balance < view.price) throw new MarketError('funds', `Il manque ${_gold(view.price - balance)} à ${buyer.nom || 'ce personnage'}.`);

  const lot = _lotLabel(view);
  const buyerName = String(buyer.nom || 'Personnage').slice(0, 80);
  const sellerName = String(seller.nom || view.sellerName).slice(0, 80);
  // v2 : les exemplaires RÉELS (améliorations comprises) quittent maintenant la
  // fiche du vendeur, rangés seulement — jamais un objet qu'il porte.
  let sold = view.items;
  let sellerInventory = null;
  if (!view.escrow) {
    const { inventory, free, worn } = _units(seller, marketItemKey(view.item));
    if (free.length < view.qty) {
      throw free.length + worn.length >= view.qty
        ? new MarketError('worn', `${sellerName} porte encore cet objet : il doit le déséquiper pour que la vente se conclue.`)
        : new MarketError('missing', `${sellerName} n’a plus cet objet : la vente n’est plus possible.`);
    }
    const taken = new Set(free.slice(0, view.qty).map(m => m.index));
    sold = inventory.filter((_, index) => taken.has(index));
    sellerInventory = inventory.filter((_, index) => !taken.has(index));
  }
  return {
    view,
    buyerPatch: {
      inventaire: [...(Array.isArray(buyer.inventaire) ? buyer.inventaire : []), ..._copies(sold)],
      compte: marketLedgerPayload(buyer, -(view.price - ownBid), `Marché · ${lot} (${sellerName})`, date),
      ...inventoryHistoryPayload(buyer, [makeInventoryHistoryEntry('receive', view.item, view.qty, {
        ...actor, at: now, source: MARKET_SOURCE, targetName: sellerName, note: _gold(view.price),
      })]),
    },
    sellerPatch: {
      ...(sellerInventory ? { inventaire: sellerInventory } : {}),
      compte: marketLedgerPayload(seller, view.price, `Marché · ${lot} → ${buyerName}`, date),
      ...inventoryHistoryPayload(seller, [makeInventoryHistoryEntry('sell', view.item, view.qty, {
        ...actor, at: now, source: MARKET_SOURCE, targetName: buyerName, note: `+${_gold(view.price)}`,
      })]),
    },
    refund: view.bid && !ownBid ? _refund(view, prevBidder, date) : null,
    // Seuls les champs acheteur changent dans `listing` (contrôlé par les règles).
    postPatch: {
      status: 'resolved',
      listing: { ...post.listing, buyerUid, buyerCharId: String(buyer.id || ''), buyerName, soldAt: now },
      updatedAt: now,
    },
  };
}

// Retrait : la vente passe « retirée ». Rien à rendre (v2 : l'objet n'a jamais
// quitté l'inventaire) ; une vente v1 rend ses unités en dépôt au vendeur.
// Enchère avec offre : la meilleure offre est remboursée (`bidder` = sa fiche).
export function planMarketWithdraw({ post, seller, bidder, now = Date.now(), date = '', actor = {} } = {}) {
  const view = _assertOpen(post, {
    sold: v => `Déjà vendu${v.buyerName ? ` à ${v.buyerName}` : ''} : l’objet a changé de main.`,
    withdrawn: () => 'Cette vente est déjà retirée.',
  });
  const postPatch = { status: 'cancelled', updatedAt: now };
  if (view.auction && view.bid) return { view, sellerPatch: null, refund: _refund(view, bidder, date), postPatch };
  if (!view.escrow) return { view, sellerPatch: null, postPatch };
  if (!seller) throw new MarketError('seller', 'Le personnage vendeur n’existe plus.');
  return {
    view,
    sellerPatch: {
      inventaire: [...(Array.isArray(seller.inventaire) ? seller.inventaire : []), ..._copies(view.items)],
      ...inventoryHistoryPayload(seller, [makeInventoryHistoryEntry('receive', view.item, view.qty, {
        ...actor, at: now, source: MARKET_SOURCE, note: 'Retiré de la vente',
      })]),
    },
    postPatch,
  };
}

// Nouveau prix d'une vente ouverte. Enchère : le départ ne change plus après
// une offre ; l'achat immédiat (`buyNow` : '' = aucun, undefined = inchangé)
// doit dépasser le départ et la meilleure offre.
export function planMarketPrice({ post, price, buyNow, now = Date.now() } = {}) {
  const view = _assertOpen(post, {
    sold: () => 'Déjà vendu : le prix ne peut plus changer.',
    withdrawn: () => 'Cette vente est retirée.',
  });
  const amount = normalizeMarketPrice(price);
  if (!amount) throw new MarketError('price', `Indique un prix entre 1 et ${_gold(MARKET_PRICE_MAX)}.`);
  if (!view.auction) return { view, price: amount, postPatch: { listing: { ...post.listing, price: amount }, updatedAt: now } };
  if (view.bid && amount !== view.price) throw new MarketError('bids', 'Des offres ont été faites : le prix de départ ne change plus.');
  const raw = String((buyNow === undefined ? view.buyNow : buyNow) ?? '').trim();
  const none = raw === '' || Number(raw) === 0;
  const instant = none ? 0 : normalizeMarketPrice(raw);
  if (!none && !instant) throw new MarketError('price', `Indique un achat immédiat entre 1 et ${_gold(MARKET_PRICE_MAX)}, ou laisse vide.`);
  const floor = view.bid ? view.bid.amount : amount;
  if (instant && instant <= floor) {
    throw new MarketError('buyNow', `L’achat immédiat doit dépasser ${view.bid ? 'la meilleure offre' : 'le prix de départ'} (${_gold(floor)}).`);
  }
  const listing = { ...post.listing, price: amount };
  if (instant) listing.buyNow = instant;
  else delete listing.buyNow;
  return { view, price: amount, buyNow: instant, postPatch: { listing, updatedAt: now } };
}

// Remboursement de la meilleure offre (or bloqué rendu à son auteur).
// `bidder` = sa fiche FRAÎCHE, lue d'après l'offre affichée : si une autre offre
// l'a remplacée entre-temps (ou si elle n'a pas été lue), on n'écrit rien —
// sinon on rembourserait la mauvaise fiche. Fiche supprimée (null) : personne
// à rembourser.
function _refund(view, bidder, date) {
  if (!view.bid || bidder === null) return null;
  if (bidder?.id !== view.bid.charId) throw new MarketError('changed', 'L’enchère vient de changer : vérifie et réessaie.');
  return {
    charId: view.bid.charId,
    uid: view.bid.uid,
    patch: { compte: marketLedgerPayload(bidder, view.bid.amount, `Enchère · ${_lotLabel(view)} (remboursé)`, date) },
  };
}

// Offre sur une enchère : l'or est bloqué, l'enchérisseur battu remboursé.
// Remonter sa propre offre ne bloque que la différence.
export function planMarketBid({ post, bidder, prevBidder, amount, buyerUid = '', now = Date.now(), date = '' } = {}) {
  const view = _assertOpen(post, {
    sold: v => `Enchère terminée${v.buyerName ? ` : adjugée à ${v.buyerName}` : ''}.`,
    withdrawn: () => 'Cette enchère est annulée.',
  });
  if (!view.auction) throw new MarketError('auction', 'Ce n’est pas une enchère.');
  if (!bidder) throw new MarketError('buyer', 'Choisis le personnage qui enchérit.');
  if (bidder.id === view.sellerCharId || (buyerUid && buyerUid === view.sellerUid)) {
    throw new MarketError('own', 'Tu ne peux pas enchérir sur ta propre vente.');
  }
  const value = normalizeMarketPrice(amount);
  const min = marketMinBid(view);
  if (!value || value < min) throw new MarketError('low', `L’offre minimale est de ${_gold(min)}.`);
  const self = view.bid && view.bid.charId === bidder.id;
  const due = value - (self ? view.bid.amount : 0);
  const balance = calcOr(bidder);
  if (balance < due) throw new MarketError('funds', `Il manque ${_gold(due - balance)} à ${bidder.nom || 'ce personnage'}.`);
  const lot = _lotLabel(view);
  const name = String(bidder.nom || 'Personnage').slice(0, 80);
  return {
    view,
    amount: value,
    outbid: view.bid && !self ? view.bid : null,
    bidderPatch: { compte: marketLedgerPayload(bidder, -due, `Enchère · ${lot} (bloqué)`, date) },
    refund: self ? null : _refund(view, prevBidder, date),
    postPatch: {
      listing: {
        ...post.listing,
        bid: { uid: buyerUid, charId: String(bidder.id || ''), name, amount: value, at: now },
        bidCount: view.bidCount + 1,
      },
      updatedAt: now,
    },
  };
}

// Adjudication, quand le vendeur (ou le MJ) le décide : l'objet passe au
// meilleur enchérisseur (exemplaires rangés seulement) et son or bloqué au
// vendeur. Sans offre, rien à adjuger ; objet porté ou absent : refus, rien
// n'est écrit (le vendeur le range, ou retire l'enchère). `expectedBid` = offre
// affichée au clic : une nouvelle offre arrivée entre-temps annule l'adjudication.
export function planMarketClose({ post, seller, winner, expectedBid = null, now = Date.now(), date = '', actor = {} } = {}) {
  const view = _assertOpen(post, { sold: () => 'Déjà adjugée.', withdrawn: () => 'Cette enchère est retirée.' });
  if (!view.auction) throw new MarketError('auction', 'Ce n’est pas une enchère.');
  if (!view.bid) throw new MarketError('nobid', 'Aucune offre à accepter pour l’instant.');
  if ((expectedBid != null && view.bid.amount !== Number(expectedBid)) || (winner && winner.id !== view.bid.charId)) {
    throw new MarketError('changed', `Nouvelle offre : ${_gold(view.bid.amount)} (${view.bid.name}). Vérifie avant d’adjuger.`);
  }
  if (!seller) throw new MarketError('seller', 'Le personnage vendeur n’existe plus.');
  if (!winner) throw new MarketError('bidder', 'Le personnage de la meilleure offre n’existe plus : retire l’enchère.');
  const lot = _lotLabel(view);
  const sellerName = String(seller.nom || view.sellerName).slice(0, 80);
  const { inventory, free, worn } = _units(seller, marketItemKey(view.item));
  if (free.length < view.qty) {
    throw free.length + worn.length >= view.qty
      ? new MarketError('worn', `${sellerName} porte encore cet objet : il faut le déséquiper pour l’adjuger.`)
      : new MarketError('missing', `${sellerName} n’a plus cet objet : retire l’enchère, l’offre sera remboursée.`);
  }
  const taken = new Set(free.slice(0, view.qty).map(m => m.index));
  const winnerName = view.bid.name;
  return {
    view,
    winnerPatch: {
      inventaire: [...(Array.isArray(winner.inventaire) ? winner.inventaire : []), ..._copies(inventory.filter((_, i) => taken.has(i)))],
      ...inventoryHistoryPayload(winner, [makeInventoryHistoryEntry('receive', view.item, view.qty, {
        ...actor, at: now, source: MARKET_SOURCE, targetName: sellerName, note: `Enchère · ${_gold(view.bid.amount)}`,
      })]),
    },
    sellerPatch: {
      inventaire: inventory.filter((_, i) => !taken.has(i)),
      compte: marketLedgerPayload(seller, view.bid.amount, `Enchère · ${lot} → ${winnerName}`, date),
      ...inventoryHistoryPayload(seller, [makeInventoryHistoryEntry('sell', view.item, view.qty, {
        ...actor, at: now, source: MARKET_SOURCE, targetName: winnerName, note: `+${_gold(view.bid.amount)}`,
      })]),
    },
    postPatch: {
      status: 'resolved',
      listing: { ...post.listing, buyerUid: view.bid.uid, buyerCharId: view.bid.charId, buyerName: winnerName, soldAt: now },
      updatedAt: now,
    },
  };
}
