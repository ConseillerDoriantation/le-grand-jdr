import test from 'node:test';
import assert from 'node:assert/strict';

import { buildMvpRawProfile, scoreMvpCampaign, scoreMvpSession, scoreMvpView } from '../assets/js/shared/stats-mvp.js';

const row = (id, combat = {}, sRolls = 0) => ({ id, name: id, combat, sRolls });

test('le MVP V2 ne recompte ni critiques, ni KO, ni plus gros coup', () => {
  const plain = buildMvpRawProfile(row('dps', { dmgDealt: 40, attacks: 3 }));
  const decorated = buildMvpRawProfile(row('dps', {
    dmgDealt: 40, attacks: 3, crits: 4, kosDealt: 3, biggestHit: 40,
  }));

  assert.equal(plain.axes.offense.raw, 40);
  assert.equal(decorated.axes.offense.raw, 40);
});

test('un tank et un DPS atteignant leur repère fixe obtiennent le même axe normalisé', () => {
  const scores = scoreMvpSession([
    row('dps', { dmgDealt: 100, attacks: 4 }),
    row('tank', { attacksTaken: 4, attacksAvoided: 3, dmgTaken: 92 }),
  ]);
  const dps = scores.find(result => result.id === 'dps');
  const tank = scores.find(result => result.id === 'tank');

  assert.equal(dps.details.entries[0].normalized, 100);
  assert.equal(tank.details.entries[0].normalized, 100);
  assert.equal(dps.score, tank.score);
});

test('un soigneur ou contrôleur dominant n’est pas mécaniquement derrière le DPS', () => {
  const healerScores = scoreMvpSession([
    row('dps', { dmgDealt: 100, attacks: 4 }),
    row('healer', { heal: 36, supportSpells: 2 }),
  ]);
  const controlScores = scoreMvpSession([
    row('dps', { dmgDealt: 100, attacks: 4 }),
    row('controller', { controlSpells: 5 }),
  ]);

  assert.equal(healerScores.find(result => result.id === 'dps').score, 100);
  assert.equal(healerScores.find(result => result.id === 'healer').score, 100);
  assert.equal(controlScores.find(result => result.id === 'dps').score, 100);
  assert.equal(controlScores.find(result => result.id === 'controller').score, 100);
});

test('le second axe ne vaut plus que 20 pour cent et le troisième 5 pour cent', () => {
  const [hybrid] = scoreMvpSession([
    row('hybrid', {
      dmgDealt: 100, attacks: 4, heal: 36, supportSpells: 2,
      attacksTaken: 4, attacksAvoided: 3, dmgTaken: 92,
    }),
  ]);

  assert.equal(hybrid.details.entries[0].points, 100);
  assert.equal(hybrid.details.entries[1].points, 20);
  assert.equal(hybrid.details.entries[2].points, 5);
  assert.equal(hybrid.score, 125);
});

test('les KO subis et les échecs critiques ne retirent plus de points au tank', () => {
  const base = scoreMvpSession([row('tank', { attacksTaken: 5, attacksAvoided: 2, dmgTaken: 60 })])[0];
  const unlucky = scoreMvpSession([row('tank', {
    attacksTaken: 5, attacksAvoided: 2, dmgTaken: 60, kosTaken: 3, fumbles: 5,
  })])[0];

  assert.equal(unlucky.score, base.score);
  assert.equal(unlucky.details.lost, 0);
});

test('une zone offensive ne devient pas du soutien via le compteur tactique historique', () => {
  const profile = buildMvpRawProfile(row('mage', {
    dmgDealt: 50,
    attacks: 3,
    tacticalSpells: 4,
    supportSpells: 0,
    afflictionSpells: 0,
    controlSpells: 0,
  }));

  assert.equal(profile.axes.support.raw, 0);
});

test('la campagne compare les médianes et non les volumes cumulés', () => {
  const campaign = scoreMvpCampaign([
    { date: 's1', rows: [row('regular', { dmgDealt: 40, attacks: 3 }), row('veteran', { dmgDealt: 40, attacks: 3 })] },
    { date: 's2', rows: [row('regular', { dmgDealt: 40, attacks: 3 }), row('veteran', { dmgDealt: 40, attacks: 3 })] },
    { date: 's3', rows: [row('veteran', { dmgDealt: 40, attacks: 3 })] },
    { date: 's4', rows: [row('veteran', { dmgDealt: 40, attacks: 3 })] },
  ]);

  assert.equal(campaign.find(result => result.id === 'regular').score, 40);
  assert.equal(campaign.find(result => result.id === 'veteran').score, 40);
});

test('un personnage vu sur une seule séance reste provisoire en vue campagne', () => {
  const campaign = scoreMvpCampaign([
    { date: 's1', rows: [row('regular', { heal: 30, supportSpells: 2 }), row('new', { dmgDealt: 100, attacks: 4 })] },
    { date: 's2', rows: [row('regular', { heal: 25, supportSpells: 2 })] },
  ]);

  assert.equal(campaign.find(result => result.id === 'regular').eligible, true);
  assert.equal(campaign.find(result => result.id === 'new').eligible, false);
  assert.equal(campaign[0].id, 'regular');
});

test('masquer des personnages ne modifie pas les scores MVP de la mission', () => {
  const sessionRows = [
    { date: 's1', rows: [
      row('kadoc', { dmgDealt: 100, attacks: 4 }),
      row('vik', { heal: 100, supportSpells: 2 }),
      row('liselotte', { dmgDealt: 80, attacks: 4, heal: 50, supportSpells: 1 }),
    ] },
    { date: 's2', rows: [
      row('kadoc', { dmgDealt: 100, attacks: 4 }),
      row('vik', { heal: 100, supportSpells: 2 }),
      row('liselotte', { dmgDealt: 80, attacks: 4, heal: 50, supportSpells: 1 }),
    ] },
  ];
  const allScores = scoreMvpView({ sessionRows });
  const filteredScores = scoreMvpView({
    sessionRows,
    visibleIds: new Set(['vik', 'liselotte']),
  });
  const scoreOf = (scores, id) => scores.find(result => result.id === id)?.score;

  assert.equal(scoreOf(filteredScores, 'vik'), scoreOf(allScores, 'vik'));
  assert.equal(scoreOf(filteredScores, 'liselotte'), scoreOf(allScores, 'liselotte'));
  assert.equal(filteredScores.some(result => result.id === 'kadoc'), false);

  // Même un recalcul séparé avec une autre composition produit désormais le
  // même score : aucun personnage ne sert plus de référence aux autres.
  const otherTeamComposition = scoreMvpCampaign(sessionRows.map(session => ({
    ...session,
    rows: session.rows.filter(character => character.id !== 'kadoc'),
  })));
  assert.equal(scoreOf(otherTeamComposition, 'liselotte'), scoreOf(allScores, 'liselotte'));
});

test('un personnage garde son score face à des coéquipiers beaucoup plus performants', () => {
  const liselotte = row('liselotte', { dmgDealt: 80, attacks: 4, heal: 30, supportSpells: 1 }, 4);
  const alone = scoreMvpSession([liselotte]).find(result => result.id === 'liselotte');
  const withExtremes = scoreMvpSession([
    row('skweak', { dmgDealt: 5000, attacks: 30 }),
    row('ecaildor', { heal: 3000, supportSpells: 20, controlSpells: 20 }),
    liselotte,
  ]).find(result => result.id === 'liselotte');

  assert.equal(withExtremes.score, alone.score);
  assert.deepEqual(
    withExtremes.details.entries.map(entry => entry.normalized),
    alone.details.entries.map(entry => entry.normalized),
  );
});
