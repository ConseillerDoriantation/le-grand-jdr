import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  createStatsPending,
  isStatsPendingEmpty,
  addStatsIncrement,
  addStatsMax,
  buildStatsPatch,
} from '../assets/js/shared/stats-pending.js';

const inc = n => ({ inc: n });

test('une rafale d’actions produit un seul patch aux compteurs sommés', () => {
  const p = createStatsPending();
  assert.equal(isStatsPendingEmpty(p), true);
  assert.equal(buildStatsPatch(p, inc), null);

  addStatsIncrement(p, { chars: { c1: { name: 'Aria', skills: { 'Athlétisme': { rolls: 1, crits: 0 } } } } });
  addStatsIncrement(p, { chars: { c1: { name: 'Aria', skills: { 'Athlétisme': { rolls: 1, crits: 1 } } } } });
  addStatsIncrement(p, { chars: { c1: { emotes: { 'gg': 1 } }, c2: { name: 'Bor', combat: { heal: 4 } } } });

  assert.deepEqual(buildStatsPatch(p, inc), { chars: {
    c1: { name: 'Aria', skills: { 'Athlétisme': { rolls: inc(2), crits: inc(1) } }, emotes: { gg: inc(1) } },
    c2: { name: 'Bor', combat: { heal: inc(4) } },
  } });
});

test('une annulation MJ dans la même fenêtre neutralise le delta', () => {
  const p = createStatsPending();
  const delta = { chars: { c1: { name: 'Aria', combat: { attacks: 1, dmgDealt: 7 }, bySession: { s1: { combat: { attacks: 1 } } } } } };
  addStatsIncrement(p, delta, 1);
  addStatsIncrement(p, delta, -1);
  assert.deepEqual(buildStatsPatch(p, inc), { chars: {
    c1: { name: 'Aria', combat: { attacks: inc(0), dmgDealt: inc(0) }, bySession: { s1: { combat: { attacks: inc(0) } } } },
  } });
});

test('les records gardent le maximum et cohabitent avec les compteurs', () => {
  const p = createStatsPending();
  addStatsIncrement(p, { chars: { c1: { name: 'Aria', combat: { dmgTaken: 5 } } } });
  addStatsMax(p, { chars: { c1: { name: 'Aria', combat: { biggestTaken: 5 } } } });
  addStatsMax(p, { chars: { c1: { name: 'Aria', combat: { biggestTaken: 3 } } } });
  addStatsMax(p, { chars: { c1: { combat: { biggestHit: 9 } } } });
  assert.deepEqual(buildStatsPatch(p, inc), { chars: {
    c1: { name: 'Aria', combat: { dmgTaken: inc(5), biggestTaken: 5, biggestHit: 9 } },
  } });
});

test('stats.js met en tampon les bumps et vide le tampon avant lecture ou mutation MJ', () => {
  const src = readFileSync(new URL('../assets/js/shared/stats.js', import.meta.url), 'utf8');
  for (const fn of ['applyStatsDelta', 'bumpHeal', 'bumpDamageTaken', 'bumpEmote', 'bumpSkill']) {
    const body = src.slice(src.indexOf(`export function ${fn}(`)).split('\n}\n')[0];
    assert.match(body, /_queueStats\(/, `${fn} doit passer par le tampon`);
    assert.doesNotMatch(body, /bumpStats\(/, `${fn} ne doit plus écrire directement`);
  }
  for (const fn of ['loadStats', 'resetStats', 'deleteCharStats', 'deleteCharDateStats', 'deleteDatesStats', 'correctDateCombatStats', 'deleteMissionStats']) {
    assert.match(src, new RegExp(`export async function ${fn}\\([^)]*\\) \\{\\n  void flushStats\\(\\);`), `${fn} doit vider le tampon d'abord`);
  }
  assert.match(src, /addEventListener\('pagehide', flushNow\)/);
  assert.match(src, /document\.hidden\) flushNow\(\)/);
});
