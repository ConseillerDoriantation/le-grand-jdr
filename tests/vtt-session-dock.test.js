import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const vtt = readFileSync(new URL('../assets/js/features/vtt/vtt.js', import.meta.url), 'utf8');
const dock = readFileSync(new URL('../assets/js/features/vtt/vtt-session-dock.js', import.meta.url), 'utf8');
const rest = readFileSync(new URL('../assets/js/features/vtt/vtt-rest.js', import.meta.url), 'utf8');
const loot = readFileSync(new URL('../assets/js/features/vtt/vtt-loot.js', import.meta.url), 'utf8');
const music = readFileSync(new URL('../assets/js/features/vtt/vtt-music.js', import.meta.url), 'utf8');
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
