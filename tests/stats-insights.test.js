import test from 'node:test';
import assert from 'node:assert/strict';
import { statsBalance, statsInsights, statsRecords, statsSessionTotal, statsSpotlight, suggestStatsSessionLink, withIds } from '../assets/js/shared/stats-insights.js';

const row = (id, combat = {}, extra = {}) => ({ id, name: id, combat, sRolls: extra.sRolls || 0, sCrits: extra.sCrits || 0, actionAverages: extra.actionAverages || {} });

test('les calculs v2 travaillent uniquement sur les lignes déjà chargées', () => {
  const sessions = [
    { key: 's1', rows: [row('a', { dmgDealt: 20, dmgTaken: 10, kosDealt: 1, biggestHit: 12 }, { sRolls: 2 })] },
    { key: 's2', rows: [row('a', { dmgDealt: 30, dmgTaken: 15, heal: 8 }, { sRolls: 3 }), row('b', { dmgDealt: 10, kosTaken: 1 })] },
  ];
  assert.equal(statsSessionTotal(sessions[1].rows).dmg, 40);
  assert.equal(statsBalance(sessions[1], sessions).ratio, 40 / 15);
  assert.equal(statsRecords(sessions).find(item => item.id === 'big-hit').value, 12);
  assert.equal(statsSpotlight(sessions[1].rows)[0].id, 'a');
  assert.equal(withIds(sessions, new Set(['b']))[0].key, 's2');
  assert.ok(Array.isArray(statsInsights(sessions)));
});

test('la suggestion de lien privilégie le groupe des participants puis sa dernière mission', () => {
  const current = { key: 's3', rows: [row('a'), row('b')] };
  const groups = [{ id: 'g1', participants: [{ charId: 'a' }, { charId: 'b' }] }, { id: 'g2', participants: [{ charId: 'c' }] }];
  const suggestion = suggestStatsSessionLink(current, groups, [{ key: 's1', groupId: 'g1', missionId: 'm1' }, { key: 's2', groupId: 'g1', missionId: 'm2' }, current]);
  assert.deepEqual(suggestion, { groupId: 'g1', missionId: 'm2' });
});
