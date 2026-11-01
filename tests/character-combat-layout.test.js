import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const sheet = readFileSync(new URL('assets/js/features/characters.js', root), 'utf8');
const css = readFileSync(new URL('assets/css/characters.css', root), 'utf8');
const combat = sheet.slice(sheet.indexOf('function renderCharCombatV3'), sheet.indexOf('// ══════════════════════════════════════════════════════════════════════════════\n// V3 — INVENTAIRE'));

test('combat v16 : feuille à filets, lignes Emplacement · Objet · Valeurs', () => {
  for (const marker of ['class="fs"', 'fs-sec', 'fs-row', 'fs-c1', 'fs-c2', 'fs-c3', 'fs-v', 'fs-traits', 'fs-x', 'fs-dl', 'fs-cand', 'fs-total', 'fs-mrow', 'fs-els']) {
    assert.ok(combat.includes(marker), marker);
  }
  // Ordre de rendu des sections (abstraction faite de l'ordre des déclarations).
  assert.match(combat, /\$\{weaponSection\}\$\{gearSection\}\$\{setSection\}\$\{masterySection\}\$\{elSection\}/);
  for (const h of ['Armes en main', 'Équipement porté', "Ensembles d'armure", "Maîtrises d'arme", 'Affinités élémentaires']) {
    assert.ok(combat.includes(h), h);
  }
});

test('combat v16 : plus de colonnes, cartes « mains », losange de style ni sac en double', () => {
  // L'ancien layout v11 a disparu (seuls .cb-gem / .cb-leg survivent).
  for (const dead of ['cb-hands', 'cb-style', 'cb-zone', 'cb-w', 'cb-roll', 'cb-detail', 'cb-sl']) {
    assert.ok(!combat.includes(dead), `marqueur v11 retiré : ${dead}`);
  }
  // Pas de redondance CA totale / PV / PM dans l'onglet.
  assert.ok(!combat.includes('calcCA(c)'), 'plus de CA totale calculée dans l’onglet');
});

test('combat v16 CSS : filets, accordéon en place, responsive, pas de reliquat v11', () => {
  assert.match(css, /\.cs-v3 \.fs-row\b/);
  assert.match(css, /\.cs-v3 \.fs-row\.is-open/);
  assert.match(css, /\.cs-v3 \.fs-x\b/);
  assert.match(css, /@media \(max-width:\s*680px\)[\s\S]*?\.cs-v3 \.fs-row/);
  // Les rareté en losange (partagé Inventaire) et la légende restent.
  assert.match(css, /\.cs-v3 \.cb-gem\s*\{[^}]*rotate\(45deg\)/);
  assert.match(css, /\.cs-v3 \.cb-leg span::before/);
  // Le gros du CSS .cb-* v11 est retiré.
  for (const dead of ['.cs-v3 .cb-zone', '.cs-v3 .cb-hands', '.cs-v3 .cb-w', '.cs-v3 .cb-detail', '.cs-v3 .cb-sl']) {
    assert.ok(!css.includes(dead), `CSS v11 retiré : ${dead}`);
  }
});

test('les valeurs de combat restent calculées par les helpers métier', () => {
  for (const marker of [
    'getWeaponToucherParts(c, item',
    'getWeaponDegatsParts(c, item',
    'detectCombatStyle?.(c, styles)',
    'getArmorSetData(c)',
    'getAttackMissEffect({',
  ]) assert.ok(sheet.includes(marker), marker);
  // Aucune donnée de démo réintroduite.
  assert.ok(!/const PROF\s*=|const ITEMS\s*=\s*\{\s*baton/.test(combat));
});

test('les ensembles affichent l’effet combiné réellement appliqué (par matière)', () => {
  assert.match(combat, /getArmorSetChipText\(armorSet, \{ includeNames: false \}\)/);
  // Paliers par matière via la définition et les paliers réellement atteints.
  assert.match(combat, /getArmorSetDefinition\(mat\)/);
  assert.match(combat, /armorSetAppliedTiers\(def, count, N\)/);
  assert.doesNotMatch(combat, /activeEffect\?\.chipText/);
});

test('le style actif est mis en évidence et l’arme calcule son jet', () => {
  assert.match(combat, /k === activeKey/);
  assert.match(combat, /cur \? '✓' : '○'/);
  // Le détail d'arme expose Toucher et Dégâts via la liste de définitions.
  assert.match(combat, /\['Toucher',/);
  assert.match(combat, /\['Dégâts',/);
});

test('rareté en losange (partagé Inventaire) et traits via les helpers', () => {
  assert.match(combat, /cb-gem/);
  assert.match(combat, /_getTraits\(/);
  assert.match(combat, /RARETE_NAMES/);
});

test('les en-têtes de section portent l’action MJ alignée à droite (.fs-add)', () => {
  assert.match(css, /\.cs-v3 \.fs-h \.fs-add\s*\{[^}]*margin:\s*0 0 0 auto/);
  // Les actions MJ « Gérer / Ajouter » sont des .fs-add.
  assert.match(combat, /class="fs-add" data-action="openArmorSetsAdmin"/);
  assert.match(combat, /class="fs-add" data-action="addMaitrise"/);
});

test('le joueur choisit son élément par défaut au VTT ; l’octroi reste MJ', () => {
  // L'octroi d'un élément passe par le mode « Gérer » réservé au MJ.
  assert.match(combat, /const manage = mj && _combatTabUi\.elManage/);
  assert.match(combat, /if \(manage\) return `<button[^`]*toggleCharElement/);
  // L'étoile « favori » (élément par défaut au VTT) est ouverte au propriétaire.
  assert.match(combat, /const fav = canEdit \? `data-action="setFavoriteElement"/);
  assert.ok(!/const fav = mj \? `data-action="setFavoriteElement"/.test(combat),
    'l’étoile favori ne doit pas être gardée derrière mj');
});

test('Échap ferme le détail ouvert (cohérence avec l’inventaire et les recettes)', () => {
  // Écouteur idempotent + appelé depuis le rendu de l'onglet.
  assert.match(sheet, /function _bindCombatKeys\(\)/);
  assert.match(combat, /_bindCombatKeys\(\);/);
  const handler = sheet.slice(sheet.indexOf('function _bindCombatKeys'), sheet.indexOf('async function _stepCombatMastery'));
  // Ne se déclenche que sur Échap quand un détail est ouvert.
  assert.match(handler, /e\.key !== 'Escape' \|\| _combatTabUi\.open == null/);
  // Ne vole pas Échap à une modale ouverte ni à un champ de saisie.
  assert.match(handler, /is-modal-open/);
  assert.match(handler, /INPUT\|TEXTAREA\|SELECT/);
  assert.match(handler, /_combatTabUi\.open = null/);
});

test('les actions réemploient les mutations existantes', () => {
  for (const marker of [
    'data-action="equipInventoryItem"',
    'data-action="clearEquipSlot"',
    'data-action="toggleCharElement"',
    'data-action="setFavoriteElement"',
    'data-action="openCombatStylesAdmin"',
    'data-action="openArmorSetsAdmin"',
    'data-action="stepCombatMastery"',
    'data-action="deleteMaitrise"',
    'data-action="cbOpen"',
    'data-action="cbElManage"',
  ]) assert.ok(combat.includes(marker), marker);
});
