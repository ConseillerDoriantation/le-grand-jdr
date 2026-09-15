import test from 'node:test';
import assert from 'node:assert/strict';

import {
  combinedTechniqueTargetCA,
  normalizeWeaponTechnique,
  techniqueAllowedForAction,
  techniqueAreaIntersects,
  techniqueOutcomeMultiplier,
  techniqueBlastIntersects,
  techniqueScalingSteps,
  techniqueTriggerApplies,
  weaponTechniqueTargetCA,
  weaponTechniqueDamageTerms,
} from '../assets/js/shared/weapon-techniques.js';

test('Point faible augmente la CA sans modifier la CA de base', () => {
  const technique = normalizeWeaponTechnique({ label: 'Point faible', defenseBonus: 4 });
  assert.equal(weaponTechniqueTargetCA(15, technique), 19);
  assert.equal(weaponTechniqueTargetCA(15, null), 15);
});

test('les paramètres tactiques avancés sont normalisés et bornés', () => {
  const technique = normalizeWeaponTechnique({
    trigger: 'crit', attackModifier: -4, damageTypeId: 'feu', criticalMode: 'double',
    scalingMode: 'level', scalingEvery: 5, scalingFormula: '1d4',
    areaShape: 'cone', areaOrigin: 'caster', areaTargets: 'enemies', includeCaster: true,
    conditionId: 'burning', conditionDuration: 3, conditionSaveStat: 'dexterite', conditionSaveDC: 17,
    forcedMovement: 'push', forcedMovementDistance: 4,
    resourceType: 'pm', resourceCost: 2, usageScope: 'combat', maxUses: 3, cooldownRounds: 2,
  });
  assert.equal(technique.trigger, 'crit');
  assert.equal(technique.attackModifier, -4);
  assert.equal(technique.damageTypeId, 'feu');
  assert.equal(technique.areaShape, 'cone');
  assert.equal(technique.conditionSaveDC, 17);
  assert.equal(technique.forcedMovementDistance, 4);
  assert.equal(technique.resourceCost, 2);
  assert.equal(technique.cooldownRounds, 2);
});

test('les déclencheurs distinguent touche, échec, critique et toujours', () => {
  assert.equal(techniqueTriggerApplies({ trigger: 'hit' }, { hit: true }), true);
  assert.equal(techniqueTriggerApplies({ trigger: 'miss' }, { hit: false }), true);
  assert.equal(techniqueTriggerApplies({ trigger: 'crit' }, { hit: true, isCrit: true }), true);
  assert.equal(techniqueTriggerApplies({ trigger: 'crit' }, { hit: true, isCrit: false }), false);
  assert.equal(techniqueTriggerApplies({ trigger: 'always' }, { hit: false }), true);
});

test('une technique sur touche ne fuit pas dans les demi-dégâts sans autorisation', () => {
  const outcome = { hit: false, isCrit: false };
  assert.equal(techniqueOutcomeMultiplier({ trigger: 'hit' }, outcome), 0);
  assert.equal(techniqueOutcomeMultiplier({ trigger: 'hit', missEffectMode: 'half' }, outcome), 0.5);
  assert.equal(techniqueOutcomeMultiplier({ trigger: 'hit', missEffectMode: 'full' }, outcome), 1);
  assert.equal(techniqueOutcomeMultiplier({ trigger: 'hit', missEffectMode: 'full' }, { ...outcome, isFumble: true }), 0);
  assert.equal(techniqueOutcomeMultiplier({ trigger: 'hit', missEffectMode: 'full' }, { ...outcome, blocked: true }), 0);
});

test('les sorts et capacités respectent l’autorisation de chaque technique', () => {
  assert.equal(techniqueAllowedForAction({ allowWithAbilities: true }, { ability: true }), true);
  assert.equal(techniqueAllowedForAction({ allowWithAbilities: false }, { ability: true }), false);
  assert.equal(techniqueAllowedForAction({ allowWithAbilities: false }, { ability: false }), true);
});

test('la progression ajoute une formule par palier atteint', () => {
  const technique = normalizeWeaponTechnique({ scalingMode: 'level', scalingEvery: 5, scalingFormula: '1d4' });
  assert.equal(techniqueScalingSteps(technique, { level: 12 }), 2);
  assert.deepEqual(weaponTechniqueDamageTerms(technique, '1d8', 0, { level: 12 }), [
    { kind: 'scaling', formula: '2d4', steps: 2 },
  ]);
});

test('les zones ligne, cône et cercle respectent la direction et la portée', () => {
  const source = { col: 0, row: 0, width: 1, height: 1 };
  const aim = { col: 4, row: 0, width: 1, height: 1 };
  const origin = aim;
  assert.equal(techniqueAreaIntersects({ source, aim, origin, candidate: { col: 3, row: 0, width: 1, height: 1 } }, { blastRadius: 5, areaShape: 'line' }), true);
  assert.equal(techniqueAreaIntersects({ source, aim, origin, candidate: { col: 3, row: 3, width: 1, height: 1 } }, { blastRadius: 5, areaShape: 'line' }), false);
  assert.equal(techniqueAreaIntersects({ source, aim, origin, candidate: { col: 3, row: 2, width: 1, height: 1 } }, { blastRadius: 5, areaShape: 'cone' }), true);
  assert.equal(techniqueAreaIntersects({ source, aim, origin, candidate: { col: 9, row: 9, width: 1, height: 1 } }, { blastRadius: 2, areaShape: 'circle' }), false);
});

test('une technique d’arme et une technique élémentaire se cumulent', () => {
  const weapon = normalizeWeaponTechnique({ label: 'Point faible', defenseBonus: 4 });
  const elemental = normalizeWeaponTechnique({ label: 'Explosion ardente', defenseBonus: 2 });
  assert.equal(combinedTechniqueTargetCA(15, [weapon, elemental]), 21);
  assert.equal(combinedTechniqueTargetCA(15, [weapon]), 19);
});

test('un dé d’arme bonus reprend les faces de la formule équipée', () => {
  const technique = normalizeWeaponTechnique({ label: 'Point faible', extraWeaponDice: 1 });
  assert.deepEqual(weaponTechniqueDamageTerms(technique, '2d8+4'), [
    { kind: 'weapon', formula: '1d8' },
  ]);
});

test('une technique peut cumuler dés d’arme, formule dédiée et dégâts plats', () => {
  const technique = normalizeWeaponTechnique({
    label: 'Impact précis', extraWeaponDice: 2, extraDamageFormula: '1d4+1', extraDamageFlat: 3,
  });
  assert.deepEqual(weaponTechniqueDamageTerms(technique, '1d10'), [
    { kind: 'weapon', formula: '2d10' },
    { kind: 'formula', formula: '1d4+1' },
    { kind: 'flat', flat: 3 },
  ]);
});

test('les valeurs de technique sont bornées avant stockage et calcul', () => {
  const technique = normalizeWeaponTechnique({
    label: '  Test  ', defenseBonus: 999, extraWeaponDice: -2, extraDamageFlat: -5,
  });
  assert.equal(technique.label, 'Test');
  assert.equal(technique.defenseBonus, 30);
  assert.equal(technique.extraWeaponDice, 0);
  assert.equal(technique.extraDamageFlat, 0);
});

test('une technique élémentaire ajoute le modificateur de dégâts de l’arme', () => {
  const technique = normalizeWeaponTechnique({
    label: 'Explosion ardente', extraDamageFormula: '1d4', addWeaponModifier: true,
  });
  assert.deepEqual(weaponTechniqueDamageTerms(technique, '1d8', 4), [
    { kind: 'formula', formula: '1d4' },
    { kind: 'weapon_modifier', flat: 4 },
  ]);
});

test('le rayon entoure toute l’empreinte de la cible sans toucher au-delà', () => {
  const technique = normalizeWeaponTechnique({ label: 'Explosion', blastRadius: 1 });
  const largeTarget = { col: 4, row: 4, width: 3, height: 3 };
  assert.equal(techniqueBlastIntersects(largeTarget, { col: 3, row: 5, width: 1, height: 1 }, technique), true);
  assert.equal(techniqueBlastIntersects(largeTarget, { col: 7, row: 6, width: 1, height: 1 }, technique), true);
  assert.equal(techniqueBlastIntersects(largeTarget, { col: 8, row: 6, width: 1, height: 1 }, technique), false);
});
