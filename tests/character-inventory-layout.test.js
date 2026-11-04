import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const feature = readFileSync(new URL('assets/js/features/characters/inventory.js', root), 'utf8');
// Familles, nature et bonus d'un objet : règles partagées avec le Marché du Bastion.
const facts = readFileSync(new URL('assets/js/shared/item-facts.js', root), 'utf8');
const sheet = readFileSync(new URL('assets/js/features/characters.js', root), 'utf8');
const css = readFileSync(new URL('assets/css/characters.css', root), 'utf8');

test('l onglet inventaire utilise la vue v11 une liste + une fiche (Équipé · À portée · Sac)', () => {
  assert.match(sheet, /inv:\s*\(\)\s*=>\s*renderCharInventaire\(c, canEdit\)/);
  const worn = feature.indexOf("head('Équipé'");
  const belt = feature.indexOf("head('À portée de main'");
  const bag = feature.indexOf("head('Sac'");
  assert.ok(worn >= 0 && belt > worn && bag > belt, 'les trois sections dans l’ordre');
  assert.match(feature, /const slots = getEquipmentSlots\(\)/);
  // Sac en 5 familles FIXES, dans cet ordre (le type libre reste lu sur la ligne).
  const fams = ['Équipement', 'Consommables', 'Matériaux', 'Quête & clés', 'Divers'].map(l => facts.indexOf(`label: '${l}'`));
  assert.ok(fams.every((at, i) => at >= 0 && (i === 0 || at > fams[i - 1])), 'familles du sac dans l’ordre');
  assert.match(feature, /const _IV_FAMILIES = ITEM_FAMILIES/);
  assert.match(feature, /_ivFamily\(group\.item\) === fam\.id/);
  // « Mat. bijou » est un matériau : signaux d'équipement, puis matériaux, puis noms de bijoux.
  assert.match(facts, /return 'equip';[\s\S]*?return 'mat';[\s\S]*?_looksJewel\(item\)\) return 'equip'/);
  // Liste + fiche côte à côte.
  assert.match(feature, /<div class="iv-list">\$\{_ivListHtml\(c, m, canEdit\)\}<\/div>\s*\$\{_ivSheetHtml\(c, m, sel, canEdit\)\}/);
});

test('une ligne = nom / ce que c’est / nombres, détail dans la fiche', () => {
  for (const marker of [
    'class="iv-row',
    'data-action="_invSelect"',
    'class="iv-name"',
    'class="iv-line"',      // ce que c'est (nature, emplacement…)
    'class="iv-side"',      // nombres + quantité
    'class="iv-gem"',       // losange de rareté
    'class="iv-new">Nouveau', // étiquette texte (plus de point vert)
    'class="iv-legend"',    // légende des raretés, dans la vue d'ensemble
    ' : sans marque',
    'class="iv-sheet"',
    "Si tu l'équipes",      // comparaison avant d'équiper
    'Emplacement libre',    // emplacement vide → objets compatibles
    '<em>Prise</em>',       // main secondaire prise par une arme à 2 mains
  ]) assert.ok(feature.includes(marker), marker);
  assert.ok(!feature.includes('class="iv-dot"'), 'point « nouveau » retiré');
  // Rareté « notable » = au-dessus du commun (barème réel 1-indexé).
  assert.match(feature, /_IV_NOTABLE\s*=\s*rare\s*=>\s*rare\s*>=\s*2/);
});

test('la sélection met à jour la fiche seule et suit l’objet après une action', () => {
  // Mise à jour ciblée de la fiche (pas de re-render de la liste).
  assert.match(feature, /function _invSelect\(key[\s\S]*?sheet\.outerHTML = _ivSheetHtml\(/);
  // Clé disparue (équipé, rangé, consommé…) → on retrouve l'objet ailleurs.
  assert.match(feature, /return exact \|\| worn\(m\.slots\.find\(e => e\.group\?\.key === itemKey\)\)/);
  // Utiliser / Ranger ne vident plus la sélection : la fiche reste ouverte.
  const body = name => {
    const at = feature.indexOf(`async function ${name}(`);
    assert.ok(at >= 0, name);
    return feature.slice(at, feature.indexOf('\n}\n', at));
  };
  for (const fn of ['_invConsumeOne', '_invToggleBelt']) {
    assert.ok(!body(fn).includes("_invSelected = ''"), `${fn} garde la fiche`);
  }
});

test('la barre et les actions réutilisent les flux existants', () => {
  for (const marker of [
    'data-input="_charInvSearch"',
    'data-action="addInvItem"',       // + Ajouter (forge/butin)
    'recipeBookButton(c)',
    'inventoryHistoryButton(c)',
    'data-action="_invConsumeOne"',    // Utiliser (ligne de ceinture)
    'data-action="${action}"',         // boutons de la fiche (_ivBtn)
    "'_invConsumeOne'",                // Utiliser (fiche)
    "'equipInventoryItem'",
    "'clearEquipSlot'",                // Retirer
    "'_invToggleBelt'",
    "'openSellInvModal'",              // Vendre
    "'openSendInvModal'",              // Donner
    "'openDeleteInvModal'",            // Jeter
    "'openInventoryReadableContent'",  // Lire
    "'openCreateItemModal'",           // Modifier (objet forgé)
  ]) assert.ok(feature.includes(marker), marker);
  // Un objet de quête n'a ni Vendre ni Jeter.
  assert.match(feature, /!quest && resale \? _ivBtn\(`Vendre[^\n]*'openSellInvModal'/);
  assert.match(feature, /!quest \? _ivBtn\('Jeter', 'openDeleteInvModal'/);
});

test('raccourci « / » et fermeture Échap de la fiche', () => {
  assert.match(feature, /e\.key === '\/'/);
  assert.match(feature, /e\.key === 'Escape'[^\n]*\n[^\n]*\n\s*_invCloseSheet\(\);/);
});

test('la densité v5 (tri, puces, répartition, panneau sticky) est supprimée', () => {
  for (const gone of [
    'data-action="_invSetSort"',
    'data-action="_invToggleNew"',
    'data-action="_invSetCategory"',
    'inv5-shell',
    'inv5-distribution',
    'inv5-chip',
    'function _invDetailHtml',
    'function renderCharInventaireLegacy',
    'data-action="_invToggleRow"',      // accordéon v10
    'function _invAccordionDetail',
    'function openInventoryItemDetail', // modale de détail, remplacée par la fiche
  ]) assert.ok(!feature.includes(gone), `supprimé : ${gone}`);
  assert.ok(!sheet.includes('function renderCharInventaireV3'), 'rendu V3 mort retiré');
  // La barre de chiffres (Bourse/Valeur/Objets) est retirée de l'inventaire.
  assert.ok(!feature.includes('<small>Bourse</small>'), 'barre Bourse retirée');
});

test('CSS v11 présent, scopé .cs-v3, responsive et contraste thème clair', () => {
  // Liste + fiche (plus de colonnes « de journal » qui coupent le Sac).
  assert.match(css, /\.cs-v3 \.iv-body \{ display: grid; grid-template-columns: minmax\(0, 1fr\) minmax\(330px, 400px\)/);
  assert.ok(!/\.iv-body \{[^}]*column-width/.test(css), 'colonnes de journal retirées');
  assert.match(css, /\.cs-v3 \.iv-row \{/);
  assert.match(css, /\.cs-v3 \.iv-gem \{/);
  assert.match(css, /\.cs-v3 \.iv-row\[data-r\] \.iv-name b \{ color: var\(--iv-rc\)/);
  // Fiche collée en large (sticky), panneau latéral en étroit, panneau du bas sur mobile.
  assert.match(css, /#char-sheet-area \.main-col:has\(\.iv\) \{ overflow: clip; \}/);
  assert.match(css, /\.cs-v3 \.iv:not\(\.is-narrow\) \.iv-sheet \{ position: sticky;/);
  assert.match(css, /\.cs-v3 \.iv\.is-narrow\.is-sheet-open \.iv-sheet \{ display: flex; position: fixed;/);
  assert.match(css, /@media \(max-width: 640px\) \{\r?\n  \.cs-v3 \.iv\.is-narrow\.is-sheet-open \.iv-sheet \{ top: auto;/);
  assert.match(css, /\[data-theme="light"\] \.cs-v3 \.iv-row\[data-r\] \.iv-name b/);
  // Les classes inv5 ne doivent plus exister dans le CSS.
  assert.ok(!css.includes('.inv5-shell'), 'CSS inv5-shell retiré');
  assert.ok(!css.includes('.inv5-distribution'), 'CSS inv5-distribution retiré');
});

test('le changement d onglet rejoue le fondu (characters.js)', () => {
  assert.match(sheet, /if \(!samePanel\)[\s\S]*?area\.classList\.add\('cs-tab-fadein'\)/);
});

test('la recherche met à jour la liste de façon ciblée et débouncée (sans re-render total)', () => {
  // La liste est isolée dans un helper réutilisé par le rendu complet ET la MAJ ciblée.
  assert.match(feature, /function _ivListHtml\(c, m, canEdit\)/);
  assert.match(feature, /<div class="iv-list">\$\{_ivListHtml\(c, m, canEdit\)\}/); // rendu complet
  assert.match(feature, /list\.innerHTML = _ivListHtml\(/);                         // MAJ ciblée .iv-list
  assert.match(feature, /document\.querySelector\('\.iv \.iv-list'\)/);
  // Le handler de recherche passe par le débounce ciblé, plus par le re-render total.
  assert.match(feature, /_charInvSearch:\s*\(el\)\s*=>\s*\{[^}]*_ivDebouncedListUpdate\(\)/);
  assert.ok(!/_charInvSearch:\s*\(el\)\s*=>\s*\{[^}]*_rerenderInventoryView/.test(feature),
    'la recherche ne doit plus déclencher un re-render total de l’onglet');
  // Débounce présent.
  assert.match(feature, /function _ivDebouncedListUpdate\(\)[\s\S]*?setTimeout\([\s\S]*?120\)/);
});

test('vendre un objet conserve la position de défilement réelle de la feuille', () => {
  const sellStart = feature.indexOf('export async function sellInvItemBulk');
  const sellEnd = feature.indexOf('\nexport async function sellInvItem', sellStart);
  const sell = feature.slice(sellStart, sellEnd);
  assert.match(sell, /const inventoryView = _captureInventoryViewState\(\)/);
  assert.match(sell, /_rerenderInventoryView\(\{ viewState: inventoryView \}\)/);
  assert.doesNotMatch(sell, /_renderInventoryChar\(c,/);

  const captureStart = feature.indexOf('function _captureInventoryViewState');
  const rerenderEnd = feature.indexOf('\nasync function _invToggleBelt', captureStart);
  const view = feature.slice(captureStart, rerenderEnd);
  assert.match(view, /document\.getElementById\('char-sheet-area'\)/);
  assert.match(view, /document\.getElementById\('char-tab-content'\)/);
  assert.match(view, /requestAnimationFrame\(\(\) => requestAnimationFrame/);
  assert.match(view, /sheet\?\.scrollTo\(\{ top: viewState\.sheetTop/);
  assert.match(view, /window\.scrollTo\(\{ top: viewState\.windowY/);
});
