import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const sheet = readFileSync(new URL('assets/js/features/characters.js', root), 'utf8');
const css = readFileSync(new URL('assets/css/characters.css', root), 'utf8');
const combat = sheet.slice(sheet.indexOf('function renderCharCombatV3'), sheet.indexOf('// ══════════════════════════════════════════════════════════════════════════════\n// V3 — INVENTAIRE'));

test('le combat v11 suit les trois zones et le détail en accordéon', () => {
  for (const marker of ['cb-hands', 'cb-style', 'cb-list', 'cb-elems', 'cb-cand', 'cb-x']) assert.ok(combat.includes(marker), marker);
  assert.match(combat, /En main[\s\S]*?Protection[\s\S]*?Savoir-faire/);
  // Plus de panneau latéral ni de redondance CA/PV/PM dans l'onglet.
  assert.ok(!combat.includes('cb-detail'), 'plus de panneau latéral cb-detail');
  assert.ok(!combat.includes('calcCA(c)'), 'plus de CA totale calculée dans l’onglet');
});

test('le détail se déplie en accordéon (plus de panneau sticky v8)', () => {
  assert.match(css, /\.cs-v3 \.cb-x\s*\{[\s\S]*?animation:\s*cbIn/);
  assert.ok(!css.includes('.cs-v3 .cb-detail'), 'CSS .cb-detail (panneau) retiré');
  assert.ok(!css.includes('.cs-v3 .main-col:has(.cb-wrap)'), 'overflow:clip du panneau retiré');
  assert.match(css, /@container \(max-width:\s*640px\)[\s\S]*?\.cs-v3 \.cb-hands/);
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

test('le set affiché reprend les paliers réellement appliqués', () => {
  assert.match(combat, /getArmorSetChipText\(armorSet, \{ includeNames: false \}\)/);
  assert.doesNotMatch(combat, /activeEffect\?\.chipText/);
});

test('le style actif est mis en évidence et l’arme calcule son jet', () => {
  assert.match(combat, /k === activeKey/);
  assert.match(combat, /cur \? '<em>Actif<\/em>'/);
  assert.match(combat, /<h5>Toucher<\/h5>/);
  assert.match(combat, /<h5>Dégâts/);
  assert.match(css, /\.cs-v3 \.cb-sl div\.cur/);
});

test('rareté en losange (partagé Inventaire) et traits via les helpers', () => {
  assert.match(combat, /cb-gem/);
  assert.match(combat, /_getTraits\(/);
  assert.match(combat, /RARETE_NAMES/);
  assert.match(css, /\.cs-v3 \.cb-gem\s*\{[^}]*rotate\(45deg\)/);
  assert.match(css, /\.cs-v3 \.cb-leg span::before/);
});

test('les actions MJ (maîtrises) sont alignées à droite de leur en-tête', () => {
  assert.match(css, /\.cs-v3 \.cb-sub \.cb-btn\s*\{[^}]*margin-left:\s*auto/);
});

test('le joueur choisit son élément par défaut au VTT (étoile éditable, pas MJ-only)', () => {
  // L'octroi d'un élément reste réservé au MJ…
  assert.match(combat, /toggleCharElement[^`]*\(MJ\)/);
  // …mais l'étoile « favori » (élément par défaut au VTT) est ouverte au
  // propriétaire de la fiche : rendue cliquable dès que canEdit, pas seulement mj.
  assert.match(combat, /active && canEdit \? `<button[^`]*setFavoriteElement/);
  assert.ok(!/active && mj \? `<button[^`]*setFavoriteElement/.test(combat),
    'l’étoile favori ne doit plus être gardée derrière mj');
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
    'data-action="cbOpen"',
  ]) assert.ok(combat.includes(marker), marker);
});
