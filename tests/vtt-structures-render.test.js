import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const fog = readFileSync(new URL('../assets/js/features/vtt/vtt-fog.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../assets/css/vtt.css', import.meta.url), 'utf8');

test('les structures sont reconnues par leur forme sans badge textuel sur la carte', () => {
  assert.doesNotMatch(fog, /_addObstacleStateBadge/);
  assert.doesNotMatch(fog, /verrouillée 🔒/);
  assert.match(fog, /strokeWidth:10\*k/);
  assert.match(fog, /strokeWidth:5\.5\*k/);
  assert.match(fog, /_addClosedDoorVisual/);
  assert.match(fog, /_addOpenDoorVisual/);
  assert.match(fog, /_addWindowVisual/);
});

test('le verrou est constant au zoom et peut être découvert par une tentative joueur', () => {
  assert.match(fog, /name:'vtt-lock-medallion'/);
  assert.match(fog, /1 \/ Math\.max\(\.15, Number\(_stage\?\.scaleX/);
  assert.match(fog, /page\?\.lockVisibility !== 'discover'/);
  assert.match(fog, /_discoveredLocks\.add\(_lockKey\(wall\)\)/);
  assert.match(fog, /_shakeStructure\(wall\.id\)/);
});

test('les portes et vitres ont une grande cible et une aide au survol', () => {
  assert.match(fog, /strokeWidth:22\*k/);
  assert.match(fog, /rgba\(126,176,255,\.45\)/);
  assert.match(css, /\.vtt-structure-tip\.open/);
  assert.match(css, /\.vtt-map-legend-row/);
});
