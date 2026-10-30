import test from 'node:test';
import assert from 'node:assert/strict';

import { makeTechniqueEditor } from '../assets/js/shared/technique-editor.js';

const TE = makeTechniqueEditor({
  statOptions: [['force', 'Force'], ['constitution', 'Constitution']],
  damageTypeOptions: () => [['feu', '🔥 Feu']],
  conditionOptions: () => [['prone', 'À terre'], ['exposed', 'À découvert']],
  conditionLabel: id => ({ prone: 'À terre', exposed: 'À découvert' })[id] || id,
  damageLabel: id => ({ feu: 'Feu' })[id] || id,
});
const T0 = () => ({ trigger: 'hit', attackModifier: 0, extraDamageFlat: 0, damageMalusFlat: 0, label: 'Test' });

test('la table expose les 20 modificateurs et 4 groupes', () => {
  assert.equal(TE.MODS.length, 20);
  assert.deepEqual(TE.GROUPS, ['Précision', 'Dégâts', 'Effets', 'Contreparties']);
});

test('summary liste les modificateurs actifs, préfixés du déclencheur', () => {
  assert.equal(TE.summary({ ...T0(), attackModifier: 2, damageMalusFlat: 1 }), 'toucher +2 · −1 dégâts');
  assert.equal(TE.summary({ ...T0(), trigger: 'crit', extraDamageFlat: 3 }), '+3 dégâts');
  assert.equal(TE.summary(T0()), 'Aucun effet');
});

test('balance : sans effet / sans contrepartie / que des contreparties / à corriger', () => {
  assert.deepEqual(TE.balance(T0()), { cls: 'ok', txt: 'Sans effet' });
  assert.deepEqual(TE.balance({ ...T0(), extraDamageFlat: 2 }), { cls: 'warn', txt: 'Sans contrepartie' });
  assert.deepEqual(TE.balance({ ...T0(), damageMalusFlat: 2 }), { cls: 'warn', txt: 'Que des contreparties' });
  assert.equal(TE.balance({ ...T0(), attackModifier: 2, damageMalusFlat: 2 }), null); // équilibré
  assert.deepEqual(TE.balance({ ...T0(), label: '' }), { cls: 'ko', txt: 'À corriger' });
  assert.deepEqual(TE.balance({ ...T0(), extraDamageFormula: 'xx' }), { cls: 'ko', txt: 'À corriger' });
});

test('applyClick : ajout, retrait, stepper (saut du zéro), segment, toggle, déclencheur', () => {
  const t = T0();
  assert.equal(TE.applyClick({ wfFxadd: 'dg' }, t), true); assert.equal(t.extraDamageFlat, 2);
  assert.equal(TE.applyClick({ wfStep: 'extraDamageFlat', dir: '1', step: '1', min: '1', max: '99', zero: '0' }, t), true); assert.equal(t.extraDamageFlat, 3);
  assert.equal(TE.applyClick({ wfFxrm: 'dg' }, t), true); assert.equal(t.extraDamageFlat, 0);
  // toucher : stepper qui saute 0 (zero=1)
  t.attackModifier = 1;
  TE.applyClick({ wfStep: 'attackModifier', dir: '-1', step: '1', min: '-10', max: '10', zero: '1' }, t);
  assert.equal(t.attackModifier, -1); // 1 → 0 sauté → -1
  assert.equal(TE.applyClick({ wfTrig: 'crit' }, t), true); assert.equal(t.trigger, 'crit');
  assert.equal(TE.applyClick({ wfFxtog: 'allowWithAbilities' }, t), true); assert.equal(t.allowWithAbilities, false);
});

test('la carte et le menu réutilisent les classes .wf-* et les attributs data-wf-*', () => {
  const html = TE.editorHtml({ ...T0(), attackModifier: 2 }, { menuOpen: true });
  assert.ok(html.includes('wf-tq-ed') && html.includes('wf-mods') && html.includes('data-wf-step'));
  assert.ok(html.includes('data-wf-fxmenu') && html.includes('wf-fxm'));
});
