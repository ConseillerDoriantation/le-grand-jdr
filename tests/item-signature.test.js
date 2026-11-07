import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  cleanNonRecyclableTraits,
  isTraitRecyclable,
  nonRecyclableTraitNames,
  recyclableTraits,
} from '../assets/js/shared/trait-recycling.js';

const root = new URL('../', import.meta.url);
const artisan   = readFileSync(new URL('assets/js/features/artisan.js', root), 'utf8');
const shop      = readFileSync(new URL('assets/js/features/shop.js', root), 'utf8');
const itemForge = readFileSync(new URL('assets/js/features/characters/item-forge.js', root), 'utf8');
const vttForge  = readFileSync(new URL('assets/js/features/vtt/vtt-mini-fiche.js', root), 'utf8');

test('recyclage : le verrou appartient au trait, pas à tout l’objet', () => {
  const item = {
    traits: ['Finesse', 'Lame liée', 'Rapide'],
    nonRecyclableTraits: ['Lame liée'],
  };
  assert.deepEqual(nonRecyclableTraitNames(item), ['Lame liée']);
  assert.deepEqual(recyclableTraits(item), ['Finesse', 'Rapide']);
  assert.equal(isTraitRecyclable(item, 'Lame liée'), false);
  assert.equal(isTraitRecyclable(item, 'Finesse'), true);
  assert.match(artisan, /recyclableTraits\(item, allTraits\)/);
  assert.match(artisan, /traitsToExtract = recyclableTraits\(item, traitsToExtract\)/);
});

test('amélioration : un trait non recyclable ne peut pas être écrasé', () => {
  assert.match(artisan, /const signature = !isTraitRecyclable\(item, trait\)/);
  assert.match(artisan, /signature \? '<span class="art-slot-lock"/);
  const guards = artisan.match(/if \(!isTraitRecyclable\(item, oldTraitName\)\)/g) || [];
  assert.equal(guards.length, 2, 'le démarrage et la confirmation doivent tous deux être protégés');
  assert.match(artisan, /art-trait-slot is-filled\$\{signature \? ' is-signature'/);
});

test('recyclage : les anciens objets noRecycle restent protégés pendant la migration', () => {
  const legacy = { traits: ['Unique', 'Maudit'], noRecycle: true };
  assert.deepEqual(nonRecyclableTraitNames(legacy), legacy.traits);
  assert.deepEqual(recyclableTraits(legacy), []);
});

test('nettoyage : seuls les noms de traits présents sont persistés', () => {
  assert.deepEqual(
    cleanNonRecyclableTraits(['Épique', 'Finesse'], ['epique', 'Inconnu', 'FINESSE']),
    ['Épique', 'Finesse'],
  );
});

test('éditeur boutique : le verrou de recyclage est proposé sur chaque ligne de trait', () => {
  assert.match(shop, /data-sh-action="traitRecycle"/);
  assert.match(shop, /si-trait-locks-data/);
  assert.match(shop, /data\.nonRecyclableTraits = cleanNonRecyclableTraits/);
  assert.doesNotMatch(shop, /id=['"]si-norecycle/);
});

test('forge d’objet et VTT : la métadonnée reste attachée aux traits', () => {
  assert.match(itemForge, /Traits non recyclables/);
  assert.match(itemForge, /nonRecyclableTraits: cleanNonRecyclableTraits/);
  assert.doesNotMatch(itemForge, /data-forge-field="noRecycle"/);
  assert.match(vttForge, /recyclableTraits\(it\)/);
});

test('la liste globale signatureTraits a bien été retirée', () => {
  const upg = readFileSync(new URL('assets/js/shared/upgrade-settings.js', root), 'utf8');
  assert.doesNotMatch(upg, /signatureTraits/);
  assert.doesNotMatch(artisan, /partitionTraits/);
});
