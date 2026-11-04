import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const firestore = read('../assets/js/data/firestore.js');
const qol = read('../assets/js/shared/global-qol.js');
const app = read('../assets/js/app.js');
const serviceWorker = read('../sw.js');
const diagnostics = read('../assets/js/shared/diagnostics.js');
const displayPreferences = read('../assets/js/shared/display-preferences.js');
const commandPalette = read('../assets/js/features/command-palette.js');
const achievements = read('../assets/js/features/achievements.js');
const collection = read('../assets/js/features/collection.js');
const shop = read('../assets/js/features/shop.js');
const shopCss = read('../assets/css/shop.css');
const recentNavigation = read('../assets/js/shared/recent-navigation.js');

test('les écritures Firestore publient un cycle local sans nouvelle lecture', () => {
  assert.match(firestore, /CustomEvent\('app:data-write-state'/);
  assert.match(firestore, /_emitWriteState\(id, 'started'/);
  assert.match(firestore, /_emitWriteState\(id, 'succeeded'/);
  assert.match(firestore, /_emitWriteState\(id, 'failed'/);
  assert.match(firestore, /return _trackWrite\(`\$\{path\}\/\$\{id\}`/);
});

test('la QoL globale affiche la synchronisation et protège la saisie rerendue', () => {
  assert.match(qol, /function _mountSyncStatus\(\)/);
  assert.match(qol, /app:data-write-state/);
  assert.match(qol, /En attente de connexion/);
  assert.match(qol, /function _initRerenderContinuity\(\)/);
  assert.match(qol, /captureViewContext\(scope/);
  assert.match(qol, /restoreViewContext\(currentScope/);
  assert.match(qol, /beforeunload[\s\S]{0,180}!pending\.size/);
});

test('la PWA détecte un nouveau déploiement sans rechargement forcé', () => {
  assert.match(app, /APP_UPDATE_AVAILABLE/);
  assert.match(app, /fetch\('\.\/index\.html', \{ cache: 'no-store' \}\)/);
  assert.match(qol, /Nouvelle version disponible/);
  assert.match(serviceWorker, /_responseChanged\(previous, res\)/);
  assert.match(serviceWorker, /postMessage\(\{ type: 'APP_UPDATE_AVAILABLE' \}\)/);
  assert.doesNotMatch(app, /controllerchange[\s\S]{0,300}location\.reload/);
});

test('le diagnostic copiable exclut les données métier et reste accessible par Ctrl K', () => {
  assert.match(diagnostics, /Aucun email, UID, contenu de document ou donnée de campagne/);
  assert.match(diagnostics, /app:data-write-state/);
  assert.match(commandPalette, /copy-diagnostic/);
  assert.match(commandPalette, /copyDiagnosticReport/);
  assert.doesNotMatch(diagnostics, /STATE\.(?:user|profile|characters)/);
});

test('les préférences de lisibilité sont locales et accessibles par Ctrl K', () => {
  assert.match(displayPreferences, /jdr-display-preferences/);
  assert.match(displayPreferences, /localStorage\.setItem/);
  assert.match(displayPreferences, /dataset\.uiText/);
  assert.match(displayPreferences, /dataset\.uiMotion/);
  assert.match(commandPalette, /display-preferences/);
  assert.doesNotMatch(displayPreferences, /saveDoc|updateInCol|addToCol/);
});

test('les suppressions de collection et hauts-faits peuvent être annulées', () => {
  assert.match(achievements, /Haut-Fait supprimé\.[\s\S]*label: '↶ Annuler'/);
  assert.match(achievements, /await saveDoc\(col, id, data\)/);
  assert.match(collection, /Carte supprimée\.[\s\S]*label: '↶ Annuler'/);
  assert.match(collection, /await _persistCard\(id, full\)/);
});

test('la boutique permet des actions groupées sans lecture Firestore supplémentaire', () => {
  assert.match(shop, /data-sh-action="bulkMode"/);
  assert.match(shop, /data-sh-action="bulkSelect" data-scope="filtered"/);
  assert.match(shop, /async function _applyBulkShopPatch/);
  assert.match(shop, /await batchUpdateInCol\(updates\.slice\(index, index \+ 450\)\)/);
  assert.match(shop, /label: '↶ Annuler'[\s\S]*Action groupée annulée/);
  assert.match(shop, /sortable: STATE\.isAdmin && _view === 'items' && !_bulkMode/);
  assert.match(shopCss, /\.shc-card\.is-selected/);
  assert.doesNotMatch(shop.slice(shop.indexOf('async function _applyBulkShopPatch'), shop.indexOf('function _renderResultsHtml')), /loadCollection|loadShopData/);
});

test('les éléments récents de Ctrl K restent locaux et effaçables', () => {
  assert.match(recentNavigation, /export function clearRecentNavigation\(\)/);
  assert.match(recentNavigation, /localStorage\.removeItem\(_storageKey\(\)\)/);
  assert.match(commandPalette, /data-cmd-clear-recent/);
  assert.match(commandPalette, /clearRecentNavigation\(\)/);
  assert.doesNotMatch(recentNavigation, /saveDoc|updateInCol|loadCollection/);
});

test('la navigation clavier couvre retour et avance et la palette ouvre directement les hauts-faits', () => {
  assert.match(qol, /Page précédente[\s\S]{0,120}Page suivante/);
  assert.match(qol, /event\.altKey && event\.key === 'ArrowRight'/);
  assert.match(qol, /history\.forward\(\)/);
  assert.match(commandPalette, /openAchievementLightbox/);
  assert.doesNotMatch(commandPalette, /case 'achievement':[\s\S]{0,180}_highlight/);
});

test('Ctrl K réutilise les caches secrets du MJ sans les charger à la simple ouverture', () => {
  assert.match(commandPalette, /STATE\.isAdmin \? cachedOnly\('achievements_secret'\)/);
  assert.match(commandPalette, /STATE\.isAdmin \? cachedOnly\('collection_secret'\)/);
  assert.match(commandPalette, /const mergeById = \(publicItems, secretItems\)/);
  assert.match(commandPalette, /const cachedOnly = col => Promise\.resolve\(getCachedCollection\(col\) \|\| \[\]\)/);
  assert.doesNotMatch(commandPalette, /get\('(?:achievements|collection)_secret'\)/);
});
