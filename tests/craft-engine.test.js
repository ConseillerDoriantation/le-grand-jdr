import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_CRAFT_CONFIG,
  craftDiscipline, craftCompetenceId,
  craftDD, craftMaterialQty,
  normalizeMaterialRequirements, countInventoryItem, missingMaterials, hasCraftMaterials,
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

test('DD et quantité par palier (défauts éditables)', () => {
  assert.deepEqual([craftDD(1), craftDD(2), craftDD(3)], [11, 14, 17]);
  assert.deepEqual([craftMaterialQty(1), craftMaterialQty(2), craftMaterialQty(3)], [6, 10, 15]);
  assert.equal(craftDD(4), null);
  assert.equal(craftDD(1, { ddParPalier: { 1: 10, 2: 13, 3: 16 } }), 10);
});

test('exigences liées par itemId : quantité par défaut = quantité du palier', () => {
  // Le MJ lie des objets par itemId ; sans quantité → défaut du palier (2★ = 10).
  assert.deepEqual(
    normalizeMaterialRequirements([{ itemId: 'mat_best_2' }], 2),
    [{ itemId: 'mat_best_2', quantite: 10 }],
  );
  // Quantité explicite respectée ; entrées sans itemId ignorées.
  assert.deepEqual(
    normalizeMaterialRequirements([{ itemId: 'encre', quantite: 3 }, { quantite: 5 }], 1),
    [{ itemId: 'encre', quantite: 3 }],
  );
});

test('matériaux : comptage par itemId + manques + couverture', () => {
  const inv = [
    ...Array(6).fill({ itemId: 'mat_best_1' }),
    { itemId: 'mat_best_2' },       // autre matériau
    { itemId: 'autre' },
  ];
  assert.equal(countInventoryItem(inv, 'mat_best_1'), 6);
  const reqs = normalizeMaterialRequirements([{ itemId: 'mat_best_1' }], 1); // 6 requis
  assert.equal(hasCraftMaterials(inv, reqs), true);
  assert.deepEqual(missingMaterials(inv, reqs), []);
  // Manque : 5 possédés < 6.
  const short = missingMaterials(inv.slice(0, 5), reqs);
  assert.deepEqual(short, [{ itemId: 'mat_best_1', quantite: 6, possede: 5, manque: 1 }]);
  assert.equal(hasCraftMaterials(inv.slice(0, 5), reqs), false);
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

test('échec : perte totale par défaut, fraction configurable', () => {
  // Défaut = perte totale (loot généreux).
  assert.equal(craftRefundOnFail(10), 0);
  assert.equal(craftRefundOnFail(15), 0);
  // Le MJ peut remonter la fraction (ex. 1/4), arrondi inférieur.
  const q = { refundFractionOnFail: 0.25 };
  assert.equal(craftRefundOnFail(10, q), 2);
  assert.equal(craftRefundOnFail(15, q), 3);
  // Fraction bornée à [0,1].
  assert.equal(craftRefundOnFail(10, { refundFractionOnFail: 2 }), 10);
  assert.equal(craftRefundOnFail(10, { refundFractionOnFail: -1 }), 0);
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

test('DEFAULT_CRAFT_CONFIG : une discipline pour chacun des 8 types', () => {
  const types = ['armeCaC','armeDist','armeMagique','armureLegere','armureIntermediaire','armureLourde','anneau','amulette'];
  for (const t of types) {
    assert.ok(DEFAULT_CRAFT_CONFIG.categorieDiscipline[t], `discipline manquante pour ${t}`);
  }
});
