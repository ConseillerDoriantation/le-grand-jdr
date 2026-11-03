import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MarketError,
  buildMarketListing,
  isMarketListing,
  marketItemKey,
  marketLedgerPayload,
  marketListingState,
  marketListingView,
  normalizeMarketPrice,
  planMarketListing,
  planMarketPrice,
  planMarketPurchase,
  planMarketWithdraw,
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

test('une offre ne devient une vente que si elle porte des unités en dépôt', () => {
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
});

test('mise en vente : les unités rangées partent avant celles portées', () => {
  const char = seller();
  const plan = planMarketListing({ seller: char, key: marketItemKey(potion), qty: 1, price: 30, now: 5 });
  assert.deepEqual(plan.removedIndices, [0]);
  assert.equal(plan.unequipped, false);
  assert.equal(plan.inventaire.length, 2);
  assert.equal(plan.items[0].nom, 'Potion de soin');
  // L'anneau porté glisse de l'index 1 à 0 : l'équipement est réindexé.
  assert.equal(plan.equipSync.changed, true);
  assert.equal(plan.equipSync.equipement.Anneau.sourceInvIndex, 0);
  assert.equal(plan.inventoryHistory[0].type, 'send');
  assert.equal(plan.inventoryHistory[0].source, 'Marché du Bastion');
  assert.equal(char.inventaire.length, 3, 'la fiche lue n’est jamais mutée');
});

test('mise en vente d’un objet porté : il est déséquipé', () => {
  const plan = planMarketListing({ seller: seller(), key: marketItemKey(ring), qty: 1, price: 250 });
  assert.equal(plan.unequipped, true);
  assert.deepEqual(plan.equipSync.removedSlots, ['Anneau']);
  assert.equal(plan.equipSync.equipement.Anneau, undefined);
});

test('mise en vente refusée : prix invalide, objet absent, quantité ou objet de quête', () => {
  const char = seller();
  assert.throws(() => planMarketListing({ seller: char, key: marketItemKey(ring), price: 0 }), err => err instanceof MarketError && err.code === 'price');
  assert.throws(() => planMarketListing({ seller: char, key: 'inconnu', price: 10 }), { code: 'missing' });
  assert.throws(() => planMarketListing({ seller: char, key: marketItemKey(potion), qty: 3, price: 10 }), /Il ne reste que 2 exemplaires/);
  const quest = { nom: 'Sceau royal', type: 'Objet de quête' };
  assert.throws(() => planMarketListing({ seller: { inventaire: [quest] }, key: marketItemKey(quest), price: 10 }), { code: 'quest' });
});

test('achat : objet transféré, or débité puis crédité, seuls les champs acheteur changent dans la vente', () => {
  const post = listingPost();
  const plan = planMarketPurchase({ post, buyer: buyer(), seller: seller(), buyerUid: 'u-borin', expectedPrice: 250, now: 99, date: '03/11/2026' });
  assert.equal(plan.buyerPatch.inventaire.length, 2);
  assert.equal(plan.buyerPatch.inventaire[1].nom, 'Anneau de Force');
  assert.equal(calcOr({ compte: plan.buyerPatch.compte }), 170);
  assert.equal(calcOr({ compte: plan.sellerPatch.compte }), 350);
  assert.match(plan.buyerPatch.compte.depenses.at(-1).libelle, /^Marché · Anneau de Force \(Aria\)$/);
  assert.match(plan.sellerPatch.compte.recettes.at(-1).libelle, /→ Borin$/);
  assert.equal(plan.buyerPatch.inventoryHistory[0].type, 'receive');
  assert.equal(plan.sellerPatch.inventoryHistory[0].type, 'sell');
  assert.equal(plan.sellerPatch.inventaire, undefined, 'le vendeur ne perd rien de plus : l’objet était déjà en dépôt');
  assert.equal(plan.postPatch.status, 'resolved');
  const changed = Object.keys(plan.postPatch.listing).filter(key => JSON.stringify(plan.postPatch.listing[key]) !== JSON.stringify(post.listing[key]));
  assert.deepEqual(changed.sort(), ['buyerCharId', 'buyerName', 'buyerUid', 'soldAt']);
  assert.equal(plan.postPatch.listing.buyerUid, 'u-borin');
});

test('achat refusé : vendu, retiré, sa propre vente, prix changé, or insuffisant', () => {
  const sold = listingPost({ status: 'resolved', listing: { ...listingPost().listing, buyerName: 'Kael' } });
  assert.throws(() => planMarketPurchase({ post: sold, buyer: buyer(), seller: seller() }), /Déjà vendu à Kael/);
  assert.throws(() => planMarketPurchase({ post: listingPost({ status: 'cancelled' }), buyer: buyer(), seller: seller() }), { code: 'withdrawn' });
  assert.throws(() => planMarketPurchase({ post: listingPost(), buyer: seller(), seller: seller() }), { code: 'own' });
  assert.throws(() => planMarketPurchase({ post: listingPost(), buyer: { ...buyer(), id: 'alt' }, seller: seller(), buyerUid: 'u-aria' }), { code: 'own' });
  assert.throws(() => planMarketPurchase({ post: listingPost(), buyer: buyer(), seller: seller(), expectedPrice: 200 }), { code: 'price' });
  const poor = { ...buyer(), compte: ledger(100) };
  assert.throws(() => planMarketPurchase({ post: listingPost(), buyer: poor, seller: seller() }), /Il manque 150 or à Borin/);
  assert.throws(() => planMarketPurchase({ post: listingPost(), buyer: buyer(), seller: null }), { code: 'seller' });
  assert.throws(() => planMarketPurchase({ post: null, buyer: buyer(), seller: seller() }), { code: 'gone' });
});

test('le solde d’une très ancienne fiche (champ or seul) est reporté avant la première ligne', () => {
  const legacy = { id: 'old', nom: 'Vieux', or: 500 };
  const compte = marketLedgerPayload(legacy, -250, 'Marché · test', '03/11/2026');
  assert.equal(compte.recettes[0].libelle, 'Solde initial');
  assert.equal(calcOr({ compte }), 250);
  const plan = planMarketPurchase({ post: listingPost(), buyer: legacy, seller: seller(), buyerUid: 'u-old' });
  assert.equal(calcOr({ compte: plan.buyerPatch.compte }), 250);
});

test('retrait : les unités reviennent au vendeur et la vente passe « retirée »', () => {
  const plan = planMarketWithdraw({ post: listingPost(), seller: seller(), now: 7 });
  assert.equal(plan.sellerPatch.inventaire.length, 4);
  assert.equal(plan.sellerPatch.inventaire.at(-1).nom, 'Anneau de Force');
  assert.equal(plan.sellerPatch.inventoryHistory[0].type, 'receive');
  assert.deepEqual(plan.postPatch, { status: 'cancelled', updatedAt: 7 });
  assert.throws(() => planMarketWithdraw({ post: listingPost({ status: 'resolved' }), seller: seller() }), { code: 'sold' });
  assert.throws(() => planMarketWithdraw({ post: listingPost({ status: 'cancelled' }), seller: seller() }), { code: 'withdrawn' });
});

test('changement de prix : seulement sur une vente ouverte, seul `price` change', () => {
  const post = listingPost();
  const plan = planMarketPrice({ post, price: '300', now: 8 });
  assert.equal(plan.postPatch.listing.price, 300);
  assert.deepEqual({ ...plan.postPatch.listing, price: 250 }, post.listing);
  assert.throws(() => planMarketPrice({ post: listingPost({ status: 'resolved' }), price: 300 }), { code: 'sold' });
  assert.throws(() => planMarketPrice({ post, price: 'abc' }), { code: 'price' });
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
