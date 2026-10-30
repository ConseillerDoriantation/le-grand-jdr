import test from 'node:test';
import assert from 'node:assert/strict';
import { DICE_SKILLS_DEFAULT, normalizeDiceSkills } from '../assets/js/shared/dice-skills.js';
import {
  buildDiceSkillMigrations,
  completeDiceSkills,
  migrateSkillBonusesInItem,
  migrateSkillMap,
  sortDiceSkills,
  suggestDiceSkillStat,
} from '../assets/js/shared/dice-skills-admin.js';

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

test('la suggestion de caractéristique ignore les accents et accepte une correspondance partielle', () => {
  assert.equal(suggestDiceSkillStat('Équitation'), 'DEX');
  assert.equal(suggestDiceSkillStat('Navigation maritime'), 'SAG');
  assert.equal(suggestDiceSkillStat('Intelligence'), 'INT');
  assert.equal(suggestDiceSkillStat('Inconnue'), null);
});

test('les tris par caractéristique et compétences pures restent stables', () => {
  const skills = [
    { id: 'a', name: 'Survie', stat: 'SAG' },
    { id: 'b', name: 'Force', stat: 'FOR' },
    { id: 'c', name: 'Athlétisme', stat: 'FOR' },
    { id: 'd', name: 'Combat', stat: '' },
    { id: 'e', name: 'Dextérité', stat: 'DEX' },
  ];
  assert.deepEqual(sortDiceSkills(skills, 'stat').map(skill => skill.id), ['b', 'c', 'e', 'a', 'd']);
  assert.deepEqual(sortDiceSkills(skills, 'pure').map(skill => skill.id), ['b', 'e', 'a', 'c', 'd']);
});

test('compléter ajoute uniquement les compétences par défaut manquantes', () => {
  const completed = completeDiceSkills([
    { name: 'Perception', stat: 'FOR' },
    { name: 'Pilotage', stat: 'DEX' },
  ]);
  assert.equal(completed.filter(skill => skill.name === 'Perception').length, 1);
  assert.equal(completed.find(skill => skill.name === 'Perception').stat, 'FOR');
  assert.equal(completed.filter(skill => skill.name === 'Pilotage').length, 1);
  assert.equal(completed.length, DICE_SKILLS_DEFAULT.length + 1);
});

test('renommage et suppression migrent les formations et bonus par nom', () => {
  const saved = [
    { id: 'a', name: 'Crochetage', stat: 'DEX' },
    { id: 'b', name: 'Religion', stat: 'INT' },
  ];
  const draft = [{ id: 'a', name: 'Serrurerie', stat: 'DEX' }];
  const migrations = buildDiceSkillMigrations(saved, draft);

  assert.deepEqual(migrateSkillMap({ Crochetage: 'expert', Religion: 'forme', Survie: 'forme' }, migrations).value, {
    Serrurerie: 'expert',
    Survie: 'forme',
  });
  assert.deepEqual(migrateSkillBonusesInItem({
    nom: 'Outils fins',
    skillBonuses: { Crochetage: 2, Religion: 1, Survie: 1 },
  }, migrations).value.skillBonuses, {
    Serrurerie: 2,
    Survie: 1,
  });
});
