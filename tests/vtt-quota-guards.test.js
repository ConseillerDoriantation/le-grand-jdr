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
  assert.match(ruler, /export function _endRuler\(\) \{[\s\S]*?_flushMjRulerBroadcast\(\{ final: true \}\)/);
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

test('le passage de round et le démarrage du combat ne réécrivent pas les tokens inchangés', () => {
  const turns = readFileSync(new URL('../assets/js/features/vtt/vtt-combat-turns.js', import.meta.url), 'utf8');
  // Un drapeau n'est réinitialisé que s'il était posé ; les deux boucles passent par le même helper.
  const flags = readFileSync(new URL('../assets/js/features/vtt/vtt-turn-flags.js', import.meta.url), 'utf8');
  assert.match(flags, /if \(token\.movedThisTurn\)\s+updates\.movedThisTurn = false;/);
  assert.equal((turns.match(/const updates = _turnResetPatch\(tokData, epoch\);/g) || []).length, 2);
  assert.match(turns, /if \(Object\.keys\(updates\)\.length\) ops\.push/);
  assert.match(turns, /offset \+= 400/);
  // Plus de b.update inconditionnel dans les boucles sur VS.tokens.
  assert.doesNotMatch(turns, /\n\s+b\.update\(_tokRef\(id\), updates\);/);
});

test('les boutons ±1 PV/PM n’écrivent qu’une fois par rafale de clics', () => {
  const body = vtt.slice(vtt.indexOf('function _vttAdjustVital('), vtt.indexOf('async function _vttSetPm('));
  assert.match(vtt, /const _VITAL_BURST_MS = 700/);
  assert.match(body, /setTimeout\(\(\) => \{ void _flushVitalBurst\(key\); \}, _VITAL_BURST_MS\)/);
  // Chaque clic ne fait plus d'appel direct au setter PV (écriture + stats + concentration).
  assert.doesNotMatch(body, /_vttSetHp\(tokenId, next\)/);
  assert.match(vtt, /function _cleanup\(\) \{[\s\S]{0,200}_flushVitalBursts\(\)/);
  // Une autre écriture pendant la rafale (attaque, coût, Max, autre client) n'est jamais écrasée.
  assert.match(vtt, /if \(!t \|\| _liveVital\(t, kind\) !== entry\.value\) return null;/);
  assert.match(vtt, /async function _vttSetHp\(tokenId,hp\) \{\n[^\n]*\n  _takeVitalBurst\(tokenId, 'PV'\);/);
});

test('la présence bat toutes les 180 s et tous les lecteurs partagent la même expiration', () => {
  assert.match(sharedPresence, /const HEARTBEAT_MS = 180_000;/);
  const ttl = readFileSync(new URL('../assets/js/shared/presence-ttl.js', import.meta.url), 'utf8');
  assert.match(ttl, /export const PRESENCE_TTL_MS = 300_000;/);
  const readers = {
    chat, presence, tray, pages,
    rest: readFileSync(new URL('../assets/js/features/vtt/vtt-rest.js', import.meta.url), 'utf8'),
  };
  for (const [name, src] of Object.entries(readers)) {
    assert.match(src, /PRESENCE_TTL_MS/, `${name} doit utiliser PRESENCE_TTL_MS`);
    assert.doesNotMatch(src, /lastSeen[^\n]*< ?120_?000|ms < 120000|p\.ts\) < 120_000/, `${name} : expiration codée en dur`);
  }
});

test('Ctrl+K et la page Admin ne relisent plus des catalogues entiers sans besoin', () => {
  const palette = readFileSync(new URL('../assets/js/features/command-palette.js', import.meta.url), 'utf8');
  assert.match(palette, /const shallow = await _loadEntries\(\{ deep: false \}\)/);
  assert.match(palette, /_ensureDeepEntriesForQuery\(requestedQuery\)/);
  assert.match(palette, /getCachedCollection\(col\)/);
  assert.match(pages, /loadCollectionWhere\('vttTokens', 'type', 'in', \['player', 'npc'\]\)/);
  // Les règles évaluent isAdmin() (lecture de users/{uid}) en dernier.
  assert.match(rules, /hasEmailAccess\(adv\) \|\|\s*isAdmin\(\)/);
});

test('2e passe : présence, notes, accusés de lecture et KO ennemi sans écriture superflue', () => {
  // Présence : retour au VTT après suppression → ré-annonce immédiate ; retour
  // sur l'onglet avec une présence fraîche → pas d'écriture.
  assert.match(sharedPresence, /_announced = false;[\s\S]{0,260}_lastWriteAt = 0;/);
  assert.match(sharedPresence, /if \(_announced && since < HEARTBEAT_MS\) _timer = setTimeout\(beat, HEARTBEAT_MS - since\);/);
  // Notes mini-fiche : brouillon capturé à la frappe, écrit au blur / à 1,5 s.
  const mini = readFileSync(new URL('../assets/js/features/vtt/vtt-mini-fiche.js', import.meta.url), 'utf8');
  assert.match(mini, /const _MS_NOTE_SAVE_MS = 1500;/);
  assert.match(mini, /t\.onblur = onBlur/);
  assert.match(mini, /notes\[idx\] = \{ \.\.\.notes\[idx\], titre: draft\.titre\.trim\(\) \|\| 'Sans titre', contenu: draft\.contenu \}/);
  assert.match(vtt, /void _msFlushNoteDrafts\(\);/);
  // Chat : accusé de lecture seulement s'il y a un message plus récent.
  assert.match(chat, /if \(_latestAt\(convoId\) <= \(Number\(_readsSaved\[convoId\]\) \|\| 0\)\) return;/);
  // Ennemi à 0 PV : PV + « Inconscient » dans le même updateDoc.
  assert.match(vtt, /\{ hp:newHp, \.\.\.\(downedConds \? \{ conditions: downedConds \} : \{\}\) \}/);
  assert.match(vtt, /\.\.\.\(downed \? \{ conditions: downed \} : \{\}\) \}\);/);
});

test('3e passe : un token relâché sur sa case et un nombre inchangé ne réécrivent rien', () => {
  const dragEnd = vtt.slice(vtt.indexOf("g.on('dragend', async () => {"), vtt.indexOf('const _isAttackTargetInRange'));
  // Token seul : sortie avant tout updateDoc quand la case n'a pas changé.
  const sameCell = dragEnd.indexOf('Number(moveCur.col) === c && Number(moveCur.row) === r');
  assert.ok(sameCell > 0, 'garde « même case » absente du dragend');
  assert.ok(sameCell < dragEnd.indexOf('await updateDoc(_tokRef(t.id),patch)'));
  // Groupe : les tokens immobiles sont ignorés et un groupe immobile ne commit pas.
  assert.match(dragEnd, /if \(!distance\) continue;\s+const movePatch=\{col:nc,row:nr\};/);
  assert.match(dragEnd, /if \(!moves\.length\) \{[\s\S]{0,400}_multiDragOrigin=null; return;\s+\}\s+const batch=writeBatch\(db\);/);
  // Fiche : édition inline d'un nombre sans changement de valeur.
  const inline = readFileSync(new URL('../assets/js/features/characters/inline-edit.js', import.meta.url), 'utf8');
  assert.match(inline, /if \(!c \|\| String\(val\) === cur\) \{ input\.replaceWith\(el\); return; \}/);
});

test('3e passe : les catalogues secrets du MJ ne sont relus qu’une fois par session', () => {
  const lazyCollections = firestore.match(/_LAZY_SESSION_COLLECTIONS = new Set\(\[([\s\S]*?)\]\);/)?.[1] || '';
  const eagerCollections = firestore.match(/_SESSION_COLLECTIONS = \[([\s\S]*?)\];/)?.[1] || '';
  for (const col of ['achievements_secret', 'collection_secret']) {
    assert.match(lazyCollections, new RegExp(`['"]${col}['"]`), `${col} doit être session-live (lazy)`);
    assert.doesNotMatch(eagerCollections, new RegExp(`['"]${col}['"]`), `${col} ne doit pas être amorcé à l'entrée`);
  }
});

test('3e passe : la cloche ne lit que les événements du joueur, avec repli sans index', () => {
  const qol = readFileSync(new URL('../assets/js/shared/global-qol.js', import.meta.url), 'utf8');
  const queries = readFileSync(new URL('../assets/js/data/firestore-queries.js', import.meta.url), 'utf8');
  const block = qol.slice(qol.indexOf('function _mountBastionWallNotifications'), qol.indexOf('function _isVisible'));
  assert.match(block, /subscribeRecentWhere\('bastionWallNotifications',\s*\{ field: 'targetUid', value: uid \},\s*\{ orderField: 'ts', max: 30 \}/);
  // Repli historique UNIQUEMENT dans onUnavailable (index absent / refus).
  assert.match(block, /onUnavailable: \(\) => \{\s*_wallNotificationUnsubs\.push\(subscribeRecentCollection\('bastionWallNotifications', onEvents,\s*\{ field: 'ts', max: 100, silent: true \}\)\);/);
  assert.equal((block.match(/subscribeRecentCollection\(/g) || []).length, 1);
  // Un désabonnement avant l'erreur ne doit jamais armer le repli.
  assert.match(queries, /if \(!active\) return;\s+active = false;/);
  assert.match(queries, /err\?\.code === 'failed-precondition'/);
});

test('3e passe : les modules feuilles n’importent que des exports existants (déploiement sûr)', () => {
  const exportsOf = (src) => {
    const names = new Set();
    for (const m of src.matchAll(/export\s+(?:async\s+)?(?:function\*?|const|let|class)\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1]);
    for (const m of src.matchAll(/export\s*\{([\s\S]*?)\}/g)) {
      m[1].split(',').map(s => s.trim().split(/\s+as\s+/).pop().trim()).filter(Boolean).forEach(n => names.add(n));
    }
    return names;
  };
  const read = rel => readFileSync(new URL(`../assets/js/${rel}`, import.meta.url), 'utf8');
  const leaves = { 'data/firestore-queries.js': read('data/firestore-queries.js') };
  for (const [file, src] of Object.entries(leaves)) {
    for (const m of src.matchAll(/import\s*\{([\s\S]*?)\}\s*from\s*'([^']+)'/g)) {
      const target = new URL(m[2], new URL(`../assets/js/${file}`, import.meta.url));
      const available = exportsOf(readFileSync(target, 'utf8'));
      m[1].split(',').map(s => s.trim().split(/\s+as\s+/)[0].trim()).filter(Boolean).forEach(name => {
        assert.ok(available.has(name), `${file} importe « ${name} » absent de ${m[2]}`);
      });
    }
  }
});

test('la pastille du Mur du Bastion reste à l’écoute après une navigation', () => {
  const signal = readFileSync(new URL('../assets/js/shared/bastion-signal.js', import.meta.url), 'utf8');
  const lazyDocs = firestore.match(/_LAZY_SESSION_DOCS = new Set\(\[([\s\S]*?)\]\);/)?.[1] || '';
  // watchDoc (realtime.js) est coupé par unwatchAll() à chaque navigate().
  assert.doesNotMatch(signal, /watchDoc\(|from '\.\/realtime\.js'/);
  assert.match(signal, /_unsubActivity = subscribeDoc\('bastionWall', 'meta',/);
  // Doc session-live : un seul listener partagé, libéré au changement d'aventure.
  assert.match(lazyDocs, /'bastionWall\/meta'/);
  // Bastion désactivé : aucune lecture (refusée mais facturée).
  assert.match(signal, /if \(!isFeatureEnabled\('bastion'\)\) return;\s+_unsubActivity = subscribeDoc/);
});

test('un onglet VTT masqué coupe aussi ses flux visuels, sans rejouer l\'absence au retour', () => {
  // Registre commun avec tokens/dessins : coupure après 2 min, reprise au retour.
  assert.match(vtt, /_clearSceneSubscriptions\(\);\n\s*_pauseVttStreams\(\);/);
  assert.match(vtt, /_rebindSceneSubscriptions\?\.\(\);\n\s*_resumeVttStreams\(\);/);
  assert.match(vtt, /function _initListeners\(\) \{\n  _clearVttStreams\(\);\n  VS\.unsubs\.push\(_clearVttStreams\);/);
  // Joueur : session, scènes et présence pausables ; le MJ les garde (logique de repos court, auto-synchro).
  assert.match(vtt, /onSnapshot\(_sesRef\(\)[^\n]*\n\s*\}, \{ pausable: !STATE\.isAdmin \}\);/);
  assert.match(vtt, /_watchVttStream\(\(\) => onSnapshot\(_pgsCol\(\)/);
  assert.match(vtt, /_watchVttStream\(\(\) => \{ _startPresence\(\); return _resetPresence; \}, \{ pausable: !STATE\.isAdmin \}\)/);
  // Visuels purs, pour tous : visée, pings, émotes.
  assert.match(vtt, /_watchVttStream\(\(\) => onSnapshot\(_pingsCol\(\)/);
  assert.match(vtt, /_watchVttStream\(\(\) => onSnapshot\(_reactionsCol\(\)/);
  // Visée : amorcée jusqu'à la confirmation serveur (montage comme retour) → aucun sceau rejoué.
  assert.match(vtt, /onSnapshot\(_castingCol\(\), \{ includeMetadataChanges: true \}, snap => \{\n\s*_renderRemoteCastings\(snap\.docs, !primed\);\n\s*if \(!snap\.metadata\.fromCache\) primed = true;/);
  // Jamais en pause : musique (audio en arrière-plan) et journal (aucun gain).
  assert.doesNotMatch(vtt, /_watchVttStream\(\(\) => onSnapshot\(_musicStateRef/);
  // La sidebar écoute le même doc de session : elle doit suivre, sinon la cible reste active.
  assert.match(layout, /if \(!document\.hidden \|\| !_sessionUnsub\) return;\n\s*try \{ _sessionUnsub\(\); \} catch \{\}/);
  assert.match(layout, /else if \(_sessionAdventureId && !_sessionUnsub\) \{\n\s*_startSessionWatch\(\);/);
});
