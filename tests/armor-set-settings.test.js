import test from 'node:test';
import assert from 'node:assert/strict';

import { getArmorSetChipText, getArmorSetData, normalizeArmorType, getCharFullDamageProfile } from '../assets/js/shared/equipment-utils.js';
import { LEGACY_EQUIPMENT_SLOTS, setEquipmentSlotsForTests } from '../assets/js/shared/equipment-slots.js';
import { DEFAULT_ARMOR_SETS, LEGACY_ARMOR_SETS, getArmorTypeOptions, setArmorSetSettingsForTests } from '../assets/js/shared/armor-set-settings.js';

test('armor set : Le Grand JDR active le set léger sur tous les slots armure', () => {
  setEquipmentSlotsForTests(LEGACY_EQUIPMENT_SLOTS);
  setArmorSetSettingsForTests(LEGACY_ARMOR_SETS);

  const data = getArmorSetData({
    equipement: {
      'Tête': { nom: 'Capuche', typeArmure: 'Légère' },
      Torse: { nom: 'Robe', typeArmure: 'Légère' },
      Bottes: { nom: 'Bottes souples', typeArmure: 'Légère' },
      Anneau: { nom: 'Anneau', typeArmure: 'Lourde' },
    },
  });

  assert.equal(data.isActive, true);
  assert.equal(data.fullType, 'Légère');
  assert.equal(data.modifiers.spellPmDelta, -2);
  assert.equal(data.modifiers.toucherBonus, 0);
});

test('armor set : un type mixte ou incomplet ne donne aucun bonus', () => {
  setEquipmentSlotsForTests(LEGACY_EQUIPMENT_SLOTS);
  setArmorSetSettingsForTests(LEGACY_ARMOR_SETS);

  const mixed = getArmorSetData({
    equipement: {
      'Tête': { nom: 'Capuche', typeArmure: 'Légère' },
      Torse: { nom: 'Plastron', typeArmure: 'Intermédiaire' },
      Bottes: { nom: 'Bottes', typeArmure: 'Légère' },
    },
  });
  assert.equal(mixed.isActive, false);
  assert.equal(mixed.mixed, true);

  const incomplete = getArmorSetData({
    equipement: {
      'Tête': { nom: 'Capuche', typeArmure: 'Légère' },
      Torse: { nom: 'Robe', typeArmure: 'Légère' },
    },
  });
  assert.equal(incomplete.isActive, false);
  assert.equal(incomplete.isComplete, false);
});

test('armor set B : un palier partiel s’applique sans set complet, une autre pièce ne casse pas', () => {
  setEquipmentSlotsForTests(LEGACY_EQUIPMENT_SLOTS); // 3 emplacements d'armure
  setArmorSetSettingsForTests([
    { id: 'lourd', type: 'Lourde', enabled: true, cumulative: true, tiers: [
      { pieces: 2, effects: [{ kind: 'toucher', value: 2 }] },
      { pieces: 3, effects: [{ kind: 'dr', value: 2 }] },
    ] },
  ]);
  // 2 pièces Lourde + 1 autre type : le palier 2 est atteint (la pièce d'un
  // autre type ne casse plus le set), le palier 3 non.
  const partial = getArmorSetData({ equipement: {
    'Tête': { nom: 'Casque', typeArmure: 'Lourde' },
    Torse: { nom: 'Plastron', typeArmure: 'Lourde' },
    Bottes: { nom: 'Bottes légères', typeArmure: 'Légère' },
  } });
  assert.equal(partial.isActive, true);
  assert.equal(partial.modifiers.toucherBonus, 2);
  assert.equal(partial.modifiers.damageReduction, 0);
  assert.equal(getArmorSetChipText(partial), 'Lourde : Toucher +2');
  assert.doesNotMatch(getArmorSetChipText(partial), /Dégâts subis/);

  // 3 pièces Lourde : les deux paliers cumulés s'appliquent.
  const full = getArmorSetData({ equipement: {
    'Tête': { nom: 'Casque', typeArmure: 'Lourde' },
    Torse: { nom: 'Plastron', typeArmure: 'Lourde' },
    Bottes: { nom: 'Grèves', typeArmure: 'Lourde' },
  } });
  assert.equal(full.modifiers.toucherBonus, 2);
  assert.equal(full.modifiers.damageReduction, 2);
  assert.equal(getArmorSetChipText(full, { includeNames: false }), 'Toucher +2 · Dégâts subis -2');
});

test('armor set B : les nouveaux effets (ca/dmg/move/save/resist) sont agrégés', () => {
  setEquipmentSlotsForTests(LEGACY_EQUIPMENT_SLOTS);
  setArmorSetSettingsForTests([
    { id: 'plaque', type: 'Plaque', enabled: true, cumulative: true, tiers: [{ pieces: 2, effects: [
      { kind: 'ca', value: 2 },
      { kind: 'dmg', value: 1 },
      { kind: 'move', value: 1.5 },
      { kind: 'save', stat: 'constitution', value: 2 },
      { kind: 'resist', element: 'feu' },
    ] }] },
  ]);
  const data = getArmorSetData({ equipement: {
    'Tête': { nom: 'Heaume', typeArmure: 'Plaque' },
    Torse: { nom: 'Plastron', typeArmure: 'Plaque' },
  } });
  assert.equal(data.isActive, true);
  assert.equal(data.modifiers.caBonus, 2);
  assert.equal(data.modifiers.damageBonus, 1);
  assert.equal(data.modifiers.moveDelta, 1.5);
  assert.equal(data.modifiers.saveBonus.constitution, 2);
  assert.deepEqual(data.modifiers.resistances, ['feu']);
  assert.equal(getArmorSetChipText(data, { includeNames: false }), 'CA +2 · Dégâts +1 · Déplacement +1,5 m · Sauvegarde Constitution +2 · Résistance feu');
});

test('armor set B : les effets soin et plage de critique sont agrégés (cumulés)', () => {
  setEquipmentSlotsForTests(LEGACY_EQUIPMENT_SLOTS);
  setArmorSetSettingsForTests([
    { id: 'beni', type: 'Béni', enabled: true, cumulative: true, tiers: [
      { pieces: 1, effects: [{ kind: 'heal', value: 2 }] },
      { pieces: 2, effects: [{ kind: 'heal', value: 1 }, { kind: 'crit', value: 1 }] },
    ] },
  ]);
  const data = getArmorSetData({ equipement: {
    'Tête': { nom: 'Heaume béni', typeArmure: 'Béni' },
    Torse: { nom: 'Plastron béni', typeArmure: 'Béni' },
  } });
  assert.equal(data.isActive, true);
  assert.equal(data.modifiers.healBonus, 3);        // 2 + 1 cumulés
  assert.equal(data.modifiers.critRangeBonus, 1);   // critique sur 19-20
});

test('armor set B : une résistance de set entre dans le profil de dégâts', () => {
  setEquipmentSlotsForTests(LEGACY_EQUIPMENT_SLOTS);
  setArmorSetSettingsForTests([
    { id: 'plaque', type: 'Plaque', enabled: true, cumulative: true, tiers: [{ pieces: 2, effects: [{ kind: 'resist', element: 'feu' }] }] },
  ]);
  const prof = getCharFullDamageProfile({ equipement: {
    'Tête': { nom: 'Heaume', typeArmure: 'Plaque' },
    Torse: { nom: 'Plastron', typeArmure: 'Plaque' },
  } });
  assert.ok(prof && prof.resistances.includes('feu'));
});

test('armor set B : plusieurs sets actifs en même temps s’agrègent', () => {
  setEquipmentSlotsForTests(LEGACY_EQUIPMENT_SLOTS);
  setArmorSetSettingsForTests([
    { id: 'a', type: 'Alpha', enabled: true, cumulative: true, tiers: [{ pieces: 1, effects: [{ kind: 'toucher', value: 1 }] }] },
    { id: 'b', type: 'Beta', enabled: true, cumulative: true, tiers: [{ pieces: 1, effects: [{ kind: 'pm', value: -1 }] }] },
  ]);
  const data = getArmorSetData({ equipement: {
    'Tête': { nom: 'A', typeArmure: 'Alpha' },
    Torse: { nom: 'B', typeArmure: 'Beta' },
  } });
  assert.equal(data.isActive, true);
  assert.equal(data.activeSets.length, 2);
  assert.equal(data.modifiers.toucherBonus, 1);
  assert.equal(data.modifiers.spellPmDelta, -1);
});

test('armor set : les types et effets personnalisés sont pilotés par aventure', () => {
  setEquipmentSlotsForTests([
    { id: 'Arme', label: 'Arme', kind: 'weapon', role: 'primaryWeapon' },
    { id: 'Cape', label: 'Cape', kind: 'armor', itemField: 'slotArmure', itemValue: 'Cape' },
    { id: 'Masque', label: 'Masque', kind: 'armor', itemField: 'slotArmure', itemValue: 'Masque' },
    { id: 'Anneau', label: 'Anneau', kind: 'accessory', itemField: 'slotBijou', itemValue: 'Anneau' },
  ]);
  setArmorSetSettingsForTests([
    {
      id: 'runique',
      type: 'Runique',
      label: 'Runique',
      enabled: true,
      modifiers: { spellPmDelta: 1, toucherBonus: -1, damageReduction: 3 },
    },
  ]);

  const data = getArmorSetData({
    equipement: {
      Cape: { nom: 'Cape gravée', typeArmure: 'Runique' },
      Masque: { nom: 'Masque gravé', typeArmure: 'Runique' },
      Anneau: { nom: 'Anneau sans importance', typeArmure: 'Légère' },
    },
  });

  assert.equal(data.isActive, true);
  assert.equal(data.trackedSlots.length, 2);
  assert.deepEqual(data.modifiers, {
    spellPmDelta: 1,
    toucherBonus: -1,
    damageReduction: 3,
    caBonus: 0,
    damageBonus: 0,
    damageSpellBonus: 0,
    healBonus: 0,
    critRangeBonus: 0,
    moveDelta: 0,
    saveBonus: {},
    resistances: [],
    rollImpact: { statModes: {}, skillModes: [] },
  });
});

test('armor set : une nouvelle aventure ne force aucun type par défaut', () => {
  setArmorSetSettingsForTests(DEFAULT_ARMOR_SETS, { base: DEFAULT_ARMOR_SETS });
  assert.deepEqual(getArmorTypeOptions(), []);
});

test.after(() => {
  setEquipmentSlotsForTests(LEGACY_EQUIPMENT_SLOTS);
  setArmorSetSettingsForTests(LEGACY_ARMOR_SETS);
});

test('armor set : un type d’aventure nommé « Lourd » n’est pas réécrit en « Lourde »', () => {
  // Régression : normalizeArmorType imposait les libellés hérités
  // (Léger→Légère, Lourd→Lourde). Le type ne correspondait alors plus au set
  // configuré par l’aventure et l’effet ne se déclenchait jamais.
  setEquipmentSlotsForTests([
    { id: 'Casque', label: 'Casque', kind: 'armor', itemField: 'slotArmure', itemValue: 'Casque' },
    { id: 'Torse', label: 'Torse', kind: 'armor', itemField: 'slotArmure', itemValue: 'Torse' },
  ]);
  setArmorSetSettingsForTests([
    { id: 'lourd', type: 'Lourd', label: 'Set Lourd', enabled: true, modifiers: { damageReduction: 3 } },
    { id: 'leger', type: 'Léger', label: 'Set Léger', enabled: true, modifiers: { toucherBonus: 1 } },
  ]);

  assert.equal(normalizeArmorType('Lourd'), 'Lourd');
  assert.equal(normalizeArmorType('lourd'), 'Lourd');   // casse libre
  assert.equal(normalizeArmorType('Leger'), 'Léger');   // accent libre
  assert.deepEqual(getArmorTypeOptions(), ['Lourd', 'Léger']);

  const data = getArmorSetData({
    equipement: {
      Casque: { nom: 'Heaume', typeArmure: 'Lourd' },
      Torse: { nom: 'Plastron', typeArmure: 'Lourd' },
    },
  });
  assert.equal(data.isActive, true);
  assert.equal(data.fullType, 'Lourd');
  assert.equal(data.modifiers.damageReduction, 3);
});

test('armor set : les anciennes fiches « legere » / « heavy » restent lisibles', () => {
  // Aucun set configuré ne correspond → repli historique conservé.
  setArmorSetSettingsForTests(LEGACY_ARMOR_SETS);
  assert.equal(normalizeArmorType('legere'), 'Légère');
  assert.equal(normalizeArmorType('heavy'), 'Lourde');
  assert.equal(normalizeArmorType('Runique'), 'Runique'); // type inconnu : inchangé
});

// ── Portée du bonus de dégâts de palier (armes / sorts / les deux) ────────────
function _runiqueData(scope) {
  setEquipmentSlotsForTests(LEGACY_EQUIPMENT_SLOTS);
  setArmorSetSettingsForTests([{
    id: 'sc', type: 'Runique', label: 'Runique', enabled: true,
    tiers: [{ pieces: 2, effects: [{ kind: 'dmg', value: 2, ...(scope ? { scope } : {}) }] }],
  }]);
  return getArmorSetData({
    equipement: {
      'Tête': { nom: 'Casque runique', typeArmure: 'Runique' },
      Torse:  { nom: 'Plastron runique', typeArmure: 'Runique' },
    },
  });
}

test('armor set : un bonus de dégâts « sorts uniquement » n’affecte pas les armes', () => {
  const d = _runiqueData('spells');
  assert.equal(d.isActive, true);
  assert.equal(d.modifiers.damageBonus, 0);      // attaques d'arme : rien
  assert.equal(d.modifiers.damageSpellBonus, 2); // sorts : +2
  assert.match(getArmorSetChipText(d, { includeNames: false }), /Dégâts \+2 \(sorts\)/);
});

test('armor set : un bonus de dégâts « armes uniquement » n’affecte pas les sorts', () => {
  const d = _runiqueData('weapon');
  assert.equal(d.modifiers.damageBonus, 2);
  assert.equal(d.modifiers.damageSpellBonus, 0);
  assert.match(getArmorSetChipText(d, { includeNames: false }), /Dégâts \+2 \(armes\)/);
});

test('armor set : par défaut (ou « tout »), le bonus de dégâts vaut pour armes et sorts', () => {
  for (const scope of [undefined, 'all']) {
    const d = _runiqueData(scope);
    assert.equal(d.modifiers.damageBonus, 2, `scope=${scope}`);
    assert.equal(d.modifiers.damageSpellBonus, 2, `scope=${scope}`);
    // Pas de mention de portée quand les deux coïncident.
    assert.match(getArmorSetChipText(d, { includeNames: false }), /Dégâts \+2(?! \()/);
  }
});

// ── Mémoïsation de getArmorSetData (optimisation, sans péremption) ────────────
test('armor set : l’agrégation coûteuse est mémoïsée par (réglages, counts)', () => {
  setEquipmentSlotsForTests(LEGACY_EQUIPMENT_SLOTS);
  setArmorSetSettingsForTests(LEGACY_ARMOR_SETS);
  const cA = { equipement: { 'Tête': { nom: 'Capuche', typeArmure: 'Légère' }, Torse: { nom: 'Robe', typeArmure: 'Légère' } } };
  const cB = { equipement: { 'Tête': { nom: 'Autre capuche', typeArmure: 'Légère' }, Torse: { nom: 'Autre robe', typeArmure: 'Légère' } } };
  const a1 = getArmorSetData(cA), a2 = getArmorSetData(cA);
  // Même perso → objet d'agrégation réutilisé (cache hit).
  assert.equal(a1.modifiers, a2.modifiers);
  assert.equal(a1.activeSets, a2.activeSets);
  // Mêmes types/counts → agrégation partagée (elle ne dépend pas des objets d'inventaire).
  const b = getArmorSetData(cB);
  assert.equal(a1.modifiers, b.modifiers);
  // …mais la partie « slots » reste propre à chaque perso (objets vivants non partagés).
  assert.notEqual(a1.slots, b.slots);
  assert.equal(a1.slots.find(s => s.slot === 'Tête')?.item.nom, 'Capuche');
  assert.equal(b.slots.find(s => s.slot === 'Tête')?.item.nom, 'Autre capuche');
});

test('armor set : modifier les réglages invalide le cache (nouvel objet _settings)', () => {
  setEquipmentSlotsForTests(LEGACY_EQUIPMENT_SLOTS);
  setArmorSetSettingsForTests(LEGACY_ARMOR_SETS);
  const c = { equipement: { 'Tête': { nom: 'C', typeArmure: 'Légère' }, Torse: { nom: 'R', typeArmure: 'Légère' } } };
  const before = getArmorSetData(c).modifiers;
  setArmorSetSettingsForTests(LEGACY_ARMOR_SETS); // remplace _settings → cache périmé abandonné
  const after = getArmorSetData(c).modifiers;
  assert.notEqual(before, after, 'nouveaux réglages → agrégation recalculée');
  assert.deepEqual(before, after, 'mais valeurs identiques (mêmes réglages de fond)');
});

test('armor set : le cache de normalizeArmorType s’invalide au changement de réglages', () => {
  setArmorSetSettingsForTests(LEGACY_ARMOR_SETS);
  const a = normalizeArmorType('legere'); // option configurée « Légère » (clé sans accent)
  assert.equal(a, 'Légère');
  // Nouveaux réglages : « legere » devient un type défini par l'aventure → libellé exact.
  setArmorSetSettingsForTests([{ id: 'x', type: 'legere', label: 'legere', enabled: true, tiers: [] }]);
  const b = normalizeArmorType('legere');
  assert.equal(b, 'legere', 'cache invalidé : résolution recalculée sous les nouveaux réglages');
  assert.notEqual(a, b);
});
