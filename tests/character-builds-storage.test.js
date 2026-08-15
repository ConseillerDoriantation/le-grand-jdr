import test from 'node:test';
import assert from 'node:assert/strict';

import { compactActiveBuildForStorage } from '../assets/js/shared/character-build-storage.js';

const photoA = 'data:image/jpeg;base64,' + 'a'.repeat(40_000);
const photoB = 'data:image/jpeg;base64,' + 'b'.repeat(30_000);

function characterWithBuilds() {
  return {
    id: 'char-1',
    photo: photoA,
    photoZoom: 1.2,
    photoX: 3,
    photoY: -2,
    equipement: {},
    statsBonus: {},
    stats: {},
    statsBase: {},
    statsLevelUps: {},
    pvBase: 10,
    pmBase: 10,
    activeBuildId: 'a',
    builds: [
      {
        id: 'a', name: 'A', photo: photoA, photoZoom: 1.2, photoX: 3, photoY: -2,
        equipement: { main: { nom: 'Arc' } }, statsBonus: { dexterite: 2 },
        stats: { dexterite: 16 }, statsBase: { dexterite: 14 }, statsLevelUps: {}, pvBase: 10, pmBase: 10,
      },
      {
        id: 'b', name: 'B', photo: photoB, photoZoom: 1, photoX: 0, photoY: 0,
        equipement: { main: { nom: 'Épée' } }, statsBonus: { force: 1 },
        stats: { force: 15 }, statsBase: { force: 14 }, statsLevelUps: {}, pvBase: 12, pmBase: 8,
      },
    ],
  };
}

test('le build actif ne duplique pas sa photo dans le document personnage', () => {
  const c = characterWithBuilds();
  const stored = compactActiveBuildForStorage(c.builds, c.activeBuildId);

  assert.equal(stored[0].photo, undefined);
  assert.equal(stored[0].photoZoom, undefined);
  assert.equal(stored[0].photoX, undefined);
  assert.equal(stored[0].photoY, undefined);
  assert.equal(stored[0].equipement, undefined);
  assert.equal(stored[0].statsBonus, undefined);
  assert.equal(stored[0].stats, undefined);
  assert.equal(stored[0].pvBase, undefined);
  assert.equal(stored[1].photo, photoB);
  assert.ok(JSON.stringify(stored).length < JSON.stringify(c.builds).length - 39_000);
});

test('les builds inactifs restent intacts et les données sources ne sont pas mutées', () => {
  const c = characterWithBuilds();
  const before = structuredClone(c.builds);
  const stored = compactActiveBuildForStorage(c.builds, 'a');

  assert.deepEqual(c.builds, before);
  assert.deepEqual(stored[1], before[1]);
});

test('changer le build actif compacte uniquement la nouvelle projection active', () => {
  const c = characterWithBuilds();
  const stored = compactActiveBuildForStorage(c.builds, 'b');
  assert.equal(stored.find(build => build.id === 'a').photo, photoA);
  assert.equal(stored.find(build => build.id === 'b').photo, undefined);
});
