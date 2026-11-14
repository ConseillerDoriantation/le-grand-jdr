import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const chat = readFileSync(new URL('../assets/js/features/vtt/vtt-chat.js', import.meta.url), 'utf8');

test('les actions qui échouent seulement sur échec critique montrent leur d20 naturel', () => {
  assert.match(chat, /const _naturalD20 = value =>/);
  assert.match(chat, /d20 naturel <strong>/);
  assert.match(chat, /const natural = _naturalD20\(m\.castD20\)/);
  assert.match(chat, /const natural = _naturalD20\(m\.hitD20\)/);
});

test('le résultat naturel des sorts utilitaires est séparé de leur description', () => {
  assert.match(chat, /castEffect \|\| 'Sort activé'\)\.replace/);
  assert.match(chat, /badges: _simulatedBadge\(m\) \+ pmBadge \+ rollBadge/);
  assert.match(chat, /\$\{natural\}[\s\S]*vtt-log-text/);
});
