import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const autosync = readFileSync(new URL('../assets/js/features/vtt/vtt-autosync.js', import.meta.url), 'utf8');
const vtt = readFileSync(new URL('../assets/js/features/vtt/vtt.js', import.meta.url), 'utf8');

test('un token historique sans type est réparé au lieu de faire disparaître son personnage', () => {
  assert.match(autosync, /const existing = snap\.docs\[0\];/);
  assert.match(autosync, /const expectedType = entry\.characterId \? 'player' : 'npc';/);
  assert.match(autosync, /if \(data\.type !== expectedType\) patch\.type = expectedType;/);
  assert.match(autosync, /toRepair\.push\(\{ id: existing\.id, patch \}\)/);
  assert.match(autosync, /for \(const \{ id, patch \} of toRepair\) batch\.update\(_tokRef\(id\), patch\);/);
});

test('la réparation conserve le listener borné de la Distribution', () => {
  assert.match(vtt, /query\(_toksCol\(\), where\('type', 'in', \['player', 'npc'\]\)\)/);
  assert.doesNotMatch(vtt, /onSnapshot\(_toksCol\(\)/);
  assert.match(autosync, /limit\(1\)/);
});
