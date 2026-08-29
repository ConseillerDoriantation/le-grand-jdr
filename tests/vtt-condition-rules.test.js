import test from 'node:test';
import assert from 'node:assert/strict';

import {
  conditionDamageBonusApplies,
  conditionDamageFormula,
  conditionDamageReductionApplies,
  conditionStatRollMode,
} from '../assets/js/features/vtt/vtt-condition-rules.js';

const rageEffects = {
  dmgDealtBonus: '2',
  dmgDealtBonusByLevel: [
    { minLevel: 9, formula: '3' },
    { minLevel: 16, formula: '4' },
  ],
  dmgDealtWeaponOnly: true,
  dmgDealtMeleeOnly: true,
  dmgDealtRequiredStat: 'force',
  dmgReductionPct: 50,
  dmgReductionTypes: ['physique', 'contondant', 'perforant', 'tranchant'],
};

test('Rage fait progresser son bonus selon le niveau', () => {
  assert.equal(conditionDamageFormula(rageEffects, 1), '2');
  assert.equal(conditionDamageFormula(rageEffects, 8), '2');
  assert.equal(conditionDamageFormula(rageEffects, 9), '3');
  assert.equal(conditionDamageFormula(rageEffects, 15), '3');
  assert.equal(conditionDamageFormula(rageEffects, 16), '4');
  assert.equal(conditionDamageFormula(rageEffects, 20, '7'), '7');
});

test('Rage ne renforce que les attaques directes de mêlée utilisant la Force', () => {
  assert.equal(conditionDamageBonusApplies(rageEffects, {
    id: 'weapon', isMeleeAttack: true, portee: 3, dmgStatKeys: ['force'],
  }), true, 'une arme à allonge reste une attaque de mêlée');
  assert.equal(conditionDamageBonusApplies(rageEffects, {
    id: 'weapon', isMeleeAttack: true, dmgStatKeys: ['dexterite'],
  }), false);
  assert.equal(conditionDamageBonusApplies(rageEffects, {
    id: 'weapon', isMeleeAttack: false, dmgStatKeys: ['force'],
  }), false);
  assert.equal(conditionDamageBonusApplies(rageEffects, {
    id: 'spell_0', sortIdx: 0, isMeleeAttack: true, dmgStatKeys: ['force'],
  }), false);
});

test('Rage résiste aux dégâts physiques D&D mais pas aux dégâts élémentaires', () => {
  for (const type of ['physique', 'contondant', 'perforant', 'tranchant']) {
    assert.equal(conditionDamageReductionApplies(rageEffects, type), true);
  }
  assert.equal(conditionDamageReductionApplies(rageEffects, 'feu'), false);
  assert.equal(conditionDamageReductionApplies(rageEffects, 'psychique'), false);
});

test('Rage donne l’avantage aux tests et JS de Force sans ignorer un désavantage', () => {
  const rage = { lib: { effects: {
    checkAdvantageStats: ['force'],
    saveAdvantageStats: ['force'],
  } } };
  assert.equal(conditionStatRollMode([rage], 'force', 'check'), 'advantage');
  assert.equal(conditionStatRollMode([rage], 'force', 'save'), 'advantage');
  assert.equal(conditionStatRollMode([rage], 'dexterite', 'check'), '');
  assert.equal(conditionStatRollMode([
    rage,
    { lib: { effects: { checkDisadvantageStats: ['force'] } } },
  ], 'force', 'check'), 'normal');
});
