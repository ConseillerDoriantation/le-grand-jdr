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

test('les portes et vitres ont une cible précise et une aide au survol', () => {
  assert.match(fog, /function _structureHitStrokeWidth\(k\)/);
  assert.match(fog, /coarsePointer \? 28 : 18/);
  assert.match(fog, /strokeWidth:hitStrokeWidth/);
  assert.match(fog, /rgba\(126,176,255,\.45\)/);
  assert.match(css, /\.vtt-structure-tip\.open/);
  assert.match(css, /\.vtt-map-legend-row/);
});

test('un token sous le pointeur garde la priorité sur une structure', () => {
  assert.match(fog, /function _tokenGroupAtPointer\(\)[\s\S]*?_tokenLayer\?\.getIntersection\?\.\(pointer\)/);
  assert.match(fog, /function _forwardStructureEventToToken\(event, type\)[\s\S]*?token\.fire\(type, \{ evt:event\.evt \}, false\)/);
  assert.match(fog, /if \(_forwardStructureEventToToken\(event, 'click'\)\) return/);
  assert.match(fog, /if \(_forwardStructureEventToToken\(event, 'contextmenu'\)\) return/);
});

test('les structures ignorent la molette, le clic gauche agit et le clic droit ouvre les options MJ', () => {
  assert.match(fog, /node\.on\('click tap',[\s\S]*?button != null && button !== 0\) return/);
  assert.match(fog, /node\.on\('contextmenu',[\s\S]*?if \(isAdmin\) _selectItem\(wall\.id\)/);
  assert.match(fog, /hitLine\.on\('click tap',[\s\S]*?button != null && button !== 0\) return/);
  assert.match(fog, /hitLine\.on\('contextmenu',[\s\S]*?_selectItem\(w\.id\)/);
});

test('les cibles joueur sont recalculées après la construction du brouillard', () => {
  assert.match(fog, /_playerFogCanvas = isAdmin \? null : canvas;[\s\S]*if \(!isAdmin\) fogRenderWalls\(page, false\)/);
  assert.match(fog, /function _playerStructureIsVisible\(g, page = _page\)[\s\S]*_structurePoint\(g, along, normal\)/);
  assert.match(fog, /const canInteract = isAdmin \|\| _playerStructureIsVisible\(g, page\)/);
});

test('seules les structures ouvrables captent le clic et le battant ouvert reste cliquable', () => {
  assert.match(fog, /if \(!_editMode && state\.canOpen\)/);
  assert.match(fog, /if \(state\.type === 'door' && state\.open\) hitPaths\.push\(_openDoorLeafPoints\(g, k\)\)/);
  assert.match(fog, /for \(const hitPoints of hitPaths\)/);
});

test('le brouillard laisse le clic gauche aux structures mais conserve son clic droit', () => {
  assert.match(fog, /const _isFogTool = tool => tool === 'hide' \|\| tool === 'reveal'/);
  assert.match(fog, /const canSelectFogOp = _isFogTool\(_editTool\)/);
  assert.match(fog, /listening: canSelectFogOp/);
  assert.match(fog, /if \(canSelectFogOp\) \{\s*rect\.on\('click tap'/);
  assert.match(fog, /function _fogOpAtPos\(pos\)/);
  assert.match(fog, /contextmenu: onContextMenu/);
  assert.match(fog, /_selectItem\(fogOp\.id\)/);
});
