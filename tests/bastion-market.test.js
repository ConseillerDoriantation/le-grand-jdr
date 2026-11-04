import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MarketError,
  buildMarketListing,
  isMarketListing,
  marketAvailability,
  marketItemKey,
  marketLedgerPayload,
  marketListingState,
  marketListingView,
  mergeMarketPosts,
  normalizeMarketPrice,
  planMarketListing,
  planMarketPrice,
  planMarketPurchase,
  planMarketWithdraw,
  sortMarketViews,
} from '../assets/js/shared/bastion-market.js';
import { calcOr } from '../assets/js/shared/char-stats.js';
import { itemCompareRows, itemFamily, itemKind, isQuestItem } from '../assets/js/shared/item-facts.js';

const ring = { itemId: 'ring-1', nom: 'Anneau de Force', template: 'bijou', slotBijou: 'Anneau', rarete: 3, qte: '1' };
const potion = { itemId: 'pot-1', nom: 'Potion de soin', type: 'Potion', qte: '1' };
const ledger = (recettes = 0, depenses = 0) => ({
  recettes: recettes ? [{ date: '01/11/2026', libelle: 'Départ', montant: recettes }] : [],
  depenses: depenses ? [{ date: '01/11/2026', libelle: 'Dépense', montant: depenses }] : [],
});

const seller = () => ({
  id: 'aria', nom: 'Aria', uid: 'u-aria',
  inventaire: [{ ...potion }, { ...ring }, { ...potion }],
  equipement: { Anneau: { ...ring, sourceInvIndex: 1 } },
  compte: ledger(100),
});
const buyer = () => ({ id: 'borin', nom: 'Borin', uid: 'u-borin', inventaire: [{ ...potion }], compte: ledger(420) });

function listingPost(overrides = {}) {
  return {
    id: 'post-1', kind: 'post', type: 'offre', status: 'active',
    uid: 'u-aria', charId: 'aria', charName: 'Aria', text: 'Parfait pour un guerrier', ts: 1000,
    listing: buildMarketListing({ items: [ring], price: 250, sellerUid: 'u-aria', sellerCharId: 'aria' }),
    ...overrides,
  };
}

test('le lot reprend la clé de regroupement de l’inventaire et le prix est un entier borné', () => {
  assert.equal(marketItemKey(ring), 'ring-1||Anneau de Force||bijou');
  assert.equal(marketItemKey(potion), 'pot-1||Potion de soin||Potion');
  assert.equal(normalizeMarketPrice('250'), 250);
  assert.equal(normalizeMarketPrice(12.4), 12);
  assert.equal(normalizeMarketPrice(0), 0);
  assert.equal(normalizeMarketPrice(''), 0);
  assert.equal(normalizeMarketPrice(-5), 0);
  assert.equal(normalizeMarketPrice(2_000_000), 0);
});

test('une offre ne devient une vente que si elle porte un objet', () => {
  assert.equal(isMarketListing(listingPost()), true);
  assert.equal(isMarketListing(listingPost({ type: 'message' })), false);
  assert.equal(isMarketListing({ type: 'offre', text: 'Je vends mes services' }), false);
  assert.equal(isMarketListing(listingPost({ listing: { items: [] } })), false);
  assert.equal(marketListingState({ status: 'active' }), 'open');
  assert.equal(marketListingState({ status: 'resolved' }), 'sold');
  assert.equal(marketListingState({ status: 'cancelled' }), 'withdrawn');
  const view = marketListingView(listingPost());
  assert.equal(view.name, 'Anneau de Force');
  assert.equal(view.price, 250);
  assert.equal(view.qty, 1);
  assert.equal(view.rarity, 3);
  assert.equal(view.sellerCharId, 'aria');
  assert.equal(view.escrow, false, 'nouvelle vente (v2) : objet laissé dans l’inventaire');
  assert.equal(marketListingView(listingPost({ listing: { ...listingPost().listing, v: 1 } })).escrow, true);
  assert.equal(marketListingView(listingPost({ listing: { items: [ring], price: 10 } })).escrow, true, 'sans version = ancienne vente en dépôt');
});

test('mise en vente : rien ne quitte l’inventaire, la copie sert à l’affichage', () => {
  const char = seller();
  const plan = planMarketListing({ seller: char, key: marketItemKey(potion), qty: 2, price: 30 });
  assert.equal(plan.items.length, 2);
  assert.equal(plan.items[0].nom, 'Potion de soin');
  assert.equal(plan.worn, 0);
  assert.equal(plan.inventaire, undefined, 'aucune écriture sur la fiche');
  assert.equal(char.inventaire.length, 3, 'la fiche lue n’est jamais mutée');
  const worn = planMarketListing({ seller: seller(), key: marketItemKey(ring), price: 250 });
  assert.equal(worn.worn, 1, 'objet porté signalé (à déséquiper avant l’achat)');
});

test('mise en vente refusée : prix, objet absent, quantité, déjà en vente, quête', () => {
  const char = seller();
  assert.throws(() => planMarketListing({ seller: char, key: marketItemKey(ring), price: 0 }), err => err instanceof MarketError && err.code === 'price');
  assert.throws(() => planMarketListing({ seller: char, key: 'inconnu', price: 10 }), { code: 'missing' });
  assert.throws(() => planMarketListing({ seller: char, key: marketItemKey(potion), qty: 3, price: 10 }), /Il ne reste que 2 exemplaires/);
  assert.throws(() => planMarketListing({ seller: char, key: marketItemKey(potion), qty: 2, price: 10, reserved: 1 }), /Il ne reste que 1 exemplaire à proposer/);
  assert.throws(() => planMarketListing({ seller: char, key: marketItemKey(ring), price: 10, reserved: 1 }), /déjà en vente/);
  const quest = { nom: 'Sceau royal', type: 'Objet de quête' };
  assert.throws(() => planMarketListing({ seller: { inventaire: [quest] }, key: marketItemKey(quest), price: 10 }), { code: 'quest' });
});

const freeSeller = () => ({ ...seller(), equipement: {} });

test('achat : l’objet réel quitte la fiche du vendeur, or débité puis crédité', () => {
  const post = listingPost();
  const s = freeSeller();
  s.inventaire[1] = { ...ring, upgrades: { statBonus: { fo: 1 } } }; // amélioré après la mise en vente
  const plan = planMarketPurchase({ post, buyer: buyer(), seller: s, buyerUid: 'u-borin', expectedPrice: 250, now: 99, date: '03/11/2026' });
  assert.equal(plan.buyerPatch.inventaire.length, 2);
  assert.deepEqual(plan.buyerPatch.inventaire[1].upgrades, { statBonus: { fo: 1 } }, 'l’acheteur reçoit l’exemplaire actuel');
  assert.deepEqual(plan.sellerPatch.inventaire.map(i => i.nom), ['Potion de soin', 'Potion de soin']);
  assert.equal(calcOr({ compte: plan.buyerPatch.compte }), 170);
  assert.equal(calcOr({ compte: plan.sellerPatch.compte }), 350);
  assert.match(plan.buyerPatch.compte.depenses.at(-1).libelle, /^Marché · Anneau de Force \(Aria\)$/);
  assert.match(plan.sellerPatch.compte.recettes.at(-1).libelle, /→ Borin$/);
  assert.equal(plan.buyerPatch.inventoryHistory[0].type, 'receive');
  assert.equal(plan.sellerPatch.inventoryHistory[0].type, 'sell');
  assert.deepEqual(Object.keys(plan.sellerPatch).sort(), ['compte', 'inventaire', 'inventoryHistory'], 'champs autorisés par « Don entre membres »');
  assert.equal(plan.postPatch.status, 'resolved');
  const changed = Object.keys(plan.postPatch.listing).filter(key => JSON.stringify(plan.postPatch.listing[key]) !== JSON.stringify(post.listing[key]));
  assert.deepEqual(changed.sort(), ['buyerCharId', 'buyerName', 'buyerUid', 'soldAt']);
});

test('achat : un exemplaire rangé part avant, jamais celui que le vendeur porte', () => {
  const s = seller();
  s.inventaire.push({ ...ring });   // 2e anneau, rangé
  const plan = planMarketPurchase({ post: listingPost(), buyer: buyer(), seller: s, buyerUid: 'u-borin' });
  assert.equal(plan.sellerPatch.inventaire.filter(i => i.nom === 'Anneau de Force').length, 1);
  assert.equal(plan.sellerPatch.inventaire[1].nom, 'Anneau de Force', 'l’anneau porté (index 1) reste');
});

test('achat refusé : objet porté, déjà vendu ailleurs, vendu, retiré, sa propre vente, prix, or', () => {
  assert.throws(() => planMarketPurchase({ post: listingPost(), buyer: buyer(), seller: seller() }), /Aria porte encore cet objet/);
  assert.throws(() => planMarketPurchase({ post: listingPost(), buyer: buyer(), seller: { ...freeSeller(), inventaire: [{ ...potion }] } }), /n’a plus cet objet/);
  const sold = listingPost({ status: 'resolved', listing: { ...listingPost().listing, buyerName: 'Kael' } });
  assert.throws(() => planMarketPurchase({ post: sold, buyer: buyer(), seller: freeSeller() }), /Déjà vendu à Kael/);
  assert.throws(() => planMarketPurchase({ post: listingPost({ status: 'cancelled' }), buyer: buyer(), seller: freeSeller() }), { code: 'withdrawn' });
  assert.throws(() => planMarketPurchase({ post: listingPost(), buyer: seller(), seller: freeSeller() }), { code: 'own' });
  assert.throws(() => planMarketPurchase({ post: listingPost(), buyer: { ...buyer(), id: 'alt' }, seller: freeSeller(), buyerUid: 'u-aria' }), { code: 'own' });
  assert.throws(() => planMarketPurchase({ post: listingPost(), buyer: buyer(), seller: freeSeller(), expectedPrice: 200 }), { code: 'price' });
  assert.throws(() => planMarketPurchase({ post: listingPost(), buyer: { ...buyer(), compte: ledger(100) }, seller: freeSeller() }), /Il manque 150 or à Borin/);
  assert.throws(() => planMarketPurchase({ post: listingPost(), buyer: buyer(), seller: null }), { code: 'seller' });
  assert.throws(() => planMarketPurchase({ post: null, buyer: buyer(), seller: freeSeller() }), { code: 'gone' });
});

test('disponibilité affichée : porté, absent ou achetable', () => {
  const view = marketListingView(listingPost());
  assert.deepEqual(marketAvailability(view, seller()).reason, 'worn');
  assert.equal(marketAvailability(view, freeSeller()).ok, true);
  assert.equal(marketAvailability(view, { inventaire: [] }).reason, 'missing');
  assert.equal(marketAvailability({ ...view, escrow: true }, { inventaire: [] }).ok, true, 'v1 : objet déjà en dépôt');
});

test('ancienne vente v1 (dépôt) : l’achat ne touche pas l’inventaire du vendeur, le retrait le rend', () => {
  const v1 = listingPost({ listing: { ...listingPost().listing, v: 1 } });
  const plan = planMarketPurchase({ post: v1, buyer: buyer(), seller: { ...seller(), inventaire: [] }, buyerUid: 'u-borin' });
  assert.equal(plan.sellerPatch.inventaire, undefined);
  assert.equal(plan.buyerPatch.inventaire.at(-1).nom, 'Anneau de Force');
  const back = planMarketWithdraw({ post: v1, seller: seller(), now: 7 });
  assert.equal(back.sellerPatch.inventaire.length, 4);
  assert.equal(back.sellerPatch.inventoryHistory[0].type, 'receive');
});

test('le solde d’une très ancienne fiche (champ or seul) est reporté avant la première ligne', () => {
  const legacy = { id: 'old', nom: 'Vieux', or: 500 };
  const compte = marketLedgerPayload(legacy, -250, 'Marché · test', '03/11/2026');
  assert.equal(compte.recettes[0].libelle, 'Solde initial');
  assert.equal(calcOr({ compte }), 250);
  const plan = planMarketPurchase({ post: listingPost(), buyer: legacy, seller: freeSeller(), buyerUid: 'u-old' });
  assert.equal(calcOr({ compte: plan.buyerPatch.compte }), 250);
});

test('retrait : la vente passe « retirée », rien à rendre (l’objet n’a pas bougé)', () => {
  const plan = planMarketWithdraw({ post: listingPost(), seller: null, now: 7 });
  assert.equal(plan.sellerPatch, null);
  assert.deepEqual(plan.postPatch, { status: 'cancelled', updatedAt: 7 });
  assert.throws(() => planMarketWithdraw({ post: listingPost({ status: 'resolved' }) }), { code: 'sold' });
  assert.throws(() => planMarketWithdraw({ post: listingPost({ status: 'cancelled' }) }), { code: 'withdrawn' });
});

test('changement de prix : seulement sur une vente ouverte, seul `price` change', () => {
  const post = listingPost();
  const plan = planMarketPrice({ post, price: '300', now: 8 });
  assert.equal(plan.postPatch.listing.price, 300);
  assert.deepEqual({ ...plan.postPatch.listing, price: 250 }, post.listing);
  assert.throws(() => planMarketPrice({ post: listingPost({ status: 'resolved' }), price: 300 }), { code: 'sold' });
  assert.throws(() => planMarketPrice({ post, price: 'abc' }), { code: 'price' });
});

test('deux flux du même post : la version la plus récente gagne ; tris du Marché', () => {
  const older = { id: 'a', status: 'active', ts: 1, updatedAt: 1 };
  const newer = { id: 'a', status: 'resolved', ts: 1, updatedAt: 5 };
  assert.equal(mergeMarketPosts([newer], [older])[0].status, 'resolved');
  assert.equal(mergeMarketPosts([older], [newer])[0].status, 'resolved');
  const views = [
    { id: 'x', price: 50, rarity: 2, ts: 3 },
    { id: 'y', price: 10, rarity: 4, ts: 1 },
    { id: 'z', price: 90, rarity: 1, ts: 2 },
  ];
  assert.deepEqual(sortMarketViews(views).map(v => v.id), ['x', 'z', 'y']);
  assert.deepEqual(sortMarketViews(views, 'price-asc').map(v => v.id), ['y', 'x', 'z']);
  assert.deepEqual(sortMarketViews(views, 'price-desc').map(v => v.id), ['z', 'x', 'y']);
  assert.deepEqual(sortMarketViews(views, 'rarity').map(v => v.id), ['y', 'x', 'z']);
});

test('faits d’objet partagés : famille, nature et écarts « Si tu l’équipes »', () => {
  assert.equal(itemFamily(ring), 'equip');
  assert.equal(itemFamily(potion), 'conso');
  assert.equal(itemFamily({ nom: 'Lettre scellée', type: 'Document' }), 'quest');
  assert.equal(itemFamily({ nom: 'Mat. bijou', type: 'Matériau' }), 'mat', 'un matériau de bijou reste un matériau');
  assert.equal(itemFamily({ nom: 'Pendentif de lune', type: 'Babiole' }), 'equip', 'un nom de bijou sans autre signal est un équipement');
  assert.equal(itemFamily({ nom: 'Carte', type: 'Carte' }, { readable: true }), 'quest', 'un document lisible va avec les clés');
  assert.equal(itemKind(ring), 'Anneau');
  assert.equal(isQuestItem({ type: 'Objet de quête' }), true);
  const sword = { nom: 'Épée', template: 'arme', degats: '1d8' };
  const rows = itemCompareRows(sword, null);
  assert.equal(rows[0][0], 'Dégâts');
  assert.equal(rows[0][1], '—');
});

// ── Enchères ─────────────────────────────────────────────────────────────────
import { marketMinBid, planMarketBid, planMarketClose } from '../assets/js/shared/bastion-market.js';

const H = 3_600_000;
function auctionPost(overrides = {}, listingOverrides = {}) {
  const listing = { ...buildMarketListing({ items: [ring], price: 100, sellerUid: 'u-aria', sellerCharId: 'aria', auction: { buyNow: 400 } }), ...listingOverrides };
  return { id: 'auc-1', kind: 'post', type: 'offre', status: 'active', uid: 'u-aria', charId: 'aria', charName: 'Aria', ts: 0, listing, ...overrides };
}
const kael = () => ({ id: 'kael', nom: 'Kael', uid: 'u-kael', inventaire: [], compte: ledger(300) });
const withBid = (amount = 150, who = { uid: 'u-kael', charId: 'kael', name: 'Kael' }) => auctionPost({}, { bid: { ...who, amount, at: 1 }, bidCount: 1 });

test('enchère sans durée : départ puis +5 % (au moins +1)', () => {
  const listing = auctionPost().listing;
  assert.equal(listing.mode, 'auction');
  assert.equal('endsAt' in listing, false, 'aucune échéance');
  assert.deepEqual([listing.bid, listing.bidCount], [null, 0]);
  const view = marketListingView(auctionPost());
  assert.equal(view.auction, true);
  assert.equal(view.buyNow, 400);
  assert.equal(marketMinBid(view), 100);
  assert.equal(marketMinBid(marketListingView(withBid(150))), 158);
  assert.equal(marketMinBid(marketListingView(withBid(10))), 11);
  assert.equal('buyNow' in buildMarketListing({ items: [ring], price: 100, auction: { buyNow: 80 } }), false, 'achat immédiat ≤ départ ignoré');
});

test('offre : or bloqué, enchérisseur battu remboursé, même longtemps après la mise en vente', () => {
  const plan = planMarketBid({ post: withBid(150), bidder: buyer(), prevBidder: kael(), amount: 200, buyerUid: 'u-borin', now: 400 * H, date: 'd' });
  assert.equal(calcOr({ compte: plan.bidderPatch.compte }), 220);
  assert.equal(plan.refund.charId, 'kael');
  assert.equal(calcOr({ compte: plan.refund.patch.compte }), 450);
  assert.equal(plan.postPatch.listing.bid.amount, 200);
  assert.equal(plan.postPatch.listing.bidCount, 2);
  assert.equal(plan.outbid.uid, 'u-kael');
  const changed = Object.keys(plan.postPatch.listing).filter(k => JSON.stringify(plan.postPatch.listing[k]) !== JSON.stringify(withBid(150).listing[k]));
  assert.deepEqual(changed.sort(), ['bid', 'bidCount'], 'seuls bid/bidCount changent (règles Firestore)');
  // Ancienne enchère à échéance dépassée : l'échéance est ignorée et recopiée telle quelle.
  const legacy = planMarketBid({ post: auctionPost({}, { endsAt: 1 }), bidder: buyer(), amount: 120, buyerUid: 'u-borin', now: 10 * H });
  assert.equal(legacy.postPatch.listing.endsAt, 1);
  assert.throws(() => planMarketBid({ post: withBid(150), bidder: buyer(), prevBidder: kael(), amount: 155, now: H }), /offre minimale est de 158 or/);
  assert.throws(() => planMarketBid({ post: auctionPost(), bidder: seller(), amount: 120, now: H }), { code: 'own' });
  assert.throws(() => planMarketBid({ post: auctionPost(), bidder: { ...buyer(), compte: ledger(50) }, amount: 120, now: H }), /Il manque 70 or/);
});

test('une offre arrivée entre-temps n’est jamais remboursée sur la mauvaise fiche', () => {
  const mira = { id: 'mira', nom: 'Mira', uid: 'u-mira', compte: ledger(500) };
  // Fiche lue d'après l'offre affichée (Kael) alors que Mira l'a battue : rien n'est écrit.
  const fresh = withBid(200, { uid: 'u-mira', charId: 'mira', name: 'Mira' });
  assert.throws(() => planMarketBid({ post: fresh, bidder: buyer(), prevBidder: kael(), amount: 250, buyerUid: 'u-borin' }), { code: 'changed' });
  assert.throws(() => planMarketBid({ post: fresh, bidder: buyer(), amount: 250, buyerUid: 'u-borin' }), { code: 'changed' }, 'fiche non lue');
  assert.throws(() => planMarketPurchase({ post: fresh, buyer: buyer(), seller: freeSeller(), prevBidder: kael(), buyerUid: 'u-borin' }), { code: 'changed' });
  assert.throws(() => planMarketWithdraw({ post: fresh, bidder: kael() }), { code: 'changed' });
  assert.equal(planMarketBid({ post: fresh, bidder: buyer(), prevBidder: mira, amount: 250, buyerUid: 'u-borin' }).refund.charId, 'mira');
  // Fiche du meilleur enchérisseur supprimée (lue, absente) : personne à rembourser.
  assert.equal(planMarketWithdraw({ post: fresh, bidder: null }).refund, null);
});

test('remonter sa propre offre ne bloque que la différence', () => {
  const self = planMarketBid({ post: withBid(150, { uid: 'u-borin', charId: 'borin', name: 'Borin' }), bidder: buyer(), amount: 200, buyerUid: 'u-borin', now: H });
  assert.equal(calcOr({ compte: self.bidderPatch.compte }), 370);
  assert.equal(self.refund, null);
});

test('adjuger : objet au gagnant, or bloqué au vendeur ; refus sans offre, objet porté ou offre changée', () => {
  const s = freeSeller();
  const plan = planMarketClose({ post: withBid(150), seller: s, winner: kael(), expectedBid: 150, now: H, date: 'd' });
  assert.equal(plan.winnerPatch.inventaire.at(-1).nom, 'Anneau de Force');
  assert.equal(plan.sellerPatch.inventaire.some(i => i.nom === 'Anneau de Force'), false);
  assert.equal(calcOr({ compte: plan.sellerPatch.compte }), 250);
  assert.equal(plan.winnerPatch.compte, undefined, 'l’or du gagnant était déjà bloqué');
  assert.equal(plan.postPatch.status, 'resolved');
  assert.equal(plan.postPatch.listing.buyerUid, 'u-kael');
  assert.equal(plan.postPatch.listing.buyerCharId, 'kael');
  const keys = Object.keys(plan.postPatch.listing).filter(k => JSON.stringify(plan.postPatch.listing[k]) !== JSON.stringify(withBid(150).listing[k]));
  assert.deepEqual(keys.sort(), ['buyerCharId', 'buyerName', 'buyerUid', 'soldAt'], 'seuls les champs acheteur changent (règles Firestore)');
  assert.throws(() => planMarketClose({ post: auctionPost(), seller: s, winner: kael() }), { code: 'nobid' });
  assert.throws(() => planMarketClose({ post: withBid(150), seller: seller(), winner: kael() }), { code: 'worn' }, 'vendeur qui porte encore l’anneau');
  assert.throws(() => planMarketClose({ post: withBid(150), seller: { ...s, inventaire: [] }, winner: kael() }), { code: 'missing' });
  assert.throws(() => planMarketClose({ post: withBid(200), seller: s, winner: kael(), expectedBid: 150 }), /Nouvelle offre : 200 or/);
  assert.throws(() => planMarketClose({ post: withBid(150), seller: s, winner: buyer() }), { code: 'changed' }, 'fiche lue ≠ meilleure offre');
  assert.throws(() => planMarketClose({ post: withBid(150), seller: s, winner: null }), { code: 'bidder' });
});

test('achat immédiat tant qu’aucune offre ne l’atteint ; retrait = offre remboursée', () => {
  const plan = planMarketPurchase({ post: withBid(150), buyer: buyer(), seller: freeSeller(), prevBidder: kael(), buyerUid: 'u-borin', now: H, date: 'd' });
  assert.equal(calcOr({ compte: plan.buyerPatch.compte }), 20);
  assert.equal(calcOr({ compte: plan.refund.patch.compte }), 450);
  assert.throws(() => planMarketPurchase({ post: auctionPost({}, { buyNow: undefined }), buyer: buyer(), seller: freeSeller(), now: H }), { code: 'auction' });
  assert.throws(() => planMarketPurchase({ post: withBid(400), buyer: buyer(), seller: freeSeller(), prevBidder: kael() }), /dépassé le prix d’achat immédiat/);
  const back = planMarketWithdraw({ post: withBid(150), bidder: kael(), date: 'd' });
  assert.equal(back.postPatch.status, 'cancelled');
  assert.equal(calcOr({ compte: back.refund.patch.compte }), 450);
  assert.equal(planMarketWithdraw({ post: auctionPost() }).postPatch.status, 'cancelled', 'sans offre, rien à rembourser');
});

test('modifier une enchère : départ tant qu’aucune offre, achat immédiat au-dessus de la meilleure offre', () => {
  const changed = (plan, post) => Object.keys({ ...plan.postPatch.listing, ...post.listing })
    .filter(k => JSON.stringify(plan.postPatch.listing[k]) !== JSON.stringify(post.listing[k])).sort();
  const free = auctionPost();
  const both = planMarketPrice({ post: free, price: 120, buyNow: '500' });
  assert.deepEqual([both.postPatch.listing.price, both.postPatch.listing.buyNow], [120, 500]);
  assert.deepEqual(changed(both, free), ['buyNow', 'price'], 'seuls price/buyNow changent (règles Firestore)');
  assert.equal(planMarketPrice({ post: free, price: 120 }).postPatch.listing.buyNow, 400, 'buyNow non fourni = inchangé');
  const removed = planMarketPrice({ post: free, price: 100, buyNow: '' });
  assert.equal('buyNow' in removed.postPatch.listing, false, 'vide = achat immédiat retiré');
  assert.equal(removed.buyNow, 0);
  assert.throws(() => planMarketPrice({ post: free, price: 100, buyNow: 100 }), /dépasser le prix de départ \(100 or\)/);
  assert.throws(() => planMarketPrice({ post: free, price: 100, buyNow: 2_000_000 }), { code: 'price' });
  const bid = withBid(150);
  assert.throws(() => planMarketPrice({ post: bid, price: 90 }), { code: 'bids' });
  assert.throws(() => planMarketPrice({ post: bid, price: 100, buyNow: 150 }), /dépasser la meilleure offre \(150 or\)/);
  const raised = planMarketPrice({ post: bid, price: 100, buyNow: 151 });
  assert.equal(raised.postPatch.listing.buyNow, 151);
  assert.deepEqual(changed(raised, bid), ['buyNow']);
  assert.throws(() => planMarketPrice({ post: auctionPost({ status: 'resolved' }), price: 100 }), { code: 'sold' });
});
