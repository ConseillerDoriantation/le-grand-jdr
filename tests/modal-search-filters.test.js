import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const readCss = (name) => readFile(new URL(`../assets/css/${name}`, import.meta.url), 'utf8');

test('le filtre des contributeurs masque réellement les personnages exclus', async () => {
  const css = await readCss('features.css');
  assert.match(css, /\.achm-contrib\[hidden\]\s*\{[^}]*display\s*:\s*none\s*!important/i);
});

test('le filtre des membres de groupe masque réellement les personnages exclus', async () => {
  const css = await readCss('histoire.css');
  assert.match(css, /\.mv-picker-member\[hidden\]\s*\{[^}]*display\s*:\s*none\s*!important/i);
});
