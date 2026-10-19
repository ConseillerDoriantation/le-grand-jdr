import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const players = readFileSync(new URL('../assets/js/features/players.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../assets/css/players.css', import.meta.url), 'utf8');
const navigation = readFileSync(new URL('../assets/js/core/navigation.js', import.meta.url), 'utf8');

test('la page Joueurs utilise le registre maître-détail par défaut', () => {
  assert.match(players, /viewMode:\s*'register'/);
  assert.match(players, /pp-register-layout/);
  assert.match(css, /grid-template-columns:\s*316px minmax\(0,\s*1fr\)/);
  assert.match(players, /Grouper par joueur/);
});

test('les trois vues et les deux parcours regroupés partagent la même sélection', () => {
  assert.match(players, /\['register', 'Registre'/);
  assert.match(players, /\['gallery', 'Galerie'/);
  assert.match(players, /\['relations', 'Liens'/);
  assert.match(players, /\['presentation', 'Profil', 'user'\]/);
  assert.match(players, /\['chronicle', 'Parcours', 'book'\]/);
  assert.match(players, /function _profileHtml\(item\)[\s\S]*'Présentation'[\s\S]*'Galerie'/);
  assert.match(players, /function _journeyHtml\(item, items\)[\s\S]*'Chronique'[\s\S]*'Compagnons'/);
  assert.match(players, /function _normalizeDetailTab\(tab = ''\)/);
});

test('la navigation clavier et la recherche rapide restent disponibles', () => {
  assert.match(players, /event\.key === '\/'/);
  assert.match(players, /\['ArrowDown', 'ArrowRight', 'j'\]/);
  assert.match(players, /\['ArrowUp', 'ArrowLeft', 'k'\]/);
  assert.match(players, /\^\[1-2\]\$/);
  assert.match(players, /event\.key === 'Escape'/);
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
  assert.match(players, /Trier par joueur/);
  assert.match(players, /class="pp-gallery-grid"/);
  assert.doesNotMatch(players, /class="pp-gallery-group"/);
  assert.match(css, /\.pp-gallery-screen \{[^}]*width: 100%;[^}]*padding: 0 clamp\(16px,2vw,36px\)/);
  assert.match(css, /repeat\(auto-fill,minmax\(260px,1fr\)\)/);
  assert.match(players, /pp-gallery-main/);
  assert.match(players, /pp-gallery-player/);
  assert.match(players, /class="pp-gallery-drag"/);
  assert.match(players, /data-pp-id=/);
  assert.match(players, /isGallery \? '\.pp-gallery-drag' : '\.pp-register-drag'/);
  assert.match(players, /filter: isGallery \? 'a, input, select, textarea/);
  assert.match(players, /await _persistRosterOrder\(list\)/);
});

test('la vue Liens propose le graphe ego et la matrice persistante', () => {
  assert.match(players, /relMode:\s*'ego'/);
  assert.match(players, /relMode: STORE\.relMode/);
  assert.match(players, /const REL_EGO_W = 720/);
  assert.match(players, /const radii = \[120, 200, 278\]/);
  assert.match(players, /function _renderRelationMatrix\(items\)/);
  assert.match(players, /Matrice du groupe/);
  assert.match(players, /Pas encore croisés/);
  assert.doesNotMatch(players, /function _bindRelationsDrag/);
  assert.match(css, /\.pp-relations-screen\.is-ego\s*\{[^}]*grid-template-columns:\s*316px minmax\(0,1fr\) 300px/s);
  assert.match(css, /\.pp-relations-svg\s*\{[^}]*flex:\s*none/s);
});

test('les missions prévues ne créent pas de liens entre personnages', () => {
  assert.match(players, /const plannedMissionIds = new Set/);
  assert.match(players, /\.filter\(q => !plannedMissionIds\.has\(q\.missionId\)\)/);
});
