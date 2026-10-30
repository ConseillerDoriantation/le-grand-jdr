import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const readCss = (name) => readFile(new URL(`../assets/css/${name}`, import.meta.url), 'utf8');
const readJs = (name) => readFile(new URL(`../assets/js/features/${name}`, import.meta.url), 'utf8');

test('le filtre des contributeurs masque réellement les personnages exclus', async () => {
  const css = await readCss('features.css');
  assert.match(css, /\.achm-contrib\[hidden\]\s*\{[^}]*display\s*:\s*none\s*!important/i);
});

test('le filtre des membres de groupe masque réellement les personnages exclus', async () => {
  const css = await readCss('histoire.css');
  assert.match(css, /\.mv-picker-member\[hidden\]\s*\{[^}]*display\s*:\s*none\s*!important/i);
});

test('la recherche de personnages de mission conserve son nœud et son curseur', async () => {
  const story = await readJs('story.js');
  assert.match(story, /class="mv-picker-search"[\s\S]*dir="ltr"[\s\S]*data-modal-initial-focus/);
  assert.doesNotMatch(story, /class="mv-picker-search"[^>]*data-input=/);
  assert.match(story, /searchInput\?\.addEventListener\('input',[\s\S]*_stGroupMemberFilter/);
  assert.match(story, /input\.setSelectionRange\(selectionStart, selectionEnd\)/);
});
