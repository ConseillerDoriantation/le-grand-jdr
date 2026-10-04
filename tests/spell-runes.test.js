import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runeCount, calcSpellTargets, calcSpellDuration, getProtectionRestoreMode, getProtectionModes, protectionRunesFor, getAfflictionMode, getAfflictionEtatId, spellConditionId, affordableSpellConditionId, enchantStatesWithinRunes, withElementWeaknesses, isLightSpell, lightSpellRadius, protectionSplitAllowed, isProtectionMultiMode, resolveSpellModifierStat, usesHealingMastery, usesSpellMastery } from '../assets/js/shared/spell-runes.js';

const sort = (runes = [], extra = {}) => ({ runes, ...extra });

test('runeCount compte les occurrences d’une rune', () => {
  assert.equal(runeCount(sort(['Puissance', 'Puissance', 'Durée']), 'Puissance'), 2);
  assert.equal(runeCount(sort([]), 'Puissance'), 0);
  assert.equal(runeCount({}, 'Puissance'), 0);
});

test('la maîtrise reste active par défaut et se désactive explicitement', () => {
  assert.equal(usesSpellMastery({}), true, 'rétrocompatibilité des anciens sorts');
  assert.equal(usesSpellMastery({ maitriseActive: true }), true);
  assert.equal(usesSpellMastery({ maitriseActive: false }), false);
});

test('une statistique explicitement désactivée ne retombe pas sur celle de l’arme', () => {
  assert.equal(resolveSpellModifierStat({}, 'degatsStat', 'intelligence'), 'intelligence');
  assert.equal(resolveSpellModifierStat({ degatsStat: 'force' }, 'degatsStat', 'intelligence'), 'force');
  assert.equal(resolveSpellModifierStat({ degatsStat: 'none' }, 'degatsStat', 'intelligence'), null);
});

test('les anciennes valeurs « aucun modificateur » ne deviennent pas une fausse statistique', () => {
  assert.equal(resolveSpellModifierStat({ degatsStat: 'non' }, 'degatsStat', 'intelligence'), null);
  assert.equal(resolveSpellModifierStat({ degatsStat: 'aucune' }, 'degatsStat', 'force'), null);
  assert.equal(resolveSpellModifierStat({ degatsStat: 'inconnue' }, 'degatsStat', 'dexterite'), 'dexterite');
});

test('la maîtrise de soin exige un noyau magique et une statistique active', () => {
  assert.equal(usesHealingMastery({}, true, 'intelligence'), true);
  assert.equal(usesHealingMastery({}, false, 'constitution'), false, 'soin physique');
  assert.equal(usesHealingMastery({}, true, ''), false, 'statistique absente');
  assert.equal(usesHealingMastery({}, true, 'none'), false, 'soin sans modificateur');
  assert.equal(usesHealingMastery({ maitriseActive: false }, true, 'intelligence'), false);
});

test('Protection conserve son soin de zone même sans type défensif', () => {
  const zoneHeal = sort(['Protection', 'Dispersion', 'Amplification'], {
    protectionMode: 'soin',
    types: ['utilitaire'],
  });
  assert.equal(getProtectionRestoreMode(zoneHeal), 'soin');
  assert.equal(getProtectionRestoreMode({ ...zoneHeal, protectionMode: 'mana' }), 'mana');
  assert.equal(getProtectionRestoreMode({ ...zoneHeal, protectionMode: 'ca' }), null);
  assert.equal(getProtectionRestoreMode(sort(['Dispersion', 'Amplification'], { protectionMode: 'soin' })), null);
});

test('calcSpellTargets : Dispersion pilote le nombre de cibles (1 + nbDisp)', () => {
  assert.equal(calcSpellTargets(sort([])), 1, 'aucune rune → 1 cible');
  assert.equal(calcSpellTargets(sort(['Dispersion'])), 2);
  assert.equal(calcSpellTargets(sort(['Dispersion', 'Dispersion'])), 3);
});

test('calcSpellTargets : Dispersion = nombre de poses (modèle zones v2)', () => {
  // v2 : Amplification pilote la TAILLE, Dispersion RÉPÈTE la zone → 1 + nDisp poses.
  assert.equal(calcSpellTargets(sort(['Amplification', 'Dispersion'])), 2);
  assert.equal(calcSpellTargets(sort(['Amplification', 'Dispersion', 'Dispersion'])), 3);
  // Sentinelle (Affliction + Invocation) + Dispersion → 1 (une sentinelle porte l'effet)
  assert.equal(calcSpellTargets(sort(['Affliction', 'Invocation', 'Dispersion'])), 1);
});

test('calcSpellTargets : Enchantement/Affliction seuls n’ajoutent pas de cible', () => {
  assert.equal(calcSpellTargets(sort(['Enchantement', 'Enchantement'])), 1);
  assert.equal(calcSpellTargets(sort(['Affliction', 'Affliction', 'Affliction'])), 1);
});

test('calcSpellDuration : base 2 tours, +2 par rune Durée', () => {
  assert.equal(calcSpellDuration(sort([])), 2);
  assert.equal(calcSpellDuration(sort(['Durée'])), 4);
  assert.equal(calcSpellDuration(sort(['Durée', 'Durée'])), 6);
});

test('calcSpellDuration : dureeBase explicite (≥ 2) sert de base', () => {
  assert.equal(calcSpellDuration(sort([], { dureeBase: 3 })), 3);
  assert.equal(calcSpellDuration(sort(['Durée'], { dureeBase: 3 })), 5);
  // dureeBase < 2 est ignoré (retombe sur 2)
  assert.equal(calcSpellDuration(sort([], { dureeBase: 1 })), 2);
});

test('les sorts classiques gardent une cible logique même avec une zone', () => {
  assert.equal(calcSpellTargets({ designMode: 'classic', zoneW: 5, zoneH: 3 }), 1);
});

test('les sorts classiques utilisent leur durée exacte, instantané inclus', () => {
  assert.equal(calcSpellDuration({ designMode: 'classic', classicDuration: 0 }), 0);
  assert.equal(calcSpellDuration({ designMode: 'classic', classicDuration: 3 }), 3);
  assert.equal(calcSpellDuration({ designMode: 'classic', dureeBase: 6 }), 6);
});

test('Protection multi-modes : un mode par rune, défaut = renforcer le mode principal', () => {
  const two = sort(['Protection', 'Protection'], { types: ['defensif'], protectionMode: 'soin' });
  assert.deepEqual(getProtectionModes(two), ['soin', 'soin']);
  assert.equal(isProtectionMultiMode(two), false);
  const mixed = { ...two, protectionModes: ['soin', 'ca'] };
  assert.deepEqual(getProtectionModes(mixed), ['soin', 'ca']);
  assert.equal(protectionRunesFor(mixed, 'soin'), 1);
  assert.equal(protectionRunesFor(mixed, 'ca'), 1);
  assert.equal(getProtectionRestoreMode(mixed), 'soin');
  assert.equal(getProtectionRestoreMode({ ...two, protectionModes: ['ca', 'reduction'] }), null);
});

test('Protection multi-modes : un sort mono-mode garde toutes ses runes (compat)', () => {
  const ca = sort(['Protection', 'Protection', 'Protection'], { types: ['defensif'], protectionMode: 'ca' });
  assert.equal(protectionRunesFor(ca, 'ca'), 3);
  assert.equal(protectionRunesFor(ca, 'soin'), 3, 'historique : le calcul de soin voyait toutes les runes');
});

test('Protection multi-modes : Soin et PM s\'excluent (un seul jet de restauration)', () => {
  const s = sort(['Protection', 'Protection'], { types: ['defensif'], protectionModes: ['soin', 'mana'] });
  assert.deepEqual(getProtectionModes(s), ['soin', 'soin']);
});

test('Protection multi-modes : coupée quand un combo absorbe Protection', () => {
  const base = { protectionModes: ['soin', 'ca'], protectionMode: 'soin' };
  assert.equal(protectionSplitAllowed(sort(['Protection', 'Protection'], { ...base, types: ['offensif'] })), false, 'Drain');
  assert.equal(protectionSplitAllowed(sort(['Protection', 'Affliction'], base)), false, 'Régénération');
  assert.equal(protectionSplitAllowed(sort(['Protection', 'Déclenchement'], { ...base, actionMode: 'reaction' })), false, 'Bouclier réactif');
  assert.equal(protectionSplitAllowed(sort(['Protection', 'Déclenchement'], { ...base, actionMode: 'action_bonus' })), true);
  assert.deepEqual(getProtectionModes(sort(['Protection', 'Protection', 'Affliction'], base)), ['soin', 'soin']);
});

test('Affliction Faiblesse : ancien mode lu comme l’état « faiblesse »', () => {
  const legacy = sort(['Affliction'], { afflictionMode: 'faiblesse' });
  assert.equal(getAfflictionMode(legacy), 'etat');
  assert.equal(getAfflictionEtatId(legacy), 'faiblesse');
  const etat = sort(['Affliction'], { afflictionMode: 'etat', afflictionEtatId: 'stunned' });
  assert.equal(getAfflictionMode(etat), 'etat');
  assert.equal(getAfflictionEtatId(etat), 'stunned');
  assert.equal(getAfflictionMode(sort(['Affliction'])), 'dot');
});

test('États retirés des sorts : redirigés vers l’état qui les absorbe', () => {
  assert.equal(getAfflictionEtatId(sort(['Affliction'], { afflictionMode: 'etat', afflictionEtatId: 'incapacitated' })), 'stunned');
  assert.equal(spellConditionId('grappled'), 'restrained');
  assert.equal(spellConditionId('frightened'), 'frightened');
  assert.equal(spellConditionId('paralyzed'), 'paralyzed');
  assert.equal(spellConditionId('rage'), 'rage');
  assert.equal(spellConditionId(''), '');
});

test('états à 2 runes : Affliction retombe sur la version 1 rune, Enchantement respecte le total', () => {
  assert.equal(affordableSpellConditionId('paralyzed', 1, 2), 'stunned');
  assert.equal(affordableSpellConditionId('paralyzed', 2, 2), 'paralyzed');
  assert.equal(affordableSpellConditionId('marked', 1, 1), 'marked');
  assert.equal(affordableSpellConditionId('mystere', 1, 2), '');
  const cost = id => (id === 'invisible' || id === 'rage' ? 2 : 1);
  assert.deepEqual(enchantStatesWithinRunes(['invisible', 'guided'], 2, cost), ['invisible']);
  assert.deepEqual(enchantStatesWithinRunes(['invisible', 'guided'], 3, cost), ['invisible', 'guided']);
  assert.deepEqual(enchantStatesWithinRunes(['rage'], 1, cost), []);
  assert.deepEqual(enchantStatesWithinRunes(['guided', 'swift', 'chanceux'], 2, cost), ['guided', 'swift']);
});

test('Faiblesse d\'élément : ×2, annule une résistance, ne perce pas une immunité', () => {
  assert.equal(withElementWeaknesses(null, []), null);
  assert.deepEqual(withElementWeaknesses(null, ['feu']).faiblesses, ['feu']);
  const resist = withElementWeaknesses({ resistances: ['feu', 'eau'] }, ['feu']);
  assert.deepEqual(resist.resistances, ['eau']);
  assert.deepEqual(resist.faiblesses, [], 'résistance + faiblesse = dégâts normaux');
  const immune = withElementWeaknesses({ immunites: ['feu'] }, ['feu']);
  assert.deepEqual(immune.immunites, ['feu'], 'l\'immunité reste prioritaire');
});

test('Lumière : élément lumineux + Concentration, sans rune d\'effet', () => {
  const light = sort(['Concentration', 'Amplification']);
  assert.equal(isLightSpell(light, true), true);
  assert.equal(isLightSpell(light, false), false, 'élément non lumineux');
  assert.equal(isLightSpell(sort(['Amplification']), true), false, 'Concentration requise');
  assert.equal(isLightSpell(sort(['Concentration', 'Affliction']), true), false, 'brûlure : reste un sort de brûlure');
  assert.equal(isLightSpell(sort(['Concentration', 'Puissance']), true), false);
  assert.equal(isLightSpell(sort(['Concentration', 'Durée']), true), true);
  assert.equal(lightSpellRadius(sort(['Concentration'])), 3);
  assert.equal(lightSpellRadius(light), 5);
});
