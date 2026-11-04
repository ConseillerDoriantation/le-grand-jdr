import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const artisan   = readFileSync(new URL('assets/js/features/artisan.js', root), 'utf8');
const shop      = readFileSync(new URL('assets/js/features/shop.js', root), 'utf8');
const itemForge = readFileSync(new URL('assets/js/features/characters/item-forge.js', root), 'utf8');

test('recyclage : un objet noRecycle ne rend aucun fragment', () => {
  // Flag lu sur l'objet (pas de liste globale).
  assert.match(artisan, /const locked = !!item\.noRecycle/);
  assert.match(artisan, /const transferable = locked \? \[\] : allTraits/);
  // Garde-fou au moment de la destruction effective.
  assert.match(artisan, /if \(item\.noRecycle\) traitsToExtract = \[\]/);
});

test('éditeur boutique : case « Non recyclable » pour les équipables', () => {
  assert.match(shop, /flag\('si-norecycle'/);
  assert.match(shop, /\['arme', 'armure', 'bijou'\]\.includes\(tplKey\)/);
  // Lecture live + collecte à l'enregistrement.
  assert.match(shop, /getElementById\('si-norecycle'\)/);
  assert.match(shop, /data\.noRecycle = !!document\.getElementById\('si-norecycle'\)\.checked/);
});

test('forge d’objet : case MJ + persistance du flag', () => {
  assert.match(itemForge, /data-forge-field="noRecycle"/);
  assert.match(itemForge, /STATE\.isAdmin/);
  assert.match(itemForge, /\.\.\.\(d\.noRecycle \? \{ noRecycle: true \} : \{\}\)/);
  // La sync DOM gère les cases à cocher.
  assert.match(itemForge, /el\.type === 'checkbox' \? el\.checked : el\.value/);
});

test('la liste globale signatureTraits a bien été retirée', () => {
  const upg = readFileSync(new URL('assets/js/shared/upgrade-settings.js', root), 'utf8');
  assert.doesNotMatch(upg, /signatureTraits/);
  assert.doesNotMatch(artisan, /partitionTraits/);
});
