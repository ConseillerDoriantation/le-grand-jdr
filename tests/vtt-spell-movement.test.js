import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const spells = readFileSync(new URL('../assets/js/features/characters/spells.js', import.meta.url), 'utf8');
const vtt = readFileSync(new URL('../assets/js/features/vtt/vtt.js', import.meta.url), 'utf8');

test('la forge configure le jet de sauvegarde des déplacements imposés', () => {
  assert.match(spells, /id="s-depl-save-stat"/);
  assert.match(spells, /id="s-depl-save-dc"/);
  assert.match(spells, /_deplSaveStatEdit = s\?\.deplacement\?\.saveStat \|\| 'dexterite'/);
  assert.match(spells, /_deplSaveDCEdit = Math\.max\(1, parseInt\(s\?\.deplacement\?\.saveDC, 10\) \|\| 11\)/);
  assert.match(spells, /return \{ mode, saveStat, saveDC \}/);
});

test('les anciens sorts de déplacement utilisent Dextérité DD 11 par défaut', () => {
  assert.match(vtt, /saveStat: s\.deplacement\?\.saveStat \|\| 'dexterite'/);
  assert.match(vtt, /parseInt\(s\.deplacement\?\.saveDC, 10\) \|\| 11/);
  assert.match(vtt, /_vttRollMovementSave\(tgt, opt, d\)/);
  assert.match(vtt, /passed: d20 === 20 \|\| \(d20 !== 1 && total >= saveDC\)/);
});

test('les déplacements publient le lancement, le résultat et restent annulables', () => {
  assert.match(vtt, /const undo = _captureUndoSnapshot\(srcId, \[tgtId\], \{[\s\S]*positionIds: \[tgtId\], cooldownIds: \[srcId\]/);
  assert.match(vtt, /_vttPublishMovementCast\(src, \[tgtId\], opt, undo/);
  assert.match(vtt, /_vttPublishMovementSave\(tgt, opt, save/);
  assert.match(vtt, /const moved = save\.passed \? 0 : await _vttApplyDeplacement/);
  assert.match(vtt, /positions\.has\(id\) \? \{[\s\S]*col: t\.col[\s\S]*row: t\.row/);
  assert.match(vtt, /patch\.col = st\.col[\s\S]*patch\.row = st\.row/);
});

test('le déplacement personnel lance un d20 et annonce réussite ou échec critique', () => {
  assert.match(vtt, /async function _vttRollSelfMovement/);
  assert.match(vtt, /fumble: d20 === 1/);
  assert.match(vtt, /Échec critique \(d20 = 1\) — déplacement personnel raté/);
  assert.match(vtt, /déplacement réussi de \$\{dist\}/);
  assert.match(vtt, /Échec critique \(d20 = 1\) — échange de place raté/);
});
