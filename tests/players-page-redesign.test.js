import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const players = readFileSync(new URL('../assets/js/features/players.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../assets/css/players.css', import.meta.url), 'utf8');
const navigation = readFileSync(new URL('../assets/js/core/navigation.js', import.meta.url), 'utf8');

test('la page Joueurs ouvre la galerie et conserve le registre maître-détail', () => {
  assert.match(players, /viewMode:\s*'gallery'/);
  assert.match(players, /pp-register-layout/);
  assert.match(css, /grid-template-columns:\s*290px minmax\(0,\s*1fr\)/);
  assert.doesNotMatch(players, /viewMode: STORE\.viewMode/);
});

test('les trois vues et les quatre sections continues partagent la même sélection', () => {
  assert.match(players, /\['gallery', 'Galerie'/);
  assert.match(players, /\['register', 'Registre'/);
  assert.match(players, /\['relations', 'Liens du groupe'/);
  assert.match(players, /data-detail-section="presentation"/);
  assert.match(players, /data-detail-section="gallery"/);
  assert.match(players, /data-detail-section="chronicle"/);
  assert.match(players, /data-detail-section="companions"/);
  assert.match(players, /new IntersectionObserver/);
  assert.match(players, /rootMargin: '-90px 0px -55% 0px'/);
});

test('la navigation clavier et la recherche rapide restent disponibles', () => {
  assert.match(players, /event\.key === '\/'/);
  assert.match(players, /\['ArrowDown', 'j'\]/);
  assert.match(players, /\['ArrowUp', 'k'\]/);
  assert.match(players, /\^\[1-4\]\$/);
  assert.match(players, /event\.key === 'Escape'/);
  assert.match(players, /event\.key === 'Enter' && STORE\.viewMode === 'gallery'/);
});

test('le responsive passe de la liste au détail sous 860 px', () => {
  assert.match(css, /@media \(max-width:860px\)/);
  assert.match(css, /\.pp-register-layout\.is-mobile-detail \.pp-register-rail\s*\{\s*display:\s*none/);
  assert.match(css, /\.pp-mobile-list/);
});

test('le CSS Joueurs est chargé seulement avec la feature', () => {
  assert.match(navigation, /players:\s*\['histoire\.css', 'players\.css'\]/);
  assert.doesNotMatch(players, /subscribeCollection\('presence'/);
});

test('la chronique dépend uniquement des groupes encore existants du personnage', () => {
  assert.match(players, /function _missionGroupsForChar\(missionId, currentCharId\)/);
  assert.match(players, /\.filter\(ev => _missionGroupsForChar\(ev\.id, currentCharId\)\.length > 0\)/);
  assert.match(players, /const ids = _missionGroupMemberIds\(mission\.id, currentCharId\)/);
  assert.doesNotMatch(players, /\(mission\.participants \|\| \[\]\)\.forEach/);
});

test('le diaporama reste compact dans la fiche et propose le vrai plein écran', () => {
  assert.match(players, /renderFreePageHtml\(\{ page: item\.bioPage, className: 'pp-free-page', keyboard: true \}\)/);
  assert.match(players, /data-pp-action="fullscreenPresentation"/);
  assert.match(css, /\.pp-detail-columns\.is-slideshow\s*\{\s*grid-template-columns:\s*minmax\(0,1fr\) 280px/);
  assert.match(css, /max-width:\s*860px/);
  assert.match(css, /\.pp-free-page:fullscreen/);
});

test('la lightbox garde les flèches pour sa propre galerie', () => {
  assert.match(players, /if \(document\.getElementById\('pp-lightbox'\)\) return/);
  assert.match(players, /document\.addEventListener\('keydown', onKey, true\)/);
  assert.match(players, /e\.stopImmediatePropagation\(\)/);
});

test('la galerie utilise une grille adaptative et retrouve son tri manuel', () => {
  assert.match(players, /class="pp-gallery-toolbar"/);
  assert.match(players, /Grouper par joueur/);
  assert.match(players, /class="pp-gallery-grid"/);
  assert.match(players, /class="pp-gallery-group/);
  assert.match(css, /\.pp-gallery-screen \{[^}]*width: 100%;[^}]*padding: 0 clamp\(16px,2vw,36px\)/);
  assert.match(css, /repeat\(auto-fill,minmax\(230px,1fr\)\)/);
  assert.match(players, /pp-gallery-main/);
  assert.match(players, /pp-gallery-player/);
  assert.match(players, /class="pp-gallery-drag"/);
  assert.match(players, /class="pp-gallery-quick-actions"/);
  assert.match(players, /data-pp-action="editItem"/);
  assert.match(players, /data-pp-action="toggleVisible"/);
  assert.match(players, /data-pp-id=/);
  assert.match(players, /handle: '\.pp-gallery-drag'/);
  assert.match(players, /filter: 'a, input, select, textarea/);
  assert.match(players, /await _persistRosterOrder\(list\)/);
});

test('la vue Liens utilise le réseau déterministe et ouvre les compagnons', () => {
  assert.match(players, /export function _relationGraph\(items = \[\], mode = 'characters'/);
  assert.match(players, /export function _detectTables\(graph\)/);
  assert.match(players, /export function _bridgeNodes\(graph/);
  assert.match(players, /iteration < 12/);
  assert.match(players, /iteration < 420/);
  assert.match(players, /iteration < 150/);
  assert.match(players, /const minDx = Math\.max\(92/);
  assert.match(players, /data-pp-action="relationMode"/);
  assert.match(players, /data-pp-action="relationSearch"/);
  assert.match(players, /data-pp-action="relationMin"/);
  assert.match(players, /data-pp-action="relationZoom"/);
  assert.match(players, /data-pp-action="relationResetView"/);
  assert.match(players, /addEventListener\('wheel'/);
  assert.match(players, /addEventListener\('pointermove'/);
  assert.match(players, /node\.item\?\.char\?\.photo \|\| ''/);
  assert.match(players, /class="pp-rel-node-visual"/);
  assert.match(players, /data-pp-action="relationOpen"/);
  assert.match(players, /section: 'companions'/);
  assert.match(players, /relations\/\$\{STORE\.relMode\}/);
  assert.doesNotMatch(players, /function _renderRelationMatrix/);
  assert.doesNotMatch(players, /pp-rel-matrix/);
  assert.match(css, /\.pp-relations-screen\s*\{[^}]*grid-template-columns:\s*minmax\(0,1fr\) 330px/s);
  assert.match(css, /@media \(max-width:980px\)/);
  assert.match(css, /\.pp-relations-stage\s*\{[^}]*cursor:\s*grab[^}]*touch-action:\s*none/s);
  assert.match(css, /\.pp-rel-edge-label-visual,\.pp-rel-node-visual\s*\{[^}]*scale\(var\(--u,1\)\)/s);
});

test('les groupes du registre se replient et la galerie de fiche reste horizontale', () => {
  assert.match(players, /collapsedGroups:/);
  assert.match(players, /data-pp-action="togglePlayerGroup"/);
  assert.match(players, /Mes personnages/);
  assert.match(css, /grid-auto-columns:\s*132px/);
  assert.match(css, /padding:\s*0 28px 60vh/);
  assert.match(css, /\.pp-register-rail\s*\{[^}]*width:\s*auto[^}]*box-sizing:\s*border-box/s);
  assert.match(css, /\.pp-register-list\s*\{[^}]*overflow-x:\s*hidden[^}]*overflow-y:\s*auto/s);
  assert.match(css, /\.pp-register-group\s*\{[^}]*box-sizing:\s*border-box/s);
});

test('les missions prévues ne créent pas de liens entre personnages', () => {
  assert.match(players, /const plannedMissionIds = new Set/);
  assert.match(players, /\.filter\(q => !plannedMissionIds\.has\(q\.missionId\)\)/);
});

test('la modale de présentation abandonne les anciens onglets et le champ ordre', () => {
  assert.doesNotMatch(players, /id=["']pp-ordre["']/);
  assert.doesNotMatch(players, /data-pp-tab/);
  assert.match(players, /class="pp-mn-layout"/);
  assert.match(players, /class="pp-mn-preview"/);
  assert.match(players, /data-pp-action="setPresentationVisibility"/);
  assert.match(players, /class="pp-mn-crop-main"/);
  assert.match(players, /previewStatOrder = \['force', 'dexterite', 'constitution', 'intelligence', 'sagesse', 'charisme'\]/);
  assert.match(players, /statShort\(key\)\.toUpperCase\(\)/);
  assert.match(players, /class="pp-mn-vis-pill/);
  assert.match(players, /data-vis-input=/);
  assert.doesNotMatch(players, /icon\.outerHTML = _ppIcon/);
  assert.match(css, /\.pp-mn-shell\s*\{[^}]*--pp-surface:\s*#0d1520[^}]*--pp-border-md:/s);
  assert.match(css, /\.pp-mn-shell button,.pp-mn-shell select\s*\{\s*font-family:/);
  assert.doesNotMatch(css, /\.pp-mn-shell button,.pp-mn-shell select\s*\{\s*font:\s*inherit/);
});
