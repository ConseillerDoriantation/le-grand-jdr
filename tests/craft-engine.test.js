import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_CRAFT_CONFIG,
  craftDiscipline, craftCompetenceId, craftMaterialCategory,
  craftDD, craftMaterialQty, craftMaterialRequirement, hasCraftMaterials,
  resolveCraftRoll, craftRefundOnFail, traitPoolFor, craftableTraits, isTraitAllowed,
} from '../assets/js/shared/craft-engine.js';

const TRAITS = [
  { id: 'aiguise',   portee: 'arme',    tier: 1 },
  { id: 'perce',     portee: 'arme',    tier: 2 },
  { id: 'balayage',  portee: 'arme',    tier: 3 },
  { id: 'leger',     portee: 'armure',  tier: 1 },  // origine bottes
  { id: 'robuste',   portee: 'armure',  tier: 1 },  // origine torse
  { id: 'egide',     portee: 'armure',  tier: 3 },
  { id: 'anneauMin', portee: 'anneau',  tier: 1 },
  { id: 'souffle',   portee: 'amulette',tier: 1 },
];

test('discipline : défauts (Forge/Confection/Orfèvre) selon le type', () => {
  assert.equal(craftDiscipline('armeCaC'), 'forge');
  assert.equal(craftDiscipline('armeDist'), 'confection');
  assert.equal(craftDiscipline('armeMagique'), 'orfevre');
  assert.equal(craftDiscipline('armureLourde'), 'forge');
  assert.equal(craftDiscipline('armureLegere'), 'confection');
  assert.equal(craftDiscipline('anneau'), 'orfevre');
  assert.equal(craftDiscipline('amulette'), 'orfevre');
  assert.equal(craftDiscipline('inconnu'), null);
});

test('compétence de discipline : vide par défaut, résolue via config MJ', () => {
  assert.equal(craftCompetenceId('armeCaC'), '');
  const cfg = { disciplineCompetence: { forge: 'comp_forge', confection: '', orfevre: 'comp_orf' } };
  assert.equal(craftCompetenceId('armeCaC', cfg), 'comp_forge');
  assert.equal(craftCompetenceId('anneau', cfg), 'comp_orf');
  assert.equal(craftCompetenceId('armeDist', cfg), ''); // confection non reliée
});

test('catégorie de matériau selon le type', () => {
  assert.equal(craftMaterialCategory('armeCaC'), 'bestiaux');
  assert.equal(craftMaterialCategory('armeDist'), 'souples');
  assert.equal(craftMaterialCategory('armeMagique'), 'mystiques');
  assert.equal(craftMaterialCategory('armureIntermediaire'), 'tannes');
  assert.equal(craftMaterialCategory('anneau'), 'precieux');
});

test('DD et quantité par palier (défauts éditables)', () => {
  assert.deepEqual([craftDD(1), craftDD(2), craftDD(3)], [11, 14, 17]);
  assert.deepEqual([craftMaterialQty(1), craftMaterialQty(2), craftMaterialQty(3)], [6, 10, 15]);
  assert.equal(craftDD(4), null);
  assert.equal(craftDD(1, { ddParPalier: { 1: 10, 2: 13, 3: 16 } }), 10);
});

test('exigence en matériaux complète', () => {
  assert.deepEqual(craftMaterialRequirement('armeCaC', 2), { matCategorie: 'bestiaux', tier: 2, quantite: 10 });
  assert.deepEqual(craftMaterialRequirement('armureLourde', 3), { matCategorie: 'resistants', tier: 3, quantite: 15 });
  assert.equal(craftMaterialRequirement('armeCaC', 5), null);
});

test('hasCraftMaterials : compte les unités catégorie+palier', () => {
  const req = craftMaterialRequirement('armeCaC', 1); // bestiaux ★, 6
  const inv = [
    ...Array(6).fill({ matCategorie: 'bestiaux', tier: 1 }),
    { matCategorie: 'bestiaux', tier: 2 }, // mauvais palier
    { matCategorie: 'souples', tier: 1 },  // mauvaise catégorie
  ];
  assert.equal(hasCraftMaterials(inv, req), true);
  assert.equal(hasCraftMaterials(inv.slice(0, 5), req), false); // 5 < 6
});

test('résolution du jet : succès si total >= DD', () => {
  // Palier 2 → DD 14. d20=10 + bonus 4 = 14 → succès.
  let r = resolveCraftRoll(10, 4, 2);
  assert.equal(r.dd, 14); assert.equal(r.total, 14); assert.equal(r.success, true);
  // 10 + 3 = 13 < 14 → échec.
  r = resolveCraftRoll(10, 3, 2);
  assert.equal(r.success, false);
  // d20 borné à [1,20].
  assert.equal(resolveCraftRoll(99, 0, 1).d20, 20);
  assert.equal(resolveCraftRoll(0, 0, 1).d20, 1);
});

test('remboursement en cas d échec : moitié, arrondi inférieur', () => {
  assert.equal(craftRefundOnFail(10), 5);
  assert.equal(craftRefundOnFail(15), 7);
  assert.equal(craftRefundOnFail(6), 3);
  assert.equal(craftRefundOnFail(0), 0);
});

test('pool de traits : armes/armures/anneau/amulette', () => {
  assert.equal(traitPoolFor('armeMagique'), 'arme');
  assert.equal(traitPoolFor('armureLegere'), 'armure');
  assert.equal(traitPoolFor('armureLourde'), 'armure');
  assert.equal(traitPoolFor('anneau'), 'anneau');
  assert.equal(traitPoolFor('amulette'), 'amulette');
});

test('traits piochables : armure fusionne les slots, arme isolée', () => {
  // Une armure lourde 1★ voit TOUS les traits d'armure 1★ (torse + bottes fusionnés).
  const armureT1 = craftableTraits('armureLegere', 1, TRAITS).map(t => t.id).sort();
  assert.deepEqual(armureT1, ['leger', 'robuste']);
  // Une arme ne voit que les traits 'arme' de son palier.
  assert.deepEqual(craftableTraits('armeCaC', 3, TRAITS).map(t => t.id), ['balayage']);
  // Anneau et amulette restent séparés.
  assert.deepEqual(craftableTraits('anneau', 1, TRAITS).map(t => t.id), ['anneauMin']);
  assert.deepEqual(craftableTraits('amulette', 1, TRAITS).map(t => t.id), ['souffle']);
});

test('isTraitAllowed : même pool + même palier', () => {
  const trait = { id: 'robuste', portee: 'armure', tier: 1 };
  assert.equal(isTraitAllowed(trait, 'armureLourde', 1), true);  // armure↔armure
  assert.equal(isTraitAllowed(trait, 'armeCaC', 1), false);      // pool arme ≠ armure
  assert.equal(isTraitAllowed(trait, 'armureLourde', 2), false); // mauvais palier
  assert.equal(isTraitAllowed({ portee: 'anneau', tier: 1 }, 'amulette', 1), false); // anneau ≠ amulette
});

test('DEFAULT_CRAFT_CONFIG couvre les 8 types', () => {
  const types = ['armeCaC','armeDist','armeMagique','armureLegere','armureIntermediaire','armureLourde','anneau','amulette'];
  for (const t of types) {
    assert.ok(DEFAULT_CRAFT_CONFIG.categorieDiscipline[t], `discipline manquante pour ${t}`);
    assert.ok(DEFAULT_CRAFT_CONFIG.categorieMateriau[t], `matériau manquant pour ${t}`);
  }
});
