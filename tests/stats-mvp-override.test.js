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

  // Rendu : bandeau override prioritaire dans la pile MVP + note « indicatif » sur l'auto.
  assert.match(pages, /function _statsMvpOverrideHtml\(rows, overrideRow, scopeNoun\)/);
  assert.match(pages, /\$\{mvpOverrideSec\}/);
  assert.match(pages, /_mvpOverrideRow \? '<p class="stats-mvp-auto-note">/);

  // Actions MJ câblées.
  assert.match(pages, /_statsMvpOverridePick: \(\) => _statsOpenMvpOverrideModal\(\)/);
  assert.match(pages, /_statsMvpSetOverride: \(btn\) => _statsSetMvpOverride\(btn\.dataset\.id\)/);
  assert.match(pages, /_statsMvpClearOverride: \(\) => _statsClearMvpOverride\(\)/);

  // Style de la carte override présent (bump d'assets nécessaire — testé ailleurs).
  assert.match(css, /\.stats-mvp-override \{/);
});
