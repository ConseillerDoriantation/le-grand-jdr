import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeInventaire,
  inventaireNeedsNorm,
  getInventoryItemValue,
  getInventoryItemResaleValue,
  getInventoryItemImage,
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
