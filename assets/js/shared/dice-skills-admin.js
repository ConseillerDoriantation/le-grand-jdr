import { DICE_SKILLS_DEFAULT } from './dice-skills.js';

export const DICE_SKILL_STATS = [
  { key: 'FOR', label: 'Force', color: '#ef4444' },
  { key: 'DEX', label: 'Dextérité', color: '#22c38e' },
  { key: 'CON', label: 'Constitution', color: '#f59e0b' },
  { key: 'INT', label: 'Intelligence', color: '#4f8cff' },
  { key: 'SAG', label: 'Sagesse', color: '#b47fff' },
  { key: 'CHA', label: 'Charisme', color: '#ec4899' },
  { key: '', label: 'Libre', color: '#7a8fa8' },
];

export const DICE_SKILL_SUGGESTIONS = {
  crochetage:'DEX', escalade:'FOR', natation:'FOR', saut:'FOR', endurance:'CON',
  concentration:'CON', resistance:'CON', pilotage:'DEX', equitation:'DEX',
  'vol a la tire':'DEX', escamotage:'DEX', artisanat:'INT', alchimie:'INT',
  linguistique:'INT', ingenierie:'INT', occultisme:'INT', navigation:'SAG',
  pistage:'SAG', cuisine:'SAG', intuition:'SAG', musique:'CHA', marchandage:'CHA',
  seduction:'CHA', commandement:'CHA', jeu:'CHA', religion:'INT', dressage:'SAG',
  force:'FOR', dexterite:'DEX', constitution:'CON', intelligence:'INT',
  sagesse:'SAG', charisme:'CHA',
};

export function diceSkillKey(value = '') {
  return String(value).toLocaleLowerCase('fr').normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();
}

const DEFAULT_STATS = Object.fromEntries(DICE_SKILLS_DEFAULT.map(skill => [diceSkillKey(skill.name), skill.stat]));
const CHARACTERISTIC_NAMES = Object.fromEntries(
  DICE_SKILL_STATS.filter(stat => stat.key).map(stat => [diceSkillKey(stat.label), stat.key]),
);

export function characteristicForSkillName(name) {
  return CHARACTERISTIC_NAMES[diceSkillKey(name)] || '';
}

export function suggestDiceSkillStat(name) {
  const key = diceSkillKey(name);
  if (!key) return null;
  if (Object.prototype.hasOwnProperty.call(DEFAULT_STATS, key)) return DEFAULT_STATS[key];
  if (Object.prototype.hasOwnProperty.call(DICE_SKILL_SUGGESTIONS, key)) return DICE_SKILL_SUGGESTIONS[key];
  const hits = Object.keys(DICE_SKILL_SUGGESTIONS)
    .filter(candidate => key.includes(candidate))
    .sort((a, b) => b.length - a.length);
  return hits.length ? DICE_SKILL_SUGGESTIONS[hits[0]] : null;
}

const COLLATOR = new Intl.Collator('fr', { sensitivity: 'base' });
const statIndex = stat => DICE_SKILL_STATS.findIndex(item => item.key === stat);

export function sortDiceSkills(skills = [], mode = 'az') {
  const indexed = skills.map((skill, index) => ({ skill: { ...skill }, index }));
  if (mode === 'az') indexed.sort((a, b) => COLLATOR.compare(a.skill.name, b.skill.name));
  if (mode === 'stat') indexed.sort((a, b) => (statIndex(a.skill.stat) - statIndex(b.skill.stat)) || (a.index - b.index));
  if (mode === 'pure') indexed.sort((a, b) => {
    const pureA = characteristicForSkillName(a.skill.name) ? 0 : 1;
    const pureB = characteristicForSkillName(b.skill.name) ? 0 : 1;
    return (pureA - pureB) || (a.index - b.index);
  });
  return indexed.map(entry => entry.skill);
}

export function completeDiceSkills(skills = []) {
  const names = new Set(skills.map(skill => diceSkillKey(skill.name)));
  return [
    ...skills.map(skill => ({ ...skill })),
    ...DICE_SKILLS_DEFAULT.filter(skill => !names.has(diceSkillKey(skill.name))).map(skill => ({ ...skill })),
  ];
}

export function buildDiceSkillMigrations(saved = [], draft = []) {
  return saved.flatMap(oldSkill => {
    const current = draft.find(skill => skill.id === oldSkill.id);
    if (!current) return [{ from: oldSkill.name, to: '' }];
    const next = String(current.name || '').trim();
    return next !== oldSkill.name ? [{ from: oldSkill.name, to: next }] : [];
  });
}

function mergeSkillValue(existing, incoming) {
  if (existing == null) return incoming;
  const a = Number(existing);
  const b = Number(incoming);
  return Number.isFinite(a) && Number.isFinite(b) ? a + b : existing;
}

export function migrateSkillMap(source, migrations = [], { merge = false } = {}) {
  if (!source || Array.isArray(source) || typeof source !== 'object') return { value: source, changed: false };
  const byKey = new Map(migrations.map(change => [diceSkillKey(change.from), change]));
  let changed = false;
  const value = {};
  Object.entries(source).forEach(([name, current]) => {
    const change = byKey.get(diceSkillKey(name));
    if (!change) { value[name] = current; return; }
    changed = true;
    if (!change.to) return;
    value[change.to] = merge ? mergeSkillValue(value[change.to], current) : (value[change.to] ?? current);
  });
  return { value: changed ? value : source, changed };
}

export function migrateSkillBonusesInItem(item, migrations = []) {
  if (!item || typeof item !== 'object') return { value: item, changed: false };
  const migrated = migrateSkillMap(item.skillBonuses, migrations, { merge: true });
  return migrated.changed
    ? { value: { ...item, skillBonuses: migrated.value }, changed: true }
    : { value: item, changed: false };
}

export function migrateSkillBonusesInItems(items, migrations = []) {
  if (!Array.isArray(items)) return { value: items, changed: false };
  let changed = false;
  const value = items.map(item => {
    const migrated = migrateSkillBonusesInItem(item, migrations);
    changed ||= migrated.changed;
    return migrated.value;
  });
  return { value: changed ? value : items, changed };
}

export function migrateSkillBonusesInEquipment(equipment, migrations = []) {
  if (!equipment || Array.isArray(equipment) || typeof equipment !== 'object') return { value: equipment, changed: false };
  let changed = false;
  const value = Object.fromEntries(Object.entries(equipment).map(([slot, item]) => {
    const migrated = migrateSkillBonusesInItem(item, migrations);
    changed ||= migrated.changed;
    return [slot, migrated.value];
  }));
  return { value: changed ? value : equipment, changed };
}
