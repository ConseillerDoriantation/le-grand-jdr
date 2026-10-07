import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const story = readFileSync(new URL('assets/js/features/story.js', root), 'utf8');
const sheet = readFileSync(new URL('assets/js/features/story-mission-sheet.js', root), 'utf8');
const css = readFileSync(new URL('assets/css/histoire.css', root), 'utf8');

test('lecture création et édition passent par la même fiche mission', () => {
  assert.match(story, /import \{ openMissionSheet \} from '\.\/story-mission-sheet\.js'/);
  assert.match(story, /async function openStoryDetail\(id\)[\s\S]*openMissionSheet\(id \|\| null/);
  assert.match(story, /async function openStoryModal\(item = null\)[\s\S]*openStoryDetail/);
  assert.match(sheet, /function sheetHtml\(item\)/);
  assert.match(sheet, /MM\.draft = true/);
});

test('la fiche reprend le header fixe, les deux colonnes et le responsive du handoff', () => {
  assert.match(sheet, /class="mm-head"/);
  assert.match(sheet, /class="mm-main"/);
  assert.match(sheet, /class="mm-side"/);
  assert.match(css, /\.modal:has\(\.mm\)[^{]*\{[^}]*width:min\(1080px/);
  assert.match(css, /\.mm-body\{[^}]*grid-template-columns:minmax\(0,1fr\) 312px/);
  assert.match(css, /@media\(max-width:860px\)[\s\S]*?\.mm-body\{display:block/);
  assert.match(css, /@media\(max-width:560px\)[\s\S]*?height:100vh/);
});

test('les groupes restent inline et les sélecteurs restent dans la fiche', () => {
  for (const marker of [
    'group-status', 'group-range', 'group-commit', 'member-add',
    'member-remove', 'group-delete-confirm', 'mm-pop-layer',
  ]) assert.ok(sheet.includes(marker), marker);
  assert.match(sheet, /bindScopedActions\('mm', handlers\)/);
  assert.doesNotMatch(sheet, /confirmModal|promptModal/);
});

test('la fiche réutilise le cache Firestore et synchronise les participants après adhésion', () => {
  assert.match(sheet, /getCachedCollection\('story'\)/);
  assert.match(sheet, /getCachedCollection\('quests'\)/);
  assert.match(sheet, /storyParticipantsFromGroups/);
  assert.match(sheet, /await syncParticipants\(current\(\)\.id\)/);
  assert.doesNotMatch(sheet, /config\/firebase\.js/);
});

test('le recadrage de couverture reste une sous-modale en ratio quatre tiers', () => {
  assert.match(sheet, /pushModal\('Image de la mission'/);
  assert.match(sheet, /ratio: \{ w: 4, h: 3 \}/);
  assert.match(sheet, /attachDropAndCrop/);
});
