import test from 'node:test';
import assert from 'node:assert/strict';
import {
  combatStyleAttackModifiers,
  nearestHostileDistance,
  normalizeCombatStyle,
} from '../assets/js/shared/combat-styles.js';

test('les anciennes descriptions explicites restent compatibles', () => {
  const style = normalizeCombatStyle({
    label: 'Main libre',
    description: "Attaque d'opportunité possible. Désavantage à distance si une cible est au CaC.",
  });
  assert.equal(style.rules.opportunityAttack, 'allow');
  assert.equal(style.rules.contactAttackMode, 'disadvantage');
  assert.equal(style.rules.contactAttackScope, 'ranged');
});

test('le désavantage de contact ne touche par défaut que les attaques à distance', () => {
  const style = { label: 'Archer', rules: { contactAttackMode: 'disadvantage', contactDistance: 1 } };
  assert.equal(combatStyleAttackModifiers(style, { distance: 1, isMeleeAttack: false }).hasDis, true);
  assert.equal(combatStyleAttackModifiers(style, { distance: 1, isMeleeAttack: true }).hasDis, false);
  assert.equal(combatStyleAttackModifiers(style, { distance: 2, isMeleeAttack: false }).hasDis, false);
  assert.equal(combatStyleAttackModifiers(style, { distance: null, isMeleeAttack: false }).hasDis, false);
});

test('un style peut appliquer sa règle de contact à toutes les attaques', () => {
  const result = combatStyleAttackModifiers({
    label: 'Encombré',
    rules: { contactAttackMode: 'disadvantage', contactAttackScope: 'all', contactDistance: 2 },
  }, { distance: 2, isMeleeAttack: true });
  assert.equal(result.hasDis, true);
});

test('un soin à distance subit aussi la gêne causée par un ennemi au contact', () => {
  const result = combatStyleAttackModifiers({
    label: 'Archer',
    rules: { contactAttackMode: 'disadvantage', contactAttackScope: 'ranged', contactDistance: 1 },
  }, { distance: 1, isMeleeAttack: false, isHealingAction: true });
  assert.equal(result.hasDis, true);
  assert.match(result.reasons[0], /soin/);
});

test('la gêne vient de l ennemi autour du lanceur, pas de la cible choisie', () => {
  const source = { id: 'hero', type: 'player', pageId: 'scene', col: 5 };
  const allyTarget = { id: 'ally', type: 'player', pageId: 'scene', col: 12 };
  const adjacentEnemy = { id: 'enemy', type: 'enemy', pageId: 'scene', col: 6 };
  const distance = nearestHostileDistance(
    source,
    [source, allyTarget, adjacentEnemy],
    (a, b) => Math.abs(a.col - b.col),
  );
  assert.equal(distance, 1);
});

test('un ennemi présent mais hors du corps-à-corps ne donne aucun désavantage', () => {
  const style = { label: 'Archer', rules: { contactAttackMode: 'disadvantage', contactDistance: 1 } };
  const source = { id: 'hero', type: 'player', pageId: 'scene', col: 2, row: 2 };
  const distantEnemy = { id: 'enemy', type: 'enemy', pageId: 'scene', col: 8, row: 2 };
  const distance = nearestHostileDistance(
    source,
    [source, distantEnemy],
    (a, b) => Math.max(Math.abs(a.col - b.col), Math.abs(a.row - b.row)),
  );

  assert.equal(distance, 6);
  assert.equal(combatStyleAttackModifiers(style, { distance, isMeleeAttack: false }).hasDis, false);
});

test('aucun ennemi détecté ne peut pas être interprété comme une distance zéro', () => {
  const style = { label: 'Archer', rules: { contactAttackMode: 'disadvantage', contactDistance: 1 } };
  const source = { id: 'hero', type: 'player', pageId: 'scene', col: 2, row: 2 };
  const distance = nearestHostileDistance(source, [source], () => 0);

  assert.equal(distance, null);
  assert.equal(combatStyleAttackModifiers(style, { distance, isMeleeAttack: false }).hasDis, false);
});
