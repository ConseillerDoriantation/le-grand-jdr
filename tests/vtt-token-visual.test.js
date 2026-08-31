import test from 'node:test';
import assert from 'node:assert/strict';

import {
  tokenActiveEffects,
  tokenDeltaMeta,
  tokenDetailLevel,
  tokenEffectsSignature,
  tokenHealthMeta,
  tokenFootprintMeta,
  tokenMovementMeta,
  tokenRelationTone,
  normalizeTokenTurnOrder,
} from '../assets/js/features/vtt/vtt-token-visual.js';

test('l’empreinte tactique distingue un portrait rond d’un token 3×3', () => {
  assert.deepEqual(tokenFootprintMeta(3, 3), {
    width: 3, height: 3, isLarge: true, label: '3×3',
  });
  assert.equal(tokenFootprintMeta(1, 1).isLarge, false);
  assert.deepEqual(tokenFootprintMeta(99, 0), {
    width: 5, height: 1, isLarge: true, label: '5×1',
  });
});

test('la santé d’un token distingue état inconnu, blessure et mise à terre', () => {
  assert.equal(tokenHealthMeta(null, null).tone, 'unknown');
  assert.equal(tokenHealthMeta(80, 100).tone, 'healthy');
  assert.equal(tokenHealthMeta(50, 100).tone, 'wounded');
  assert.equal(tokenHealthMeta(20, 100).tone, 'critical');
  assert.deepEqual(
    { label: tokenHealthMeta(0, 100).label, down: tokenHealthMeta(0, 100).isDown },
    { label: 'À terre', down: true },
  );
});

test('le rail fusionne états et effets actifs avec leur durée restante', () => {
  const token = {
    conditions: [
      { id: 'ralenti', expiresAtRound: 4 },
      { id: 'expire', expiresAtRound: 2 },
    ],
    buffs: [{ type: 'regen', sortLabel: 'Sève vitale', expiresAtRound: 5 }],
  };
  const effects = tokenActiveEffects(token, {
    ralenti: { icon: '🐌', color: '#38bdf8', label: 'Ralenti' },
    expire: { icon: '×', label: 'Expiré' },
  }, 3);

  assert.deepEqual(effects.map(effect => effect.label), ['Ralenti', 'Régénération']);
  assert.deepEqual(effects.map(effect => effect.turnsLeft), [2, 3]);
  assert.match(tokenEffectsSignature(effects), /condition:ralenti/);
  assert.match(tokenEffectsSignature(effects), /buff:regen/);
  assert.deepEqual(effects.map(effect => effect.tone), ['negative', 'positive']);
});

test('le niveau de détail suit le zoom sans masquer les ressources graphiques', () => {
  assert.equal(tokenDetailLevel(0.45), 'compact');
  assert.equal(tokenDetailLevel(0.7), 'standard');
  assert.equal(tokenDetailLevel(0.85), 'detailed');
  assert.equal(tokenDetailLevel(1), 'detailed');
});

test('le ciblage distingue allié, adversaire et action amicale', () => {
  const player = { type: 'player' };
  assert.equal(tokenRelationTone(player, { type: 'npc' }), 'friendly');
  assert.equal(tokenRelationTone(player, { type: 'enemy' }), 'hostile');
  assert.equal(tokenRelationTone(player, { type: 'enemy' }, true), 'friendly');
});

test('les variations de ressources produisent un libellé court et cohérent', () => {
  assert.deepEqual(
    { label:tokenDeltaMeta(-12, 'hp').label, color:tokenDeltaMeta(-12, 'hp').color },
    { label:'−12 PV', color:'#fb7185' },
  );
  assert.equal(tokenDeltaMeta(3, 'pm').label, '+3 PM');
  assert.equal(tokenDeltaMeta(0, 'hp'), null);
});

test('le mouvement restant tient compte de la course et ne devient jamais négatif', () => {
  assert.deepEqual(tokenMovementMeta(6, 6, 8), { maximum:12, used:8, remaining:4, exhausted:false });
  assert.deepEqual(tokenMovementMeta(6, 0, 9), { maximum:6, used:9, remaining:0, exhausted:true });
});

test('l’ordre de passage reste stable, élimine les doublons et ajoute les nouveaux tokens', () => {
  const tokens=[
    {id:'enemy',type:'enemy',name:'Ogre'},
    {id:'alice',type:'player',name:'Alice'},
    {id:'bob',type:'player',name:'Bob'},
  ];
  assert.deepEqual(normalizeTokenTurnOrder(['bob','missing','bob'],tokens), ['bob','alice','enemy']);
  assert.deepEqual(normalizeTokenTurnOrder([],tokens), ['alice','bob','enemy']);
});
