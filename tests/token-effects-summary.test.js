import test from 'node:test';
import assert from 'node:assert/strict';
import { explainTokenStat, summarizeTokenEffects, tokenEffectTone } from '../assets/js/shared/token-effects-summary.js';

test('résume les contraintes issues des états et cumule le déplacement', () => {
  assert.deepEqual(summarizeTokenEffects([
    { effects: { cantAct: true, movementMod: 0, movementBonus: -2, attackBy: 'dis' } },
  ], [
    { type: 'move_debuff', bonus: -1 },
    { type: 'dot' },
  ]), [
    { label: 'Aucune action', tone: 'negative' },
    { label: 'Vitesse 0', tone: 'negative' },
    { label: '−3 cases', tone: 'negative' },
    { label: 'Désavantage à ses attaques', tone: 'negative' },
    { label: 'Subit des dégâts / tour', tone: 'negative' },
  ]);
});

test('résume les avantages sans produire de doublons', () => {
  assert.deepEqual(summarizeTokenEffects([
    { effects: { attackBy: 'adv', attackAgainst: 'dis' } },
    { effects: { attackBy: 'adv' } },
  ], [
    { type: 'regen' }, { type: 'ca' }, { type: 'enchantment' },
  ]), [
    { label: 'Avantage à ses attaques', tone: 'positive' },
    { label: 'Désavantage contre lui', tone: 'positive' },
    { label: 'Régénère / tour', tone: 'positive' },
    { label: 'CA bonifiée', tone: 'positive' },
    { label: 'Arme enchantée', tone: 'positive' },
  ]);
});

test('reste vide sans état ni effet tactique', () => {
  assert.deepEqual(summarizeTokenEffects([], [{ type: 'suspended_spell' }]), []);
});

test('le ton distingue états positifs et effets négatifs ou neutres', () => {
  assert.equal(tokenEffectTone({ kind:'condition', effects:{ attackBy:'adv' } }), 'positive');
  assert.equal(tokenEffectTone({ kind:'condition', effects:{ attackBy:'dis' } }), 'negative');
  assert.equal(tokenEffectTone({ type:'dot' }), 'negative');
  assert.equal(tokenEffectTone({ type:'move_debuff' }), 'negative');
  assert.equal(tokenEffectTone({ type:'affliction' }), 'negative');
  assert.equal(tokenEffectTone({ type:'suspended_spell' }), 'neutral');
  assert.equal(tokenEffectTone({ type:'regen' }), 'positive');
});

test('la provenance recompose toujours exactement la valeur affichée', () => {
  const result = explainTokenStat('move', {
    value: 7,
    conditions: [{ label:'Ralenti', effects:{ movementBonus:-2 } }],
    buffs: [{ type:'move_bonus', label:'Hâte', bonus:3 }],
    manual: 1,
  });
  assert.equal(result.parts.reduce((sum, [delta]) => sum + delta, 0), result.value);
  assert.deepEqual(result.parts, [[5, 'base'], [-2, 'Ralenti'], [3, 'Hâte'], [1, 'manuel']]);
});

test('Empoigné force la vitesse à zéro et reste expliqué', () => {
  const result = explainTokenStat('move', {
    value: 0,
    conditions: [{ label:'Empoigné', effects:{ movementMod:0 } }],
  });
  assert.equal(result.zeroBy, 'Empoigné');
  assert.equal(result.parts.reduce((sum, [delta]) => sum + delta, 0), 0);
});

test('un bonus manuel stocké comme buff ne compte pas deux fois', () => {
  const result = explainTokenStat('ca', {
    value: 14,
    buffs: [{ type:'ca', label:'Bonus du tour', bonus:1, manual:true }],
    manual: 1,
  });
  assert.deepEqual(result.parts, [[13, 'base'], [1, 'manuel']]);
});
