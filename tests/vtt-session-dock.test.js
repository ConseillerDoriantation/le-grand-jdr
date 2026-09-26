import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const vtt = readFileSync(new URL('../assets/js/features/vtt/vtt.js', import.meta.url), 'utf8');
const dock = readFileSync(new URL('../assets/js/features/vtt/vtt-session-dock.js', import.meta.url), 'utf8');
const rest = readFileSync(new URL('../assets/js/features/vtt/vtt-rest.js', import.meta.url), 'utf8');
const loot = readFileSync(new URL('../assets/js/features/vtt/vtt-loot.js', import.meta.url), 'utf8');
const music = readFileSync(new URL('../assets/js/features/vtt/vtt-music.js', import.meta.url), 'utf8');
const emotes = readFileSync(new URL('../assets/js/features/vtt/vtt-emotes.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../assets/css/vtt.css', import.meta.url), 'utf8');

test('le dock de session respecte l’ordre et les libellés du handoff', () => {
  const restAt = vtt.indexOf("key: 'rest'");
  const musicAt = vtt.indexOf("key: 'music'");
  const lootAt = vtt.indexOf("key: 'loot'");
  const emoteAt = vtt.indexOf("key: 'emote'");
  const separatorAt = vtt.indexOf('vtt-session-dock-separator');
  const diceAt = vtt.indexOf("key: 'dice'");
  assert.ok(restAt < musicAt && musicAt < lootAt && lootAt < emoteAt && emoteAt < separatorAt && separatorAt < diceAt);
  assert.match(vtt, /label: 'Repos'/);
  assert.match(vtt, /label: 'Musique'/);
  assert.match(vtt, /label: 'Butin'/);
  assert.match(vtt, /label: 'Émotes'/);
  assert.match(vtt, /label: 'Dés'[\s\S]*primary: true/);
});

test('un seul panneau de session reste ouvert et sa flèche suit le bouton', () => {
  assert.match(dock, /if \(otherKey !== key && _isOpen\(entry\)\) entry\.close\?\.\(\)/);
  assert.match(dock, /getBoundingClientRect\(\)/);
  assert.match(dock, /arrow\.style\.left/);
  assert.match(css, /\.vtt-session-pop-arrow/);
});

test('le dock conserve les dimensions, états et responsive du design', () => {
  assert.match(css, /\.vtt-session-tools \.vtt-session-dock-btn\s*\{[\s\S]*?width:\s*60px;[\s\S]*?height:\s*52px/);
  assert.match(css, /\.vtt-session-dock-btn\.primary/);
  assert.match(css, /\.vtt-music-trigger\.live \.vtt-session-eq/);
  assert.match(css, /@keyframes vttSessionEq/);
  const lowFxSelector = css.match(/\.vtt-root\[data-vtt-lowfx="1"\] :is\(([^)]*)\)/)?.[1] || '';
  assert.doesNotMatch(lowFxSelector, /vtt-session-eq/);
  assert.match(css, /@media \(max-width: 560px\)[\s\S]*?width:\s*50px/);
});

test('le repos montre l’aperçu des ressources et garde les commandes existantes', () => {
  assert.match(rest, /vtt-rest-charges/);
  assert.match(rest, /vtt-rest-meter/);
  assert.match(rest, /vtt-rest-banner vote/);
  assert.match(rest, /_vttShortRestVote/);
  assert.match(rest, /_vttShortRestForce/);
  assert.match(rest, /_vttShortRestSetMax/);
  assert.match(rest, /_vttShortRestResetCount/);
});

test('le badge de butin compte les entrées non vues et se réinitialise à l’ouverture', () => {
  assert.match(loot, /vtt:lootSeen:/);
  assert.match(loot, /visible\.filter\(key => !seen\.has\(key\)\)\.length/);
  assert.match(loot, /_refreshLootDockTrigger\(\{ markSeen: true \}\)/);
});

test('une musique active reprend après actualisation sans recréer son lecteur', () => {
  assert.match(music, /Même son déjà chargé[\s\S]*?_audioEl\.paused[\s\S]*?_audioEl\.play\(\)/);
  assert.match(music, /_AUTOPLAY_RESUME_EVENTS = \['pointerdown', 'click', 'keydown', 'touchstart'\]/);
  assert.match(music, /Promise\.all\(attempts\)\.then\(_disarmAutoplayWhenReady\)/);
  assert.match(music, /if \(ms\?\.loop\) return elapsed % duration/);
  assert.match(music, /const resumeAt = _musicResumePosition\(ms, el\.duration\)/);
});

test('les commandes musicales répondent avant le retour Firestore', () => {
  assert.match(music, /function _setMusicState\(patch\) \{[\s\S]*?_syncMusicPlayback\(\{ \.\.\._musicState, \.\.\.patch \}\);[\s\S]*?setDoc\(_musicStateRef\(\), patch/);
  assert.match(music, /sound\.hideTitle = hideTitle;[\s\S]*?_setMusicState\(\{ currentTitleHidden: hideTitle \}\);[\s\S]*?updateDoc\(_sonRef\(soundId\), \{ hideTitle \}\)\.catch/);
});

test('les catégories et les titres musicaux ont un tri précis par poignée', () => {
  assert.match(music, /import Sortable from '\.\.\/\.\.\/vendor\/sortable\.esm\.js'/);
  assert.equal((music.match(/new Sortable\(/g) || []).length, 2);
  assert.match(music, /class="pl-grip"/);
  assert.match(music, /draggable: '\.pl\[data-pl-id\]', handle: '\.pl-grip'/);
  assert.match(music, /const batch = writeBatch\(db\)/);
  assert.match(music, /class="t-grip"/);
  assert.match(music, /draggable: '\.t\[data-sound-id\]', handle: '\.t-grip'/);
  assert.match(music, /forceFallback: false/);
  assert.match(music, /_bindMusicCategoryDropZones\(panel\)/);
  assert.match(music, /el\.ondragover = event/);
  assert.doesNotMatch(music, /document\.addEventListener\('(pointermove|dragover|touchmove)'/);
  assert.match(music, /direction: 'vertical', swapThreshold: 1/);
  assert.match(music, /const after = y >= rect\.top \+ rect\.height \/ 2/);
  assert.match(music, /return after \? 1 : -1/);
  assert.match(css, /\.vtt-music-panel \.t\.drop-before::before/);
  assert.match(css, /\.vtt-music-panel \.vtt-sort-ghost/);
});

test('le sélecteur d’émetteur des émotes affiche les portraits avec repli sur l’initiale', () => {
  assert.match(emotes, /const live = _live\(t\)/);
  assert.match(emotes, /live\?\.displayImage \|\| t\?\.imageUrl/);
  assert.match(emotes, /vtt-emote-av-initial/);
  assert.match(emotes, /<img src=/);
  assert.match(css, /\.vtt-emote-av img \{ width:100%; height:100%; object-fit:cover; \}/);
});

test('les émotes ne révèlent aucune identité de compte et montrent clairement les favoris', () => {
  assert.doesNotMatch(emotes, /STATE\.user\?\.email/);
  assert.doesNotMatch(emotes, /authorName:\s*authorName/);
  assert.doesNotMatch(vtt, /opts\.remote && opts\.authorName/);
  assert.match(emotes, /vtt-emote-tile\$\{isFav \? ' is-favorite' : ''\}/);
  assert.match(emotes, /aria-pressed="\$\{isFav\}"/);
  assert.match(css, /\.vtt-emote-star\.on \{[^}]*background:var\(--amber/);
  assert.match(css, /\.vtt-emote-tile\.is-favorite/);
});
