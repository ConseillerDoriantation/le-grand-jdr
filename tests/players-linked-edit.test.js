import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const players = readFileSync(new URL('../assets/js/features/players.js', import.meta.url), 'utf8');

test('le propriétaire lié peut gérer la présentation de son personnage', () => {
  assert.match(players, /char\.uid === uid/);
  assert.match(players, /char\.controlDelegates\.includes\(uid\)/);
  assert.match(players, /const canManage = _canManageItem\(item\)/);
  assert.match(players, /data-pp-action="editItem"/);
});

test('un personnage sans document players ouvre directement une nouvelle présentation liée', () => {
  assert.match(players, /if \(item\.presentationId\)[\s\S]*_editPlayerPresent/);
  assert.match(players, /openPlayerPresentModal\(\{ charId: item\.charId, visible: item\.visible \}\)/);
  assert.match(players, /tryUpsert\('players', null, \{[\s\S]*charId: item\.charId/);
});

test('un propriétaire ne peut sélectionner ou enregistrer que ses personnages', () => {
  assert.match(players, /characters\.filter\(_canManageCharacter\)/);
  assert.match(players, /STATE\.isAdmin \? '' : 'disabled'/);
  assert.match(players, /Tu ne peux modifier que la présentation de ton personnage/);
});
