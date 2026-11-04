import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { DEFAULT_REFORGE, mergeReforge, evaluateReforge } from '../assets/js/shared/reforge.js';

const root = new URL('../', import.meta.url);
const artisan = readFileSync(new URL('assets/js/features/artisan.js', root), 'utf8');
const upg = readFileSync(new URL('assets/js/shared/upgrade-settings.js', root), 'utf8');

const MAT = [{ itemId: 'mat_fer', quantite: 2 }];
const INV_OK = [{ itemId: 'mat_fer' }, { itemId: 'mat_fer' }, { itemId: 'mat_fer' }];

function base(over = {}) {
  return {
    rarete: 2, maxRarete: 5, discipline: 'forge', roomLevel: 1,
    materialReq: MAT, inventory: INV_OK, gold: 1000, ...over,
  };
}

test('défauts : disciplines mappées aux salles standard, 5★ = salle niv III', () => {
  assert.deepEqual(DEFAULT_REFORGE.disciplineRoom, { forge: 'forge', confection: 'atelier_confection', orfevre: 'atelier_orfevre' });
  assert.equal(DEFAULT_REFORGE.roomLevelForRarity[5], 3);
  assert.equal(DEFAULT_REFORGE.roomLevelForRarity[3], 1);
});

test('reforge possible quand salle + matériaux + or sont réunis', () => {
  const ev = evaluateReforge(base());
  assert.equal(ev.ok, true);
  assert.equal(ev.target, 3);
  assert.equal(ev.roomSlug, 'forge');
  assert.equal(ev.reason, null);
});

test('bloquée si la salle n’est pas au niveau requis', () => {
  // viser 4★ (niv II requis) avec une salle niv I
  const ev = evaluateReforge(base({ rarete: 3, roomLevel: 1 }));
  assert.equal(ev.target, 4);
  assert.equal(ev.requiredLevel, 2);
  assert.equal(ev.ok, false);
  assert.equal(ev.reason, 'room');
});

test('bloquée si matériaux insuffisants', () => {
  const ev = evaluateReforge(base({ inventory: [{ itemId: 'mat_fer' }] })); // 1 < 2
  assert.equal(ev.ok, false);
  assert.equal(ev.reason, 'materials');
  assert.equal(ev.missing[0].manque, 1);
});

test('bloquée si aucune recette de matériaux (pas de reforge gratuite)', () => {
  const ev = evaluateReforge(base({ materialReq: [] }));
  assert.equal(ev.ok, false);
  assert.equal(ev.reason, 'no_recipe');
});

test('bloquée si or insuffisant', () => {
  const ev = evaluateReforge(base({ gold: 0 }));
  assert.equal(ev.ok, false);
  assert.equal(ev.reason, 'gold');
});

test('bloquée si la discipline n’est liée à aucune salle', () => {
  const ev = evaluateReforge(base({ discipline: 'inconnue' }));
  assert.equal(ev.ok, false);
  assert.equal(ev.reason, 'no_room_mapping');
});

test('rareté max atteinte → pas de cible', () => {
  const ev = evaluateReforge(base({ rarete: 5 }));
  assert.equal(ev.target, null);
  assert.equal(ev.reason, 'max');
});

test('reforge désactivée via config', () => {
  const ev = evaluateReforge(base({ cfg: { enabled: false } }));
  assert.equal(ev.ok, false);
  assert.equal(ev.reason, 'disabled');
});

test('mergeReforge préserve les défauts pour les champs absents', () => {
  const m = mergeReforge({ goldForRarity: { 5: 2000 } });
  assert.equal(m.goldForRarity[5], 2000);       // override
  assert.equal(m.goldForRarity[2], DEFAULT_REFORGE.goldForRarity[2]); // défaut préservé
  assert.deepEqual(m.disciplineRoom, DEFAULT_REFORGE.disciplineRoom);
});

test('câblage artisan : section reforge, action, consommation matériaux, +1 rareté', () => {
  assert.match(artisan, /_renderReforgeSection\(item, i, c\)/);        // branchée dans l'établi
  assert.match(artisan, /_artisanReforge: \(btn\) =>/);                // action enregistrée
  assert.match(artisan, /rarete: ev\.target/);                        // monte la rareté
  assert.match(artisan, /_consumeMaterials\(inv, materialReq\)/);      // consomme les matériaux
  assert.match(artisan, /op: 'reforge', from: fromName, to: toName/); // tracé dans l'historique
  assert.match(artisan, /STORE\.bastion\?\.salles\?\.\[roomSlug\]\?\.niveau/); // lit le niveau de salle
});

test('upgrade-settings stocke la config reforge (par aventure)', () => {
  assert.match(upg, /reforge: DEFAULT_REFORGE/);
  assert.match(upg, /reforge: mergeReforge\(stored\.reforge\)/);
});

test('admin 2b : section reforge éditable (activation, salles, niveaux, or)', () => {
  // Toggle d'activation (champ littéral).
  assert.match(upg, /data-field="reforge\.enabled"/);
  // Mapping discipline→salle : helper templaté + appelé pour les 3 disciplines.
  assert.match(upg, /data-field="reforge\.disciplineRoom\.\$\{disc\}"/);
  assert.match(upg, /discRow\('forge'/);
  assert.match(upg, /discRow\('confection'/);
  assert.match(upg, /discRow\('orfevre'/);
  // Niveau requis + or par rareté cible (helper templaté).
  assert.match(upg, /data-field="reforge\.roomLevelForRarity\.\$\{r\.value\}"/);
  assert.match(upg, /data-field="reforge\.goldForRarity\.\$\{r\.value\}"/);
  // Les sélecteurs de salle écrivent une chaîne, pas un nombre.
  assert.match(upg, /_upgStr: \(el\) => _upgSetField\(el\.dataset\.field, el\.value\)/);
  assert.match(upg, /data-change="_upgStr"/);
  // Catalogue de salles chargé pour peupler les sélecteurs.
  assert.match(upg, /getDocData\('bastion', 'main'\)/);
});
