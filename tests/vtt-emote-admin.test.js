import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const modal = readFileSync(new URL('../assets/js/features/vtt/vtt-emote-admin.js', import.meta.url), 'utf8');
const bridge = readFileSync(new URL('../assets/js/features/vtt/vtt-emotes.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../assets/css/vtt.css', import.meta.url), 'utf8');

test('la gestion des émotes utilise un brouillon et une seule sauvegarde finale', () => {
  assert.match(modal, /state\.draft/);
  assert.match(modal, /finalizeEmoteDraft/);
  assert.match(modal, /const ok = await save\?\.\(final\)/);
  assert.doesNotMatch(bridge, /window\._vttSaveEmote/);
});

test('la modale reprend bibliothèque inspecteur footer et dimensions du handoff', () => {
  assert.match(modal, /vtt-ea-library/);
  assert.match(modal, /vtt-ea-inspector/);
  assert.match(modal, /vtt-ea-foot/);
  assert.match(css, /width:min\(1040px/);
  assert.match(css, /height:min\(760px/);
  assert.match(css, /grid-template-columns:minmax\(0,1fr\) 330px/);
  assert.match(css, /grid-template-columns:repeat\(6,minmax\(0,1fr\)\)/);
  assert.match(css, /\.vtt-ea-thumb\s*\{[^}]*width:72px;[^}]*height:72px;/);
});

test('sélection multiple import et fermeture protégée restent disponibles', () => {
  assert.match(modal, /event\.shiftKey/);
  assert.match(modal, /event\.ctrlKey \|\| event\.metaKey/);
  assert.match(modal, /dedupeEmoteImports/);
  assert.match(modal, /setModalCloseGuard\(guardClose\)/);
});

test('aucun aperçu de chat token ou panneau de test ne revient dans la modale', () => {
  assert.doesNotMatch(modal, /aperçu chat|token preview|panneau de test/i);
  assert.doesNotMatch(modal, /data-ea-action="head"/);
});
