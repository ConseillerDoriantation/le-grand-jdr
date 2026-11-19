import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const pages = readFileSync(new URL('../assets/js/features/pages.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../assets/css/stats.css', import.meta.url), 'utf8');

test('le MJ peut désigner le MVP à la main (filet hors calcul automatique)', () => {
  // État + clé de scope + normalisation du doc.
  assert.match(pages, /let _statsMvpOverrides = \{\}/);
  assert.match(pages, /const _statsMvpScopeKey = \(scope = _statsScope\) => scope \|\| '__campaign__'/);
  assert.match(pages, /function _statsNormalizeMvpOverrides\(doc\)/);

  // Lecture (membre) + écriture (MJ) sur settings/mvpOverrides — règle déjà existante.
  assert.match(pages, /getDocData\('settings', 'mvpOverrides'\)/);
  assert.match(pages, /saveDoc\('settings', 'mvpOverrides', \{ overrides: next/);

  // Bouton MJ dans l'en-tête de la carte MVP (tool), bandeau sobre quand choisi.
  assert.match(pages, /const mvpMjBtn = \(renderOverview && STATE\.isAdmin && rows\.length\)/);
  assert.match(pages, /tool: mvpMjBtn/);
  assert.match(pages, /\$\{mvpChosenSec\}/);

  // Actions MJ câblées.
  assert.match(pages, /_statsMvpOverridePick: \(\) => _statsOpenMvpOverrideModal\(\)/);
  assert.match(pages, /_statsMvpSetOverride: \(btn\) => _statsSetMvpOverride\(btn\.dataset\.id\)/);
  assert.match(pages, /_statsMvpClearOverride: \(\) => _statsClearMvpOverride\(\)/);

  // Style du bandeau sobre présent.
  assert.match(css, /\.stats-mvp-chosen \{/);
});

test('le calibrage du MVP est GLOBAL (toute la campagne) → score stable entre les vues', () => {
  // On agrège sur toutes les dates (allDates), pas sur le scope courant.
  assert.match(pages, /const calibrationUnitsMap = new Map\(\);\s*\n\s*for \(const date of \(allDates \|\| \[\]\)\)/);
  assert.match(pages, /calibrationRows: calibrationRowsForMvp/);
});
