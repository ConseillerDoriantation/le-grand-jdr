import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const pages = readFileSync(new URL('../assets/js/features/pages.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../assets/css/admin.css', import.meta.url), 'utf8');

test('la Console MJ affiche le portrait réellement choisi par chaque compte', () => {
  assert.match(pages, /u\.avatarIcon \|\| memberProfile\.avatarIcon/);
  assert.match(pages, /avatar:\s*avatarRaw \? resolveAvatarUrl\(avatarRaw\) : ''/);
  assert.match(pages, /class="cmj-av"[\s\S]*\$\{avatar\}/);
  assert.match(css, /\.cmj-av img\s*\{[^}]*object-fit:\s*cover/s);
});

test('le profil dénormalisé sert de repli sans nouvelle lecture Firestore', () => {
  assert.match(pages, /const memberProfileRaw = profiles\[uid\]/);
  assert.doesNotMatch(pages, /loadCollection\(['"]users['"]\)/);
});
