import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  WALL_FEED_RECENT, WALL_FEED_UNREAD_MAX, WALL_FEED_LEGACY_MAX,
  mergeWallFeeds, dashboardWallView, createDashboardWallFeed,
} from '../assets/js/shared/dashboard-wall-feed.js';

const ME = 'moi';
// Mur de 100 publications (ts 1..100), quelques-unes épinglées, lues jusqu'à 90.
function wall() {
  const docs = [];
  for (let ts = 1; ts <= 100; ts += 1) {
    docs.push({ id: `p${ts}`, kind: 'post', text: `post ${ts}`, ts, uid: ts % 7 === 0 ? ME : `u${ts % 3}`, pinned: ts === 40 || ts === 95 });
  }
  docs.push({ id: 'main', ts: 50, items: [] });           // ancien doc conteneur
  docs.push({ id: 'evt', kind: 'event', ts: 99 });         // ni publication, ni texte
  return docs;
}
const byTsDesc = docs => [...docs].sort((a, b) => b.ts - a.ts);
// Ce que livrent les flux Firestore pour un mur donné.
const feedsOf = (docs, seenAt) => mergeWallFeeds(
  docs.filter(d => d.pinned === true),
  byTsDesc(docs).slice(0, WALL_FEED_RECENT),
  byTsDesc(docs.filter(d => d.ts > seenAt)).slice(0, WALL_FEED_UNREAD_MAX),
);
const ids = view => view.shown.map(p => p.id);

test('trois flux bornés donnent le même panneau que les 80 dernières', () => {
  const docs = wall();
  const legacyItems = [{ text: 'ancien', ts: 2 }];
  for (const seenAt of [0, 30, 90, 99, 100]) {
    const before = dashboardWallView({ docs: byTsDesc(docs).slice(0, WALL_FEED_LEGACY_MAX), legacyItems, seenAt, uid: ME });
    const after = dashboardWallView({ docs: feedsOf(docs, seenAt), legacyItems, seenAt, uid: ME });
    assert.deepEqual(ids(after), ids(before), `cartes identiques (seenAt=${seenAt})`);
    if (seenAt >= 30) assert.equal(after.unread, before.unread, `non-lus identiques (seenAt=${seenAt})`);
  }
});

test('les non-lus des autres passent devant, puis l\'ordre du mur (épinglés d\'abord)', () => {
  const view = dashboardWallView({ docs: wall(), seenAt: 97, uid: ME });
  // Non lus des autres : 100 et 99 (98 est à moi, l'événement « evt » est filtré),
  // puis l'ordre du mur : épinglés 95 et 40.
  assert.deepEqual(ids(view), ['p100', 'p99', 'p95', 'p40']);
  assert.equal(view.unread, 2);
});

test('une publication épinglée ancienne n\'est plus perdue au-delà de 80', () => {
  const docs = wall().map(d => d.id === 'p40' ? { ...d, ts: 5 } : d);
  const view = dashboardWallView({ docs: feedsOf(docs, 100), seenAt: 100, uid: ME });
  assert.ok(ids(view).includes('p40'));
});

function fakeData() {
  const calls = [];
  const subscribeRecent = (col, cb, opts) => {
    const call = { kind: 'recent', col, cb, opts, active: true };
    calls.push(call);
    return () => { call.active = false; };
  };
  const subscribeWhere = (col, filter, opts, cb, { onUnavailable } = {}) => {
    const call = { kind: 'where', col, filter, opts, cb, onUnavailable, active: true };
    calls.push(call);
    return () => { call.active = false; };
  };
  return { calls, deps: { subscribeRecent, subscribeWhere } };
}

test('le flux ouvre récentes, épinglées et non-lues, fusionne et relève le seuil', () => {
  const { calls, deps } = fakeData();
  const emitted = [];
  const feed = createDashboardWallFeed(deps, docs => emitted.push(docs.map(d => d.id).sort()));
  feed.start(50);
  assert.deepEqual(calls.map(c => [c.kind, c.col, c.opts.max ?? null]), [
    ['recent', 'bastionAnnonces', WALL_FEED_RECENT],
    ['where', 'bastionAnnonces', 20],
    ['where', 'bastionAnnonces', WALL_FEED_UNREAD_MAX],
  ]);
  assert.deepEqual(calls[1].filter, { field: 'pinned', op: '==', value: true });
  assert.equal(calls[1].opts.orderField, null, 'épinglées sans tri serveur : aucun index composite');
  assert.deepEqual(calls[2].filter, { field: 'ts', op: '>', value: 50 });
  calls[0].cb([{ id: 'a' }, { id: 'b' }]);
  calls[2].cb([{ id: 'b' }, { id: 'c' }]);
  assert.deepEqual(emitted.at(-1), ['a', 'b', 'c']);
  feed.setSeenAt(40);                    // le seuil ne redescend jamais
  assert.equal(calls.length, 3);
  feed.setSeenAt(80);
  assert.equal(calls[2].active, false);
  assert.deepEqual(calls[3].filter, { field: 'ts', op: '>', value: 80 });
  feed.stop();
  assert.ok(calls.every(c => !c.active), 'tout est détaché');
  calls[0].cb([{ id: 'z' }]);
  assert.equal(emitted.at(-1).includes('z'), false, 'plus rien n\'est émis après stop');
});

test('index absent ou requête refusée : repli sur les 80 dernières, une seule fois', () => {
  const { calls, deps } = fakeData();
  const emitted = [];
  const feed = createDashboardWallFeed(deps, docs => emitted.push(docs.map(d => d.id)));
  feed.start(0);
  calls[1].onUnavailable();              // index composite des épinglées en construction
  calls[2].onUnavailable();              // second signal ignoré
  const legacy = calls.filter(c => c.kind === 'recent' && c.opts.max === WALL_FEED_LEGACY_MAX);
  assert.equal(legacy.length, 1);
  assert.equal(calls[0].active, false);
  assert.equal(calls[2].active, false);
  legacy[0].cb([{ id: 'x' }, { id: 'y' }]);
  assert.deepEqual(emitted.at(-1), ['x', 'y']);
  feed.setSeenAt(10);                    // plus de flux non-lus en mode repli
  assert.equal(calls.length, 4);
  feed.stop();
  assert.equal(legacy[0].active, false);
});

test('repli synchrone (aucune aventure) : pas de flux ciblé fantôme', () => {
  const calls = [];
  const deps = {
    subscribeRecent: (col, cb, opts) => { const c = { opts, active: true }; calls.push(c); return () => { c.active = false; }; },
    subscribeWhere: (col, f, o, cb, { onUnavailable }) => { onUnavailable(); return () => {}; },
  };
  const feed = createDashboardWallFeed(deps, () => {});
  feed.start(0);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].active, false, 'récentes détachées');
  assert.equal(calls[1].opts.max, WALL_FEED_LEGACY_MAX);
});

test('une requête ciblée qui lève (module data/ périmé) se rabat sans casser le tableau de bord', () => {
  const calls = [];
  const deps = {
    subscribeRecent: (col, cb, opts) => { const c = { opts, active: true }; calls.push(c); return () => { c.active = false; }; },
    subscribeWhere: () => { throw new Error('Invalid query'); },
  };
  const feed = createDashboardWallFeed(deps, () => {});
  assert.doesNotThrow(() => feed.start(0));
  assert.equal(calls.at(-1).opts.max, WALL_FEED_LEGACY_MAX);
  assert.equal(calls[0].active, false);
});

test('subscribeRecentWhere accepte un filtre sans tri serveur', () => {
  const src = readFileSync(new URL('../assets/js/data/firestore-queries.js', import.meta.url), 'utf8');
  assert.match(src, /\.\.\.\(orderField \? \[orderBy\(orderField, 'desc'\)\] : \[\]\)/);
});

test('le tableau de bord passe par le flux borné et ne s\'abonne plus au mur si Bastion est désactivé', () => {
  const pages = readFileSync(new URL('../assets/js/features/pages.js', import.meta.url), 'utf8');
  assert.doesNotMatch(pages, /watchRecent\('dash-bastion-wall'/);
  assert.match(pages, /if \(isFeatureEnabled\('bastion'\)\) \{\n\s*_dashWallFeed\?\.stop\(\);/);
  assert.match(pages, /document\.addEventListener\('app:page-changed', \(\) => \{\n\s*wallFeed\.stop\(\);/);
  assert.match(pages, /wallFeed\.setSeenAt\(wallSeenAt\(\)\);/);
});
