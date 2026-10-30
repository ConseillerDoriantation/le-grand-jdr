import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const admin = readFileSync(new URL('assets/js/features/vtt/vtt-conditions-config.js', root), 'utf8');
const helpers = readFileSync(new URL('assets/js/shared/condition-admin.js', root), 'utf8');
const vtt = readFileSync(new URL('assets/js/features/vtt/vtt.js', root), 'utf8');
const css = readFileSync(new URL('assets/css/vtt.css', root), 'utf8');

test('la modale états suit le layout liste et détail de la maquette', () => {
  assert.match(admin, /class="vtt-cc-shell"/);
  assert.match(admin, /class="vtt-cc-main"/);
  assert.match(admin, /data-cc-list/);
  assert.match(admin, /data-cc-detail/);
  assert.match(admin, /data-cc-footer/);
  assert.match(css, /\.modal:has\(\.vtt-cc-shell\)[\s\S]*?width:\s*min\(1080px,\s*96vw\)/);
  assert.match(css, /height:\s*min\(800px,\s*calc\(100dvh - 48px\)\)/);
  assert.match(css, /\.vtt-cc-main\s*\{[^}]*grid-template-columns:\s*320px minmax\(0,\s*1fr\)/);
});

test('les modifications restent dans un brouillon jusqu à l unique sauvegarde', () => {
  assert.match(admin, /_state\s*=\s*\{\s*saved,\s*draft:\s*cloneConditionAdminList\(saved\)/);
  assert.equal((admin.match(/await saveDoc\('world',\s*'conditions'/g) || []).length, 1);
  assert.match(admin, /conditionAdminPersistedLibrary\(_state\.draft\)/);
  assert.match(admin, /clearConditionLibraryCache\(\)/);
  assert.match(admin, /_setConditionLibrary\(live\);\s*_rebuildConditionIndex\(\)/);
  assert.match(admin, /setModalCloseGuard\(_guardClose\)/);
});

test('la validation et la persistance couvrent les règles du handoff', () => {
  assert.match(helpers, /Nom requis/);
  assert.match(helpers, /Nom déjà pris/);
  assert.match(helpers, /Icône requise/);
  assert.match(helpers, /Effet « \$\{incomplete\.label\} » incomplet/);
  assert.match(helpers, /filter\(condition => conditionAdminIsCustom\(condition\) \|\| conditionAdminIsAdjusted\(condition\)\)/);
  assert.match(admin, /history\.length > 80/);
  assert.match(admin, /custom_\$\{\(stamp \+ suffix\)\.toString\(36\)\}/);
});

test('le catalogue ne propose que les effets réellement automatisés', () => {
  for (const key of [
    'attackBy', 'attackAgainst', 'critRangeBonus', 'movementBonus',
    'cantCastSpells', 'dmgTakenBonus', 'dmgReductionPct',
    'consumedByElementHit', 'breakOnAttack', 'concentrationCheck',
  ]) assert.match(helpers, new RegExp(`key: '${key}'`), key);

  for (const unsupported of ['meleeCritOnHit', 'failsStrSaves', 'failsDexSaves', 'movementMod', 'cantAct']) {
    assert.doesNotMatch(helpers, new RegExp(`key: '${unsupported}'`), unsupported);
  }
  assert.match(helpers, /conditionAdminOtherEffects/);
  assert.match(admin, /Réglages hors éditeur conservés/);
});

test('le nouveau protocole remplace les anciens toggles', () => {
  assert.match(vtt, /_vttConditionConfigDo/);
  assert.match(vtt, /_vttConditionConfigInput/);
  assert.doesNotMatch(vtt, /_vttCcTriSet|_vttCcFlagToggle/);
  assert.doesNotMatch(css, /vtt-cc-modal--master|vtt-cc-list-item|vtt-cc-tri-opt|vtt-cc-flag-pill/);
});

test('la suppression mesure son impact sans nouvelle lecture Firestore', () => {
  const impact = admin.slice(admin.indexOf('function _usageImpact'), admin.indexOf('function _deleteBanner'));
  assert.match(impact, /VS\.characters/);
  assert.match(impact, /STATE\.characters/);
  assert.match(impact, /Object\.values\(VS\.tokens/);
  assert.doesNotMatch(impact, /loadCollection|getDocData|subscribeCollection/);
});
