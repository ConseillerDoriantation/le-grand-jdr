import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const readSource = url => readFileSync(url, 'utf8').replace(/\r\n/g, '\n');
import {
  MJ_RULER_LINGER_MS, MJ_RULER_IDLE_MS, MJ_RULER_MAX_AGE_MS,
  mjRulerPage, mjRulerFinalPayload, mjRulerRemainingMs,
} from '../assets/js/features/vtt/vtt-ruler-sync.js';

const live = { page: 'p1', pageId: 'p1', x1: 0, y1: 0, x2: 70, y2: 0, cells: 1, seq: 4, at: 1000 };

test('la scène se lit sur `page`, ou `pageId` pour les diffusions d\'avant', () => {
  assert.equal(mjRulerPage(live), 'p1');
  assert.equal(mjRulerPage({ pageId: 'p9' }), 'p9');
  assert.equal(mjRulerPage(null), null);
});

test('la diffusion finale garde sa scène mais la masque aux clients d\'avant ce protocole', () => {
  const final = mjRulerFinalPayload(live, 2000);
  assert.deepEqual(final, { ...live, page: 'p1', pageId: null, final: true, at: 2000 });
  assert.equal(mjRulerPage({ pageId: 'p1' }), 'p1');
  assert.equal(mjRulerFinalPayload({ pageId: 'p3', x1: 0 }, 5).page, 'p3');
});

test('une règle figée reste 5 s après réception locale, une mesure en cours au plus 60 s sans nouvelle', () => {
  const opts = { receivedAt: 1000, activePageId: 'p1' };
  const final = mjRulerFinalPayload(live, 1000);
  assert.equal(mjRulerRemainingMs(final, { ...opts, now: 1000 }), MJ_RULER_LINGER_MS);
  assert.equal(mjRulerRemainingMs(final, { ...opts, now: 1000 + MJ_RULER_LINGER_MS }), 0);
  assert.equal(mjRulerRemainingMs(live, { ...opts, now: 1000 }), MJ_RULER_IDLE_MS);
});

test('rien n\'est affiché hors scène, avant réception, ou pour une vieille diffusion servie par le cache', () => {
  assert.equal(mjRulerRemainingMs(live, { receivedAt: 1000, now: 1000, activePageId: 'p2' }), 0);
  assert.equal(mjRulerRemainingMs(live, { receivedAt: -Infinity, now: 1000, activePageId: 'p1' }), 0);
  assert.equal(mjRulerRemainingMs(null, { receivedAt: 1000, now: 1000, activePageId: 'p1' }), 0);
  const old = { ...live, at: 1000 };
  assert.equal(mjRulerRemainingMs(old, { receivedAt: 1000 + MJ_RULER_MAX_AGE_MS + 1, now: 1000 + MJ_RULER_MAX_AGE_MS + 1, activePageId: 'p1' }), 0);
  // Diffusion d'un MJ resté sur l'ancien code : pas de `at`, affichée jusqu'à son effacement.
  assert.equal(mjRulerRemainingMs({ pageId: 'p1', x1: 0 }, { receivedAt: 1, now: 1, activePageId: 'p1' }), MJ_RULER_IDLE_MS);
});

test('vtt-ruler n\'écrit ni départ « longueur 0 » ni effacement à l\'expiration', () => {
  const ruler = readSource(new URL('../assets/js/features/vtt/vtt-ruler.js', import.meta.url));
  const start = ruler.slice(ruler.indexOf('export function _startRuler(')).split('\n}\n')[0];
  assert.match(start, /_clearRuler\(\{ broadcast: false \}\)/);
  assert.match(start, /if \(_mjRulerBroadcasting\) _broadcastMjRuler\(/);
  assert.match(ruler, /_rulerHideTimer = setTimeout\(_expireRuler, MJ_RULER_LINGER_MS\)/);
  const expire = ruler.slice(ruler.indexOf('function _expireRuler(')).split('\n}\n')[0];
  assert.match(expire, /_clearRuler\(\{ broadcast: false \}\)/);
  const vtt = readSource(new URL('../assets/js/features/vtt/vtt.js', import.meta.url));
  assert.match(vtt, /_renderMjRulerRemote\(VS\.session\.mjRuler, \{ fromSession: true, confirmed: !snap\.metadata\.fromCache \}\)/);
  // Amorçage sur confirmation serveur, réarmé à chaque (ré)abonnement du joueur.
  const remote = ruler.slice(ruler.indexOf('export function _renderMjRulerRemote(')).split('\n}\n')[0];
  assert.match(remote, /if \(fromSession && confirmed\) _mjRulerRemotePrimed = true;/);
  assert.match(vtt, /if \(!STATE\.isAdmin\) _rearmMjRulerRemote\(\);\n\s*return onSnapshot\(_sesRef\(\), STATE\.isAdmin \? \{\} : \{ includeMetadataChanges: true \}/);
});
