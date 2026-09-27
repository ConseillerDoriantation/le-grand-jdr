import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeInventaire,
  inventaireNeedsNorm,
  getInventoryItemValue,
  getInventoryItemResaleValue,
  getInventoryItemImage,
  getInventoryReadableDocument,
  getShopItemEditableText,
  shopItemToInvEntry,
} from '../assets/js/shared/inventory-utils.js';

test('inventaireNeedsNorm : vrai dès qu’une entrée a qte > 1', () => {
  assert.equal(inventaireNeedsNorm([{ qte: 2 }]), true);
  assert.equal(inventaireNeedsNorm([{ qte: 1 }, { nom: 'X' }]), false);
  assert.equal(inventaireNeedsNorm([]), false);
  assert.equal(inventaireNeedsNorm(null), false);
});

test('normalizeInventaire : split une entrée qte=N en N entrées qte=1', () => {
  const out = normalizeInventaire([{ nom: 'Potion', qte: 3, rarete: 'commune' }]);
  assert.equal(out.length, 3);
  assert.ok(out.every(e => e.qte === 1));
  assert.ok(out.every(e => e.nom === 'Potion' && e.rarete === 'commune'), 'préserve les autres champs');
});

test('normalizeInventaire : idempotent (retourne le tableau d’origine si déjà normalisé)', () => {
  const inv = [{ nom: 'A', qte: 1 }, { nom: 'B' }];
  assert.equal(normalizeInventaire(inv), inv, 'même référence quand rien à faire');
});

test('normalizeInventaire : mix qte=1 et qte>1', () => {
  const out = normalizeInventaire([{ nom: 'A' }, { nom: 'B', qte: 2 }]);
  assert.equal(out.length, 3);
  assert.equal(out.filter(e => e.nom === 'B').length, 2);
});

test('normalizeInventaire : valeur non-tableau renvoyée telle quelle', () => {
  assert.equal(normalizeInventaire(null), null);
  assert.equal(normalizeInventaire(undefined), undefined);
});

test('valeur inventaire : catalogue puis prixAchat puis anciens champs', () => {
  assert.equal(getInventoryItemValue({ prixAchat: 480, prix: 200 }), 480);
  assert.equal(getInventoryItemValue({ prixAchat: 480 }, { prix: 520 }), 520);
  assert.equal(getInventoryItemValue({ prix: 200 }), 200);
  assert.equal(getInventoryItemValue({ price: 75 }), 75);
});

test('valeur de vente : valeur explicite puis ratio de 60 %', () => {
  assert.equal(getInventoryItemResaleValue({ prixAchat: 480, prixVente: 288 }), 288);
  assert.equal(getInventoryItemResaleValue({ prixAchat: 480 }), 288);
  assert.equal(
    getInventoryItemResaleValue({ prixAchat: 200, prixVente: 120 }, { prix: 480, prixVente: 288 }),
    288,
  );
});

test('image inventaire : image locale puis illustration du catalogue', () => {
  assert.equal(getInventoryItemImage({ image: 'local.webp' }, { image: 'shop.webp' }), 'local.webp');
  assert.equal(getInventoryItemImage({ itemId: 'x' }, { image: 'shop.webp' }), 'shop.webp');
  assert.equal(getInventoryItemImage({}, { imageUrl: 'shop-url.webp' }), 'shop-url.webp');
});

test('édition boutique : les anciens champs effet et description se remplacent mutuellement', () => {
  assert.equal(getShopItemEditableText({ description: 'Ancien texte' }, 'effet'), 'Ancien texte');
  assert.equal(getShopItemEditableText({ effet: 'Ancien effet' }, 'description'), 'Ancien effet');
  assert.equal(getShopItemEditableText({ effet: 'Effet', description: 'Description' }, 'effet'), 'Effet');
  assert.equal(getShopItemEditableText({ effet: 'Effet', description: 'Description' }, 'description'), 'Description');
});

test('lecture inventaire : le document du catalogue est disponible seulement pour un objet possédé', () => {
  assert.deepEqual(
    getInventoryReadableDocument(
      { nom: 'Livre acheté', readableContent: '<p>Ancienne copie</p>' },
      { readableTitle: 'Chroniques', readableContent: '<p>Version actuelle</p>' },
    ),
    { title: 'Chroniques', html: '<p>Version actuelle</p>' },
  );
  assert.deepEqual(
    getInventoryReadableDocument(
      { nom: 'Lettre achetée', itemId: 'lettre-1' },
      { hasReadableContent: true, readableTitle: 'Lettre scellée' },
    ),
    { title: 'Lettre scellée', html: '' },
  );
  assert.equal(getInventoryReadableDocument({ nom: 'Objet vide' }, null), null);
});

test('un texte long reste dans le catalogue et ne gonfle pas chaque inventaire', () => {
  const entry = shopItemToInvEntry({
    id: 'livre-1', nom: 'Livre', prix: 12,
    readableTitle: 'Le secret', readableContent: '<p>Une très longue histoire</p>',
  });
  assert.equal(entry.itemId, 'livre-1');
  assert.equal(entry.readableTitle, undefined);
  assert.equal(entry.readableContent, undefined);
});
