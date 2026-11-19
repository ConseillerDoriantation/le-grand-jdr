import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const readBastion = () => readFile(new URL('../assets/js/features/bastion.js', import.meta.url), 'utf8');
const readRules = () => readFile(new URL('../docs/firestore-rules.md', import.meta.url), 'utf8');

test('le transfert d or du Bastion modifie le trésor et le personnage dans une transaction unique', async () => {
  const source = await readBastion();
  const transfer = source.match(/async function _bastionDoTransfer[\s\S]*?\n\}/)?.[0] || '';
  assert.match(source, /import \{ runDocsTransaction \} from '\.\.\/data\/firestore-transactions\.js'/);
  assert.match(transfer, /runDocsTransaction\(\[/);
  assert.match(transfer, /\{ col: 'bastion', id: 'main' \}/);
  assert.match(transfer, /\{ col: 'characters', id: char\.id \}/);
  assert.match(transfer, /data: \{ or: nextBastionGold, historique, lastGoldTransfer: transfer \}/);
  assert.match(transfer, /data: \{ compte: nextCompte, bastionGoldTransfer: transfer \}/);
  assert.doesNotMatch(transfer, /await useGold\(/);
  assert.doesNotMatch(transfer, /await _save\(/);
});

test('les doubles validations sont bloquées pendant le transfert', async () => {
  const source = await readBastion();
  assert.match(source, /transferInProgress: false/);
  assert.match(source, /if \(STORE\.transferInProgress\) return/);
  assert.match(source, /finally \{[\s\S]*STORE\.transferInProgress = false/);
});

test('les règles n autorisent un transfert joueur que si les deux documents concordent', async () => {
  const rules = await readRules();
  assert.match(rules, /function bastionGoldTransferAllowed\(adventureId, before, after\)/);
  assert.match(rules, /getAfter\(charPath\)\.data\.get\('bastionGoldTransfer'/);
  assert.match(rules, /affectedKeys\(\)\.hasOnly\(\['or', 'historique', 'lastGoldTransfer'\]\)/);
  assert.match(rules, /allow update:[\s\S]*bastionGoldTransferAllowed\(adventureId, resource\.data, request\.resource\.data\)/);
});
