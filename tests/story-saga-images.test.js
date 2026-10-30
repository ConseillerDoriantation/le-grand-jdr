import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const story = readFileSync(new URL('../assets/js/features/story.js', import.meta.url), 'utf8');

test('la Saga affiche aussi la couverture des missions à venir', () => {
  assert.match(story, /_tmKey\(m\) === 'todo' && !m\.imageUrl/);
  assert.match(story, /if \(k === 'todo' && !m\.imageUrl\)/);
  assert.match(story, /const _cover = \(m, n\) => m\.imageUrl \? `<img/);
});
