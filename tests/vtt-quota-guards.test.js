import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const firestore = readFileSync(new URL('../assets/js/data/firestore.js', import.meta.url), 'utf8');
const sharedPresence = readFileSync(new URL('../assets/js/shared/presence.js', import.meta.url), 'utf8');
const layout = readFileSync(new URL('../assets/js/core/layout.js', import.meta.url), 'utf8');
const presence = readFileSync(new URL('../assets/js/features/vtt/vtt-presence.js', import.meta.url), 'utf8');
const chat = readFileSync(new URL('../assets/js/features/chat.js', import.meta.url), 'utf8');
const pages = readFileSync(new URL('../assets/js/features/pages.js', import.meta.url), 'utf8');
const vtt = readFileSync(new URL('../assets/js/features/vtt/vtt.js', import.meta.url), 'utf8');
const tray = readFileSync(new URL('../assets/js/features/vtt/vtt-tray.js', import.meta.url), 'utf8');
const vttChat = readFileSync(new URL('../assets/js/features/vtt/vtt-chat.js', import.meta.url), 'utf8');
const adventure = readFileSync(new URL('../assets/js/core/adventure.js', import.meta.url), 'utf8');
const navigation = readFileSync(new URL('../assets/js/core/navigation.js', import.meta.url), 'utf8');
const ruler = readFileSync(new URL('../assets/js/features/vtt/vtt-ruler.js', import.meta.url), 'utf8');
const rules = readFileSync(new URL('../docs/firestore-rules.md', import.meta.url), 'utf8');

test('la présence est limitée au VTT et ses lecteurs ne restent pas actifs globalement', () => {
  const lazyCollections = firestore.match(/_LAZY_SESSION_COLLECTIONS = new Set\(\[([\s\S]*?)\]\);/)?.[1] || '';
  assert.doesNotMatch(lazyCollections, /['"]presence['"]/);
  assert.match(sharedPresence, /STATE\.currentPage !== 'vtt'/);
  assert.match(sharedPresence, /app:page-changed/);
  assert.doesNotMatch(layout, /subscribeCollection\('presence'/);
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

test('le journal historique des stats est compacté une seule fois et seulement par le MJ', () => {
  assert.match(pages, /if \(!STATE\.isAdmin\) return \{ rollups: rollup\.scopes/);
  assert.match(pages, /if \(!STATE\.isAdmin\) return \{ rollups: null, logs: \[\], loaded: false \}/);
  assert.match(pages, /_statsClaimRollupLease\(\)/);
  assert.match(firestore, /export async function claimDocumentLease/);
});

test('entrer dans une aventure ne précharge plus les collections éditoriales lourdes', () => {
  const eagerCollections = firestore.match(/_SESSION_COLLECTIONS = \[([\s\S]*?)\];/)?.[1] || '';
  const eagerDocs = firestore.match(/_SESSION_DOCS = \[([\s\S]*?)\];/)?.[1] || '';
  assert.doesNotMatch(eagerCollections, /['"]quests['"]/);
  assert.doesNotMatch(eagerCollections, /characterPages|worldPages|bestiary/);
  assert.equal(eagerDocs.trim(), '');
  assert.doesNotMatch(adventure, /\binitCharacterPages\(\)|\binitWorldPages\(\)/);
  assert.match(navigation, /page === 'characters' \|\| page === 'players'[\s\S]*initCharacterPages\(\)/);
  assert.match(navigation, /page === 'world'[\s\S]*initWorldPages\(\)/);
});

test('le VTT ne charge le catalogue complet du bestiaire que si son onglet est ouvert', () => {
  assert.doesNotMatch(vtt, /if \(STATE\.isAdmin\) void _loadBestiaryCatalog\(\)/);
  assert.match(vtt, /data\?\.beastId && data\.pageId === VS\.activePage\?\.id/);
  assert.match(tray, /tab === 'bestiary'[\s\S]*_loadBestiaryCatalog\(\)/);
});

test('le journal MJ ne lit pas deux fois quatre-vingts messages pour en afficher quatre-vingts', () => {
  assert.match(vttChat, /_PUBLIC_LOG_LIMIT = 60/);
  assert.match(vttChat, /_GM_LOG_LIMIT = 20/);
  assert.doesNotMatch(vttChat, /_logGmCol\(\)[\s\S]{0,80}limit\(80\)/);
});
