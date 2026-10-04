import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  statsJournalPrefix, statsJournalKey, serializeStatsJournal, parseStatsJournal, statsJournalReplayDelay,
} from '../assets/js/shared/stats-journal.js';
import { createStatsPending, addStatsIncrement, addStatsMax } from '../assets/js/shared/stats-pending.js';

const MAX_WAIT = 5 * 60_000;

test('une clé par utilisateur et par instance de page, sous un préfixe commun', () => {
  assert.equal(statsJournalKey('u1', 'tabA'), 'stats-pending:u1:tabA');
  assert.ok(statsJournalKey('u1', 'tabB').startsWith(statsJournalPrefix('u1')));
  assert.ok(!statsJournalKey('u2', 'tabA').startsWith(statsJournalPrefix('u1')));
});

test('le journal survit à un aller-retour JSON sans perdre compteurs ni records', () => {
  const pending = createStatsPending();
  addStatsIncrement(pending, { chars: { c1: { name: 'Aria', skills: { Athlétisme: { rolls: 2 } } } } });
  addStatsMax(pending, { chars: { c1: { combat: { biggestHit: 12 } } } });
  const stored = JSON.parse(JSON.stringify(serializeStatsJournal({
    path: 'adventures/a1/stats/main', pending, tabId: 'tabA', at: 1000,
  })));
  assert.deepEqual(parseStatsJournal(stored), {
    path: 'adventures/a1/stats/main', pending, tab: 'tabA', at: 1000,
  });
});

test('un journal illisible ou incomplet est ignoré', () => {
  const ok = serializeStatsJournal({ path: 'p', pending: createStatsPending(), tabId: 't', at: 5 });
  assert.equal(parseStatsJournal(null), null);
  assert.equal(parseStatsJournal('texte'), null);
  assert.equal(parseStatsJournal({ ...ok, v: 99 }), null);
  assert.equal(parseStatsJournal({ ...ok, path: '' }), null);
  assert.equal(parseStatsJournal({ ...ok, at: 0 }), null);
  assert.equal(parseStatsJournal({ ...ok, pending: { inc: {} } }), null);
  assert.equal(parseStatsJournal({ ...ok, pending: [] }), null);
});

test('seul le journal d\'un AUTRE onglet, plus vieux que deux fenêtres, est rejoué', () => {
  const journal = { path: 'p', pending: createStatsPending(), tab: 'mort', at: 10_000 };
  assert.equal(statsJournalReplayDelay(null, { tabId: 'moi', now: 0, maxWaitMs: MAX_WAIT }), null);
  assert.equal(statsJournalReplayDelay({ ...journal, tab: 'moi' }, { tabId: 'moi', now: 1e12, maxWaitMs: MAX_WAIT }), null);
  // Récent : peut-être un onglet vivant → revu à l'échéance.
  assert.equal(statsJournalReplayDelay(journal, { tabId: 'moi', now: 10_000 + MAX_WAIT, maxWaitMs: MAX_WAIT }), MAX_WAIT);
  // Au-delà de deux fenêtres : son propriétaire aurait forcément écrit.
  assert.equal(statsJournalReplayDelay(journal, { tabId: 'moi', now: 10_000 + 2 * MAX_WAIT + 1, maxWaitMs: MAX_WAIT }), 0);
});

test('stats.js efface sa copie locale avant d\'écrire et vide le tampon aux bornes d\'un live', () => {
  const src = readFileSync(new URL('../assets/js/shared/stats.js', import.meta.url), 'utf8');
  assert.match(src, /const _FLUSH_DELAY_MS = 90_000;/);
  assert.match(src, /const _FLUSH_MAX_WAIT_MS = 5 \* 60_000;/);
  const flush = src.slice(src.indexOf('export function flushStats()')).split('\n}\n')[0];
  assert.ok(flush.indexOf('lsJson.remove(journalKey)') > 0, 'flushStats retire la copie locale');
  assert.ok(flush.indexOf('lsJson.remove(journalKey)') < flush.indexOf('setDoc('), 'copie retirée AVANT le setDoc');
  const queue = src.slice(src.indexOf('function _queueStats(')).split('\n}\n')[0];
  assert.match(queue, /lsJson\.set\(_journalKey, serializeStatsJournal\(/);
  assert.match(queue, /_replayOrphanJournals\(\)/);
  const session = src.slice(src.indexOf('export function setActiveStatsSession(')).split('\n}\n')[0];
  assert.match(session, /_pending\) void flushStats\(\)/);
});
