import test from 'node:test';
import assert from 'node:assert/strict';
import { DICE_SKILLS_DEFAULT, normalizeDiceSkills } from '../assets/js/shared/dice-skills.js';

test('le catalogue de l aventure conserve tous les jets et leur ordre', () => {
  const skills = normalizeDiceSkills([
    { name: 'Navigation', stat: 'sag' },
    { name: 'Force', stat: 'for' },
    { name: 'Combat', stat: '' },
    { name: 'Alchimie', stat: 'int' },
  ]);

  assert.deepEqual(skills.map(skill => skill.name), ['Navigation', 'Force', 'Combat', 'Alchimie']);
  assert.deepEqual(skills.map(skill => skill.stat), ['SAG', 'FOR', '', 'INT']);
});

test('un catalogue vide reste vide et un document absent utilise les valeurs par défaut', () => {
  assert.deepEqual(normalizeDiceSkills([]), []);
  assert.deepEqual(normalizeDiceSkills(null), DICE_SKILLS_DEFAULT);
});

test('les doublons de nom sont ignorés sans réordonner le catalogue', () => {
  const skills = normalizeDiceSkills([
    { name: 'Perception', stat: 'SAG' },
    { name: ' perception ', stat: 'INT' },
    { nom: 'Pilotage', stat: 'dex' },
  ]);

  assert.deepEqual(skills, [
    { name: 'Perception', stat: 'SAG' },
    { nom: 'Pilotage', name: 'Pilotage', stat: 'DEX' },
  ]);
});
