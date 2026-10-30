import test from 'node:test';
import assert from 'node:assert/strict';
import {
  bastionEqualShare,
  bastionRoomProjects,
  roomFundingPlan,
  roomInvestmentAvailable,
  roomInvestmentContributors,
  roomInvestmentTotal,
  sortBastionProjects,
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

test('les segments contributeurs représentent seulement la cagnotte encore disponible', () => {
  const bastion = { roomInvestmentSpent: { forge: 75 } };
  const investments = [
    { roomSlug: 'forge', charId: 'a', charName: 'A', amount: 100 },
    { roomSlug: 'forge', charId: 'b', charName: 'B', amount: 50 },
  ];
  const contributors = roomInvestmentContributors(bastion, investments, 'forge');
  assert.equal(contributors.reduce((sum, row) => sum + row.amount, 0), 75);
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

test('les chantiers sont triés du plus proche au plus lointain', () => {
  const sorted = sortBastionProjects([
    { slug: 'forge', remaining: 350 },
    { slug: 'comptoir', remaining: 40 },
    { slug: 'herboristerie', remaining: 90 },
  ]);
  assert.deepEqual(sorted.map(project => project.slug), ['comptoir', 'herboristerie', 'forge']);
});

test('la part collective est arrondie au supérieur sur les personnages actifs', () => {
  assert.equal(bastionEqualShare(101, 4), 26);
  assert.equal(bastionEqualShare(101, 0), 101);
});

test('les chantiers ouverts ignorent les salles vides, en travaux ou au niveau max', () => {
  const bastion = {
    roomCatalog: [
      { slug: 'forge', nom: 'Forge', niveaux: [{ cout: 100 }, { cout: 250 }] },
      { slug: 'taverne', nom: 'Taverne', niveaux: [{ cout: 80 }] },
      { slug: 'comptoir', nom: 'Comptoir', niveaux: [{ cout: 200 }] },
    ],
    salles: {
      forge: { niveau: 1 },
      taverne: { niveau: 1 },
      comptoir: { niveau: 0, weeksLeftToBuild: 1 },
    },
  };
  const projects = bastionRoomProjects(bastion, [
    { roomSlug: 'forge', amount: 50 },
    { roomSlug: 'taverne', amount: 40 },
    { roomSlug: 'comptoir', amount: 100 },
  ]);
  assert.deepEqual(projects.map(project => project.slug), ['forge']);
  assert.equal(projects[0].remaining, 200);
});
