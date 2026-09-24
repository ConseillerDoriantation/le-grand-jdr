import test from 'node:test';
import assert from 'node:assert/strict';

import { removeStatsSessionsFromData } from '../assets/js/shared/stats-session-data.js';

test('supprimer une séance retire son miroir et ajuste les totaux de campagne', () => {
  const removed = '2026-09-24__apresmidi';
  const kept = '2026-09-24__soir';
  const data = {
    sessions: { [removed]: { missionId: 'm1' }, [kept]: { missionId: 'm2' } },
    chars: {
      c1: {
        combat: { attacks: 5, dmgDealt: 42, biggestHit: 20 },
        spells: { Feu: 3, Soin: 1 },
        bySession: {
          [removed]: { combat: { attacks: 2, dmgDealt: 30, biggestHit: 20 }, spells: { Feu: 2 } },
          [kept]: { combat: { attacks: 3, dmgDealt: 12, biggestHit: 8 }, spells: { Feu: 1, Soin: 1 } },
        },
      },
    },
  };

  assert.equal(removeStatsSessionsFromData(data, [removed], 1234), true);
  assert.equal(data.sessions[removed], undefined);
  assert.deepEqual(data.sessions[kept], { missionId: 'm2' });
  assert.equal(data.chars.c1.bySession[removed], undefined);
  assert.ok(data.chars.c1.bySession[kept]);
  assert.equal(data.chars.c1.combat.attacks, 3);
  assert.equal(data.chars.c1.combat.dmgDealt, 12);
  assert.equal(data.chars.c1.combat.biggestHit, 8);
  assert.deepEqual(data.chars.c1.spells, { Feu: 1, Soin: 1 });
  assert.equal(data.chars.c1.vttLogCutoffs[removed], 1234);
});

test('supprimer une ancienne séance par date reste compatible', () => {
  const date = '2026-09-23';
  const data = {
    sessions: { [date]: { missionId: 'legacy' } },
    chars: {
      c1: {
        combat: { attacks: 1, biggestHit: 7, biggestTaken: 4 },
        byDate: { [date]: { combat: { attacks: 1, biggestHit: 7, biggestTaken: 4 } } },
      },
    },
  };

  assert.equal(removeStatsSessionsFromData(data, [date], 5678), true);
  assert.equal(data.chars.c1.byDate, undefined);
  assert.equal(data.chars.c1.combat.attacks, 0);
  assert.equal(data.chars.c1.combat.biggestHit, 0);
  assert.equal(data.chars.c1.combat.biggestTaken, 0);
  assert.equal(data.chars.c1.vttLogCutoffs[date], 5678);
});

test('une séance absente ne modifie pas le document', () => {
  const data = { sessions: {}, chars: {} };
  assert.equal(removeStatsSessionsFromData(data, ['absente'], 1), false);
  assert.deepEqual(data, { sessions: {}, chars: {} });
});
