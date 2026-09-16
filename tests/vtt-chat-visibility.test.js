import test from 'node:test';
import assert from 'node:assert/strict';
import { combatTargetResourceVisibility, trackedCombatResourceValues } from '../assets/js/features/vtt/vtt-chat-visibility.js';

test('le MJ et le contrôleur voient les ressources exactes', () => {
  assert.equal(combatTargetResourceVisibility({ isAdmin: true }), 'exact');
  assert.equal(combatTargetResourceVisibility({ token: { type: 'player' }, canControl: true }), 'exact');
});

test('un personnage allié connu conserve ses ressources lisibles', () => {
  assert.equal(combatTargetResourceVisibility({
    target: { characterId: 'character-1' },
    token: { type: 'player' },
  }), 'exact');
});

test('un ennemi utilise seulement l estimation personnelle', () => {
  assert.equal(combatTargetResourceVisibility({
    target: { beastId: 'beast-1' },
    token: { type: 'enemy' },
  }), 'estimate');
});

test('un ennemi reste masqué même si son token est contrôlable', () => {
  assert.equal(combatTargetResourceVisibility({
    target: { beastId: 'beast-1' },
    token: { type: 'enemy', beastId: 'beast-1' },
    canControl: true,
  }), 'estimate');
});

test('un ancien token lié au bestiaire reste masqué même sans type enemy', () => {
  assert.equal(combatTargetResourceVisibility({
    target: { beastId: 'beast-1' },
    token: { type: 'npc', beastId: 'beast-1' },
  }), 'estimate');
});

test('un ancien PNJ hostile non contrôlé ne révèle aucune valeur', () => {
  assert.equal(combatTargetResourceVisibility({
    target: { npcId: 'npc-1' },
    token: { type: 'npc' },
  }), 'hidden');
});

test('sans estimation joueur, les PV restent entièrement inconnus', () => {
  assert.deepEqual(trackedCombatResourceValues({
    tracker: {},
    token: { hp: 99999, pvCombatHp: 99999 },
  }), { current:null, max:null });
});

test('un compteur réel ne peut jamais dépasser l estimation du joueur', () => {
  assert.deepEqual(trackedCombatResourceValues({
    tracker: { pvActuel: 20 },
    token: { hp: 99999, pvCombatHp: 99999 },
    estimateCurrent: 99999,
  }), { current:20, max:20 });
});

test('le suivi estimé connu reste affichable sans utiliser les PV réels', () => {
  assert.deepEqual(trackedCombatResourceValues({
    tracker: { pvActuel: 20 },
    token: { hp: 99999, pvCombatHp: 99999 },
    estimateCurrent: 7,
  }), { current:7, max:20 });
});

test('un ancien compteur sans provenance est ignoré même sous le maximum estimé', () => {
  assert.deepEqual(trackedCombatResourceValues({
    tracker: { pvActuel: 20 },
    token: { hp: 13, pvCombatHp: 13 },
  }), { current:20, max:20 });
});
