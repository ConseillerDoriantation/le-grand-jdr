import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const firestore = readFileSync(new URL('../assets/js/data/firestore.js', import.meta.url), 'utf8');
const presence = readFileSync(new URL('../assets/js/features/vtt/vtt-presence.js', import.meta.url), 'utf8');
const chat = readFileSync(new URL('../assets/js/features/chat.js', import.meta.url), 'utf8');
const vtt = readFileSync(new URL('../assets/js/features/vtt/vtt.js', import.meta.url), 'utf8');
const ruler = readFileSync(new URL('../assets/js/features/vtt/vtt-ruler.js', import.meta.url), 'utf8');
const rules = readFileSync(new URL('../docs/firestore-rules.md', import.meta.url), 'utf8');

test('la présence est partagée sans second heartbeat VTT', () => {
  assert.match(firestore, /_LAZY_SESSION_COLLECTIONS = new Set\(\[[\s\S]*?'presence'/);
  assert.match(presence, /subscribeCollection\('presence'/);
  assert.match(chat, /subscribeCollection\('presence'/);
  assert.doesNotMatch(presence, /setInterval\(_presWrite|_pingRef\(_presUid\)/);
  assert.doesNotMatch(vtt, /d\.data\(\)\.pres/);
  assert.match(rules, /match \/presence\/\{uid\}[\s\S]*?allow create, update:[\s\S]*?allow delete:[\s\S]*?isAdvAdmin\(adventureId\)/);
});

test('les interactions continues limitent les écritures tout en forçant leur état final', () => {
  assert.match(vtt, /const KEYBOARD_REMOTE_SYNC_MS = 600/);
  assert.match(ruler, /const MJ_RULER_THROTTLE = 600/);
  assert.match(ruler, /export function _endRuler\(\) \{[\s\S]*?_flushMjRulerBroadcast\(\)/);
});

test('un quota épuisé produit un message explicite et non une avalanche de notifications', () => {
  assert.match(firestore, /code === 'resource-exhausted'/);
  assert.match(firestore, /now - _lastQuotaNoticeAt > 60_000/);
});
