import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SPELL_FREE_FIELDS,
  SPELL_PLAY_KEYS,
  spellPlayChanges,
  spellPlayDiff,
  spellPlaySnapshot,
} from '../assets/js/shared/spell-validation.js';

// Sort runique tel que la forge l'enregistre aujourd'hui.
const runic = () => ({
  id: 's1', nom: 'Boule de feu', icon: '🔥', effet: 'Une sphère ardente.', catId: 'c1',
  mjValidation: 'ok', mjValidated: true, actif: true, alwaysPrepared: false, countInStats: true,
  pm: 4, pmOverride: null, costResource: 'pm', consumable: null,
  mjAlwaysMax: false, mjAutoHit: false, mjNotes: '',
  noyau: 'Feu 🔥', noyauTypeId: 'feu', noyauTypeIds: ['feu'],
  runes: ['Puissance', 'Amplification'], actionMode: null, types: ['offensif'],
  degats: '', maitriseActive: true, soin: '', ca: '',
  protectionMode: 'ca', protectionModes: [], typeSoin: false,
  enchantDegats: '', enchantMode: 'etat', enchantBonus: null, enchantEtatId: null, enchantEtatIds: [],
  enchantStateMoveBonus: null, enchantStateDmgFormula: '', enchantSlot: 'arme', enchantEffect: '',
  afflictionSlot: 'torse', afflictionSaveStat: '', afflictionMode: 'dot', afflictionEffect: '',
  afflictionDotFormula: '', regenerationFormula: '',
  afflictionEtatId: null, afflictionEtatLabel: null, afflictionEtatIcon: null,
  zoneW: null, zoneH: null, dureeBase: null, deplacement: null, ampMode: 'zone', zoneShape: 'rect',
  portee: null, toucherStat: '', degatsStat: '', invocation: null,
});

const classic = () => ({
  designMode: 'classic', classicFormulaFinal: true, id: 'c1', nom: 'Soin léger', icon: '✦',
  catId: '', effet: '', types: ['defensif'], typeSoin: true,
  classicEffect: 'heal', classicTarget: 'ally', targetSelf: false,
  degats: '', soin: '1d8+2', protectionMode: 'soin', toucherStat: 'none', degatsStat: 'sagesse',
  noyau: '', noyauTypeId: null, noyauTypeIds: [], runes: [], actionMode: 'action',
  pm: 2, pmOverride: null, costResource: 'pm', consumable: null, portee: 1,
  zoneW: null, zoneH: null, zoneShape: 'rect', dureeBase: 0, classicDuration: 0, cooldownTurns: 0,
  classicStateId: null, classicStateLabel: null, classicStateIcon: null, classicStateDC: null,
  classicStateSaveStat: null, enchantMode: null, enchantEtatId: null, enchantEtatIds: [],
  afflictionMode: null, afflictionEtatId: null, afflictionSaveStat: '', invocation: null,
  countInStats: true, mjAutoHit: false, mjAlwaysMax: false, mjNotes: '',
  mjValidation: 'ok', mjValidated: true, alwaysPrepared: false, actif: true,
});

test('renommer, changer l’icône, la description ou la catégorie ne renvoie pas au MJ', () => {
  const before = runic();
  const after = { ...before, nom: 'Boule de feu suprême', icon: '☄️', effet: 'Autre texte', catId: 'c2' };
  assert.deepEqual(spellPlayChanges(before, after), []);
  const c = classic();
  assert.deepEqual(spellPlayChanges(c, { ...c, nom: 'Soin', icon: '💚', effet: 'Texte' }), []);
});

test('l’état du Deck, les réglages MJ et la préférence de statistiques ne comptent pas', () => {
  const before = runic();
  const after = {
    ...before, actif: false, alwaysPrepared: true, mjValidation: 'pending', mjValidated: false,
    pmOverride: 2, mjNotes: 'Note', mjAlwaysMax: true, countInStats: false, id: 'autre',
  };
  assert.deepEqual(spellPlayChanges(before, after), []);
});

test('un vieux sort sans les champs récents n’est pas vu comme modifié', () => {
  // Enregistré avant consumable / mjAutoHit / noyauTypeIds / costResource / types…
  const old = {
    nom: 'Boule de feu', icon: '🔥', mjValidated: true, actif: true, pm: 4,
    noyau: 'Feu 🔥', noyauTypeId: 'feu', runes: ['Amplification', 'Puissance'],
    degats: '', soin: '', ca: '', effet: '', protectionMode: 'ca',
    enchantMode: 'dmg', enchantSlot: 'arme',   // ancien défaut, réécrit « etat » par la forge
  };
  assert.deepEqual(spellPlayChanges(old, runic()), []);
});

test('un champ inconnu (ajouté plus tard) est ignoré', () => {
  const before = runic();
  assert.deepEqual(spellPlayChanges(before, { ...before, champFutur: 'x', autreFutur: 3 }), []);
});

test('chaque changement en jeu est détecté avec un libellé lisible', () => {
  const base = runic();
  const cases = [
    [{ degats: '3d6' }, ['Dégâts']],
    [{ runes: [...base.runes, 'Durée'] }, ['Runes']],
    [{ costResource: 'pv' }, ['Ressource dépensée']],
    [{ portee: 0 }, ['Portée']],
    [{ maitriseActive: false }, ['Maîtrise']],
    [{ consumable: { itemId: 'p1', nom: 'Potion', qty: 1, required: true } }, ['Objet consommé']],
    [{ invocation: { mode: 'selected', ids: ['loup'] } }, ['Invocation']],
    [{ deplacement: { mode: 'push' } }, ['Déplacement']],
    [{ zoneShape: 'cone' }, ['Zone']],
    [{ types: ['offensif', 'utilitaire'] }, ['Type de sort']],
    [{ noyauTypeId: 'glace', noyauTypeIds: ['glace'], noyau: 'Glace ❄️' }, ['Élément']],
  ];
  cases.forEach(([patch, expected]) => {
    assert.deepEqual(spellPlayChanges(base, { ...base, ...patch }), expected, JSON.stringify(patch));
  });
});

test('l’ordre des runes, types, ids et éléments secondaires ne compte pas', () => {
  const before = { ...runic(), noyauTypeIds: ['feu', 'glace'], enchantEtatIds: ['a', 'b'] };
  const after = { ...before, runes: [...before.runes].reverse(), noyauTypeIds: ['glace', 'feu'], enchantEtatIds: ['b', 'a'] };
  assert.deepEqual(spellPlayChanges(before, after), []);
  // Changer l'élément PRINCIPAL compte, même avec la même liste.
  assert.deepEqual(spellPlayChanges(before, { ...before, noyauTypeId: 'glace' }), ['Élément']);
});

test('un bloc modifié sur plusieurs champs n’apparaît qu’une fois', () => {
  const before = runic();
  const after = { ...before, enchantEtatId: 'swift', enchantEtatIds: ['swift'], enchantStateMoveBonus: 2, degats: '1d4' };
  assert.deepEqual(spellPlayChanges(before, after), ['Dégâts', 'Enchantement']);
});

test('coût : saisi en classique (compte), dérivé des runes en runique (ignoré)', () => {
  const c = classic();
  assert.deepEqual(spellPlayChanges(c, { ...c, pm: 3 }), ['Coût']);
  assert.deepEqual(spellPlayChanges(c, { ...c, mjAutoHit: true }), ['Réussite automatique']);
  assert.deepEqual(spellPlayChanges(c, { ...c, classicTarget: 'self', targetSelf: true }), ['Cible']);
  const r = runic();
  assert.deepEqual(spellPlayChanges(r, { ...r, pm: 9 }), []);
});

test('élément d’un très vieux sort sans id : comparé par libellé', () => {
  const old = { noyau: 'Feu 🔥' };
  assert.deepEqual(spellPlayChanges(old, { noyau: 'Feu 🔥', noyauTypeId: 'feu', noyauTypeIds: ['feu'] }), []);
  assert.deepEqual(spellPlayChanges(old, { noyau: 'Glace ❄️', noyauTypeId: 'glace' }), ['Élément']);
});

test('classement : chaque champ écrit par les formulaires est soit libre, soit en jeu', () => {
  const written = new Set([...Object.keys(runic()), ...Object.keys(classic())]);
  written.forEach(key => {
    assert.ok(SPELL_PLAY_KEYS.has(key) || SPELL_FREE_FIELDS.has(key), `champ non classé : ${key}`);
  });
  SPELL_FREE_FIELDS.forEach(key => assert.ok(!SPELL_PLAY_KEYS.has(key), `classé deux fois : ${key}`));
});

test('sans version de comparaison, rien n’est signalé', () => {
  assert.deepEqual(spellPlayChanges(null, runic()), []);
  assert.deepEqual(spellPlayChanges(runic(), undefined), []);
  assert.deepEqual(spellPlayDiff(null, runic()), []);
});

test('diff MJ : avant → après en texte lisible, un bloc par ligne', () => {
  const before = runic();
  const after = { ...before, runes: [...before.runes, 'Puissance'], portee: 10, degats: '3d6' };
  assert.deepEqual(spellPlayDiff(before, after), [
    { label: 'Runes', before: 'Amplification, Puissance', after: 'Amplification, Puissance ×2' },
    { label: 'Dégâts', before: 'Auto', after: '3d6' },
    { label: 'Portée', before: "Portée de l'arme", after: '10 cases' },
  ]);
});

test('diff MJ : les états sont nommés par le résolveur fourni', () => {
  const before = runic();
  const after = { ...before, enchantEtatId: 'swift', enchantEtatIds: ['swift'] };
  const rows = spellPlayDiff(before, after, { stateLabel: id => ({ swift: 'Rapide' }[id]) });
  assert.deepEqual(rows, [{ label: 'Enchantement', before: 'Aucun état', after: 'Rapide' }]);
  const c = classic();
  assert.deepEqual(spellPlayDiff(c, { ...c, pm: 3, classicDuration: 2 }), [
    { label: 'Coût', before: '2', after: '3' },
    { label: 'Durée', before: 'Instantané', after: '2 tours' },
  ]);
});

test('instantané MJ : relu contre le même sort, il ne signale rien', () => {
  [runic(), classic(), { noyau: 'Feu 🔥', runes: ['Puissance'], typeSoin: false }].forEach((spell) => {
    const snap = spellPlaySnapshot(spell);
    assert.deepEqual(spellPlayChanges(snap, spell), [], JSON.stringify(spell));
    assert.deepEqual(spellPlayDiff(snap, spell), []);
  });
});

test('instantané MJ : seulement le jeu, compact et enregistrable dans Firestore', () => {
  const spell = { ...runic(), invocation: { mode: 'selected', ids: ['loup'], image: 'data:image/png;base64,AAAA', stats: { pv: 10 } } };
  const snap = spellPlaySnapshot(spell);
  ['nom', 'icon', 'effet', 'catId', 'mjNotes', 'actif', 'mjValidation'].forEach(key => assert.equal(key in snap, false, key));
  assert.deepEqual(snap.invocation, { mode: 'selected', ids: ['loup'] });
  const walk = (v) => {
    assert.notEqual(v, undefined);
    if (Array.isArray(v)) v.forEach(x => { assert.equal(Array.isArray(x), false, 'pas de tableau imbriqué'); walk(x); });
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(snap);
  // Le diff d'un sort modifié contre l'instantané de la version validée.
  assert.deepEqual(spellPlayChanges(snap, { ...spell, invocation: { mode: 'all', ids: [] } }), ['Invocation']);
});
