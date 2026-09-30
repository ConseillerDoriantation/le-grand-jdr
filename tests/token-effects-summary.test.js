import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeTokenEffects } from '../assets/js/shared/token-effects-summary.js';

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
