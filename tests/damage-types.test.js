import test from 'node:test';
import assert from 'node:assert/strict';

import { getAttackMissEffect, isMagicDamageDelivery } from '../assets/js/shared/damage-type-rules.js';

const damageTypes = [
  {
    id: 'physique',
    label: 'Physique',
    isMagic: false,
    rules: { missEffect: 'none', missScope: 'always' },
  },
  {
    id: 'feu',
    label: 'Feu',
    isMagic: true,
    rules: { missEffect: 'half', missScope: 'magic' },
  },
];

test('une attaque élémentaire du bestiaire est reconnue comme magique sans mana', () => {
  const beastAttack = {
    id: 'beast_arme_0',
    damageTypeId: 'feu',
    pmCost: 0,
    typeRules: damageTypes[1].rules,
  };

  assert.equal(isMagicDamageDelivery(beastAttack, damageTypes), true);
  assert.equal(getAttackMissEffect(beastAttack, damageTypes), 'half');
});

test('une action élémentaire gratuite du bestiaire conserve la règle du type', () => {
  const beastAction = {
    id: 'beast_act_0',
    damageTypeId: 'feu',
    pmCost: 0,
    typeRules: { missEffect: 'full', missScope: 'magic' },
  };

  assert.equal(getAttackMissEffect(beastAction, damageTypes), 'full');
});

test('une attaque physique reste exclue d une règle réservée aux attaques magiques', () => {
  const physicalAttack = {
    id: 'beast_arme_0',
    damageTypeId: 'physique',
    pmCost: 0,
    typeRules: { missEffect: 'half', missScope: 'magic' },
  };

  assert.equal(isMagicDamageDelivery(physicalAttack, damageTypes), false);
  assert.equal(getAttackMissEffect(physicalAttack, damageTypes), 'none');
});

test('la portée Toute attaque reste identique pour les personnages et le bestiaire', () => {
  const attack = {
    damageTypeId: 'physique',
    pmCost: 0,
    typeRules: { missEffect: 'half', missScope: 'always' },
  };

  assert.equal(getAttackMissEffect(attack, damageTypes), 'half');
});
