import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const vtt = readFileSync(new URL('../assets/js/features/vtt/vtt.js', import.meta.url), 'utf8');
const chat = readFileSync(new URL('../assets/js/features/vtt/vtt-chat.js', import.meta.url), 'utf8');
const tray = readFileSync(new URL('../assets/js/features/vtt/vtt-tray.js', import.meta.url), 'utf8');
const maplib = readFileSync(new URL('../assets/js/features/vtt/vtt-maplib.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../assets/css/vtt.css', import.meta.url), 'utf8');

test('la régie sépare la Distribution à gauche et le chat à droite', () => {
  assert.match(vtt, /class="vtt-slide-edge"/);
  assert.match(vtt, /data-edge-mode="chat"/);
  assert.doesNotMatch(vtt, /data-edge-mode="reserve"/);
  assert.match(vtt, /class="vtt-distribution" id="vtt-distribution"/);
  assert.match(vtt, /id="vtt-distribution-search"/);
  assert.match(vtt, /id="vtt-scene-tokens"[\s\S]*id="vtt-reserve-body"[\s\S]*id="vtt-bestiary-body"/);
  assert.doesNotMatch(vtt, /<div class="vtt-mj-quick"/);
  assert.match(css, /--pw:\s*392px/);
  assert.match(css, /--vtt-distribution-w:\s*310px/);
  assert.match(css, /\.vtt-edge-badge\[hidden\]\s*\{\s*display:\s*none\s*!important/);
});

test('la Distribution réunit scène réserve bestiaire et création rapide', () => {
  assert.match(vtt, /vtt-distribution-scroll[\s\S]*vtt-reserve-stage[\s\S]*id="vtt-scene-tokens"[\s\S]*id="vtt-reserve-body"[\s\S]*id="vtt-bestiary-body"/);
  assert.match(vtt, /data-vtt-fn="_vttImproviser"[\s\S]*Improviser/);
  assert.match(vtt, /data-vtt-distribution-filter="player"/);
  assert.match(vtt, /data-vtt-distribution-filter="npc"/);
  assert.match(vtt, /data-vtt-distribution-filter="bestiary"/);
  assert.match(vtt, /data-vtt-distribution-filter="improvised"/);
  assert.match(tray, /localStorage\.getItem\('vtt-tray-tab'\) \|\| 'reserve'/);
  assert.match(vtt, /class="vtt-slide-x"[\s\S]*?<svg[\s\S]*?M6 6l12 12M18 6 6 18/);
  assert.match(css, /\.vtt-slide-hd \.vtt-slide-pin,[\s\S]*?width:\s*32px;\s*height:\s*32px;[\s\S]*?border:\s*0/);
});

test('la Distribution propose une liste dense, le groupe et les placements tactiques', () => {
  assert.match(tray, /vtt-reserve-layout/);
  assert.match(tray, /_vttReservePick/);
  assert.match(tray, /_vttReservePlacePicked/);
  assert.match(tray, /_vttPlaceOnlineReserve/);
  assert.match(tray, /vtt-res-summon-warning/);
  assert.match(tray, /const playerLabel = token/);
  assert.match(tray, /sortTokensByName/);
  assert.match(css, /\.vtt-scene-token-ring\s*\{[\s\S]*?conic-gradient/);
  assert.match(vtt, /id="vtt-bring-group"/);
  assert.match(vtt, /class="vtt-improv-launch"/);
  assert.match(vtt, /class="vtt-improv-identity"/);
  assert.match(vtt, /class="vtt-improv-segment"/);
  assert.match(vtt, /class="vtt-improv-visibility"/);
  assert.match(vtt, /function _vttImprovisedCount/);
  assert.match(vtt, /function _vttArmBestiaryPlacement[\s\S]*?kind:'beast'/);
  assert.match(vtt, /if \(!cell\) \{ _vttArmBestiaryPlacement\(beastId\); return; \}/);
  assert.match(css, /#vtt-reserve-body \.vtt-res-line,[\s\S]*?height:\s*48px;[\s\S]*?display:\s*grid/);
  assert.match(css, /#vtt-reserve-body \.vtt-res-line-dot\s*\{[\s\S]*?width:\s*32px/);
  assert.match(css, /#vtt-reserve-body \.vtt-res-line-name,[\s\S]*?height:\s*auto;[\s\S]*?min-height:\s*0;[\s\S]*?font-size:\s*11\.5px/);
  assert.match(css, /#vtt-reserve-body \.vtt-res-line-main,[\s\S]*?gap:\s*0/);
  assert.match(css, /\.vtt-placement-ghost\.is-group/);
  assert.match(css, /\.vtt-placement-ghost\.is-beast/);
  assert.match(css, /#vtt-reserve-body \.vtt-res-line-meta i\s*\{[\s\S]*?text-overflow:\s*ellipsis/);
  assert.match(css, /#vtt-reserve-body \.vtt-res-line-meta i\s*\{[\s\S]*?background:\s*none/);
  assert.match(vtt, /function _patchHpOptimistically[\s\S]*?_refreshDisplayedIdentitySoon\(token\.id\);[\s\S]*?_renderTraySoon\(\);/);
});

test('la vue Scènes reprend le résumé et les cartes compactes de la maquette', () => {
  assert.match(tray, /vtt-page-scenes-shell[\s\S]*?\$\{liveSummary\}[\s\S]*?vtt-page-command-top/);
  assert.doesNotMatch(tray, /<div class="vtt-page-command">/);
  assert.match(tray, /<small><i><\/i>Votre vue<\/small>/);
  assert.match(tray, /<small><i><\/i>Joueurs<\/small>/);
  assert.match(tray, /class="vtt-page-thumb-grid"/);
  assert.match(tray, /class="vtt-page-action-icon"/);
  assert.match(css, /#vtt-tray-view-scenes\s*\{\s*padding:\s*14px 12px 78px/);
  assert.match(css, /\.vtt-page-scenes-shell \.vtt-page-item\s*\{[\s\S]*?grid-template-columns:\s*76px minmax\(0,1fr\) auto/);
  assert.match(css, /\.vtt-page-scenes-shell \.vtt-page-thumb\s*\{[\s\S]*?width:\s*76px;\s*height:\s*50px/);
});

test('le Bestiaire utilise l en-tête et les cartes horizontales de la maquette', () => {
  assert.doesNotMatch(vtt, /<div class="vtt-tray-section-hd"><span>👹 Bestiaire/);
  assert.doesNotMatch(tray, /class="vtt-bst-create"[\s\S]*?data-vtt-fn="_vttCreateEnemy"/);
  assert.match(tray, /class="vtt-bst-meta"[\s\S]*?<i>PV<\/i>[\s\S]*?<i>CA<\/i>[\s\S]*?<i>VIT<\/i>/);
  assert.match(vtt, /id="vtt-distribution-search"[\s\S]*data-vtt-fn="_vttDistributionSearch"/);
  assert.match(css, /#vtt-bestiary-body \.vtt-bst-grid\s*\{\s*display:\s*block/);
  assert.match(css, /#vtt-bestiary-body \.vtt-bst-tile\s*\{[\s\S]*?min-height:\s*54px/);
  assert.match(css, /#vtt-bestiary-body \.vtt-bst-portrait\s*\{[\s\S]*?width:\s*36px;\s*height:\s*36px/);
  assert.match(css, /\.vtt-slide,[\s\S]*?\.vtt-slide-hd,[\s\S]*?\.vtt-tray-view\s*\{\s*background-color:\s*var\(--surface-1\)/);
});

test('la pellicule et la recherche rapide portent le nouveau flux de régie', () => {
  assert.match(vtt, /id="vtt-scene-reel"/);
  assert.match(tray, /export function _renderSceneReel/);
  assert.match(tray, /vtt-reel-card/);
  assert.match(tray, /Nouvelle scène/);
  assert.match(tray, /export function _vttReelFolderMenu/);
  assert.match(tray, /export function _vttPageMoveMenu/);
  assert.match(tray, /new Sortable\(track/);
  assert.match(tray, /vtt-scene-popover-folders/);
  assert.match(tray, /vtt-scene-popover-new/);
  assert.match(tray, /_vttOpenSceneFromPopover/);
  assert.match(tray, /vtt-regie-state is-live\$\{_reelCompact/);
  assert.match(tray, /const structureKey = JSON\.stringify/);
  assert.match(tray, /el\.dataset\.structureKey === structureKey/);
  assert.match(tray, /const paint = \(key, html\)/);
  assert.match(css, /\.vtt-scene-popover-grid\s*\{[\s\S]*?repeat\(auto-fill,minmax\(150px,1fr\)\)/);
  assert.match(css, /\.vtt-scene-popover-card\s*\{[\s\S]*?height:\s*84px/);
  assert.match(css, /\.vtt-scene-popover-head \.vtt-scene-popover-new\s*\{[\s\S]*?height:\s*29px/);
  assert.match(css, /\.vtt-scene-popover-grid \.vtt-scene-popover-open\s*\{[\s\S]*?background-position:\s*center;[\s\S]*?background-size:\s*cover/);
  assert.match(css, /\.vtt-scene-popover-grid \.vtt-scene-popover-open b\s*\{[\s\S]*?bottom:\s*0;[\s\S]*?align-items:\s*flex-end/);
  assert.match(css, /\.vtt-scene-popover-grid \.vtt-scene-popover-actions button\s*\{[\s\S]*?width:\s*21px;[\s\S]*?height:\s*20px;[\s\S]*?overflow:\s*hidden/);
  assert.match(vtt, /function _vttFinderOpen\(\)/);
  assert.match(vtt, /Scène, personnage, PNJ, créature, carte/);
  assert.match(vtt, /document\.getElementById\('vtt-finder'\)[\s\S]*_vttFinderClose\(\)/);
  assert.match(vtt, /_vttSceneDraftPick/);
  assert.match(vtt, /_vttConfirmSceneFromLibrary/);
  assert.match(vtt, /class="vtt-scene-modal"/);
  assert.match(vtt, /vtt-scene-library-grid[\s\S]*Grille vide[\s\S]*Importer…/);
  assert.match(vtt, /class="vtt-scene-map-image"><img src="\$\{_esc\(url\)\}"[\s\S]*?loading="lazy"/);
  assert.match(vtt, /Ouvrir en aperçu[\s\S]*Ouvrir et envoyer les joueurs[\s\S]*Créer sans ouvrir/);
  assert.match(vtt, /function _sceneGridGuess\(image, probedRatio = 0\)[\s\S]*ratio >= 1/);
  assert.match(vtt, /function _vttSceneDraftDimension\(\)[\s\S]*_vttSceneDraftRefreshPreview/);
  assert.match(vtt, /function _vttSceneDraftImportMenu\(event\)[\s\S]*Importer un dossier GitHub/);
  assert.match(css, /\.modal:has\(\.vtt-scene-modal\)[^}]*width:min\(1000px/);
  assert.match(css, /\.vtt-scene-modal \{[^}]*grid-template-columns:minmax\(0,1fr\) 340px/);
  assert.match(css, /\.vtt-scene-modal \.vtt-scene-library-grid \{[^}]*repeat\(auto-fill,minmax\(132px,1fr\)\)/);
  assert.match(css, /\.vtt-scene-modal \.vtt-scene-library-grid \{[^}]*grid-auto-rows:132px/);
  assert.match(css, /\.vtt-scene-library-grid > \.vtt-scene-map-choice,[\s\S]*?height:132px;[\s\S]*?grid-template-rows:88px 44px/);
  assert.match(css, /\.vtt-scene-modal-foot \{[^}]*grid-column:1\/-1/);
  assert.match(css, /\.vtt-finder\s*\{/);
  assert.match(css, /\.vtt-reel-card/);
});

test('la bibliothèque Images devient une galerie deux colonnes avec un import unifié', () => {
  assert.match(maplib, /<strong>Images<\/strong>[\s\S]*?class="vtt-lib-import"[\s\S]*?>Importer<\/button>/);
  assert.match(maplib, /const showTools = folders\.length > 0 \|\| images\.length > 12/);
  assert.match(vtt, /function _vttLibImportMenu\(event\)[\s\S]*?_vttLibImportGithub[\s\S]*?_vttLibNewFolder/);
  assert.match(css, /#vtt-tray-view-images\s*\{\s*padding:\s*14px 10px 78px/);
  assert.match(css, /#vtt-tray-library \.vtt-lib-grid\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(css, /#vtt-tray-library \.vtt-lib-card\s*\{[\s\S]*?aspect-ratio:\s*4\/3/);
  assert.match(css, /#vtt-tray-library \.vtt-lib-card-meta\s*\{[\s\S]*?left:\s*0;\s*right:\s*0;\s*bottom:\s*0;[\s\S]*?padding:\s*26px 9px 8px/);
  assert.match(css, /#vtt-tray-library \.vtt-lib-card-name\s*\{[\s\S]*?text-overflow:\s*ellipsis;[\s\S]*?line-height:\s*14px/);
});

test('le journal filtre les familles et respecte le scroll du lecteur', () => {
  assert.match(chat, /combat: new Set\(\['attack', 'attack-multi', 'cast'/);
  assert.match(chat, /rolls: new Set\(\['roll', 'dice-free', 'craft'\]\)/);
  assert.match(chat, /messages: new Set\(\['chat'\]\)/);
  assert.match(chat, /currentTime - previousTime >= 300_000/);
  assert.match(chat, /if \(wasAtBottom\)/);
  assert.match(vtt, /_vttNotifyChatMessage/);
  assert.match(css, /\.vtt-chat-log\s*>\s*\.vtt-log,[\s\S]*?\.vtt-chat-log\s*>\s*\.vtt-chat-time-sep\s*\{\s*flex:\s*0\s+0\s+auto/);
  assert.match(chat, /btn\.hidden = _chatStuck/);
  assert.match(chat, /'Messages récents'/);
  assert.match(chat, /if \(_chatStuck\) _chatNewBelow = 0;\s*_updateNewButton\(\);/);
  assert.match(vtt, /aria-label="Revenir aux messages récents"/);
  assert.match(chat, /function _jumpChatToBottom\(el\)[\s\S]*?vtt-chat-log--instant-scroll[\s\S]*?requestAnimationFrame/);
  assert.match(chat, /export function _vttChatShowNew\(instant = false\)[\s\S]*?_jumpChatToBottom\(el\)[\s\S]*?setTimeout/);
  assert.match(css, /\.vtt-chat-log\.vtt-chat-log--instant-scroll\s*\{\s*scroll-behavior:\s*auto !important/);
  assert.match(vtt, /_slideInitialChatPending[\s\S]*?requestAnimationFrame\(\(\) => _vttChatShowNew\(true\)\)/);
});

test('le texte du chat reste sélectionnable et prioritaire sur la copie des tokens', () => {
  assert.match(css, /\.vtt-chat-log\s*\{[\s\S]*?user-select:\s*text/);
  assert.match(vtt, /function _vttHasCopyableTextSelection\(\)[\s\S]*?window\.getSelection/);
  assert.match(vtt, /if \(_vttHasCopyableTextSelection\(\)\) return;[\s\S]*?if \(_vttCopySelection\(\)\) e\.preventDefault\(\)/);
});

test('une attaque reprend la carte de résultat compacte de la maquette', () => {
  assert.match(chat, /vtt-log--attack-card/);
  assert.match(chat, /vtt-log-resolution/);
  assert.match(chat, /vtt-log-die/);
  assert.match(chat, /vtt-log-verdict/);
  assert.match(chat, /vtt-log-damage/);
  assert.match(chat, /Voir le calcul/);
  assert.match(css, /\.vtt-log-resolution\s*\{[\s\S]*?display:\s*flex/);
  assert.match(css, /\.vtt-log-die\s*\{[\s\S]*?clip-path:\s*polygon/);
});

test('les cibles PJ et invocations retrouvent leur portrait vivant dans le chat', () => {
  assert.match(chat, /function _chatTargetPortrait\(target, tokenId = null\)/);
  assert.match(chat, /const token = _chatTargetToken\(target, tokenId\);[\s\S]*?_live\(token\)\?\.displayImage/);
  assert.match(chat, /VS\.characters\?\.\[target\.characterId\][\s\S]*?target\?\.targetImage[\s\S]*?target\?\.defenderImage/);
  assert.match(chat, /const defenderImage = _chatTargetPortrait\(m, m\.defenderTokenId \|\| m\.tokenId\)/);
  assert.match(chat, /const targetImage = _chatTargetPortrait\(r, r\.tokenId\)/);
  assert.match(vtt, /VS\.characters = next;\s*_vttRefreshChatPortraits\(\);/);
  assert.match(vtt, /_syncTokenStackVisuals\(\);\s*_vttRefreshChatPortraits\(\);/);
  assert.match(chat, /owner\?\.invocations\?\.find\?[\s\S]*?if \(invocation\?\.image\) return invocation\.image/);
  assert.match(vtt, /summonOwnerCharId: curTgtData\.summonOwnerCharId \|\| null,[\s\S]*?summonInvId: curTgtData\.summonInvId \|\| null/);
});

test('le jet automatique de concentration ne répète pas Maintenu ou Rompu', () => {
  const start = chat.indexOf('const renderConcentrationSave');
  const end = chat.indexOf('/** Tick DoT */', start);
  const renderer = chat.slice(start, end);
  assert.doesNotMatch(renderer, /✅ MAINTENU|❌ ROMPU/);
  assert.match(renderer, /→ sort maintenu/);
  assert.match(renderer, /→ sort rompu/);
});

test('les invocations utilisent le nouveau pied et les jets de compétence restent compacts', () => {
  assert.match(chat, /const footer = undo[\s\S]*?vtt-log-footer/);
  assert.match(chat, /vtt-log--skill-roll/);
  assert.match(chat, /vtt-log-skill-summary/);
  assert.match(css, /\.vtt-log--skill-roll\s*\{[\s\S]*?padding:\s*7px\s+9px\s+8px/);
  assert.match(css, /\.vtt-log-skill-summary\s*\{[\s\S]*?grid-template-columns:\s*38px/);
});
