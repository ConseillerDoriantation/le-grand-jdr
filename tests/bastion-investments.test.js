import test from 'node:test';
import assert from 'node:assert/strict';
import {
  roomFundingPlan,
  roomInvestmentAvailable,
  roomInvestmentTotal,
} from '../assets/js/shared/bastion-investments.js';

test('les contributions d une salle sont isolées des autres salles', () => {
  const investments = [
    { roomSlug: 'forge', amount: 40 },
    { roomSlug: 'forge', amount: 60 },
    { roomSlug: 'taverne', amount: 500 },
    { roomSlug: 'forge', amount: -20 },
  ];
  assert.equal(roomInvestmentTotal(investments, 'forge'), 100);
});

test('les investissements déjà consommés ne sont plus disponibles', () => {
  const bastion = { roomInvestmentSpent: { forge: 70 } };
  const investments = [{ roomSlug: 'forge', amount: 120 }];
  assert.equal(roomInvestmentAvailable(bastion, investments, 'forge'), 50);
});

test('le chantier consomme la cagnotte dédiée avant le trésor commun', () => {
  assert.deepEqual(roomFundingPlan(200, 150, 80), {
    investmentUsed: 150,
    treasuryUsed: 50,
    missing: 0,
    canFund: true,
  });
  assert.deepEqual(roomFundingPlan(200, 50, 80), {
    investmentUsed: 50,
    treasuryUsed: 80,
    missing: 70,
    canFund: false,
  });
});
