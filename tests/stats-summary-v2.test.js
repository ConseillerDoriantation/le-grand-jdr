import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const pages = readFileSync(new URL('../assets/js/features/pages.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../assets/css/stats.css', import.meta.url), 'utf8');

test('le Résumé suit les cinq blocs de la maquette statistiques v2', () => {
  assert.match(pages, /stats-v2-summary-intro/);
  assert.match(pages, /stats-v2-kpi-strip/);
  assert.match(pages, /stats-v2-evolution/);
  assert.match(pages, /stats-v2-summary-row--highlights/);
  assert.match(pages, /stats-v2-summary-row--bottom/);
  assert.match(pages, /'MVP d’impact'/);
  assert.match(pages, /'Distinctions'/);
  assert.match(pages, /'Records'/);
  assert.match(pages, /'Coups de cœur'/);
});

test('l évolution reprend les bandes de mission et le mode par participant', () => {
  assert.match(pages, /stats-v2-mission-bands/);
  assert.match(pages, /data-action="_statsEvolutionMode" data-mode="total"/);
  assert.match(pages, /data-action="_statsEvolutionMode" data-mode="participant"/);
  assert.match(pages, /stats-v2-evo-average/);
  assert.doesNotMatch(pages, /summary: `\$\{summaryIntro\}\$\{rythmeSec\}\$\{recapExtra\}\$\{spotlightHtml\}/);
});

test('les proportions du Résumé sont dédiées et adaptatives', () => {
  assert.match(css, /\.stats-root \.stats-v2-summary-row \{[^}]*grid-template-columns:minmax\(0,1\.15fr\) minmax\(0,1fr\)/s);
  assert.match(css, /\.stats-root \.stats-v2-awards-card \.stats-trophies--all \{[^}]*repeat\(2,minmax\(0,1fr\)\)/s);
  assert.match(css, /@media \(max-width:1180px\)[\s\S]*\.stats-root \.stats-v2-summary-row,[\s\S]*grid-template-columns:minmax\(0,1fr\)/);
});

test('les KPI et les temps forts reprennent les composants de la maquette', () => {
  assert.match(pages, /function _statsMiniBars/);
  assert.match(pages, /class="stats-kpi-label"><i><\/i>/);
  assert.match(pages, /class="stats-axe-weight"/);
  assert.match(pages, /class="stats-mvp-confidence is-/);
  assert.match(pages, /class="stats-mvp-footer"/);
  assert.doesNotMatch(pages, /class="stats-spark"/);
  assert.match(css, /\.stats-root \.stats-v2-summary-intro \.stats-v2-insights \{[^}]*display:flex;[^}]*flex-direction:column/s);
  assert.match(css, /\.stats-root \.stats-v2-kpi-strip \.stats-kpi\.on::before \{ display:block;/);
  assert.match(css, /\.stats-root \.stats-v2-mvp-card \.stats-axe \{[^}]*grid-template-columns:minmax\(118px,\.9fr\)[^}]*58px 52px/s);
});

test('le bandeau reprend le fil, le filtre de groupes et le partage de la maquette', () => {
  assert.match(pages, /class="stats-scope stats-breadcrumb"/);
  assert.match(pages, /Tous les actes/);
  assert.match(pages, /Toutes les missions/);
  assert.match(pages, /Toutes les séances/);
  assert.match(pages, /stats-player-shortcuts/);
  assert.match(pages, /data-action="_statsPlayerShortcut" data-kind="group"/);
  assert.match(pages, /shortcutGroupMap\.get\(labelKey\)/);
  assert.match(pages, /class="stats-share-btn"[\s\S]*<svg viewBox="0 0 24 24"/);
  assert.match(css, /\.stats-root \.stats-topbar-v2 \.stats-tab\.on \{ border:0 !important;/);
  assert.match(css, /\.stats-root \.stats-topbar-v2 \.stats-tab\.on::after/);
});

test('le palmarès conserve les dates, portraits et vraies images d émotes', () => {
  assert.match(pages, /class="stats-v2-record-meta"/);
  assert.match(pages, /_statsAvatar\(record\.row\.id, record\.row\.name, 24\)/);
  assert.match(pages, /createEmoteLookup\(normalizeEmoteCatalog\(emoteDoc\?\.emotes\)\)/);
  assert.match(pages, /sanitizeEmoteName\(name\)/);
  assert.match(css, /\.stats-root \.stats-v2-awards-card \.stats-trophy-medal \{[^}]*width:32px;[^}]*border-radius:50%/s);
});

test('l onglet Séances reprend le journal complet de la maquette', () => {
  assert.match(pages, /Journal des séances/);
  assert.match(pages, /class="stats-v2-mission-session-head"/);
  assert.match(pages, /_statsMissionArtHtml\(mission \|\| \{ name \}, 38\)/);
  assert.match(pages, /PJ à terre/);
  assert.match(pages, /data-action="_statsSessionsMode" data-mode="mission"/);
  assert.match(pages, /data-action="_statsSessionsMode" data-mode="chrono"/);
  assert.match(pages, /_statsAvatar\(item\.id, item\.name, 28\)/);
  assert.match(pages, /_statsSessionDateParts/);
  assert.match(pages, /class="stats-v2-session-main" data-action="_statsOpenSessionSummary"/);
  assert.match(pages, /_statsOpenSessionSummary:[\s\S]*_statsTab = 'summary';[\s\S]*setRouteSub\('statistiques', 'summary'\);[\s\S]*_statsRender\(scope\);/);
  assert.match(css, /\.stats-root \.stats-v2-session-main \{ grid-template-columns:78px/);
});

test('l onglet Personnages reprend le tableau dense et la recherche de la maquette', () => {
  assert.match(pages, /stats-v2-section stats-v2-characters/);
  assert.match(pages, /placeholder="Rechercher un personnage…"/);
  assert.match(pages, /Par séance jouée/);
  assert.match(pages, /const charGroups = \[\.\.\.new Set/);
  assert.match(pages, /_statsAvatar\(r\.id, r\.name, 30\)/);
  assert.match(css, /\.stats-root \.stats-v2-characters \.stats-tbl \{ min-width:1050px;/);
  assert.match(css, /\.stats-root \.stats-v2-character-row \.stats-who-in > span > small/);
});

test('l onglet Dés sépare synthèse, distribution, chance et compétences', () => {
  assert.match(pages, /stats-v2-dice-overview/);
  assert.match(pages, /stats-v2-dice-summary/);
  assert.match(pages, /stats-v2-dice-hist/);
  assert.match(pages, /Chance par personnage/);
  assert.match(pages, /stats-v2-skills/);
  assert.match(pages, /person\.crits/);
  assert.match(pages, /person\.fumbles/);
  assert.match(css, /\.stats-root \.stats-v2-dice-overview \{ display:grid; grid-template-columns:minmax\(330px,\.9fr\) minmax\(500px,1\.4fr\)/);
});

test('l onglet Données reprend les contrôles MJ complets de la maquette', () => {
  assert.match(pages, /stats-v2-page-head[^`]*MJ uniquement/);
  assert.match(pages, /stats-v2-health/);
  assert.match(pages, /stats-v2-data-card/);
  assert.match(pages, /Mission · groupe/);
  assert.match(pages, /stats-v2-raw-grid/);
  assert.match(pages, /stats-v2-danger/);
  assert.match(pages, /data-action="_statsResetAsk"/);
  assert.match(css, /\.stats-root \.stats-data-table td/);
  assert.match(css, /\.stats-root \.stats-v2-danger/);
});

test('les statistiques affichent le nom actuel de la fiche personnage', () => {
  assert.match(pages, /function _statsCharacterName\(id, fallback = ''\)/);
  assert.match(pages, /live\?\.nom \|\| live\?\.name \|\| fallback/);
  assert.match(pages, /id, name: _statsCharacterName\(id, c\.name\)/);
  assert.match(pages, /const name = _statsCharacterName\(id, statsChar\.name\)/);
  assert.match(pages, /addName\(live\?\.nom \|\| live\?\.name, charId\)/);
});
