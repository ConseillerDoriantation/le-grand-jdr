import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../assets/js/${path}`, import.meta.url), 'utf8');

// saveDoc = setDoc(..., { merge: true }) : une clé supprimée localement (estimation
// effacée, « Effacer mes notes ») restait dans Firestore et revenait à l'écho.
test('le carnet du bestiaire remplace son doc une fois lu, et fusionne avant', () => {
  const bestiary = read('features/bestiary.js');
  assert.match(bestiary, /const write = _bstTrackerLoaded \? replaceDoc : saveDoc;\s*try \{ await write\('bestiary_tracker', uid, \{ data: STORE\.tracker \}\); \}/);
  assert.match(bestiary, /STORE\.tracker = doc\?\.data \|\| \{\};\s*_bstTrackerLoaded = true;/);
  assert.match(bestiary, /STORE\.tracker = \{\};\s*_bstTrackerLoaded = false;/);
  assert.doesNotMatch(bestiary, /tryDoc\('bestiary_tracker'/);
});

test('le VTT écrit le même carnet avec la même règle', () => {
  const vtt = read('features/vtt/vtt.js');
  assert.match(vtt, /const write = _bstTrackerLoaded \? replaceDoc : saveDoc;\s*try \{ await write\('bestiary_tracker', uid, \{ data: VS\.bstTracker \}\); \}/);
  assert.match(vtt, /VS\.bstTracker = snap\.exists\(\) \? \(snap\.data\(\)\.data \|\| \{\}\) : \{\};\s*_bstTrackerLoaded = true;/);
  assert.match(vtt, /VS\.bstTracker = \{\};\s*_bstTrackerLoaded = false;/);
});
